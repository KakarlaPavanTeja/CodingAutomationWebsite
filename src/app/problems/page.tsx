"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  FileText,
  Plus,
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
  ArrowLeft,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { FileUploader } from "@/components/files/FileUploader";
import { usePipeline } from "@/lib/pipeline-context";
import { useToast } from "@/components/ui/toast";
import { useAuth } from "@/lib/auth-context";
import { useProblems } from "@/lib/problems-context";

const STATUS_CONFIG: Record<
  string,
  { icon: React.ElementType; label: string; className: string }
> = {
  draft: {
    icon: Clock,
    label: "Draft",
    className: "bg-gray-500/10 text-gray-600 dark:text-gray-400",
  },
  processing: {
    icon: Loader2,
    label: "Processing",
    className: "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400",
  },
  completed: {
    icon: CheckCircle2,
    label: "Completed",
    className: "bg-green-500/10 text-green-700 dark:text-green-400",
  },
  failed: {
    icon: XCircle,
    label: "Failed",
    className: "bg-red-500/10 text-red-700 dark:text-red-400",
  },
  deletion_pending: {
    icon: AlertTriangle,
    label: "Deletion Pending",
    className: "bg-orange-500/10 text-orange-700 dark:text-orange-400",
  },
};

export default function ProblemsPage() {
  const { problems, loading, refresh } = useProblems();
  const [showUpload, setShowUpload] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const { setCurrentProblemId } = usePipeline();
  const { profile } = useAuth();
  const router = useRouter();
  const { toast } = useToast();
  const isAdmin = profile?.role === "admin";

  // Poll every 5s while any problem is processing — uses the shared cache.
  useEffect(() => {
    const hasProcessing = problems.some((p) => p.status === "processing");
    if (!hasProcessing) return;
    const id = setInterval(() => {
      refresh();
    }, 5000);
    return () => clearInterval(id);
  }, [problems, refresh]);

  // Only show the full-page spinner if we don't have any cached data yet.
  if (loading && problems.length === 0) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="flex items-center justify-center min-h-[40vh]">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {isAdmin ? "All Problems" : "My Problems"}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {isAdmin
              ? "View and manage all problems across users"
              : "Track your uploaded problems and pipeline runs"}
          </p>
        </div>
        {!showUpload && (
          <Button onClick={() => setShowUpload(true)}>
            <Plus className="mr-2 h-4 w-4" />
            New Problem
          </Button>
        )}
      </div>

      {/* Inline Upload Form */}
      {showUpload && (
        <div className="space-y-3 animate-in fade-in slide-in-from-top-4 duration-300">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Upload New Problem</h2>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowUpload(false)}
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              Cancel
            </Button>
          </div>
          <FileUploader
            onUploadComplete={(problemId) => {
              if (problemId) {
                setCurrentProblemId(problemId);
                toast("Problem uploaded! Opening pipeline...", "success");
                setShowUpload(false);
                router.push(`/problems/${problemId}`);
              }
            }}
          />
        </div>
      )}

      {/* Problems List */}
      {!showUpload && problems.length === 0 ? (
        <div className="rounded-lg border bg-card p-12 text-center">
          <FileText className="mx-auto h-12 w-12 text-muted-foreground/50 mb-4" />
          <h2 className="text-lg font-semibold">No problems yet</h2>
          <p className="text-sm text-muted-foreground mt-1 mb-4">
            Upload a problem and run the pipeline to get started.
          </p>
          <Button onClick={() => setShowUpload(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Create your first problem
          </Button>
        </div>
      ) : (
        !showUpload && (
          <div className="space-y-3">
            <div className="rounded-lg border overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left px-4 py-3 font-medium">Problem</th>
                    {isAdmin && (
                      <th className="text-left px-4 py-3 font-medium">
                        Created By
                      </th>
                    )}
                    <th className="text-left px-4 py-3 font-medium">Type</th>
                    <th className="text-left px-4 py-3 font-medium">Mode</th>
                    <th className="text-left px-4 py-3 font-medium">Difficulty</th>
                    <th className="text-left px-4 py-3 font-medium">Score</th>
                    <th className="text-left px-4 py-3 font-medium">Status</th>
                    <th className="text-left px-4 py-3 font-medium">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {(showAll ? problems : problems.slice(0, 5)).map((p) => {
                    const status =
                      STATUS_CONFIG[p.status] || STATUS_CONFIG.draft;
                    const StatusIcon = status.icon;
                    return (
                      <tr
                        key={p.id}
                        className="border-b last:border-0 hover:bg-muted/30 transition-colors"
                      >
                        <td className="px-4 py-3">
                          <Link
                            href={`/problems/${p.id}`}
                            className="font-medium text-primary hover:underline underline-offset-4"
                          >
                            {p.name}
                          </Link>
                        </td>
                        {isAdmin && (
                          <td className="px-4 py-3 text-muted-foreground">
                            {p.profiles?.display_name || p.profiles?.email || "—"}
                          </td>
                        )}
                        <td className="px-4 py-3 text-muted-foreground capitalize">
                          {p.question_type.replace("_", " ")}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground capitalize">
                          {p.mode || "—"}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground capitalize">
                          {p.difficulty || "—"}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {p.score ?? "—"}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${status.className}`}
                          >
                            <StatusIcon
                              className={`h-3 w-3 ${p.status === "processing" ? "animate-spin" : ""}`}
                            />
                            {status.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {new Date(p.created_at).toLocaleDateString()}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {problems.length > 5 && (
              <div className="flex justify-center">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowAll(!showAll)}
                  className="text-sm text-muted-foreground hover:text-foreground"
                >
                  {showAll ? "Show recent 5" : `View all ${problems.length} problems`}
                </Button>
              </div>
            )}
          </div>
        )
      )}
    </div>
  );
}
