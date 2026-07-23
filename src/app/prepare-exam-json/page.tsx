"use client";

import { useMemo, useRef, useState } from "react";
import { Download, FileJson, Loader2, Plus, Minus, X } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import {
  buildExamJsonFromQuestions,
  distributeMarksEvenly,
  readOriginalTotalScore,
  parseQuestionInput,
  sumQuestionMarks,
  type PlatformQuestion,
} from "@/lib/exam-json-scale";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

type QuestionRow = {
  fileName: string;
  question: PlatformQuestion | null;
  originalTotalScore: number | null;
  parseError: string | null;
  marks: string;
};

function emptyRow(): QuestionRow {
  return {
    fileName: "",
    question: null,
    originalTotalScore: null,
    parseError: null,
    marks: "",
  };
}

async function readJsonFile(file: File): Promise<string> {
  return file.text();
}

export default function PrepareExamJsonPage() {
  const { user, loading: authLoading } = useAuth();
  const { toast } = useToast();
  const fileInputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const [totalMarks, setTotalMarks] = useState("100");
  const [rows, setRows] = useState<QuestionRow[]>([emptyRow(), emptyRow(), emptyRow()]);
  const [generating, setGenerating] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  const parsedTotal = Number(totalMarks);
  const rowMarks = useMemo(
    () =>
      rows.map((r) => {
        const n = Number(r.marks);
        return Number.isFinite(n) ? n : 0;
      }),
    [rows],
  );
  const marksSum = sumQuestionMarks(rowMarks.map((m) => ({ marks: m })));
  const totalValid = Number.isFinite(parsedTotal) && parsedTotal > 0;
  const marksMatch =
    totalValid && rows.length > 0 && Math.abs(marksSum - parsedTotal) <= 0.01;
  const allFilesLoaded = rows.every((r) => r.question !== null && !r.parseError);
  const canGenerate =
    !generating &&
    rows.length > 0 &&
    totalValid &&
    marksMatch &&
    allFilesLoaded &&
    rowMarks.every((m) => m > 0);

  const setQuestionCount = (count: number) => {
    const n = Math.max(1, Math.min(50, count));
    setRows((prev) => {
      if (prev.length === n) return prev;
      if (prev.length < n) {
        return [...prev, ...Array.from({ length: n - prev.length }, emptyRow)];
      }
      return prev.slice(0, n);
    });
  };

  const distributeEvenly = () => {
    if (!totalValid) return;
    const parts = distributeMarksEvenly(parsedTotal, rows.length);
    setRows((prev) =>
      prev.map((row, i) => ({ ...row, marks: String(parts[i] ?? "") })),
    );
  };

  const handleFilePick = async (index: number, file: File | undefined) => {
    if (!file) return;
    try {
      const raw = await readJsonFile(file);
      const question = parseQuestionInput(raw);
      const originalTotalScore = readOriginalTotalScore(question);
      setRows((prev) =>
        prev.map((r, i) =>
          i === index
            ? {
                fileName: file.name,
                question,
                originalTotalScore,
                parseError: null,
                marks: r.marks,
              }
            : r,
        ),
      );
    } catch (e) {
      setRows((prev) =>
        prev.map((r, i) =>
          i === index
            ? {
                fileName: file.name,
                question: null,
                originalTotalScore: null,
                parseError: e instanceof Error ? e.message : "Invalid JSON",
                marks: r.marks,
              }
            : r,
        ),
      );
    }
  };

  const clearFile = (index: number) => {
    setRows((prev) =>
      prev.map((r, i) => (i === index ? emptyRow() : r)),
    );
    const input = fileInputRefs.current[index];
    if (input) input.value = "";
  };

  const handleGenerate = (download: boolean) => {
    if (!canGenerate) return;
    setGenerating(true);
    setPreview(null);
    try {
      const items = rows.map((r, i) => ({
        question: r.question!,
        marks: Number(r.marks),
        fileName: r.fileName || `question-${i + 1}.json`,
      }));
      const { examJson, meta } = buildExamJsonFromQuestions(items, parsedTotal);
      const jsonText = JSON.stringify(examJson, null, 2);
      setPreview(jsonText);

      if (download) {
        const blob = new Blob([jsonText], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `exam-coding_questions-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
        toast(
          `${meta.length} question(s), ${parsedTotal} total marks — downloaded`,
          "success",
        );
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed to prepare exam JSON", "error");
    } finally {
      setGenerating(false);
    }
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
        Sign in to prepare exam JSON.
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-4xl space-y-6 px-4 py-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Prepare Exam JSON</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Upload each question&apos;s{" "}
          <code className="text-xs">coding_questions.json</code> (or a single question
          object). Weightage is scaled proportionally to your target marks; coding
          files and question content stay unchanged.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Exam settings</CardTitle>
          <CardDescription>
            Per-question marks must sum to the total exam marks.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-4">
          <div className="space-y-2">
            <Label htmlFor="total-marks">Total exam marks</Label>
            <Input
              id="total-marks"
              type="number"
              min={1}
              step={0.01}
              value={totalMarks}
              onChange={(e) => setTotalMarks(e.target.value)}
              className="w-36"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="question-count">Number of questions</Label>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-10 w-10"
                onClick={() => setQuestionCount(rows.length - 1)}
                disabled={rows.length <= 1}
                aria-label="Fewer questions"
              >
                <Minus className="h-4 w-4" />
              </Button>
              <Input
                id="question-count"
                type="number"
                min={1}
                max={50}
                value={rows.length}
                onChange={(e) => setQuestionCount(Number(e.target.value) || 1)}
                className="w-20 text-center"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-10 w-10"
                onClick={() => setQuestionCount(rows.length + 1)}
                disabled={rows.length >= 50}
                aria-label="More questions"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <div className="flex items-end">
            <Button type="button" variant="secondary" onClick={distributeEvenly}>
              Split marks evenly
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base">Question JSON files</CardTitle>
              <CardDescription>
                One <code className="text-xs">.json</code> file per row — typically
                from pipeline output <code className="text-xs">coding_questions.json</code>.
              </CardDescription>
            </div>
            <p
              className={cn(
                "text-sm font-medium",
                marksMatch ? "text-green-600 dark:text-green-400" : "text-amber-600 dark:text-amber-400",
              )}
            >
              Sum: {marksSum} / {totalValid ? parsedTotal : "—"}
            </p>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {rows.map((row, index) => (
            <div
              key={index}
              className="grid gap-3 rounded-lg border p-3 sm:grid-cols-[1fr_7rem]"
            >
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">
                  Question {index + 1}
                </Label>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    ref={(el) => {
                      fileInputRefs.current[index] = el;
                    }}
                    type="file"
                    accept=".json,application/json"
                    className="hidden"
                    id={`question-file-${index}`}
                    onChange={(e) => handleFilePick(index, e.target.files?.[0])}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      document.getElementById(`question-file-${index}`)?.click()
                    }
                  >
                    <FileJson className="mr-2 h-4 w-4" />
                    {row.fileName ? "Replace file" : "Choose JSON file"}
                  </Button>
                  {row.fileName && (
                    <>
                      <span className="truncate text-sm text-muted-foreground max-w-[200px]">
                        {row.fileName}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => clearFile(index)}
                        aria-label="Remove file"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </>
                  )}
                </div>
                {row.parseError && (
                  <p className="text-xs text-destructive">{row.parseError}</p>
                )}
                {row.question && row.originalTotalScore != null && (
                  <p className="text-xs text-muted-foreground">
                    Original total: {row.originalTotalScore} marks
                    {" · "}
                    {row.question.test_cases?.length ?? 0} test cases
                  </p>
                )}
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Target marks</Label>
                <Input
                  type="number"
                  min={0.01}
                  step={0.01}
                  value={row.marks}
                  onChange={(e) =>
                    setRows((prev) =>
                      prev.map((r, i) =>
                        i === index ? { ...r, marks: e.target.value } : r,
                      ),
                    )
                  }
                />
                {row.originalTotalScore != null && row.marks && (
                  <p className="text-xs text-muted-foreground">
                    {row.originalTotalScore} → {row.marks}
                  </p>
                )}
              </div>
            </div>
          ))}

          <div className="flex flex-wrap gap-2 pt-2">
            <Button
              type="button"
              disabled={!canGenerate}
              onClick={() => handleGenerate(true)}
            >
              {generating ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Download className="mr-2 h-4 w-4" />
              )}
              Generate &amp; download
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={!canGenerate}
              onClick={() => handleGenerate(false)}
            >
              Preview only
            </Button>
          </div>
        </CardContent>
      </Card>

      {preview && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Preview</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="max-h-[480px] overflow-auto rounded-md border bg-muted/40 p-3 text-xs">
              {preview}
            </pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
