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
  profiles: { email: string; display_name: string | null } | null;
};

export default function AdminProblemsPage() {
  const [problems, setProblems] = useState<Problem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const supabase = createClient();

  useEffect(() => {
    const fetchProblems = async () => {
      const { data } = await supabase
        .from("problems")
        .select("*, profiles:created_by(email, display_name)")
        .order("created_at", { ascending: false });

      setProblems((data as Problem[]) || []);
      setLoading(false);
    };
    fetchProblems();
  }, [supabase]);

  if (loading) {
    return <p className="text-muted-foreground">Loading problems...</p>;
  }

  if (problems.length === 0) {
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Problems</h2>
        <div className="rounded-lg border bg-card p-8 text-center">
          <p className="text-muted-foreground">
            No problems created yet. Problems will appear here when users run
            the pipeline.
          </p>
        </div>
      </div>
    );
  }

  const displayedProblems = showAll ? problems : problems.slice(0, 5);

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">
        Problems ({problems.length})
      </h2>

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
                      p.status === "completed"
                        ? "bg-green-500/10 text-green-700 dark:text-green-400"
                        : p.status === "failed"
                          ? "bg-red-500/10 text-red-700 dark:text-red-400"
                          : p.status === "processing"
                            ? "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400"
                            : "bg-gray-500/10 text-gray-700 dark:text-gray-400"
                    }`}
                  >
                    {p.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {p.profiles?.display_name || p.profiles?.email || "—"}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {new Date(p.created_at).toLocaleDateString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {problems.length > 5 && (
        <div className="flex justify-center">
          <button
            onClick={() => setShowAll(!showAll)}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            {showAll ? "Show recent 5" : `View all ${problems.length} problems`}
          </button>
        </div>
      )}
    </div>
  );
}
