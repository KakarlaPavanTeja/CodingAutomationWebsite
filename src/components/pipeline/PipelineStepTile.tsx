"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { isActiveStatus } from "@/lib/pipeline-duration";
import type { StepLlmUsageStats, StepStatus } from "@/types/pipeline";
import { Check, Loader2, Lock, Play, Square } from "lucide-react";

const STATUS: Record<
  StepStatus,
  { ring: string; bg: string; badge: string; icon?: "check" | "spin" }
> = {
  pending: { ring: "border-border", bg: "bg-card", badge: "text-muted-foreground" },
  running: {
    ring: "border-blue-500/70",
    bg: "bg-blue-500/10",
    badge: "text-blue-400",
    icon: "spin",
  },
  completed: {
    ring: "border-green-500/60",
    bg: "bg-green-500/10",
    badge: "text-green-400",
    icon: "check",
  },
  failed: {
    ring: "border-red-500/60",
    bg: "bg-red-500/10",
    badge: "text-red-400",
  },
  skipped: {
    ring: "border-muted-foreground/40",
    bg: "bg-muted/30",
    badge: "text-muted-foreground",
  },
  stopping: {
    ring: "border-amber-500/70",
    bg: "bg-amber-500/10",
    badge: "text-amber-400",
    icon: "spin",
  },
  stopped: {
    ring: "border-muted-foreground/50",
    bg: "bg-muted/40",
    badge: "text-muted-foreground",
  },
};

interface PipelineStepTileProps {
  label: string;
  description?: string;
  status: StepStatus;
  startTime: number | null;
  endTime: number | null;
  requiresLabel: string | null;
  requirementMet: boolean;
  canRun: boolean;
  locked: boolean;
  disabledInConfig?: boolean;
  isSelected: boolean;
  usesLlm?: boolean;
  usage?: StepLlmUsageStats;
  onSelect: () => void;
  onRun: () => void;
  onStop: () => void;
}

export function PipelineStepTile({
  label,
  description,
  status,
  startTime,
  endTime,
  requiresLabel,
  requirementMet,
  canRun,
  locked,
  disabledInConfig,
  isSelected,
  usesLlm,
  usage,
  onSelect,
  onRun,
  onStop,
}: PipelineStepTileProps) {
  const styles = STATUS[status];
  const isRunning = status === "running";
  const isActive = isActiveStatus(status); // running or stopping
  const showLocked = locked && status === "pending";

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!isActive || !startTime) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isActive, startTime]);

  const duration =
    startTime && endTime
      ? Math.floor((endTime - startTime) / 1000)
      : startTime && isActive
        ? Math.floor(Math.max(0, now - startTime) / 1000)
        : null;

  return (
    <div
      className={cn(
        "rounded-lg border-2 p-3 flex flex-col gap-2 transition-all duration-300",
        styles.ring,
        styles.bg,
        showLocked && "opacity-55",
        disabledInConfig && "opacity-45 border-dashed",
        isActive && "shadow-md shadow-blue-500/10",
        isSelected && "ring-2 ring-blue-500 ring-offset-2 ring-offset-background shadow-md"
      )}
    >
      <button type="button" className="text-left space-y-1.5" onClick={onSelect}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <span className="text-sm font-semibold leading-snug block">{label}</span>
            {description && (
              <span className="text-[10px] text-muted-foreground leading-snug">{description}</span>
            )}
          </div>
          {showLocked && <Lock className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
          {!showLocked && styles.icon === "check" && (
            <Check className="w-3.5 h-3.5 text-green-500 shrink-0" />
          )}
          {!showLocked && styles.icon === "spin" && (
            <Loader2 className="w-3.5 h-3.5 text-blue-400 animate-spin shrink-0" />
          )}
        </div>

        {requiresLabel && (
          <p className="text-[11px] text-muted-foreground flex items-center gap-1 flex-wrap">
            <span>Requires</span>
            <span className="font-medium text-foreground/80">{requiresLabel}</span>
            {requirementMet ? (
              <Check className="w-3 h-3 text-green-500" />
            ) : (
              <span className="text-amber-500/90">· waiting</span>
            )}
          </p>
        )}

        <p className={cn("text-[11px] font-medium", styles.badge)}>
          {disabledInConfig
            ? "Disabled in config"
            : showLocked
              ? "Locked"
              : status === "completed"
                ? "Done"
                : status.charAt(0).toUpperCase() + status.slice(1)}
          {!disabledInConfig && duration !== null && ` · ${duration}s`}
        </p>

        {usage && usage.callCount > 0 && (
          <p className="text-[10px] text-muted-foreground">
            {usage.callCount} LLM call{usage.callCount !== 1 ? "s" : ""}
          </p>
        )}
        {usesLlm && status === "pending" && !usage?.callCount && !disabledInConfig && (
          <p className="text-[10px] text-violet-500/90">Uses LLM</p>
        )}
      </button>

      {isRunning ? (
        <Button size="sm" variant="destructive" className="h-7 text-xs" onClick={onStop}>
          <Square className="w-3 h-3 mr-1 fill-current" />
          Stop
        </Button>
      ) : status === "stopping" ? (
        <Button size="sm" variant="destructive" className="h-7 text-xs" disabled>
          <Loader2 className="w-3 h-3 mr-1 animate-spin" />
          Stopping…
        </Button>
      ) : status === "stopped" ? (
        <Button size="sm" variant="secondary" className="h-7 text-xs" disabled>
          <Square className="w-3 h-3 mr-1 fill-current" />
          Stopped
        </Button>
      ) : (
        <Button size="sm" className="h-7 text-xs" disabled={!canRun} onClick={onRun}>
          <Play className="w-3 h-3 mr-1" />
          Run
        </Button>
      )}
    </div>
  );
}
