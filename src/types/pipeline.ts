export type StepId =
  | "generate_question"
  | "generate_brute_force"
  | "generate_testcases"
  | "benchmark_testcases"
  | "harden_testcases"
  | "split_code"
  | "execute_tests_function"
  | "execute_tests_nonfunction"
  | "generate_enrichment"
  | "package_platform"
  | "generate_editorial"
  | "execute_editorial"
  | "prepare_platform_json";

export type StepStatus = "pending" | "running" | "completed" | "failed";

export type QuestionType = "function" | "nonfunction";

export type PipelineMode = "practice" | "exam";

/**
 * Whether a step calls the LLM:
 *  - "llm"         → always makes one or more LLM calls
 *  - "none"        → pure local execution, never calls the LLM
 *  - "conditional" → only calls the LLM under certain conditions
 */
export type LlmUsage = "llm" | "none" | "conditional";

export interface SubStep {
  id: string;
  label: string;
  description: string;
  defaultEnabled: boolean;
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
  /** Whether the step calls the LLM (always / never / conditionally). */
  llmUsage: LlmUsage;
  /**
   * Explicit prerequisite step. When set, this step becomes runnable as soon as
   * the named step completes, instead of depending on the immediately-previous
   * step in the workflow array. Used to make sibling terminal steps (editorial
   * and JSON) independent off `package_platform`.
   */
  prerequisite?: StepId;
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
}

export interface LogLine {
  stream: "stdout" | "stderr";
  line: string;
  ts: number;
}

export interface RunRequest {
  stepId: StepId;
  mode: PipelineMode;
  subSteps: string[];
  languages: string[];
  testcaseCount?: number;
  problemId?: string;
}

export interface OutputFile {
  path: string;
  name: string;
  size: number;
  modifiedAt: string;
  isDirectory: boolean;
}
