"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/components/ui/toast";
import {
  ArrowLeft,
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
  Download,
  LayoutDashboard,
  Play,
  FolderOpen,
  Trash2,
  AlertTriangle,
  FileText,
  Code,
  BookOpen,
  ListChecks,
  Users,
} from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ProblemPipeline } from "@/components/problems/ProblemPipeline";
import { ProblemOutputs } from "@/components/problems/ProblemOutputs";
import { ProblemEditorial } from "@/components/problems/ProblemEditorial";
import { ProblemExecutionLogs } from "@/components/problems/ProblemExecutionLogs";
import { ManageAccessDialog } from "@/components/problems/MemberAccess";
import { cn } from "@/lib/utils";
import { formatPipelineCost, formatStepCostDisplay, formatTokenCount } from "@/lib/pipeline-usage-match";
import { parsePipelineRunStepKey } from "@/lib/pipeline-run-label";
import { getStepConfig } from "@/lib/pipeline-config";

type Problem = {
  id: string;
  created_by?: string;
  name: string;
  question_type: string;
  structure_type?: string;
  mode: string;
  scenario_level: string;
  difficulty?: string | null;
  score?: number | null;
  status: string;
  languages: string[];
  storage_path: string;
  deletion_reason: string | null;
  created_at: string;
  updated_at: string;
};

type PipelineRun = {
  id: string;
  step_id: string;
  run_step_key?: string;
  step_label?: string;
  substep_label?: string;
  status: string;
  exit_code: number | null;
  started_at: string;
  finished_at: string | null;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    cost_usd: number;
    call_count: number;
  } | null;
};

type UsageSummary = {
  prompt_tokens: number;
  completion_tokens: number;
  cost_usd: number;
  call_count: number;
};

type OptimalWarning = {
  reason: string;
  mismatches: { input: string; optimal: string; brute: string }[];
};

const STATUS_CONFIG: Record<string, { icon: React.ElementType; label: string; className: string }> = {
  draft: { icon: Clock, label: "Draft", className: "bg-gray-500/10 text-gray-600 dark:text-gray-400" },
  processing: { icon: Loader2, label: "Processing", className: "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400" },
  completed: { icon: CheckCircle2, label: "Completed", className: "bg-green-500/10 text-green-700 dark:text-green-400" },
  failed: { icon: XCircle, label: "Failed", className: "bg-red-500/10 text-red-700 dark:text-red-400" },
  running: { icon: Loader2, label: "Running", className: "bg-blue-500/10 text-blue-700 dark:text-blue-400" },
  deletion_pending: { icon: AlertTriangle, label: "Deletion Pending", className: "bg-orange-500/10 text-orange-700 dark:text-orange-400" },
};

const STEP_LABELS: Record<string, string> = {
  generate_question: "Generate Question",
  generate_brute_force: "Generate Brute Force",
  generate_testcases: "Generate Test Cases",
  generate_wrong_solutions: "Generate Wrong Solutions",
  benchmark_testcases: "Benchmark Test Cases",
  harden_testcases: "Strengthen Test Cases",
  split_code: "Split Code",
  execute_tests_function: "Execute Tests (Function)",
  execute_tests_nonfunction: "Execute Tests (Non-function)",
  generate_enrichment: "Generate Enrichment",
  package_platform: "Package for Platform",
  generate_editorial: "Generate Editorial",
  execute_editorial: "Execute Editorial Solutions",
  prepare_platform_json: "Prepare Platform JSON",
};

function pipelineRunStepLabel(run: PipelineRun): { step: string; substep: string } {
  if (run.step_label && run.substep_label) {
    return { step: run.step_label, substep: run.substep_label };
  }
  const step = STEP_LABELS[run.step_id] || run.step_id;
  return { step, substep: step };
}

function pipelineRunCostLabel(run: PipelineRun): string {
  const key = run.run_step_key ?? run.step_id;
  const { parentStepId } = parsePipelineRunStepKey(key);
  const llmUsage = getStepConfig(parentStepId).llmUsage;
  return formatStepCostDisplay(run.usage?.cost_usd, llmUsage, run.status);
}

function formatRunDuration(start: string, end: string | null, status: string): string {
  const endMs = end ? new Date(end).getTime() : status === "running" ? Date.now() : null;
  if (endMs == null) return "";
  const ms = endMs - new Date(start).getTime();
  if (ms < 0) return "";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

type Tab = "overview" | "pipeline" | "outputs" | "editorial" | "execution-logs";

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "pipeline", label: "Pipeline", icon: Play },
  { id: "outputs", label: "Outputs", icon: FolderOpen },
  { id: "editorial", label: "Editorial", icon: BookOpen },
  { id: "execution-logs", label: "Execution Logs", icon: ListChecks },
];

export default function ProblemDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const { profile } = useAuth();
  const { toast } = useToast();
  const [problem, setProblem] = useState<Problem | null>(null);
  const [runs, setRuns] = useState<PipelineRun[]>([]);
  const [usageSummary, setUsageSummary] = useState<UsageSummary | null>(null);
  const [optimalWarning, setOptimalWarning] = useState<OptimalWarning | null>(null);
  const [warningExpanded, setWarningExpanded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleteReason, setDeleteReason] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [inputFiles, setInputFiles] = useState<{ name: string; content: string; expanded: boolean }[]>([]);
  const [inputFilesLoading, setInputFilesLoading] = useState(true);
  const [editingMeta, setEditingMeta] = useState(false);
  const [editDifficulty, setEditDifficulty] = useState<string>("");
  const [editScore, setEditScore] = useState<string>("");
  const [savingMeta, setSavingMeta] = useState(false);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [showShareDialog, setShowShareDialog] = useState(false);
  const isAdmin = profile?.role === "admin";
  const isOwner = !!problem?.created_by && problem.created_by === profile?.id;
  const canManageAccess = isAdmin || isOwner;

  const startEditMeta = () => {
    setEditDifficulty(problem?.difficulty || "");
    setEditScore(problem?.score != null ? String(problem.score) : "");
    setMetaError(null);
    setEditingMeta(true);
  };

  const handleSaveMeta = async () => {
    setSavingMeta(true);
    setMetaError(null);
    try {
      const res = await fetch(`/api/problems/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          difficulty: editDifficulty || null,
          score: editScore.trim() === "" ? null : Number(editScore),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save");
      setProblem((prev) =>
        prev ? { ...prev, difficulty: data.difficulty, score: data.score } : prev
      );
      setEditingMeta(false);
    } catch (err) {
      setMetaError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSavingMeta(false);
    }
  };

  const fetchProblem = () => {
    fetch(`/api/problems/${id}`)
      .then((r) => {
        if (!r.ok) throw new Error("Failed to load problem");
        return r.json();
      })
      .then((data) => {
        setProblem(data.problem);
        setRuns(data.runs || []);
        setUsageSummary(data.usage_summary ?? null);
        setOptimalWarning(data.optimal_warning ?? null);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  };

  const fetchInputFiles = () => {
    setInputFilesLoading(true);

    const readFileContent = (filePath: string, subfolder: "inputs" | "outputs") =>
      fetch(
        `/api/files/read?problemId=${id}&path=${encodeURIComponent(filePath)}&subfolder=${subfolder}`
      )
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);

    fetch(`/api/files/inputs?problemId=${id}`)
      .then((r) => (r.ok ? r.json() : { files: [] }))
      .then(async (data) => {
        const names = (data.files ?? [])
          .filter((f: { isDirectory?: boolean }) => !f.isDirectory)
          .map((f: { path: string }) => f.path);

        let entries: { name: string; content: string; expanded: boolean }[] = [];

        if (names.length > 0) {
          const results = await Promise.all(
            names.map(async (name: string) => {
              const fileData = await readFileContent(name, "inputs");
              return fileData ? { name, content: fileData.content, expanded: false } : null;
            })
          );
          entries = results.filter(Boolean) as typeof entries;
        } else {
          const fallbacks = [
            {
              name: "problem.md (from generated description)",
              path: "generated_description.md",
              subfolder: "outputs" as const,
            },
            {
              name: "solution.py (from generated code)",
              path: "generatedFullCode/PYTHON.py",
              subfolder: "outputs" as const,
            },
          ];
          const results = await Promise.all(
            fallbacks.map(async ({ name, path, subfolder }) => {
              const fileData = await readFileContent(path, subfolder);
              return fileData ? { name, content: fileData.content, expanded: false } : null;
            })
          );
          entries = results.filter(Boolean) as typeof entries;
        }

        setInputFiles(entries);
      })
      .catch(() => setInputFiles([]))
      .finally(() => setInputFilesLoading(false));
  };

  useEffect(() => {
    fetchProblem();
    fetchInputFiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (problem?.name) {
      document.title = `${problem.name} - Coding Automation`;
    }
    return () => {
      document.title = "Coding Automation";
    };
  }, [problem?.name]);

  const anyRunning = runs.some((r) => r.status === "running");

  // Poll every 5s while problem is processing or any run is still running.
  // Depend on a derived boolean (not the `runs` array) so the interval isn't
  // torn down and recreated on every poll.
  useEffect(() => {
    const isActive = problem?.status === "processing" || anyRunning;
    if (!isActive) return;
    const interval = setInterval(() => {
      fetch(`/api/problems/${id}`)
        .then((r) => r.ok ? r.json() : null)
        .then((data) => {
          if (data) {
            setProblem(data.problem);
            setRuns(data.runs || []);
            setUsageSummary(data.usage_summary ?? null);
            setOptimalWarning(data.optimal_warning ?? null);
          }
        })
        .catch(() => {});
    }, 5000);
    return () => clearInterval(interval);
  }, [id, problem?.status, anyRunning]);

  const handleRequestDeletion = async () => {
    if (!deleteReason.trim() || deleteReason.trim().length < 5) {
      toast("Please provide a reason (at least 5 characters).", "error");
      return;
    }
    setDeleting(true);
    try {
      const res = await fetch(`/api/problems/${id}/delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: deleteReason.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast("Deletion requested. Waiting for admin approval.", "success");
      setProblem((prev) => prev ? { ...prev, status: "deletion_pending", deletion_reason: deleteReason.trim() } : prev);
      setShowDeleteDialog(false);
      setDeleteReason("");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to request deletion", "error");
    } finally {
      setDeleting(false);
    }
  };

  const [adminDeleteReason, setAdminDeleteReason] = useState("");
  const [showAdminDeleteDialog, setShowAdminDeleteDialog] = useState(false);

  const handleAdminDelete = async () => {
    if (adminDeleteReason.trim().length < 5) {
      toast("Please provide a reason (at least 5 characters).", "error");
      return;
    }
    setDeleting(true);
    try {
      const res = await fetch(`/api/problems/${id}/delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: adminDeleteReason.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast("Problem deleted. Files will be removed after 5 hours.", "success");
      router.push("/problems");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to delete", "error");
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="flex items-center justify-center min-h-[40vh]">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  if (error || !problem) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="rounded-lg border bg-card p-8 text-center">
          <p className="text-destructive">{error || "Problem not found."}</p>
          <Link
            href="/problems"
            className={cn(buttonVariants({ variant: "outline" }), "mt-4 inline-flex")}
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to problems
          </Link>
        </div>
      </div>
    );
  }

  const status = STATUS_CONFIG[problem.status] || STATUS_CONFIG.draft;
  const StatusIcon = status.icon;

  return (
    <div className="container mx-auto px-4 py-4 space-y-3 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <Link
            href="/problems"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to problems
          </Link>
          <h1 className="text-xl font-bold tracking-tight">{problem.name}</h1>
          <div className="flex items-center gap-2 mt-1.5">
            <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${status.className}`}>
              <StatusIcon className={`h-3 w-3 ${problem.status === "processing" ? "animate-spin" : ""}`} />
              {status.label}
            </span>
            {optimalWarning && (
              <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium bg-red-500/10 text-red-700 dark:text-red-400">
                <AlertTriangle className="h-3 w-3" />
                Optimal may be buggy
              </span>
            )}
            <span className="text-sm text-muted-foreground">
              Type: <span className="text-foreground font-medium">{problem.question_type === "function" ? "Function-based" : "Non-function"}</span>
            </span>
            <span className="text-muted-foreground">|</span>
            {problem.mode && (
              <span className="text-sm text-muted-foreground">
                Mode: <span className="text-foreground font-medium capitalize">{problem.mode}</span>
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {canManageAccess && (
            <Button variant="outline" size="sm" onClick={() => setShowShareDialog(true)}>
              <Users className="mr-2 h-4 w-4" />
              Manage access
            </Button>
          )}
          <a
            href={`/api/files/download?problemId=${problem.id}`}
            className={cn(buttonVariants({ variant: "outline", size: "sm" }), "inline-flex")}
          >
            <Download className="mr-2 h-4 w-4" />
            Download
          </a>
        </div>
      </div>

      {canManageAccess && (
        <ManageAccessDialog
          problemId={problem.id}
          open={showShareDialog}
          onClose={() => setShowShareDialog(false)}
        />
      )}

      {/* Buggy-optimal warning (reference solution disagrees with the brute force) */}
      {optimalWarning && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3 space-y-2">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <h2 className="text-sm font-semibold text-red-700 dark:text-red-400">
                Reference solution may be buggy
              </h2>
              <p className="text-xs text-muted-foreground">
                The reference (optimal) solution disagrees with the independent brute-force oracle
                on small inputs. Test cases are derived from the reference, so their expected
                outputs are likely wrong. Review and fix the optimal solution before trusting this
                problem.
              </p>
            </div>
          </div>
          {optimalWarning.mismatches.length > 0 && (
            <div className="pl-6">
              <button
                type="button"
                onClick={() => setWarningExpanded((v) => !v)}
                className="text-[11px] text-red-700 dark:text-red-400 hover:underline underline-offset-2"
              >
                {warningExpanded
                  ? "Hide disagreeing inputs"
                  : `Show ${optimalWarning.mismatches.length} disagreeing input${optimalWarning.mismatches.length === 1 ? "" : "s"}`}
              </button>
              {warningExpanded && (
                <div className="mt-2 rounded-md border border-red-500/20 bg-background overflow-x-auto">
                  <table className="w-full text-[11px]">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="text-left px-2 py-1 font-medium">Input</th>
                        <th className="text-left px-2 py-1 font-medium">Optimal</th>
                        <th className="text-left px-2 py-1 font-medium">Brute</th>
                      </tr>
                    </thead>
                    <tbody>
                      {optimalWarning.mismatches.map((m, i) => (
                        <tr key={i} className="border-b last:border-0 align-top">
                          <td className="px-2 py-1">
                            <pre className="whitespace-pre-wrap font-mono">{m.input.trim()}</pre>
                          </td>
                          <td className="px-2 py-1 font-mono text-red-600 dark:text-red-400">{m.optimal}</td>
                          <td className="px-2 py-1 font-mono text-green-700 dark:text-green-400">{m.brute}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Tabs */}
      <div className="border-b">
        <nav className="flex gap-1">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-colors -mb-px",
                  activeTab === tab.id
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/30"
                )}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Tab Content */}
      {activeTab === "overview" && (
        <div className="space-y-3">
          {/* Details */}
          <div className="rounded-lg border bg-card p-3 space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Details</h2>
              {!editingMeta && (
                <Button variant="outline" size="sm" onClick={startEditMeta}>
                  Edit
                </Button>
              )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 text-xs">
              <div>
                <p className="text-muted-foreground text-[11px]">Type</p>
                <p className="font-medium capitalize">{problem.question_type.replace("_", " ")}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-[11px]">Structure</p>
                <p className="font-medium capitalize">{(problem.structure_type || "standard").replace("_", " ")}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-[11px]">Mode</p>
                <p className="font-medium capitalize">{problem.mode || "Not set"}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-[11px]">Scenario Level</p>
                <p className="font-medium capitalize">{problem.scenario_level}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-[11px]">Difficulty</p>
                <p className="font-medium capitalize">{problem.difficulty || "Not set"}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-[11px]">Score</p>
                <p className="font-medium">{problem.score ?? "Not set"}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-[11px]">Created</p>
                <p className="font-medium">{new Date(problem.created_at).toLocaleDateString()}</p>
              </div>
            </div>

            {editingMeta && (
              <div className="mt-2 rounded-md border bg-muted/30 p-4 space-y-4">
                <div className="flex flex-wrap items-center gap-6">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">Difficulty</span>
                    <div className="flex gap-1.5">
                      {([
                        { id: "", label: "AI's choice" },
                        { id: "easy", label: "Easy" },
                        { id: "medium", label: "Medium" },
                        { id: "hard", label: "Hard" },
                      ] as const).map((opt) => (
                        <button
                          key={opt.id || "none"}
                          type="button"
                          onClick={() => setEditDifficulty(opt.id)}
                          className={cn(
                            "px-3 py-1.5 rounded-md text-sm font-medium transition-colors border",
                            editDifficulty === opt.id
                              ? "bg-primary text-primary-foreground border-primary"
                              : "bg-background text-foreground border-border hover:bg-muted"
                          )}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">Score</span>
                    <Input
                      type="number"
                      min={1}
                      max={100000}
                      placeholder="e.g. 100"
                      value={editScore}
                      onChange={(e) => setEditScore(e.target.value)}
                      className="w-28"
                    />
                  </div>
                </div>
                {metaError && <p className="text-sm text-destructive">{metaError}</p>}
                <div className="flex gap-2">
                  <Button size="sm" onClick={handleSaveMeta} disabled={savingMeta}>
                    {savingMeta ? "Saving…" : "Save"}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setEditingMeta(false)}
                    disabled={savingMeta}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* Input Files */}
          <div className="rounded-lg border bg-card p-3 space-y-2">
            <h2 className="text-sm font-semibold">Input Files</h2>
            {inputFilesLoading ? (
              <p className="text-xs text-muted-foreground py-2">Loading input files…</p>
            ) : inputFiles.length === 0 ? (
              <p className="text-xs text-muted-foreground py-2">
                No input files found. Original uploads may be missing from storage; run any
                pipeline step again to refresh the local copy, or re-upload the problem files.
              </p>
            ) : (
              <div className="space-y-2">
                {inputFiles.map((file, idx) => (
                  <div key={file.name} className="rounded-md border overflow-hidden">
                    <button
                      type="button"
                      className="flex items-center gap-2 w-full px-3 py-2 text-xs font-medium hover:bg-muted/50 transition-colors text-left"
                      onClick={() =>
                        setInputFiles((prev) =>
                          prev.map((f, i) => (i === idx ? { ...f, expanded: !f.expanded } : f))
                        )
                      }
                    >
                      {file.name.endsWith(".md") ? (
                        <FileText className="h-4 w-4 text-blue-500 shrink-0" />
                      ) : (
                        <Code className="h-4 w-4 text-green-500 shrink-0" />
                      )}
                      <span>{file.name}</span>
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className={cn(
                          "ml-auto transition-transform text-muted-foreground",
                          file.expanded && "rotate-180"
                        )}
                      >
                        <path d="m6 9 6 6 6-6" />
                      </svg>
                    </button>
                    {file.expanded && (
                      <div className="border-t bg-muted/30">
                        <pre className="p-4 text-xs overflow-x-auto max-h-80 overflow-y-auto whitespace-pre-wrap font-mono">
                          {file.content}
                        </pre>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Pipeline Runs */}
          <div className="rounded-lg border bg-card p-3 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">Pipeline Runs ({runs.length})</h2>
              {usageSummary && usageSummary.call_count > 0 && (
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                  <span>
                    Total cost:{" "}
                    <span className="font-medium text-foreground tabular-nums">
                      {formatPipelineCost(usageSummary.cost_usd)}
                    </span>
                  </span>
                  <span>
                    Input tokens:{" "}
                    <span className="font-medium text-foreground tabular-nums">
                      {formatTokenCount(usageSummary.prompt_tokens)}
                    </span>
                  </span>
                  <span>
                    Output tokens:{" "}
                    <span className="font-medium text-foreground tabular-nums">
                      {formatTokenCount(usageSummary.completion_tokens)}
                    </span>
                  </span>
                </div>
              )}
            </div>
            {runs.length === 0 ? (
              <p className="text-xs text-muted-foreground py-2 text-center">
                No runs yet. Switch to the{" "}
                <button onClick={() => setActiveTab("pipeline")} className="text-primary hover:underline">
                  Pipeline
                </button>{" "}
                tab to start.
              </p>
            ) : (
              <div className="rounded-md border overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="text-left px-3 py-1.5 font-medium">Step</th>
                      <th className="text-left px-3 py-1.5 font-medium">Substep</th>
                      <th className="text-left px-3 py-1.5 font-medium">Status</th>
                      <th className="text-left px-3 py-1.5 font-medium">Duration</th>
                      <th className="text-right px-3 py-1.5 font-medium">Cost</th>
                      <th className="text-left px-3 py-1.5 font-medium">Started</th>
                    </tr>
                  </thead>
                  <tbody>
                    {runs.map((run) => {
                      const runStatus = STATUS_CONFIG[run.status] || STATUS_CONFIG.draft;
                      const RunIcon = runStatus.icon;
                      const { step, substep } = pipelineRunStepLabel(run);
                      return (
                        <tr key={run.id} className="border-b last:border-0">
                          <td className="px-3 py-1.5 font-medium">{step}</td>
                          <td className="px-3 py-1.5 text-muted-foreground">{substep}</td>
                          <td className="px-3 py-1.5">
                            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${runStatus.className}`}>
                              <RunIcon className={`h-3 w-3 ${run.status === "running" ? "animate-spin" : ""}`} />
                              {runStatus.label}
                            </span>
                          </td>
                          <td className="px-3 py-1.5 text-muted-foreground">
                            {formatRunDuration(run.started_at, run.finished_at, run.status)}
                          </td>
                          <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                            {pipelineRunCostLabel(run)}
                          </td>
                          <td className="px-3 py-1.5 text-muted-foreground">
                            {new Date(run.started_at).toLocaleString()}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Deletion Pending Banner (for problem setter) */}
          {problem.status === "deletion_pending" && !isAdmin && (
            <div className="rounded-lg border border-orange-500/30 bg-orange-500/5 p-5 space-y-2">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-orange-500" />
                <h2 className="text-sm font-semibold text-orange-700 dark:text-orange-400">
                  Deletion Pending Admin Approval
                </h2>
              </div>
              <p className="text-sm text-muted-foreground">
                Reason: <span className="text-foreground">{problem.deletion_reason}</span>
              </p>
            </div>
          )}

          {/* Admin: approve deletion request */}
          {problem.status === "deletion_pending" && isAdmin && (
            <div className="rounded-lg border border-orange-500/30 bg-orange-500/5 p-5 space-y-3">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-orange-500" />
                <h2 className="text-sm font-semibold text-orange-700 dark:text-orange-400">
                  Deletion Requested by Problem Setter
                </h2>
              </div>
              <p className="text-sm text-muted-foreground">
                Reason: <span className="text-foreground">{problem.deletion_reason}</span>
              </p>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => {
                  setAdminDeleteReason(problem.deletion_reason || "Approved deletion request");
                  setShowAdminDeleteDialog(true);
                }}
                disabled={deleting}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Approve & Delete
              </Button>
            </div>
          )}

          {/* Admin: delete any problem */}
          {isAdmin && problem.status !== "deletion_pending" && (
            <div className="rounded-lg border border-destructive/30 bg-card p-5 space-y-3">
              <h2 className="text-sm font-semibold text-destructive">Admin: Delete Problem</h2>
              <p className="text-sm text-muted-foreground">
                Delete this problem and notify the problem setter. Files will be permanently removed after 5 hours.
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowAdminDeleteDialog(true)}
                className="border-destructive/50 text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete Problem
              </Button>
            </div>
          )}

          {/* Admin delete reason dialog */}
          {showAdminDeleteDialog && isAdmin && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
              <div className="bg-card border rounded-lg p-6 w-full max-w-md space-y-4 shadow-lg mx-4">
                <h3 className="font-semibold">Delete Problem</h3>
                <p className="text-sm text-muted-foreground">
                  This will soft-delete <span className="font-medium text-foreground">{problem.name}</span>.
                  Files will be permanently removed after 5 hours.
                </p>
                <div className="space-y-2">
                  <label className="text-sm font-medium">
                    Reason for the problem setter <span className="text-destructive">*</span>
                  </label>
                  <textarea
                    value={adminDeleteReason}
                    onChange={(e) => setAdminDeleteReason(e.target.value)}
                    placeholder="Why are you deleting this problem? (min 5 characters)"
                    className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[80px] resize-none"
                  />
                </div>
                <div className="flex gap-2 justify-end">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => { setShowAdminDeleteDialog(false); setAdminDeleteReason(""); }}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={handleAdminDelete}
                    disabled={deleting || adminDeleteReason.trim().length < 5}
                  >
                    {deleting ? "Deleting..." : "Delete Problem"}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Delete button for problem setter (only for non-completed, non-pending) */}
          {!isAdmin &&
            problem.status !== "completed" &&
            problem.status !== "deletion_pending" && (
              <div className="rounded-lg border border-destructive/30 bg-card p-5 space-y-3">
                <h2 className="text-sm font-semibold text-destructive">Delete Problem</h2>
                <p className="text-sm text-muted-foreground">
                  Request deletion of this problem. An admin will review and approve.
                </p>
                {!showDeleteDialog ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowDeleteDialog(true)}
                    className="border-destructive/50 text-destructive hover:bg-destructive/10"
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Request Deletion
                  </Button>
                ) : (
                  <div className="space-y-3 animate-in fade-in duration-200">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">
                        Reason for deletion <span className="text-destructive">*</span>
                      </label>
                      <textarea
                        value={deleteReason}
                        onChange={(e) => setDeleteReason(e.target.value)}
                        placeholder="Why do you want to delete this problem? (minimum 5 characters)"
                        className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[80px] resize-none"
                        required
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={handleRequestDeletion}
                        disabled={deleting || deleteReason.trim().length < 5}
                      >
                        {deleting ? "Requesting..." : "Submit Request"}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setShowDeleteDialog(false);
                          setDeleteReason("");
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
        </div>
      )}

      {activeTab === "pipeline" && <ProblemPipeline problemId={id} onStatusChange={fetchProblem} />}

      {activeTab === "outputs" && <ProblemOutputs problemId={id} />}

      {activeTab === "editorial" && (
        <ProblemEditorial
          problemId={id}
          problemName={problem.name}
          onStatusChange={fetchProblem}
        />
      )}

      {activeTab === "execution-logs" && (
        <ProblemExecutionLogs
          problemId={id}
          questionType={problem.question_type}
          isActive={problem.status === "processing" || runs.some((r) => r.status === "running")}
        />
      )}
    </div>
  );
}
