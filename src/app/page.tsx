"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-context";
import { useProblems } from "@/lib/problems-context";
import {
  Plus,
  FileText,
  CheckCircle2,
  Clock,
  Loader2,
  XCircle,
  ArrowRight,
  BarChart3,
  Sparkles,
  CircleDashed,
} from "lucide-react";
import GuidePage from "@/app/guide/page";
import { WhatsNewTeaser } from "@/components/whats-new/WhatsNewList";
import { getRecentFeatures } from "@/lib/whats-new";

const STATUS_ICON: Record<string, React.ElementType> = {
  draft: Clock,
  processing: Loader2,
  partial: CircleDashed,
  completed: CheckCircle2,
  failed: XCircle,
};

const STATUS_COLOR: Record<string, string> = {
  draft: "text-gray-500",
  processing: "text-yellow-500",
  partial: "text-blue-500",
  completed: "text-green-500",
  failed: "text-red-500",
};

export default function Home() {
  const { user, profile, loading: authLoading } = useAuth();
  const { problems, loading } = useProblems();

  const stats = useMemo(() => ({
    total: problems.length,
    completed: problems.filter((x) => x.status === "completed").length,
    processing: problems.filter((x) => x.status === "processing").length,
    partial: problems.filter((x) => x.status === "partial").length,
    failed: problems.filter((x) => x.status === "failed").length,
    draft: problems.filter((x) => x.status === "draft").length,
  }), [problems]);

  const recentUpdates = useMemo(() => getRecentFeatures(4), []);

  if (authLoading) return null;

  if (!user) return <GuidePage />;

  return (
    <div className="px-6 py-8 space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          Welcome back{profile?.display_name ? `, ${profile.display_name}` : ""}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Here&apos;s an overview of your coding automation pipeline
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <FileText className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className={`text-2xl font-bold transition-opacity duration-200 ${loading ? "opacity-40" : ""}`}>{stats.total}</p>
                <p className="text-xs text-muted-foreground">Total Problems</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-500/10">
                <CheckCircle2 className="h-5 w-5 text-green-500" />
              </div>
              <div>
                <p className={`text-2xl font-bold transition-opacity duration-200 ${loading ? "opacity-40" : ""}`}>{stats.completed}</p>
                <p className="text-xs text-muted-foreground">Completed</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-yellow-500/10">
                <Loader2 className="h-5 w-5 text-yellow-500" />
              </div>
              <div>
                <p className={`text-2xl font-bold transition-opacity duration-200 ${loading ? "opacity-40" : ""}`}>{stats.processing}</p>
                <p className="text-xs text-muted-foreground">In Progress</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-500/10">
                <CircleDashed className="h-5 w-5 text-blue-500" />
              </div>
              <div>
                <p className={`text-2xl font-bold transition-opacity duration-200 ${loading ? "opacity-40" : ""}`}>{stats.partial}</p>
                <p className="text-xs text-muted-foreground">Partial</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-red-500/10">
                <XCircle className="h-5 w-5 text-red-500" />
              </div>
              <div>
                <p className={`text-2xl font-bold transition-opacity duration-200 ${loading ? "opacity-40" : ""}`}>{stats.failed}</p>
                <p className="text-xs text-muted-foreground">Failed</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-gray-500/10">
                <Clock className="h-5 w-5 text-gray-500" />
              </div>
              <div>
                <p className={`text-2xl font-bold transition-opacity duration-200 ${loading ? "opacity-40" : ""}`}>{stats.draft}</p>
                <p className="text-xs text-muted-foreground">Draft</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="hover:shadow-md transition-shadow">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Plus className="h-5 w-5 text-primary" />
              New Problem
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              Upload a problem statement and solution to start the automation pipeline.
            </p>
            <Link href="/problems/new">
              <Button size="sm">
                Create Problem
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
          </CardContent>
        </Card>

        {profile?.role === "admin" && (
          <Card className="hover:shadow-md transition-shadow">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-primary" />
                Admin Dashboard
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                View all users, problems, pipeline runs, and LLM costs.
              </p>
              <Link href="/admin">
                <Button size="sm" variant="outline">
                  Open Admin
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
            </CardContent>
          </Card>
        )}
      </div>

      {problems.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Recent Problems</h2>
            <Link href="/problems" className="text-sm text-primary hover:underline underline-offset-4">
              View all
            </Link>
          </div>
          <div className="rounded-lg border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left px-4 py-2.5 font-medium">Name</th>
                  {profile?.role === "admin" && (
                    <th className="text-left px-4 py-2.5 font-medium">Created By</th>
                  )}
                  <th className="text-left px-4 py-2.5 font-medium">Type</th>
                  <th className="text-left px-4 py-2.5 font-medium">Status</th>
                  <th className="text-left px-4 py-2.5 font-medium">Created</th>
                </tr>
              </thead>
              <tbody>
                {problems.slice(0, 5).map((p) => {
                  const Icon = STATUS_ICON[p.status] || Clock;
                  const color = STATUS_COLOR[p.status] || "text-gray-500";
                  return (
                    <tr key={p.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-2.5">
                        <Link href={`/problems/${p.id}`} className="font-medium text-primary hover:underline underline-offset-4">
                          {p.name}
                        </Link>
                      </td>
                      {profile?.role === "admin" && (
                        <td className="px-4 py-2.5 text-muted-foreground">
                          {p.profiles?.display_name || p.profiles?.email || "—"}
                        </td>
                      )}
                      <td className="px-4 py-2.5 text-muted-foreground">
                        {p.question_type === "function" ? "Function-based" : "Non-function"}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={`inline-flex items-center gap-1 text-xs font-medium ${color}`}>
                          <Icon className={`h-3 w-3 ${p.status === "processing" ? "animate-spin" : ""}`} />
                          <span className="capitalize">{p.status.replace("_", " ")}</span>
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">
                        {new Date(p.created_at).toLocaleDateString()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              What&apos;s New
            </CardTitle>
            <Link href="/whats-new" className="text-sm text-primary hover:underline underline-offset-4">
              View all updates
            </Link>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-xs text-muted-foreground mb-3">
            Recent improvements — tap any row to read more.
          </p>
          {recentUpdates.map((feature) => (
            <WhatsNewTeaser key={feature.id} feature={feature} />
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pipeline Features</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
            <div className="p-3 rounded-lg border border-border/50 bg-muted/30 space-y-1">
              <p className="font-medium flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-blue-500" />
                Run All
              </p>
              <p className="text-xs text-muted-foreground">Execute the entire pipeline with one click. Stop after the current step anytime.</p>
            </div>
            <div className="p-3 rounded-lg border border-border/50 bg-muted/30 space-y-1">
              <p className="font-medium flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                Persistent Progress
              </p>
              <p className="text-xs text-muted-foreground">Steps continue running even if you close the tab or logout. Come back to see results.</p>
            </div>
            <div className="p-3 rounded-lg border border-border/50 bg-muted/30 space-y-1">
              <p className="font-medium flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-purple-500" />
                Execution Stats
              </p>
              <p className="text-xs text-muted-foreground">View max execution time and memory per language with real-time pass/fail tracking.</p>
            </div>
          </div>

          <div className="border-t border-border/50 pt-4">
            <p className="text-xs font-medium text-muted-foreground mb-3">Supported Workflows</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
              <div className="space-y-1">
                <p className="font-medium">Function-based Practice</p>
                <p className="text-muted-foreground">Generate &rarr; Test Cases &rarr; Split Code &rarr; Execute &rarr; Enrichment &rarr; Package</p>
              </div>
              <div className="space-y-1">
                <p className="font-medium">Function-based Exam</p>
                <p className="text-muted-foreground">Generate &rarr; Test Cases &rarr; Split Code &rarr; Execute &rarr; Package</p>
              </div>
              <div className="space-y-1">
                <p className="font-medium">Non-function Practice</p>
                <p className="text-muted-foreground">Generate &rarr; Test Cases &rarr; Execute &rarr; Enrichment &rarr; Package</p>
              </div>
              <div className="space-y-1">
                <p className="font-medium">Non-function Exam</p>
                <p className="text-muted-foreground">Generate &rarr; Test Cases &rarr; Execute &rarr; Package</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
