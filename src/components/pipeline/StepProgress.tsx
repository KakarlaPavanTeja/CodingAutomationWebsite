"use client";

import { useMemo, useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import type { LogLine, StepId } from "@/types/pipeline";

interface ProgressItem {
  label: string;
  status: "pending" | "running" | "completed" | "failed";
  startTs?: number;
  endTs?: number;
}

// Parse log lines to extract structured progress for each step type
function parseProgress(stepId: StepId, logs: LogLine[], isRunning: boolean): ProgressItem[] {
  const lines = logs.map((l) => l.line);
  const items: ProgressItem[] = [];

  if (stepId === "generate_question") {
    const steps = [
      { key: "description", label: "Generating Description", patterns: [/STEP 1:.*Description/i], done: [/✓ Description created/i, /Skipping Step 1/i] },
      { key: "codes", label: "Translating Code", patterns: [/STEP 2:.*Naming|STEP 3:.*Converting/i], done: [/✓ Solutions saved/i, /Skipping Step 3/i] },
      { key: "titles", label: "Generating Titles", patterns: [/STEP 5a:.*Titles/i], done: [/✓ Titles generated/i, /Skipping Step 5a/i] },
      { key: "difficulty", label: "Estimating Difficulty", patterns: [/STEP 5b:.*Difficulty/i], done: [/✓ Difficulty generated/i, /Skipping Step 5b/i] },
      { key: "topics", label: "Classifying Topics", patterns: [/STEP 6:.*Topics/i], done: [/✓ Topics generated/i, /Skipping Step 6/i] },
    ];
    return extractSteps(steps, logs, isRunning);
  }

  if (stepId === "generate_testcases") {
    const steps = [
      { key: "generate", label: "Calling LLM for Test Cases", patterns: [/LLM call in progress|Calling LLM to generate/i], done: [/LLM call completed|saved test case generator/i] },
      { key: "run", label: "Running Generator & Validating", patterns: [/Running.*\.py/i], done: [/Successfully generated testcases|Moved testcases\.json/i] },
    ];
    return extractSteps(steps, logs, isRunning);
  }

  if (stepId === "split_code") {
    const steps = [
      { key: "split", label: "Splitting Code Files", patterns: [/CODE SPLITTER|Processing/i], done: [/Code splitting completed/i] },
    ];
    return extractSteps(steps, logs, isRunning);
  }

  if (stepId === "execute_tests_function" || stepId === "execute_tests_nonfunction") {
    return parseExecutionProgress(logs, isRunning);
  }

  if (stepId === "generate_enrichment") {
    const steps = [
      { key: "reallife", label: "Generating Real-life Examples", patterns: [/generating real-life examples/i], done: [/✓ Real-life examples generated|Skipping real-life/i] },
      { key: "hints", label: "Generating Hints", patterns: [/generating hints/i], done: [/✓ Hints generated|Skipping hints/i] },
      { key: "followups", label: "Generating Follow-up Questions", patterns: [/generating follow-up/i], done: [/✓ Follow-up questions generated|Skipping follow-up/i] },
    ];
    return extractSteps(steps, logs, isRunning);
  }

  if (stepId === "package_platform") {
    const steps = [
      { key: "package", label: "Packaging for Platform", patterns: [/Mode:|Problem Name:/i], done: [/Written LUA file|SUCCESS/i] },
    ];
    return extractSteps(steps, logs, isRunning);
  }

  // Fallback: just show running/done based on overall state
  if (logs.length > 0) {
    items.push({
      label: "Processing",
      status: isRunning ? "running" : "completed",
      startTs: logs[0]?.ts,
      endTs: isRunning ? undefined : logs[logs.length - 1]?.ts,
    });
  }

  return items;
}

interface StepPattern {
  key: string;
  label: string;
  patterns: RegExp[];
  done: RegExp[];
}

function extractSteps(steps: StepPattern[], logs: LogLine[], isRunning: boolean): ProgressItem[] {
  const items: ProgressItem[] = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    let started = false;
    let done = false;
    let startTs: number | undefined;
    let endTs: number | undefined;

    // Scan logs in order for this step's start and done markers
    for (const log of logs) {
      if (!started && step.patterns.some((p) => p.test(log.line))) {
        started = true;
        startTs = log.ts;
      }
      if (started && step.done.some((p) => p.test(log.line))) {
        done = true;
        endTs = log.ts;
      }
    }

    let status: ProgressItem["status"] = "pending";
    if (done) {
      status = "completed";
    } else if (started) {
      // Only show as "running" if the overall step is still running
      status = isRunning ? "running" : "failed";
    }

    items.push({ label: step.label, status, startTs, endTs });
  }

  // If nothing matched yet but we're running, show first step as running
  if (items.every((it) => it.status === "pending") && isRunning && logs.length > 1) {
    items[0] = { ...items[0], status: "running", startTs: logs[0]?.ts };
  }

  return items;
}

function parseExecutionProgress(logs: LogLine[], isRunning: boolean): ProgressItem[] {
  const items: ProgressItem[] = [];
  const allText = logs.map((l) => l.line).join("\n");

  // Detect language sections: "TESTING PYTHON - N TEST CASES"
  const langPattern = /TESTING\s+(\S+)\s+-\s+(\d+)\s+TEST\s+CASES/gi;
  let match;
  const languages: { name: string; count: number; startTs?: number }[] = [];

  while ((match = langPattern.exec(allText)) !== null) {
    languages.push({ name: match[1], count: parseInt(match[2]) });
  }

  // Find timestamps for each language
  for (const lang of languages) {
    const re = new RegExp(`TESTING\\s+${lang.name}`, "i");
    for (const log of logs) {
      if (re.test(log.line)) {
        lang.startTs = log.ts;
        break;
      }
    }
  }

  // Count progress per language from "[LANG] Progress X/Y" lines
  for (const lang of languages) {
    const progressRe = new RegExp(`\\[${lang.name}\\]\\s+Progress\\s+(\\d+)/(\\d+)\\s+-\\s+(\\w+)`, "gi");
    let lastProgress = 0;
    let lastTotal = lang.count;
    let allCorrect = true;
    let hasError = false;
    let endTs: number | undefined;

    for (const log of logs) {
      const m = progressRe.exec(log.line);
      if (m) {
        lastProgress = parseInt(m[1]);
        lastTotal = parseInt(m[2]);
        if (m[3] !== "CORRECT") allCorrect = false;
        if (/ERROR|FAIL/i.test(m[3])) hasError = true;
        endTs = log.ts;
      }
      progressRe.lastIndex = 0;
    }

    const done = lastProgress >= lastTotal;
    items.push({
      label: `${lang.name} (${lastProgress}/${lastTotal})`,
      status: done ? (hasError ? "failed" : "completed") : (lang.startTs ? "running" : "pending"),
      startTs: lang.startTs,
      endTs: done ? endTs : undefined,
    });
  }

  // If no languages detected yet but running
  if (items.length === 0 && isRunning && logs.length > 1) {
    items.push({ label: "Initializing", status: "running", startTs: logs[0]?.ts });
  }

  return items;
}

function formatElapsed(startTs?: number, endTs?: number): string {
  if (!startTs) return "";
  const end = endTs || Date.now();
  const secs = Math.floor((end - startTs) / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  return `${mins}m ${secs % 60}s`;
}

function StatusIcon({ status }: { status: ProgressItem["status"] }) {
  if (status === "completed") {
    return (
      <div className="w-5 h-5 rounded-full bg-green-500/20 flex items-center justify-center shrink-0">
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="text-green-500"><path d="M20 6 9 17l-5-5"/></svg>
      </div>
    );
  }
  if (status === "failed") {
    return (
      <div className="w-5 h-5 rounded-full bg-red-500/20 flex items-center justify-center shrink-0">
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="text-red-500"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
      </div>
    );
  }
  if (status === "running") {
    return (
      <div className="w-5 h-5 rounded-full border-2 border-blue-500 border-t-transparent animate-spin shrink-0" />
    );
  }
  // Pending / queued — small dot to indicate waiting in line
  return (
    <div className="w-5 h-5 flex items-center justify-center shrink-0">
      <div className="w-2 h-2 rounded-full bg-zinc-600" />
    </div>
  );
}

interface StepProgressProps {
  stepId: StepId;
  logs: LogLine[];
  isRunning: boolean;
  exitCode: number | null;
}

export function StepProgress({ stepId, logs, isRunning, exitCode }: StepProgressProps) {
  const items = useMemo(() => parseProgress(stepId, logs, isRunning), [stepId, logs, isRunning]);

  // Tick counter to force re-render every second for live timers
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!isRunning) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [isRunning]);

  // If failed with exit code and no items show it, mark last running as failed
  const displayItems = useMemo(() => {
    if (exitCode !== null && exitCode !== 0) {
      return items.map((item) =>
        item.status === "running" ? { ...item, status: "failed" as const } : item
      );
    }
    return items;
  }, [items, exitCode]);

  if (logs.length === 0 && !isRunning) {
    return null;
  }

  return (
    <div className="space-y-1 py-2">
      {displayItems.map((item, i) => (
        <div key={i} className="flex items-center gap-3 py-1.5 px-1">
          <StatusIcon status={item.status} />
          <span className={cn(
            "text-sm flex-1",
            item.status === "completed" && "text-foreground",
            item.status === "running" && "text-blue-400 font-medium",
            item.status === "failed" && "text-red-400",
            item.status === "pending" && "text-muted-foreground/60",
          )}>
            {item.label}
          </span>
          {item.status === "running" && item.startTs && (
            <span className="text-xs text-blue-400 tabular-nums font-medium">
              {formatElapsed(item.startTs, undefined)}
            </span>
          )}
          {(item.status === "completed" || item.status === "failed") && item.startTs && (
            <span className="text-xs text-muted-foreground tabular-nums">
              {formatElapsed(item.startTs, item.endTs)}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
