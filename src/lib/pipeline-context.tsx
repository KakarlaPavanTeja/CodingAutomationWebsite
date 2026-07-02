"use client";

import { createContext, useContext, useState, useCallback, useRef, useEffect, useMemo, ReactNode } from "react";
import { getWorkflowSteps, getPipelineUiWorkflowSteps, getAllTrackedStepIds, getStepConfig, LANGUAGES } from "@/lib/pipeline-config";
import { isStepReadyForRunAll, getIncompletePrerequisites } from "@/lib/pipeline-prerequisites";
import { computeAffectedSteps } from "@/lib/pipeline-dependents";
import { isQuestionPhaseComplete } from "@/lib/pipeline-question";
import type {
  QuestionType,
  PipelineMode,
  StepState,
  StepId,
  RunRequest,
  LogLine,
  QuestionSubStepId,
  GlobalPipelineConfig,
  StepStatus,
  SubStepRunState,
} from "@/types/pipeline";
import { GLOBAL_CONFIG_KEY } from "@/types/pipeline";
import {
  createEmptySubStepRun,
  recomputeGenerateQuestionStatus,
  getQuestionSubStepWaves,
  canRunQuestionSubStep,
  canRunBruteForce,
  getQuestionSubStepDependents,
  subStepLogKey,
  normalizeEnabledQuestionSubSteps,
  deriveEnabledQuestionSubSteps,
  shouldRunTitlesLlm,
  getSubStepDisplayStatus,
  type GQSubStepContext,
} from "@/lib/pipeline-question";
import {
  PARALLEL_LANG_STEPS,
  getLangsForStep,
  createEmptyLanguageSubRuns,
  recomputeLanguageStepStatus,
  languageSubStepLogKey,
} from "@/lib/pipeline-language-steps";
import { mergeRunProgress, mergeSubStepCompletion, isActiveStatus } from "@/lib/pipeline-duration";
import {
  reconcileLegacyGenerateQuestion,
  downstreamHasProgress,
} from "@/lib/pipeline-legacy";
import { parsePipelineLogContent } from "@/lib/pipeline-log-parse";
import { parsePipelineRunStepKey } from "@/lib/pipeline-run-label";

function requiresOwnerTitle(stepId: StepId): boolean {
  return stepId === "package_platform" || stepId === "prepare_platform_json";
}

const TITLE_REQUIRED_MSG =
  'This step needs a problem title. Open "Pipeline settings", fill in "Title (short text)", click Save, then re-run.';
const TITLE_PREREQ_MSG =
  'Skipped: depends on "Package for Platform", which was skipped because no problem title is set.';

/**
 * Which of `candidates` (in workflow order) cannot run without an owner title:
 * the packaging steps themselves, plus every step whose explicit prerequisite
 * chain reaches one of them within this candidate set (the editorial steps).
 */
function titleGatedSteps(candidates: StepId[]): Set<StepId> {
  const gated = new Set<StepId>();
  for (const id of candidates) {
    const prereq = getStepConfig(id).prerequisite;
    if (requiresOwnerTitle(id) || (prereq && gated.has(prereq))) gated.add(id);
  }
  return gated;
}

/** Visible "skipped — title required" state, with the reason in the step log. */
function titleSkipPatch(id: StepId, now: number): Partial<StepState> {
  return {
    status: "skipped",
    exitCode: null,
    startTime: null,
    endTime: now,
    logs: [
      {
        stream: "stderr",
        line: requiresOwnerTitle(id) ? `Skipped: ${TITLE_REQUIRED_MSG}` : TITLE_PREREQ_MSG,
        ts: now,
      },
    ],
  };
}

/**
 * Resolve once a watched status leaves "running" (settled), with a hard safety
 * deadline so a GQ/lang orchestrator can never hang forever if the watched
 * state stops updating (e.g. the problem was switched mid-run) — P1-H9.
 */
const STATUS_SETTLE_MAX_MS = 50 * 60 * 1000; // just past the 45-min pipeline timeout
function awaitStatusSettled(getStatus: () => StepStatus | undefined): Promise<void> {
  return new Promise<void>((resolve) => {
    const start = Date.now();
    const check = setInterval(() => {
      const st = getStatus();
      if ((st && st !== "running") || Date.now() - start > STATUS_SETTLE_MAX_MS) {
        clearInterval(check);
        resolve();
      }
    }, 400);
  });
}

function langPollKey(stepId: StepId, langId: string): string {
  return `${stepId}:${langId}`;
}

function initSubStepRuns(): StepState["subStepRuns"] {
  const config = getStepConfig("generate_question");
  const runs: NonNullable<StepState["subStepRuns"]> = {};
  for (const sub of config.subSteps) {
    runs[sub.id as QuestionSubStepId] = createEmptySubStepRun();
  }
  return runs;
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
    subStepRuns: stepId === "generate_question" ? initSubStepRuns() : undefined,
  };
}

interface PipelineContextType {
  questionType: QuestionType;
  mode: PipelineMode;
  globalLanguages: string[];
  globalTestcaseCount: number;
  ownerTitle: string;
  ownerDifficulty: string;
  generateTitleWithAi: boolean;
  defaultTagNames: string;
  stepStates: Map<StepId, StepState>;
  isAnyRunning: boolean;
  currentProblemId: string | null;
  stateLoading: boolean;
  setQuestionType: (qt: QuestionType) => void;
  setMode: (m: PipelineMode) => void;
  setGlobalLanguages: (langs: string[]) => void;
  setGlobalTestcaseCount: (count: number) => void;
  setOwnerTitle: (title: string) => void;
  setGenerateTitleWithAi: (enabled: boolean) => void;
  setDefaultTagNames: (tags: string) => void;
  saveOwnerTitle: () => Promise<void>;
  updateStepState: (stepId: StepId, partial: Partial<StepState>) => void;
  runStep: (state: StepState, refineNote?: string) => void;
  runLanguageSubStep: (stepId: StepId, langId: string, refineNote?: string) => Promise<void>;
  runQuestionSubStep: (subStepId: QuestionSubStepId, refineNote?: string) => Promise<void>;
  stopStep: (stepId: StepId) => Promise<void>;
  stopLanguageSubStep: (stepId: StepId, langId: string) => Promise<void>;
  stopQuestionSubStep: (subStepId: QuestionSubStepId) => Promise<void>;
  getSubStepStatus: (subStepId: QuestionSubStepId) => StepStatus;
  runAll: () => void;
  cancelRunAll: () => void;
  isRunAllActive: boolean;
  /** Completed steps made stale by a more-recent re-run of an upstream dep. */
  affectedStepIds: Set<StepId>;
  /** Reset and re-run only the stale (affected) downstream steps, in order. */
  runAffected: () => void;
  /** Re-run a user-selected subset of the affected steps. */
  runAffectedSelected: (ids: StepId[]) => void;
  setCurrentProblemId: (id: string | null) => void;
  loadProblemState: (problemId: string) => Promise<void>;
  savePipelineState: () => void;
  legacyPipelineNotice: string | null;
}

const PipelineContext = createContext<PipelineContextType | null>(null);

function emptyGlobalConfig(): GlobalPipelineConfig {
  return { ownerTitle: "", generateTitleWithAi: false, defaultTagNames: "" };
}

function buildGqContext(
  questionType: QuestionType,
  mode: PipelineMode,
  languages: string[],
  global: GlobalPipelineConfig,
  ownerDifficulty: string
): GQSubStepContext {
  return {
    questionType,
    mode,
    languages,
    generateTitleWithAi: global.generateTitleWithAi,
    ownerTitle: global.ownerTitle,
    ownerDifficulty,
  };
}

async function postPipelineRun(request: RunRequest): Promise<{ runId: string | null }> {
  let lastError = "Request failed";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch("/api/pipeline/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
      if (!response.ok) {
        lastError = (await response.text()) || `HTTP ${response.status}`;
        if (response.status >= 500 && attempt === 0) {
          await new Promise((r) => setTimeout(r, 400));
          continue;
        }
        throw new Error(lastError);
      }
      return (await response.json()) as { runId: string | null };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, 400));
        continue;
      }
      throw new Error(lastError);
    }
  }
  throw new Error(lastError);
}

function syncDerivedGqSubSteps(
  map: Map<StepId, StepState>,
  ctx: GQSubStepContext
): void {
  const gq = map.get("generate_question");
  if (!gq) return;
  const derived = deriveEnabledQuestionSubSteps(ctx);
  map.set("generate_question", {
    ...gq,
    enabledSubSteps: derived,
    ...recomputeGenerateQuestionStatus({ ...gq, enabledSubSteps: derived }, ctx.questionType, ctx),
  });
}

export function PipelineProvider({ children }: { children: ReactNode }) {
  const [questionType, setQuestionTypeRaw] = useState<QuestionType>("function");
  const [mode, setModeRaw] = useState<PipelineMode>("practice");
  const [globalLanguages, setGlobalLanguagesRaw] = useState<string[]>(
    LANGUAGES.filter((l) => l.defaultEnabled).map((l) => l.id)
  );
  const [globalTestcaseCount, setGlobalTestcaseCount] = useState(0);
  const [ownerTitle, setOwnerTitleRaw] = useState("");
  const [generateTitleWithAi, setGenerateTitleWithAiRaw] = useState(false);
  const [defaultTagNames, setDefaultTagNamesRaw] = useState("");
  const ownerDifficultyRef = useRef("");
  // Reactive mirror of ownerDifficultyRef so the wave-graph gate can apply the
  // difficulty-skip rule (P1-H5). The ref stays for synchronous reads.
  const [ownerDifficulty, setOwnerDifficultyState] = useState("");
  const [currentProblemId, setCurrentProblemId] = useState<string | null>(null);
  const [stateLoading, setStateLoading] = useState(false);
  const [runAllQueue, setRunAllQueue] = useState<StepId[]>([]);
  const [legacyPipelineNotice, setLegacyPipelineNotice] = useState<string | null>(null);
  const [stepStates, setStepStates] = useState<Map<StepId, StepState>>(() => {
    const map = new Map<StepId, StepState>();
    getAllTrackedStepIds("function", "practice").forEach((id) => map.set(id, createInitialStepState(id)));
    return map;
  });

  // Per-step run tracking so independent steps can run concurrently.
  const runningStepsRef = useRef<Map<StepId, string>>(new Map());
  const launchingStepsRef = useRef<Set<StepId>>(new Set());
  const runningSubStepsRef = useRef<Map<QuestionSubStepId, string>>(new Map());
  const runningLangStepsRef = useRef<Map<string, string>>(new Map());
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPollsRef = useRef<
    Array<{ runId: string; stepId: StepId; subStepId?: QuestionSubStepId; langId?: string }>
  >([]);
  // One poller per running step, keyed by stepId, so steps poll independently.
  const pollRefs = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());
  // Timers that flip a "stopped" step/sub-step back to "pending" after the
  // 3s cooldown (P1-H3), keyed by a stable step/sub-step/lang key.
  const stopRevertTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const STOP_REVERT_MS = 3000;
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

  const globalConfig = (): GlobalPipelineConfig => ({
    ownerTitle,
    generateTitleWithAi,
    defaultTagNames,
  });

  const gqContext = useCallback(
    (): GQSubStepContext =>
      buildGqContext(questionType, mode, globalLanguages, globalConfig(), ownerDifficultyRef.current),
    [questionType, mode, globalLanguages, ownerTitle, generateTitleWithAi, defaultTagNames]
  );

  // When global languages change, sync all language-aware steps
  const setGlobalLanguages = useCallback(
    (langs: string[]) => {
      setGlobalLanguagesRaw(langs);
      setStepStates((prev) => {
        const next = new Map(prev);
        const ctx = buildGqContext(questionType, mode, langs, globalConfig(), ownerDifficultyRef.current);
        syncDerivedGqSubSteps(next, ctx);
        for (const [id, state] of next) {
          if (
            id === "split_code" ||
            id === "execute_tests_function" ||
            id === "execute_tests_nonfunction" ||
            id === "execute_editorial"
          ) {
            next.set(id, { ...state, enabledLanguages: langs });
          }
        }
        return next;
      });
    },
    [questionType, mode, ownerTitle, generateTitleWithAi, defaultTagNames]
  );

  const updateStepState = useCallback((stepId: StepId, partial: Partial<StepState>) => {
    setStepStates((prev) => {
      const next = new Map(prev);
      const current = next.get(stepId);
      if (current) {
        next.set(stepId, { ...current, ...partial });
        stepStatesRef.current = next;
      }
      return next;
    });
  }, []);

  /** Merge one GQ sub-step without clobbering parallel sibling runs. */
  const patchGqSubStepRun = useCallback(
    (subStepId: QuestionSubStepId, patch: Partial<SubStepRunState>) => {
      setStepStates((prev) => {
        const next = new Map(prev);
        const gq = next.get("generate_question");
        if (!gq) return prev;
        const ctx = buildGqContext(
          questionType,
          mode,
          globalLanguages,
          globalConfig(),
          ownerDifficultyRef.current
        );
        const prevRun = gq.subStepRuns?.[subStepId] ?? createEmptySubStepRun();
        const subStepRuns = {
          ...gq.subStepRuns,
          [subStepId]: { ...prevRun, ...patch },
        };
        const updated = {
          ...gq,
          subStepRuns,
          ...recomputeGenerateQuestionStatus({ ...gq, subStepRuns }, questionType, ctx),
        };
        next.set("generate_question", updated);
        stepStatesRef.current = next;
        return next;
      });
    },
    [questionType, mode, globalLanguages, ownerTitle, generateTitleWithAi, defaultTagNames]
  );

  /** Merge one language sub-run without clobbering parallel sibling runs. */
  const patchLanguageSubRun = useCallback(
    (stepId: StepId, langId: string, patch: Partial<SubStepRunState>) => {
      setStepStates((prev) => {
        const next = new Map(prev);
        const current = next.get(stepId);
        if (!current) return prev;
        const langs = getLangsForStep(stepId, globalLanguages);
        const languageSubRuns = { ...(current.languageSubRuns ?? createEmptyLanguageSubRuns(langs)) };
        const prevRun = languageSubRuns[langId] ?? createEmptySubStepRun();
        languageSubRuns[langId] = { ...prevRun, ...patch };
        const updated = {
          ...current,
          languageSubRuns,
          ...recomputeLanguageStepStatus({ ...current, languageSubRuns }, langs),
        };
        next.set(stepId, updated);
        stepStatesRef.current = next;
        return next;
      });
    },
    [globalLanguages]
  );

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
          ...(id === "generate_question" && state.subStepRuns
            ? { subStepRuns: state.subStepRuns }
            : {}),
          ...(PARALLEL_LANG_STEPS.includes(id) && state.languageSubRuns
            ? { languageSubRuns: state.languageSubRuns }
            : {}),
        };
        stepStatuses[id] = {
          status: state.status,
          exitCode: state.exitCode,
          startTime: state.startTime,
          endTime: state.endTime,
        };
      }

      stepConfigs[GLOBAL_CONFIG_KEY] = {
        ownerTitle,
        generateTitleWithAi,
        defaultTagNames,
      };

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
  }, [questionType, mode, globalLanguages, globalTestcaseCount, ownerTitle, generateTitleWithAi, defaultTagNames]);

  const saveOwnerTitle = useCallback(async () => {
    const pid = currentProblemIdRef.current;
    if (!pid || !ownerTitle.trim()) return;

    await fetch(`/api/files/save?problemId=${encodeURIComponent(pid)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: "Outputs/generated_titles.txt",
        content: ownerTitle.trim() + "\n",
      }),
    });

    // The saved title unblocks packaging: return any step marked
    // "skipped — title required" (and its skipped dependents) to pending.
    for (const id of titleGatedSteps(getPipelineUiWorkflowSteps(questionType, mode))) {
      if (stepStatesRef.current.get(id)?.status === "skipped") {
        updateStepState(id, {
          status: "pending",
          exitCode: null,
          startTime: null,
          endTime: null,
          logs: [],
        });
      }
    }

    savePipelineState();
  }, [ownerTitle, questionType, mode, updateStepState, savePipelineState]);

  const setOwnerTitle = useCallback((title: string) => {
    setOwnerTitleRaw(title);
  }, []);

  const setGenerateTitleWithAi = useCallback((enabled: boolean) => {
    setGenerateTitleWithAiRaw(enabled);
    setStepStates((prev) => {
      const next = new Map(prev);
      const ctx = buildGqContext(
        questionType,
        mode,
        globalLanguages,
        { ownerTitle, generateTitleWithAi: enabled, defaultTagNames },
        ownerDifficultyRef.current
      );
      syncDerivedGqSubSteps(next, ctx);
      return next;
    });
  }, [questionType, mode, globalLanguages, ownerTitle, defaultTagNames]);

  const setDefaultTagNames = useCallback((tags: string) => {
    setDefaultTagNamesRaw(tags);
  }, []);

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
    for (const timer of stopRevertTimersRef.current.values()) clearTimeout(timer);
    stopRevertTimersRef.current.clear();
    runningStepsRef.current.clear();
    launchingStepsRef.current.clear();
    runningSubStepsRef.current.clear();
    runningLangStepsRef.current.clear();
    pendingPollsRef.current = [];
    setRunAllQueue([]);
    setLegacyPipelineNotice(null);
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
      ownerDifficultyRef.current = problem?.difficulty ?? "";
      setOwnerDifficultyState(problem?.difficulty ?? "");

      // Always use question_type and mode from the problem record
      const qt = (problem?.question_type || state?.question_type || "function") as QuestionType;
      const m = (problem?.mode || state?.mode || "practice") as PipelineMode;
      setQuestionTypeRaw(qt);
      setModeRaw(m);

      if (state) {
        // Restore remaining configuration (qt/m already set above from problem record)
        setGlobalLanguagesRaw(state.enabled_languages || LANGUAGES.filter((l) => l.defaultEnabled).map((l) => l.id));
        // 0 / unset means "let the test-case generator auto-scale the count by
        // difficulty x type (LLM decides, hard minimum 25)". Only an explicit
        // value forces a fixed target. (Previously this defaulted to 30, so a
        // blank box silently became a hard 30-case target.)
        setGlobalTestcaseCount(state.testcase_count ?? 0);

        const savedGlobal = (state.step_configs?.[GLOBAL_CONFIG_KEY] ?? {}) as Partial<GlobalPipelineConfig>;
        setOwnerTitleRaw(savedGlobal.ownerTitle ?? "");
        setGenerateTitleWithAiRaw(savedGlobal.generateTitleWithAi ?? false);
        setDefaultTagNamesRaw(savedGlobal.defaultTagNames ?? "");

        // Rebuild step states from saved data
        const steps = getAllTrackedStepIds(qt, m);
        const savedConfigs = state.step_configs || {};
        const savedStatuses = state.step_statuses || {};

        const map = new Map<StepId, StepState>();
        const langs = state.enabled_languages || LANGUAGES.filter((l) => l.defaultEnabled).map((l) => l.id);
        const gCtx = buildGqContext(qt, m, langs, {
          ownerTitle: savedGlobal.ownerTitle ?? "",
          generateTitleWithAi: savedGlobal.generateTitleWithAi ?? false,
          defaultTagNames: savedGlobal.defaultTagNames ?? "",
        }, ownerDifficultyRef.current);
        const derivedSubSteps = deriveEnabledQuestionSubSteps(gCtx);

        steps.forEach((id) => {
          const initial = createInitialStepState(id);
          const config = savedConfigs[id] || {};
          const status = savedStatuses[id] || {};

          map.set(id, {
            ...initial,
            enabledSubSteps:
              id === "generate_question"
                ? normalizeEnabledQuestionSubSteps(
                    qt,
                    config.enabledSubSteps as string[] | undefined,
                    derivedSubSteps
                  )
                : config.enabledSubSteps || initial.enabledSubSteps,
            enabledLanguages: config.enabledLanguages || langs,
            testcaseCount: config.testcaseCount || initial.testcaseCount,
            subStepRuns:
              id === "generate_question"
                ? (config.subStepRuns as StepState["subStepRuns"]) || initial.subStepRuns
                : undefined,
            languageSubRuns:
              PARALLEL_LANG_STEPS.includes(id)
                ? (config.languageSubRuns as StepState["languageSubRuns"]) ||
                  createEmptyLanguageSubRuns(getLangsForStep(id, langs))
                : undefined,
            status: status.status || "pending",
            exitCode: status.exitCode ?? null,
            startTime: status.startTime ?? null,
            endTime: status.endTime ?? null,
            logs: [],
          });
        });

        // Reconcile parent generate_question status from substeps
        let gq = map.get("generate_question");
        if (gq) {
          map.set("generate_question", { ...gq, ...recomputeGenerateQuestionStatus(gq, qt, gCtx) });
          gq = map.get("generate_question")!;
        }

        // Hydrate title from output file if config empty (await so Run All isn't blocked on load)
        if (!savedGlobal.ownerTitle?.trim()) {
          try {
            const titleRes = await fetch(
              `/api/files/read?problemId=${encodeURIComponent(problemId)}&path=${encodeURIComponent("Outputs/generated_titles.txt")}`
            );
            if (titleRes.ok) {
              const data = await titleRes.json();
              const firstLine =
                data?.content?.split("\n").find((l: string) => l.trim())?.trim() ?? "";
              if (firstLine) {
                const cleaned = firstLine.replace(/^-\s*/, "").split("-")[0].trim();
                if (cleaned) setOwnerTitleRaw(cleaned);
              }
            }
          } catch {
            // Non-fatal — user can enter title manually
          }
        }

        // Legacy problems: infer sub-step completion from outputs / parent status
        let wasLegacyReconciled = false;
        try {
          const outputsRes = await fetch(
            `/api/files/outputs?problemId=${encodeURIComponent(problemId)}`
          );
          if (outputsRes.ok && gq) {
            const outputsData = await outputsRes.json();
            const paths = (outputsData.files ?? [])
              .filter((f: { isDirectory?: boolean }) => !f.isDirectory)
              .map((f: { path: string }) => f.path);
            const savedGq = savedStatuses.generate_question as
              | { status?: string; startTime?: number; endTime?: number }
              | undefined;
            const reconcile = reconcileLegacyGenerateQuestion(
              gq,
              qt,
              savedGq ?? {},
              paths,
              downstreamHasProgress(map, steps)
            );
            if (reconcile.wasLegacy) {
              wasLegacyReconciled = true;
              map.set("generate_question", reconcile.state);
              setLegacyPipelineNotice(reconcile.message);
              // Persist inferred sub-step state so future loads are consistent
              stepStatesRef.current = map;
              savePipelineState();
            }
          }
        } catch {
          // Non-fatal — UI still works without output-based reconcile
        }

        setStepStates(map);

        // Load logs from files for completed/failed steps
        for (const [id, state] of map) {
          if (id === "generate_question" && state.subStepRuns) {
            if (
              wasLegacyReconciled ||
              (savedStatuses.generate_question as { status?: string } | undefined)?.status ===
                "completed"
            ) {
              fetch(
                `/api/pipeline/run/logs?problemId=${encodeURIComponent(problemId)}&stepId=generate_question&tail=500`
              )
                .then((r) => r.json())
                .then((logsData) => {
                  if (loadGenerationRef.current !== generation) return;
                  if (!logsData.content) return;
                  const logLines = parsePipelineLogContent(logsData.content);
                  setStepStates((prev) => {
                    const next = new Map(prev);
                    const gq = next.get("generate_question");
                    if (!gq) return prev;
                    const subStepRuns = { ...gq.subStepRuns };
                    const desc = subStepRuns.description ?? createEmptySubStepRun();
                    if (!desc.logs?.length) {
                      subStepRuns.description = { ...desc, logs: logLines };
                      next.set("generate_question", { ...gq, subStepRuns });
                    }
                    return next;
                  });
                })
                .catch(() => {});
            }

            for (const [subId, subRun] of Object.entries(state.subStepRuns)) {
              if (subRun?.status === "completed" || subRun?.status === "failed") {
                const logKey = subStepLogKey(subId as QuestionSubStepId);
                fetch(
                  `/api/pipeline/run/logs?problemId=${encodeURIComponent(problemId)}&stepId=${encodeURIComponent(logKey)}&tail=500`
                )
                  .then((r) => r.json())
                  .then((logsData) => {
                    if (loadGenerationRef.current !== generation) return;
                    if (logsData.content) {
                      const logLines = parsePipelineLogContent(logsData.content);
                      setStepStates((prev) => {
                        const next = new Map(prev);
                        const gq = next.get("generate_question");
                        if (!gq) return prev;
                        const subStepRuns = { ...gq.subStepRuns };
                        subStepRuns[subId as QuestionSubStepId] = {
                          ...(subStepRuns[subId as QuestionSubStepId] ?? createEmptySubStepRun()),
                          logs: logLines,
                        };
                        next.set("generate_question", { ...gq, subStepRuns });
                        return next;
                      });
                    }
                  })
                  .catch(() => {});
              }
            }
            continue;
          }

          if (state.status === "completed" || state.status === "failed") {
            fetch(`/api/pipeline/run/logs?problemId=${encodeURIComponent(problemId)}&stepId=${encodeURIComponent(id)}&tail=500`)
              .then((r) => r.json())
              .then((logsData) => {
                if (loadGenerationRef.current !== generation) return;
                if (logsData.content) {
                  const logLines = parsePipelineLogContent(logsData.content);
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
        const steps = getAllTrackedStepIds("function", "practice");
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
      ) as Array<{ id: string; step_id: string }>;
      for (const r of runningRuns) {
        const parsed = parsePipelineRunStepKey(r.step_id);
        runningStepsRef.current.set(parsed.parentStepId, r.id);
        pendingPollsRef.current.push({
          runId: r.id,
          stepId: parsed.parentStepId,
          subStepId: parsed.subStepId,
          langId: parsed.langId,
        });
      }
    } catch {
      // Failed to load — use defaults
    } finally {
      // Only clear loading if we are still the latest load.
      if (loadGenerationRef.current === generation) setStateLoading(false);
    }
  }, []);

  const handleWorkflowChange = useCallback((qt: QuestionType, m: PipelineMode) => {
    const steps = getAllTrackedStepIds(qt, m);
    setStepStates((prev) => {
      const map = new Map<StepId, StepState>();
      const ctx = buildGqContext(qt, m, globalLanguages, globalConfig(), ownerDifficultyRef.current);
      steps.forEach((id) => {
        const existing = prev.get(id);
        if (existing) {
          let next = existing;
          if (id === "generate_question") {
            next = {
              ...existing,
              enabledSubSteps: deriveEnabledQuestionSubSteps(ctx),
            };
          }
          if (
            id === "split_code" ||
            id === "execute_tests_function" ||
            id === "execute_tests_nonfunction" ||
            id === "execute_editorial"
          ) {
            next = { ...next, enabledLanguages: [...globalLanguages] };
          }
          map.set(id, next);
        } else {
          const fresh = createInitialStepState(id);
          if (id === "generate_question") {
            fresh.enabledSubSteps = deriveEnabledQuestionSubSteps(ctx);
          }
          if (
            id === "execute_tests_function" ||
            id === "execute_tests_nonfunction" ||
            id === "split_code" ||
            id === "execute_editorial"
          ) {
            fresh.enabledLanguages = [...globalLanguages];
          }
          map.set(id, fresh);
        }
      });
      syncDerivedGqSubSteps(map, ctx);
      return map;
    });
  }, [globalLanguages, ownerTitle, generateTitleWithAi, defaultTagNames]);

  const setQuestionType = useCallback((qt: QuestionType) => {
    setQuestionTypeRaw(qt);
    handleWorkflowChange(qt, mode);
  }, [mode, handleWorkflowChange]);

  const setMode = useCallback((m: PipelineMode) => {
    setModeRaw(m);
    handleWorkflowChange(questionType, m);
  }, [questionType, handleWorkflowChange]);

  const pollKey = (stepId: StepId, subStepId?: QuestionSubStepId, langId?: string) => {
    if (subStepId) return `${stepId}:${subStepId}`;
    if (langId) return langPollKey(stepId, langId);
    return stepId;
  };

  const stopPolling = useCallback((stepId: StepId, subStepId?: QuestionSubStepId, langId?: string) => {
    const key = pollKey(stepId, subStepId, langId);
    const timer = pollRefs.current.get(key);
    if (timer) {
      clearInterval(timer);
      pollRefs.current.delete(key);
    }
  }, []);

  const startPolling = useCallback(
    (runId: string, stepId: StepId, subStepId?: QuestionSubStepId, langId?: string) => {
      stopPolling(stepId, subStepId, langId);
      const key = pollKey(stepId, subStepId, langId);
      if (subStepId) {
        runningSubStepsRef.current.set(subStepId, runId);
      } else if (langId) {
        runningLangStepsRef.current.set(langPollKey(stepId, langId), runId);
      } else {
        runningStepsRef.current.set(stepId, runId);
      }

      const logStepId = subStepId
        ? subStepLogKey(subStepId)
        : langId
          ? languageSubStepLogKey(stepId, langId)
          : stepId;

      const poll = async () => {
        try {
          const statusRes = await fetch(`/api/pipeline/run/status?runId=${encodeURIComponent(runId)}`);

          if (!statusRes.ok) {
            if (statusRes.status === 404) {
              if (subStepId) {
                setStepStates((prev) => {
                  const next = new Map(prev);
                  const gq = next.get("generate_question");
                  if (!gq) return prev;
                  const subStepRuns = { ...gq.subStepRuns };
                  subStepRuns[subStepId] = {
                    ...(subStepRuns[subStepId] ?? createEmptySubStepRun()),
                    status: "failed",
                    exitCode: -1,
                    endTime: Date.now(),
                  };
                  const updated = { ...gq, subStepRuns, ...recomputeGenerateQuestionStatus({ ...gq, subStepRuns }, questionType, gqContext()) };
                  next.set("generate_question", updated);
                  return next;
                });
              } else if (langId) {
                setStepStates((prev) => {
                  const next = new Map(prev);
                  const current = next.get(stepId);
                  if (!current) return prev;
                  const languageSubRuns = { ...(current.languageSubRuns ?? {}) };
                  languageSubRuns[langId] = {
                    ...(languageSubRuns[langId] ?? createEmptySubStepRun()),
                    status: "failed",
                    exitCode: -1,
                    endTime: Date.now(),
                  };
                  next.set(stepId, {
                    ...current,
                    languageSubRuns,
                    ...recomputeLanguageStepStatus(
                      { ...current, languageSubRuns },
                      getLangsForStep(stepId, globalLanguages)
                    ),
                  });
                  return next;
                });
              } else {
                updateStepState(stepId, { status: "failed", exitCode: -1, endTime: Date.now() });
              }
              if (subStepId) runningSubStepsRef.current.delete(subStepId);
              else if (langId) runningLangStepsRef.current.delete(langPollKey(stepId, langId));
              else runningStepsRef.current.delete(stepId);
              stopPolling(stepId, subStepId, langId);
            }
            return;
          }

          const { run } = await statusRes.json();
          if (!run) {
            stopPolling(stepId, subStepId, langId);
            return;
          }

          // A "soft orphan" (exit_code -2) is a run the server only *suspects*
          // died (its pid looked gone). Its process may still be alive and about
          // to exit cleanly — the run close handler will overwrite -2 with the
          // real exit code. Treat it as still running so the tile keeps polling
          // and recovers to the true terminal status instead of freezing on a
          // spurious "Failed" with a half-parsed testcase count. A genuinely
          // dead run escalates to a hard orphan (exit_code -1) past the runtime
          // ceiling, which is terminal and stops polling below.
          if (run.status === "failed" && run.exit_code === -2) {
            run.status = "running";
          }

          if (run.status === "running") {
            if (subStepId) {
              setStepStates((prev) => {
                const next = new Map(prev);
                const gq = next.get("generate_question");
                if (!gq) return prev;
                const subStepRuns = { ...gq.subStepRuns };
                const prevRun = subStepRuns[subStepId] ?? createEmptySubStepRun();
                subStepRuns[subStepId] = mergeRunProgress(prevRun, {
                  status: "running",
                  startedAtIso: run.started_at,
                });
                next.set("generate_question", {
                  ...gq,
                  subStepRuns,
                  ...recomputeGenerateQuestionStatus({ ...gq, subStepRuns }, questionType, gqContext()),
                });
                return next;
              });
            } else if (langId) {
              setStepStates((prev) => {
                const next = new Map(prev);
                const current = next.get(stepId);
                if (!current) return prev;
                const languageSubRuns = { ...(current.languageSubRuns ?? {}) };
                const prevRun = languageSubRuns[langId] ?? createEmptySubStepRun();
                languageSubRuns[langId] = mergeRunProgress(prevRun, {
                  status: "running",
                  startedAtIso: run.started_at,
                });
                next.set(stepId, {
                  ...current,
                  languageSubRuns,
                  ...recomputeLanguageStepStatus(
                    { ...current, languageSubRuns },
                    getLangsForStep(stepId, globalLanguages)
                  ),
                });
                return next;
              });
            } else {
              setStepStates((prev) => {
                const next = new Map(prev);
                const current = next.get(stepId);
                if (!current) return prev;
                const synced = mergeRunProgress(
                  {
                    status: current.status,
                    logs: current.logs,
                    exitCode: current.exitCode,
                    startTime: current.startTime,
                    endTime: current.endTime,
                  },
                  { status: "running", startedAtIso: run.started_at }
                );
                next.set(stepId, { ...current, ...synced });
                stepStatesRef.current = next;
                return next;
              });
            }
          }

          const pid = currentProblemIdRef.current;
          if (pid) {
            const logsRes = await fetch(
              `/api/pipeline/run/logs?problemId=${encodeURIComponent(pid)}&stepId=${encodeURIComponent(logStepId)}&runId=${encodeURIComponent(runId)}&tail=2000`
            );
            const logsData = await logsRes.json();
            if (logsData.content) {
              const logLines = parsePipelineLogContent(logsData.content);
              if (subStepId) {
                setStepStates((prev) => {
                  const next = new Map(prev);
                  const gq = next.get("generate_question");
                  if (!gq) return prev;
                  const subStepRuns = { ...gq.subStepRuns };
                  const prevRun = subStepRuns[subStepId] ?? createEmptySubStepRun();
                  subStepRuns[subStepId] = { ...prevRun, logs: logLines };
                  next.set("generate_question", { ...gq, subStepRuns });
                  return next;
                });
              } else if (langId) {
                setStepStates((prev) => {
                  const next = new Map(prev);
                  const current = next.get(stepId);
                  if (!current) return prev;
                  const languageSubRuns = { ...(current.languageSubRuns ?? {}) };
                  const prevRun = languageSubRuns[langId] ?? createEmptySubStepRun();
                  languageSubRuns[langId] = { ...prevRun, logs: logLines };
                  next.set(stepId, { ...current, languageSubRuns });
                  return next;
                });
              } else {
                setStepStates((prev) => {
                  const next = new Map(prev);
                  const current = next.get(stepId);
                  if (!current) return prev;
                  const prevLogs = current.logs || [];
                  next.set(stepId, { ...current, logs: parsePipelineLogContent(logsData.content, prevLogs) });
                  return next;
                });
              }
            }
          }

          if (run.status === "completed" || run.status === "failed") {
            const endTime = run.finished_at ? new Date(run.finished_at).getTime() : Date.now();
            if (subStepId) {
              setStepStates((prev) => {
                const next = new Map(prev);
                const gq = next.get("generate_question");
                if (!gq) return prev;
                const subStepRuns = { ...gq.subStepRuns };
                const prevRun = subStepRuns[subStepId] ?? createEmptySubStepRun();
                subStepRuns[subStepId] = mergeSubStepCompletion(prevRun, {
                  status: run.status,
                  exitCode: run.exit_code,
                  endTime,
                  startedAtIso: run.started_at,
                });
                const updated = {
                  ...gq,
                  subStepRuns,
                  ...recomputeGenerateQuestionStatus({ ...gq, subStepRuns }, questionType, gqContext()),
                };
                next.set("generate_question", updated);
                return next;
              });
              runningSubStepsRef.current.delete(subStepId);

              if (subStepId === "titles" && run.status === "completed" && currentProblemIdRef.current) {
                fetch(
                  `/api/files/read?problemId=${encodeURIComponent(currentProblemIdRef.current)}&path=${encodeURIComponent("Outputs/generated_titles.txt")}`
                )
                  .then((r) => (r.ok ? r.json() : null))
                  .then((data) => {
                    if (data?.content) {
                      const firstLine =
                        data.content.split("\n").find((l: string) => l.trim())?.trim() ?? "";
                      if (firstLine) {
                        const cleaned = firstLine.replace(/^-\s*/, "").split("-")[0].trim();
                        setOwnerTitleRaw(cleaned);
                      }
                    }
                  })
                  .catch(() => {});
              }
            } else if (langId) {
              setStepStates((prev) => {
                const next = new Map(prev);
                const current = next.get(stepId);
                if (!current) return prev;
                const languageSubRuns = { ...(current.languageSubRuns ?? {}) };
                const prevRun = languageSubRuns[langId] ?? createEmptySubStepRun();
                languageSubRuns[langId] = mergeSubStepCompletion(prevRun, {
                  status: run.status,
                  exitCode: run.exit_code,
                  endTime,
                  startedAtIso: run.started_at,
                });
                next.set(stepId, {
                  ...current,
                  languageSubRuns,
                  ...recomputeLanguageStepStatus(
                    { ...current, languageSubRuns },
                    getLangsForStep(stepId, globalLanguages)
                  ),
                });
                return next;
              });
              runningLangStepsRef.current.delete(langPollKey(stepId, langId));
            } else {
              setStepStates((prev) => {
                const next = new Map(prev);
                const current = next.get(stepId);
                if (!current) return prev;
                const startTime =
                  current.startTime ??
                  (run.started_at ? new Date(run.started_at).getTime() : null);
                next.set(stepId, {
                  ...current,
                  status: run.status,
                  exitCode: run.exit_code,
                  endTime,
                  ...(startTime && !current.startTime ? { startTime } : {}),
                });
                stepStatesRef.current = next;
                return next;
              });
              runningStepsRef.current.delete(stepId);
            }
            stopPolling(stepId, subStepId, langId);
            savePipelineState();
          }
        } catch {
          // retry on next interval
        }
      };

      poll();
      pollRefs.current.set(key, setInterval(poll, 4000));
    },
    [updateStepState, stopPolling, savePipelineState, questionType, globalLanguages]
  );

  // Resume polling for any step that was running when state was loaded
  useEffect(() => {
    if (!stateLoading && pendingPollsRef.current.length > 0) {
      const pending = pendingPollsRef.current;
      pendingPollsRef.current = [];
      pending.forEach(({ runId, stepId, subStepId, langId }) =>
        startPolling(runId, stepId, subStepId, langId)
      );
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

  const runQuestionSubStep = useCallback(
    async (subStepId: QuestionSubStepId, refineNote?: string) => {
      const ctx = gqContext();
      const state = stepStatesRef.current.get("generate_question");
      if (!state || !canRunQuestionSubStep(subStepId, state, questionType, ctx)) return;

      // Re-running an upstream LLM sub-step invalidates everything downstream of
      // it (the function signature / description it was built from is changing).
      // Reset terminal dependents back to pending so they re-lock instead of
      // showing a stale "completed" against an outdated upstream (stale + re-gate).
      const TERMINAL: StepStatus[] = ["completed", "failed", "stopped"];
      const { subSteps: dependents, bruteForce } = getQuestionSubStepDependents(
        subStepId,
        questionType
      );
      for (const dep of dependents) {
        const depRun = stepStatesRef.current.get("generate_question")?.subStepRuns?.[dep];
        if (depRun && TERMINAL.includes(depRun.status)) {
          patchGqSubStepRun(dep, {
            status: "pending",
            exitCode: null,
            startTime: null,
            endTime: null,
            logs: [],
          });
        }
      }
      if (bruteForce) {
        const bf = stepStatesRef.current.get("generate_brute_force");
        if (bf && TERMINAL.includes(bf.status)) {
          updateStepState("generate_brute_force", {
            status: "pending",
            exitCode: null,
            startTime: null,
            endTime: null,
            logs: [],
          });
        }
      }

      if (subStepId === "titles" && !shouldRunTitlesLlm(ctx)) {
        patchGqSubStepRun("titles", {
          status: "skipped",
          exitCode: 0,
          startTime: Date.now(),
          endTime: Date.now(),
        });
        return;
      }

      const startTime = Date.now();
      patchGqSubStepRun(subStepId, {
        status: "running",
        logs: [],
        exitCode: null,
        startTime,
        endTime: null,
        activeRunId: null,
      });
      savePipelineState();

      const request: RunRequest = {
        stepId: "generate_question",
        mode,
        subSteps: [subStepId],
        languages: globalLanguages,
        problemId: currentProblemId || undefined,
        refineNote: refineNote?.trim() || undefined,
      };

      try {
        const data = await postPipelineRun(request);
        savePipelineState();
        if (data.runId) {
          patchGqSubStepRun(subStepId, { activeRunId: data.runId });
          startPolling(data.runId, "generate_question", subStepId);
          await awaitStatusSettled(
            () => stepStatesRef.current.get("generate_question")?.subStepRuns?.[subStepId]?.status
          );
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to start step";
        patchGqSubStepRun(subStepId, {
          status: "failed",
          exitCode: 1,
          endTime: Date.now(),
          logs: [{ stream: "stderr", line: message, ts: Date.now() }],
        });
        savePipelineState();
      }
    },
    [
      mode,
      globalLanguages,
      currentProblemId,
      questionType,
      patchGqSubStepRun,
      updateStepState,
      savePipelineState,
      startPolling,
      gqContext,
    ]
  );

  const runStepRef = useRef<(state: StepState) => Promise<void>>(async () => {});

  const runGenerateQuestionOrchestrator = useCallback(
    async (state: StepState) => {
      const ctx = gqContext();
      const waves = getQuestionSubStepWaves(questionType, state.enabledSubSteps);
      updateStepState("generate_question", {
        status: "running",
        startTime: Date.now(),
        endTime: null,
        exitCode: null,
      });

      for (const wave of waves) {
        const pending = wave.filter((id) => {
          if (id === "titles" && !shouldRunTitlesLlm(ctx)) return false;
          const run = stepStatesRef.current.get("generate_question")?.subStepRuns?.[id];
          return run?.status !== "completed";
        });
        const isCodeWave = wave.some((id) => id.startsWith("translate_"));
        const gqNow = stepStatesRef.current.get("generate_question");
        const bfState = stepStatesRef.current.get("generate_brute_force");
        const runBf =
          isCodeWave &&
          bfState &&
          bfState.status !== "completed" &&
          bfState.status !== "running" &&
          gqNow &&
          canRunBruteForce(gqNow, questionType);

        if (!pending.length && !runBf) continue;

        const tasks: Promise<void>[] = pending.map((id) => runQuestionSubStep(id));

        if (runBf && bfState) {
          tasks.push(runStepRef.current(bfState));
        }

        await Promise.all(tasks);

        const gq = stepStatesRef.current.get("generate_question");
        if (pending.some((id) => gq?.subStepRuns?.[id]?.status === "failed")) break;
      }

      const final = stepStatesRef.current.get("generate_question");
      if (final) {
        updateStepState("generate_question", recomputeGenerateQuestionStatus(final, questionType, ctx));
      }
      savePipelineState();
    },
    [questionType, runQuestionSubStep, updateStepState, savePipelineState, gqContext]
  );

  const runLanguageSubStep = useCallback(
    async (stepId: StepId, langId: string, refineNote?: string): Promise<void> => {
      const state = stepStatesRef.current.get(stepId);
      if (!state) return;

      const startTime = Date.now();
      patchLanguageSubRun(stepId, langId, {
        status: "running",
        logs: [],
        exitCode: null,
        startTime,
        endTime: null,
        activeRunId: null,
      });
      savePipelineState();

      const runKey = languageSubStepLogKey(stepId, langId);
      const request: RunRequest = {
        stepId,
        mode,
        subSteps: state.enabledSubSteps,
        languages: [langId],
        testcaseCount: globalTestcaseCount,
        problemId: currentProblemIdRef.current || undefined,
        runKey,
        refineNote: refineNote?.trim() || undefined,
      };

      try {
        const data = await postPipelineRun(request);
        savePipelineState();
        if (data.runId) {
          patchLanguageSubRun(stepId, langId, { activeRunId: data.runId });
          startPolling(data.runId, stepId, undefined, langId);
          await awaitStatusSettled(
            () => stepStatesRef.current.get(stepId)?.languageSubRuns?.[langId]?.status
          );
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to start step";
        patchLanguageSubRun(stepId, langId, {
          status: "failed",
          exitCode: 1,
          endTime: Date.now(),
          logs: [{ stream: "stderr", line: message, ts: Date.now() }],
        });
        savePipelineState();
      }
    },
    [mode, globalLanguages, globalTestcaseCount, patchLanguageSubRun, savePipelineState, startPolling]
  );

  const runParallelLanguageStep = useCallback(
    async (state: StepState) => {
      const langs = getLangsForStep(state.id, globalLanguages);
      const pending = langs.filter((lang) => state.languageSubRuns?.[lang]?.status !== "completed");
      if (pending.length === 0 && langs.every((lang) => state.languageSubRuns?.[lang]?.status === "completed")) {
        return;
      }

      const languageSubRuns = {
        ...(state.languageSubRuns ?? createEmptyLanguageSubRuns(langs)),
      };
      for (const lang of langs) {
        if (languageSubRuns[lang]?.status !== "completed") {
          languageSubRuns[lang] = {
            ...(languageSubRuns[lang] ?? createEmptySubStepRun()),
            status: "pending",
            logs: languageSubRuns[lang]?.logs ?? [],
            exitCode: null,
            startTime: languageSubRuns[lang]?.startTime ?? null,
            endTime: null,
          };
        }
      }
      updateStepState(state.id, {
        languageSubRuns,
        ...recomputeLanguageStepStatus({ ...state, languageSubRuns }, langs),
      });

      await Promise.all(
        langs
          .filter((lang) => languageSubRuns[lang]?.status !== "completed")
          .map((lang) => runLanguageSubStep(state.id, lang))
      );

      const final = stepStatesRef.current.get(state.id);
      if (final) {
        updateStepState(state.id, recomputeLanguageStepStatus(final, langs));
      }
      savePipelineState();
    },
    [globalLanguages, runLanguageSubStep, updateStepState, savePipelineState]
  );

  const runStep = useCallback(
    async (state: StepState, refineNote?: string) => {
      if (launchingStepsRef.current.has(state.id)) return;
      const live = stepStatesRef.current.get(state.id);
      if (live?.status === "running") return;

      if (state.id === "generate_question") {
        launchingStepsRef.current.add(state.id);
        try {
          await runGenerateQuestionOrchestrator(state);
        } finally {
          launchingStepsRef.current.delete(state.id);
        }
        return;
      }

      if (requiresOwnerTitle(state.id) && !ownerTitle.trim()) {
        const now = Date.now();
        updateStepState(state.id, {
          status: "failed",
          exitCode: 1,
          endTime: now,
          logs: [{ stream: "stderr", line: TITLE_REQUIRED_MSG, ts: now }],
        });
        savePipelineState();
        return;
      }

      if (PARALLEL_LANG_STEPS.includes(state.id)) {
        launchingStepsRef.current.add(state.id);
        try {
          await runParallelLanguageStep(state);
        } finally {
          launchingStepsRef.current.delete(state.id);
        }
        return;
      }

      launchingStepsRef.current.add(state.id);
      stopPolling(state.id);

      const startTime = Date.now();
      updateStepState(state.id, {
        status: "running",
        logs: [],
        exitCode: null,
        startTime,
        endTime: null,
        activeRunId: null,
      });
      savePipelineState();

      const isExecution =
        state.id === "execute_tests_function" || state.id === "execute_tests_nonfunction";
      const isLangStep =
        isExecution ||
        state.id === "split_code" ||
        state.id === "execute_editorial";
      const languages = isLangStep ? globalLanguages : globalLanguages;

      const request: RunRequest = {
        stepId: state.id,
        mode,
        subSteps: state.enabledSubSteps,
        languages,
        testcaseCount: globalTestcaseCount,
        problemId: currentProblemId || undefined,
        refineNote: refineNote?.trim() || undefined,
      };

      try {
        const data = await postPipelineRun(request);
        savePipelineState();

        if (data.runId) {
          runningStepsRef.current.set(state.id, data.runId);
          updateStepState(state.id, { activeRunId: data.runId });
          startPolling(data.runId, state.id);
          await awaitStatusSettled(() => stepStatesRef.current.get(state.id)?.status);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to start step";
        updateStepState(state.id, {
          status: "failed",
          exitCode: 1,
          endTime: Date.now(),
          logs: [{ stream: "stderr", line: message, ts: Date.now() }],
        });
        runningStepsRef.current.delete(state.id);
        savePipelineState();
      } finally {
        launchingStepsRef.current.delete(state.id);
      }
    },
    [
      mode,
      globalLanguages,
      globalTestcaseCount,
      currentProblemId,
      updateStepState,
      savePipelineState,
      startPolling,
      stopPolling,
      runGenerateQuestionOrchestrator,
      runParallelLanguageStep,
      ownerTitle,
    ]
  );

  runStepRef.current = runStep;

  const stopQuestionSubStep = useCallback(
    async (subStepId: QuestionSubStepId) => {
      const runId = runningSubStepsRef.current.get(subStepId);
      if (!runId) {
        // No registered run yet (clicked during the launch window). Reset the
        // sub-step to a runnable state instead of leaving a dead button (P1-H4).
        patchGqSubStepRun(subStepId, { status: "pending", exitCode: null, endTime: null });
        runningSubStepsRef.current.delete(subStepId);
        stopPolling("generate_question", subStepId);
        savePipelineState();
        return;
      }
      // Show "Stopping…" immediately (P1-H3).
      patchGqSubStepRun(subStepId, { status: "stopping" });
      try {
        await fetch("/api/pipeline/run/stop", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ runId }),
        });
      } catch {
        // ignore
      }
      // Then "Stopped", and revert to "pending" after the cooldown.
      patchGqSubStepRun(subStepId, { status: "stopped", exitCode: -1, endTime: Date.now() });
      runningSubStepsRef.current.delete(subStepId);
      stopPolling("generate_question", subStepId);
      savePipelineState();

      const timerKey = `gq__${subStepId}`;
      const existing = stopRevertTimersRef.current.get(timerKey);
      if (existing) clearTimeout(existing);
      stopRevertTimersRef.current.set(
        timerKey,
        setTimeout(() => {
          stopRevertTimersRef.current.delete(timerKey);
          const run = stepStatesRef.current.get("generate_question")?.subStepRuns?.[subStepId];
          if (run?.status === "stopped") {
            patchGqSubStepRun(subStepId, { status: "pending", exitCode: null, endTime: null });
            savePipelineState();
          }
        }, STOP_REVERT_MS)
      );
    },
    [patchGqSubStepRun, stopPolling, savePipelineState]
  );

  const stopLanguageSubStep = useCallback(
    async (stepId: StepId, langId: string) => {
      const runId = runningLangStepsRef.current.get(langPollKey(stepId, langId));
      if (!runId) {
        // No registered run yet (launch window). Reset this language sub-run to
        // pending so its tile returns to a runnable state (P1-H4).
        const state = stepStatesRef.current.get(stepId);
        if (state) {
          const languageSubRuns = { ...(state.languageSubRuns ?? {}) };
          languageSubRuns[langId] = {
            ...(languageSubRuns[langId] ?? createEmptySubStepRun()),
            status: "pending",
            exitCode: null,
            endTime: null,
          };
          updateStepState(stepId, {
            languageSubRuns,
            ...recomputeLanguageStepStatus({ ...state, languageSubRuns }, getLangsForStep(stepId, globalLanguages)),
          });
        }
        runningLangStepsRef.current.delete(langPollKey(stepId, langId));
        stopPolling(stepId, undefined, langId);
        savePipelineState();
        return;
      }
      const setLangStatus = (st: StepStatus, extra?: Partial<SubStepRunState>) => {
        const state = stepStatesRef.current.get(stepId);
        if (!state) return;
        const languageSubRuns = { ...(state.languageSubRuns ?? {}) };
        languageSubRuns[langId] = {
          ...(languageSubRuns[langId] ?? createEmptySubStepRun()),
          status: st,
          ...extra,
        };
        updateStepState(stepId, {
          languageSubRuns,
          ...recomputeLanguageStepStatus({ ...state, languageSubRuns }, getLangsForStep(stepId, globalLanguages)),
        });
      };

      setLangStatus("stopping"); // immediate feedback (P1-H3)
      try {
        await fetch("/api/pipeline/run/stop", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ runId }),
        });
      } catch {
        // ignore
      }
      setLangStatus("stopped", { exitCode: -1, endTime: Date.now() });
      runningLangStepsRef.current.delete(langPollKey(stepId, langId));
      stopPolling(stepId, undefined, langId);
      savePipelineState();

      const timerKey = `${stepId}__lang__${langId}`;
      const existing = stopRevertTimersRef.current.get(timerKey);
      if (existing) clearTimeout(existing);
      stopRevertTimersRef.current.set(
        timerKey,
        setTimeout(() => {
          stopRevertTimersRef.current.delete(timerKey);
          const run = stepStatesRef.current.get(stepId)?.languageSubRuns?.[langId];
          if (run?.status === "stopped") {
            setLangStatus("pending", { exitCode: null, endTime: null });
            savePipelineState();
          }
        }, STOP_REVERT_MS)
      );
    },
    [updateStepState, stopPolling, savePipelineState, globalLanguages]
  );

  const stopStep = useCallback(async (stepId: StepId) => {
    if (stepId === "generate_question") {
      const gq = stepStatesRef.current.get("generate_question");
      const running = Object.entries(gq?.subStepRuns ?? {})
        .filter(([, run]) => run?.status === "running")
        .map(([id]) => id as QuestionSubStepId);
      await Promise.all(running.map((id) => stopQuestionSubStep(id)));
      return;
    }

    if (PARALLEL_LANG_STEPS.includes(stepId)) {
      const state = stepStatesRef.current.get(stepId);
      const running = Object.entries(state?.languageSubRuns ?? {})
        .filter(([, run]) => run?.status === "running")
        .map(([lang]) => lang);
      await Promise.all(running.map((lang) => stopLanguageSubStep(stepId, lang)));
      return;
    }

    const runId = runningStepsRef.current.get(stepId);
    if (!runId) {
      // Stop clicked during the launch window before the run id was registered.
      // Reset to a runnable state and clear the launching guard so the button
      // works instead of appearing dead (P1-H4).
      launchingStepsRef.current.delete(stepId);
      runningStepsRef.current.delete(stepId);
      updateStepState(stepId, { status: "pending", exitCode: null, endTime: null });
      stopPolling(stepId);
      savePipelineState();
      return;
    }

    // Immediate "Stopping…" feedback (P1-H3).
    updateStepState(stepId, { status: "stopping" });

    try {
      await fetch("/api/pipeline/run/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId }),
      });
    } catch {
      // Stop request failed — process may have already exited
    }

    // Then "Stopped"; revert to "pending" after the cooldown so Run returns.
    // Only this step is stopped; queued independent siblings keep running.
    updateStepState(stepId, { status: "stopped", exitCode: -1, endTime: Date.now() });
    runningStepsRef.current.delete(stepId);
    stopPolling(stepId);
    savePipelineState();

    const existing = stopRevertTimersRef.current.get(stepId);
    if (existing) clearTimeout(existing);
    stopRevertTimersRef.current.set(
      stepId,
      setTimeout(() => {
        stopRevertTimersRef.current.delete(stepId);
        if (stepStatesRef.current.get(stepId)?.status === "stopped") {
          updateStepState(stepId, { status: "pending", exitCode: null, endTime: null });
          savePipelineState();
        }
      }, STOP_REVERT_MS)
    );
  }, [updateStepState, stopPolling, savePipelineState, stopQuestionSubStep, stopLanguageSubStep]);

  const getSubStepStatus = useCallback(
    (subStepId: QuestionSubStepId) => {
      const gq = stepStates.get("generate_question");
      return getSubStepDisplayStatus(subStepId, gq?.subStepRuns?.[subStepId], gqContext());
    },
    [stepStates, gqContext]
  );

  const isAnyRunning =
    Array.from(stepStates.values()).some((s) => {
      if (isActiveStatus(s.status)) return true;
      if (s.subStepRuns) {
        return Object.values(s.subStepRuns).some((r) => r && isActiveStatus(r.status));
      }
      if (s.languageSubRuns) {
        return Object.values(s.languageSubRuns).some((r) => r && isActiveStatus(r.status));
      }
      return false;
    });
  const isRunAllActive = runAllQueue.length > 0;

  // Run All: queue every not-yet-completed step from the current workflow.
  // The auto-run effect drives execution, launching each step as soon as its
  // real prerequisite is met — so independent siblings (editorial / JSON) run
  // concurrently instead of one-at-a-time.
  const runAll = useCallback(() => {
    const steps = getPipelineUiWorkflowSteps(questionType, mode);
    const incomplete = steps.filter((id) => {
      const state = stepStates.get(id);
      return !!state && state.status !== "completed";
    });
    // Packaging steps need a title. Without one, they and their editorial
    // dependents are marked "skipped" (visible in the UI, reason in the log)
    // instead of silently dropped — dropping only the packaging steps used to
    // leave the dependents queued forever behind a prerequisite that never ran.
    const gated = ownerTitle.trim() ? new Set<StepId>() : titleGatedSteps(incomplete);
    if (gated.size > 0) {
      const now = Date.now();
      for (const id of gated) updateStepState(id, titleSkipPatch(id, now));
      savePipelineState();
    }
    const remaining = incomplete.filter((id) => !gated.has(id));
    if (remaining.length === 0) return;
    setRunAllQueue(remaining);
  }, [questionType, mode, stepStates, ownerTitle, updateStepState, savePipelineState]);

  const cancelRunAll = useCallback(() => {
    setRunAllQueue([]);
  }, []);

  // Steps that are stale because an upstream data-dependency re-ran after them.
  const affectedStepIds = useMemo(
    () => computeAffectedSteps(stepStates, getAllTrackedStepIds(questionType, mode)),
    [stepStates, questionType, mode]
  );

  // Reset the given steps to pending and queue them so the run-all driver
  // re-runs them in dependency order (a dependent waits for its re-running
  // prerequisite instead of consuming the prerequisite's old output).
  const rerunStepSet = useCallback(
    (ids: Set<StepId>) => {
      if (ids.size === 0) return;
      const order = getPipelineUiWorkflowSteps(questionType, mode);
      // Title-gated steps can't re-run without a title: mark them visibly
      // skipped (reason in the log) instead of resetting them to pending and
      // silently leaving them out of the queue.
      const gated = ownerTitle.trim()
        ? new Set<StepId>()
        : titleGatedSteps(order.filter((id) => ids.has(id)));
      for (const id of ids) {
        const cur = stepStatesRef.current.get(id);
        if (!cur) continue;
        if (gated.has(id)) {
          updateStepState(id, titleSkipPatch(id, Date.now()));
          continue;
        }
        const reset: Partial<StepState> = {
          status: "pending",
          exitCode: null,
          startTime: null,
          endTime: null,
          logs: [],
        };
        if (cur.languageSubRuns && Object.keys(cur.languageSubRuns).length > 0) {
          const languageSubRuns: Record<string, SubStepRunState> = {};
          for (const [lang, run] of Object.entries(cur.languageSubRuns)) {
            languageSubRuns[lang] = {
              ...run,
              status: "pending",
              exitCode: null,
              startTime: null,
              endTime: null,
              logs: [],
            };
          }
          reset.languageSubRuns = languageSubRuns;
        }
        updateStepState(id, reset);
      }
      savePipelineState();

      if (ids.has("generate_brute_force")) {
        const bf = stepStatesRef.current.get("generate_brute_force");
        if (bf) runStepRef.current({ ...bf, status: "pending" });
      }
      const queue = order.filter((id) => ids.has(id) && !gated.has(id));
      if (queue.length) setRunAllQueue(queue);
    },
    [questionType, mode, ownerTitle, updateStepState, savePipelineState]
  );

  // Re-run ALL affected (stale) steps.
  const runAffected = useCallback(() => {
    const tracked = getAllTrackedStepIds(questionType, mode);
    rerunStepSet(computeAffectedSteps(stepStatesRef.current, tracked));
  }, [questionType, mode, rerunStepSet]);

  // Re-run a user-selected subset (only those that are genuinely affected).
  const runAffectedSelected = useCallback(
    (ids: StepId[]) => {
      const tracked = getAllTrackedStepIds(questionType, mode);
      const affected = computeAffectedSteps(stepStatesRef.current, tracked);
      rerunStepSet(new Set(ids.filter((id) => affected.has(id))));
    },
    [questionType, mode, rerunStepSet]
  );


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

    const gqState = stepStates.get("generate_question");
    const questionPhaseComplete = isQuestionPhaseComplete(gqState, questionType, gqContext());

    for (const id of runAllQueue) {
      const state = stepStates.get(id);
      // Drop steps that are done or already executing.
      if (!state || state.status === "completed" || state.status === "running") {
        continue;
      }
      // Non-blocking steps (e.g. Strengthen Test Cases) are best-effort: once
      // they've failed, drop them from the queue instead of retrying, so Run All
      // continues to the next steps rather than looping on the failure.
      if (state.status === "failed" && getStepConfig(id).nonBlocking) {
        continue;
      }
      if (launchingStepsRef.current.has(id)) {
        remaining.push(id);
        alive.add(id);
        continue;
      }

      if (
        !isStepReadyForRunAll(id, steps, stepStates, questionPhaseComplete)
      ) {
        const blocking = getIncompletePrerequisites(
          id,
          steps,
          stepStates,
          questionPhaseComplete
        );
        // Only DROP a queued step if a prerequisite has terminally failed/stopped
        // and is NOT being retried. A prerequisite that is merely transitioning
        // (running -> completed, or its status briefly lagging the wave) must keep
        // the step queued — previously, that transient window dropped the whole
        // downstream chain and stalled Run All between phases (GQ->testcases,
        // execute->package, ...).
        const anyBlockingDead = blocking.some((b) => {
          const st = stepStates.get(b)?.status;
          const beingRetried =
            alive.has(b) || launchingStepsRef.current.has(b) || st === "running";
          return (st === "failed" || st === "stopped" || st === "skipped") && !beingRetried;
        });
        if (!anyBlockingDead) {
          remaining.push(id);
          alive.add(id);
        }
        continue;
      }

      toRun.push(state);
      alive.add(id);
    }

    if (toRun.length > 0 || remaining.length !== runAllQueue.length) {
      setRunAllQueue(remaining);
      toRun.forEach((s) => runStep(s));
    }
  }, [runAllQueue, stepStates, questionType, mode, runStep, gqContext]);

  return (
    <PipelineContext.Provider
      value={{
        questionType,
        mode,
        globalLanguages,
        globalTestcaseCount,
        ownerTitle,
        ownerDifficulty,
        generateTitleWithAi,
        defaultTagNames,
        stepStates,
        isAnyRunning,
        currentProblemId,
        stateLoading,
        setQuestionType,
        setMode,
        setGlobalLanguages,
        setGlobalTestcaseCount,
        setOwnerTitle,
        setGenerateTitleWithAi,
        setDefaultTagNames,
        saveOwnerTitle,
        updateStepState,
        runStep,
        runLanguageSubStep,
        runQuestionSubStep,
        stopStep,
        stopLanguageSubStep,
        stopQuestionSubStep,
        getSubStepStatus,
        runAll,
        cancelRunAll,
        isRunAllActive,
        affectedStepIds,
        runAffected,
        runAffectedSelected,
        setCurrentProblemId,
        loadProblemState,
        savePipelineState,
        legacyPipelineNotice,
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
