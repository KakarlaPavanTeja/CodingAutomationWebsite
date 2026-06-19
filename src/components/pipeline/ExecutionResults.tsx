"use client";

import { useMemo, useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import type { LogLine } from "@/types/pipeline";
import { parseExecutionLogs, type ExecLangResult } from "@/lib/execution-parser";

function formatElapsed(startTs?: number, endTs?: number): string {
  if (!startTs) return "";
  const end = endTs || Date.now();
  const secs = Math.max(0, Math.floor((end - startTs) / 1000));
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  return `${mins}m ${secs % 60}s`;
}

function formatTime(t: number): string {
  if (t < 1) return `${(t * 1000).toFixed(1)}ms`;
  return `${t.toFixed(3)}s`;
}

interface ExecutionResultsProps {
  logs: LogLine[];
  isRunning: boolean;
  exitCode?: number | null;
  enabledLanguages?: string[];
}

export function ExecutionResults({
  logs,
  isRunning,
  exitCode = null,
  enabledLanguages,
}: ExecutionResultsProps) {
  const { langs } = useMemo(
    () => parseExecutionLogs(logs, { enabledLanguages, isRunning, exitCode }),
    [logs, enabledLanguages, isRunning, exitCode]
  );

  // Tick for live timer updates while running.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!isRunning) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [isRunning]);

  if (langs.length === 0) return null;

  return (
    <div className="space-y-3 pt-2">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        Execution Results
      </p>
      <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
        {langs.map((result) => (
          <ResultCard key={result.key} result={result} />
        ))}
      </div>
    </div>
  );
}

function ResultCard({ result }: { result: ExecLangResult }) {
  const processed = result.passed + result.failed;
  const isRunningLang = result.state === "running";
  const isPending = result.state === "pending";
  const isNotRun = result.state === "not_run";
  const isError = result.state === "error";
  const isFailed = result.state === "failed";
  const allPassed = result.state === "passed";
  const terminal = isError || isFailed || allPassed || isNotRun;
  // A "bad" terminal card (red) when the language errored or finished with
  // failing tests; not_run is neutral/muted.
  const bad = isError || isFailed;
  const total = result.total || processed;

  return (
    <div
      className={cn(
        "rounded-lg border p-3 space-y-2",
        allPassed && "border-green-500/30 bg-green-500/5",
        bad && "border-red-500/30 bg-red-500/5",
        isNotRun && "border-border bg-muted/30",
        (isRunningLang || isPending) && "border-border bg-card/50"
      )}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm">{result.name}</span>
          {isRunningLang && (
            <div className="w-3 h-3 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
          )}
        </div>
        <div className="flex items-center gap-2">
          {result.startTs && !isPending && !isNotRun && (
            <span
              className={cn(
                "text-xs tabular-nums",
                isRunningLang ? "text-blue-400 font-medium" : "text-muted-foreground"
              )}
            >
              {formatElapsed(result.startTs, terminal ? result.endTs : undefined)}
            </span>
          )}
          {isNotRun ? (
            <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-zinc-500/20 text-zinc-400">
              didn&apos;t run
            </span>
          ) : isPending ? (
            <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-zinc-500/20 text-zinc-400">
              queued
            </span>
          ) : (
            <span
              className={cn(
                "text-xs font-mono px-2 py-0.5 rounded-full",
                allPassed && "bg-green-500/20 text-green-400",
                bad && "bg-red-500/20 text-red-400",
                isRunningLang && "bg-blue-500/20 text-blue-400"
              )}
            >
              {result.passed}/{total} passed
            </span>
          )}
        </div>
      </div>

      {/* Status line for non-running terminal states */}
      {isNotRun && (
        <p className="text-xs text-muted-foreground">
          Skipped — an earlier language halted the run.
        </p>
      )}
      {isError && (
        <p className="text-xs text-red-400">
          Stopped at {processed}/{total}
          {result.errorReason ? ` — ${result.errorReason.toLowerCase()}` : ""}
        </p>
      )}

      {/* Progress bar (hidden for pending/not-run with no data) */}
      {!isPending && !isNotRun && total > 0 && (
        <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
          <div className="h-full flex">
            <div
              className="bg-green-500 transition-all duration-300"
              style={{ width: `${(result.passed / total) * 100}%` }}
            />
            <div
              className="bg-red-500 transition-all duration-300"
              style={{ width: `${(result.failed / total) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Progress text + max time/memory */}
      {!isPending && !isNotRun && (
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>
            {processed}/{total} tests processed
          </span>
          <div className="flex items-center gap-3">
            {result.maxTime >= 0.001 && (
              <span className="tabular-nums">
                Max:{" "}
                <span className="text-foreground font-medium">
                  {formatTime(result.maxTime)}
                </span>
              </span>
            )}
            {result.maxMemory > 0 && (
              <span className="tabular-nums">
                Mem:{" "}
                <span className="text-foreground font-medium">
                  {result.maxMemory.toFixed(1)}MB
                </span>
              </span>
            )}
            {terminal && processed > 0 && (
              <span className={allPassed ? "text-green-400" : "text-red-400"}>
                {result.passRate.toFixed(1)}%
              </span>
            )}
          </div>
        </div>
      )}

      {/* Error summary */}
      {result.errors.length > 0 && (
        <div className="text-xs text-red-400 space-y-0.5 max-h-20 overflow-auto">
          {result.errors.slice(0, 3).map((err) => (
            <div key={err.index}>
              TC #{err.index}: {err.status}{" "}
              {err.detail !== err.status ? `- ${err.detail}` : ""}
            </div>
          ))}
          {result.errors.length > 3 && (
            <div className="text-muted-foreground">
              +{result.errors.length - 3} more errors
            </div>
          )}
        </div>
      )}
    </div>
  );
}
