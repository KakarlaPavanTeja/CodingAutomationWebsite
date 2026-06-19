"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  XCircle,
  ChevronRight,
  Download,
  RefreshCw,
  Loader2,
  Clock,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ProblemExecutionLogsProps {
  problemId: string;
  questionType: string;
  isActive?: boolean;
}

const TC_SENTINEL = "@@TCRESULT@@";

const LANG_ORDER = ["C++", "Python", "Java", "Node.js"];

type TcRecord = {
  step: string;
  sol: string;
  si: number;
  lang: string;
  tc: number | null;
  order: number | null;
  status: string;
  passed: boolean;
  time: number | null;
  mem: number | null;
  detail: string;
};

type StepKey = "execute_tests" | "execute_editorial";

const STEP_META: { key: StepKey; stepId: (qt: string) => string; title: string; subtitle: string }[] = [
  {
    key: "execute_tests",
    stepId: (qt) => (qt === "nonfunction" ? "execute_tests_nonfunction" : "execute_tests_function"),
    title: "Execute Tests (Reference Solution)",
    subtitle: "The generated reference solution run against every testcase.",
  },
  {
    key: "execute_editorial",
    stepId: () => "execute_editorial",
    title: "Execute Editorial Approaches",
    subtitle: "Every editorial approach run in each language (informational — naive approaches may time out).",
  },
];

function parseSentinelLines(content: string): TcRecord[] {
  const out: TcRecord[] = [];
  if (!content) return out;
  for (const line of content.split("\n")) {
    const idx = line.indexOf(TC_SENTINEL);
    if (idx === -1) continue;
    const json = line.slice(idx + TC_SENTINEL.length).trim();
    if (!json) continue;
    try {
      const rec = JSON.parse(json) as TcRecord;
      if (rec && typeof rec === "object") out.push(rec);
    } catch {
      // ignore malformed line
    }
  }
  return out;
}

function statusTone(rec: TcRecord): string {
  if (rec.passed) return "text-green-600 dark:text-green-400";
  if (rec.status === "TIME_LIMIT_EXCEEDED") return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
}

function fmtTime(t: number | null): string {
  if (t == null) return "—";
  return `${t.toFixed(3)}s`;
}

function fmtMem(m: number | null): string {
  if (m == null) return "—";
  return `${m.toFixed(1)} MB`;
}

function langSort(a: string, b: string): number {
  const ia = LANG_ORDER.indexOf(a);
  const ib = LANG_ORDER.indexOf(b);
  return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
}

function tcKey(r: TcRecord): number {
  if (r.order != null) return r.order;
  if (r.tc != null) return r.tc;
  return 0;
}

function tcLabel(r: TcRecord): string {
  const n = r.tc ?? r.order;
  return n == null ? "?" : String(n);
}

interface SolutionGroup {
  si: number;
  sol: string;
  langs: { lang: string; records: TcRecord[]; passed: number; total: number }[];
}

function groupByStep(records: TcRecord[], step: StepKey): SolutionGroup[] {
  const stepRecs = records.filter((r) => r.step === step);
  const bySol = new Map<number, { sol: string; byLang: Map<string, TcRecord[]> }>();
  for (const r of stepRecs) {
    if (!bySol.has(r.si)) bySol.set(r.si, { sol: r.sol, byLang: new Map() });
    const entry = bySol.get(r.si)!;
    entry.sol = r.sol || entry.sol;
    if (!entry.byLang.has(r.lang)) entry.byLang.set(r.lang, []);
    entry.byLang.get(r.lang)!.push(r);
  }
  const groups: SolutionGroup[] = [];
  for (const [si, entry] of [...bySol.entries()].sort((a, b) => a[0] - b[0])) {
    const langs = [...entry.byLang.entries()]
      .sort((a, b) => langSort(a[0], b[0]))
      .map(([lang, recs]) => {
        const sorted = [...recs].sort((a, b) => tcKey(a) - tcKey(b));
        return {
          lang,
          records: sorted,
          passed: sorted.filter((r) => r.passed).length,
          total: sorted.length,
        };
      });
    groups.push({ si, sol: entry.sol, langs });
  }
  return groups;
}

function TestcaseRow({ rec }: { rec: TcRecord }) {
  const [open, setOpen] = useState(false);
  const hasDetail = !rec.passed && !!rec.detail;

  const download = () => {
    const blob = new Blob([rec.detail || ""], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${rec.step}_${rec.sol}_${rec.lang}_tc${tcLabel(rec)}.txt`
      .replace(/[^a-zA-Z0-9._-]+/g, "_");
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="border-t border-border/60 first:border-t-0">
      <button
        type="button"
        onClick={() => hasDetail && setOpen((v) => !v)}
        className={cn(
          "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs",
          hasDetail ? "cursor-pointer hover:bg-muted/40" : "cursor-default",
        )}
      >
        {hasDetail ? (
          <ChevronRight className={cn("h-3.5 w-3.5 shrink-0 transition-transform", open && "rotate-90")} />
        ) : (
          <span className="w-3.5" />
        )}
        {rec.passed ? (
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-green-600 dark:text-green-400" />
        ) : rec.status === "TIME_LIMIT_EXCEEDED" ? (
          <Clock className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
        ) : (
          <XCircle className="h-3.5 w-3.5 shrink-0 text-red-600 dark:text-red-400" />
        )}
        <span className="font-mono text-muted-foreground">TC {tcLabel(rec)}</span>
        <span className={cn("font-medium", statusTone(rec))}>{rec.status}</span>
        <span className="ml-auto flex items-center gap-3 font-mono text-[11px] text-muted-foreground">
          <span>{fmtTime(rec.time)}</span>
          <span>{fmtMem(rec.mem)}</span>
        </span>
      </button>
      {open && hasDetail && (
        <div className="px-3 pb-2">
          <div className="mb-1 flex justify-end">
            <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px]" onClick={download}>
              <Download className="mr-1 h-3 w-3" /> Download
            </Button>
          </div>
          <pre className="max-h-64 overflow-auto rounded-md bg-muted/60 p-2 text-[11px] leading-relaxed whitespace-pre-wrap break-words">
            {rec.detail}
          </pre>
        </div>
      )}
    </div>
  );
}

function LanguageBlock({
  lang,
  records,
  passed,
  total,
}: {
  lang: string;
  records: TcRecord[];
  passed: number;
  total: number;
}) {
  const allPassed = total > 0 && passed === total;
  const [showAll, setShowAll] = useState(false);
  const limit = records.some((r) => !r.passed) ? 50 : 5;
  const visible = showAll ? records : records.slice(0, limit);

  return (
    <div className="rounded-md border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <span className="text-sm font-semibold">{lang}</span>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[11px] font-medium",
            allPassed
              ? "bg-green-500/10 text-green-700 dark:text-green-400"
              : "bg-red-500/10 text-red-700 dark:text-red-400",
          )}
        >
          {passed}/{total} passed
        </span>
      </div>
      <div>
        {visible.map((rec, i) => (
          <TestcaseRow key={`${rec.tc}-${rec.order}-${i}`} rec={rec} />
        ))}
      </div>
      {records.length > visible.length && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="w-full border-t border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted/40"
        >
          Show {records.length - visible.length} more
        </button>
      )}
    </div>
  );
}

function SolutionSection({ group }: { group: SolutionGroup }) {
  const totalPassed = group.langs.reduce((s, l) => s + l.passed, 0);
  const total = group.langs.reduce((s, l) => s + l.total, 0);
  const allPassed = total > 0 && totalPassed === total;
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className="flex w-full items-center gap-2 text-left"
      >
        <ChevronRight className={cn("h-4 w-4 transition-transform", !collapsed && "rotate-90")} />
        <span className="text-sm font-semibold">{group.sol}</span>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[11px] font-medium",
            allPassed
              ? "bg-green-500/10 text-green-700 dark:text-green-400"
              : "bg-amber-500/10 text-amber-700 dark:text-amber-400",
          )}
        >
          {totalPassed}/{total} testcases passed
        </span>
      </button>
      {!collapsed && (
        <div className="grid gap-2 pl-6 md:grid-cols-2">
          {group.langs.map((l) => (
            <LanguageBlock key={l.lang} {...l} />
          ))}
        </div>
      )}
    </div>
  );
}

export function ProblemExecutionLogs({ problemId, questionType, isActive }: ProblemExecutionLogsProps) {
  const [records, setRecords] = useState<TcRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setRefreshing(true);
    try {
      const all: TcRecord[] = [];
      for (const meta of STEP_META) {
        const stepId = meta.stepId(questionType);
        try {
          const res = await fetch(
            `/api/pipeline/run/logs?problemId=${encodeURIComponent(problemId)}&stepId=${encodeURIComponent(stepId)}&tail=200000`,
          );
          if (!res.ok) continue;
          const data = await res.json();
          all.push(...parseSentinelLines(data.content || ""));
        } catch {
          // ignore per-step fetch error
        }
      }
      setRecords(all);
      setLastUpdated(Date.now());
    } finally {
      inFlight.current = false;
      setRefreshing(false);
      setLoading(false);
    }
  }, [problemId, questionType]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!isActive) return;
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, [isActive, load]);

  const executeGroups = useMemo(() => groupByStep(records, "execute_tests"), [records]);
  const editorialGroups = useMemo(() => groupByStep(records, "execute_editorial"), [records]);

  const downloadAll = () => {
    const blob = new Blob([JSON.stringify(records, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `execution-logs-${problemId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const groupsByKey: Record<StepKey, SolutionGroup[]> = {
    execute_tests: executeGroups,
    execute_editorial: editorialGroups,
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading execution logs…
      </div>
    );
  }

  const hasAny = records.length > 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Execution Testcase Logs</h2>
          <p className="text-sm text-muted-foreground">
            Per-testcase results for the reference solution and every editorial approach.
            {lastUpdated && (
              <span className="ml-1">Updated {new Date(lastUpdated).toLocaleTimeString()}.</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {hasAny && (
            <Button variant="outline" size="sm" onClick={downloadAll}>
              <Download className="mr-1 h-4 w-4" /> Download all
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={load} disabled={refreshing}>
            <RefreshCw className={cn("mr-1 h-4 w-4", refreshing && "animate-spin")} /> Refresh
          </Button>
        </div>
      </div>

      {!hasAny && (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border py-16 text-center text-muted-foreground">
          <AlertTriangle className="h-6 w-6" />
          <p className="text-sm">No execution results yet.</p>
          <p className="text-xs">
            Run the execute-tests and execute-editorial pipeline steps to populate this view.
          </p>
        </div>
      )}

      {STEP_META.map((meta) => {
        const groups = groupsByKey[meta.key];
        if (groups.length === 0) return null;
        return (
          <div key={meta.key} className="space-y-3 rounded-lg border border-border bg-muted/20 p-4">
            <div>
              <h3 className="text-base font-semibold">{meta.title}</h3>
              <p className="text-xs text-muted-foreground">{meta.subtitle}</p>
            </div>
            <div className="space-y-4">
              {groups.map((g) => (
                <SolutionSection key={`${meta.key}-${g.si}`} group={g} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
