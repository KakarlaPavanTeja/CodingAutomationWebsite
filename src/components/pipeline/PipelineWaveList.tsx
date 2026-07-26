"use client";

import { useEffect, useRef } from "react";
import { Badge } from "@/components/ui/badge";
import { stepKeyStr, type PipelineStepKey } from "@/lib/pipeline-step-list";
import type { PipelineSection, PipelineWaveItem } from "@/lib/pipeline-waves";
import type { StepId, StepStatus } from "@/types/pipeline";
import { getStepConfig } from "@/lib/pipeline-config";
import { formatPipelineCost } from "@/lib/pipeline-usage-match";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  Check,
  Loader2,
  Lock,
  Unlock,
  Zap,
} from "lucide-react";

interface PipelineWaveListProps {
  sections: PipelineSection[];
  mainUnlocked: boolean;
  selectedKey: PipelineStepKey;
  getItemStatus: (item: PipelineWaveItem) => StepStatus;
  getDuration: (item: PipelineWaveItem) => number | null;
  getCost?: (item: PipelineWaveItem) => number | null;
  isAffected?: (item: PipelineWaveItem) => boolean;
  getTestStats?: (item: PipelineWaveItem) => { passed: number; total: number } | null;
  isLocked: (item: PipelineWaveItem) => boolean;
  isSelected: (item: PipelineWaveItem) => boolean;
  onSelect: (item: PipelineWaveItem) => void;
  /** Run a locked-but-pending step/lang node anyway (lock is advisory). */
  onRunItem?: (item: PipelineWaveItem) => void;
}

const STATUS_RING: Record<StepStatus, string> = {
  pending: "border-border hover:border-muted-foreground/50",
  running: "border-blue-500/70 bg-blue-500/10 shadow-sm shadow-blue-500/10",
  stopping: "border-amber-500/70 bg-amber-500/10 shadow-sm shadow-amber-500/10",
  stopped: "border-muted-foreground/50 bg-muted/40",
  completed: "border-green-500/55 bg-green-500/10",
  failed: "border-red-500/55 bg-red-500/10",
  skipped: "border-muted-foreground/40 bg-muted/30 border-dashed",
};

function itemKey(item: PipelineWaveItem): string {
  if (item.kind === "sub") return `sub:${item.id}`;
  if (item.kind === "lang" && item.parentStepId && item.langId) {
    return `lang:${item.parentStepId}:${item.langId}`;
  }
  return `step:${item.id}`;
}

function WaveStepButton({
  item,
  status,
  durationSec,
  costUsd,
  affected,
  testStats,
  locked,
  selected,
  onSelect,
  onRunItem,
}: {
  item: PipelineWaveItem;
  status: StepStatus;
  durationSec: number | null;
  costUsd: number | null;
  affected?: boolean;
  testStats?: { passed: number; total: number } | null;
  locked: boolean;
  selected: boolean;
  onSelect: () => void;
  onRunItem?: (item: PipelineWaveItem) => void;
}) {
  const disabled = item.enabledInConfig === false;
  const showLocked = locked && status === "pending";
  // A locked-but-pending workflow/language node can still be run (the lock is
  // advisory). Sub-steps keep their real ordering, so no override there.
  const canRunAnyway =
    showLocked &&
    !disabled &&
    !!onRunItem &&
    (item.kind === "step" || item.kind === "lang");
  // Non-blocking steps (if any) surface a failure as a warning rather than a
  // hard error, since they don't block the pipeline.
  const nonBlocking =
    item.kind === "step" && getStepConfig(item.id as StepId).nonBlocking === true;
  const warn = status === "failed" && nonBlocking;
  const ringClass = warn ? "border-amber-500/55 bg-amber-500/10" : STATUS_RING[status];

  let sub = "Pending";
  if (disabled) sub = "Disabled";
  else if (showLocked) sub = "Locked";
  else if (status === "completed") {
    const parts: string[] = ["Done"];
    if (durationSec != null) parts.push(`${durationSec}s`);
    if (costUsd != null && costUsd > 0) parts.push(formatPipelineCost(costUsd));
    sub = parts.join(" · ");
  } else if (status === "running") {
    sub =
      item.kind === "step" && item.id === "select_testcases"
        ? "Selecting suite…"
        : costUsd != null && costUsd > 0
          ? `Running… · ${formatPipelineCost(costUsd)}`
          : "Running…";
  } else if (status === "stopping") {
    sub = "Stopping…";
  } else if (status === "stopped") {
    sub = "Stopped";
  } else if (status === "failed") {
    const parts: string[] = [warn ? "Warning" : "Failed"];
    if (durationSec != null) parts.push(`${durationSec}s`);
    if (costUsd != null && costUsd > 0) parts.push(formatPipelineCost(costUsd));
    sub = parts.join(" · ");
  } else if (status === "skipped") sub = "Skipped";

  return (
    <div
      data-step-key={itemKey(item)}
      className={cn(
        "flex flex-col rounded-md border px-2.5 py-2 gap-1 min-w-[120px] max-w-full transition-all",
        ringClass,
        disabled && "opacity-40 border-dashed",
        showLocked && "opacity-60",
        selected && "ring-2 ring-blue-500 ring-offset-1 ring-offset-background"
      )}
    >
      <button
        type="button"
        disabled={disabled}
        onClick={onSelect}
        className={cn(
          "flex flex-col text-left gap-1 w-full",
          disabled && "cursor-not-allowed"
        )}
      >
        <div className="flex items-start justify-between gap-1.5">
          <span className="text-xs font-semibold leading-snug">{item.label}</span>
          <div className="flex items-center shrink-0">
            {showLocked && <Lock className="w-3 h-3 text-muted-foreground" />}
            {warn && <AlertTriangle className="w-3 h-3 text-amber-500" />}
            {status === "completed" && !showLocked && <Check className="w-3 h-3 text-green-500" />}
            {status === "skipped" && !showLocked && (
              <span className="text-[9px] text-muted-foreground">skip</span>
            )}
            {status === "running" && <Loader2 className="w-3 h-3 text-blue-400 animate-spin" />}
            {status === "stopping" && <Loader2 className="w-3 h-3 text-amber-400 animate-spin" />}
          </div>
        </div>
        <span className="text-[10px] text-muted-foreground">{sub}</span>
        {(testStats || affected) && (
          <div className="flex flex-wrap items-center gap-1">
            {testStats && (
              <span
                className={cn(
                  "rounded px-1 py-0.5 text-[9px] font-medium tabular-nums",
                  testStats.passed === testStats.total
                    ? "bg-green-500/15 text-green-600 dark:text-green-400"
                    : "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                )}
              >
                {testStats.passed}/{testStats.total} passed
              </span>
            )}
            {affected && (
              <span className="rounded px-1 py-0.5 text-[9px] font-medium bg-amber-500/15 text-amber-600 dark:text-amber-400">
                affected · re-run
              </span>
            )}
          </div>
        )}
      </button>

      {canRunAnyway && (
        <button
          type="button"
          title="Prerequisites aren't marked complete for this question — run this step anyway."
          onClick={(e) => {
            e.stopPropagation();
            onRunItem?.(item);
          }}
          className="mt-1 inline-flex items-center justify-center gap-1 rounded border border-amber-500/50 px-2 py-0.5 text-[10px] font-medium text-amber-600 hover:bg-amber-500/10 dark:text-amber-400"
        >
          <Unlock className="w-3 h-3" />
          Run anyway
        </button>
      )}
    </div>
  );
}

export function PipelineWaveList({
  sections,
  mainUnlocked,
  selectedKey,
  getItemStatus,
  getDuration,
  getCost,
  isAffected,
  getTestStats,
  isLocked,
  isSelected,
  onSelect,
  onRunItem,
}: PipelineWaveListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const selectedKeyStr = stepKeyStr(selectedKey);

  useEffect(() => {
    const el = scrollRef.current?.querySelector<HTMLElement>(`[data-step-key="${selectedKeyStr}"]`);
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedKeyStr]);

  return (
    <div
      ref={scrollRef}
      className="flex flex-col h-full min-h-[280px] max-h-[min(62vh,560px)] overflow-y-auto rounded-lg border bg-card p-3 space-y-5"
    >
      {sections.map((section, sectionIdx) => (
        <div key={section.id}>
          {sectionIdx > 0 && (
            <div className="flex justify-center py-2 text-muted-foreground/50">
              <ArrowDown className="w-4 h-4" />
            </div>
          )}

          <div className="flex items-center gap-2 mb-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {section.title}
            </h3>
            {section.id === "main_pipeline" && (
              <Badge
                variant="outline"
                className={cn(
                  "text-[9px] h-5",
                  mainUnlocked ? "border-emerald-500/50 text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"
                )}
              >
                {mainUnlocked ? "Unlocked" : "Locked"}
              </Badge>
            )}
          </div>

          <div className="space-y-2">
            {section.waves.map((wave, waveIdx) => (
              <div key={wave.id}>
                {waveIdx > 0 && (
                  <div className="flex justify-center py-1 text-muted-foreground/40">
                    <ArrowDown className="w-3.5 h-3.5" />
                  </div>
                )}

                {(wave.parallel || wave.horizontal) && wave.items.length > 1 ? (
                  <div className="rounded-lg border border-dashed border-muted-foreground/30 bg-muted/20 p-2 space-y-2">
                    <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                      {wave.parallel ? (
                        <Zap className="w-3 h-3 shrink-0" />
                      ) : (
                        <ArrowRight className="w-3 h-3 shrink-0" />
                      )}
                      {wave.subtitle}
                    </p>
                    <div
                      className={cn(
                        "flex items-center gap-2",
                        wave.horizontal && !wave.parallel
                          ? "flex-nowrap overflow-x-auto pb-0.5 gap-1"
                          : "flex-wrap"
                      )}
                    >
                      {wave.items.map((item, itemIdx) => (
                        <span key={itemKey(item)} className="contents">
                          {itemIdx > 0 && wave.horizontal && !wave.parallel && (
                            <ArrowRight
                              className="w-3.5 h-3.5 shrink-0 text-muted-foreground/60"
                              aria-hidden
                            />
                          )}
                          <WaveStepButton
                            item={item}
                            status={getItemStatus(item)}
                            durationSec={getDuration(item)}
                            costUsd={getCost?.(item) ?? null}
                            affected={isAffected?.(item) ?? false}
                            testStats={getTestStats?.(item) ?? null}
                            locked={isLocked(item)}
                            selected={isSelected(item)}
                            onSelect={() => onSelect(item)}
                            onRunItem={onRunItem}
                          />
                        </span>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {wave.items.map((item) => (
                      <WaveStepButton
                        key={itemKey(item)}
                        item={item}
                        status={getItemStatus(item)}
                        durationSec={getDuration(item)}
                        costUsd={getCost?.(item) ?? null}
                        affected={isAffected?.(item) ?? false}
                        testStats={getTestStats?.(item) ?? null}
                        locked={isLocked(item)}
                        selected={isSelected(item)}
                        onSelect={() => onSelect(item)}
                        onRunItem={onRunItem}
                      />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
