"use client";

import { useCallback, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LoadLogPanel, type LoadRecord } from "@/components/problems/LoadLogPanel";
import { canSubmitUpload, mayForceUploadRetry, type PriorLoadStatus } from "@/components/problems/load-anyway";

export default function LoadCodingQuestionPage() {
  const { user, loading: authLoading } = useAuth();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [loadAnyway, setLoadAnyway] = useState(false);
  const [remarks, setRemarks] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [loadId, setLoadId] = useState<string | null>(null);
  // This browser session's own last finished attempt. There is no problemId
  // here, so — unlike LoadToBeta — there is no server-known prior state to
  // fetch on mount: an uploaded file's beta history is unknown until the
  // pre-flight duplicate check inside its own load actually runs. Starts
  // "none" so a first upload never shows the force control.
  const [priorStatus, setPriorStatus] = useState<PriorLoadStatus>("none");

  // Pick a file, confirm. Everything else — question set, unit, order, parent
  // — is derived server-side by the planner.
  const canSubmit = canSubmitUpload(!!file, loadAnyway, remarks, submitting);

  const submit = async () => {
    if (!canSubmit || !file) return;
    setSubmitting(true);
    setSubmitError("");
    try {
      const formData = new FormData();
      formData.append("file", file);
      // Only sent when forcing, which is exactly when the server regenerates
      // ids — see coding-questions/route.ts's `if (remarks) { ... }` gate,
      // which applies regardless of surface.
      if (loadAnyway) formData.append("remarks", remarks.trim());

      const res = await fetch("/api/loadings/coding-questions", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setLoadId(data.loadId as string);
    } catch (e) {
      setSubmitError((e as Error).message || "Failed to start load.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDone = useCallback((record: LoadRecord) => {
    setPriorStatus(record.status === "failed" ? "failed" : "completed");
  }, []);

  const resetForAnotherLoad = () => {
    setLoadId(null);
    setSubmitError("");
    setFile(null);
    setLoadAnyway(false);
    setRemarks("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  if (authLoading) {
    return (
      <div className="container mx-auto flex min-h-[40vh] items-center justify-center px-4">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="container mx-auto px-4 py-12 text-center text-muted-foreground">
        Sign in to load a coding question.
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-2xl space-y-6 px-4 py-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Load CQ</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Upload a <code className="text-xs">coding_questions.json</code> (or a zip
          containing one) directly into NKB beta, without going through a problem.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Question file</CardTitle>
          <CardDescription>Accepts .json and .zip.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-1">
            <Label htmlFor="upload-file">Question file</Label>
            <input
              id="upload-file"
              ref={fileInputRef}
              type="file"
              accept=".json,.zip"
              disabled={submitting}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>

          {loadId ? (
            <>
              <p className="text-xs text-muted-foreground">
                {loadAnyway
                  ? "Load started — question ids are regenerated, so beta gets a new copy alongside the previous one."
                  : "Load started — the questions keep the ids in the uploaded file."}
              </p>
              <LoadLogPanel loadId={loadId} onDone={handleDone} />
              <Button size="sm" variant="outline" onClick={resetForAnotherLoad}>
                Start another load
              </Button>
            </>
          ) : (
            <>
              {mayForceUploadRetry(priorStatus) && (
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="upload-load-anyway"
                    checked={loadAnyway}
                    disabled={submitting}
                    onCheckedChange={setLoadAnyway}
                  />
                  <Label htmlFor="upload-load-anyway" className="text-xs font-normal">
                    Load anyway (regenerate ids)
                  </Label>
                </div>
              )}

              {loadAnyway && (
                <div className="flex flex-col gap-1">
                  <Label htmlFor="upload-load-remarks" className="text-xs">
                    Remarks (required)
                  </Label>
                  <Textarea
                    id="upload-load-remarks"
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

              <div className="flex items-center gap-3">
                <Button size="sm" onClick={submit} disabled={!canSubmit}>
                  {submitting ? "Starting…" : "Load to beta"}
                </Button>
                <p className="text-xs text-muted-foreground">
                  {submitting
                    ? "Starting the load…"
                    : "The question set, unit and order are picked automatically. Takes anywhere from a couple of minutes to several, depending on whether this appends to an existing question set or a new sheet needs preparing first; keep this tab open."}
                </p>
              </div>
            </>
          )}

          {submitError && (
            <p className="rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {submitError}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
