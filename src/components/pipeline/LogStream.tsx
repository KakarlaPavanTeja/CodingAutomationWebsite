"use client";

import { useEffect, useRef, useCallback, useMemo } from "react";
import {
  classifyPipelineLogLine,
  formatLogElapsed,
  pipelineLogDisplayText,
  pipelineLogPrefixIcon,
  type PipelineLogLineKind,
} from "@/lib/pipeline-log-parse";
import { cn } from "@/lib/utils";
import type { LogLine } from "@/types/pipeline";

interface LogStreamProps {
  logs: LogLine[];
  maxHeight?: string;
}

const ROW_STYLE: Record<PipelineLogLineKind, string> = {
  divider: "",
  start: "bg-sky-950/40 border-l-2 border-sky-500/60",
  exit: "bg-zinc-900/50 border-l-2 border-zinc-600",
  section: "bg-cyan-950/30 border-l-2 border-cyan-500/50 mt-1.5 first:mt-0",
  progress: "border-l border-zinc-800 ml-2",
  ok: "bg-emerald-950/25 border-l-2 border-emerald-500/50",
  fail: "bg-red-950/30 border-l-2 border-red-500/50",
  warning: "bg-amber-950/25 border-l-2 border-amber-500/45",
  gate: "bg-amber-950/20 border-l-2 border-amber-400/40",
  usage: "opacity-90",
  info: "opacity-80",
  stderr: "bg-red-950/35 border-l-2 border-red-500/60",
  default: "",
};

const TEXT_STYLE: Record<PipelineLogLineKind, string> = {
  divider: "text-zinc-500 text-[10px] uppercase tracking-widest font-semibold",
  start: "text-sky-200 font-medium",
  exit: "text-zinc-400 italic",
  section: "text-cyan-200 font-semibold",
  progress: "text-emerald-200/95",
  ok: "text-emerald-300",
  fail: "text-red-300",
  warning: "text-amber-300",
  gate: "text-amber-200 font-medium",
  usage: "text-violet-300/90 text-[11px]",
  info: "text-zinc-400",
  stderr: "text-red-300",
  default: "text-zinc-300",
};

const ICON_STYLE: Record<string, string> = {
  "✓": "text-emerald-400",
  "✗": "text-red-400",
  "⚠": "text-amber-400",
  "▸": "text-zinc-500",
};

export function LogStream({ logs, maxHeight = "300px" }: LogStreamProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);
  const fillHeight = maxHeight === "100%";

  const baseTs = useMemo(() => logs[0]?.ts ?? Date.now(), [logs]);

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    isNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  }, []);

  useEffect(() => {
    if (isNearBottomRef.current && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [logs]);

  if (logs.length === 0) {
    return (
      <div
        className={cn(
          "rounded-md bg-zinc-950 text-zinc-400 text-sm font-mono p-4 text-center border border-zinc-800/80",
          fillHeight && "h-full min-h-[200px] flex items-center justify-center"
        )}
        style={fillHeight ? undefined : { maxHeight }}
      >
        No logs yet. Click Run to start.
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className={cn(
        "rounded-md bg-zinc-950 font-mono text-[12px] leading-[1.55] overflow-auto border border-zinc-800/80",
        fillHeight && "h-full min-h-[200px]"
      )}
      style={fillHeight ? undefined : { maxHeight }}
    >
      <div className="sticky top-0 z-10 flex items-center justify-between gap-2 px-3 py-2 border-b border-zinc-800 bg-zinc-950/98 backdrop-blur-sm">
        <div className="flex gap-2 text-[10px] uppercase tracking-wide text-zinc-500">
          <span className="w-[3.5rem] shrink-0 text-right">Elapsed</span>
          <span>Output</span>
        </div>
        <span className="text-[10px] text-zinc-600 tabular-nums">{logs.length} lines</span>
      </div>

      <div className="p-1.5 space-y-0.5">
        {logs.map((log, i) => {
          const kind = classifyPipelineLogLine(log.line, log.stream);
          const display = pipelineLogDisplayText(log.line);
          const icon = pipelineLogPrefixIcon(kind);

          if (kind === "divider") {
            const label = display.replace(/^──\s*|\s*──$/g, "").replace(/^===\s*|\s*===$/g, "");
            return (
              <div
                key={`${i}-${log.ts}`}
                className="flex items-center gap-2 py-2 px-1 my-1"
              >
                <div className="flex-1 h-px bg-zinc-800" />
                <span className={TEXT_STYLE.divider}>{label}</span>
                <div className="flex-1 h-px bg-zinc-800" />
              </div>
            );
          }

          return (
            <div
              key={`${i}-${log.ts}-${display.slice(0, 48)}`}
              className={cn(
                "flex gap-2 rounded-sm px-2 py-1",
                ROW_STYLE[kind],
                kind === "default" && "hover:bg-zinc-900/50"
              )}
            >
              <span
                className="w-[3.5rem] shrink-0 text-right tabular-nums text-zinc-600 select-none pt-px"
                title={new Date(log.ts).toLocaleString()}
              >
                {formatLogElapsed(baseTs, log.ts)}
              </span>
              <span className={cn("flex-1 min-w-0 flex gap-1.5", TEXT_STYLE[kind])}>
                {icon && (
                  <span className={cn("shrink-0 w-3 text-center", ICON_STYLE[icon])} aria-hidden>
                    {icon}
                  </span>
                )}
                <span className="whitespace-pre-wrap break-words">{display}</span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
