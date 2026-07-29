"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useResetOnChange } from "@/lib/use-reset-on-change";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  groupPipelineSteps,
  type PipelineStepListEntry,
} from "@/lib/pipeline-step-list";
import type { StepStatus } from "@/types/pipeline";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";

const STATUS_BADGE: Record<StepStatus, string> = {
  pending: "bg-muted text-muted-foreground",
  running: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  stopping: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  stopped: "bg-muted/60 text-muted-foreground border-muted-foreground/30",
  completed: "bg-green-500/15 text-green-400 border-green-500/30",
  failed: "bg-red-500/15 text-red-400 border-red-500/30",
  skipped: "bg-muted/60 text-muted-foreground border-muted-foreground/30",
};

interface LogStepPickerProps {
  entries: PipelineStepListEntry[];
  openLogKeys: string[];
  maxOpen: number;
  onSelect: (keyStr: string) => void;
}

export function LogStepPicker({
  entries,
  openLogKeys,
  maxOpen,
  onSelect,
}: LogStepPickerProps) {
  const [open, setOpen] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const rootRef = useRef<HTMLDivElement>(null);

  const atMax = openLogKeys.length >= maxOpen;

  const availableEntries = useMemo(
    () => entries.filter((entry) => !entry.disabled && !openLogKeys.includes(entry.keyStr)),
    [entries, openLogKeys]
  );

  const groups = useMemo(() => groupPipelineSteps(availableEntries), [availableEntries]);

  const sectionOrder = useMemo(() => {
    const order: string[] = [];
    for (const group of groups) {
      if (!order.includes(group.sectionId)) order.push(group.sectionId);
    }
    return order;
  }, [groups]);

  // Expand every section whenever the menu opens (or its sections change while open).
  // Keyed to null while closed so the next open re-expands even if the order is unchanged.
  useResetOnChange(open ? sectionOrder.join("|") : null, () => {
    if (open) setExpandedSections(new Set(sectionOrder));
  });

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const toggleSection = (sectionId: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(sectionId)) next.delete(sectionId);
      else next.add(sectionId);
      return next;
    });
  };

  const handleSelect = (keyStr: string) => {
    onSelect(keyStr);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        disabled={atMax || availableEntries.length === 0}
        onClick={() => setOpen((prev) => !prev)}
        className={cn(
          "flex w-full items-center justify-between gap-2 rounded-md border bg-background px-2 py-1.5 text-[11px]",
          "text-foreground transition-colors hover:bg-muted/40",
          "disabled:cursor-not-allowed disabled:opacity-50"
        )}
      >
        <span className="truncate text-left">
          {atMax
            ? `Maximum ${maxOpen} logs open — close one to add another`
            : availableEntries.length === 0
              ? "All steps already open"
              : "Add step to view logs…"}
        </span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180"
          )}
        />
      </button>

      {open && (
        <div
          className={cn(
            "absolute left-0 right-0 top-full z-50 mt-1 max-h-72 overflow-y-auto",
            "rounded-md border bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10"
          )}
        >
          {groups.length === 0 ? (
            <p className="px-3 py-2 text-[11px] text-muted-foreground">No steps available.</p>
          ) : (
            sectionOrder.map((sectionId) => {
              const sectionGroups = groups.filter((g) => g.sectionId === sectionId);
              const sectionTitle = sectionGroups[0]?.sectionTitle ?? sectionId;
              const sectionExpanded = expandedSections.has(sectionId);

              return (
                <div key={sectionId} className="border-b last:border-b-0">
                  <button
                    type="button"
                    onClick={() => toggleSection(sectionId)}
                    className={cn(
                      "flex w-full items-center gap-1.5 px-2.5 py-2 text-left",
                      "bg-muted/30 hover:bg-muted/50 transition-colors"
                    )}
                  >
                    {sectionExpanded ? (
                      <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                    )}
                    <span className="text-[10px] font-semibold uppercase tracking-wide">
                      {sectionTitle}
                    </span>
                    <span className="ml-auto text-[10px] tabular-nums text-muted-foreground">
                      {sectionGroups.reduce((n, g) => n + g.entries.length, 0)}
                    </span>
                  </button>

                  {sectionExpanded &&
                    sectionGroups.map((group) => (
                      <div key={group.id} className="pb-1">
                        <div className="px-3 pt-1.5 pb-0.5">
                          <p className="text-[10px] font-medium text-foreground/90">
                            {group.waveSubtitle || group.waveTitle}
                          </p>
                          {group.waveSubtitle && group.waveTitle && (
                            <p className="text-[9px] text-muted-foreground leading-snug">
                              {group.waveTitle}
                            </p>
                          )}
                        </div>

                        <ul className="px-1">
                          {group.entries.map((entry) => (
                            <li key={entry.keyStr}>
                              <button
                                type="button"
                                onClick={() => handleSelect(entry.keyStr)}
                                className={cn(
                                  "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left",
                                  "text-[11px] hover:bg-accent hover:text-accent-foreground transition-colors"
                                )}
                              >
                                <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                                <Badge
                                  variant="outline"
                                  className={cn(
                                    "h-4 shrink-0 px-1 text-[9px] capitalize",
                                    STATUS_BADGE[entry.status]
                                  )}
                                >
                                  {entry.status === "running" && (
                                    <Loader2 className="mr-0.5 inline h-2.5 w-2.5 animate-spin" />
                                  )}
                                  {entry.status}
                                </Badge>
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
