"use client";

import { useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Download,
  FileJson,
  Loader2,
  Plus,
  Minus,
  Upload,
  X,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import {
  buildExamJsonFromQuestions,
  distributeMarksEvenly,
  moveQuestion,
  readDifficulty,
  readOriginalTotalScore,
  readShortText,
  parseQuestionsInput,
  sumQuestionMarks,
  type PlatformQuestion,
} from "@/lib/exam-json-scale";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

const MAX_QUESTIONS = 50;

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

const DIFFICULTY_STYLES: Record<string, string> = {
  EASY: "bg-green-500/15 text-green-700 dark:text-green-400",
  MEDIUM: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  HARD: "bg-red-500/15 text-red-700 dark:text-red-400",
};

function DifficultyBadge({ question }: { question: PlatformQuestion }) {
  const difficulty = readDifficulty(question);
  if (!difficulty) {
    return (
      <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        No difficulty
      </span>
    );
  }
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        DIFFICULTY_STYLES[difficulty] ?? "bg-muted text-muted-foreground",
      )}
    >
      {difficulty}
    </span>
  );
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
    const n = Math.max(1, Math.min(MAX_QUESTIONS, count));
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

  /** Rows produced by one file: one per question it holds, or one error row. */
  const rowsFromFile = async (file: File): Promise<QuestionRow[]> => {
    try {
      const questions = parseQuestionsInput(await readJsonFile(file));
      return questions.map((question, qi) => ({
        fileName: questions.length > 1 ? `${file.name} [${qi + 1}]` : file.name,
        question,
        originalTotalScore: readOriginalTotalScore(question),
        parseError: null,
        marks: "",
      }));
    } catch (e) {
      return [
        {
          ...emptyRow(),
          fileName: file.name,
          parseError: e instanceof Error ? e.message : "Invalid JSON",
        },
      ];
    }
  };

  const handleFilePick = async (index: number, files: File[]) => {
    if (files.length === 0) return;
    const loaded = (await Promise.all(files.map(rowsFromFile))).flat();
    setRows((prev) => {
      // Keep the marks already typed on the row being replaced.
      const withMarks = loaded.map((r, i) =>
        i === 0 ? { ...r, marks: prev[index]?.marks ?? "" } : r,
      );
      const next = [...prev.slice(0, index), ...withMarks, ...prev.slice(index + 1)];
      if (next.length > MAX_QUESTIONS) {
        toast(`Only the first ${MAX_QUESTIONS} questions were kept`, "error");
      }
      return next.slice(0, MAX_QUESTIONS);
    });
    const ok = loaded.filter((r) => r.question).length;
    if (ok > 1) toast(`Loaded ${ok} questions`, "success");
  };

  /** One file (or a few) holding every question: replaces all rows and splits marks. */
  const handleCombinedUpload = async (files: File[]) => {
    if (files.length === 0) return;
    const loaded = (await Promise.all(files.map(rowsFromFile))).flat();
    if (loaded.length > MAX_QUESTIONS) {
      toast(`Only the first ${MAX_QUESTIONS} questions were kept`, "error");
    }
    const kept = loaded.slice(0, MAX_QUESTIONS);
    const parts = totalValid ? distributeMarksEvenly(parsedTotal, kept.length) : [];
    setRows(kept.map((r, i) => ({ ...r, marks: parts[i] != null ? String(parts[i]) : "" })));

    const failed = kept.filter((r) => r.parseError).length;
    const ok = kept.length - failed;
    toast(
      failed
        ? `${ok} question(s) loaded, ${failed} file(s) failed to parse`
        : `${ok} question(s) loaded — marks split evenly`,
      failed ? "error" : "success",
    );
  };

  /** Row order is the order questions appear in the generated exam JSON. */
  const moveRow = (from: number, to: number) => {
    setRows((prev) => moveQuestion(prev, from, to));
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
          object). A file holding several questions expands into one row per question.
          Weightage is scaled proportionally to your target marks; coding files and
          question content stay unchanged.
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
                max={MAX_QUESTIONS}
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
                disabled={rows.length >= MAX_QUESTIONS}
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
                Fastest path: <strong>Upload JSON with all questions</strong> — one
                file containing every question (an array of{" "}
                <code className="text-xs">coding_questions.json</code> entries). It
                creates a row per question and splits marks evenly. Or fill rows one
                at a time below. Rows are written to the exam JSON top to bottom — use
                the arrows to reorder.
              </CardDescription>
            </div>
            <div className="flex items-center gap-3">
              <input
                type="file"
                accept=".json,application/json"
                multiple
                className="hidden"
                id="combined-json"
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  e.target.value = "";
                  void handleCombinedUpload(files);
                }}
              />
              <Button
                type="button"
                onClick={() => document.getElementById("combined-json")?.click()}
              >
                <Upload className="mr-2 h-4 w-4" />
                Upload JSON with all questions
              </Button>
              <p
                className={cn(
                  "text-sm font-medium",
                  marksMatch ? "text-green-600 dark:text-green-400" : "text-amber-600 dark:text-amber-400",
                )}
              >
                Sum: {marksSum} / {totalValid ? parsedTotal : "—"}
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {rows.map((row, index) => (
            <div
              key={index}
              className="grid gap-3 rounded-lg border p-3 sm:grid-cols-[1fr_7rem]"
            >
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <Label className="shrink-0 text-xs text-muted-foreground">
                      Question {index + 1}
                    </Label>
                    {row.question && (
                      <>
                        <span className="truncate text-sm font-medium">
                          {readShortText(row.question) ?? "Untitled question"}
                        </span>
                        <DifficultyBadge question={row.question} />
                      </>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => moveRow(index, index - 1)}
                      disabled={index === 0}
                      aria-label={`Move question ${index + 1} up`}
                    >
                      <ArrowUp className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => moveRow(index, index + 1)}
                      disabled={index === rows.length - 1}
                      aria-label={`Move question ${index + 1} down`}
                    >
                      <ArrowDown className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    ref={(el) => {
                      fileInputRefs.current[index] = el;
                    }}
                    type="file"
                    accept=".json,application/json"
                    multiple
                    className="hidden"
                    id={`question-file-${index}`}
                    onChange={(e) => {
                      const files = Array.from(e.target.files ?? []);
                      e.target.value = "";
                      void handleFilePick(index, files);
                    }}
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
                    {row.fileName ? "Replace file" : "Choose JSON file(s)"}
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
