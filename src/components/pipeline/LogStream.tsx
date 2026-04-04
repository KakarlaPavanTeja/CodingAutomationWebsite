"use client";

import { useEffect, useRef, useCallback } from "react";
import { cn } from "@/lib/utils";
import type { LogLine } from "@/types/pipeline";

interface LogStreamProps {
  logs: LogLine[];
  maxHeight?: string;
}

export function LogStream({ logs, maxHeight = "300px" }: LogStreamProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    // Consider "near bottom" if within 40px of the bottom
    isNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  }, []);

  useEffect(() => {
    // Only auto-scroll if user is already near the bottom
    if (isNearBottomRef.current && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [logs]);

  if (logs.length === 0) {
    return (
      <div
        className="rounded-md bg-zinc-950 text-zinc-400 text-sm font-mono p-4 text-center"
        style={{ maxHeight }}
      >
        No logs yet. Click Run to start.
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="rounded-md bg-zinc-950 font-mono text-sm overflow-auto"
      style={{ maxHeight }}
    >
      <div className="p-3 space-y-0.5">
        {logs.map((log, i) => {
          const isError =
            log.stream === "stderr" ||
            /error|exception|failed|traceback/i.test(log.line);
          const isWarning = /warning|warn/i.test(log.line);
          const isCommand = i === 0 && log.line.startsWith("$");

          return (
            <div
              key={i}
              className={cn(
                "whitespace-pre-wrap break-all leading-relaxed",
                isCommand && "text-blue-400 font-semibold",
                isError && !isCommand && "text-red-400",
                isWarning && !isCommand && !isError && "text-yellow-400",
                !isError && !isWarning && !isCommand && "text-zinc-300"
              )}
            >
              {log.line}
            </div>
          );
        })}
      </div>
    </div>
  );
}
