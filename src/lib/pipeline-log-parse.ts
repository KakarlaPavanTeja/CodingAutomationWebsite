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
  return line.trimStart().replace(/^[▸✓✗⚠]\s*/, "");
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
