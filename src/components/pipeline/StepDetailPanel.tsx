"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { StepProgress } from "./StepProgress";
import { LogStream } from "./LogStream";
import { getStepConfig } from "@/lib/pipeline-config";
import { cn } from "@/lib/utils";
import type { StepId, StepLlmUsageStats, StepState } from "@/types/pipeline";

interface StepDetailPanelProps {
  stepState: StepState;
  llmUsageStats?: StepLlmUsageStats;
}

export function StepDetailPanel({ stepState, llmUsageStats }: StepDetailPanelProps) {
  const config = getStepConfig(stepState.id);
  const [showRawLogs, setShowRawLogs] = useState(false);
  const isRunning = stepState.status === "running";
  const hasLogs = stepState.logs.length > 0;

  return (
    <Card className="border-dashed">
      <CardContent className="pt-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h4 className="text-sm font-semibold">{config.label}</h4>
            <p className="text-xs text-muted-foreground mt-0.5">{config.description}</p>
          </div>
          {llmUsageStats && llmUsageStats.callCount > 0 && (
            <div className="text-right text-xs text-muted-foreground shrink-0">
              <div>{llmUsageStats.callCount} LLM call{llmUsageStats.callCount !== 1 ? "s" : ""}</div>
              {llmUsageStats.costUsd > 0 && (
                <div className="tabular-nums">${llmUsageStats.costUsd.toFixed(4)}</div>
              )}
            </div>
          )}
        </div>

        {!hasLogs && !isRunning && stepState.status === "pending" && (
          <p className="text-xs text-muted-foreground py-2">
            Select a step and click Run on its graph node to see live progress here.
          </p>
        )}

        {(hasLogs || isRunning) && (
          <>
            <StepProgress
              stepId={stepState.id}
              logs={stepState.logs}
              isRunning={isRunning}
              exitCode={stepState.exitCode}
            />
            {hasLogs && (
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
                  <span>Raw logs ({stepState.logs.length} lines)</span>
                </button>
                {showRawLogs && (
                  <div className="mt-2">
                    <LogStream logs={stepState.logs} />
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
