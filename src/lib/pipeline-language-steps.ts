import { LANGUAGES } from "@/lib/pipeline-config";
import type { QuestionSubStepId, StepId, StepState, SubStepRunState } from "@/types/pipeline";

const LANG_TO_TRANSLATE: Record<string, QuestionSubStepId> = {
  cpp: "translate_cpp",
  java: "translate_java",
  nodejs: "translate_nodejs",
};

const TRANSLATE_TO_LANG: Partial<Record<QuestionSubStepId, string>> = {
  translate_cpp: "cpp",
  translate_java: "java",
  translate_nodejs: "nodejs",
};

export const LANG_LABELS: Record<string, string> = {
  python: "Python",
  cpp: "C++",
  java: "Java",
  nodejs: "Node.js",
};

export const PARALLEL_LANG_STEPS: StepId[] = [
  "split_code",
  "execute_tests_function",
  "execute_tests_nonfunction",
];

/** Languages translated from Python reference (excludes python). */
export function getPipelineTargetLanguages(enabledLanguages: string[]): string[] {
  return enabledLanguages.filter((id) => id !== "python");
}

export function getTranslateSubStepsForLanguages(enabledLanguages: string[]): QuestionSubStepId[] {
  return getPipelineTargetLanguages(enabledLanguages)
    .map((lang) => LANG_TO_TRANSLATE[lang])
    .filter((id): id is QuestionSubStepId => Boolean(id));
}

export function getSplitSubStepsForLanguages(enabledLanguages: string[]): string[] {
  // Python is the reference solution but still needs driver/solution split for execution.
  return enabledLanguages.includes("python")
    ? enabledLanguages
    : ["python", ...enabledLanguages];
}

export function getExecuteSubStepsForLanguages(enabledLanguages: string[]): string[] {
  return enabledLanguages.includes("python")
    ? enabledLanguages
    : ["python", ...enabledLanguages];
}

export function getLangsForStep(stepId: StepId, enabledLanguages: string[]): string[] {
  if (stepId === "split_code") return getSplitSubStepsForLanguages(enabledLanguages);
  if (stepId === "execute_tests_function" || stepId === "execute_tests_nonfunction") {
    return getExecuteSubStepsForLanguages(enabledLanguages);
  }
  return enabledLanguages;
}

export function languageSubStepLogKey(stepId: string, langId: string): string {
  return `${stepId}__${langId}`;
}

export function langStepLabel(stepId: StepId, langId: string): string {
  const lang = LANG_LABELS[langId] ?? langId;
  if (stepId === "split_code") return `Split ${lang}`;
  if (stepId === "execute_tests_function" || stepId === "execute_tests_nonfunction") {
    return `Execute ${lang}`;
  }
  return `${stepId} (${lang})`;
}

export function translateSubStepToLang(subStepId: QuestionSubStepId): string | null {
  return TRANSLATE_TO_LANG[subStepId] ?? null;
}

export function filterLanguagesForCommand(
  stepId: string,
  languages: string[],
  globalLanguages: string[]
): string[] {
  const enabled = new Set(globalLanguages);
  const filtered = languages.filter((l) => enabled.has(l));
  if (filtered.length > 0) return filtered;

  if (stepId === "split_code" || stepId.startsWith("execute_tests")) {
    if (stepId === "split_code") {
      return getSplitSubStepsForLanguages(globalLanguages);
    }
    return getExecuteSubStepsForLanguages(globalLanguages);
  }
  return getPipelineTargetLanguages(globalLanguages);
}

export function createEmptyLanguageSubRuns(langs: string[]): Record<string, SubStepRunState> {
  const runs: Record<string, SubStepRunState> = {};
  for (const lang of langs) {
    runs[lang] = {
      status: "pending",
      logs: [],
      exitCode: null,
      startTime: null,
      endTime: null,
    };
  }
  return runs;
}

export function recomputeLanguageStepStatus(
  state: StepState,
  enabledLangs: string[]
): Pick<StepState, "status" | "startTime" | "endTime" | "exitCode"> {
  const runs = state.languageSubRuns ?? {};
  const required = enabledLangs.filter((l) => l in runs || enabledLangs.includes(l));
  if (required.length === 0) {
    return { status: "pending", startTime: null, endTime: null, exitCode: null };
  }

  const statuses = required.map((lang) => runs[lang]?.status ?? "pending");

  if (statuses.every((s) => s === "completed" || s === "skipped")) {
    const ends = required.map((l) => runs[l]?.endTime).filter((t): t is number => t != null);
    const starts = required.map((l) => runs[l]?.startTime).filter((t): t is number => t != null);
    return {
      status: "completed",
      startTime: starts.length ? Math.min(...starts) : state.startTime,
      // Reuse the stored end time when child end times are absent so the
      // displayed duration stays stable across recomputes (P1-M4 / timer bug #1).
      endTime: ends.length ? Math.max(...ends) : state.endTime ?? Date.now(),
      exitCode: 0,
    };
  }
  if (statuses.some((s) => s === "failed")) {
    const starts = required.map((l) => runs[l]?.startTime).filter((t): t is number => t != null);
    const ends = required.map((l) => runs[l]?.endTime).filter((t): t is number => t != null);
    return {
      status: "failed",
      exitCode: 1,
      startTime: starts.length ? Math.min(...starts) : state.startTime,
      endTime: ends.length ? Math.max(...ends) : state.endTime ?? Date.now(),
    };
  }
  if (statuses.some((s) => s === "running")) {
    const starts = required.map((l) => runs[l]?.startTime).filter((t): t is number => t != null);
    return {
      status: "running",
      startTime: starts.length ? Math.min(...starts) : state.startTime ?? Date.now(),
      endTime: null,
      exitCode: null,
    };
  }
  return { status: "pending", startTime: null, endTime: null, exitCode: null };
}

export { LANGUAGES };
