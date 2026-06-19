import type { LogLine } from "@/types/pipeline";

export type LangExecState =
  | "pending" // selected, not started yet
  | "running" // started, no terminal signal yet
  | "passed" // ran to completion, every test passed
  | "failed" // ran to completion, some wrong answers (no halting error)
  | "error" // stopped early due to a compile/runtime error
  | "not_run"; // halted before it ran, or never produced output once the run ended

export interface ExecError {
  index: number;
  status: string;
  detail: string;
}

export interface ExecLangResult {
  id?: string; // enabledLanguages id (python/cpp/java/nodejs) when known
  name: string; // display name (Python, C++, Java, Node.js)
  key: string; // canonical key (PYTHON/CPP/JAVA/NODEJS) or raw uppercase
  total: number;
  passed: number;
  failed: number;
  current: number; // last processed test index
  errors: ExecError[];
  passRate: number;
  maxTime: number;
  maxMemory: number;
  startTs?: number;
  endTs?: number;
  state: LangExecState;
  errorReason?: string; // e.g. "Compilation error", "Runtime error"
}

export interface ExecParseResult {
  langs: ExecLangResult[];
  halted: boolean;
  runEnded: boolean;
}

interface ParseOpts {
  enabledLanguages?: string[];
  isRunning: boolean;
  exitCode: number | null;
}

const LANG_META: Record<string, { id: string; name: string }> = {
  PYTHON: { id: "python", name: "Python" },
  CPP: { id: "cpp", name: "C++" },
  JAVA: { id: "java", name: "Java" },
  NODEJS: { id: "nodejs", name: "Node.js" },
};

// Statuses that halt a language's remaining tests (and the rest of the run).
const HALTING_STATUSES = new Set(["COMPILATION_ERROR", "RUNTIME_ERROR"]);

// Normalise any language spelling (log key, display name, or selector id) to a
// single canonical key so the two views can never disagree about identity.
export function canonLang(raw: string): string {
  const u = raw.trim().toUpperCase();
  if (u === "CPP" || u === "C++" || u.startsWith("C+")) return "CPP";
  if (u.startsWith("PY")) return "PYTHON";
  if (u.startsWith("NODE") || u === "NODEJS" || u === "JS") return "NODEJS";
  if (u.startsWith("JAVA")) return "JAVA";
  return u;
}

function metaFor(key: string, rawName?: string): { id?: string; name: string } {
  const meta = LANG_META[key];
  if (meta) return meta;
  const raw = rawName || key;
  const name =
    raw.length > 3 ? raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase() : raw;
  return { name };
}

function newResult(key: string, total: number, rawName?: string, startTs?: number): ExecLangResult {
  const { id, name } = metaFor(key, rawName);
  return {
    id,
    name,
    key,
    total,
    passed: 0,
    failed: 0,
    current: 0,
    errors: [],
    passRate: 0,
    maxTime: 0,
    maxMemory: 0,
    startTs,
    state: "running",
  };
}

function reasonForStatus(status: string): string {
  switch (status) {
    case "COMPILATION_ERROR":
      return "Compilation error";
    case "RUNTIME_ERROR":
      return "Runtime error";
    case "API_ERROR":
      return "API error";
    case "NO_RESULTS":
      return "No results";
    case "PAYLOAD_TOO_LARGE":
      return "Payload too large";
    default:
      return status;
  }
}

/**
 * Single source of truth for parsing execute-step logs into a per-language
 * result set. Both the top progress list (StepProgress) and the results cards
 * (ExecutionResults) render from this so they can never drift apart.
 */
export function parseExecutionLogs(logs: LogLine[], opts: ParseOpts): ExecParseResult {
  const { enabledLanguages, isRunning, exitCode } = opts;
  const map = new Map<string, ExecLangResult>();
  const order: string[] = [];
  // Track explicit terminal signals from the additive [EXEC_EVENT] markers and
  // the per-language summary lines.
  const endMarker = new Map<string, { outcome: string; ts?: number }>();
  let halted = false;
  let runEnded = false;
  let currentLang = ""; // for nonfunction "Solution N - Test X/Y" lines

  const ensure = (key: string, total: number, rawName?: string, ts?: number) => {
    let r = map.get(key);
    if (!r) {
      r = newResult(key, total, rawName, ts);
      map.set(key, r);
      order.push(key);
    }
    return r;
  };

  for (const log of logs) {
    const line = log.line;

    // Explicit additive markers emitted by the python managers.
    // [EXEC_EVENT] lang_end name=<X> total=<t> processed=<n> passed=<p> outcome=<passed|failed|halted>
    const evtMatch = line.match(/\[EXEC_EVENT\]\s+(\w+)(.*)$/);
    if (evtMatch) {
      const event = evtMatch[1];
      const rest = evtMatch[2];
      if (event === "lang_end") {
        const name = rest.match(/name=(\S+)/)?.[1];
        const total = parseInt(rest.match(/total=(\d+)/)?.[1] || "0");
        const processed = parseInt(rest.match(/processed=(\d+)/)?.[1] || "0");
        const passed = parseInt(rest.match(/passed=(\d+)/)?.[1] || "0");
        const outcome = rest.match(/outcome=(\w+)/)?.[1] || "passed";
        if (name) {
          const key = canonLang(name);
          const r = ensure(key, total || processed, name, log.ts);
          if (total) r.total = total;
          if (processed > r.current) r.current = processed;
          if (passed > r.passed) r.passed = passed;
          endMarker.set(key, { outcome, ts: log.ts });
          r.endTs = log.ts;
        }
        continue;
      }
      if (event === "run_halted") {
        halted = true;
        continue;
      }
      if (event === "run_end") {
        runEnded = true;
        continue;
      }
    }

    // Language section header — "TESTING PYTHON - 48 TEST CASES (...)"
    const langMatch = line.match(/TESTING\s+(\S+)\s+-\s+(\d+)\s+TEST\s+CASES/i);
    if (langMatch) {
      const key = canonLang(langMatch[1]);
      currentLang = key;
      const r = ensure(key, parseInt(langMatch[2]), langMatch[1], log.ts);
      if (!r.startTs) r.startTs = log.ts;
      r.total = parseInt(langMatch[2]);
      continue;
    }

    // v2 progress line — "[LANG] Progress X/Y - STATUS | time=... | memory=..."
    const progressMatch = line.match(/\[(\S+)\]\s+Progress\s+(\d+)\/(\d+)\s+-\s+(\w+)/i);
    if (progressMatch) {
      const key = canonLang(progressMatch[1]);
      const index = parseInt(progressMatch[2]);
      const total = parseInt(progressMatch[3]);
      const status = progressMatch[4];
      const r = ensure(key, total, progressMatch[1], log.ts);
      if (total) r.total = total;
      r.current = index;

      const timeMatch = line.match(/time=(\d+\.?\d*)s/);
      if (timeMatch) {
        const t = parseFloat(timeMatch[1]);
        if (t > r.maxTime) r.maxTime = t;
      }
      const memMatch = line.match(/memory=(\d+\.?\d*)MB/i);
      if (memMatch) {
        const m = parseFloat(memMatch[1]);
        if (m > r.maxMemory) r.maxMemory = m;
      }

      if (status === "CORRECT") {
        r.passed++;
      } else {
        r.failed++;
        const errorMatch = line.match(/error=([^|]+)/i);
        r.errors.push({
          index,
          status,
          detail: errorMatch ? errorMatch[1].trim() : status,
        });
        if (HALTING_STATUSES.has(status) && !r.errorReason) {
          r.errorReason = reasonForStatus(status);
        }
      }
      r.passRate = (r.passed / (r.passed + r.failed)) * 100;
      r.endTs = log.ts;
      continue;
    }

    // Nonfunction line — "Solution 1 - Test 3/48: ✅ PASSED" / "❌ FAILED - ..."
    const nfMatch = line.match(/Solution \d+ - Test (\d+)\/(\d+):\s*/);
    if (nfMatch && currentLang) {
      const index = parseInt(nfMatch[1]);
      const total = parseInt(nfMatch[2]);
      const r = ensure(currentLang, total, currentLang, log.ts);
      if (total) r.total = total;
      r.current = index;
      if (/PASSED/i.test(line)) {
        r.passed++;
      } else if (/FAILED/i.test(line)) {
        r.failed++;
        const detailMatch = line.match(/FAILED\s*[-–—]?\s*(.*)/i);
        const detail = detailMatch ? detailMatch[1].trim() : "FAILED";
        let status = "FAILED";
        const up = detail.toUpperCase();
        if (up.includes("COMPILATION")) status = "COMPILATION_ERROR";
        else if (up.includes("RUNTIME")) status = "RUNTIME_ERROR";
        else if (up.includes("API")) status = "API_ERROR";
        else if (up.includes("NO RESULTS")) status = "NO_RESULTS";
        else if (up.includes("PAYLOAD")) status = "PAYLOAD_TOO_LARGE";
        r.errors.push({ index, status, detail });
        if (HALTING_STATUSES.has(status) && !r.errorReason) {
          r.errorReason = reasonForStatus(status);
        }
      }
      r.passRate =
        r.passed + r.failed > 0 ? (r.passed / (r.passed + r.failed)) * 100 : 0;
      r.endTs = log.ts;
      continue;
    }

    // Per-language summary line (function manager): "C++: passed 2/3"
    const summaryMatch = line.match(/^(\S+):\s+passed\s+(\d+)\/(\d+)\s*$/i);
    if (summaryMatch) {
      const key = canonLang(summaryMatch[1]);
      const r = map.get(key);
      if (r) {
        r.endTs = log.ts;
        if (!endMarker.has(key)) {
          const hasHalt = r.errors.some((e) => HALTING_STATUSES.has(e.status));
          endMarker.set(key, {
            outcome: hasHalt ? "halted" : r.failed > 0 ? "failed" : "passed",
            ts: log.ts,
          });
        }
      }
      continue;
    }

    // Halt lines from either manager.
    if (/Halting (remaining languages|execution)/i.test(line)) {
      halted = true;
      continue;
    }
  }

  const stepTerminal = !isRunning || (exitCode !== null && exitCode !== 0);

  // Finalise per-language terminal state.
  for (const key of order) {
    const r = map.get(key)!;
    const marker = endMarker.get(key);
    const hasHaltError = r.errors.some((e) => HALTING_STATUSES.has(e.status));
    const processedAll = r.total > 0 && r.passed + r.failed >= r.total;

    if (marker) {
      if (marker.outcome === "halted" || hasHaltError) {
        r.state = "error";
        if (!r.errorReason) r.errorReason = "Stopped early";
      } else if (marker.outcome === "failed" || r.failed > 0) {
        r.state = processedAll ? "failed" : "error";
        if (r.state === "error" && !r.errorReason) r.errorReason = "Stopped early";
      } else {
        r.state = "passed";
      }
      continue;
    }

    if (hasHaltError) {
      r.state = "error";
      if (!r.errorReason) r.errorReason = "Stopped early";
      continue;
    }

    if (processedAll) {
      r.state = r.failed > 0 ? "failed" : "passed";
      continue;
    }

    // No terminal signal for this language yet.
    if (stepTerminal) {
      // The run is over but this language never reached its total — it was cut
      // short. Treat as stopped rather than leaving it spinning.
      r.state = r.current > 0 ? "error" : "not_run";
      if (r.state === "error" && !r.errorReason) r.errorReason = "Stopped early";
    } else {
      r.state = r.current > 0 || r.startTs ? "running" : "pending";
    }
  }

  // Build the baseline from the selected languages so every one has a row,
  // then overlay parsed results in run order.
  const result: ExecLangResult[] = [];
  const usedKeys = new Set<string>();
  const baselineKeys = (enabledLanguages || []).map(canonLang);

  const runWasCutShort = halted || stepTerminal;

  for (const key of baselineKeys) {
    if (usedKeys.has(key)) continue;
    usedKeys.add(key);
    const parsed = map.get(key);
    if (parsed) {
      result.push(parsed);
    } else {
      const { id, name } = metaFor(key);
      result.push({
        id,
        name,
        key,
        total: 0,
        passed: 0,
        failed: 0,
        current: 0,
        errors: [],
        passRate: 0,
        maxTime: 0,
        maxMemory: 0,
        state: runWasCutShort ? "not_run" : "pending",
      });
    }
  }

  // Any languages present in logs but not in the baseline (e.g. baseline empty).
  for (const key of order) {
    if (usedKeys.has(key)) continue;
    usedKeys.add(key);
    result.push(map.get(key)!);
  }

  return { langs: result, halted, runEnded };
}
