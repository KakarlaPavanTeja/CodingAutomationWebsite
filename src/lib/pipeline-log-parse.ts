import type { LogLine } from "@/types/pipeline";

/** Parse persisted pipeline log text into structured lines (strips ISO prefix, keeps ts). */
export function parsePipelineLogContent(content: string, prevLogs?: LogLine[]): LogLine[] {
  const prevTsMap = new Map<string, number>();
  if (prevLogs) {
    for (const l of prevLogs) {
      if (!prevTsMap.has(l.line)) prevTsMap.set(l.line, l.ts);
    }
  }

  let lastKnownTs = prevLogs?.[0]?.ts ?? Date.now();
  let lastAssignedTs = 0;

  const lines = content
    .split("\n")
    .filter((l) => l.trim())
    .map((line) => {
      const isStderr = line.includes("[STDERR]");
      const tsMatch = line.match(/^\[(\d{4}-\d{2}-\d{2}T[^\]]+)\]\s*/);
      let cleaned = tsMatch ? line.slice(tsMatch[0].length) : line;
      if (isStderr) cleaned = cleaned.replace(/^\[STDERR\]\s*/, "");

      let ts: number;
      if (tsMatch) {
        ts = new Date(tsMatch[1]).getTime();
        lastKnownTs = ts;
      } else if (prevTsMap.has(cleaned)) {
        ts = prevTsMap.get(cleaned)!;
      } else {
        ts = lastKnownTs;
      }

      // Keep elapsed column monotonic when many lines share the same wall-clock second.
      if (ts <= lastAssignedTs) ts = lastAssignedTs + 1;
      lastAssignedTs = ts;

      return {
        stream: isStderr ? ("stderr" as const) : ("stdout" as const),
        line: cleaned,
        ts,
      };
    });

  return lines;
}

/**
 * The same run states with their log lines dropped.
 *
 * Log lines belong in object storage (`{problemId}/logs/{stepKey}.log`, written
 * by the run route) and the UI re-fetches them from there. Round-tripping them
 * back through `pipeline_states.step_configs` rewrote a multi-MB TOASTed value
 * on every autosave, which is what filled the database disk — the same failure
 * mode the `pipeline_logs` table had. Applied both when persisting state and
 * when restoring a row written before this change.
 */
export function withoutRunLogs<T extends { logs: LogLine[] }>(
  runs: Partial<Record<string, T>> | undefined,
): Record<string, T> | undefined {
  if (!runs) return undefined;
  const stripped: Record<string, T> = {};
  for (const [key, run] of Object.entries(runs)) {
    if (run) stripped[key] = { ...run, logs: [] };
  }
  return stripped;
}

/** Render structured log lines back to the `[ISO] line` text object storage holds. */
export function formatPipelineLogContent(logs: LogLine[]): string {
  return logs
    .map(
      ({ ts, stream, line }) =>
        `[${new Date(ts).toISOString()}] ${stream === "stderr" ? "[STDERR] " : ""}${line}`,
    )
    .join("\n");
}

export type PipelineLogLineKind =
  | "stderr"
  | "start"
  | "exit"
  | "divider"
  | "section"
  | "progress"
  | "ok"
  | "fail"
  | "gate"
  | "warning"
  | "usage"
  | "info"
  | "default";


/** Hide machine-readable sentinel lines from the live log stream (shown in Execution Logs tab). */
export function shouldHideFromLogDisplay(line: string): boolean {
  return line.trimStart().startsWith("@@TCRESULT@@");
}

/** True for ASCII table border / row lines emitted by execution_manager_*._print_table. */
export function isAsciiTableLine(line: string): boolean {
  const t = line.trimStart();
  return /^\+[-+]+\+$/.test(t) || /^\| /.test(t);
}

export type DisplayLogEntry =
  | { kind: "line"; log: LogLine; index: number }
  | { kind: "table"; title: string | null; body: string; logs: LogLine[]; index: number };

/** Group consecutive table lines into one block; drop sentinel records from display. */
export function groupLogLinesForDisplay(logs: LogLine[]): DisplayLogEntry[] {
  const entries: DisplayLogEntry[] = [];
  let i = 0;

  while (i < logs.length) {
    const log = logs[i];
    if (shouldHideFromLogDisplay(log.line)) {
      i++;
      continue;
    }

    const trimmed = log.line.trimStart();
    const nextIsTable = i + 1 < logs.length && isAsciiTableLine(logs[i + 1].line.trimStart());

    if (isAsciiTableLine(trimmed) || nextIsTable) {
      let title: string | null = null;
      let start = i;
      if (!isAsciiTableLine(trimmed) && nextIsTable) {
        title = pipelineLogDisplayText(log.line);
        start = i + 1;
        i++;
      }

      const tableLogs: LogLine[] = [];
      const bodyLines: string[] = [];
      while (i < logs.length && !shouldHideFromLogDisplay(logs[i].line)) {
        const t = logs[i].line.trimStart();
        if (!isAsciiTableLine(t)) break;
        bodyLines.push(t);
        tableLogs.push(logs[i]);
        i++;
      }

      if (bodyLines.length > 0) {
        entries.push({ kind: "table", title, body: bodyLines.join("\n"), logs: tableLogs, index: start });
        continue;
      }
      if (title) {
        entries.push({ kind: "line", log, index: start - 1 });
        i = start;
        continue;
      }
    }

    entries.push({ kind: "line", log, index: i });
    i++;
  }

  return entries;
}

export function classifyPipelineLogLine(line: string, stream: LogLine["stream"]): PipelineLogLineKind {
  const trimmed = line.trimStart();

  if (stream === "stderr" || /traceback|exception|^error\b/i.test(trimmed)) return "stderr";
  if (/^Starting .+\.\.\./i.test(trimmed)) return "start";
  if (/Process exited with code/i.test(trimmed)) return "exit";
  if (/^── .+ ──$/.test(trimmed) || /^=== .+ ===$/.test(trimmed)) return "divider";
  if (/^    ✓/.test(line)) return "ok";
  if (/^    ✗/.test(line) || /^  ISSUE:/i.test(trimmed)) return "fail";
  if (/^    ⚠/.test(line)) return "warning";
  if (/^    ▸/.test(line)) return "progress";
  if (/^\[B\d\]/i.test(trimmed)) return "section";
  if (/^\[usage\]/i.test(trimmed)) return "usage";
  if (/^(Gate |Hard failures:)/i.test(trimmed)) return "gate";
  if (/^    (Optimal|Cases:|Test cases:|Brute|Size split:|total=)/i.test(line)) return "info";
  if (/^Loaded \d+/i.test(trimmed)) return "info";
  if (/\]\s+Progress\s+\d+\/\d+\s+-/i.test(trimmed)) return "progress";

  return "default";
}

/** Elapsed time since the first log line (+0:00, +5:41, +1:05:22). */
export function formatLogElapsed(baseTs: number, lineTs: number): string {
  const sec = Math.max(0, Math.floor((lineTs - baseTs) / 1000));
  if (sec < 3600) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `+${m}:${s.toString().padStart(2, "0")}`;
  }
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `+${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

/** Display text with leading indent / bullet removed (layout handles hierarchy). */
export function pipelineLogDisplayText(line: string): string {
  let text = line.trimStart().replace(/^[▸✓✗⚠]\s*/, "");
  // Legacy execution progress lines may include IO/error tails — keep verdict + timing only.
  if (/\]\s+Progress\s+\d+\/\d+\s+-/i.test(text)) {
    text = text
      .replace(/\s*\|\s*input_s3=[^|]*/gi, "")
      .replace(/\s*\|\s*output_s3=[^|]*/gi, "")
      .replace(/\s*\|\s*s3_error=[^|]*/gi, "")
      .replace(/\s*\|\s*error=[^|]*/gi, "");
  }
  return text;
}

export function pipelineLogPrefixIcon(kind: PipelineLogLineKind): string | null {
  switch (kind) {
    case "ok":
      return "✓";
    case "fail":
      return "✗";
    case "warning":
      return "⚠";
    case "progress":
      return "▸";
    default:
      return null;
  }
}
