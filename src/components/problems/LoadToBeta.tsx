"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { LoadLogPanel, type LoadRecord } from "@/components/problems/LoadLogPanel";
import { canSubmitLoad, mayForceLoad, type PriorLoadStatus } from "@/components/problems/load-anyway";

interface LoadToBetaProps {
  problemId: string;
}

/**
 * One button. The load needs no configuration — the question set, unit title,
 * child order and parent all come from the server-side planner — so clicking
 * "Load to beta" starts it. The only thing that can stop it is the safety
 * gate: a load that already completed needs "Load anyway" plus remarks.
 */
export function LoadToBeta({ problemId }: LoadToBetaProps) {
  const [open, setOpen] = useState(false);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const [lastLoad, setLastLoad] = useState<LoadRecord | null>(null);
  const [lastFailedLoad, setLastFailedLoad] = useState<LoadRecord | null>(null);
  const [loadAnyway, setLoadAnyway] = useState(false);
  const [remarks, setRemarks] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [activeLoadId, setActiveLoadId] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  // Set once the first load of this component's life has been auto-started, so
  // reopening the panel never fires a second one behind the operator's back.
  const [autoStarted, setAutoStarted] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/loadings/coding-questions?problemId=${encodeURIComponent(problemId)}`,
        );
        const data = await res.json();
        if (cancelled) return;
        setConfigured(Boolean(data.configured));
        setMissing(data.missing || []);
        setLastLoad((data.lastLoad as LoadRecord | null) ?? null);
        setLastFailedLoad((data.lastFailedLoad as LoadRecord | null) ?? null);
      } catch {
        if (!cancelled) setConfigured(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [problemId]);

  const handleDone = useCallback((record: LoadRecord) => {
    setDone(true);
    if (record.status === "completed") {
      setLastLoad(record);
      setLastFailedLoad(null);
    } else if (record.status === "failed") {
      setLastFailedLoad(record);
    }
  }, []);

  if (configured === false) {
    return (
      <span className="text-xs text-muted-foreground" title={missing.join(", ")}>
        Loading not configured
      </span>
    );
  }

  const resetForAnotherLoad = () => {
    setActiveLoadId(null);
    setDone(false);
    setLoadAnyway(false);
    setRemarks("");
    setSubmitError("");
  };

  // "completed" takes priority over "failed" — a load that has since
  // succeeded no longer means a plain retry would 409.
  const priorStatus: PriorLoadStatus = lastLoad ? "completed" : lastFailedLoad ? "failed" : "none";
  const canSubmit = !submitting && canSubmitLoad(priorStatus, loadAnyway, remarks);

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setSubmitError("");
    try {
      const res = await fetch(
        `/api/loadings/coding-questions?problemId=${encodeURIComponent(problemId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(loadAnyway ? { remarks: remarks.trim() } : {}),
        },
      );
      const data = await res.json();
      if (res.status === 409) {
        // The body IS the prior LoadRecord: refresh the banner instead of
        // treating this as a generic error.
        setLastLoad(data as LoadRecord);
        setLastFailedLoad(null);
        setSubmitError(
          'A load already exists for this problem. Check "Load anyway", add remarks, and retry to load a new copy.',
        );
        return;
      }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setActiveLoadId(data.loadId as string);
    } catch (e) {
      setSubmitError((e as Error).message || "Failed to start load.");
    } finally {
      setSubmitting(false);
    }
  };

  const openAndMaybeStart = () => {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    // Auto-start only for a problem with no load history, and only once the
    // status GET has answered. A prior load — completed or failed — has a
    // banner the operator needs to read before deciding, so that case opens
    // the panel and waits.
    if (!autoStarted && !activeLoadId && configured !== null && priorStatus === "none" && canSubmit) {
      setAutoStarted(true);
      void submit();
    }
  };

  return (
    <>
      <Button
        size="sm"
        variant={open ? "secondary" : "default"}
        onClick={openAndMaybeStart}
        className="shrink-0"
      >
        {open ? "Hide" : "Load to beta"}
      </Button>

      {open && (
        <div className="basis-full mt-3 rounded-md border bg-card p-4">
          {activeLoadId ? (
            <>
              <p className="text-xs text-muted-foreground">
                {loadAnyway
                  ? "Load started — question ids are regenerated, so beta gets a new copy alongside the previous one."
                  : "Load started — the questions keep the ids in the prepared file."}
              </p>
              <LoadLogPanel loadId={activeLoadId} onDone={handleDone} />
              {done && (
                <Button size="sm" variant="outline" className="mt-3" onClick={resetForAnotherLoad}>
                  Start another load
                </Button>
              )}
            </>
          ) : (
            <>
              {lastLoad ? (
                <div className="basis-full mb-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">
                  <p className="font-medium text-foreground">
                    Already loaded{" "}
                    {lastLoad.finishedAt
                      ? new Date(lastLoad.finishedAt).toLocaleString()
                      : "previously"}
                    {lastLoad.questionSetId ? ` — question set ${lastLoad.questionSetId}` : ""}
                  </p>
                  {lastLoad.questionIds.length > 0 && (
                    <ul className="mt-1 space-y-0.5">
                      {lastLoad.questionIds.map((questionId, i) => (
                        <li key={`${i}-${questionId}`}>
                          <a
                            className="underline"
                            href={`https://learning-beta.earlywave.in/question/${questionId}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {questionId}
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : lastFailedLoad ? (
                <div className="basis-full mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs">
                  <p className="font-medium text-foreground">
                    Last attempt failed{" "}
                    {lastFailedLoad.finishedAt
                      ? new Date(lastFailedLoad.finishedAt).toLocaleString()
                      : "previously"}
                  </p>
                  {lastFailedLoad.error && (
                    <p className="mt-1 text-muted-foreground">{lastFailedLoad.error}</p>
                  )}
                  <p className="mt-1 text-muted-foreground">
                    A plain retry will hit the same error if the cause hasn&apos;t changed — check
                    &quot;Load anyway&quot; below to regenerate ids instead.
                  </p>
                </div>
              ) : null}

              {mayForceLoad(priorStatus) && (
                <div className="basis-full mt-3 flex items-center gap-2">
                  <Checkbox
                    id="load-anyway"
                    checked={loadAnyway}
                    disabled={submitting}
                    onCheckedChange={setLoadAnyway}
                  />
                  <Label htmlFor="load-anyway" className="text-xs font-normal">
                    Load anyway (regenerate ids)
                  </Label>
                </div>
              )}

              {loadAnyway && (
                <div className="basis-full mt-2 flex flex-col gap-1">
                  <Label htmlFor="load-remarks" className="text-xs">
                    Remarks (required)
                  </Label>
                  <Textarea
                    id="load-remarks"
                    value={remarks}
                    disabled={submitting}
                    placeholder="Why load again?"
                    onChange={(e) => setRemarks(e.target.value)}
                  />
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    All ids will be regenerated — beta will get a new copy of this question.
                  </p>
                </div>
              )}

              <div className="mt-3 flex items-center gap-3">
                <Button size="sm" onClick={submit} disabled={!canSubmit}>
                  {submitting ? "Starting…" : "Load to beta"}
                </Button>
                <p className="text-xs text-muted-foreground">
                  {submitting
                    ? "Starting the load…"
                    : "Question set, unit and order are picked automatically. Sheet prep → S3 upload → SHEET_LOADING → unlock takes several minutes."}
                </p>
              </div>

              {submitError && (
                <p className="mt-3 rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {submitError}
                </p>
              )}
            </>
          )}
        </div>
      )}
    </>
  );
}
