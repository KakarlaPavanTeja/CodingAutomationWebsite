"use client";

import { useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LoadLogPanel } from "@/components/problems/LoadLogPanel";

export default function LoadCodingQuestionPage() {
  const { user, loading: authLoading } = useAuth();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [loadId, setLoadId] = useState<string | null>(null);

  // Pick a file, confirm. Everything else — question set, unit, order, parent
  // — is derived server-side by the planner.
  const canSubmit = !submitting && !!file;

  const submit = async () => {
    if (!canSubmit || !file) return;
    setSubmitting(true);
    setSubmitError("");
    try {
      const formData = new FormData();
      formData.append("file", file);

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

  const resetForAnotherLoad = () => {
    setLoadId(null);
    setSubmitError("");
    setFile(null);
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
        <h1 className="text-2xl font-semibold tracking-tight">Load coding question</h1>
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
                Load started — the questions keep the ids in the uploaded file.
              </p>
              <LoadLogPanel loadId={loadId} />
              <Button size="sm" variant="outline" onClick={resetForAnotherLoad}>
                Start another load
              </Button>
            </>
          ) : (
            <div className="flex items-center gap-3">
              <Button size="sm" onClick={submit} disabled={!canSubmit}>
                {submitting ? "Starting…" : "Load to beta"}
              </Button>
              <p className="text-xs text-muted-foreground">
                {submitting
                  ? "Starting the load…"
                  : "The question set, unit and order are picked automatically. SHEET_LOADING can take several minutes; keep this tab open."}
              </p>
            </div>
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
