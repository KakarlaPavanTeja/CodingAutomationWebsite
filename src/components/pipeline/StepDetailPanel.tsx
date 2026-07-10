"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StepProgress } from "./StepProgress";
import { LogStream } from "./LogStream";
import { getStepConfig } from "@/lib/pipeline-config";
import { subStepLogKey } from "@/lib/pipeline-question";
import { cn } from "@/lib/utils";
import type { LogLine, QuestionSubStepId, StepLlmUsageStats, StepState } from "@/types/pipeline";
import { FileText, ListTree, Play, Square } from "lucide-react";

interface StepDetailPanelProps {
  stepState: StepState;
  subStepId?: QuestionSubStepId;
  llmUsageStats?: StepLlmUsageStats;
  problemId?: string;
  requiresLabel?: string | null;
  requirementMet?: boolean;
  canRun?: boolean;
  onRun?: () => void;
  onStop?: () => void;
}

const SUB_STEP_LABELS: Record<QuestionSubStepId, string> = {
  description: "Description",
  naming: "Naming & signature",
  titles: "Titles",
  difficulty: "Difficulty",
  topics: "Topics",
  translate_cpp: "Translate to C++",
  translate_java: "Translate to Java",
  translate_nodejs: "Translate to Node.js",
};

import { parsePipelineLogContent } from "@/lib/pipeline-log-parse";
import { effectiveStepStatus } from "@/lib/pipeline-orphan";

function pickBestLogs(live: LogLine[], disk: LogLine[]): LogLine[] {
  if (live.length === 0) return disk;
  if (disk.length === 0) return live;
  return live.length >= disk.length ? live : disk;
}

type DetailTab = "progress" | "raw";

export function StepDetailPanel({
  stepState,
  subStepId,
  llmUsageStats,
  problemId,
  requiresLabel,
  requirementMet,
  canRun,
  onRun,
  onStop,
}: StepDetailPanelProps) {
  const config = getStepConfig(stepState.id);
  const subRun = subStepId ? stepState.subStepRuns?.[subStepId] : undefined;
  const stateLogs = subRun?.logs ?? stepState.logs;
  const exitCode = subRun?.exitCode ?? stepState.exitCode;
  const rawStatus = subRun?.status ?? stepState.status;
  const status = effectiveStepStatus(rawStatus, exitCode);
  const isRunning = status === "running" || status === "stopping";
  const progressStepId = subStepId ? subStepLogKey(subStepId) : stepState.id;

  const [tab, setTab] = useState<DetailTab>("progress");
  const [diskLogs, setDiskLogs] = useState<LogLine[]>([]);

  const canFetchLogs =
    !!problemId && (status === "completed" || status === "failed" || isRunning);

  const logs = useMemo(
    () => pickBestLogs(stateLogs, diskLogs),
    [stateLogs, diskLogs]
  );
  const hasLogs = logs.length > 0;

  const fetchDiskLogs = useCallback(async () => {
    if (!problemId || !canFetchLogs) return;
    try {
      const res = await fetch(
        `/api/pipeline/run/logs?problemId=${encodeURIComponent(problemId)}&stepId=${encodeURIComponent(progressStepId)}&tail=2000`
      );
      const data = await res.json();
      if (data.content?.trim()) {
        const parsed = parsePipelineLogContent(data.content);
        if (parsed.length > 0) {
          setDiskLogs((prev) => pickBestLogs(prev, parsed));
        }
      }
    } catch {
      /* keep showing live / previous disk logs */
    }
  }, [problemId, progressStepId, canFetchLogs]);

  useEffect(() => {
    setDiskLogs([]);
  }, [progressStepId, subStepId, stepState.id]);

  useEffect(() => {
    if (!canFetchLogs) return;
    fetchDiskLogs();
    const intervalMs = isRunning ? 5000 : tab === "raw" ? 8000 : null;
    if (!intervalMs) return;
    const id = setInterval(() => {
      // Skip while the tab is backgrounded — cuts idle DB/network traffic.
      if (typeof document !== "undefined" && document.hidden) return;
      fetchDiskLogs();
    }, intervalMs);
    return () => clearInterval(id);
  }, [canFetchLogs, isRunning, tab, fetchDiskLogs]);

  useEffect(() => {
    if (isRunning) setTab("raw");
  }, [isRunning]);

  return (
    <Card className="border-dashed h-full flex flex-col shadow-none">
      <CardContent className="pt-3 px-3 pb-3 space-y-2 flex flex-col flex-1 min-h-0">
        <div className="flex items-start justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <h4 className="text-xs font-semibold">
              {subStepId ? `${config.label} · ${SUB_STEP_LABELS[subStepId]}` : config.label}
            </h4>
            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
              {subStepId ? `Sub-step of ${config.label}` : config.description}
            </p>
            {requiresLabel && (
              <p className="text-[11px] text-muted-foreground mt-1">
                Requires {requiresLabel}
                {requirementMet ? " ✓" : " — waiting"}
              </p>
            )}
          </div>
          <div className="flex flex-col items-end gap-2 shrink-0">
            {isRunning ? (
              <Button size="sm" variant="destructive" className="h-7 text-xs" onClick={onStop}>
                <Square className="w-3.5 h-3.5 mr-1 fill-current" />
                Stop
              </Button>
            ) : (
              onRun && (
                <Button size="sm" className="h-7 text-xs" disabled={!canRun} onClick={onRun}>
                  <Play className="w-3.5 h-3.5 mr-1" />
                  Run
                </Button>
              )
            )}
            {llmUsageStats && llmUsageStats.callCount > 0 && (
              <div className="text-right text-xs text-muted-foreground">
                <div>
                  {llmUsageStats.callCount} LLM call{llmUsageStats.callCount !== 1 ? "s" : ""}
                </div>
                {llmUsageStats.costUsd > 0 && (
                  <div className="tabular-nums">${llmUsageStats.costUsd.toFixed(4)}</div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1 border-b pb-0 shrink-0">
          <button
            type="button"
            className={cn(
              "inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium border-b-2 -mb-px transition-colors",
              tab === "progress"
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
            onClick={() => setTab("progress")}
          >
            <ListTree className="w-3.5 h-3.5" />
            Progress
          </button>
          <button
            type="button"
            className={cn(
              "inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium border-b-2 -mb-px transition-colors",
              tab === "raw"
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
            onClick={() => setTab("raw")}
          >
            <FileText className="w-3.5 h-3.5" />
            Raw logs
            {hasLogs && (
              <span className="text-[10px] text-muted-foreground">({logs.length})</span>
            )}
            {isRunning && (
              <span className="text-[10px] text-blue-400 animate-pulse">live</span>
            )}
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto">
          {tab === "progress" && (
            <>
              {!hasLogs && !isRunning && status === "pending" && (
                <p className="text-xs text-muted-foreground py-2">
                  Click <strong className="font-medium">Run</strong> to start. Raw logs update
                  automatically while the step runs.
                </p>
              )}
              {(hasLogs || isRunning) && (
                <StepProgress
                  stepId={progressStepId}
                  logs={logs}
                  isRunning={isRunning}
                  exitCode={exitCode}
                />
              )}
            </>
          )}

          {tab === "raw" && (
            <div className="h-full min-h-[200px]">
              {!hasLogs && !isRunning && status === "pending" ? (
                <p className="text-xs text-muted-foreground py-2">
                  Run this step first — logs will appear here automatically.
                </p>
              ) : (
                <LogStream logs={logs} maxHeight="100%" />
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
