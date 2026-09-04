"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { LoadLogPanel, type LoadRecord } from "@/components/problems/LoadLogPanel";

interface LoadToBetaProps {
  problemId: string;
  /** Seeds the sheet name and question set title. */
  defaultTitle?: string;
}

const FIELDS = [
  { key: "sheetName", label: "Sheet name", hint: "Name of the copied loading sheet" },
  { key: "title", label: "QuestionSet title (B2)", hint: "" },
  { key: "childOrder", label: "Child order (G3)", hint: "" },
  { key: "parentResource", label: "Parent resource (H3)", hint: "" },
  { key: "autoUnlock", label: "Auto unlock (I2)", hint: "" },
  { key: "durationInSec", label: "Duration (optional)", hint: "Seconds or MM:SS" },
] as const;

type FieldKey = (typeof FIELDS)[number]["key"];

export function LoadToBeta({ problemId, defaultTitle = "" }: LoadToBetaProps) {
  const [open, setOpen] = useState(false);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const [lastLoad, setLastLoad] = useState<LoadRecord | null>(null);
  const [loadAnyway, setLoadAnyway] = useState(false);
  const [remarks, setRemarks] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [activeLoadId, setActiveLoadId] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [values, setValues] = useState<Record<FieldKey, string>>({
    sheetName: defaultTitle,
    title: defaultTitle,
    childOrder: "",
    parentResource: "",
    autoUnlock: "",
    durationInSec: "",
  });

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
    if (record.status === "completed") setLastLoad(record);
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

  const canSubmit = !submitting && (!lastLoad || (loadAnyway && remarks.trim() !== ""));

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
          body: JSON.stringify(
            loadAnyway ? { ...values, remarks: remarks.trim() } : values,
          ),
        },
      );
      const data = await res.json();
      if (res.status === 409) {
        // The body IS the prior LoadRecord: refresh the banner instead of
        // treating this as a generic error.
        setLastLoad(data as LoadRecord);
        setSubmitError(
          'A load already exists for this problem. Add remarks and choose "Load anyway" to load a new copy.',
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

  return (
    <>
      <Button
        size="sm"
        variant={open ? "secondary" : "default"}
        onClick={() => setOpen((v) => !v)}
        className="shrink-0"
      >
        {open ? "Cancel" : "Load to beta"}
      </Button>

      {open && (
        <div className="basis-full mt-3 rounded-md border bg-card p-4">
          {activeLoadId ? (
            <>
              <p className="text-xs text-muted-foreground">
                Load started — question ids will be regenerated for this copy.
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
              {lastLoad && (
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
                      {lastLoad.questionIds.map((questionId) => (
                        <li key={questionId}>
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
              )}

              <div className="grid gap-3 sm:grid-cols-2">
                {FIELDS.map((field) => (
                  <div key={field.key} className="flex flex-col gap-1">
                    <Label htmlFor={`load-${field.key}`} className="text-xs">
                      {field.label}
                    </Label>
                    <Input
                      id={`load-${field.key}`}
                      value={values[field.key]}
                      placeholder={field.hint}
                      disabled={submitting}
                      onChange={(e) =>
                        setValues((prev) => ({ ...prev, [field.key]: e.target.value }))
                      }
                    />
                  </div>
                ))}
              </div>

              {lastLoad && loadAnyway && (
                <div className="basis-full mt-3 flex flex-col gap-1">
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
                {lastLoad && !loadAnyway ? (
                  <Button size="sm" variant="outline" onClick={() => setLoadAnyway(true)}>
                    Load anyway
                  </Button>
                ) : (
                  <Button size="sm" onClick={submit} disabled={!canSubmit}>
                    {submitting ? "Starting…" : "Run load"}
                  </Button>
                )}
                <p className="text-xs text-muted-foreground">
                  {submitting
                    ? "Starting the load…"
                    : "Sheet prep → S3 upload → SHEET_LOADING → unlock. This can take several minutes."}
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
