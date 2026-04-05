"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Problem = {
  id: string;
  name: string;
  question_type: string;
  mode: string;
  status: string;
  languages: string[];
  created_at: string;
  deletion_reason: string | null;
  profiles: { email: string; display_name: string | null } | null;
};

const STATUS_STYLES: Record<string, string> = {
  completed: "bg-green-500/10 text-green-700 dark:text-green-400",
  failed: "bg-red-500/10 text-red-700 dark:text-red-400",
  processing: "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400",
  draft: "bg-gray-500/10 text-gray-700 dark:text-gray-400",
  deletion_pending: "bg-orange-500/10 text-orange-700 dark:text-orange-400",
  deleted: "bg-red-500/10 text-red-700 dark:text-red-400 line-through",
};

export default function AdminProblemsPage() {
  const [problems, setProblems] = useState<Problem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Problem | null>(null);
  const [deleteReason, setDeleteReason] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterType, setFilterType] = useState("all");
  const [filterMode, setFilterMode] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const supabase = createClient();

  const fetchProblems = async () => {
    const { data } = await supabase
      .from("problems")
      .select("*, profiles:created_by(email, display_name)")
      .neq("status", "deleted")
      .order("created_at", { ascending: false });

    setProblems((data as Problem[]) || []);
    setLoading(false);
  };

  useEffect(() => {
    fetchProblems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDelete = async () => {
    if (!deleteTarget || deleteReason.trim().length < 5) return;
    setDeleting(true);

    try {
      const res = await fetch(`/api/problems/${deleteTarget.id}/delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: deleteReason.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      // Remove from list
      setProblems((prev) => prev.filter((p) => p.id !== deleteTarget.id));
      setDeleteTarget(null);
      setDeleteReason("");
    } catch {
      // Error handling
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return <p className="text-muted-foreground">Loading problems...</p>;
  }

  if (problems.length === 0) {
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Problems</h2>
        <div className="rounded-lg border bg-card p-8 text-center">
          <p className="text-muted-foreground">
            No problems created yet.
          </p>
        </div>
      </div>
    );
  }

  const filteredProblems = problems.filter((p) => {
    if (filterStatus !== "all" && p.status !== filterStatus) return false;
    if (filterType !== "all" && p.question_type !== filterType) return false;
    if (filterMode !== "all" && p.mode !== filterMode) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const creator = (p.profiles?.display_name || p.profiles?.email || "").toLowerCase();
      if (!p.name.toLowerCase().includes(q) && !creator.includes(q)) return false;
    }
    return true;
  });

  const displayedProblems = showAll ? filteredProblems : filteredProblems.slice(0, 5);

  const statuses = [...new Set(problems.map((p) => p.status))].sort();
  const types = [...new Set(problems.map((p) => p.question_type))].sort();
  const modes = [...new Set(problems.map((p) => p.mode))].sort();
  const hasActiveFilters = filterStatus !== "all" || filterType !== "all" || filterMode !== "all" || searchQuery !== "";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">
          Problems ({hasActiveFilters ? `${filteredProblems.length}/${problems.length}` : problems.length})
        </h2>
        {hasActiveFilters && (
          <button
            onClick={() => { setFilterStatus("all"); setFilterType("all"); setFilterMode("all"); setSearchQuery(""); }}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Clear filters
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[180px]">
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Search</label>
          <input
            type="text"
            placeholder="Name or creator..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="flex w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Status</label>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="flex rounded-md border border-input bg-background px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="all">All</option>
            {statuses.map((s) => (
              <option key={s} value={s}>{s === "deletion_pending" ? "Deletion Pending" : s.charAt(0).toUpperCase() + s.slice(1)}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Type</label>
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="flex rounded-md border border-input bg-background px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="all">All</option>
            {types.map((t) => (
              <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Mode</label>
          <select
            value={filterMode}
            onChange={(e) => setFilterMode(e.target.value)}
            className="flex rounded-md border border-input bg-background px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="all">All</option>
            {modes.map((m) => (
              <option key={m} value={m}>{m.charAt(0).toUpperCase() + m.slice(1)}</option>
            ))}
          </select>
        </div>
      </div>

      {filteredProblems.length === 0 && hasActiveFilters ? (
        <div className="rounded-lg border bg-card p-6 text-center">
          <p className="text-muted-foreground text-sm">No problems match the current filters.</p>
        </div>
      ) : (
      <div className="rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="text-left px-4 py-3 font-medium">Name</th>
              <th className="text-left px-4 py-3 font-medium">Type</th>
              <th className="text-left px-4 py-3 font-medium">Mode</th>
              <th className="text-left px-4 py-3 font-medium">Status</th>
              <th className="text-left px-4 py-3 font-medium">Created By</th>
              <th className="text-left px-4 py-3 font-medium">Date</th>
              <th className="text-left px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {displayedProblems.map((p) => (
              <tr key={p.id} className="border-b last:border-0">
                <td className="px-4 py-3 font-medium">{p.name}</td>
                <td className="px-4 py-3 text-muted-foreground capitalize">
                  {p.question_type}
                </td>
                <td className="px-4 py-3 text-muted-foreground capitalize">
                  {p.mode}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                      STATUS_STYLES[p.status] || STATUS_STYLES.draft
                    }`}
                  >
                    {p.status === "deletion_pending" ? "deletion pending" : p.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {p.profiles?.display_name || p.profiles?.email || "—"}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {new Date(p.created_at).toLocaleDateString()}
                </td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => { setDeleteTarget(p); setDeleteReason(""); }}
                    className="text-xs text-red-500 hover:text-red-700 font-medium transition-colors"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}

      {filteredProblems.length > 5 && (
        <div className="flex justify-center">
          <button
            onClick={() => setShowAll(!showAll)}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            {showAll ? "Show recent 5" : `View all ${filteredProblems.length} problems`}
          </button>
        </div>
      )}

      {/* Delete Dialog */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-card border rounded-lg p-6 w-full max-w-md space-y-4 shadow-lg mx-4">
            <h3 className="font-semibold">Delete Problem</h3>
            <p className="text-sm text-muted-foreground">
              Deleting <span className="font-medium text-foreground">{deleteTarget.name}</span>
              {" "}(status: {deleteTarget.status}). The problem setter will be notified with your reason.
              Files will be permanently removed after 5 hours.
            </p>
            <div className="space-y-2">
              <label className="text-sm font-medium">
                Reason <span className="text-red-500">*</span>
              </label>
              <textarea
                value={deleteReason}
                onChange={(e) => setDeleteReason(e.target.value)}
                placeholder="Why are you deleting this problem? (min 5 characters)"
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[80px] resize-none"
              />
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => { setDeleteTarget(null); setDeleteReason(""); }}
                className="px-3 py-1.5 rounded-md text-sm font-medium border hover:bg-muted transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting || deleteReason.trim().length < 5}
                className="px-3 py-1.5 rounded-md text-sm font-medium bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {deleting ? "Deleting..." : "Delete Problem"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
