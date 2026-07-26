export type StepId =
  | "generate_question"
  | "generate_brute_force"
  | "generate_testcases"
  | "generate_wrong_solutions"
  | "select_testcases"
  | "benchmark_testcases"
  | "split_code"
  | "execute_tests_function"
  | "execute_tests_nonfunction"
  | "generate_enrichment"
  | "package_platform"
  | "generate_editorial"
  | "execute_editorial"
  | "prepare_platform_json";

/** Sub-operations inside the Generate Question step (run in parallel where possible). */
export type QuestionSubStepId =
  | "description"
  | "naming"
  | "titles"
  | "difficulty"
  | "topics"
  | "translate_cpp"
  | "translate_java"
  | "translate_nodejs";

export type StepStatus =
  | "pending"
  | "running"
  | "stopping"
  | "stopped"
  | "completed"
  | "failed"
  | "skipped";

export type QuestionType = "function" | "nonfunction";

export type PipelineMode = "practice" | "exam";

export type LlmUsage = "llm" | "none" | "conditional";

export interface SubStep {
  id: string;
  label: string;
  description: string;
  defaultEnabled: boolean;
  /** Hidden for non-function problems */
  functionOnly?: boolean;
}

export interface LanguageOption {
  id: string;
  label: string;
  defaultEnabled: boolean;
}

export interface PipelineStepConfig {
  id: StepId;
  label: string;
  description: string;
  script: string;
  subSteps: SubStep[];
  hasLanguageSelector: boolean;
  hasTestcaseCount: boolean;
  needsMode: boolean;
  llmUsage: LlmUsage;
  prerequisite?: StepId;
  /**
   * When true, this step never gates downstream steps: it's treated as
   * satisfied for prerequisite/unlock checks regardless of its own status, and
   * a failure is surfaced as a warning rather than a hard error.
   */
  nonBlocking?: boolean;
}

export interface SubStepRunState {
  status: StepStatus;
  logs: LogLine[];
  exitCode: number | null;
  startTime: number | null;
  endTime: number | null;
  /** DB run id for the current/last execution — scopes log fetches on rerun. */
  activeRunId?: string | null;
}

export interface StepState {
  id: StepId;
  status: StepStatus;
  logs: LogLine[];
  exitCode: number | null;
  startTime: number | null;
  endTime: number | null;
  enabledSubSteps: string[];
  enabledLanguages: string[];
  testcaseCount: number;
  /** Per-sub-step run state for `generate_question` */
  subStepRuns?: Partial<Record<QuestionSubStepId, SubStepRunState>>;
  /** Per-language run state for split/execute steps */
  languageSubRuns?: Record<string, SubStepRunState>;
  /** DB run id for the current/last execution — scopes log fetches on rerun. */
  activeRunId?: string | null;
}

export interface LogLine {
  stream: "stdout" | "stderr";
  line: string;
  ts: number;
}

export interface GlobalPipelineConfig {
  ownerTitle: string;
  generateTitleWithAi: boolean;
  defaultTagNames: string;
}

export const GLOBAL_CONFIG_KEY = "__global__";

export interface RunRequest {
  stepId: StepId;
  mode: PipelineMode;
  subSteps: string[];
  languages: string[];
  testcaseCount?: number;
  problemId?: string;
  /** Override log file key (e.g. split_code__cpp) for per-language runs */
  runKey?: string;
  /**
   * Free-text instruction from the reviewer to fold into the LLM prompt when
   * re-running a completed LLM step ("make the story shorter", "rename to X").
   * Reaches the Python script via the PIPELINE_REFINE_NOTE env var.
   */
  refineNote?: string;
}

export interface OutputFile {
  path: string;
  name: string;
  size: number;
  modifiedAt: string;
  isDirectory: boolean;
}

export interface StepLlmUsageStats {
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  models: string[];
  callCount: number;
}
