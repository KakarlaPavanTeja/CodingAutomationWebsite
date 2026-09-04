"use client";

import { useEffect, useRef, useState } from "react";

const POLL_INTERVAL_MS = 2000;
// Bounds a run of consecutive fetch failures (404, network error, etc.) so a
// dead loadId or a network blip can't poll the DB forever.
const MAX_CONSECUTIVE_ERRORS = 5;
const QUESTION_URL_BASE = "https://learning-beta.earlywave.in/question/";

/** Mirrors the shape `GET /api/loadings/coding-questions/<id>` returns. */
export interface LoadRecord {
  id: string;
  problemId: string | null;
  userId: string;
  status: "running" | "completed" | "failed" | string;
  questionSetId: string | null;
  questionIds: string[];
  taskOutputUrl: string | null;
  error: string | null;
  remarks: string | null;
  logs: string;
  startedAt: string | null;
  finishedAt: string | null;
}

interface LoadLogPanelProps {
  loadId: string;
  /** Called once, when the load leaves the "running" state. Optional. */
  onDone?: (record: LoadRecord) => void;
}

/** Polls a background load's status/logs until it reaches a terminal state. */
export function LoadLogPanel({ loadId, onDone }: LoadLogPanelProps) {
  const [record, setRecord] = useState<LoadRecord | null>(null);
  const [pollError, setPollError] = useState("");
  // Kept in a ref so the poll loop (set up once per loadId) always calls the
  // latest callback without re-running the effect on every parent render.
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let errorStreak = 0;

    // Chained setTimeout (not setInterval): the next poll is only scheduled
    // after the current one settles, so a slow request can never overlap
    // with another in-flight one.
    const poll = async () => {
      try {
        const res = await fetch(`/api/loadings/coding-questions/${encodeURIComponent(loadId)}`);
        if (cancelled) return;

        if (!res.ok) {
          errorStreak += 1;
          if (errorStreak >= MAX_CONSECUTIVE_ERRORS) {
            setPollError(
              res.status === 404
                ? "Load record not found."
                : `Failed to check load status (HTTP ${res.status}).`,
            );
            return; // stop polling
          }
        } else {
          errorStreak = 0;
          const data = (await res.json()) as LoadRecord;
          if (cancelled) return;
          setRecord(data);
          if (data.status !== "running") {
            onDoneRef.current?.(data);
            return; // terminal state: stop polling
          }
        }
      } catch {
        if (cancelled) return;
        errorStreak += 1;
        if (errorStreak >= MAX_CONSECUTIVE_ERRORS) {
          setPollError("Lost connection while checking load status.");
          return;
        }
      }
      if (!cancelled) timer = setTimeout(poll, POLL_INTERVAL_MS);
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [loadId]);

  const status = record?.status ?? "running";

  return (
    <div className="mt-3 space-y-2" role="status" aria-live="polite">
      <p className="text-xs text-muted-foreground">
        {pollError
          ? pollError
          : status === "running"
            ? "Loading… this can take several minutes."
            : status === "completed"
              ? "Load complete."
              : "Load failed."}
      </p>

      {record?.logs && (
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md border bg-muted/40 p-2 font-mono text-[11px] leading-relaxed">
          {record.logs}
        </pre>
      )}

      {status === "failed" && record?.error && (
        <p className="rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {record.error}
        </p>
      )}

      {status === "completed" && record && record.questionIds.length > 0 && (
        <ul className="space-y-0.5 text-xs">
          {record.questionIds.map((questionId, i) => (
            <li key={`${i}-${questionId}`}>
              <a
                className="underline"
                href={`${QUESTION_URL_BASE}${questionId}`}
                target="_blank"
                rel="noreferrer"
              >
                {QUESTION_URL_BASE}
                {questionId}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
