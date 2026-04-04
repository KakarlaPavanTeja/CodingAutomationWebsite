"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { DollarSign } from "lucide-react";

type UsageEntry = {
  id: string;
  model: string;
  purpose: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cost_usd: string;
  problem_name: string | null;
  created_at: string;
  profiles: { email: string; display_name: string | null } | null;
};

export default function AdminCostsPage() {
  const [usage, setUsage] = useState<UsageEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  useEffect(() => {
    const fetchUsage = async () => {
      const { data } = await supabase
        .from("llm_usage")
        .select("*, profiles:user_id(email, display_name)")
        .order("created_at", { ascending: false })
        .limit(200);

      setUsage((data as UsageEntry[]) || []);
      setLoading(false);
    };
    fetchUsage();
  }, [supabase]);

  if (loading) {
    return <p className="text-muted-foreground">Loading cost data...</p>;
  }

  const totalCost = usage.reduce(
    (sum, u) => sum + parseFloat(u.cost_usd || "0"),
    0
  );
  const totalTokens = usage.reduce((sum, u) => sum + u.total_tokens, 0);

  if (usage.length === 0) {
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">LLM Costs</h2>
        <div className="rounded-lg border bg-card p-8 text-center">
          <p className="text-muted-foreground">
            No LLM usage recorded yet. Cost data will appear here after pipeline
            runs that use the LLM.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold">LLM Costs</h2>

      {/* Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-lg border bg-card p-5 space-y-1">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <DollarSign className="h-4 w-4" />
            Total Cost
          </div>
          <p className="text-2xl font-bold">${totalCost.toFixed(4)}</p>
        </div>
        <div className="rounded-lg border bg-card p-5 space-y-1">
          <p className="text-sm text-muted-foreground">Total Tokens</p>
          <p className="text-2xl font-bold">{totalTokens.toLocaleString()}</p>
        </div>
        <div className="rounded-lg border bg-card p-5 space-y-1">
          <p className="text-sm text-muted-foreground">API Calls</p>
          <p className="text-2xl font-bold">{usage.length}</p>
        </div>
      </div>

      {/* Usage Table */}
      <div className="rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="text-left px-4 py-3 font-medium">Date</th>
              <th className="text-left px-4 py-3 font-medium">Model</th>
              <th className="text-left px-4 py-3 font-medium">Purpose</th>
              <th className="text-left px-4 py-3 font-medium">Problem</th>
              <th className="text-right px-4 py-3 font-medium">Tokens</th>
              <th className="text-right px-4 py-3 font-medium">Cost</th>
            </tr>
          </thead>
          <tbody>
            {usage.map((u) => (
              <tr key={u.id} className="border-b last:border-0">
                <td className="px-4 py-3 text-muted-foreground">
                  {new Date(u.created_at).toLocaleString()}
                </td>
                <td className="px-4 py-3 font-mono text-xs">{u.model}</td>
                <td className="px-4 py-3 capitalize text-muted-foreground">
                  {u.purpose}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {u.problem_name || "—"}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {u.total_tokens.toLocaleString()}
                </td>
                <td className="px-4 py-3 text-right tabular-nums font-medium">
                  ${parseFloat(u.cost_usd).toFixed(4)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
