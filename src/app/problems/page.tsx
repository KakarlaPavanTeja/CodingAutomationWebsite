"use client";

import { Fragment, useEffect, useState } from "react";
import Link from "next/link";
import {
  FileText,
  Plus,
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertTriangle,
  CircleDashed,
  ChevronRight,
} from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { LoadLogPanel, type LoadRecord } from "@/components/problems/LoadLogPanel";
import { deriveLoadCell } from "@/components/problems/load-cell";
import { useAuth } from "@/lib/auth-context";
import { useProblems } from "@/lib/problems-context";
import { cn } from "@/lib/utils";

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
  partial: {
    icon: CircleDashed,
    label: "Partial",
    className: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
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
  const [showAll, setShowAll] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [queueing, setQueueing] = useState(false);
  const [queueResult, setQueueResult] = useState("");
  // Every load the user may see, grouped by problem. One request for the whole
  // table — see /api/loadings/coding-questions/live.
  const [loadsByProblem, setLoadsByProblem] = useState<Map<string, LoadRecord[]>>(new Map());
  /** Oldest load on record; before this, "no load row" does not mean "never loaded". */
  const [trackingStartedAt, setTrackingStartedAt] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  // Bumped after queueing. Without it the poll effect would not re-run — it
  // watches `liveLoads`, which is still empty at that moment — and the Load
  // column would stay blank until something unrelated changed.
  const [loadTick, setLoadTick] = useState(0);
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin";

  // Only a problem whose pipeline produced output has a coding_questions.json
  // to load. Offering the checkbox on a draft would queue a load that fails its
  // file read minutes later, which is exactly the delayed-failure the eager
  // duplicate check exists to avoid elsewhere.
  const isLoadable = (status: string) => status === "completed" || status === "partial";

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  /**
   * Queue every selected problem. Deliberately contains no sequencing: the
   * server-side queue orders them, so this is N ordinary Load requests fired at
   * once. That is only safe because a second load now waits rather than being
   * refused — before the queue, this button would have lost all but one.
   */
  const queueSelected = async () => {
    setQueueing(true);
    setQueueResult("");
    const ids = [...selected];
    const results = await Promise.all(
      ids.map(async (id) => {
        try {
          const res = await fetch(
            `/api/loadings/coding-questions?problemId=${encodeURIComponent(id)}`,
            { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
          );
          return res.ok;
        } catch {
          return false;
        }
      }),
    );
    const ok = results.filter(Boolean).length;
    setQueueResult(
      `${ok} of ${ids.length} queued. Loads run one at a time — open a problem to watch its log.` +
        (ok < ids.length
          ? " The rest were refused: already loaded, already queued, or already in beta."
          : ""),
    );
    setSelected(new Set());
    setQueueing(false);
    setLoadTick((n) => n + 1);
    refresh();
  };

  useEffect(() => {
    const hasProcessing = problems.some((p) => p.status === "processing");
    if (!hasProcessing) return;
    const id = setInterval(() => {
      // Skip while the tab is backgrounded — cuts idle DB/network traffic.
      if (typeof document !== "undefined" && document.hidden) return;
      refresh();
    }, 15000);
    return () => clearInterval(id);
  }, [problems, refresh]);

  // Poll only while something is actually in flight. The map now holds finished
  // loads too, so "map is empty" is no longer the signal — `anyLive` is.
  const anyLive = [...loadsByProblem.values()].some((ls) =>
    ls.some((l) => l.status === "queued" || l.status === "running"),
  );

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const pull = async () => {
      try {
        const res = await fetch("/api/loadings/coding-questions/live");
        if (cancelled || !res.ok) return;
        const data = (await res.json()) as {
          trackingStartedAt: string | null;
          loads: (LoadRecord & { problemId: string })[];
        };
        if (cancelled) return;
        setTrackingStartedAt(data.trackingStartedAt);
        const next = new Map<string, LoadRecord[]>();
        for (const l of data.loads) {
          const list = next.get(l.problemId);
          if (list) list.push(l);
          else next.set(l.problemId, [l]);
        }
        setLoadsByProblem((prev) => {
          // Replacing the Map every tick would re-render the whole table twice a
          // second forever. Only swap it when something actually moved.
          if (prev.size === next.size &&
              [...next].every(([k, v]) => {
                const before = prev.get(k);
                return before?.length === v.length &&
                  v.every((l, i) => before[i].id === l.id &&
                                    before[i].status === l.status &&
                                    before[i].logs === l.logs &&
                                    before[i].queuePosition === l.queuePosition);
              })) {
            return prev;
          }
          return next;
        });
      } catch {
        // A blip must not stop the table updating; the next tick retries.
      }
    };

    void pull();
    if (anyLive) timer = setTimeout(pull, 2000);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [anyLive, loadsByProblem, loadTick]);

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
        <Link href="/problems/new" className={cn(buttonVariants())}>
          <Plus className="mr-2 h-4 w-4" />
          New Problem
        </Link>
      </div>

      {problems.length === 0 ? (
        <div className="rounded-lg border bg-card p-12 text-center">
          <FileText className="mx-auto h-12 w-12 text-muted-foreground/50 mb-4" />
          <h2 className="text-lg font-semibold">No problems yet</h2>
          <p className="text-sm text-muted-foreground mt-1 mb-4">
            Upload a problem and run the pipeline to get started.
          </p>
          <Link href="/problems/new" className={cn(buttonVariants())}>
            <Plus className="mr-2 h-4 w-4" />
            Create your first problem
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {selected.size > 0 && (
            <div className="flex flex-wrap items-center gap-3 rounded-md border bg-card px-4 py-3">
              <Button size="sm" disabled={queueing} onClick={queueSelected}>
                {queueing ? "Queueing…" : `Load ${selected.size} to beta`}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                Clear
              </Button>
              <p className="text-xs text-muted-foreground">
                Queued loads run one after another, so a batch of four takes several minutes.
              </p>
            </div>
          )}

          {queueResult && (
            <p className="rounded-md border bg-muted/40 px-4 py-2 text-xs text-muted-foreground">
              {queueResult}
            </p>
          )}

          <div className="rounded-lg border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="w-8 px-4 py-3" />
                  <th className="text-left px-4 py-3 font-medium">Problem</th>
                  {isAdmin && (
                    <th className="text-left px-4 py-3 font-medium">Created By</th>
                  )}
                  <th className="text-left px-4 py-3 font-medium">Type</th>
                  <th className="text-left px-4 py-3 font-medium">Mode</th>
                  <th className="text-left px-4 py-3 font-medium">Difficulty</th>
                  <th className="text-left px-4 py-3 font-medium">Score</th>
                  <th className="text-left px-4 py-3 font-medium">Status</th>
                  <th className="text-left px-4 py-3 font-medium">Created</th>
                  <th className="text-left px-4 py-3 font-medium">Load</th>
                </tr>
              </thead>
              <tbody>
                {(showAll ? problems : problems.slice(0, 5)).map((p) => {
                  const status = STATUS_CONFIG[p.status] || STATUS_CONFIG.draft;
                  const StatusIcon = status.icon;
                  const cell = deriveLoadCell({
                    loads: loadsByProblem.get(p.id) ?? [],
                    problemCreatedAt: p.created_at,
                    trackingStartedAt,
                  });
                  return (
                    <Fragment key={p.id}>
                    <tr className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3">
                        {isLoadable(p.status) && (
                          <Checkbox
                            checked={selected.has(p.id)}
                            onCheckedChange={() => toggle(p.id)}
                            aria-label={`Select ${p.name} for loading to beta`}
                          />
                        )}
                      </td>
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
                      <td className="px-4 py-3">
                        {cell.expandable ? (
                          <button
                            type="button"
                            onClick={() => setExpanded(expanded === p.id ? null : p.id)}
                            aria-expanded={expanded === p.id}
                            className={`inline-flex items-center gap-1 text-xs hover:underline ${
                              cell.kind === "failed" ? "text-destructive" : "text-primary"
                            }`}
                          >
                            <ChevronRight
                              className={`h-3 w-3 transition-transform ${expanded === p.id ? "rotate-90" : ""}`}
                            />
                            {cell.label}
                          </button>
                        ) : (
                          <span className="text-xs text-muted-foreground">{cell.label}</span>
                        )}
                      </td>
                    </tr>
                    {cell.load && expanded === p.id && (
                      <tr className="border-b last:border-0 bg-muted/20">
                        <td colSpan={isAdmin ? 10 : 9} className="px-4 pb-3">
                          {/* Controlled: this page already polls every live load
                              in one request, so the panel must not fetch again.
                              Sharing the panel keeps the wording and the beta
                              links identical to the problem page. */}
                          <LoadLogPanel loadId={cell.load.id} record={cell.load} />
                        </td>
                      </tr>
                    )}
                    </Fragment>
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
      )}
    </div>
  );
}
