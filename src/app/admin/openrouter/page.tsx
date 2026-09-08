"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DollarSign,
  User,
  FileText,
  Filter,
  BarChart3,
  RefreshCw,
  Key,
  Info,
} from "lucide-react";
import { STEP_CONFIGS } from "@/lib/pipeline-config";
import {
  accountForUsageRow,
  hasApproximateAccounts,
} from "@/lib/openrouter-usage-account";

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

// One source for the purpose colours. These were duplicated as two identical
// literals — one for the stacked bars, one for the legend — so a change to
// either would have silently desynced the legend from the chart it labels.
const PURPOSE_COLORS = [
  "#3b82f6",
  "#10b981",
  "#8b5cf6",
  "#f59e0b",
  "#ec4899",
  "#06b6d4",
];

/** How many log rows to reveal at a time. */
const ROW_PAGE = 100;

function matchesFilter(
  value: string | null,
  filterKey: string
): boolean {
  if (!filterKey) return true;
  if (filterKey === "__null__") return value === null || value === undefined;
  return value === filterKey;
}

// Which OpenRouter account (key) a usage row belongs to.
//
// This used to be derived from `created_at` alone, which ignored
// `llm_usage.account` — the column the attribution fix added so this would not be
// a guess. A date cutoff cannot know that an admin switched the active key back
// to "old", so it labelled every recent row "new". See
// src/lib/openrouter-usage-account.ts for the per-row precedence.
function accountForRow(u: UsageEntry): "new" | "old" {
  return accountForUsageRow(u);
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
    // Ticks are quarters of a "nice" max, so they are routinely fractional
    // (22.5, 7.5). Rounding those to whole dollars printed a $30 axis as
    // "$30 / $23 / $15 / $8" — labels that match no gridline value.
    if (val >= 1) return `$${Number.isInteger(val) ? val : val.toFixed(2)}`;
    if (val >= 0.01) return `$${val.toFixed(2)}`;
    return `$${val.toFixed(4)}`;
  }
  if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(1)}M`;
  if (val >= 1_000) return `${(val / 1_000).toFixed(1)}K`;
  return String(Math.round(val));
}

type ActiveKeyInfo = { choice: "new" | "old"; hasNew: boolean; hasOld: boolean };

const ACCOUNT_LABEL: Record<"new" | "old", string> = { new: "New", old: "Old" };

/** Shared control styles, so the toolbar reads as one set of controls. */
const CONTROL =
  "h-8 rounded-md border border-border bg-card px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary";
// A native select sizes itself to its widest option, and full model ids
// ("anthropic/claude-sonnet-4.6") stretched three of these across the row and
// pushed the toolbar onto a second line. Cap them; the full value stays visible
// in the open dropdown and in the active-filter pill.
const CONTROL_SELECT = `${CONTROL} max-w-[10.5rem] truncate`;
const SEGMENT_WRAP = "flex h-8 items-center rounded-md bg-muted/60 p-0.5";
const segment = (active: boolean) =>
  `h-7 rounded px-2.5 text-xs font-medium transition-colors ${
    active
      ? "bg-background text-foreground shadow-sm"
      : "text-muted-foreground hover:text-foreground"
  }`;

/**
 * Which key the app bills to right now, and an explicit way to change it.
 *
 * This used to be a single "API key" dropdown that ALSO filtered the report, so
 * an admin narrowing the view to "Old" to look at history silently repointed
 * every future LLM call at the old key — a billing change disguised as a filter,
 * sitting between a timestamp and a Refresh button.
 *
 * The two jobs are now separate. This one changes billing, and asks first
 * because it is not a view change. The toolbar's "Showing" select only filters.
 * It also reports the *real* active key, read from the server: the old dropdown
 * started at "All" and never fetched, so the page could not tell you which key
 * was live — the single most important fact on it.
 */
function ActiveKeyPanel({
  info,
  busy,
  onSwitch,
}: {
  info: ActiveKeyInfo | null;
  busy: boolean;
  onSwitch: (choice: "new" | "old") => void;
}) {
  const [confirming, setConfirming] = useState(false);

  if (!info) {
    return (
      <span className="text-xs text-muted-foreground">Active key: unknown</span>
    );
  }

  const other = info.choice === "new" ? "old" : "new";
  const otherConfigured = other === "new" ? info.hasNew : info.hasOld;

  return (
    <div className="flex items-center gap-2">
      <span className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-xs">
        <Key className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-muted-foreground">Billing to</span>
        <span className="font-semibold">{ACCOUNT_LABEL[info.choice]}</span>
      </span>

      {!otherConfigured ? (
        <span
          className="text-[11px] text-muted-foreground"
          title={`OPENROUTER_API_KEY${other === "old" ? "_OLD" : ""} is not set`}
        >
          {ACCOUNT_LABEL[other]} key not configured
        </span>
      ) : confirming ? (
        <span className="flex items-center gap-1.5 text-xs">
          <span className="text-muted-foreground">
            Bill all new calls to {ACCOUNT_LABEL[other]}?
          </span>
          <button
            onClick={() => {
              onSwitch(other);
              setConfirming(false);
            }}
            disabled={busy}
            className="h-8 rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground disabled:opacity-60"
          >
            {busy ? "Switching…" : "Confirm"}
          </button>
          <button
            onClick={() => setConfirming(false)}
            className="h-8 rounded-md border border-border bg-card px-2.5 text-xs hover:bg-muted/50"
          >
            Cancel
          </button>
        </span>
      ) : (
        <button
          onClick={() => setConfirming(true)}
          className="h-8 rounded-md border border-border bg-card px-2.5 text-xs hover:bg-muted/50"
          title={`Switch billing to the ${ACCOUNT_LABEL[other]} key`}
        >
          Switch to {ACCOUNT_LABEL[other]}
        </button>
      )}
    </div>
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
  // 30 days, not "all": on "all" a year of history compresses to ~1px per day
  // and one busy week flattens every other bar to nothing. History is still one
  // click away.
  const [timeRange, setTimeRange] = useState<TimeRange>("1m");
  const [includeImported, setIncludeImported] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [activeKey, setActiveKey] = useState<ActiveKeyInfo | null>(null);
  const [switchingKey, setSwitchingKey] = useState(false);
  // How many log rows to render. The table used to hard-slice at 200 while its
  // header counted every match, so it claimed "600" above 200 visible rows.
  const [rowLimit, setRowLimit] = useState(ROW_PAGE);
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

  // Which key the app is actually billing to. The page used to never ask, so it
  // could not show the one fact an admin comes here for.
  const fetchActiveKey = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/openrouter-key", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as ActiveKeyInfo;
      if (data?.choice === "new" || data?.choice === "old") setActiveKey(data);
    } catch {
      // Leave it reading "unknown" rather than asserting a key we didn't confirm.
    }
  }, []);

  const switchActiveKey = useCallback(async (choice: "new" | "old") => {
    setSwitchingKey(true);
    try {
      const res = await fetch("/api/admin/openrouter-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ choice }),
      });
      if (res.ok) setActiveKey((prev) => (prev ? { ...prev, choice } : prev));
    } catch {
      // Keep showing the last confirmed value.
    } finally {
      setSwitchingKey(false);
    }
  }, []);

  // Initial load + auto-refresh so new pipeline runs show up without a reload.
  useEffect(() => {
    fetchUsage();
    fetchActiveKey();
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") fetchUsage();
    }, 30000);
    const onVisible = () => {
      if (document.visibilityState === "visible") fetchUsage();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [fetchUsage, fetchActiveKey]);

  // Any filter change re-collapses the log to one page.
  useEffect(() => {
    setRowLimit(ROW_PAGE);
  }, [filterUser, filterProblem, filterModel, filterPurpose, filterStep, filterAccount, timeRange, includeImported]);

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
    // userScoped / problemScoped are these exact sets, already computed above for
    // the breakdown panels. Recomputing them here walked the whole usage array
    // twice more on every filter change, for identical results.
    const forUser = userScoped;
    const forProblem = problemScoped;
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
  }, [rangeUsage, applyFilters, userScoped, problemScoped]);

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

  // One header for every state, so the active key and Refresh never move.
  const pageHeader = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-lg font-semibold">OpenRouter Dashboard</h2>
      <div className="flex flex-wrap items-center gap-2">
        <ActiveKeyPanel
          info={activeKey}
          busy={switchingKey}
          onSwitch={switchActiveKey}
        />
        {lastUpdated && (
          <span className="text-xs text-muted-foreground tabular-nums">
            {lastUpdated.toLocaleTimeString()}
          </span>
        )}
        <button
          onClick={() => fetchUsage()}
          disabled={refreshing}
          className={`${CONTROL} inline-flex items-center gap-1.5 font-medium hover:bg-muted/50 disabled:opacity-60`}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>
    </div>
  );

  if (usage.length === 0) {
    return (
      <div className="space-y-4">
        {pageHeader}
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

  const hasFilters = Boolean(
    filterUser || filterProblem || filterModel || filterPurpose || filterStep || filterAccount
  );
  const clearFilters = () => {
    setFilterUser("");
    setFilterProblem("");
    setFilterModel("");
    setFilterPurpose("");
    setFilterStep("");
    setFilterAccount("");
  };

  // Every active filter as a removable pill. Previously only user and problem
  // got one, so a model/purpose/step/key filter silently changed every number on
  // the page with nothing on screen saying so.
  const activeFilterPills: { label: string; clear: () => void }[] = [
    filterUser && {
      label: `User: ${dropdownOptions.users.find((u) => u.key === filterUser)?.label ?? "Unknown"}`,
      clear: () => setFilterUser(""),
    },
    filterProblem && {
      label: `Problem: ${dropdownOptions.problems.find((p) => p.key === filterProblem)?.label ?? "Unknown"}`,
      clear: () => setFilterProblem(""),
    },
    filterModel && { label: `Model: ${filterModel}`, clear: () => setFilterModel("") },
    filterPurpose && { label: `Purpose: ${filterPurpose}`, clear: () => setFilterPurpose("") },
    filterStep && { label: `Step: ${stepLabel(filterStep)}`, clear: () => setFilterStep("") },
    filterAccount && {
      label: `Key: ${ACCOUNT_LABEL[filterAccount as "new" | "old"] ?? filterAccount}`,
      clear: () => setFilterAccount(""),
    },
  ].filter((p): p is { label: string; clear: () => void } => Boolean(p));

  // Whether a per-key split can be stated exactly for what's on screen.
  const approximateAttribution = hasApproximateAccounts(rangeUsage);

  const visibleRows = filteredUsage.slice(0, rowLimit);

  return (
    <div className="space-y-5">
      {pageHeader}

      {/*
        One bar for everything that scopes the whole dashboard. These controls
        used to be split across three places — the page header, the chart header
        and the table header — which is why the page read as a wall of controls
        and why the time range looked like it only affected the chart.
      */}
      <div className="rounded-lg border bg-card px-3 py-2.5 space-y-2">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className={SEGMENT_WRAP}>
            {TIME_RANGES.map((r) => (
              <button
                key={r.key}
                onClick={() => setTimeRange(r.key)}
                className={segment(timeRange === r.key)}
              >
                {r.label}
              </button>
            ))}
          </div>

          <label className="inline-flex items-center gap-1.5 text-xs">
            <span className="text-muted-foreground">Key</span>
            <select
              value={filterAccount}
              onChange={(e) => setFilterAccount(e.target.value)}
              className={CONTROL}
              title="Filters the report only — it does not change which key is billed"
            >
              <option value="">All</option>
              <option value="new">New</option>
              <option value="old">Old</option>
            </select>
          </label>

          <div className="h-5 w-px bg-border" aria-hidden />

          <select
            value={filterUser}
            onChange={(e) => setFilterUser(e.target.value)}
            className={CONTROL_SELECT}
            aria-label="Filter by user"
          >
            <option value="">All users</option>
            {dropdownOptions.users.map((u) => (
              <option key={u.key} value={u.key}>{u.label}</option>
            ))}
          </select>
          <select
            value={filterProblem}
            onChange={(e) => setFilterProblem(e.target.value)}
            className={CONTROL_SELECT}
            aria-label="Filter by problem"
          >
            <option value="">All problems</option>
            {dropdownOptions.problems.map((p) => (
              <option key={p.key} value={p.key}>{p.label}</option>
            ))}
          </select>
          <select
            value={filterModel}
            onChange={(e) => setFilterModel(e.target.value)}
            className={CONTROL_SELECT}
            aria-label="Filter by model"
          >
            <option value="">All models</option>
            {dropdownOptions.models.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
          <select
            value={filterPurpose}
            onChange={(e) => setFilterPurpose(e.target.value)}
            className={CONTROL_SELECT}
            aria-label="Filter by purpose"
          >
            <option value="">All purposes</option>
            {dropdownOptions.purposes.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
          <select
            value={filterStep}
            onChange={(e) => setFilterStep(e.target.value)}
            className={CONTROL_SELECT}
            aria-label="Filter by pipeline step"
          >
            <option value="">All steps</option>
            {dropdownOptions.steps.map((s) => (
              <option key={s.key} value={s.key}>{s.label}</option>
            ))}
          </select>

          <div className="ml-auto flex items-center gap-2">
            {/* Action-labelled, not state-labelled: "Excluding imported" left it
                ambiguous whether that described the state or what a click does. */}
            <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={includeImported}
                onChange={(e) => setIncludeImported(e.target.checked)}
                className="h-3.5 w-3.5 accent-primary"
              />
              <span title="Legacy rows with no user, imported before per-call tracking existed">
                Include imported
              </span>
            </label>
            {hasFilters && (
              <button
                onClick={clearFilters}
                className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
              >
                Clear filters
              </button>
            )}
          </div>
        </div>

        {activeFilterPills.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 border-t border-border/50 pt-2 text-xs">
            <Filter className="h-3.5 w-3.5 text-muted-foreground" />
            {activeFilterPills.map((pill) => (
              <button
                key={pill.label}
                onClick={pill.clear}
                className="inline-flex items-center gap-1 rounded bg-primary/10 px-2 py-0.5 text-primary"
                title="Remove this filter"
              >
                {pill.label}
                <span aria-hidden>&times;</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {truncated && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
          Showing the most recent 100,000 usage rows. Older history is excluded
          from these totals.
        </div>
      )}

      {approximateAttribution && filterAccount && (
        <div className="flex items-start gap-2 rounded-lg border bg-muted/40 px-4 py-2.5 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Some rows in this range predate per-call key attribution, so this
            per-key split is approximate. Spend before the fingerprint fix was
            recorded from the active-key toggle, which mislabelled roughly $37 of
            old-key usage and was never backfilled.
          </span>
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
          {/* Only the chart's own metric lives here. The time range moved to the
              toolbar, because it scopes the cards, breakdowns and log too — in
              the chart header it read as a chart-only control. */}
          <div className={SEGMENT_WRAP}>
            {(["cost", "tokens", "calls"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setBarMode(m)}
                className={segment(barMode === m)}
              >
                {m === "cost" ? "Cost ($)" : m === "tokens" ? "Tokens" : "Calls"}
              </button>
            ))}
          </div>
        </div>

        {/* Chart area — clean div-based */}
        {(() => {
          const CHART_HEIGHT = 220;
          const X_AXIS_HEIGHT = 28;
          const n = chartData.length;
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
                    {chartData.map((bar) => {
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
                    className="absolute bottom-0 left-0 h-[3px] rounded-full bg-primary/40 transition-all"
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
                    className="absolute bottom-0 left-0 h-[3px] rounded-full bg-primary/40 transition-all"
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

      {/* Detailed Usage Table */}
      <div className="rounded-lg border overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/50 px-4 py-2.5">
          <h3 className="text-sm font-semibold">Usage Log</h3>
          {/* Honest count. The dropdowns that used to crowd in here are in the
              toolbar now, and the per-column totals duplicated the summary cards. */}
          <span className="text-xs text-muted-foreground tabular-nums">
            {filteredUsage.length === 0
              ? "no matching calls"
              : `showing ${visibleRows.length.toLocaleString()} of ${filteredUsage.length.toLocaleString()}`}
            {/* The unfiltered count only adds information when filters actually
                removed something. */}
            {hasFilters && filteredUsage.length !== rangeUsage.length
              ? ` (${rangeUsage.length.toLocaleString()} in range)`
              : ""}
          </span>
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
              {visibleRows.map((u) => (
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
        {filteredUsage.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">
            {/* Two different causes, and offering "clear filters" for the wrong
                one reads as "clear filters to see the 0 calls in this range". */}
            {rangeUsage.length === 0 ? (
              <>No LLM usage in this time range. Try a wider range.</>
            ) : (
              <>
                No calls match these filters.{" "}
                <button
                  onClick={clearFilters}
                  className="underline underline-offset-2 hover:text-foreground"
                >
                  Clear filters
                </button>{" "}
                to see the {rangeUsage.length.toLocaleString()} call
                {rangeUsage.length === 1 ? "" : "s"} in this range.
              </>
            )}
          </div>
        ) : (
          visibleRows.length < filteredUsage.length && (
            <div className="border-t px-4 py-3 text-center">
              <button
                onClick={() => setRowLimit((n) => n + ROW_PAGE)}
                className={`${CONTROL} font-medium hover:bg-muted/50`}
              >
                Show {Math.min(ROW_PAGE, filteredUsage.length - visibleRows.length)} more
              </button>
            </div>
          )
        )}
      </div>
    </div>
  );
}
