"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Braces,
  Terminal,
  GraduationCap,
  ClipboardCheck,
  Upload,
  Loader2,
  Shapes,
  Sparkles,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { BinaryTreeIcon, LinkedListIcon } from "@/components/icons/structure-icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ProblemAdvancedSettings } from "@/components/files/ProblemAdvancedSettings";
import { useCpPrepStream } from "@/components/files/useCpPrepStream";
import { MarkdownProse } from "@/components/markdown/MarkdownProse";
import { parseCombinedInput } from "@/lib/cp-prep/parse-combined-input";
import { cn } from "@/lib/utils";
import type { PrepResult } from "@/lib/cp-prep/types";

interface FileUploaderProps {
  onUploadComplete?: (problemId?: string) => void;
  onCancel?: () => void;
}

const STRUCTURE_TYPES = [
  { id: "standard", label: "Standard", icon: Shapes },
  { id: "linked_list", label: "Linked List", icon: LinkedListIcon },
  { id: "binary_tree", label: "Binary Tree", icon: BinaryTreeIcon },
] as const;

const WORKFLOW_PRESETS = [
  {
    id: "function-practice",
    questionType: "function",
    mode: "practice",
    title: "Function-based · Practice",
    description: "Hints, topics, enrichment, and company tags",
    icon: Braces,
    accent: "violet",
  },
  {
    id: "function-exam",
    questionType: "function",
    mode: "exam",
    title: "Function-based · Exam",
    description: "Lean exam JSON, no metadata extras",
    icon: Braces,
    accent: "blue",
  },
  {
    id: "nonfunction-practice",
    questionType: "nonfunction",
    mode: "practice",
    title: "Stdin/Stdout · Practice",
    description: "Full program reads input and prints output — with enrichment and tags",
    icon: Terminal,
    accent: "emerald",
  },
  {
    id: "nonfunction-exam",
    questionType: "nonfunction",
    mode: "exam",
    title: "Stdin/Stdout · Exam",
    description: "Full program reads input and prints output — lean exam format",
    icon: Terminal,
    accent: "amber",
  },
] as const;

const ACCENT_STYLES: Record<string, { card: string; icon: string; ring: string }> = {
  violet: {
    card: "hover:border-violet-500/40 hover:bg-violet-500/5",
    icon: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
    ring: "border-violet-500 ring-violet-500/20 bg-violet-500/5",
  },
  blue: {
    card: "hover:border-blue-500/40 hover:bg-blue-500/5",
    icon: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
    ring: "border-blue-500 ring-blue-500/20 bg-blue-500/5",
  },
  emerald: {
    card: "hover:border-emerald-500/40 hover:bg-emerald-500/5",
    icon: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    ring: "border-emerald-500 ring-emerald-500/20 bg-emerald-500/5",
  },
  amber: {
    card: "hover:border-amber-500/40 hover:bg-amber-500/5",
    icon: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    ring: "border-amber-500 ring-amber-500/20 bg-amber-500/5",
  },
};

const REFERENCE_LANGUAGES = [
  { id: "cpp", label: "C++" },
  { id: "java", label: "Java" },
  { id: "py", label: "Python" },
  { id: "js", label: "JavaScript" },
];

type Phase = "pick" | "prepare" | "review" | "advanced";
type RawInputMode = "separate" | "combined";

function Chip({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full px-3 py-1 text-xs font-medium border transition-colors",
        selected
          ? "bg-foreground text-background border-foreground"
          : "bg-transparent text-muted-foreground border-border hover:border-foreground/30 hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}

function WizardSteps({ current }: { current: Phase }) {
  const steps = [
    { id: "pick" as const, label: "Workflow" },
    { id: "prepare" as const, label: "Prepare" },
    { id: "review" as const, label: "Review" },
    { id: "advanced" as const, label: "Advanced" },
  ];
  const currentIndex = steps.findIndex((s) => s.id === current);

  return (
    <ol className="flex flex-wrap items-center gap-2 text-xs">
      {steps.map((step, index) => {
        const done = index < currentIndex;
        const active = step.id === current;
        return (
          <li key={step.id} className="flex items-center gap-2">
            {index > 0 && <span className="text-muted-foreground/40">/</span>}
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium",
                active && "bg-primary/10 text-primary",
                done && !active && "text-muted-foreground",
                !active && !done && "text-muted-foreground/60"
              )}
            >
              <span
                className={cn(
                  "flex h-4 w-4 items-center justify-center rounded-full text-[10px]",
                  active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                )}
              >
                {index + 1}
              </span>
              {step.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function PrepLogPanel({ logs }: { logs: { type: string; message: string }[] }) {
  if (logs.length === 0) {
    return (
      <div className="rounded-md bg-zinc-950 text-zinc-400 text-sm font-mono p-4 text-center min-h-[120px] flex items-center justify-center">
        Generation logs will appear here…
      </div>
    );
  }

  return (
    <div className="rounded-md bg-zinc-950 font-mono text-sm overflow-auto max-h-[200px] min-h-[120px]">
      <div className="p-3 space-y-0.5">
        {logs.map((log, i) => (
          <div
            key={i}
            className={cn(
              "whitespace-pre-wrap break-all leading-relaxed",
              log.type === "error" && "text-red-400",
              log.type === "warning" && "text-yellow-400",
              log.type === "status" && "text-zinc-300"
            )}
          >
            {log.message}
          </div>
        ))}
      </div>
    </div>
  );
}

function VerificationBanner({ result }: { result: PrepResult }) {
  if (result.examplesRun === 0) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
        <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
        <span>No examples were verified. Review the generated files carefully before continuing.</span>
      </div>
    );
  }
  if (!result.verified) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
        <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
        <span>
          Some examples did not pass verification ({(result.exampleResults ?? []).filter((r) => !r.passed).length}{" "}
          failed). You can edit the outputs below or regenerate.
        </span>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-800 dark:text-emerald-200">
      <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
      <span>All {result.examplesRun} example{result.examplesRun === 1 ? "" : "s"} passed verification.</span>
    </div>
  );
}

function ExampleResults({ result }: { result: PrepResult }) {
  if (result.examplesRun === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {(result.exampleResults ?? []).map((r) => (
        <span
          key={r.index}
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium",
            r.passed
              ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
              : "bg-red-500/10 text-red-700 dark:text-red-300"
          )}
        >
          {r.passed ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
          Example {r.index + 1}
        </span>
      ))}
    </div>
  );
}

export function FileUploader({ onUploadComplete, onCancel }: FileUploaderProps) {
  const [phase, setPhase] = useState<Phase>("pick");
  const [presetId, setPresetId] = useState<string>("function-practice");
  const [problemType, setProblemType] = useState("standard");

  const [rawInputMode, setRawInputMode] = useState<RawInputMode>("separate");
  const [rawProblemStatement, setRawProblemStatement] = useState("");
  const [rawReferenceSolution, setRawReferenceSolution] = useState("");
  const [referenceLanguage, setReferenceLanguage] = useState("cpp");
  const [combinedFile, setCombinedFile] = useState<File | null>(null);
  const [combinedFileText, setCombinedFileText] = useState("");

  const [generatedProblemMd, setGeneratedProblemMd] = useState("");
  const [generatedSolutionPy, setGeneratedSolutionPy] = useState("");
  const [prepResult, setPrepResult] = useState<PrepResult | null>(null);
  const [reportExpanded, setReportExpanded] = useState(false);

  const [problemName, setProblemName] = useState("");
  const [scenarioLevel, setScenarioLevel] = useState<"none" | "light" | "moderate" | "heavy">("none");
  const [difficulty, setDifficulty] = useState<"" | "easy" | "medium" | "hard">("");
  const [score, setScore] = useState("");
  const [companies, setCompanies] = useState("");
  const [sharedMemberIds, setSharedMemberIds] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const createdRef = useRef(false);

  const { logs, isRunning, result, error: prepError, generate, abort } = useCpPrepStream();

  const preset = WORKFLOW_PRESETS.find((p) => p.id === presetId) ?? WORKFLOW_PRESETS[0];
  const mode = preset.mode;
  const questionType = preset.questionType;

  useEffect(() => {
    if (mode === "exam") setCompanies("");
  }, [mode]);

  useEffect(() => {
    if (result) {
      setPrepResult(result);
      setGeneratedProblemMd(result.problemMarkdown);
      setGeneratedSolutionPy(result.solutionPython);
      if (!problemName.trim() && result.slug) {
        setProblemName(
          result.slug
            .split("_")
            .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
            .join(" ")
        );
      }
      setPhase("review");
    }
  }, [result]);

  const handleCombinedFile = useCallback(async (file: File | null) => {
    setCombinedFile(file);
    if (!file) {
      setCombinedFileText("");
      return;
    }
    const text = await file.text();
    setCombinedFileText(text);
    const parsed = parseCombinedInput(text);
    if (rawInputMode === "combined") {
      setRawProblemStatement(parsed.problemStatement);
      setRawReferenceSolution(parsed.referenceSolution ?? "");
    }
  }, [rawInputMode]);

  const resolveRawInput = useCallback(() => {
    if (rawInputMode === "combined" && combinedFileText) {
      const parsed = parseCombinedInput(combinedFileText);
      return {
        problemStatement: parsed.problemStatement,
        referenceSolution: parsed.referenceSolution,
      };
    }
    return {
      problemStatement: rawProblemStatement.trim(),
      referenceSolution: rawReferenceSolution.trim() || undefined,
    };
  }, [rawInputMode, combinedFileText, rawProblemStatement, rawReferenceSolution]);

  const canGenerate = () => {
    if (!problemName.trim()) return false;
    const { problemStatement } = resolveRawInput();
    return problemStatement.length > 0;
  };

  const hasReviewedContent =
    generatedProblemMd.trim().length > 0 && generatedSolutionPy.trim().length > 0;
  const canSubmit = problemName.trim().length > 0 && hasReviewedContent;

  const structureLabel =
    STRUCTURE_TYPES.find((s) => s.id === problemType)?.label ?? "Standard";

  const handleGenerate = () => {
    if (!problemName.trim()) {
      setError("Enter a problem title before generating");
      return;
    }
    const { problemStatement, referenceSolution } = resolveRawInput();
    if (!problemStatement) {
      setError("Add a problem statement");
      return;
    }
    setError(null);
    setPrepResult(null);
    generate({
      title: problemName.trim(),
      problemStatement,
      referenceSolution,
      referenceLanguage: referenceSolution ? referenceLanguage : undefined,
    });
  };

  const handleUpload = async () => {
    if (createdRef.current || uploading) return;
    if (!problemName.trim()) {
      setError("Enter a problem name");
      return;
    }
    if (!hasReviewedContent) {
      setError("Generate and review problem.md and solution.py first");
      return;
    }

    setUploading(true);
    setError(null);

    const formData = new FormData();
    formData.append("problemName", problemName.trim());
    formData.append("problemType", problemType);
    formData.append("questionType", questionType);
    formData.append("mode", mode);
    formData.append("scenarioLevel", scenarioLevel);
    if (difficulty) formData.append("difficulty", difficulty);
    if (score.trim()) formData.append("score", score.trim());
    if (mode === "practice" && companies.trim()) formData.append("companies", companies.trim());
    for (const memberId of sharedMemberIds) {
      formData.append("memberIds", memberId);
    }

    formData.append(
      "problemMd",
      new Blob([generatedProblemMd], { type: "text/markdown" }),
      "problem.md"
    );
    formData.append(
      "solution",
      new Blob([generatedSolutionPy], { type: "text/plain" }),
      "solution.py"
    );

    try {
      const res = await fetch("/api/files/upload", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      createdRef.current = true;
      onUploadComplete?.(data.problemId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  // ── Phase 1: Pick workflow ──────────────────────────────────────────
  if (phase === "pick") {
    return (
      <div className="mx-auto max-w-5xl space-y-8 py-4">
        <div className="text-center space-y-2">
          <h2 className="text-2xl font-bold tracking-tight">What are you building?</h2>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Pick a workflow template. You can still fine-tune settings on the next screen.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {WORKFLOW_PRESETS.map((p) => {
            const Icon = p.icon;
            const styles = ACCENT_STYLES[p.accent];
            const selected = presetId === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setPresetId(p.id)}
                className={cn(
                  "group relative flex items-start gap-4 rounded-xl border p-4 text-left transition-all",
                  selected ? cn("ring-2", styles.ring) : cn("border-border", styles.card)
                )}
              >
                <div className={cn("rounded-lg p-2.5 shrink-0", styles.icon)}>
                  <Icon className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-sm">{p.title}</p>
                    {p.mode === "practice" ? (
                      <GraduationCap className="h-3.5 w-3.5 text-muted-foreground" />
                    ) : (
                      <ClipboardCheck className="h-3.5 w-3.5 text-muted-foreground" />
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                    {p.description}
                  </p>
                </div>
              </button>
            );
          })}
        </div>

        <div className="space-y-3">
          <Label className="text-sm text-muted-foreground">Data structure</Label>
          <div className="flex flex-wrap gap-2">
            {STRUCTURE_TYPES.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setProblemType(id)}
                className={cn(
                  "inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-colors",
                  problemType === id
                    ? "border-primary bg-primary/5 text-foreground"
                    : "border-border text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground"
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between pt-2">
          {onCancel ? (
            <Button variant="ghost" onClick={onCancel}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Cancel
            </Button>
          ) : (
            <div />
          )}
          <Button onClick={() => setPhase("prepare")}>
            Continue
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </div>
    );
  }

  // ── Phase 2: Prepare (raw input + AI generation) ───────────────────
  if (phase === "prepare") {
    return (
      <div className="mx-auto max-w-7xl space-y-6 py-2">
        <div className="flex items-center justify-between gap-4">
          <button
            type="button"
            onClick={() => {
              if (isRunning) abort();
              setPhase("pick");
            }}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Change workflow
          </button>
          <WizardSteps current="prepare" />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            <span className="inline-flex items-center rounded-full bg-muted px-3 py-1 text-xs font-medium">
              {preset.title}
            </span>
            <span className="inline-flex items-center rounded-full bg-muted px-3 py-1 text-xs font-medium">
              {structureLabel}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {(error || prepError) && (
              <p className="text-sm text-destructive">{error || prepError}</p>
            )}
            {hasReviewedContent && (
              <Button variant="outline" onClick={() => setPhase("review")}>
                Review outputs
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="problem-name">Problem title</Label>
          <Input
            id="problem-name"
            type="text"
            value={problemName}
            onChange={(e) => setProblemName(e.target.value)}
            placeholder="e.g. Two Sum"
            disabled={isRunning}
            className="h-12 border-2 border-border bg-background text-lg font-semibold shadow-sm"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Label className="text-sm text-muted-foreground mr-2">Input format</Label>
          <Chip selected={rawInputMode === "separate"} onClick={() => setRawInputMode("separate")}>
            Separate fields
          </Chip>
          <Chip selected={rawInputMode === "combined"} onClick={() => setRawInputMode("combined")}>
            Combined file
          </Chip>
        </div>

        {rawInputMode === "separate" ? (
          <div className="grid items-stretch gap-4 lg:grid-cols-2">
            <section className="flex flex-col overflow-hidden rounded-xl border-2 border-border bg-card shadow-sm">
              <div className="border-b bg-muted/50 px-4 py-3">
                <h3 className="text-sm font-semibold">Problem statement</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Raw HTML or plain text from the source problem.
                </p>
              </div>
              <div className="flex flex-1 flex-col p-4">
                <Textarea
                  value={rawProblemStatement}
                  onChange={(e) => setRawProblemStatement(e.target.value)}
                  disabled={isRunning}
                  placeholder="Paste the raw problem statement here…"
                  className="min-h-[280px] flex-1 resize-y border-2 border-border bg-background font-mono text-sm shadow-inner"
                />
              </div>
            </section>

            <section className="flex flex-col overflow-hidden rounded-xl border-2 border-border bg-card shadow-sm">
              <div className="border-b bg-muted/50 px-4 py-3 space-y-2">
                <div>
                  <h3 className="text-sm font-semibold">Reference solution (optional)</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    C++, Java, or other source code to port to Python.
                  </p>
                </div>
                <div className="flex flex-wrap gap-1">
                  {REFERENCE_LANGUAGES.map((lang) => (
                    <Chip
                      key={lang.id}
                      selected={referenceLanguage === lang.id}
                      onClick={() => setReferenceLanguage(lang.id)}
                    >
                      {lang.label}
                    </Chip>
                  ))}
                </div>
              </div>
              <div className="flex flex-1 flex-col p-4">
                <Textarea
                  value={rawReferenceSolution}
                  onChange={(e) => setRawReferenceSolution(e.target.value)}
                  disabled={isRunning}
                  placeholder="Paste reference solution (optional)…"
                  className="min-h-[280px] flex-1 resize-y border-2 border-border bg-background font-mono text-sm shadow-inner"
                />
              </div>
            </section>
          </div>
        ) : (
          <section className="rounded-xl border-2 border-border bg-card shadow-sm p-4 space-y-3">
            <div>
              <h3 className="text-sm font-semibold">Combined input file</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Upload a .txt or .md file with{" "}
                <code className="text-xs">=== PROBLEM ===</code> and optional{" "}
                <code className="text-xs">=== SOLUTION ===</code> sections.
              </p>
            </div>
            <div
              className="flex min-h-[200px] flex-col items-center justify-center rounded-lg border-2 border-dashed border-border bg-muted/30 px-6 text-center"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const file = Array.from(e.dataTransfer.files).find(
                  (f) => f.name.endsWith(".txt") || f.name.endsWith(".md")
                );
                if (file) void handleCombinedFile(file);
              }}
            >
              <Upload className="mb-3 h-10 w-10 text-muted-foreground" />
              <label className="cursor-pointer text-sm font-medium text-foreground hover:underline">
                <input
                  type="file"
                  accept=".txt,.md"
                  className="hidden"
                  disabled={isRunning}
                  onChange={(e) => void handleCombinedFile(e.target.files?.[0] || null)}
                />
                {combinedFile ? combinedFile.name : "Choose combined input file"}
              </label>
              {combinedFile && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="mt-3"
                  disabled={isRunning}
                  onClick={() => void handleCombinedFile(null)}
                >
                  Remove file
                </Button>
              )}
            </div>
            {combinedFileText && (
              <p className="text-xs text-muted-foreground">
                Parsed: {parseCombinedInput(combinedFileText).problemStatement.slice(0, 80)}
                {parseCombinedInput(combinedFileText).problemStatement.length > 80 ? "…" : ""}
                {parseCombinedInput(combinedFileText).referenceSolution ? " · includes solution" : ""}
              </p>
            )}
          </section>
        )}

        <div className="space-y-2">
          <Label className="text-sm text-muted-foreground">Generation log</Label>
          <PrepLogPanel logs={logs} />
        </div>

        <div className="flex items-center justify-between border-t pt-4">
          <Button
            variant="outline"
            disabled={isRunning}
            onClick={() => setPhase("pick")}
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
          <Button onClick={handleGenerate} disabled={isRunning || !canGenerate()}>
            {isRunning ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Generating…
              </>
            ) : (
              <>
                <Sparkles className="mr-2 h-4 w-4" />
                Generate problem.md & solution.py
              </>
            )}
          </Button>
        </div>
      </div>
    );
  }

  // ── Phase 3: Review generated outputs ──────────────────────────────
  if (phase === "review") {
    return (
      <div className="mx-auto max-w-7xl space-y-6 py-2">
        <div className="flex items-center justify-between gap-4">
          <button
            type="button"
            onClick={() => setPhase("prepare")}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to prepare
          </button>
          <WizardSteps current="review" />
        </div>

        <div className="flex flex-wrap gap-2">
          <span className="inline-flex items-center rounded-full bg-muted px-3 py-1 text-xs font-medium">
            {preset.title}
          </span>
          <span className="inline-flex items-center rounded-full bg-muted px-3 py-1 text-xs font-medium">
            {structureLabel}
          </span>
        </div>

        <div className="space-y-2">
          <Label htmlFor="review-problem-name">Problem name</Label>
          <Input
            id="review-problem-name"
            type="text"
            value={problemName}
            onChange={(e) => setProblemName(e.target.value)}
            placeholder="e.g. Two Sum"
            className="h-12 border-2 border-border bg-background text-lg font-semibold shadow-sm"
          />
        </div>

        {prepResult && (
          <>
            <VerificationBanner result={prepResult} />
            <ExampleResults result={prepResult} />
            {prepResult.usage && (
              <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
                <span className="font-medium text-foreground">API usage: </span>
                {prepResult.usage.calls} call{prepResult.usage.calls === 1 ? "" : "s"},{" "}
                {prepResult.usage.totalTokens.toLocaleString()} tokens (~$
                {prepResult.usage.estimatedCostUsd.toFixed(4)} estimated, {prepResult.usage.model}).
                Also recorded under Admin → OpenRouter with purpose{" "}
                <code className="text-xs">cp_prep</code>.
              </div>
            )}
          </>
        )}

        <div className="grid items-stretch gap-4 lg:grid-cols-2">
          <section className="flex flex-col overflow-hidden rounded-xl border-2 border-border bg-card shadow-sm">
            <div className="border-b bg-muted/50 px-4 py-3">
              <h3 className="text-sm font-semibold">problem.md</h3>
              <p className="text-xs text-muted-foreground">Edit before continuing.</p>
            </div>
            <div className="flex flex-1 flex-col p-4">
              <Textarea
                value={generatedProblemMd}
                onChange={(e) => setGeneratedProblemMd(e.target.value)}
                className="min-h-[360px] flex-1 resize-y border-2 border-border bg-background font-mono text-sm shadow-inner"
              />
            </div>
          </section>

          <section className="flex flex-col overflow-hidden rounded-xl border-2 border-border bg-card shadow-sm">
            <div className="border-b bg-muted/50 px-4 py-3">
              <h3 className="text-sm font-semibold">solution.py</h3>
              <p className="text-xs text-muted-foreground">Edit before continuing.</p>
            </div>
            <div className="flex flex-1 flex-col p-4">
              <Textarea
                value={generatedSolutionPy}
                onChange={(e) => setGeneratedSolutionPy(e.target.value)}
                className="min-h-[360px] flex-1 resize-y border-2 border-border bg-background font-mono text-sm shadow-inner"
              />
            </div>
          </section>
        </div>

        {prepResult?.report && (
          <section className="rounded-xl border border-border bg-card">
            <button
              type="button"
              onClick={() => setReportExpanded((v) => !v)}
              className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium hover:bg-muted/50"
            >
              Verification report
              {reportExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
            {reportExpanded && (
              <div className="border-t px-4 py-4 max-h-[480px] overflow-auto">
                <MarkdownProse text={prepResult.report} />
              </div>
            )}
          </section>
        )}

        <div className="flex items-center justify-between border-t pt-4">
          <Button variant="outline" onClick={() => setPhase("prepare")}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Regenerate
          </Button>
          <div className="flex items-center gap-2">
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button variant="outline" onClick={() => setPhase("advanced")} disabled={!hasReviewedContent}>
              Advanced settings
            </Button>
            <Button onClick={handleUpload} disabled={uploading || !canSubmit || createdRef.current}>
              {uploading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating…
                </>
              ) : (
                "Create Problem"
              )}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ── Phase 4: Advanced settings ────────────────────────────────────
  return (
    <div className="mx-auto max-w-7xl space-y-6 py-2">
      <div className="flex items-center justify-between gap-4">
        <button
          type="button"
          onClick={() => setPhase("review")}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to review
        </button>
        <WizardSteps current="advanced" />
      </div>

      <div className="flex flex-wrap gap-2">
        <span className="inline-flex items-center rounded-full bg-muted px-3 py-1 text-xs font-medium">
          {preset.title}
        </span>
        <span className="inline-flex items-center rounded-full bg-muted px-3 py-1 text-xs font-medium">
          {structureLabel}
        </span>
        <span className="inline-flex items-center rounded-full bg-muted px-3 py-1 text-xs font-medium truncate max-w-[200px]">
          {problemName}
        </span>
      </div>

      <ProblemAdvancedSettings
        mode={mode}
        scenarioLevel={scenarioLevel}
        onScenarioLevelChange={setScenarioLevel}
        difficulty={difficulty}
        onDifficultyChange={setDifficulty}
        score={score}
        onScoreChange={setScore}
        companies={companies}
        onCompaniesChange={setCompanies}
        sharedMemberIds={sharedMemberIds}
        onSharedMemberIdsChange={setSharedMemberIds}
      />

      <div className="flex items-center justify-between gap-4 border-t pt-4">
        <Button variant="outline" onClick={() => setPhase("review")}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
        <div className="flex items-center gap-2">
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button onClick={handleUpload} disabled={uploading || !canSubmit || createdRef.current}>
            {uploading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Creating…
              </>
            ) : (
              "Create Problem"
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
