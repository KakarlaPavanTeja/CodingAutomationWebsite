import { getStepConfig } from "@/lib/pipeline-config";
import type { StepId, StepStatus } from "@/types/pipeline";

export function requiresOwnerTitle(stepId: StepId): boolean {
  return stepId === "package_platform" || stepId === "prepare_platform_json";
}

export const TITLE_REQUIRED_MSG =
  'This step needs a problem title. Enter one in "Pipeline settings" and Save, or enable "Generate title with AI" and complete the Titles step, then re-run.';
export const TITLE_PREREQ_MSG =
  'Skipped: depends on "Package for Platform", which was skipped because no problem title is set.';

/**
 * Which of `candidates` (in workflow order) cannot run without an owner title:
 * the packaging steps themselves, plus every step whose explicit prerequisite
 * chain reaches one of them within this candidate set (the editorial steps).
 */
export function titleGatedSteps(candidates: StepId[]): Set<StepId> {
  const gated = new Set<StepId>();
  for (const id of candidates) {
    const prereq = getStepConfig(id).prerequisite;
    if (requiresOwnerTitle(id) || (prereq && gated.has(prereq))) gated.add(id);
  }
  return gated;
}

/** The reason a title-gated step was skipped, for its log line. */
export function titleSkipReason(stepId: StepId): string {
  return requiresOwnerTitle(stepId) ? `Skipped: ${TITLE_REQUIRED_MSG}` : TITLE_PREREQ_MSG;
}

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
