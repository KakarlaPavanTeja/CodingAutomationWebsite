"use client";

import { createContext, useContext, useState, useCallback, useRef, useEffect, ReactNode } from "react";
import { getWorkflowSteps, getStepConfig, getPrerequisiteStep, LANGUAGES } from "@/lib/pipeline-config";
import type { QuestionType, PipelineMode, StepState, StepId, RunRequest, LogLine } from "@/types/pipeline";

function parseLogContent(content: string, prevLogs?: LogLine[]): LogLine[] {
  // Build a map of previous line content → timestamp for stability
  const prevTsMap = new Map<string, number>();
  if (prevLogs) {
    for (const l of prevLogs) {
      if (!prevTsMap.has(l.line)) prevTsMap.set(l.line, l.ts);
    }
  }

  let lastKnownTs = prevLogs?.[0]?.ts || Date.now();

  return content
    .split("\n")
    .filter((l: string) => l.trim())
    .map((line: string) => {
      const isStderr = line.includes("[STDERR]");
      // Extract ISO timestamp: [2024-01-15T10:30:00.000Z]
      const tsMatch = line.match(/^\[(\d{4}-\d{2}-\d{2}T[^\]]+)\]\s*/);
      // Strip timestamp prefix
      let cleaned = tsMatch ? line.slice(tsMatch[0].length) : line;
      // Strip [STDERR] prefix
      if (isStderr) cleaned = cleaned.replace(/^\[STDERR\]\s*/, "");

      let ts: number;
      if (tsMatch) {
        ts = new Date(tsMatch[1]).getTime();
        lastKnownTs = ts;
      } else if (prevTsMap.has(cleaned)) {
        // Reuse timestamp from previous parse to avoid timer flickering
        ts = prevTsMap.get(cleaned)!;
      } else {
        // No timestamp in file, no previous parse — use last known ts
        ts = lastKnownTs;
      }

      return {
        stream: isStderr ? "stderr" as const : "stdout" as const,
        line: cleaned,
        ts,
      };
    });
}

function createInitialStepState(stepId: StepId): StepState {
  const config = getStepConfig(stepId);
  return {
    id: stepId,
    status: "pending",
    logs: [],
    exitCode: null,
    startTime: null,
    endTime: null,
    enabledSubSteps: config.subSteps.filter((s) => s.defaultEnabled).map((s) => s.id),
    enabledLanguages: LANGUAGES.filter((l) => l.defaultEnabled).map((l) => l.id),
    testcaseCount: 0,
  };
}

interface PipelineContextType {
  questionType: QuestionType;
  mode: PipelineMode;
  globalLanguages: string[];
  globalTestcaseCount: number;
  stepStates: Map<StepId, StepState>;
  isAnyRunning: boolean;
  currentProblemId: string | null;
  stateLoading: boolean;
  setQuestionType: (qt: QuestionType) => void;
  setMode: (m: PipelineMode) => void;
  setGlobalLanguages: (langs: string[]) => void;
  setGlobalTestcaseCount: (count: number) => void;
  updateStepState: (stepId: StepId, partial: Partial<StepState>) => void;
  runStep: (state: StepState) => void;
  stopStep: (stepId: StepId) => Promise<void>;
  runAll: () => void;
  cancelRunAll: () => void;
  isRunAllActive: boolean;
  setCurrentProblemId: (id: string | null) => void;
  loadProblemState: (problemId: string) => Promise<void>;
  savePipelineState: () => void;
}

const PipelineContext = createContext<PipelineContextType | null>(null);

export function PipelineProvider({ children }: { children: ReactNode }) {
  const [questionType, setQuestionTypeRaw] = useState<QuestionType>("function");
  const [mode, setModeRaw] = useState<PipelineMode>("practice");
  const [globalLanguages, setGlobalLanguagesRaw] = useState<string[]>(
    LANGUAGES.filter((l) => l.defaultEnabled).map((l) => l.id)
  );
  const [globalTestcaseCount, setGlobalTestcaseCount] = useState(0);
  const [currentProblemId, setCurrentProblemId] = useState<string | null>(null);
  const [stateLoading, setStateLoading] = useState(false);
  const [runAllQueue, setRunAllQueue] = useState<StepId[]>([]);
  const [stepStates, setStepStates] = useState<Map<StepId, StepState>>(() => {
    const map = new Map<StepId, StepState>();
    getWorkflowSteps("function", "practice").forEach((id) => map.set(id, createInitialStepState(id)));
    return map;
  });

  // Per-step run tracking so independent steps can run concurrently.
  const runningStepsRef = useRef<Map<StepId, string>>(new Map());
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPollsRef = useRef<Array<{ runId: string; stepId: StepId }>>([]);
  // One poller per running step, keyed by stepId, so steps poll independently.
  const pollRefs = useRef<Map<StepId, ReturnType<typeof setInterval>>>(new Map());
  // Monotonic token: each loadProblemState bumps it so a slow earlier load
  // can detect it has been superseded and abort instead of clobbering state.
  const loadGenerationRef = useRef(0);

  // Refs mirror the latest state so debounced/interval callbacks can read fresh
  // values without being torn down and recreated on every state change.
  const stepStatesRef = useRef(stepStates);
  const currentProblemIdRef = useRef(currentProblemId);
  useEffect(() => {
    stepStatesRef.current = stepStates;
  }, [stepStates]);
  useEffect(() => {
    currentProblemIdRef.current = currentProblemId;
  }, [currentProblemId]);

  // When global languages change, sync execution steps that haven't been run yet
  const setGlobalLanguages = useCallback((langs: string[]) => {
    setGlobalLanguagesRaw(langs);
    setStepStates((prev) => {
      const next = new Map(prev);
      for (const [id, state] of next) {
        if (
          (id === "execute_tests_function" || id === "execute_tests_nonfunction") &&
          state.status === "pending"
        ) {
          next.set(id, { ...state, enabledLanguages: langs });
        }
      }
      return next;
    });
  }, []);

  const updateStepState = useCallback((stepId: StepId, partial: Partial<StepState>) => {
    setStepStates((prev) => {
      const next = new Map(prev);
      const current = next.get(stepId);
      if (current) {
        next.set(stepId, { ...current, ...partial });
      }
      return next;
    });
  }, []);

  // --- State Persistence ---

  const savePipelineState = useCallback(() => {
    // Debounce saves
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      // Read the latest state from refs so this stays a pure side effect
      // (no state updaters) and never double-fires under Strict Mode.
      const pid = currentProblemIdRef.current;
      if (!pid) return;
      const currentSteps = stepStatesRef.current;

      // Build step configs and statuses from current state
      const stepConfigs: Record<string, unknown> = {};
      const stepStatuses: Record<string, unknown> = {};

      for (const [id, state] of currentSteps) {
        stepConfigs[id] = {
          enabledSubSteps: state.enabledSubSteps,
          enabledLanguages: state.enabledLanguages,
          testcaseCount: state.testcaseCount,
        };
        stepStatuses[id] = {
          status: state.status,
          exitCode: state.exitCode,
          startTime: state.startTime,
          endTime: state.endTime,
        };
      }

      fetch("/api/pipeline/state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          problemId: pid,
          questionType,
          mode,
          enabledLanguages: globalLanguages,
          testcaseCount: globalTestcaseCount,
          stepConfigs,
          stepStatuses,
        }),
      }).catch(() => {});
    }, 500);
  }, [questionType, mode, globalLanguages, globalTestcaseCount]);

  const loadProblemState = useCallback(async (problemId: string) => {
    // Claim a generation token; a later load supersedes this one.
    const generation = ++loadGenerationRef.current;
    setStateLoading(true);
    setCurrentProblemId(problemId);

    // Stop any pollers / run tracking / queued work / pending save left over
    // from a previously-viewed problem so they can't write into the new
    // problem's state.
    for (const timer of pollRefs.current.values()) clearInterval(timer);
    pollRefs.current.clear();
    runningStepsRef.current.clear();
    pendingPollsRef.current = [];
    setRunAllQueue([]);
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }

    try {
      // Fetch both pipeline state and problem record (for question_type/mode)
      const [stateRes, problemRes] = await Promise.all([
        fetch(`/api/pipeline/state?problemId=${encodeURIComponent(problemId)}`),
        fetch(`/api/problems/${encodeURIComponent(problemId)}`),
      ]);
      const { state } = await stateRes.json();
      const problemData = await problemRes.json();
      // A newer load started while we were awaiting — abandon this one.
      if (loadGenerationRef.current !== generation) return;
      const problem = problemData.problem;

      // Always use question_type and mode from the problem record
      const qt = (problem?.question_type || state?.question_type || "function") as QuestionType;
      const m = (problem?.mode || state?.mode || "practice") as PipelineMode;
      setQuestionTypeRaw(qt);
      setModeRaw(m);

      if (state) {
        // Restore remaining configuration (qt/m already set above from problem record)
        setGlobalLanguagesRaw(state.enabled_languages || LANGUAGES.filter((l) => l.defaultEnabled).map((l) => l.id));
        setGlobalTestcaseCount(state.testcase_count || 30);

        // Rebuild step states from saved data
        const steps = getWorkflowSteps(qt, m);
        const savedConfigs = state.step_configs || {};
        const savedStatuses = state.step_statuses || {};

        const map = new Map<StepId, StepState>();
        steps.forEach((id) => {
          const initial = createInitialStepState(id);
          const config = savedConfigs[id] || {};
          const status = savedStatuses[id] || {};

          map.set(id, {
            ...initial,
            enabledSubSteps: config.enabledSubSteps || initial.enabledSubSteps,
            enabledLanguages: config.enabledLanguages || initial.enabledLanguages,
            testcaseCount: config.testcaseCount || initial.testcaseCount,
            status: status.status || "pending",
            exitCode: status.exitCode ?? null,
            startTime: status.startTime ?? null,
            endTime: status.endTime ?? null,
            logs: [], // Logs are not persisted
          });
        });
        setStepStates(map);

        // Load logs from files for completed/failed steps
        for (const [id, state] of map) {
          if (state.status === "completed" || state.status === "failed") {
            fetch(`/api/pipeline/run/logs?problemId=${encodeURIComponent(problemId)}&stepId=${encodeURIComponent(id)}&tail=500`)
              .then((r) => r.json())
              .then((logsData) => {
                if (loadGenerationRef.current !== generation) return;
                if (logsData.content) {
                  const logLines = parseLogContent(logsData.content);
                  setStepStates((prev) => {
                    const next = new Map(prev);
                    const current = next.get(id);
                    if (current) next.set(id, { ...current, logs: logLines });
                    return next;
                  });
                }
              })
              .catch(() => {});
          }
        }
      } else {
        // No saved state — start fresh
        const steps = getWorkflowSteps("function", "practice");
        const map = new Map<StepId, StepState>();
        steps.forEach((id) => map.set(id, createInitialStepState(id)));
        setStepStates(map);
      }
      // Store running run info for polling (started after this function).
      // Multiple steps may be running concurrently (e.g. editorial + JSON).
      const runsRes = await fetch(`/api/pipeline/run/status?problemId=${encodeURIComponent(problemId)}`);
      const runsData = await runsRes.json();
      // Superseded by a newer load — don't register pollers for this problem.
      if (loadGenerationRef.current !== generation) return;
      const runningRuns = (runsData.runs || []).filter(
        (r: { status: string }) => r.status === "running"
      ) as Array<{ id: string; step_id: StepId }>;
      for (const r of runningRuns) {
        runningStepsRef.current.set(r.step_id, r.id);
        pendingPollsRef.current.push({ runId: r.id, stepId: r.step_id });
      }
    } catch {
      // Failed to load — use defaults
    } finally {
      // Only clear loading if we are still the latest load.
      if (loadGenerationRef.current === generation) setStateLoading(false);
    }
  }, []);

  const handleWorkflowChange = useCallback((qt: QuestionType, m: PipelineMode) => {
    const steps = getWorkflowSteps(qt, m);
    setStepStates((prev) => {
      const map = new Map<StepId, StepState>();
      steps.forEach((id) => {
        const existing = prev.get(id);
        if (existing) {
          map.set(id, existing);
        } else {
          const fresh = createInitialStepState(id);
          if (id === "execute_tests_function" || id === "execute_tests_nonfunction") {
            fresh.enabledLanguages = [...globalLanguages];
          }
          map.set(id, fresh);
        }
      });
      return map;
    });
  }, [globalLanguages]);

  const setQuestionType = useCallback((qt: QuestionType) => {
    setQuestionTypeRaw(qt);
    handleWorkflowChange(qt, mode);
  }, [mode, handleWorkflowChange]);

  const setMode = useCallback((m: PipelineMode) => {
    setModeRaw(m);
    handleWorkflowChange(questionType, m);
  }, [questionType, handleWorkflowChange]);

  // Poll for step status and logs.
  const stopPolling = useCallback((stepId: StepId) => {
    const timer = pollRefs.current.get(stepId);
    if (timer) {
      clearInterval(timer);
      pollRefs.current.delete(stepId);
    }
  }, []);

  const startPolling = useCallback(
    (runId: string, stepId: StepId) => {
      stopPolling(stepId);
      runningStepsRef.current.set(stepId, runId);

      const poll = async () => {
        try {
          // Poll run status
          const statusRes = await fetch(`/api/pipeline/run/status?runId=${encodeURIComponent(runId)}`);

          if (!statusRes.ok) {
            // A genuine 404 means the run row is gone — stop polling and mark
            // the step failed instead of leaking the interval forever.
            if (statusRes.status === 404) {
              updateStepState(stepId, { status: "failed", exitCode: -1, endTime: Date.now() });
              runningStepsRef.current.delete(stepId);
              stopPolling(stepId);
            }
            return;
          }

          const { run } = await statusRes.json();

          if (!run) {
            updateStepState(stepId, { status: "failed", exitCode: -1, endTime: Date.now() });
            runningStepsRef.current.delete(stepId);
            stopPolling(stepId);
            return;
          }

          // Poll logs
          const pid = currentProblemIdRef.current;
          if (pid) {
            const logsRes = await fetch(
              `/api/pipeline/run/logs?problemId=${encodeURIComponent(pid)}&stepId=${encodeURIComponent(stepId)}&tail=200`
            );
            const logsData = await logsRes.json();

            if (logsData.content) {
              // Pass previous logs so timestamps stay stable across polls
              setStepStates((prev) => {
                const next = new Map(prev);
                const current = next.get(stepId);
                const prevLogs = current?.logs || [];
                const logLines = parseLogContent(logsData.content, prevLogs);
                if (current) next.set(stepId, { ...current, logs: logLines });
                return next;
              });
            }
          }

          // Check if done
          if (run.status === "completed" || run.status === "failed") {
            updateStepState(stepId, {
              status: run.status,
              exitCode: run.exit_code,
              endTime: run.finished_at ? new Date(run.finished_at).getTime() : Date.now(),
            });
            runningStepsRef.current.delete(stepId);
            stopPolling(stepId);
            savePipelineState();
          }
        } catch {
          // Polling failed — will retry on next interval
        }
      };

      // Poll immediately, then every 4 seconds
      poll();
      pollRefs.current.set(stepId, setInterval(poll, 4000));
    },
    [updateStepState, stopPolling, savePipelineState]
  );

  // Resume polling for any step that was running when state was loaded
  useEffect(() => {
    if (!stateLoading && pendingPollsRef.current.length > 0) {
      const pending = pendingPollsRef.current;
      pendingPollsRef.current = [];
      pending.forEach(({ runId, stepId }) => startPolling(runId, stepId));
    }
  }, [stateLoading, startPolling]);

  // Clean up all pollers / pending saves on unmount.
  useEffect(() => {
    const polls = pollRefs.current;
    return () => {
      for (const timer of polls.values()) clearInterval(timer);
      polls.clear();
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  const runStep = useCallback(
    async (state: StepState) => {
      stopPolling(state.id);

      const startTime = Date.now();
      updateStepState(state.id, {
        status: "running",
        logs: [],
        exitCode: null,
        startTime,
        endTime: null,
      });

      // Save start time to DB immediately
      savePipelineState();

      const isExecution =
        state.id === "execute_tests_function" || state.id === "execute_tests_nonfunction";
      const languages = isExecution ? state.enabledLanguages : globalLanguages;

      const request: RunRequest = {
        stepId: state.id,
        mode,
        subSteps: state.enabledSubSteps,
        languages,
        testcaseCount: globalTestcaseCount,
        problemId: currentProblemId || undefined,
      };

      try {
        const response = await fetch("/api/pipeline/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
        });

        if (!response.ok) {
          const text = await response.text();
          throw new Error(text || `HTTP ${response.status}`);
        }

        const data = await response.json();

        // Save state immediately
        savePipelineState();

        // Start polling for status and logs
        if (data.runId) {
          runningStepsRef.current.set(state.id, data.runId);
          startPolling(data.runId, state.id);
        }
      } catch {
        updateStepState(state.id, {
          status: "failed",
          exitCode: 1,
          endTime: Date.now(),
        });
        runningStepsRef.current.delete(state.id);
        savePipelineState();
      }
    },
    [mode, globalLanguages, globalTestcaseCount, currentProblemId, updateStepState, savePipelineState, startPolling, stopPolling]
  );

  const stopStep = useCallback(async (stepId: StepId) => {
    const runId = runningStepsRef.current.get(stepId);
    if (!runId) return;

    try {
      await fetch("/api/pipeline/run/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId }),
      });
    } catch {
      // Stop request failed — process may have already exited
    }

    // Update UI immediately — the close handler on the server will finalize.
    // Only this step is stopped; queued independent siblings keep running.
    updateStepState(stepId, {
      status: "failed",
      exitCode: -1,
      endTime: Date.now(),
    });
    runningStepsRef.current.delete(stepId);
    stopPolling(stepId);
    savePipelineState();
  }, [updateStepState, stopPolling, savePipelineState]);

  const isAnyRunning = Array.from(stepStates.values()).some((s) => s.status === "running");
  const isRunAllActive = runAllQueue.length > 0;

  // Run All: queue every not-yet-completed step from the current workflow.
  // The auto-run effect drives execution, launching each step as soon as its
  // real prerequisite is met — so independent siblings (editorial / JSON) run
  // concurrently instead of one-at-a-time.
  const runAll = useCallback(() => {
    const steps = getWorkflowSteps(questionType, mode);
    const remaining = steps.filter((id) => {
      const state = stepStates.get(id);
      return state && state.status !== "completed";
    });
    if (remaining.length === 0) return;
    setRunAllQueue(remaining);
  }, [questionType, mode, stepStates]);

  const cancelRunAll = useCallback(() => {
    setRunAllQueue([]);
  }, []);

  // Auto-run driver: scan the whole queue and launch every step whose
  // prerequisite has completed and that isn't already running. Steps still
  // waiting on a prerequisite that is running, queued ahead, or being retried
  // by this same Run All stay queued; steps whose prerequisite has truly failed
  // (and is not being retried) are dropped so the queue always drains.
  useEffect(() => {
    if (runAllQueue.length === 0) return;

    const steps = getWorkflowSteps(questionType, mode);
    const toRun: StepState[] = [];
    const remaining: StepId[] = [];
    // Steps that are kept (waiting) or launched — used to decide whether a
    // pending prerequisite is still going to run or was already dropped.
    const alive = new Set<StepId>();

    for (const id of runAllQueue) {
      const state = stepStates.get(id);
      // Drop steps that are done or already executing.
      if (!state || state.status === "completed" || state.status === "running") {
        continue;
      }

      const prereq = getPrerequisiteStep(id, steps);
      if (prereq) {
        const prevStatus = stepStates.get(prereq)?.status;
        if (prevStatus === "completed") {
          // ready to run
        } else if (prevStatus === "running" || alive.has(prereq)) {
          // Prerequisite is running, queued ahead, or about to be (re)launched
          // in this same pass (it's `alive`) — keep waiting. This also covers a
          // prerequisite that is currently `failed` but is being retried by this
          // Run All, so chained steps aren't wrongly dropped on a re-run.
          remaining.push(id);
          alive.add(id);
          continue;
        } else {
          // Prerequisite failed and is NOT being retried (not in this batch), or
          // is otherwise unreachable — skip this step so the queue still drains.
          continue;
        }
      }

      toRun.push(state);
      alive.add(id);
    }

    if (toRun.length > 0 || remaining.length !== runAllQueue.length) {
      setRunAllQueue(remaining);
      toRun.forEach((s) => runStep(s));
    }
  }, [runAllQueue, stepStates, questionType, mode, runStep]);

  return (
    <PipelineContext.Provider
      value={{
        questionType,
        mode,
        globalLanguages,
        globalTestcaseCount,
        stepStates,
        isAnyRunning,
        currentProblemId,
        stateLoading,
        setQuestionType,
        setMode,
        setGlobalLanguages,
        setGlobalTestcaseCount,
        updateStepState,
        runStep,
        stopStep,
        runAll,
        cancelRunAll,
        isRunAllActive,
        setCurrentProblemId,
        loadProblemState,
        savePipelineState,
      }}
    >
      {children}
    </PipelineContext.Provider>
  );
}

export function usePipeline() {
  const ctx = useContext(PipelineContext);
  if (!ctx) throw new Error("usePipeline must be used within PipelineProvider");
  return ctx;
}
