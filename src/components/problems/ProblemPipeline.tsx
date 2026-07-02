"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GlobalConfig } from "@/components/pipeline/GlobalConfig";
import { PipelineWaveFlow } from "@/components/pipeline/PipelineWaveFlow";
import { getPipelineUiWorkflowSteps } from "@/lib/pipeline-config";
import { usePipeline } from "@/lib/pipeline-context";
import type { PipelineStepUsageMap } from "@/lib/pipeline-step-list";
import type { StepId } from "@/types/pipeline";
import { AlertTriangle, ChevronDown, Loader2, PlayCircle, RotateCcw, StopCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface ProblemPipelineProps {
  problemId: string;
  onStatusChange?: () => void;
}

export function ProblemPipeline({ problemId, onStatusChange }: ProblemPipelineProps) {
  const {
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
    stateLoading,
    setGlobalLanguages,
    setGlobalTestcaseCount,
    setOwnerTitle,
    setGenerateTitleWithAi,
    setDefaultTagNames,
    saveOwnerTitle,
    runStep,
    stopStep,
    runQuestionSubStep,
    stopQuestionSubStep,
    runLanguageSubStep,
    stopLanguageSubStep,
    getSubStepStatus,
    runAll,
    cancelRunAll,
    isRunAllActive,
    affectedStepIds,
    runAffected,
    runAffectedSelected,
    loadProblemState,
    savePipelineState,
    legacyPipelineNotice,
  } = usePipeline();

  const [stepUsage, setStepUsage] = useState<PipelineStepUsageMap>({});
  // null = user hasn't toggled the panel; it then auto-opens while the title
  // is missing (the title field lives inside) and stays closed otherwise.
  const [configToggle, setConfigToggle] = useState<boolean | null>(null);

  const fetchStepUsage = useCallback(() => {
    fetch(`/api/pipeline/usage?problemId=${encodeURIComponent(problemId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.usage) setStepUsage(data.usage);
      })
      .catch(() => {});
  }, [problemId]);

  useEffect(() => {
    loadProblemState(problemId);
  }, [problemId, loadProblemState]);

  useEffect(() => {
    if (stateLoading) return;
    fetchStepUsage();
  }, [stateLoading, fetchStepUsage]);

  useEffect(() => {
    if (!isAnyRunning) {
      fetchStepUsage();
      return;
    }
    fetchStepUsage();
    const interval = setInterval(fetchStepUsage, 5000);
    return () => clearInterval(interval);
  }, [isAnyRunning, fetchStepUsage]);

  const prevRunning = useRef(isAnyRunning);
  useEffect(() => {
    if (prevRunning.current !== isAnyRunning) {
      prevRunning.current = isAnyRunning;
      onStatusChange?.();
    }
  }, [isAnyRunning, onStatusChange]);

  const workflowSteps = getPipelineUiWorkflowSteps(questionType, mode);

  const allCompleted =
    workflowSteps.length > 0 &&
    workflowSteps.every((id) => stepStates.get(id)?.status === "completed");

  const hasIncompleteSteps = workflowSteps.some(
    (id) => stepStates.get(id)?.status !== "completed"
  );

  const packagingStepsPending =
    hasIncompleteSteps &&
    workflowSteps.some(
      (id) =>
        (id === "package_platform" || id === "prepare_platform_json") &&
        stepStates.get(id)?.status !== "completed"
    );

  const gqEnabledSubSteps = stepStates.get("generate_question")?.enabledSubSteps ?? [];

  const titleMissing = packagingStepsPending && !ownerTitle.trim();
  const configOpen = configToggle ?? (!stateLoading && titleMissing);

  if (stateLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm text-muted-foreground">Loading pipeline…</span>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="rounded-lg border bg-card overflow-hidden">
        <button
          type="button"
          className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-muted/40 transition-colors"
          onClick={() => setConfigToggle(!configOpen)}
        >
          <div className="flex items-center gap-2 min-w-0">
            <ChevronDown
              className={cn(
                "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                configOpen && "rotate-180"
              )}
            />
            <span className="text-sm font-medium">Pipeline settings</span>
            <Badge variant="outline" className="text-[10px] h-5 capitalize hidden sm:inline-flex">
              {questionType === "function" ? "Function" : "Non-function"}
            </Badge>
            <Badge variant="outline" className="text-[10px] h-5 capitalize hidden sm:inline-flex">
              {mode}
            </Badge>
          </div>
          <span className="text-[10px] text-muted-foreground shrink-0">
            {configOpen ? "Hide" : "Languages, title, test count"}
          </span>
        </button>
        {configOpen && (
          <div className="px-3 pb-3 pt-1 border-t">
            <GlobalConfig
              compact
              languages={globalLanguages}
              onLanguagesChange={(langs) => {
                setGlobalLanguages(langs);
                savePipelineState();
              }}
              testcaseCount={globalTestcaseCount}
              onTestcaseCountChange={(count) => {
                setGlobalTestcaseCount(count);
                savePipelineState();
              }}
              ownerTitle={ownerTitle}
              onOwnerTitleChange={setOwnerTitle}
              generateTitleWithAi={generateTitleWithAi}
              onGenerateTitleWithAiChange={(enabled) => {
                setGenerateTitleWithAi(enabled);
                savePipelineState();
              }}
              defaultTagNames={defaultTagNames}
              onDefaultTagNamesChange={(tags) => {
                setDefaultTagNames(tags);
                savePipelineState();
              }}
              onSaveTitle={saveOwnerTitle}
              disabled={isAnyRunning}
            />
          </div>
        )}
      </div>

      <div
        className={cn(
          "flex items-center gap-3 rounded-lg border bg-muted/25 px-3 py-2",
          isRunAllActive ? "justify-between" : "justify-center"
        )}
      >
        {isRunAllActive ? (
          <>
            <p className="text-xs text-muted-foreground min-w-0">
              Running pipeline… steps launch as prerequisites complete.
            </p>
            <Button
              size="sm"
              variant="destructive"
              className="h-9 px-3 text-sm shrink-0"
              onClick={cancelRunAll}
            >
              <StopCircle className="w-4 h-4 mr-1.5" />
              Cancel run all
            </Button>
          </>
        ) : (
          <div className="flex flex-col items-center gap-1 w-full sm:w-auto sm:flex-row">
            <Button
              className="h-9 w-full sm:w-auto sm:min-w-[220px] px-4 text-sm font-medium"
              onClick={runAll}
              disabled={allCompleted || isAnyRunning || !hasIncompleteSteps}
            >
              <PlayCircle className="w-4 h-4 mr-1.5" />
              Run all steps
            </Button>
            {affectedStepIds.size > 0 && (
              <Button
                variant="outline"
                className="h-9 w-full sm:w-auto px-4 text-sm font-medium border-amber-500/50 text-amber-600 hover:bg-amber-500/10 dark:text-amber-400"
                onClick={runAffected}
                disabled={isAnyRunning}
                title="Re-run only the steps made stale by a more recent upstream change"
              >
                <RotateCcw className="w-4 h-4 mr-1.5" />
                Rerun affected ({affectedStepIds.size})
              </Button>
            )}
          </div>
        )}
      </div>

      {titleMissing && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/50 bg-amber-500/10 px-3 py-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
          <p className="text-xs text-amber-700 dark:text-amber-300">
            <span className="font-medium">No problem title set.</span> Package for Platform,
            Platform JSON and the editorial steps that depend on them will be skipped until you{" "}
            <button
              type="button"
              className="font-medium underline underline-offset-2 hover:opacity-80"
              onClick={() => setConfigToggle(true)}
            >
              set a title in Pipeline settings
            </button>{" "}
            and click Save.
          </p>
        </div>
      )}

      <PipelineWaveFlow
        questionType={questionType}
        mode={mode}
        problemId={problemId}
        workflowSteps={workflowSteps}
        globalLanguages={globalLanguages}
        stepStates={stepStates}
        stepUsage={stepUsage}
        enabledSubSteps={gqEnabledSubSteps}
        ownerTitle={ownerTitle}
        ownerDifficulty={ownerDifficulty}
        generateTitleWithAi={generateTitleWithAi}
        legacyNotice={legacyPipelineNotice}
        getSubStatus={getSubStepStatus}
        affectedStepIds={affectedStepIds}
        onRunSelected={runAffectedSelected}
        onRunStep={runStep}
        onStopStep={stopStep}
        onRunSubStep={runQuestionSubStep}
        onStopSubStep={stopQuestionSubStep}
        onRunLangStep={runLanguageSubStep}
        onStopLangStep={stopLanguageSubStep}
      />
    </div>
  );
}
