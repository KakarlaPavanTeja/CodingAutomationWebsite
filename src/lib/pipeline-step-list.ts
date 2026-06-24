import { getStepConfig } from "@/lib/pipeline-config";
import { languageSubStepLogKey } from "@/lib/pipeline-language-steps";
import { subStepLogKey } from "@/lib/pipeline-question";
import type { PipelineSection } from "@/lib/pipeline-waves";
import type {
  LlmUsage,
  QuestionSubStepId,
  StepId,
  StepLlmUsageStats,
  StepState,
  StepStatus,
  SubStepRunState,
} from "@/types/pipeline";
import { durationFromRunState } from "@/lib/pipeline-duration";
import type { PipelineWaveItem } from "@/lib/pipeline-waves";

export type PipelineStepUsageMap = Partial<Record<string, StepLlmUsageStats>>;

export function usageKeyForPipelineItem(item: PipelineWaveItem): string {
  if (item.kind === "sub") return subStepLogKey(item.id as QuestionSubStepId);
  if (item.kind === "lang" && item.parentStepId && item.langId) {
    return languageSubStepLogKey(item.parentStepId, item.langId);
  }
  return item.id as StepId;
}

export function lookupStepUsage(
  stepUsage: PipelineStepUsageMap,
  usageKey: string
): StepLlmUsageStats | undefined {
  return stepUsage[usageKey];
}

export type PipelineStepKey =
  | { kind: "sub"; id: QuestionSubStepId }
  | { kind: "step"; id: StepId }
  | { kind: "lang"; stepId: StepId; langId: string };

export interface PipelineStepListEntry {
  key: PipelineStepKey;
  keyStr: string;
  label: string;
  description: string | null;
  sectionId: string;
  sectionTitle: string;
  waveId: string;
  waveTitle: string;
  waveSubtitle: string;
  status: StepStatus;
  durationSec: number | null;
  llmUsage: LlmUsage;
  costUsd: number | null;
  callCount: number | null;
  logStepId: string;
  parentStepId: StepId;
  langId?: string;
  disabled?: boolean;
}

export function stepKeyStr(key: PipelineStepKey): string {
  if (key.kind === "sub") return `sub:${key.id}`;
  if (key.kind === "lang") return `lang:${key.stepId}:${key.langId}`;
  return `step:${key.id}`;
}

export function parseStepKeyStr(keyStr: string): PipelineStepKey | null {
  if (keyStr.startsWith("sub:")) return { kind: "sub", id: keyStr.slice(4) as QuestionSubStepId };
  if (keyStr.startsWith("lang:")) {
    const rest = keyStr.slice(5);
    const colon = rest.indexOf(":");
    if (colon <= 0) return null;
    return { kind: "lang", stepId: rest.slice(0, colon) as StepId, langId: rest.slice(colon + 1) };
  }
  if (keyStr.startsWith("step:")) return { kind: "step", id: keyStr.slice(5) as StepId };
  return null;
}

function durationFromRun(
  run: SubStepRunState | undefined,
  status: StepStatus
): number | null {
  return durationFromRunState(run, status);
}

export function buildPipelineStepList(
  sections: PipelineSection[],
  stepStates: Map<StepId, StepState>,
  stepUsage: PipelineStepUsageMap,
  getSubStatus: (id: QuestionSubStepId) => StepStatus
): PipelineStepListEntry[] {
  const gqConfig = getStepConfig("generate_question");
  const entries: PipelineStepListEntry[] = [];

  for (const section of sections) {
    for (const wave of section.waves) {
      for (const item of wave.items) {
        if (item.kind === "sub") {
          const subId = item.id as QuestionSubStepId;
          const gq = stepStates.get("generate_question");
          const run = gq?.subStepRuns?.[subId];
          const status = getSubStatus(subId);
          const subConfig = gqConfig.subSteps.find((s) => s.id === subId);
          const logStepId = subStepLogKey(subId);
          const usage = lookupStepUsage(stepUsage, logStepId);
          entries.push({
            key: { kind: "sub", id: subId },
            keyStr: stepKeyStr({ kind: "sub", id: subId }),
            label: item.label,
            description: item.description ?? subConfig?.description ?? null,
            sectionId: section.id,
            sectionTitle: section.title,
            waveId: wave.id,
            waveTitle: wave.title,
            waveSubtitle: wave.subtitle,
            status,
            durationSec: durationFromRun(run, status),
            llmUsage: gqConfig.llmUsage,
            costUsd: usage?.costUsd ?? null,
            callCount: usage?.callCount ?? null,
            logStepId,
            parentStepId: "generate_question",
            disabled: item.enabledInConfig === false,
          });
        } else if (item.kind === "lang" && item.langId && item.parentStepId) {
          const stepId = item.parentStepId;
          const langId = item.langId;
          const state = stepStates.get(stepId);
          const run = state?.languageSubRuns?.[langId];
          const status = run?.status ?? "pending";
          const config = getStepConfig(stepId);
          const logStepId = languageSubStepLogKey(stepId, langId);
          const usage = lookupStepUsage(stepUsage, logStepId);
          entries.push({
            key: { kind: "lang", stepId, langId },
            keyStr: stepKeyStr({ kind: "lang", stepId, langId }),
            label: item.label,
            description: item.description ?? config.description ?? null,
            sectionId: section.id,
            sectionTitle: section.title,
            waveId: wave.id,
            waveTitle: wave.title,
            waveSubtitle: wave.subtitle,
            status,
            durationSec: durationFromRun(run, status),
            llmUsage: config.llmUsage,
            costUsd: usage?.costUsd ?? null,
            callCount: usage?.callCount ?? null,
            logStepId,
            parentStepId: stepId,
            langId,
          });
        } else {
          const stepId = item.id as StepId;
          const state = stepStates.get(stepId);
          const config = getStepConfig(stepId);
          const status = state?.status ?? "pending";
          const usage = lookupStepUsage(stepUsage, stepId);
          entries.push({
            key: { kind: "step", id: stepId },
            keyStr: stepKeyStr({ kind: "step", id: stepId }),
            label: item.label,
            description: item.description ?? config.description ?? null,
            sectionId: section.id,
            sectionTitle: section.title,
            waveId: wave.id,
            waveTitle: wave.title,
            waveSubtitle: wave.subtitle,
            status,
            durationSec: state
              ? durationFromRunState(
                  {
                    status: state.status,
                    logs: state.logs,
                    exitCode: state.exitCode,
                    startTime: state.startTime,
                    endTime: state.endTime,
                  },
                  status
                )
              : null,
            llmUsage: config.llmUsage,
            costUsd: usage?.costUsd ?? null,
            callCount: usage?.callCount ?? null,
            logStepId: stepId,
            parentStepId: stepId,
          });
        }
      }
    }
  }

  return entries;
}

export interface PipelineStepGroup {
  id: string;
  sectionId: string;
  sectionTitle: string;
  waveTitle: string;
  waveSubtitle: string;
  entries: PipelineStepListEntry[];
}

export function groupPipelineSteps(entries: PipelineStepListEntry[]): PipelineStepGroup[] {
  const groups: PipelineStepGroup[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    if (seen.has(entry.waveId)) continue;
    seen.add(entry.waveId);
    groups.push({
      id: entry.waveId,
      sectionId: entry.sectionId,
      sectionTitle: entry.sectionTitle,
      waveTitle: entry.waveTitle,
      waveSubtitle: entry.waveSubtitle,
      entries: entries.filter((e) => e.waveId === entry.waveId),
    });
  }

  return groups;
}

export function llmUsageLabel(usage: LlmUsage): string {
  if (usage === "llm") return "LLM";
  if (usage === "conditional") return "LLM conditional";
  return "No LLM";
}
