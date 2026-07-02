"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { PipelineWaveList } from "./PipelineWaveList";
import { PipelineSidePanel } from "./PipelineSidePanel";
import { PipelineSplitLayout } from "./PipelineSplitLayout";
import { stepKeyStr, lookupStepUsage, usageKeyForPipelineItem, type PipelineStepKey, type PipelineStepUsageMap } from "@/lib/pipeline-step-list";
import { buildPipelineSections, type PipelineWaveItem } from "@/lib/pipeline-waves";
import { durationFromRunState } from "@/lib/pipeline-duration";
import { effectiveStepStatus } from "@/lib/pipeline-orphan";
import { isPipelineWaveItemLocked } from "@/lib/pipeline-item-lock";
import { isQuestionPhaseComplete } from "@/lib/pipeline-question";
import { aggregateTestStats } from "@/lib/execution-parser";
import type {
  QuestionSubStepId,
  QuestionType,
  PipelineMode,
  StepId,
  StepState,
  StepStatus,
} from "@/types/pipeline";
import { Info } from "lucide-react";

interface PipelineWaveFlowProps {
  questionType: QuestionType;
  mode: PipelineMode;
  problemId: string;
  workflowSteps: StepId[];
  globalLanguages: string[];
  stepStates: Map<StepId, StepState>;
  stepUsage: PipelineStepUsageMap;
  enabledSubSteps: string[];
  ownerTitle: string;
  ownerDifficulty: string;
  generateTitleWithAi: boolean;
  legacyNotice?: string | null;
  getSubStatus: (subStepId: QuestionSubStepId) => StepStatus;
  affectedStepIds?: Set<StepId>;
  onRunSelected?: (ids: StepId[]) => void;
  onRunStep: (state: StepState, refineNote?: string) => void;
  onStopStep: (stepId: StepId) => void;
  onRunSubStep: (subStepId: QuestionSubStepId, refineNote?: string) => void;
  onStopSubStep: (subStepId: QuestionSubStepId) => void;
  onRunLangStep?: (stepId: StepId, langId: string, refineNote?: string) => void;
  onStopLangStep?: (stepId: StepId, langId: string) => void;
}

function itemToKey(item: PipelineWaveItem): PipelineStepKey {
  if (item.kind === "sub") return { kind: "sub", id: item.id as QuestionSubStepId };
  if (item.kind === "lang" && item.parentStepId && item.langId) {
    return { kind: "lang", stepId: item.parentStepId, langId: item.langId };
  }
  return { kind: "step", id: item.id as StepId };
}

export function PipelineWaveFlow({
  questionType,
  mode,
  problemId,
  workflowSteps,
  globalLanguages,
  stepStates,
  stepUsage,
  enabledSubSteps,
  ownerTitle,
  ownerDifficulty,
  generateTitleWithAi,
  legacyNotice,
  getSubStatus,
  affectedStepIds,
  onRunSelected,
  onRunStep,
  onStopStep,
  onRunSubStep,
  onStopSubStep,
  onRunLangStep,
  onStopLangStep,
}: PipelineWaveFlowProps) {
  const gqState = stepStates.get("generate_question");

  const sections = useMemo(
    () => buildPipelineSections(questionType, mode, enabledSubSteps, globalLanguages),
    [questionType, mode, enabledSubSteps, globalLanguages]
  );

  const [selectedKey, setSelectedKey] = useState<PipelineStepKey>({
    kind: "sub",
    id: "description",
  });
  const runningSelectionRef = useRef<string | null>(null);

  useEffect(() => {
    let next: PipelineStepKey | null = null;

    if (gqState?.subStepRuns) {
      for (const [id, run] of Object.entries(gqState.subStepRuns)) {
        if (run?.status === "running") {
          next = { kind: "sub", id: id as QuestionSubStepId };
          break;
        }
      }
    }

    if (!next) {
      for (const id of workflowSteps) {
        const state = stepStates.get(id);
        if (state?.status === "running") {
          next = { kind: "step", id };
          break;
        }
        if (state?.languageSubRuns) {
          for (const [langId, run] of Object.entries(state.languageSubRuns)) {
            if (run?.status === "running") {
              next = { kind: "lang", stepId: id, langId };
              break;
            }
          }
          if (next) break;
        }
      }
    }

    const nextStr = next ? stepKeyStr(next) : null;
    if (nextStr === runningSelectionRef.current) return;

    runningSelectionRef.current = nextStr;
    if (next) setSelectedKey(next);
  }, [gqState?.subStepRuns, stepStates, workflowSteps]);

  function getItemStatus(item: PipelineWaveItem): StepStatus {
    if (item.kind === "sub") return getSubStatus(item.id as QuestionSubStepId);
    if (item.kind === "lang" && item.parentStepId && item.langId) {
      const run = stepStates.get(item.parentStepId)?.languageSubRuns?.[item.langId];
      return effectiveStepStatus(run?.status ?? "pending", run?.exitCode ?? null);
    }
    const state = stepStates.get(item.id as StepId);
    return effectiveStepStatus(state?.status ?? "pending", state?.exitCode ?? null);
  }

  function getDuration(item: PipelineWaveItem): number | null {
    if (item.kind === "sub") {
      const run = gqState?.subStepRuns?.[item.id as QuestionSubStepId];
      return durationFromRunState(run, getSubStatus(item.id as QuestionSubStepId));
    }
    if (item.kind === "lang" && item.parentStepId && item.langId) {
      const run = stepStates.get(item.parentStepId)?.languageSubRuns?.[item.langId];
      return durationFromRunState(run, run?.status ?? "pending");
    }
    const state = stepStates.get(item.id as StepId);
    if (!state) return null;
    return durationFromRunState(
      {
        status: state.status,
        logs: state.logs,
        exitCode: state.exitCode,
        startTime: state.startTime,
        endTime: state.endTime,
      },
      state.status
    );
  }

  function getCost(item: PipelineWaveItem): number | null {
    const usage = lookupStepUsage(stepUsage, usageKeyForPipelineItem(item));
    return usage?.costUsd ?? null;
  }

  // Affected = stale because an upstream data-dependency re-ran more recently.
  function isItemAffected(item: PipelineWaveItem): boolean {
    if (!affectedStepIds) return false;
    if (item.kind === "lang" && item.parentStepId) return affectedStepIds.has(item.parentStepId);
    if (item.kind === "step") return affectedStepIds.has(item.id as StepId);
    return false;
  }

  // Aggregate passed/total testcases for execution-step nodes (from their logs).
  function getTestStats(item: PipelineWaveItem): { passed: number; total: number } | null {
    if (item.kind === "lang" && item.parentStepId && item.langId) {
      const run = stepStates.get(item.parentStepId)?.languageSubRuns?.[item.langId];
      if (!run) return null;
      return aggregateTestStats(run.logs ?? [], run.status === "running", run.exitCode);
    }
    if (item.kind === "step") {
      const state = stepStates.get(item.id as StepId);
      if (!state) return null;
      return aggregateTestStats(state.logs ?? [], state.status === "running", state.exitCode);
    }
    return null;
  }

  const gqCtx = useMemo(
    () => ({
      questionType,
      mode,
      languages: globalLanguages,
      generateTitleWithAi,
      ownerTitle,
      ownerDifficulty,
    }),
    [questionType, mode, globalLanguages, generateTitleWithAi, ownerTitle, ownerDifficulty]
  );

  // Use the SAME context the orchestrator uses, so titles/difficulty skip rules
  // apply and a complete GQ doesn't render downstream as Locked (P1-H5).
  const questionPhaseComplete = isQuestionPhaseComplete(gqState, questionType, gqCtx);

  const itemByKeyStr = useMemo(() => {
    const map = new Map<string, PipelineWaveItem>();
    for (const section of sections) {
      for (const wave of section.waves) {
        for (const item of wave.items) {
          map.set(stepKeyStr(itemToKey(item)), item);
        }
      }
    }
    return map;
  }, [sections]);

  function isItemLocked(item: PipelineWaveItem): boolean {
    return isPipelineWaveItemLocked({
      item,
      status: getItemStatus(item),
      questionType,
      questionPhaseComplete,
      gqState,
      stepStates,
      workflowSteps,
      gqCtx,
    });
  }

  function isEntryLocked(keyStr: string): boolean {
    const item = itemByKeyStr.get(keyStr);
    if (!item) return false;
    return isItemLocked(item);
  }

  function isItemSelected(item: PipelineWaveItem): boolean {
    return stepKeyStr(itemToKey(item)) === stepKeyStr(selectedKey);
  }

  function handleSelectItem(item: PipelineWaveItem) {
    setSelectedKey(itemToKey(item));
  }

  const pipelineList = (
    <Card className="min-w-0 shadow-none h-full flex flex-col border-0">
      <CardContent className="px-1 py-2 flex-1 min-h-0 flex flex-col">
        <PipelineWaveList
          sections={sections}
          mainUnlocked={questionPhaseComplete}
          selectedKey={selectedKey}
          getItemStatus={getItemStatus}
          getDuration={getDuration}
          getCost={getCost}
          isAffected={isItemAffected}
          getTestStats={getTestStats}
          isLocked={isItemLocked}
          isSelected={isItemSelected}
          onSelect={handleSelectItem}
          onRunItem={(item) => {
            if (item.kind === "lang" && item.parentStepId && item.langId) {
              onRunLangStep?.(item.parentStepId, item.langId);
            } else if (item.kind === "step") {
              const st = stepStates.get(item.id as StepId);
              if (st) onRunStep(st);
            }
          }}
        />
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-2">
      {legacyNotice && (
        <div className="flex gap-2 rounded-md border border-amber-500/25 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-100/90">
          <Info className="w-3.5 h-3.5 shrink-0 text-amber-400 mt-px" />
          <p className="line-clamp-2">{legacyNotice}</p>
        </div>
      )}

      <PipelineSplitLayout
        leftTitle={<CardTitle className="text-sm font-medium">Pipeline</CardTitle>}
        rightTitle={
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground pt-1">
            Pipeline details
          </p>
        }
        left={pipelineList}
        right={
          <PipelineSidePanel
            problemId={problemId}
            questionType={questionType}
            sections={sections}
            stepStates={stepStates}
            stepUsage={stepUsage}
            selectedKey={selectedKey}
            onSelectKey={setSelectedKey}
            getSubStatus={getSubStatus}
            affectedStepIds={affectedStepIds}
            onRunSelected={onRunSelected}
            onRunSubStep={onRunSubStep}
            onStopSubStep={onStopSubStep}
            onRunStep={(stepId, refineNote) => {
              const st = stepStates.get(stepId);
              if (st) onRunStep(st, refineNote);
            }}
            onStopStep={onStopStep}
            onRunLangStep={onRunLangStep}
            onStopLangStep={onStopLangStep}
            isEntryLocked={isEntryLocked}
          />
        }
      />
    </div>
  );
}
