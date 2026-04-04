"use client";

import { useMemo, useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import type { LogLine } from "@/types/pipeline";

interface LangResult {
  name: string;
  total: number;
  passed: number;
  failed: number;
  current: number;
  errors: { index: number; status: string; detail: string }[];
  passRate: number;
  startTs?: number;
  endTs?: number;
}

function parseExecutionResults(logs: LogLine[]): LangResult[] {
  const results: Map<string, LangResult> = new Map();
  let currentLang = "";

  for (const log of logs) {
    const line = log.line;

    // Detect language section — v2 format: "TESTING PYTHON - 48 TEST CASES (CASE-2 IO PAYLOAD)"
    // Also matches nonfunctionbased: "TESTING PYTHON - 48 TEST CASES"
    const langMatch = line.match(/TESTING\s+(\S+)\s+-\s+(\d+)\s+TEST\s+CASES/i);
    if (langMatch) {
      currentLang = langMatch[1];
      results.set(currentLang, {
        name: currentLang,
        total: parseInt(langMatch[2]),
        passed: 0,
        failed: 0,
        current: 0,
        errors: [],
        passRate: 0,
        startTs: log.ts,
      });
      continue;
    }

    // v2 format: [LANG] Progress X/Y - STATUS | time=... | memory=...
    const progressMatch = line.match(/\[(\S+)\]\s+Progress\s+(\d+)\/(\d+)\s+-\s+(\w+)/i);
    if (progressMatch) {
      const lang = progressMatch[1];
      const index = parseInt(progressMatch[2]);
      const status = progressMatch[4];

      let result = results.get(lang);
      if (!result) {
        result = { name: lang, total: parseInt(progressMatch[3]), passed: 0, failed: 0, current: 0, errors: [], passRate: 0, startTs: log.ts };
        results.set(lang, result);
      }

      result.current = index;
      if (status === "CORRECT") {
        result.passed++;
      } else {
        result.failed++;
        const errorMatch = line.match(/error=([^|]+)/i);
        result.errors.push({
          index,
          status,
          detail: errorMatch ? errorMatch[1].trim() : status,
        });
      }
      result.passRate = result.passed / (result.passed + result.failed) * 100;
      result.endTs = log.ts;
      continue;
    }

    // Nonfunctionbased format: "Solution 1 - Test 3/48: ✅ PASSED" or "❌ FAILED"
    const nfMatch = line.match(/Solution \d+ - Test (\d+)\/(\d+):\s*/);
    if (nfMatch && currentLang) {
      const index = parseInt(nfMatch[1]);
      const total = parseInt(nfMatch[2]);

      let result = results.get(currentLang);
      if (!result) {
        result = { name: currentLang, total, passed: 0, failed: 0, current: 0, errors: [], passRate: 0, startTs: log.ts };
        results.set(currentLang, result);
      }

      result.current = index;
      if (/PASSED/i.test(line)) {
        result.passed++;
      } else if (/FAILED/i.test(line)) {
        result.failed++;
        const detailMatch = line.match(/FAILED\s*[-–—]?\s*(.*)/i);
        result.errors.push({
          index,
          status: "FAILED",
          detail: detailMatch ? detailMatch[1].trim() : "FAILED",
        });
      }
      result.passRate = (result.passed + result.failed) > 0
        ? result.passed / (result.passed + result.failed) * 100
        : 0;
      result.endTs = log.ts;
      continue;
    }

    // Detect per-language summary: "LANG: passed X/Y"
    const summaryMatch = line.match(/^(\S+):\s+passed\s+(\d+)\/(\d+)/i);
    if (summaryMatch) {
      const lang = summaryMatch[1];
      const result = results.get(lang);
      if (result) {
        result.endTs = log.ts;
      }
    }
  }

  return Array.from(results.values());
}

function formatElapsed(startTs?: number, endTs?: number): string {
  if (!startTs) return "";
  const end = endTs || Date.now();
  const secs = Math.floor((end - startTs) / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  return `${mins}m ${secs % 60}s`;
}

interface ExecutionResultsProps {
  logs: LogLine[];
  isRunning: boolean;
}

export function ExecutionResults({ logs, isRunning }: ExecutionResultsProps) {
  const results = useMemo(() => parseExecutionResults(logs), [logs]);

  // Tick for live timer updates
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!isRunning) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [isRunning]);

  if (results.length === 0) return null;

  return (
    <div className="space-y-3 pt-2">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        Execution Results
      </p>
      <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
        {results.map((result) => {
          const processed = result.passed + result.failed;
          const done = processed >= result.total;
          const allPassed = done && result.failed === 0;
          const hasFailed = result.failed > 0;
          const isActive = !done && result.current > 0;

          return (
            <div
              key={result.name}
              className={cn(
                "rounded-lg border p-3 space-y-2",
                allPassed && "border-green-500/30 bg-green-500/5",
                hasFailed && done && "border-red-500/30 bg-red-500/5",
                !done && "border-border bg-card/50"
              )}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">{result.name}</span>
                  {isActive && (
                    <div className="w-3 h-3 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {result.startTs && (
                    <span className={cn(
                      "text-xs tabular-nums",
                      isActive ? "text-blue-400 font-medium" : "text-muted-foreground"
                    )}>
                      {formatElapsed(result.startTs, done ? result.endTs : undefined)}
                    </span>
                  )}
                  <span className={cn(
                    "text-xs font-mono px-2 py-0.5 rounded-full",
                    allPassed && "bg-green-500/20 text-green-400",
                    hasFailed && "bg-red-500/20 text-red-400",
                    !done && !hasFailed && "bg-blue-500/20 text-blue-400"
                  )}>
                    {result.passed}/{result.total} passed
                  </span>
                </div>
              </div>

              {/* Progress bar */}
              <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                <div className="h-full flex">
                  <div
                    className="bg-green-500 transition-all duration-300"
                    style={{ width: `${(result.passed / result.total) * 100}%` }}
                  />
                  <div
                    className="bg-red-500 transition-all duration-300"
                    style={{ width: `${(result.failed / result.total) * 100}%` }}
                  />
                </div>
              </div>

              {/* Progress text */}
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{processed}/{result.total} tests processed</span>
                {done && <span className={allPassed ? "text-green-400" : "text-red-400"}>
                  {result.passRate.toFixed(1)}% pass rate
                </span>}
              </div>

              {/* Error summary */}
              {result.errors.length > 0 && (
                <div className="text-xs text-red-400 space-y-0.5 max-h-20 overflow-auto">
                  {result.errors.slice(0, 3).map((err) => (
                    <div key={err.index}>
                      TC #{err.index}: {err.status} {err.detail !== err.status ? `- ${err.detail}` : ""}
                    </div>
                  ))}
                  {result.errors.length > 3 && (
                    <div className="text-muted-foreground">+{result.errors.length - 3} more errors</div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
