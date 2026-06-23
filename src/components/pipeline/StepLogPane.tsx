"use client";

import { LogStream } from "./LogStream";
import { useStepLogs } from "./useStepLogs";
import { cn } from "@/lib/utils";
import type { LogLine, StepStatus } from "@/types/pipeline";
import { ChevronDown, Loader2, X } from "lucide-react";

interface StepLogPaneProps {
  label: string;
  status: StepStatus;
  problemId: string;
  logStepId: string;
  activeRunId?: string | null;
  liveLogs: LogLine[];
  isExpanded: boolean;
  onToggleExpand: () => void;
  onClose: () => void;
}

const STATUS_DOT: Record<StepStatus, string> = {
  pending: "bg-muted-foreground/40",
  running: "bg-blue-400 animate-pulse",
  stopping: "bg-amber-400 animate-pulse",
  stopped: "bg-muted-foreground/50",
  completed: "bg-green-500",
  failed: "bg-red-500",
  skipped: "bg-muted-foreground/50",
};

export function StepLogPane({
  label,
  status,
  problemId,
  logStepId,
  activeRunId,
  liveLogs,
  isExpanded,
  onToggleExpand,
  onClose,
}: StepLogPaneProps) {
  const isRunning = status === "running";
  const canFetch = status === "completed" || status === "failed" || isRunning;
  const logs = useStepLogs(problemId, logStepId, liveLogs, isRunning, canFetch, activeRunId);

  return (
    <div
      className={cn(
        "rounded-md border bg-card overflow-hidden flex flex-col",
        isExpanded ? "flex-1 min-h-[120px]" : "shrink-0"
      )}
    >
      <div className="flex items-center gap-1 px-1 py-1 border-b bg-muted/30 shrink-0">
        <button
          type="button"
          onClick={onToggleExpand}
          className="flex flex-1 items-center gap-1.5 min-w-0 px-1 py-0.5 rounded hover:bg-muted/50 text-left"
          aria-expanded={isExpanded}
        >
          <ChevronDown
            className={cn(
              "w-3.5 h-3.5 shrink-0 text-muted-foreground transition-transform",
              !isExpanded && "-rotate-90"
            )}
          />
          <span className={cn("w-2 h-2 rounded-full shrink-0", STATUS_DOT[status])} />
          <span className="text-[11px] font-medium truncate">{label}</span>
          {isRunning && (
            <Loader2 className="w-3 h-3 text-blue-400 animate-spin shrink-0" />
          )}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground shrink-0"
          aria-label={`Close logs for ${label}`}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      {isExpanded && (
        <div className="flex-1 min-h-0 p-1.5">
          {logs.length === 0 && !isRunning ? (
            <p className="text-[10px] text-muted-foreground p-2 text-center">
              No logs yet — run this step to generate output.
            </p>
          ) : (
            <LogStream logs={logs} maxHeight="100%" />
          )}
        </div>
      )}
    </div>
  );
}
