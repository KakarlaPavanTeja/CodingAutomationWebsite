"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { parsePipelineLogContent } from "@/lib/pipeline-log-parse";
import type { LogLine } from "@/types/pipeline";

function mergeStepLogs(
  live: LogLine[],
  disk: LogLine[],
  isRunning: boolean
): LogLine[] {
  if (isRunning) {
    if (live.length > 0) return live;
    return disk;
  }
  if (disk.length > 0) return disk;
  return live;
}

export function useStepLogs(
  problemId: string | undefined,
  logStepId: string,
  liveLogs: LogLine[],
  isRunning: boolean,
  canFetch: boolean,
  activeRunId?: string | null
) {
  const [diskLogs, setDiskLogs] = useState<LogLine[]>([]);

  const logs = useMemo(
    () => mergeStepLogs(liveLogs, diskLogs, isRunning),
    [liveLogs, diskLogs, isRunning]
  );

  const fetchDiskLogs = useCallback(async () => {
    if (!problemId || !canFetch) return;
    try {
      const params = new URLSearchParams({
        problemId,
        stepId: logStepId,
        tail: "2000",
      });
      if (activeRunId) params.set("runId", activeRunId);

      const res = await fetch(`/api/pipeline/run/logs?${params.toString()}`);
      const data = await res.json();
      const content = data.content?.trim() ?? "";
      if (!content) {
        if (isRunning) setDiskLogs([]);
        return;
      }
      const parsed = parsePipelineLogContent(content);
      setDiskLogs(parsed);
    } catch {
      /* keep previous */
    }
  }, [problemId, logStepId, canFetch, activeRunId, isRunning]);

  useEffect(() => {
    setDiskLogs([]);
  }, [logStepId, activeRunId]);

  useEffect(() => {
    if (!canFetch) return;

    const poll = () => {
      if (typeof document !== "undefined" && document.hidden) return;
      fetchDiskLogs();
    };

    poll();
    const ms = isRunning ? 4000 : 8000;
    const id = setInterval(poll, ms);
    return () => clearInterval(id);
  }, [canFetch, isRunning, fetchDiskLogs]);

  return logs;
}
