"use client";

import { useEffect, useState } from "react";
import { Users, FileText, Activity, DollarSign } from "lucide-react";

type Stats = {
  users: { total: number; active: number; admins: number };
  problems: {
    total: number;
    byStatus: Record<string, number>;
    byType: Record<string, number>;
  };
  runs: { total: number; running: number; completed: number; failed: number };
  costs: {
    total: number;
    byModel: Record<string, number>;
    byPurpose: Record<string, number>;
    apiCalls: number;
  };
};

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <div className="rounded-lg border bg-card p-5 space-y-2">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="h-4 w-4" />
        <span className="text-sm font-medium">{label}</span>
      </div>
      <p className="text-2xl font-bold">{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

export default function AdminOverview() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/admin/stats")
      .then((r) => r.json())
      .then((data) => {
        setStats(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return <p className="text-muted-foreground">Loading stats...</p>;
  }

  if (!stats) {
    return <p className="text-muted-foreground">Failed to load stats.</p>;
  }

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold">Overview</h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={Users}
          label="Users"
          value={stats.users.total}
          sub={`${stats.users.active} active, ${stats.users.admins} admin${stats.users.admins !== 1 ? "s" : ""}`}
        />
        <StatCard
          icon={FileText}
          label="Problems"
          value={stats.problems.total}
          sub={`${stats.problems.byStatus.completed || 0} completed, ${stats.problems.byStatus.failed || 0} failed`}
        />
        <StatCard
          icon={Activity}
          label="Pipeline Runs"
          value={stats.runs.total}
          sub={`${stats.runs.completed} completed, ${stats.runs.running} running`}
        />
        <StatCard
          icon={DollarSign}
          label="Total LLM Cost"
          value={`$${stats.costs.total.toFixed(4)}`}
          sub={`${stats.costs.apiCalls} API calls`}
        />
      </div>

      {/* Cost by Model */}
      {Object.keys(stats.costs.byModel).length > 0 && (
        <div className="rounded-lg border bg-card p-5 space-y-3">
          <h3 className="text-sm font-semibold">Cost by Model</h3>
          <div className="space-y-2">
            {Object.entries(stats.costs.byModel)
              .sort(([, a], [, b]) => b - a)
              .map(([model, cost]) => (
                <div key={model} className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground font-mono">{model}</span>
                  <span className="font-medium">${cost.toFixed(4)}</span>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Cost by Purpose */}
      {Object.keys(stats.costs.byPurpose).length > 0 && (
        <div className="rounded-lg border bg-card p-5 space-y-3">
          <h3 className="text-sm font-semibold">Cost by Purpose</h3>
          <div className="space-y-2">
            {Object.entries(stats.costs.byPurpose)
              .sort(([, a], [, b]) => b - a)
              .map(([purpose, cost]) => (
                <div key={purpose} className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground capitalize">{purpose}</span>
                  <span className="font-medium">${cost.toFixed(4)}</span>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Problems by Type */}
      {stats.problems.total > 0 && (
        <div className="rounded-lg border bg-card p-5 space-y-3">
          <h3 className="text-sm font-semibold">Problems by Type</h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="text-center p-3 rounded-md bg-muted">
              <p className="text-2xl font-bold">{stats.problems.byType.function || 0}</p>
              <p className="text-xs text-muted-foreground">Function-based</p>
            </div>
            <div className="text-center p-3 rounded-md bg-muted">
              <p className="text-2xl font-bold">{stats.problems.byType.nonfunction || 0}</p>
              <p className="text-xs text-muted-foreground">Non-function</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
