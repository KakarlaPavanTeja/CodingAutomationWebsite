"use client";

import { createContext, useContext, useState, useCallback, useRef, ReactNode } from "react";
import { getWorkflowSteps, getStepConfig, LANGUAGES } from "@/lib/pipeline-config";
import type { QuestionType, PipelineMode, StepState, StepId, LogLine, RunRequest } from "@/types/pipeline";

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
    testcaseCount: 48,
  };
}

interface PipelineContextType {
  questionType: QuestionType;
  mode: PipelineMode;
  globalLanguages: string[];
  globalTestcaseCount: number;
  stepStates: Map<StepId, StepState>;
  isAnyRunning: boolean;
  setQuestionType: (qt: QuestionType) => void;
  setMode: (m: PipelineMode) => void;
  setGlobalLanguages: (langs: string[]) => void;
  setGlobalTestcaseCount: (count: number) => void;
  updateStepState: (stepId: StepId, partial: Partial<StepState>) => void;
  runStep: (state: StepState) => void;
}

const PipelineContext = createContext<PipelineContextType | null>(null);

export function PipelineProvider({ children }: { children: ReactNode }) {
  const [questionType, setQuestionTypeRaw] = useState<QuestionType>("function");
  const [mode, setModeRaw] = useState<PipelineMode>("practice");
  const [globalLanguages, setGlobalLanguagesRaw] = useState<string[]>(
    LANGUAGES.filter((l) => l.defaultEnabled).map((l) => l.id)
  );

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
  const [globalTestcaseCount, setGlobalTestcaseCount] = useState(48);
  const [stepStates, setStepStates] = useState<Map<StepId, StepState>>(() => {
    const map = new Map<StepId, StepState>();
    getWorkflowSteps("function", "practice").forEach((id) => map.set(id, createInitialStepState(id)));
    return map;
  });

  // SSE state
  const abortRef = useRef<AbortController | null>(null);
  const runningStepRef = useRef<StepId | null>(null);

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
          // New execution steps inherit current global languages
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

  const runStep = useCallback((state: StepState) => {
    if (abortRef.current) {
      abortRef.current.abort();
    }

    const controller = new AbortController();
    abortRef.current = controller;
    runningStepRef.current = state.id;

    // Set running state
    updateStepState(state.id, {
      status: "running",
      logs: [],
      exitCode: null,
      startTime: Date.now(),
      endTime: null,
    });

    // Execution steps use their own per-step language selection
    const isExecution = state.id === "execute_tests_function" || state.id === "execute_tests_nonfunction";
    const languages = isExecution ? state.enabledLanguages : globalLanguages;

    const request: RunRequest = {
      stepId: state.id,
      mode,
      subSteps: state.enabledSubSteps,
      languages,
      testcaseCount: globalTestcaseCount,
    };

    fetch("/api/pipeline/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          const text = await response.text();
          throw new Error(text || `HTTP ${response.status}`);
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error("No response body");

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n\n");
          buffer = lines.pop() || "";

          for (const block of lines) {
            if (!block.trim()) continue;

            let eventType = "message";
            let data = "";

            for (const line of block.split("\n")) {
              if (line.startsWith("event: ")) eventType = line.slice(7);
              else if (line.startsWith("data: ")) data = line.slice(6);
            }

            if (!data) continue;

            try {
              const parsed = JSON.parse(data);
              const sid = runningStepRef.current;
              if (!sid) continue;

              if (eventType === "log") {
                setStepStates((prev) => {
                  const next = new Map(prev);
                  const current = next.get(sid);
                  if (current) {
                    next.set(sid, {
                      ...current,
                      logs: [...current.logs, { stream: parsed.stream, line: parsed.line, ts: parsed.ts }],
                    });
                  }
                  return next;
                });
              } else if (eventType === "done") {
                updateStepState(sid, {
                  status: parsed.exitCode === 0 ? "completed" : "failed",
                  exitCode: parsed.exitCode,
                  endTime: Date.now(),
                });
                runningStepRef.current = null;
              } else if (eventType === "error") {
                updateStepState(sid, {
                  status: "failed",
                  exitCode: 1,
                  endTime: Date.now(),
                });
                runningStepRef.current = null;
              }
            } catch {
              // Skip malformed JSON
            }
          }
        }
      })
      .catch((err) => {
        if (err.name === "AbortError") return;
        const sid = runningStepRef.current;
        if (sid) {
          updateStepState(sid, {
            status: "failed",
            exitCode: 1,
            endTime: Date.now(),
          });
          runningStepRef.current = null;
        }
      });
  }, [mode, globalLanguages, globalTestcaseCount, updateStepState]);

  const isAnyRunning = Array.from(stepStates.values()).some((s) => s.status === "running");

  return (
    <PipelineContext.Provider
      value={{
        questionType,
        mode,
        globalLanguages,
        globalTestcaseCount,
        stepStates,
        isAnyRunning,
        setQuestionType,
        setMode,
        setGlobalLanguages,
        setGlobalTestcaseCount,
        updateStepState,
        runStep,
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
