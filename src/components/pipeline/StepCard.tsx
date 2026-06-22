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
import type { StepState, StepId, LlmUsage, StepLlmUsageStats } from "@/types/pipeline";

const LLM_BADGE: Record<LlmUsage, { label: string; title: string; className: string }> = {
  llm: {
    label: "Uses LLM",
    title: "This step always calls the LLM (incurs token cost).",
    className:
      "bg-violet-500/25 text-violet-700 dark:text-violet-200 border-violet-500/50 ring-1 ring-violet-500/20",
  },
  conditional: {
    label: "LLM if needed",
    title: "This step only calls the LLM under certain conditions (otherwise it runs purely locally).",
    className:
      "bg-amber-500/25 text-amber-800 dark:text-amber-200 border-amber-500/50 ring-1 ring-amber-500/20",
  },
  none: {
    label: "No LLM",
    title: "Pure local execution — this step never calls the LLM.",
    className:
      "bg-emerald-500/20 text-emerald-800 dark:text-emerald-200 border-emerald-500/45 ring-1 ring-emerald-500/15",
  },
};

function LlmBadge({ usage }: { usage: LlmUsage }) {
  const cfg = LLM_BADGE[usage];
  return (
    <span
      title={cfg.title}
      className={cn(
        "inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-semibold leading-none shrink-0 tracking-wide",
        cfg.className
      )}
    >
      {cfg.label}
    </span>
  );
}

function formatTokens(n: number): string {
  return n.toLocaleString();
}

function formatCost(n: number): string {
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n >= 0.01) return `$${n.toFixed(3)}`;
  if (n > 0) return `$${n.toFixed(4)}`;
  return "$0.00";
}

function formatModelLabel(models: string[]): string {
  if (models.length === 0) return "—";
  const short = (m: string) => m.replace(/^(openai|google|anthropic)\//, "");
  if (models.length === 1) return short(models[0]);
  return `${short(models[0])} +${models.length - 1}`;
}

function StepLlmUsageBar({
  llmUsage,
  stats,
  stepStatus,
}: {
  llmUsage: LlmUsage;
  stats?: StepLlmUsageStats;
  stepStatus: StepState["status"];
}) {
  if (llmUsage === "none") return null;

  const hasRun = stepStatus !== "pending";
  if (!hasRun && !stats) return null;

  if (!stats || stats.callCount === 0) {
    if (stepStatus === "completed" || stepStatus === "failed") {
      return (
        <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
          <span className="rounded-md border border-border/60 bg-muted/30 px-2 py-1">
            No LLM calls on last run
          </span>
        </div>
      );
    }
    if (stepStatus === "running") {
      return (
        <div className="mt-2 text-xs text-muted-foreground animate-pulse">
          Waiting for LLM usage…
        </div>
      );
    }
    return null;
  }

  return (
    <div className="mt-2 flex flex-wrap gap-2">
      <UsagePill label="Model" value={formatModelLabel(stats.models)} title={stats.models.join(", ")} />
      <UsagePill label="Input" value={formatTokens(stats.promptTokens)} />
      <UsagePill label="Output" value={formatTokens(stats.completionTokens)} />
      <UsagePill label="Cost" value={formatCost(stats.costUsd)} highlight />
      {stats.callCount > 1 && (
        <UsagePill label="Calls" value={String(stats.callCount)} />
      )}
    </div>
  );
}

function UsagePill({
  label,
  value,
  title,
  highlight,
}: {
  label: string;
  value: string;
  title?: string;
  highlight?: boolean;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs",
        highlight
          ? "border-violet-500/40 bg-violet-500/15 text-violet-800 dark:text-violet-200 font-semibold"
          : "border-border/60 bg-muted/40 text-foreground"
      )}
    >
      <span className="text-muted-foreground font-medium">{label}</span>
      <span className="tabular-nums">{value}</span>
    </span>
  );
}

interface StepCardProps {
  stepNumber: number;
  stepState: StepState;
  previousCompleted: boolean;
  llmUsageStats?: StepLlmUsageStats;
  onRun: (state: StepState) => void;
  onStop?: (stepId: StepId) => void;
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
  previousCompleted,
  onRun,
  onStop,
  onUpdateLanguages,
  llmUsageStats,
}: StepCardProps) {
  const config = getStepConfig(stepState.id);
  const [showRawLogs, setShowRawLogs] = useState(false);

  const isRunning = stepState.status === "running";
  // A step can run as long as its prerequisite is met and it isn't already
  // running — independent of whether OTHER steps are running, so siblings
  // (editorial / JSON) can be launched concurrently.
  const canRun = !isRunning && previousCompleted;
  const isExecution = stepState.id === "execute_tests_function" || stepState.id === "execute_tests_nonfunction";

  // Live elapsed timer, ticking once a second while running. The displayed
  // duration is clamped to >= 0 so a stale `now` can never render negative
  // right after a (re)start.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (stepState.status !== "running" || !stepState.startTime) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
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
        ? formatDuration(Math.max(0, now - stepState.startTime))
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
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-semibold text-sm">{config.label}</h3>
                <LlmBadge usage={config.llmUsage} />
              </div>
              <p className="text-xs text-muted-foreground">{config.description}</p>
              <StepLlmUsageBar
                llmUsage={config.llmUsage}
                stats={llmUsageStats}
                stepStatus={stepState.status}
              />
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
            {isRunning ? (
              <Button
                size="sm"
                variant="destructive"
                onClick={() => onStop?.(stepState.id)}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="mr-1"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>
                Stop
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={() => onRun(stepState)}
                disabled={!canRun}
              >
                Run
              </Button>
            )}
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
            enabledLanguages={isExecution ? stepState.enabledLanguages : undefined}
          />

          {/* Execution results (only for execute steps) */}
          {isExecution && (
            <ExecutionResults
              logs={stepState.logs}
              isRunning={isRunning}
              exitCode={stepState.exitCode}
              enabledLanguages={stepState.enabledLanguages}
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
