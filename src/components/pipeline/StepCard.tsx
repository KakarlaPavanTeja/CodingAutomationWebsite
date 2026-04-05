"use client";

import { useState, useEffect } from "react";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { StepProgress } from "./StepProgress";
import { ExecutionResults } from "./ExecutionResults";
import { LogStream } from "./LogStream";
import { getStepConfig, LANGUAGES } from "@/lib/pipeline-config";
import { cn } from "@/lib/utils";
import type { StepState, PipelineMode } from "@/types/pipeline";

interface StepCardProps {
  stepNumber: number;
  stepState: StepState;
  mode: PipelineMode;
  isAnyRunning: boolean;
  previousCompleted: boolean;
  onRun: (state: StepState) => void;
  onUpdateLanguages?: (languages: string[]) => void;
}

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  pending: { label: "Pending", className: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400" },
  running: { label: "Running", className: "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300 animate-pulse" },
  completed: { label: "Completed", className: "bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300" },
  failed: { label: "Failed", className: "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300" },
};

export function StepCard({
  stepNumber,
  stepState,
  mode,
  isAnyRunning,
  previousCompleted,
  onRun,
  onUpdateLanguages,
}: StepCardProps) {
  const config = getStepConfig(stepState.id);
  const [showRawLogs, setShowRawLogs] = useState(false);

  const isRunning = stepState.status === "running";
  const canRun = !isAnyRunning && previousCompleted;
  const isExecution = stepState.id === "execute_tests_function" || stepState.id === "execute_tests_nonfunction";

  // Live elapsed timer
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (stepState.status !== "running" || !stepState.startTime) return;
    const interval = setInterval(() => setNow(Date.now()), 3000);
    return () => clearInterval(interval);
  }, [stepState.status, stepState.startTime]);

  const formatDuration = (ms: number) => {
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    return `${m}m ${s % 60}s`;
  };

  const duration =
    stepState.startTime && stepState.endTime
      ? formatDuration(stepState.endTime - stepState.startTime)
      : stepState.startTime && stepState.status === "running"
        ? formatDuration(now - stepState.startTime)
        : null;

  const hasLogs = stepState.logs.length > 0;

  return (
    <Card className={cn(
      "transition-all",
      isRunning && "ring-2 ring-blue-500/30",
      stepState.status === "completed" && "opacity-80"
    )}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className={cn(
              "flex h-7 w-7 items-center justify-center rounded-full text-sm font-medium",
              stepState.status === "completed" ? "bg-green-500/20 text-green-500" :
              stepState.status === "running" ? "bg-blue-500/20 text-blue-500" :
              stepState.status === "failed" ? "bg-red-500/20 text-red-500" :
              "bg-muted text-muted-foreground"
            )}>
              {stepState.status === "completed" ? (
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
              ) : (
                stepNumber
              )}
            </span>
            <div>
              <h3 className="font-semibold text-sm">{config.label}</h3>
              <p className="text-xs text-muted-foreground">{config.description}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {duration && (
              <span className="text-xs text-muted-foreground">{duration}</span>
            )}
            <span className={cn(
              "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold",
              STATUS_CONFIG[stepState.status].className
            )}>
              {STATUS_CONFIG[stepState.status].label}
            </span>
            <Button
              size="sm"
              onClick={() => onRun(stepState)}
              disabled={!canRun}
            >
              {isRunning ? (
                <>
                  <svg className="animate-spin -ml-1 mr-1 h-3 w-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                  Running
                </>
              ) : (
                "Run"
              )}
            </Button>
          </div>
        </div>
      </CardHeader>

      {/* Language selector for execution steps */}
      {isExecution && (
        <CardContent className="pt-0 pb-2">
          <div className="flex items-center gap-4">
            <span className="text-xs font-medium text-muted-foreground">Languages:</span>
            <div className="flex items-center gap-3">
              {LANGUAGES.map((lang) => {
                const checked = stepState.enabledLanguages.includes(lang.id);
                return (
                  <label key={lang.id} className="flex items-center gap-1.5 cursor-pointer">
                    <Checkbox
                      checked={checked}
                      disabled={isRunning}
                      onCheckedChange={(val) => {
                        if (!onUpdateLanguages) return;
                        const next = val
                          ? [...stepState.enabledLanguages, lang.id]
                          : stepState.enabledLanguages.filter((l) => l !== lang.id);
                        onUpdateLanguages(next);
                      }}
                    />
                    <span className="text-sm">{lang.label}</span>
                  </label>
                );
              })}
            </div>
          </div>
        </CardContent>
      )}

      {/* Progress + Results */}
      {hasLogs && (
        <CardContent className="space-y-3 pt-0">
          {/* Structured progress view */}
          <StepProgress
            stepId={stepState.id}
            logs={stepState.logs}
            isRunning={isRunning}
            exitCode={stepState.exitCode}
          />

          {/* Execution results (only for execute steps) */}
          {isExecution && (
            <ExecutionResults
              logs={stepState.logs}
              isRunning={isRunning}
            />
          )}

          {/* Toggle for raw logs */}
          <div className="border-t pt-2">
            <button
              type="button"
              className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors w-full py-1"
              onClick={() => setShowRawLogs(!showRawLogs)}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={cn("transition-transform", showRawLogs && "rotate-180")}
              >
                <path d="m6 9 6 6 6-6" />
              </svg>
              <span>Raw Logs ({stepState.logs.length} lines)</span>
            </button>
            {showRawLogs && (
              <div className="mt-2">
                <LogStream logs={stepState.logs} />
              </div>
            )}
          </div>
        </CardContent>
      )}
    </Card>
  );
}
