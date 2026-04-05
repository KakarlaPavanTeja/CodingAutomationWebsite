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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProblemPipeline } from "@/components/problems/ProblemPipeline";
import { ProblemOutputs } from "@/components/problems/ProblemOutputs";
import { cn } from "@/lib/utils";

type Problem = {
  id: string;
  name: string;
  question_type: string;
  mode: string;
  scenario_level: string;
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
  status: string;
  exit_code: number | null;
  started_at: string;
  finished_at: string | null;
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
  generate_testcases: "Generate Test Cases",
  split_code: "Split Code",
  execute_tests_function: "Execute Tests (Function)",
  execute_tests_nonfunction: "Execute Tests (Non-function)",
  generate_enrichment: "Generate Enrichment",
  package_platform: "Package for Platform",
};

type Tab = "overview" | "pipeline" | "outputs";

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "pipeline", label: "Pipeline", icon: Play },
  { id: "outputs", label: "Outputs", icon: FolderOpen },
];

function formatDuration(start: string, end: string | null): string {
  if (!end) return "—";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

export default function ProblemDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const { profile } = useAuth();
  const { toast } = useToast();
  const [problem, setProblem] = useState<Problem | null>(null);
  const [runs, setRuns] = useState<PipelineRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleteReason, setDeleteReason] = useState("");
  const [deleting, setDeleting] = useState(false);
  const isAdmin = profile?.role === "admin";

  const fetchProblem = () => {
    fetch(`/api/problems/${id}`)
      .then((r) => {
        if (!r.ok) throw new Error("Failed to load problem");
        return r.json();
      })
      .then((data) => {
        setProblem(data.problem);
        setRuns(data.runs || []);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchProblem();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Poll every 5s while problem is processing or any run is still running
  useEffect(() => {
    const isActive =
      problem?.status === "processing" ||
      runs.some((r) => r.status === "running");
    if (!isActive) return;
    const interval = setInterval(() => {
      fetch(`/api/problems/${id}`)
        .then((r) => r.ok ? r.json() : null)
        .then((data) => {
          if (data) {
            setProblem(data.problem);
            setRuns(data.runs || []);
          }
        })
        .catch(() => {});
    }, 5000);
    return () => clearInterval(interval);
  }, [id, problem?.status, runs]);

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

  const handleAdminDelete = async () => {
    setDeleting(true);
    try {
      const res = await fetch(`/api/problems/${id}/delete`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast("Problem permanently deleted.", "success");
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
          <Link href="/problems" className="mt-4 inline-block">
            <Button variant="outline">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to problems
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  const status = STATUS_CONFIG[problem.status] || STATUS_CONFIG.draft;
  const StatusIcon = status.icon;

  return (
    <div className="container mx-auto px-4 py-6 space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
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
          <h1 className="text-2xl font-bold tracking-tight">{problem.name}</h1>
          <div className="flex items-center gap-3 mt-2">
            <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${status.className}`}>
              <StatusIcon className={`h-3 w-3 ${problem.status === "processing" ? "animate-spin" : ""}`} />
              {status.label}
            </span>
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
        <a href={`/api/files/download?problemId=${problem.id}`}>
          <Button variant="outline" size="sm">
            <Download className="mr-2 h-4 w-4" />
            Download
          </Button>
        </a>
      </div>

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
                  "flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px",
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
        <div className="space-y-6">
          {/* Details */}
          <div className="rounded-lg border bg-card p-5 space-y-3">
            <h2 className="text-sm font-semibold">Details</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">Type</p>
                <p className="font-medium capitalize">{problem.question_type.replace("_", " ")}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Mode</p>
                <p className="font-medium capitalize">{problem.mode || "Not set"}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Scenario Level</p>
                <p className="font-medium capitalize">{problem.scenario_level}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Created</p>
                <p className="font-medium">{new Date(problem.created_at).toLocaleDateString()}</p>
              </div>
            </div>
          </div>

          {/* Pipeline Runs */}
          <div className="rounded-lg border bg-card p-5 space-y-3">
            <h2 className="text-sm font-semibold">Pipeline Runs ({runs.length})</h2>
            {runs.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No runs yet. Switch to the{" "}
                <button onClick={() => setActiveTab("pipeline")} className="text-primary hover:underline">
                  Pipeline
                </button>{" "}
                tab to start.
              </p>
            ) : (
              <div className="rounded-md border overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="text-left px-4 py-2 font-medium">Step</th>
                      <th className="text-left px-4 py-2 font-medium">Status</th>
                      <th className="text-left px-4 py-2 font-medium">Exit Code</th>
                      <th className="text-left px-4 py-2 font-medium">Duration</th>
                      <th className="text-left px-4 py-2 font-medium">Started</th>
                    </tr>
                  </thead>
                  <tbody>
                    {runs.map((run) => {
                      const runStatus = STATUS_CONFIG[run.status] || STATUS_CONFIG.draft;
                      const RunIcon = runStatus.icon;
                      return (
                        <tr key={run.id} className="border-b last:border-0">
                          <td className="px-4 py-2 font-medium">
                            {STEP_LABELS[run.step_id] || run.step_id}
                          </td>
                          <td className="px-4 py-2">
                            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${runStatus.className}`}>
                              <RunIcon className={`h-3 w-3 ${run.status === "running" ? "animate-spin" : ""}`} />
                              {runStatus.label}
                            </span>
                          </td>
                          <td className="px-4 py-2 text-muted-foreground font-mono">
                            {run.exit_code !== null ? run.exit_code : "—"}
                          </td>
                          <td className="px-4 py-2 text-muted-foreground">
                            {formatDuration(run.started_at, run.finished_at)}
                          </td>
                          <td className="px-4 py-2 text-muted-foreground">
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

          {/* Admin: approve deletion */}
          {problem.status === "deletion_pending" && isAdmin && (
            <div className="rounded-lg border border-orange-500/30 bg-orange-500/5 p-5 space-y-3">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-orange-500" />
                <h2 className="text-sm font-semibold text-orange-700 dark:text-orange-400">
                  Deletion Requested
                </h2>
              </div>
              <p className="text-sm text-muted-foreground">
                Reason: <span className="text-foreground">{problem.deletion_reason}</span>
              </p>
              <div className="flex gap-2">
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleAdminDelete}
                  disabled={deleting}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  {deleting ? "Deleting..." : "Approve & Delete Permanently"}
                </Button>
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

      {activeTab === "pipeline" && <ProblemPipeline problemId={id} />}

      {activeTab === "outputs" && <ProblemOutputs problemId={id} />}
    </div>
  );
}
