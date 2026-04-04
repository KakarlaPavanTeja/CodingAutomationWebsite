export type StepId =
  | "generate_question"
  | "generate_testcases"
  | "split_code"
  | "execute_tests_function"
  | "execute_tests_nonfunction"
  | "generate_enrichment"
  | "package_platform";

export type StepStatus = "pending" | "running" | "completed" | "failed";

export type QuestionType = "function" | "nonfunction";

export type PipelineMode = "practice" | "exam";

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
}

export interface OutputFile {
  path: string;
  name: string;
  size: number;
  modifiedAt: string;
  isDirectory: boolean;
}
