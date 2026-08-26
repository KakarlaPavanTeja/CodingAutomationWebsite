"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useResetOnChange } from "@/lib/use-reset-on-change";
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

/**
 * Poll `fetchNow` while the step runs; fetch ONCE when it has already terminated.
 *
 * A terminal step's log file never changes again, so polling it forever is pure
 * waste (up to MAX_OPEN_LOGS panes x 1 request / 12s, indefinitely). The caller
 * re-invokes this on the running -> terminal transition, which is what gives the
 * finished step its one final fetch of the complete log.
 *
 * Exported for tests. `isHidden` is injectable for the same reason.
 */
export function scheduleLogPolls(
  isRunning: boolean,
  fetchNow: () => void,
  isHidden: () => boolean = () => typeof document !== "undefined" && document.hidden
): () => void {
  let fetched = false;
  const poll = () => {
    if (isHidden()) return;
    fetched = true;
    fetchNow();
  };

  poll();
  // Terminal + already fetched: nothing left to watch. If the tab was hidden the
  // fetch was skipped, so keep a slow interval alive just long enough to land it.
  if (!isRunning && fetched) return () => {};

  const id = setInterval(() => {
    poll();
    if (!isRunning && fetched) clearInterval(id);
  }, isRunning ? 6000 : 12000);
  return () => clearInterval(id);
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

  // Clear during render, not in an effect: the effect painted the PREVIOUS step's logs
  // under the newly selected step's heading for one frame.
  useResetOnChange(`${logStepId}|${activeRunId ?? ""}`, () => setDiskLogs([]));

  useEffect(() => {
    if (canFetch) return scheduleLogPolls(isRunning, fetchDiskLogs);
  }, [canFetch, isRunning, fetchDiskLogs]);

  return logs;
}
