"use client";

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { FileUploader } from "@/components/files/FileUploader";
import { WorkflowSelector } from "@/components/pipeline/WorkflowSelector";
import { GlobalConfig } from "@/components/pipeline/GlobalConfig";
import { StepCard } from "@/components/pipeline/StepCard";
import { getWorkflowSteps } from "@/lib/pipeline-config";
import { usePipeline } from "@/lib/pipeline-context";

export default function PipelinePage() {
  const {
    questionType,
    mode,
    globalLanguages,
    globalTestcaseCount,
    stepStates,
    isAnyRunning,
    setQuestionType,
    setMode,
    setGlobalLanguages,
    setGlobalTestcaseCount,
    updateStepState,
    runStep,
  } = usePipeline();

  const workflowSteps = getWorkflowSteps(questionType, mode);

  // Build sub-step map from step states for global config
  const enabledSubSteps = new Map(
    Array.from(stepStates.entries()).map(([id, state]) => [id, state.enabledSubSteps])
  );

  return (
    <div className="px-6 py-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold mb-1">Pipeline</h1>
        <p className="text-muted-foreground text-sm">
          Configure and run each step of the automation pipeline
        </p>
      </div>

      <FileUploader />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Workflow Configuration</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <WorkflowSelector
            questionType={questionType}
            mode={mode}
            onQuestionTypeChange={setQuestionType}
            onModeChange={setMode}
            disabled={isAnyRunning}
          />
          <Separator />
          <GlobalConfig
            languages={globalLanguages}
            onLanguagesChange={setGlobalLanguages}
            testcaseCount={globalTestcaseCount}
            onTestcaseCountChange={setGlobalTestcaseCount}
            enabledSubSteps={enabledSubSteps}
            onSubStepToggle={(stepId, subStepId, enabled) => {
              const current = stepStates.get(stepId)?.enabledSubSteps || [];
              updateStepState(stepId, {
                enabledSubSteps: enabled
                  ? [...current, subStepId]
                  : current.filter((s) => s !== subStepId),
              });
            }}
            disabled={isAnyRunning}
          />
        </CardContent>
      </Card>

      <Separator />

      <div className="space-y-4">
        {workflowSteps.map((stepId, index) => {
          const state = stepStates.get(stepId);
          if (!state) return null;

          const previousCompleted =
            index === 0 ||
            stepStates.get(workflowSteps[index - 1])?.status === "completed";

          return (
            <StepCard
              key={stepId}
              stepNumber={index + 1}
              stepState={state}
              mode={mode}
              isAnyRunning={isAnyRunning}
              previousCompleted={previousCompleted}
              onRun={runStep}
              onUpdateLanguages={(langs) => updateStepState(stepId, { enabledLanguages: langs })}
            />
          );
        })}
      </div>
    </div>
  );
}
