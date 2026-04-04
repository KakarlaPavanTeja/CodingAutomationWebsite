"use client";

import type { QuestionType, PipelineMode } from "@/types/pipeline";
import { cn } from "@/lib/utils";

interface WorkflowSelectorProps {
  questionType: QuestionType;
  mode: PipelineMode;
  onQuestionTypeChange: (type: QuestionType) => void;
  onModeChange: (mode: PipelineMode) => void;
  disabled?: boolean;
}

function ToggleOption({
  selected,
  onClick,
  disabled,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "px-4 py-2 rounded-md text-sm font-medium transition-colors border",
        selected
          ? "bg-primary text-primary-foreground border-primary"
          : "bg-background text-foreground border-border hover:bg-muted",
        disabled && "opacity-50 cursor-not-allowed"
      )}
    >
      {children}
    </button>
  );
}

export function WorkflowSelector({
  questionType,
  mode,
  onQuestionTypeChange,
  onModeChange,
  disabled,
}: WorkflowSelectorProps) {
  return (
    <div className="flex flex-col sm:flex-row gap-6">
      <div className="space-y-2">
        <span className="text-sm font-medium">Question Type</span>
        <div className="flex gap-2">
          <ToggleOption
            selected={questionType === "function"}
            onClick={() => onQuestionTypeChange("function")}
            disabled={disabled}
          >
            Function-based
          </ToggleOption>
          <ToggleOption
            selected={questionType === "nonfunction"}
            onClick={() => onQuestionTypeChange("nonfunction")}
            disabled={disabled}
          >
            Non-function
          </ToggleOption>
        </div>
      </div>

      <div className="space-y-2">
        <span className="text-sm font-medium">Mode</span>
        <div className="flex gap-2">
          <ToggleOption
            selected={mode === "practice"}
            onClick={() => onModeChange("practice")}
            disabled={disabled}
          >
            Practice
          </ToggleOption>
          <ToggleOption
            selected={mode === "exam"}
            onClick={() => onModeChange("exam")}
            disabled={disabled}
          >
            Exam
          </ToggleOption>
        </div>
      </div>
    </div>
  );
}
