"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { GlobalConfig } from "@/components/pipeline/GlobalConfig";
import { StepCard } from "@/components/pipeline/StepCard";
import { QuestionGenerationGraph } from "@/components/pipeline/QuestionGenerationGraph";
import { getWorkflowSteps, getPrerequisiteStep, getQuestionGenerationSteps } from "@/lib/pipeline-config";
import { usePipeline } from "@/lib/pipeline-context";
import type { StepId, StepLlmUsageStats } from "@/types/pipeline";
import { Loader2, PlayCircle, StopCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

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
    stepStates,
    isAnyRunning,
    stateLoading,
    setGlobalLanguages,
    setGlobalTestcaseCount,
    updateStepState,
    runStep,
    stopStep,
    runAll,
    cancelRunAll,
    isRunAllActive,
    loadProblemState,
    savePipelineState,
  } = usePipeline();

  const [stepUsage, setStepUsage] = useState<Partial<Record<StepId, StepLlmUsageStats>>>({});
  const [selectedGraphStepId, setSelectedGraphStepId] = useState<StepId | null>(null);
  const stepCardRefs = useRef<Partial<Record<StepId, HTMLDivElement | null>>>({});

  const scrollToStep = useCallback((stepId: StepId) => {
    setSelectedGraphStepId(stepId);
    const el = stepCardRefs.current[stepId];
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, []);

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

  // Poll usage while any step is running; refresh once when all finish.
  useEffect(() => {
    if (!isAnyRunning) {
      fetchStepUsage();
      return;
    }
    fetchStepUsage();
    const interval = setInterval(fetchStepUsage, 5000);
    return () => clearInterval(interval);
  }, [isAnyRunning, fetchStepUsage]);

  // Notify parent when a step starts or finishes so it can refetch problem status
  const prevRunning = useRef(isAnyRunning);
  useEffect(() => {
    if (prevRunning.current !== isAnyRunning) {
      prevRunning.current = isAnyRunning;
      onStatusChange?.();
    }
  }, [isAnyRunning, onStatusChange]);

  const workflowSteps = getWorkflowSteps(questionType, mode);
  const questionGenStepIds = new Set(getQuestionGenerationSteps(questionType));
  const questionGenSteps = workflowSteps.filter((id) => questionGenStepIds.has(id));
  const downstreamSteps = workflowSteps.filter((id) => !questionGenStepIds.has(id));

  const allCompleted =
    workflowSteps.length > 0 &&
    workflowSteps.every((id) => stepStates.get(id)?.status === "completed");

  const enabledSubSteps = new Map(
    Array.from(stepStates.entries()).map(([id, state]) => [id, state.enabledSubSteps])
  );

  if (stateLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm text-muted-foreground">Loading pipeline state...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Pipeline Configuration</CardTitle>
            <div className="flex gap-2">
              <Badge variant="outline" className="capitalize">
                {questionType === "function" ? "Function-based" : "Non-function"}
              </Badge>
              <Badge variant="outline" className="capitalize">
                {mode}
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <GlobalConfig
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
            enabledSubSteps={enabledSubSteps}
            onSubStepToggle={(stepId, subStepId, enabled) => {
              const current = stepStates.get(stepId)?.enabledSubSteps || [];
              updateStepState(stepId, {
                enabledSubSteps: enabled
                  ? [...current, subStepId]
                  : current.filter((s) => s !== subStepId),
              });
              savePipelineState();
            }}
            disabled={isAnyRunning}
          />
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <Separator className="flex-1" />
        <div className="px-4">
          {isRunAllActive ? (
            <Button
              variant="destructive"
              size="sm"
              onClick={cancelRunAll}
            >
              <StopCircle className="mr-2 h-4 w-4" />
              Cancel Queued Steps
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={runAll}
              disabled={allCompleted}
            >
              <PlayCircle className="mr-2 h-4 w-4" />
              Run All
            </Button>
          )}
        </div>
        <Separator className="flex-1" />
      </div>

      <QuestionGenerationGraph
        questionType={questionType}
        stepStates={stepStates}
        stepUsage={stepUsage}
        selectedStepId={selectedGraphStepId}
        onSelectStep={scrollToStep}
      />

      <div className="space-y-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Step details
        </p>

        {questionGenSteps.map((stepId, index) => {
          const state = stepStates.get(stepId);
          if (!state) return null;

          const prereq = getPrerequisiteStep(stepId, workflowSteps, questionType);
          const previousCompleted =
            prereq === null || stepStates.get(prereq)?.status === "completed";

          return (
            <div
              key={stepId}
              ref={(el) => {
                stepCardRefs.current[stepId] = el;
              }}
              className={
                selectedGraphStepId === stepId
                  ? "rounded-xl ring-2 ring-blue-500/40 ring-offset-2 ring-offset-background"
                  : undefined
              }
            >
              <StepCard
                stepNumber={index + 1}
                stepState={state}
                llmUsageStats={stepUsage[stepId]}
                previousCompleted={previousCompleted}
                onRun={runStep}
                onStop={stopStep}
                onUpdateLanguages={(langs) => {
                  updateStepState(stepId, { enabledLanguages: langs });
                  savePipelineState();
                }}
              />
            </div>
          );
        })}

        {downstreamSteps.length > 0 && (
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground pt-2">
            Test &amp; package pipeline
          </p>
        )}

        {downstreamSteps.map((stepId, index) => {
          const state = stepStates.get(stepId);
          if (!state) return null;

          const prereq = getPrerequisiteStep(stepId, workflowSteps, questionType);
          const previousCompleted =
            prereq === null || stepStates.get(prereq)?.status === "completed";

          return (
            <div
              key={stepId}
              ref={(el) => {
                stepCardRefs.current[stepId] = el;
              }}
            >
              <StepCard
                stepNumber={questionGenSteps.length + index + 1}
                stepState={state}
                llmUsageStats={stepUsage[stepId]}
                previousCompleted={previousCompleted}
                onRun={runStep}
                onStop={stopStep}
                onUpdateLanguages={(langs) => {
                  updateStepState(stepId, { enabledLanguages: langs });
                  savePipelineState();
                }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
