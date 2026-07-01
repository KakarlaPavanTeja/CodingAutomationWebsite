"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StepLogPane } from "./StepLogPane";
import { LogStepPicker } from "./LogStepPicker";
import { useLiveClock } from "./useLiveClock";
import { durationFromRunState } from "@/lib/pipeline-duration";
import {
  buildPipelineStepList,
  llmUsageLabel,
  stepKeyStr,
  type PipelineStepKey,
  type PipelineStepUsageMap,
} from "@/lib/pipeline-step-list";
import { formatStepCostDisplay } from "@/lib/pipeline-usage-match";
import { aggregateTestStats } from "@/lib/execution-parser";
import { getStepConfig } from "@/lib/pipeline-config";
import type { PipelineSection } from "@/lib/pipeline-waves";
import { cn } from "@/lib/utils";
import type {
  QuestionSubStepId,
  QuestionType,
  StepId,
  StepState,
  StepStatus,
  SubStepRunState,
} from "@/types/pipeline";
import { Check, FileText, List, Loader2, Play, RotateCcw, Square, Unlock, Wand2 } from "lucide-react";

const MAX_OPEN_LOGS = 3;

/**
 * Which completed rows may be refined (re-run with an appended reviewer
 * instruction). Any completed LLM step qualifies: PIPELINE_REFINE_NOTE is
 * injected centrally in llm_client.call_llm, so every LLM step honors it.
 */
function isRefinable(
  entry: ReturnType<typeof buildPipelineStepList>[number]
): boolean {
  // Every completed LLM entry can be refined — sub, step, and per-language (lang)
  // all thread the note via RunRequest.refineNote, injected centrally in call_llm.
  return entry.llmUsage !== "none" && entry.status === "completed";
}

type SideTab = "steps" | "logs";

const STATUS_BADGE: Record<StepStatus, string> = {
  pending: "bg-muted text-muted-foreground",
  running: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  stopping: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  stopped: "bg-muted/60 text-muted-foreground border-muted-foreground/30",
  completed: "bg-green-500/15 text-green-400 border-green-500/30",
  failed: "bg-red-500/15 text-red-400 border-red-500/30",
  skipped: "bg-muted/60 text-muted-foreground border-muted-foreground/30",
};

function formatDuration(sec: number | null): string {
  if (sec == null) return "—";
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function entryRunState(
  entry: ReturnType<typeof buildPipelineStepList>[number],
  stepStates: Map<StepId, StepState>
): SubStepRunState | undefined {
  if (entry.key.kind === "sub") {
    return stepStates.get("generate_question")?.subStepRuns?.[entry.key.id as QuestionSubStepId];
  }
  if (entry.key.kind === "lang") {
    return stepStates.get(entry.key.stepId)?.languageSubRuns?.[entry.key.langId];
  }
  const state = stepStates.get(entry.key.id);
  if (!state) return undefined;
  return {
    status: state.status,
    logs: state.logs,
    exitCode: state.exitCode,
    startTime: state.startTime,
    endTime: state.endTime,
  };
}

interface PipelineSidePanelProps {
  problemId: string;
  questionType: QuestionType;
  sections: PipelineSection[];
  stepStates: Map<StepId, StepState>;
  stepUsage: PipelineStepUsageMap;
  selectedKey: PipelineStepKey;
  onSelectKey: (key: PipelineStepKey) => void;
  getSubStatus: (id: QuestionSubStepId) => StepStatus;
  affectedStepIds?: Set<StepId>;
  onRunSelected?: (ids: StepId[]) => void;
  onRunSubStep?: (id: QuestionSubStepId, refineNote?: string) => void;
  onStopSubStep?: (id: QuestionSubStepId) => void;
  onRunStep?: (stepId: StepId, refineNote?: string) => void;
  onStopStep?: (stepId: StepId) => void;
  onRunLangStep?: (stepId: StepId, langId: string, refineNote?: string) => void;
  onStopLangStep?: (stepId: StepId, langId: string) => void;
  isEntryLocked?: (keyStr: string) => boolean;
}

function getLiveLogs(
  entry: ReturnType<typeof buildPipelineStepList>[number],
  stepStates: Map<StepId, StepState>
) {
  if (entry.key.kind === "sub") {
    const gq = stepStates.get("generate_question");
    return gq?.subStepRuns?.[entry.key.id as QuestionSubStepId]?.logs ?? [];
  }
  if (entry.key.kind === "lang") {
    return stepStates.get(entry.key.stepId)?.languageSubRuns?.[entry.key.langId]?.logs ?? [];
  }
  if (entry.key.kind === "step") {
    return stepStates.get(entry.key.id)?.logs ?? [];
  }
  return [];
}

function getActiveRunId(
  entry: ReturnType<typeof buildPipelineStepList>[number],
  stepStates: Map<StepId, StepState>
): string | null {
  if (entry.key.kind === "sub") {
    return stepStates.get("generate_question")?.subStepRuns?.[entry.key.id as QuestionSubStepId]?.activeRunId ?? null;
  }
  if (entry.key.kind === "lang") {
    return stepStates.get(entry.key.stepId)?.languageSubRuns?.[entry.key.langId]?.activeRunId ?? null;
  }
  if (entry.key.kind === "step") {
    return stepStates.get(entry.key.id)?.activeRunId ?? null;
  }
  return null;
}

export function PipelineSidePanel({
  problemId,
  sections,
  stepStates,
  stepUsage,
  selectedKey,
  onSelectKey,
  getSubStatus,
  affectedStepIds,
  onRunSelected,
  onRunSubStep,
  onStopSubStep,
  onRunStep,
  onStopStep,
  onRunLangStep,
  onStopLangStep,
  isEntryLocked,
}: PipelineSidePanelProps) {
  const [tab, setTab] = useState<SideTab>("steps");
  const [openLogKeys, setOpenLogKeys] = useState<string[]>([]);
  const [expandedLogKeys, setExpandedLogKeys] = useState<string[]>([]);
  const [stopCooldownUntil, setStopCooldownUntil] = useState<Record<string, number>>({});
  // Per-row "refine & re-run" boxes: which rows are open, and their draft text.
  const [openRefineKeys, setOpenRefineKeys] = useState<string[]>([]);
  const [refineText, setRefineText] = useState<Record<string, string>>({});
  // Affected-steps suggestion: ids the user has UN-ticked (default = all ticked).
  const [uncheckedRerun, setUncheckedRerun] = useState<Set<string>>(new Set());
  const listScrollRef = useRef<HTMLDivElement>(null);
  const skipStepsTabRef = useRef(false);

  const entries = useMemo(
    () => buildPipelineStepList(sections, stepStates, stepUsage, getSubStatus),
    [sections, stepStates, stepUsage, getSubStatus]
  );

  const anyRunning = entries.some((e) => e.status === "running" || e.status === "stopping");
  const now = useLiveClock(anyRunning);

  const selectedKeyStr = stepKeyStr(selectedKey);

  useEffect(() => {
    if (skipStepsTabRef.current) {
      skipStepsTabRef.current = false;
      return;
    }
    setTab("steps");
  }, [selectedKeyStr]);

  useEffect(() => {
    if (tab !== "steps") return;
    const container = listScrollRef.current;
    if (!container) return;
    const el = container.querySelector<HTMLElement>(`[data-step-key="${selectedKeyStr}"]`);
    if (!el) return;

    const containerRect = container.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const topDelta = elRect.top - containerRect.top;
    const bottomDelta = elRect.bottom - containerRect.bottom;

    if (topDelta < 0) {
      container.scrollTop += topDelta - 8;
    } else if (bottomDelta > 0) {
      container.scrollTop += bottomDelta + 8;
    }
  }, [selectedKeyStr, tab]);

  const toggleLog = (keyStr: string) => {
    skipStepsTabRef.current = true;
    setOpenLogKeys((prev) => {
      const isOpen = prev.includes(keyStr);
      let nextOpen: string[];
      let syncExpanded: (exp: string[]) => string[];

      if (isOpen) {
        nextOpen = prev.filter((k) => k !== keyStr);
        syncExpanded = (exp) => exp.filter((k) => k !== keyStr);
      } else if (prev.length >= MAX_OPEN_LOGS) {
        const dropped = prev[0];
        nextOpen = [...prev.slice(1), keyStr];
        syncExpanded = (exp) => {
          const cleaned = exp.filter((k) => k !== dropped);
          return cleaned.includes(keyStr) ? cleaned : [...cleaned, keyStr];
        };
      } else {
        nextOpen = [...prev, keyStr];
        syncExpanded = (exp) => (exp.includes(keyStr) ? exp : [...exp, keyStr]);
      }

      setExpandedLogKeys(syncExpanded);
      return nextOpen;
    });
    setTab("logs");
  };

  const closeLog = (keyStr: string) => {
    setOpenLogKeys((prev) => prev.filter((k) => k !== keyStr));
    setExpandedLogKeys((prev) => prev.filter((k) => k !== keyStr));
  };

  const toggleLogExpand = (keyStr: string) => {
    setExpandedLogKeys((prev) =>
      prev.includes(keyStr) ? prev.filter((k) => k !== keyStr) : [...prev, keyStr]
    );
  };

  const openEntries = openLogKeys
    .map((k) => entries.find((e) => e.keyStr === k))
    .filter(Boolean) as ReturnType<typeof buildPipelineStepList>;

  return (
    <div className="flex flex-col h-full min-h-0 border rounded-lg bg-card overflow-hidden">
      <div className="flex items-center border-b shrink-0">
        <button
          type="button"
          className={cn(
            "flex-1 inline-flex items-center justify-center gap-1.5 px-2 py-2 text-[11px] font-medium border-b-2 -mb-px transition-colors",
            tab === "steps"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          )}
          onClick={() => setTab("steps")}
        >
          <List className="w-3.5 h-3.5" />
          All steps
        </button>
        <button
          type="button"
          className={cn(
            "flex-1 inline-flex items-center justify-center gap-1.5 px-2 py-2 text-[11px] font-medium border-b-2 -mb-px transition-colors",
            tab === "logs"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          )}
          onClick={() => setTab("logs")}
        >
          <FileText className="w-3.5 h-3.5" />
          Raw logs
          {openLogKeys.length > 0 && (
            <span className="text-[10px] text-muted-foreground">({openLogKeys.length}/{MAX_OPEN_LOGS})</span>
          )}
        </button>
      </div>

      <div
        ref={listScrollRef}
        className={cn(
          "flex-1 min-h-0 overscroll-y-contain",
          tab === "steps" ? "overflow-y-auto" : "overflow-hidden flex flex-col"
        )}
      >
        {tab === "steps" && (
          <div className="p-1.5 space-y-0.5">
            {onRunSelected && affectedStepIds && affectedStepIds.size > 0 && (() => {
              const affected = [...affectedStepIds];
              const selected = affected.filter((id) => !uncheckedRerun.has(id));
              return (
                <div className="mb-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 space-y-1.5">
                  <p className="text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                    Suggested re-runs — these may be affected by changes to earlier steps
                  </p>
                  <div className="space-y-0.5">
                    {affected.map((id) => (
                      <label
                        key={id}
                        className="flex items-center gap-1.5 text-[11px] cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          className="h-3 w-3 accent-amber-500"
                          checked={!uncheckedRerun.has(id)}
                          onChange={(e) =>
                            setUncheckedRerun((prev) => {
                              const next = new Set(prev);
                              if (e.target.checked) next.delete(id);
                              else next.add(id);
                              return next;
                            })
                          }
                        />
                        {getStepConfig(id).label}
                      </label>
                    ))}
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    className="h-6 w-full text-[10px] px-2"
                    disabled={selected.length === 0}
                    onClick={() => {
                      onRunSelected(selected);
                      setUncheckedRerun(new Set());
                    }}
                  >
                    <RotateCcw className="w-3 h-3 mr-1" />
                    Re-run selected ({selected.length})
                  </Button>
                </div>
              );
            })()}
            {entries.map((entry, index) => {
              const showHeader =
                index === 0 || entries[index - 1].sectionTitle !== entry.sectionTitle;
              const isSelected = entry.keyStr === selectedKeyStr;
              const locked = isEntryLocked?.(entry.keyStr) ?? false;
              const showRun =
                !entry.disabled &&
                !locked &&
                entry.status !== "completed" &&
                entry.status !== "skipped" &&
                entry.status !== "running" &&
                entry.status !== "stopping" &&
                entry.status !== "stopped";
              const onCooldown = (stopCooldownUntil[entry.keyStr] ?? 0) > now;
              // A completed step can be re-run (with or without a refine note).
              // This gives non-LLM steps a Run button again after completion.
              const showRerun =
                !entry.disabled && !locked && entry.status === "completed";
              // Stale: an upstream data-dependency re-ran after this step completed.
              const isStale =
                entry.status === "completed" &&
                (entry.key.kind === "step"
                  ? affectedStepIds?.has(entry.key.id)
                  : entry.key.kind === "lang"
                    ? affectedStepIds?.has(entry.key.stepId)
                    : affectedStepIds?.has("generate_question")) === true;
              // Aggregate passed/total testcases for execution steps (from logs).
              const rowRun = entryRunState(entry, stepStates);
              const testStats = rowRun
                ? aggregateTestStats(
                    rowRun.logs ?? [],
                    rowRun.status === "running",
                    rowRun.exitCode
                  )
                : null;
              const rerun = (note?: string) => {
                if (entry.key.kind === "sub") onRunSubStep?.(entry.key.id, note);
                else if (entry.key.kind === "lang")
                  onRunLangStep?.(entry.key.stepId, entry.key.langId, note);
                else if (entry.key.kind === "step") onRunStep?.(entry.key.id, note);
              };
              // Override for locked-but-pending workflow/language steps (e.g. split,
              // execute on previously-generated questions whose upstream state didn't
              // restore as completed). The lock is advisory and the server doesn't
              // re-check prerequisites, so allow an explicit "Run anyway".
              const showRunAnyway =
                !entry.disabled &&
                locked &&
                entry.status === "pending" &&
                (entry.key.kind === "step" || entry.key.kind === "lang");
              // Non-blocking steps (e.g. Strengthen Test Cases) show a failure as
              // a warning, since they don't block the pipeline.
              const nonBlockingFail =
                entry.status === "failed" &&
                entry.key.kind === "step" &&
                getStepConfig(entry.key.id).nonBlocking === true;

              return (
                <div key={entry.keyStr}>
                  {showHeader && (
                    <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground px-2 pt-2 pb-1">
                      {entry.sectionTitle}
                    </p>
                  )}
                  <div
                    data-step-key={entry.keyStr}
                    className={cn(
                      "w-full rounded-md px-2 py-2 transition-colors",
                      entry.disabled && "opacity-40",
                      locked && entry.status === "pending" && "opacity-50",
                      isSelected
                        ? "bg-primary/10 ring-1 ring-primary/30 border border-primary/20"
                        : "hover:bg-muted/50 border border-transparent"
                    )}
                  >
                    <button
                      type="button"
                      disabled={entry.disabled}
                      onClick={() => onSelectKey(entry.key)}
                      className={cn(
                        "w-full text-left",
                        entry.disabled && "cursor-not-allowed"
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium truncate">{entry.label}</p>
                          {entry.description && (
                            <p className="text-[10px] text-muted-foreground leading-snug mt-0.5 line-clamp-2">
                              {entry.description}
                            </p>
                          )}
                          <div className="flex flex-wrap items-center gap-1.5 mt-1">
                            <Badge
                              variant="outline"
                              className={cn(
                                "text-[9px] h-4 px-1 capitalize",
                                nonBlockingFail
                                  ? "bg-amber-500/15 text-amber-400 border-amber-500/30"
                                  : STATUS_BADGE[entry.status]
                              )}
                            >
                              {(entry.status === "running" || entry.status === "stopping") && (
                                <Loader2 className="w-2.5 h-2.5 mr-0.5 animate-spin inline" />
                              )}
                              {nonBlockingFail ? "warning" : entry.status}
                            </Badge>
                            <span className="text-[10px] text-muted-foreground tabular-nums">
                              {formatDuration(
                                durationFromRunState(
                                  entryRunState(entry, stepStates),
                                  entry.status,
                                  now
                                )
                              )}
                            </span>
                            <Badge variant="outline" className="text-[9px] h-4 px-1">
                              {llmUsageLabel(entry.llmUsage)}
                            </Badge>
                            {isStale && (
                              <Badge
                                variant="outline"
                                className="text-[9px] h-4 px-1 bg-amber-500/15 text-amber-500 border-amber-500/30"
                                title="An upstream step re-ran after this — re-run to refresh"
                              >
                                stale
                              </Badge>
                            )}
                            {testStats && (
                              <Badge
                                variant="outline"
                                className={cn(
                                  "text-[9px] h-4 px-1 tabular-nums",
                                  testStats.passed === testStats.total
                                    ? "bg-green-500/15 text-green-400 border-green-500/30"
                                    : "bg-amber-500/15 text-amber-500 border-amber-500/30"
                                )}
                              >
                                {testStats.passed}/{testStats.total} passed
                              </Badge>
                            )}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <span className="text-[10px] tabular-nums text-muted-foreground">
                            {formatStepCostDisplay(entry.costUsd, entry.llmUsage, entry.status)}
                          </span>
                          {entry.status === "completed" && (
                            <Check className="w-3 h-3 text-green-500 ml-auto mt-0.5" />
                          )}
                        </div>
                      </div>
                    </button>
                    <div className="mt-1.5 flex justify-end gap-1">
                      {entry.key.kind === "sub" && onRunSubStep && onStopSubStep && (
                        <>
                          {entry.status === "running" ? (
                            <Button
                              type="button"
                              variant="destructive"
                              size="sm"
                              className="h-6 text-[10px] px-2"
                              onClick={() => {
                                if (entry.key.kind !== "sub") return;
                                onStopSubStep(entry.key.id);
                                setStopCooldownUntil((prev) => ({
                                  ...prev,
                                  [entry.keyStr]: Date.now() + 3000,
                                }));
                              }}
                            >
                              <Square className="w-3 h-3 mr-1 fill-current" />
                              Stop
                            </Button>
                          ) : showRun ? (
                            <Button
                              type="button"
                              size="sm"
                              className="h-6 text-[10px] px-2"
                              disabled={onCooldown}
                              onClick={() => {
                                if (entry.key.kind !== "sub") return;
                                onRunSubStep(entry.key.id);
                              }}
                            >
                              <Play className="w-3 h-3 mr-1" />
                              Run
                            </Button>
                          ) : null}
                        </>
                      )}
                      {entry.key.kind === "lang" && onRunLangStep && onStopLangStep && (
                        <>
                          {entry.status === "running" ? (
                            <Button
                              type="button"
                              variant="destructive"
                              size="sm"
                              className="h-6 text-[10px] px-2"
                              onClick={() => {
                                if (entry.key.kind !== "lang") return;
                                onStopLangStep(entry.key.stepId, entry.key.langId);
                                setStopCooldownUntil((prev) => ({
                                  ...prev,
                                  [entry.keyStr]: Date.now() + 3000,
                                }));
                              }}
                            >
                              <Square className="w-3 h-3 mr-1 fill-current" />
                              Stop
                            </Button>
                          ) : showRun ? (
                            <Button
                              type="button"
                              size="sm"
                              className="h-6 text-[10px] px-2"
                              disabled={onCooldown}
                              onClick={() => {
                                if (entry.key.kind !== "lang") return;
                                onRunLangStep(entry.key.stepId, entry.key.langId);
                              }}
                            >
                              <Play className="w-3 h-3 mr-1" />
                              Run
                            </Button>
                          ) : showRunAnyway ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-6 text-[10px] px-2 border-amber-500/50 text-amber-600 hover:bg-amber-500/10 dark:text-amber-400"
                              disabled={onCooldown}
                              title="Prerequisites aren't marked complete for this question — run this step anyway."
                              onClick={() => {
                                if (entry.key.kind !== "lang") return;
                                onRunLangStep(entry.key.stepId, entry.key.langId);
                              }}
                            >
                              <Unlock className="w-3 h-3 mr-1" />
                              Run anyway
                            </Button>
                          ) : null}
                        </>
                      )}
                      {entry.key.kind === "step" && onRunStep && onStopStep && (
                        <>
                          {entry.status === "running" ? (
                            <Button
                              type="button"
                              variant="destructive"
                              size="sm"
                              className="h-6 text-[10px] px-2"
                              onClick={() => {
                                if (entry.key.kind !== "step") return;
                                onStopStep(entry.key.id);
                                setStopCooldownUntil((prev) => ({
                                  ...prev,
                                  [entry.keyStr]: Date.now() + 3000,
                                }));
                              }}
                            >
                              <Square className="w-3 h-3 mr-1 fill-current" />
                              Stop
                            </Button>
                          ) : showRun ? (
                            <Button
                              type="button"
                              size="sm"
                              className="h-6 text-[10px] px-2"
                              disabled={onCooldown}
                              onClick={() => {
                                if (entry.key.kind !== "step") return;
                                onRunStep(entry.key.id);
                              }}
                            >
                              <Play className="w-3 h-3 mr-1" />
                              Run
                            </Button>
                          ) : showRunAnyway ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-6 text-[10px] px-2 border-amber-500/50 text-amber-600 hover:bg-amber-500/10 dark:text-amber-400"
                              disabled={onCooldown}
                              title="Prerequisites aren't marked complete for this question — run this step anyway."
                              onClick={() => {
                                if (entry.key.kind !== "step") return;
                                onRunStep(entry.key.id);
                              }}
                            >
                              <Unlock className="w-3 h-3 mr-1" />
                              Run anyway
                            </Button>
                          ) : null}
                        </>
                      )}
                      {showRerun && !onCooldown && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-6 text-[10px] px-2"
                          title="Run this completed step again"
                          onClick={() => rerun()}
                        >
                          <RotateCcw className="w-3 h-3 mr-1" />
                          Re-run
                        </Button>
                      )}
                      {isRefinable(entry) && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className={cn(
                            "h-6 text-[10px] px-2",
                            openRefineKeys.includes(entry.keyStr) &&
                              "bg-primary/10 text-primary"
                          )}
                          onClick={() =>
                            setOpenRefineKeys((prev) =>
                              prev.includes(entry.keyStr)
                                ? prev.filter((k) => k !== entry.keyStr)
                                : [...prev, entry.keyStr]
                            )
                          }
                        >
                          <Wand2 className="w-3 h-3 mr-1" />
                          Refine
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-6 text-[10px] px-2"
                        disabled={entry.disabled}
                        onClick={() => {
                          onSelectKey(entry.key);
                          toggleLog(entry.keyStr);
                        }}
                      >
                        <FileText className="w-3 h-3 mr-1" />
                        View logs
                      </Button>
                    </div>
                    {isRefinable(entry) && openRefineKeys.includes(entry.keyStr) && (
                      <div className="mt-1.5 rounded-md border border-border/60 bg-muted/30 p-2 space-y-1.5">
                        <p className="text-[10px] text-muted-foreground leading-snug">
                          Tell the LLM what to change, then re-run this step. Downstream
                          steps that depend on it will reset so they can re-run too.
                        </p>
                        <textarea
                          value={refineText[entry.keyStr] ?? ""}
                          onChange={(e) =>
                            setRefineText((prev) => ({
                              ...prev,
                              [entry.keyStr]: e.target.value,
                            }))
                          }
                          rows={3}
                          maxLength={4000}
                          placeholder="e.g. Make the story shorter and rename the function to maxProfit"
                          className="w-full resize-y rounded border border-border bg-background px-2 py-1 text-[11px] leading-snug focus:outline-none focus:ring-1 focus:ring-primary"
                        />
                        <div className="flex justify-end">
                          <Button
                            type="button"
                            size="sm"
                            className="h-6 text-[10px] px-2"
                            disabled={!(refineText[entry.keyStr] ?? "").trim()}
                            onClick={() => {
                              const note = (refineText[entry.keyStr] ?? "").trim();
                              if (!note) return;
                              rerun(note);
                              setOpenRefineKeys((prev) =>
                                prev.filter((k) => k !== entry.keyStr)
                              );
                            }}
                          >
                            <Play className="w-3 h-3 mr-1" />
                            Re-run with changes
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {tab === "logs" && (
          <div className="flex flex-col flex-1 min-h-0 p-2 gap-2">
            <p className="text-[10px] text-muted-foreground px-1 shrink-0">
              Open up to {MAX_OPEN_LOGS} step logs. Logs update automatically while running.
            </p>

            <LogStepPicker
              entries={entries}
              openLogKeys={openLogKeys}
              maxOpen={MAX_OPEN_LOGS}
              onSelect={toggleLog}
            />

            {openEntries.length === 0 ? (
              <div className="rounded-md border border-dashed p-6 text-center text-xs text-muted-foreground">
                Use the dropdown above to open raw logs (max {MAX_OPEN_LOGS}).
              </div>
            ) : (
              <div className="flex-1 min-h-0 flex flex-col gap-1.5 overflow-hidden">
                {openEntries.map((entry) => (
                  <StepLogPane
                    key={entry.keyStr}
                    label={entry.label}
                    status={entry.status}
                    problemId={problemId}
                    logStepId={entry.logStepId}
                    activeRunId={getActiveRunId(entry, stepStates)}
                    liveLogs={getLiveLogs(entry, stepStates)}
                    isExpanded={expandedLogKeys.includes(entry.keyStr)}
                    onToggleExpand={() => toggleLogExpand(entry.keyStr)}
                    onClose={() => closeLog(entry.keyStr)}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
