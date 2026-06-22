"use client";

import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getStepConfig } from "@/lib/pipeline-config";
import {
  buildQuestionGenerationGraph,
  nodeBottomCenter,
  nodeTopCenter,
  type GraphNodeLayout,
} from "@/lib/pipeline-graph";
import { cn } from "@/lib/utils";
import type { QuestionType, StepId, StepState, StepLlmUsageStats } from "@/types/pipeline";

const STATUS_STYLES: Record<
  StepState["status"],
  { ring: string; bg: string; dot: string; label: string }
> = {
  pending: {
    ring: "ring-zinc-500/30",
    bg: "bg-card",
    dot: "bg-zinc-400",
    label: "Pending",
  },
  running: {
    ring: "ring-blue-500/60",
    bg: "bg-blue-500/10",
    dot: "bg-blue-500 animate-pulse",
    label: "Running",
  },
  completed: {
    ring: "ring-green-500/50",
    bg: "bg-green-500/10",
    dot: "bg-green-500",
    label: "Done",
  },
  failed: {
    ring: "ring-red-500/50",
    bg: "bg-red-500/10",
    dot: "bg-red-500",
    label: "Failed",
  },
};

function edgePath(from: GraphNodeLayout, to: GraphNodeLayout): string {
  const start = nodeBottomCenter(from);
  const end = nodeTopCenter(to);
  const midY = (start.y + end.y) / 2;
  return `M ${start.x} ${start.y} C ${start.x} ${midY}, ${end.x} ${midY}, ${end.x} ${end.y}`;
}

interface QuestionGenerationGraphProps {
  questionType: QuestionType;
  stepStates: Map<StepId, StepState>;
  stepUsage: Partial<Record<StepId, StepLlmUsageStats>>;
  selectedStepId: StepId | null;
  onSelectStep: (stepId: StepId) => void;
}

export function QuestionGenerationGraph({
  questionType,
  stepStates,
  stepUsage,
  selectedStepId,
  onSelectStep,
}: QuestionGenerationGraphProps) {
  const layout = useMemo(() => buildQuestionGenerationGraph(questionType), [questionType]);
  const nodeMap = useMemo(
    () => new Map(layout.nodes.map((n) => [n.id, n])),
    [layout.nodes]
  );

  const parallelLayerLabel =
    questionType === "function"
      ? "Parallel after description · translations parallel after naming"
      : "All parallel after description";

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Question generation flow</CardTitle>
        <p className="text-xs text-muted-foreground mt-1">{parallelLayerLabel}</p>
      </CardHeader>
      <CardContent className="pb-4">
        <div className="overflow-x-auto">
          <div className="relative min-w-full" style={{ width: layout.width, height: layout.height }}>
            <svg
              className="absolute inset-0 pointer-events-none text-border"
              width={layout.width}
              height={layout.height}
              aria-hidden
            >
              <defs>
                <marker
                  id="pipeline-arrow"
                  markerWidth="8"
                  markerHeight="8"
                  refX="7"
                  refY="4"
                  orient="auto"
                >
                  <path d="M0,0 L8,4 L0,8 Z" className="fill-muted-foreground/50" />
                </marker>
              </defs>
              {layout.edges.map((edge) => {
                const from = nodeMap.get(edge.from);
                const to = nodeMap.get(edge.to);
                if (!from || !to) return null;
                const toStatus = stepStates.get(edge.to)?.status ?? "pending";
                const active = toStatus === "running" || toStatus === "completed";
                return (
                  <path
                    key={`${edge.from}-${edge.to}`}
                    d={edgePath(from, to)}
                    fill="none"
                    strokeWidth={1.5}
                    className={cn(
                      active ? "stroke-blue-500/50" : "stroke-muted-foreground/35"
                    )}
                    markerEnd="url(#pipeline-arrow)"
                  />
                );
              })}
            </svg>

            {layout.nodes.map((node) => {
              const state = stepStates.get(node.id);
              const status = state?.status ?? "pending";
              const styles = STATUS_STYLES[status];
              const config = getStepConfig(node.id);
              const usage = stepUsage[node.id];
              const isSelected = selectedStepId === node.id;

              return (
                <button
                  key={node.id}
                  type="button"
                  onClick={() => onSelectStep(node.id)}
                  className={cn(
                    "absolute text-left rounded-xl border shadow-sm transition-all",
                    "ring-2 hover:shadow-md focus-visible:outline-none focus-visible:ring-blue-500",
                    styles.ring,
                    styles.bg,
                    isSelected && "ring-blue-500 border-blue-500/40 shadow-md"
                  )}
                  style={{
                    left: node.x,
                    top: node.y,
                    width: node.width,
                    height: node.height,
                  }}
                  title={config.description}
                >
                  <div className="flex flex-col h-full p-2.5 gap-1">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className={cn("w-2 h-2 rounded-full shrink-0", styles.dot)} />
                      <span className="text-xs font-semibold truncate leading-tight">
                        {node.label}
                      </span>
                    </div>
                    <span className="text-[10px] text-muted-foreground leading-tight">
                      {styles.label}
                      {usage && usage.callCount > 0 && (
                        <> · {usage.callCount} LLM call{usage.callCount !== 1 ? "s" : ""}</>
                      )}
                    </span>
                    {config.llmUsage === "llm" && status === "pending" && (
                      <span className="text-[10px] text-violet-600/80 dark:text-violet-300/80">
                        Uses LLM
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-wrap gap-3 mt-4 pt-3 border-t text-[11px] text-muted-foreground">
          {(["pending", "running", "completed", "failed"] as const).map((s) => (
            <span key={s} className="inline-flex items-center gap-1.5">
              <span className={cn("w-2 h-2 rounded-full", STATUS_STYLES[s].dot)} />
              {STATUS_STYLES[s].label}
            </span>
          ))}
          <span className="text-muted-foreground/70">Click a node to jump to its step card</span>
        </div>
      </CardContent>
    </Card>
  );
}
