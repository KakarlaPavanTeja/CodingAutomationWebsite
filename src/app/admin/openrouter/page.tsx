"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DollarSign, User, FileText, Filter, BarChart3, RefreshCw } from "lucide-react";
import { STEP_CONFIGS } from "@/lib/pipeline-config";

// Map raw pipeline step ids (e.g. "generate_editorial") to friendly labels
// (e.g. "Generate Editorial") so the usage report reads cleanly.
const STEP_LABELS: Record<string, string> = Object.fromEntries(
  STEP_CONFIGS.map((s) => [s.id, s.label])
);

function stepLabel(stepId: string | null): string {
  if (!stepId) return "—";
  return STEP_LABELS[stepId] || stepId;
}

type UsageEntry = {
  id: string;
  user_id: string | null;
  problem_id: string | null;
  model: string;
  purpose: string;
  step_id: string | null;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cost_usd: string;
  account: string | null;
  problem_name: string | null;
  created_at: string;
  profiles: { email: string; display_name: string | null } | null;
  problems: { name: string } | null;
};

type GroupedData = {
  key: string;
  label: string;
  cost: number;
  tokens: number;
  calls: number;
  users?: Set<string>;
};

type DailyBar = {
  date: string; // YYYY-MM-DD
  label: string; // "Apr 5"
  cost: number;
  tokens: number;
  calls: number;
  byModel: Record<string, number>;
  byPurpose: Record<string, number>;
};

// Consistent colours for up to 6 models/purposes
const BAR_COLORS = [
  "bg-blue-500",
  "bg-emerald-500",
  "bg-violet-500",
  "bg-amber-500",
  "bg-pink-500",
  "bg-cyan-500",
];

function matchesFilter(
  value: string | null,
  filterKey: string
): boolean {
  if (!filterKey) return true;
  if (filterKey === "__null__") return value === null || value === undefined;
  return value === filterKey;
}

// The new OpenRouter API key went live 2026-07-24 15:31 IST. Usage recorded
// before this instant is billed to the OLD key's account; on/after, the NEW key.
// Adjust the offset here if the cutoff is in a different timezone.
const NEW_KEY_START = new Date("2026-07-24T15:31:00+05:30");

// Which OpenRouter account (key) a usage row belongs to, by when it ran.
function accountForRow(u: UsageEntry): "new" | "old" {
  return new Date(u.created_at) >= NEW_KEY_START ? "new" : "old";
}

type TimeRange = "1d" | "7d" | "1m" | "3m" | "6m" | "1y" | "all";
const TIME_RANGES: { key: TimeRange; label: string; days: number }[] = [
  { key: "1d", label: "24h", days: 1 },
  { key: "7d", label: "7d", days: 7 },
  { key: "1m", label: "1m", days: 30 },
  { key: "3m", label: "3m", days: 90 },
  { key: "6m", label: "6m", days: 180 },
  { key: "1y", label: "1y", days: 365 },
  { key: "all", label: "All", days: 0 },
];

function toLocalDateStr(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function getDaysArray(start: Date, end: Date): string[] {
  const days: string[] = [];
  const d = new Date(start);
  while (d <= end) {
    days.push(toLocalDateStr(d));
    d.setDate(d.getDate() + 1);
  }
  return days;
}

function formatYAxis(val: number, mode: "cost" | "tokens" | "calls"): string {
  if (mode === "cost") {
    if (val >= 1) return `$${val.toFixed(0)}`;
    if (val >= 0.01) return `$${val.toFixed(2)}`;
    return `$${val.toFixed(4)}`;
  }
  if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(1)}M`;
  if (val >= 1_000) return `${(val / 1_000).toFixed(0)}K`;
  return String(Math.round(val));
}

// Top-of-dashboard control: scopes the whole cost view to New / Old / All (by
// the key start date). Picking a specific key also switches which OpenRouter
// key the app uses for new calls; "All" only affects the view.
function OpenRouterKeySelector({
  value,
  onChange,
}: {
  value: string; // "" = All, "new", or "old"
  onChange: (v: string) => void;
}) {
  return (
    <label className="inline-flex items-center gap-1.5 text-xs font-medium">
      <span className="text-muted-foreground">API key</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-card border border-border rounded-md px-2 py-1.5 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
      >
        <option value="new">New</option>
        <option value="old">Old</option>
        <option value="">All</option>
      </select>
    </label>
  );
}

export default function AdminCostsPage() {
  const [usage, setUsage] = useState<UsageEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterUser, setFilterUser] = useState("");
  const [filterProblem, setFilterProblem] = useState("");
  const [filterModel, setFilterModel] = useState("");
  const [filterPurpose, setFilterPurpose] = useState("");
  const [filterStep, setFilterStep] = useState("");
  const [filterAccount, setFilterAccount] = useState("");
  const [barMode, setBarMode] = useState<"cost" | "tokens" | "calls">("cost");
  const [timeRange, setTimeRange] = useState<TimeRange>("all");
  const [includeImported, setIncludeImported] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [truncated, setTruncated] = useState(false);
  const inFlight = useRef(false);

  const fetchUsage = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setRefreshing(true);
    try {
      const res = await fetch("/api/admin/usage", { cache: "no-store" });
      const data = await res.json();
      setUsage((data.usage as UsageEntry[]) || []);
      setTruncated(Boolean(data.truncated));
      setLastUpdated(new Date());
    } catch {
      // keep whatever we already have on a transient failure
    } finally {
      setLoading(false);
      setRefreshing(false);
      inFlight.current = false;
    }
  }, []);

  // Top API-key dropdown: "" (All) / "new" / "old" scopes the cost view. Picking
  // a specific key also switches which key the app uses for new calls.
  const onSelectAccount = useCallback((v: string) => {
    setFilterAccount(v);
    if (v === "new" || v === "old") {
      fetch("/api/admin/openrouter-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ choice: v }),
      }).catch(() => {});
    }
  }, []);

  // Initial load + auto-refresh so new pipeline runs show up without a reload.
  useEffect(() => {
    fetchUsage();
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") fetchUsage();
    }, 5000);
    const onVisible = () => {
      if (document.visibilityState === "visible") fetchUsage();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [fetchUsage]);

  // ---- Time-range window (applies to the WHOLE dashboard, not just the chart) ----
  const rangeStart = useMemo(() => {
    if (timeRange === "all") return new Date(0);
    const rangeDays = TIME_RANGES.find((r) => r.key === timeRange)?.days ?? 30;
    const start = new Date();
    start.setDate(start.getDate() - rangeDays + 1);
    start.setHours(0, 0, 0, 0);
    return start;
  }, [timeRange]);

  // Helper: apply all active filters except one (for cross-filtering dropdowns)
  const applyFilters = useCallback(
    (data: UsageEntry[], exclude?: "user" | "problem" | "model" | "purpose" | "step" | "account") => {
      let result = data;
      if (filterUser && exclude !== "user")
        result = result.filter((u) => matchesFilter(u.user_id, filterUser));
      if (filterProblem && exclude !== "problem")
        result = result.filter((u) => matchesFilter(u.problem_id, filterProblem));
      if (filterModel && exclude !== "model")
        result = result.filter((u) => u.model === filterModel);
      if (filterPurpose && exclude !== "purpose")
        result = result.filter((u) => u.purpose === filterPurpose);
      if (filterStep && exclude !== "step")
        result = result.filter((u) => matchesFilter(u.step_id, filterStep));
      if (filterAccount && exclude !== "account")
        result = result.filter((u) => accountForRow(u) === filterAccount);
      return result;
    },
    [filterUser, filterProblem, filterModel, filterPurpose, filterStep, filterAccount]
  );

  // Base set: within the selected time range, and (unless opted in) excluding the
  // legacy "imported" rows so the dashboard reflects real per-call OpenRouter usage.
  const rangeUsage = useMemo(
    () =>
      usage.filter(
        (u) =>
          new Date(u.created_at) >= rangeStart &&
          (includeImported || u.purpose !== "imported")
      ),
    [usage, rangeStart, includeImported]
  );

  // Fully-filtered set — drives the summary cards, the chart, and the table.
  const filteredUsage = useMemo(
    () => applyFilters(rangeUsage),
    [rangeUsage, applyFilters]
  );
  // Breakdown sets exclude their own dimension so each list stays switchable.
  const userScoped = useMemo(
    () => applyFilters(rangeUsage, "user"),
    [rangeUsage, applyFilters]
  );
  const problemScoped = useMemo(
    () => applyFilters(rangeUsage, "problem"),
    [rangeUsage, applyFilters]
  );

  // ---- Totals + daily chart series (from the fully-filtered set) ----
  const { totalCost, totalTokens, dailyBars, allPurposes } = useMemo(() => {
    let tCost = 0;
    let tTokens = 0;
    const dMap = new Map<string, DailyBar>();
    const purposeSet = new Set<string>();

    for (const u of filteredUsage) {
      const cost = parseFloat(u.cost_usd || "0");
      tCost += cost;
      tTokens += u.total_tokens;

      const createdDate = new Date(u.created_at);
      const day = toLocalDateStr(createdDate);
      if (!dMap.has(day)) {
        dMap.set(day, {
          date: day,
          label: createdDate.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
          cost: 0,
          tokens: 0,
          calls: 0,
          byModel: {},
          byPurpose: {},
        });
      }
      const db = dMap.get(day)!;
      db.cost += cost;
      db.tokens += u.total_tokens;
      db.calls += 1;
      db.byModel[u.model] = (db.byModel[u.model] || 0) + cost;
      db.byPurpose[u.purpose] = (db.byPurpose[u.purpose] || 0) + cost;
      purposeSet.add(u.purpose);
    }

    return {
      totalCost: tCost,
      totalTokens: tTokens,
      dailyBars: Array.from(dMap.values()).sort((a, b) => a.date.localeCompare(b.date)),
      allPurposes: Array.from(purposeSet),
    };
  }, [filteredUsage]);

  // ---- Per-user breakdown (every active filter except the user filter) ----
  const byUser = useMemo(() => {
    const uMap = new Map<string, GroupedData>();
    for (const u of userScoped) {
      const cost = parseFloat(u.cost_usd || "0");
      const uKey = u.user_id ?? "__null__";
      const uLabel =
        u.profiles?.display_name ||
        u.profiles?.email ||
        (u.user_id ? "Unknown User" : "Imported / system");
      if (!uMap.has(uKey)) {
        uMap.set(uKey, { key: uKey, label: uLabel, cost: 0, tokens: 0, calls: 0 });
      }
      const g = uMap.get(uKey)!;
      g.cost += cost;
      g.tokens += u.total_tokens;
      g.calls += 1;
    }
    return Array.from(uMap.values()).sort((a, b) => b.cost - a.cost);
  }, [userScoped]);

  // ---- Per-problem breakdown (every active filter except the problem filter) ----
  const byProblem = useMemo(() => {
    const pMap = new Map<string, GroupedData>();
    for (const u of problemScoped) {
      const cost = parseFloat(u.cost_usd || "0");
      const pKey = u.problem_id ?? "__null__";
      const pLabel =
        u.problems?.name ||
        u.problem_name?.split("_")[0] ||
        (u.problem_id ? u.problem_id.slice(0, 8) : "Unknown");
      if (!pMap.has(pKey)) {
        pMap.set(pKey, { key: pKey, label: pLabel, cost: 0, tokens: 0, calls: 0, users: new Set() });
      }
      const g = pMap.get(pKey)!;
      g.cost += cost;
      g.tokens += u.total_tokens;
      g.calls += 1;
      const userName = u.profiles?.display_name || u.profiles?.email || "";
      if (userName) g.users!.add(userName);
    }
    return Array.from(pMap.values()).sort((a, b) => b.cost - a.cost);
  }, [problemScoped]);

  // Cross-filtered dropdown options: each shows only values available given the other filters
  const dropdownOptions = useMemo(() => {
    const forUser = applyFilters(rangeUsage, "user");
    const forProblem = applyFilters(rangeUsage, "problem");
    const forModel = applyFilters(rangeUsage, "model");
    const forPurpose = applyFilters(rangeUsage, "purpose");
    const forStep = applyFilters(rangeUsage, "step");

    // Users available
    const userMap = new Map<string, string>();
    for (const u of forUser) {
      const key = u.user_id ?? "__null__";
      if (!userMap.has(key))
        userMap.set(key, u.profiles?.display_name || u.profiles?.email || "Unknown");
    }

    // Problems available
    const problemMap = new Map<string, string>();
    for (const u of forProblem) {
      const key = u.problem_id ?? "__null__";
      if (!problemMap.has(key))
        problemMap.set(
          key,
          u.problems?.name || u.problem_name?.split("_")[0] || (u.problem_id ? u.problem_id.slice(0, 8) : "Unknown")
        );
    }

    // Models available
    const modelSet = new Set<string>();
    for (const u of forModel) modelSet.add(u.model);

    // Purposes available
    const purposeSet = new Set<string>();
    for (const u of forPurpose) purposeSet.add(u.purpose);

    // Steps available
    const stepSet = new Set<string>();
    for (const u of forStep) if (u.step_id) stepSet.add(u.step_id);

    return {
      users: Array.from(userMap.entries()).map(([key, label]) => ({ key, label })),
      problems: Array.from(problemMap.entries()).map(([key, label]) => ({ key, label })),
      models: Array.from(modelSet).sort(),
      purposes: Array.from(purposeSet).sort(),
      steps: Array.from(stepSet)
        .map((key) => ({ key, label: stepLabel(key) }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    };
  }, [rangeUsage, applyFilters]);

  // Build chart bars with filled-in empty days for the selected range
  const chartData = useMemo(() => {
    const now = new Date();
    let start: Date;
    if (timeRange === "all") {
      // For "all", span from the earliest day we actually have data for
      // (avoids generating an enormous day array back to 1970).
      const earliest = dailyBars.length
        ? new Date(dailyBars[0].date + "T12:00:00")
        : now;
      start = new Date(earliest);
      start.setHours(0, 0, 0, 0);
    } else {
      start = new Date(rangeStart);
    }

    const allDays = getDaysArray(start, now);

    // Build a lookup from dailyBars
    const dayLookup = new Map<string, DailyBar>();
    for (const bar of dailyBars) {
      dayLookup.set(bar.date, bar);
    }

    // Fill in empty days
    return allDays.map((day) => {
      if (dayLookup.has(day)) return dayLookup.get(day)!;
      const d = new Date(day + "T12:00:00"); // noon local to avoid DST edge cases
      return {
        date: day,
        label: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        cost: 0,
        tokens: 0,
        calls: 0,
        byModel: {},
        byPurpose: {},
      } as DailyBar;
    });
  }, [dailyBars, timeRange, rangeStart]);

  // All hooks above — early returns below
  if (loading) {
    return <p className="text-muted-foreground">Loading cost data...</p>;
  }

  if (usage.length === 0) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-lg font-semibold">OpenRouter Dashboard</h2>
          <div className="flex items-center gap-3">
            <OpenRouterKeySelector value={filterAccount} onChange={onSelectAccount} />
            <button
              onClick={() => fetchUsage()}
              disabled={refreshing}
              className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md border bg-card hover:bg-muted/50 transition-colors disabled:opacity-60"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>
        </div>
        <div className="rounded-lg border bg-card p-8 text-center">
          <p className="text-muted-foreground">
            No LLM usage recorded yet. Cost data will appear here after pipeline
            runs that use the LLM.
          </p>
        </div>
      </div>
    );
  }

  const toggleFilter = (
    current: string,
    key: string,
    setter: (v: string) => void
  ) => {
    setter(current === key ? "" : key);
  };

  const maxBarVal = Math.max(
    ...chartData.map((d) =>
      barMode === "cost" ? d.cost : barMode === "tokens" ? d.tokens : d.calls
    ),
    0.001
  );

  // Y-axis ticks (4 lines)
  const yTicks = [0.25, 0.5, 0.75, 1].map((f) => f * maxBarVal);

  // Smart label interval — show ~6 labels max to avoid overlap
  const labelInterval = Math.max(1, Math.ceil(chartData.length / 6));

  // Period totals for the selected range
  const periodCost = chartData.reduce((s, d) => s + d.cost, 0);
  const periodTokens = chartData.reduce((s, d) => s + d.tokens, 0);
  const periodCalls = chartData.reduce((s, d) => s + d.calls, 0);

  // Breakdown bar widths use each breakdown's own total (these sets intentionally
  // ignore their own dimension filter, so they can differ from the headline total).
  const byUserTotal = byUser.reduce((s, g) => s + g.cost, 0);
  const byProblemTotal = byProblem.reduce((s, g) => s + g.cost, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-lg font-semibold">OpenRouter Dashboard</h2>
        <div className="flex items-center gap-3">
          <OpenRouterKeySelector value={filterAccount} onChange={onSelectAccount} />
          {lastUpdated && (
            <span className="text-xs text-muted-foreground tabular-nums">
              Updated {lastUpdated.toLocaleTimeString()}
            </span>
          )}
          <button
            onClick={() => setIncludeImported((v) => !v)}
            className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md border transition-colors ${
              includeImported
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-card hover:bg-muted/50"
            }`}
            title="Include legacy imported usage rows (no user) in every total, chart, and breakdown"
          >
            {includeImported ? "Including imported" : "Excluding imported"}
          </button>
          <button
            onClick={() => fetchUsage()}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md border bg-card hover:bg-muted/50 transition-colors disabled:opacity-60"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      {truncated && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
          Showing the most recent 100,000 usage rows — older history is not
          included in these totals. Aggregation should move server-side.
        </div>
      )}

      {/* Summary Cards — reflect the selected time range + active filters */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div className="rounded-lg border bg-card p-5 space-y-1">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <DollarSign className="h-4 w-4" />
            Total Cost
          </div>
          <p className="text-2xl font-bold">${totalCost.toFixed(2)}</p>
        </div>
        <div className="rounded-lg border bg-card p-5 space-y-1">
          <p className="text-sm text-muted-foreground">Total Tokens</p>
          <p className="text-2xl font-bold">{totalTokens.toLocaleString()}</p>
        </div>
        <div className="rounded-lg border bg-card p-5 space-y-1">
          <p className="text-sm text-muted-foreground">API Calls</p>
          <p className="text-2xl font-bold">{filteredUsage.length.toLocaleString()}</p>
        </div>
        <div className="rounded-lg border bg-card p-5 space-y-1">
          <p className="text-sm text-muted-foreground">Avg Cost / Call</p>
          <p className="text-2xl font-bold">
            ${filteredUsage.length > 0 ? (totalCost / filteredUsage.length).toFixed(4) : "0"}
          </p>
        </div>
      </div>

      {/* ---- Daily Bar Chart (OpenAI-style) ---- */}
      <div className="rounded-xl border bg-card p-6 space-y-5">
        {/* Header row */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h3 className="text-base font-semibold flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-primary" /> Daily Usage
            </h3>
            <p className="text-sm text-muted-foreground mt-0.5">
              {barMode === "cost"
                ? `$${periodCost.toFixed(2)}`
                : barMode === "tokens"
                ? `${periodTokens.toLocaleString()} tokens`
                : `${periodCalls} calls`}
              {" "}total
            </p>
          </div>
          <div className="flex items-center gap-3">
            {/* Metric toggle */}
            <div className="flex rounded-lg bg-muted/50 p-0.5">
              {(["cost", "tokens", "calls"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setBarMode(m)}
                  className={`text-xs px-3 py-1.5 rounded-md transition-all font-medium ${
                    barMode === m
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {m === "cost" ? "Cost ($)" : m === "tokens" ? "Tokens" : "Calls"}
                </button>
              ))}
            </div>
            {/* Time range toggle */}
            <div className="flex rounded-lg bg-muted/50 p-0.5">
              {TIME_RANGES.map((r) => (
                <button
                  key={r.key}
                  onClick={() => setTimeRange(r.key)}
                  className={`text-xs px-2.5 py-1.5 rounded-md transition-all font-medium ${
                    timeRange === r.key
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Chart area — clean div-based */}
        {(() => {
          const CHART_HEIGHT = 220;
          const X_AXIS_HEIGHT = 28;
          const n = chartData.length;
          const PURPOSE_COLORS = ["#3b82f6", "#10b981", "#8b5cf6", "#f59e0b", "#ec4899", "#06b6d4"];
          const purposeColorMap: Record<string, string> = {};
          allPurposes.forEach((p, i) => { purposeColorMap[p] = PURPOSE_COLORS[i % PURPOSE_COLORS.length]; });

          // Nice Y-axis: round to nearest clean number
          const niceMax = (() => {
            if (maxBarVal <= 0) return 1;
            const pow = Math.pow(10, Math.floor(Math.log10(maxBarVal)));
            const norm = maxBarVal / pow;
            const nice = norm <= 1.5 ? 1.5 : norm <= 2 ? 2 : norm <= 3 ? 3 : norm <= 5 ? 5 : norm <= 7.5 ? 7.5 : 10;
            return nice * pow;
          })();
          const niceYTicks = [0.25, 0.5, 0.75, 1].map(f => f * niceMax);

          // Bar width as percentage of slot — dynamically fills available space
          // Fewer bars = more whitespace gap, many bars = bars fill more of the slot
          const barWidthPct = n <= 2 ? 30 : n <= 7 ? 50 : n <= 14 ? 60 : n <= 31 ? 65 : n <= 90 ? 75 : 85;

          return (
            <div>
              {/* Chart + Y-axis row */}
              <div className="flex">
                {/* Y-axis labels — positioned to align with grid lines */}
                <div className="shrink-0 relative" style={{ width: "48px", height: `${CHART_HEIGHT}px` }}>
                  {niceYTicks.map((tick, i) => (
                    <span
                      key={i}
                      className="absolute right-2 text-[11px] text-muted-foreground/60 tabular-nums leading-none"
                      style={{ top: `${(1 - tick / niceMax) * 100}%`, transform: "translateY(-50%)" }}
                    >
                      {formatYAxis(tick, barMode)}
                    </span>
                  ))}
                  <span
                    className="absolute right-2 text-[11px] text-muted-foreground/60 tabular-nums leading-none"
                    style={{ bottom: 0, transform: "translateY(50%)" }}
                  >
                    0
                  </span>
                </div>

                {/* Plot area */}
                <div className="flex-1 relative" style={{ height: `${CHART_HEIGHT}px` }}>
                  {/* Horizontal grid lines */}
                  {niceYTicks.map((tick, i) => (
                    <div
                      key={i}
                      className="absolute left-0 right-0 border-t border-border/20"
                      style={{ top: `${(1 - tick / niceMax) * 100}%` }}
                    />
                  ))}
                  {/* Bottom axis */}
                  <div className="absolute left-0 right-0 bottom-0 border-t border-border/40" />

                  {/* Bars */}
                  <div className="absolute inset-0 flex items-end">
                    {chartData.map((bar, idx) => {
                      const val = barMode === "cost" ? bar.cost : barMode === "tokens" ? bar.tokens : bar.calls;
                      const pct = niceMax > 0 ? Math.min(val / niceMax, 1) : 0;
                      const barH = pct * 100; // percentage

                      const segments = barMode === "cost" && val > 0
                        ? Object.entries(bar.byPurpose).sort(([, a], [, b]) => b - a)
                        : [];

                      return (
                        <div
                          key={bar.date}
                          className="flex-1 flex items-end justify-center group/bar relative cursor-pointer"
                          style={{ minWidth: 0, height: "100%" }}
                        >
                          {/* Hover highlight column */}
                          <div className="absolute inset-0 bg-transparent group-hover/bar:bg-muted/20 transition-colors" />

                          {/* The bar */}
                          {val > 0 ? (
                            segments.length > 1 ? (
                              <div
                                className="relative z-10 rounded-t-[3px] overflow-hidden transition-all group-hover/bar:brightness-125"
                                style={{ width: `${barWidthPct}%`, maxWidth: "56px", height: `${Math.max(barH, 0.5)}%` }}
                              >
                                {segments.map(([purpose, segCost]) => (
                                  <div
                                    key={purpose}
                                    style={{
                                      height: `${(segCost / val) * 100}%`,
                                      backgroundColor: purposeColorMap[purpose] || "#3b82f6",
                                      minHeight: "1px",
                                    }}
                                  />
                                ))}
                              </div>
                            ) : (
                              <div
                                className="relative z-10 rounded-t-[3px] transition-all group-hover/bar:brightness-125"
                                style={{
                                  width: `${barWidthPct}%`,
                                  maxWidth: "56px",
                                  height: `${Math.max(barH, 0.5)}%`,
                                  background: "linear-gradient(180deg, #60a5fa 0%, #3b82f6 100%)",
                                }}
                              />
                            )
                          ) : null}

                          {/* Tooltip */}
                          {val > 0 && (
                            <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 hidden group-hover/bar:block z-30 pointer-events-none">
                              <div className="bg-popover border border-border rounded-lg shadow-2xl px-4 py-3 text-xs whitespace-nowrap space-y-1 backdrop-blur-sm">
                                <p className="font-semibold text-sm">{bar.label}</p>
                                <div className="flex items-center justify-between gap-6">
                                  <span className="text-muted-foreground">Cost</span>
                                  <span className="font-medium">${bar.cost.toFixed(4)}</span>
                                </div>
                                <div className="flex items-center justify-between gap-6">
                                  <span className="text-muted-foreground">Tokens</span>
                                  <span className="font-medium">{bar.tokens.toLocaleString()}</span>
                                </div>
                                <div className="flex items-center justify-between gap-6">
                                  <span className="text-muted-foreground">Calls</span>
                                  <span className="font-medium">{bar.calls}</span>
                                </div>
                                {Object.keys(bar.byModel).length > 0 && (
                                  <div className="border-t border-border/50 pt-1.5 mt-1.5 space-y-0.5">
                                    <p className="text-muted-foreground/60 text-[10px] uppercase tracking-wider font-medium">By Model</p>
                                    {Object.entries(bar.byModel)
                                      .sort(([, a], [, b]) => b - a)
                                      .map(([model, cost]) => (
                                      <div key={model} className="flex items-center justify-between gap-4">
                                        <span className="text-muted-foreground font-mono text-[11px]">{model}</span>
                                        <span className="font-medium">${cost.toFixed(4)}</span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* X-axis labels — below the chart */}
              <div className="flex" style={{ paddingLeft: "48px", height: `${X_AXIS_HEIGHT}px` }}>
                {chartData.map((bar, idx) => (
                  <div key={bar.date} className="flex-1 flex items-start justify-center pt-1.5" style={{ minWidth: 0 }}>
                    <span className="text-[10px] text-muted-foreground/50 tabular-nums whitespace-nowrap">
                      {idx % labelInterval === 0 || idx === chartData.length - 1 ? bar.label : ""}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

        {/* Legend */}
        {barMode === "cost" && allPurposes.length > 1 && (
          <div className="flex flex-wrap gap-5 pt-3 border-t border-border/30">
            {allPurposes.map((purpose, idx) => {
              const PURPOSE_COLORS = ["#3b82f6", "#10b981", "#8b5cf6", "#f59e0b", "#ec4899", "#06b6d4"];
              return (
                <div key={purpose} className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="w-3 h-3 rounded-[3px]" style={{ backgroundColor: PURPOSE_COLORS[idx % PURPOSE_COLORS.length] }} />
                  <span className="capitalize font-medium">{purpose}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Per-User & Per-Problem side by side */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Per-User Breakdown */}
        <div className="rounded-lg border bg-card p-5 space-y-3">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <User className="h-4 w-4" /> Cost by User
          </h3>
          <div className="space-y-1">
            {byUser.map((g) => {
              const isActive = filterUser === g.key;
              const barW = byUserTotal > 0 ? (g.cost / byUserTotal) * 100 : 0;
              return (
                <button
                  key={g.key}
                  onClick={() => toggleFilter(filterUser, g.key, setFilterUser)}
                  className={`w-full flex items-center justify-between text-sm p-2 rounded-md transition-colors relative overflow-hidden ${
                    isActive
                      ? "bg-primary/10 ring-1 ring-primary/30"
                      : "hover:bg-muted/50"
                  }`}
                >
                  <div
                    className="absolute inset-y-0 left-0 bg-primary/5 transition-all"
                    style={{ width: `${barW}%` }}
                  />
                  <span className="relative text-muted-foreground truncate max-w-[180px]">
                    {g.label}
                  </span>
                  <div className="relative flex items-center gap-3">
                    <span className="text-xs text-muted-foreground">{g.calls} calls</span>
                    <span className="font-medium tabular-nums">${g.cost.toFixed(4)}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Per-Problem Breakdown */}
        <div className="rounded-lg border bg-card p-5 space-y-3">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <FileText className="h-4 w-4" /> Cost by Problem
          </h3>
          <div className="space-y-1 max-h-[300px] overflow-y-auto">
            {byProblem.map((g) => {
              const isActive = filterProblem === g.key;
              const barW = byProblemTotal > 0 ? (g.cost / byProblemTotal) * 100 : 0;
              return (
                <button
                  key={g.key}
                  onClick={() =>
                    toggleFilter(filterProblem, g.key, setFilterProblem)
                  }
                  className={`w-full flex items-center justify-between text-sm p-2 rounded-md transition-colors relative overflow-hidden ${
                    isActive
                      ? "bg-primary/10 ring-1 ring-primary/30"
                      : "hover:bg-muted/50"
                  }`}
                >
                  <div
                    className="absolute inset-y-0 left-0 bg-primary/5 transition-all"
                    style={{ width: `${barW}%` }}
                  />
                  <span className="relative text-muted-foreground truncate max-w-[140px]">
                    {g.label}
                  </span>
                  <div className="relative flex items-center gap-3 shrink-0">
                    {g.users && g.users.size > 0 && (
                      <span className="text-xs text-muted-foreground/70 truncate max-w-[100px]">
                        {Array.from(g.users).join(", ")}
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground">{g.calls} calls</span>
                    <span className="font-medium tabular-nums">${g.cost.toFixed(4)}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Active Filters — pills for user/problem (set by clicking charts) */}
      {(filterUser || filterProblem) && (
        <div className="flex items-center gap-2 text-sm flex-wrap">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <span className="text-muted-foreground">Filtering:</span>
          {filterUser && (
            <button
              onClick={() => setFilterUser("")}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-primary/10 text-primary text-xs"
            >
              User: {byUser.find((u) => u.key === filterUser)?.label || "Unknown"}
              <span className="ml-1">&times;</span>
            </button>
          )}
          {filterProblem && (
            <button
              onClick={() => setFilterProblem("")}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-primary/10 text-primary text-xs"
            >
              Problem:{" "}
              {byProblem.find((p) => p.key === filterProblem)?.label || "Unknown"}
              <span className="ml-1">&times;</span>
            </button>
          )}
          <button
            onClick={() => {
              setFilterUser("");
              setFilterProblem("");
            }}
            className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
          >
            Clear all
          </button>
        </div>
      )}

      {/* Detailed Usage Table */}
      <div className="rounded-lg border overflow-hidden">
        <div className="bg-muted/50 px-4 py-2.5 border-b">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-3">
              <h3 className="text-sm font-semibold">
                Usage Log{" "}
                {filteredUsage.length !== rangeUsage.length
                  ? `(${filteredUsage.length} of ${rangeUsage.length})`
                  : `(${filteredUsage.length})`}
              </h3>
              {/* Cross-filtered dropdowns */}
              <select
                value={filterUser}
                onChange={(e) => setFilterUser(e.target.value)}
                className="text-xs bg-background border border-border rounded-md px-2 py-1.5 text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="">All Users</option>
                {dropdownOptions.users.map((u) => (
                  <option key={u.key} value={u.key}>{u.label}</option>
                ))}
              </select>
              <select
                value={filterProblem}
                onChange={(e) => setFilterProblem(e.target.value)}
                className="text-xs bg-background border border-border rounded-md px-2 py-1.5 text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="">All Problems</option>
                {dropdownOptions.problems.map((p) => (
                  <option key={p.key} value={p.key}>{p.label}</option>
                ))}
              </select>
              <select
                value={filterModel}
                onChange={(e) => setFilterModel(e.target.value)}
                className="text-xs bg-background border border-border rounded-md px-2 py-1.5 text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="">All Models</option>
                {dropdownOptions.models.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
              <select
                value={filterPurpose}
                onChange={(e) => setFilterPurpose(e.target.value)}
                className="text-xs bg-background border border-border rounded-md px-2 py-1.5 text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="">All Purposes</option>
                {dropdownOptions.purposes.map((p) => (
                  <option key={p} value={p} className="capitalize">{p}</option>
                ))}
              </select>
              <select
                value={filterStep}
                onChange={(e) => setFilterStep(e.target.value)}
                className="text-xs bg-background border border-border rounded-md px-2 py-1.5 text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="">All Steps</option>
                {dropdownOptions.steps.map((s) => (
                  <option key={s.key} value={s.key}>{s.label}</option>
                ))}
              </select>
              {(filterUser || filterProblem || filterModel || filterPurpose || filterStep || filterAccount) && (
                <button
                  onClick={() => { setFilterUser(""); setFilterProblem(""); setFilterModel(""); setFilterPurpose(""); setFilterStep(""); setFilterAccount(""); }}
                  className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
                >
                  Clear
                </button>
              )}
            </div>
            {/* Totals summary on the right when filters are active */}
            {(filterUser || filterProblem || filterModel || filterPurpose || filterStep || filterAccount) && (
              <div className="flex items-center gap-4 text-xs">
                <span className="text-muted-foreground">
                  Prompt: <span className="font-semibold text-foreground tabular-nums">{filteredUsage.reduce((s, u) => s + u.prompt_tokens, 0).toLocaleString()}</span>
                </span>
                <span className="text-muted-foreground">
                  Completion: <span className="font-semibold text-foreground tabular-nums">{filteredUsage.reduce((s, u) => s + u.completion_tokens, 0).toLocaleString()}</span>
                </span>
                <span className="text-muted-foreground">
                  Cost: <span className="font-semibold text-foreground tabular-nums">${filteredUsage.reduce((s, u) => s + parseFloat(u.cost_usd || "0"), 0).toFixed(4)}</span>
                </span>
              </div>
            )}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/30">
                <th className="text-left px-4 py-2.5 font-medium">Date</th>
                <th className="text-left px-4 py-2.5 font-medium">User</th>
                <th className="text-left px-4 py-2.5 font-medium">Model</th>
                <th className="text-left px-4 py-2.5 font-medium">Purpose</th>
                <th className="text-left px-4 py-2.5 font-medium">Step</th>
                <th className="text-left px-4 py-2.5 font-medium">Problem</th>
                <th className="text-right px-4 py-2.5 font-medium">Prompt</th>
                <th className="text-right px-4 py-2.5 font-medium">Completion</th>
                <th className="text-right px-4 py-2.5 font-medium">Cost</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsage.slice(0, 200).map((u) => (
                <tr
                  key={u.id}
                  className="border-b last:border-0 hover:bg-muted/20"
                >
                  <td className="px-4 py-2.5 text-muted-foreground text-xs whitespace-nowrap">
                    {new Date(u.created_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground text-xs">
                    {u.profiles?.display_name || u.profiles?.email || "—"}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs">{u.model}</td>
                  <td className="px-4 py-2.5 capitalize text-muted-foreground text-xs">
                    {u.purpose}
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground text-xs" title={u.step_id || undefined}>
                    {stepLabel(u.step_id)}
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground text-xs max-w-[150px] truncate">
                    {u.problem_name || "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-xs">
                    {u.prompt_tokens.toLocaleString()}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-xs">
                    {u.completion_tokens.toLocaleString()}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-medium text-xs">
                    ${parseFloat(u.cost_usd).toFixed(4)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
