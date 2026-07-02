import type { StepStatus } from "@/types/pipeline";

/** First title line from `Outputs/generated_titles.txt` (matches Python parsing). */
export function parseGeneratedTitleFirstLine(content: string): string {
  const firstLine = content.split("\n").find((l) => l.trim())?.trim() ?? "";
  if (!firstLine) return "";
  return firstLine.replace(/^-\s*/, "").split("-")[0].trim();
}

export function getTitlesSubStepStatus(
  subStepRuns: Record<string, { status?: StepStatus }> | undefined
): StepStatus | undefined {
  return subStepRuns?.titles?.status;
}

/** True when packaging may use a manual title or a completed AI titles step. */
export function hasTitleForPackaging(params: {
  ownerTitle: string;
  generateTitleWithAi: boolean;
  titlesSubStepStatus?: StepStatus;
}): boolean {
  if (params.ownerTitle.trim()) return true;
  if (!params.generateTitleWithAi) return false;
  return params.titlesSubStepStatus === "completed";
}

/**
 * Whether packaging should stay unblocked while queuing runs (Run all / re-run).
 * Also true when GQ — including the Titles sub-step — is still queued ahead of packaging.
 */
export function packagingTitleResolvable(params: {
  ownerTitle: string;
  generateTitleWithAi: boolean;
  titlesSubStepStatus?: StepStatus;
  generateQuestionStillQueued: boolean;
}): boolean {
  if (hasTitleForPackaging(params)) return true;
  return params.generateTitleWithAi && params.generateQuestionStillQueued;
}
