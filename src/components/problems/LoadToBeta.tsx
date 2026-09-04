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
 * One button, then one click to start. The load needs no configuration — the
 * question set, unit title, child order and parent all come from the
 * server-side planner — so the panel's own "Load to beta" button starts it
 * with nothing to fill in.
 *
 * Opening the panel deliberately starts NOTHING. This component is unmounted
 * whenever the problem page's tab changes, so a mount/open side effect meant
 * every remount fired another load into shared beta — and the server's 409
 * gate could not stop it, being keyed on a COMPLETED prior load while the
 * first one was still running. A load starts only from an explicit click, and
 * `runningLoad` (from the status GET) both blocks that click and re-attaches
 * the log panel to the load already in flight.
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
  // The load already in flight for this problem, if any — survives this
  // component's remount because it comes from the server, not from state.
  const [runningLoad, setRunningLoad] = useState<LoadRecord | null>(null);
  // True when `activeLoadId` is a load this panel did not start — the log is
  // someone else's (or an earlier mount's) run, so it must not be described as
  // "just started".
  const [reattached, setReattached] = useState(false);

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
        const running = (data.runningLoad as LoadRecord | null) ?? null;
        setRunningLoad(running);
        // Re-attach the log panel to a load started before this mount (tab
        // switch, page reload, or another tab) instead of offering to start
        // a second one.
        // This effect runs on mount (and only on a problemId change), before
        // anything in this panel could have started a load of its own, so
        // there is no in-progress `activeLoadId` to clobber here.
        if (running) {
          setActiveLoadId(running.id);
          setReattached(true);
        }
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
    // Whatever was in flight has reached a terminal state, so it no longer
    // blocks the next load.
    setRunningLoad(null);
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
    setReattached(false);
    setDone(false);
    setLoadAnyway(false);
    setRemarks("");
    setSubmitError("");
  };

  // "completed" takes priority over "failed" — a load that has since
  // succeeded no longer means a plain retry would 409.
  const priorStatus: PriorLoadStatus = lastLoad ? "completed" : lastFailedLoad ? "failed" : "none";
  const canSubmit =
    !submitting && canSubmitLoad(priorStatus, loadAnyway, remarks, runningLoad !== null);

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
      if (res.status === 423) {
        // A load for this problem is already running server-side. Watch that
        // one rather than starting a rival.
        const loadId = (data.loadId as string | undefined) ?? null;
        if (loadId) {
          setActiveLoadId(loadId);
          setReattached(true);
        }
        setSubmitError(String(data.error || "A load for this problem is already running."));
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

  // Prior-load status ("already loaded" / "last attempt failed", including the
  // beta links) is status the operator wants at a glance, not part of the load
  // form — so it renders unconditionally here, outside `open`, instead of only
  // once the collapsed panel below is expanded. It reads the same `lastLoad`
  // / `lastFailedLoad` state the panel's form logic uses (one fetch, above),
  // so there is exactly one place this banner is rendered. "completed" takes
  // priority, same as `priorStatus`: a load that has since succeeded is what
  // matters now, even if an earlier attempt had failed. A failed banner never
  // lists question links — a link to a question not actually in beta is the
  // false-success this feature exists to prevent.
  const banner = lastLoad ? (
    <div className="basis-full rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">
      <p className="font-medium text-foreground">
        Already loaded{" "}
        {lastLoad.finishedAt ? new Date(lastLoad.finishedAt).toLocaleString() : "previously"}
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
    <div className="basis-full rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs">
      <p className="font-medium text-foreground">
        Last attempt failed{" "}
        {lastFailedLoad.finishedAt
          ? new Date(lastFailedLoad.finishedAt).toLocaleString()
          : "previously"}
      </p>
      {lastFailedLoad.error && <p className="mt-1 text-muted-foreground">{lastFailedLoad.error}</p>}
      <p className="mt-1 text-muted-foreground">
        A plain retry will hit the same error if the cause hasn&apos;t changed — expand &quot;Load
        to beta&quot; below and check &quot;Load anyway&quot; to regenerate ids instead.
      </p>
    </div>
  ) : null;

  return (
    <>
      {banner}

      <Button
        size="sm"
        variant={open ? "secondary" : "default"}
        onClick={() => setOpen((v) => !v)}
        className="shrink-0"
      >
        {open ? "Hide" : "Load to beta"}
      </Button>

      {open && (
        <div className="basis-full mt-3 rounded-md border bg-card p-4">
          {activeLoadId ? (
            <>
              <p className="text-xs text-muted-foreground">
                {reattached
                  ? "A load for this problem is already running — this is its log. Starting another is blocked until it finishes."
                  : loadAnyway
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
                  {runningLoad
                    ? "A load for this problem is already running — wait for it to finish."
                    : submitting
                      ? "Starting the load…"
                      : "Question set, unit and order are picked automatically. Takes anywhere from a couple of minutes to several, depending on whether this appends to an existing question set or a new sheet needs preparing first."}
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
