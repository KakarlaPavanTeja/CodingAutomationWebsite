"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StepDetailPanel } from "./StepDetailPanel";
import { getPrerequisiteStep, getStepConfig } from "@/lib/pipeline-config";
import {
  buildQuestionGenerationGraph,
  nodeBottomCenter,
  nodeTopCenter,
  type GraphNodeLayout,
} from "@/lib/pipeline-graph";
import { cn } from "@/lib/utils";
import type { QuestionType, StepId, StepState, StepLlmUsageStats } from "@/types/pipeline";
import { Check, Loader2, Play, Square } from "lucide-react";

const STATUS_STYLES: Record<
  StepState["status"],
  { border: string; bg: string; badge: string; icon?: "check" | "spin" }
> = {
  pending: {
    border: "border-border",
    bg: "bg-card",
    badge: "bg-muted text-muted-foreground",
  },
  running: {
    border: "border-blue-500/60",
    bg: "bg-blue-500/10",
    badge: "bg-blue-500/20 text-blue-400",
    icon: "spin",
  },
  completed: {
    border: "border-green-500/50",
    bg: "bg-green-500/10",
    badge: "bg-green-500/20 text-green-400",
    icon: "check",
  },
  failed: {
    border: "border-red-500/50",
    bg: "bg-red-500/10",
    badge: "bg-red-500/20 text-red-400",
  },
};

function edgePath(from: GraphNodeLayout, to: GraphNodeLayout): string {
  const start = nodeBottomCenter(from);
  const end = nodeTopCenter(to);
  const midY = (start.y + end.y) / 2;
  return `M ${start.x} ${start.y} C ${start.x} ${midY}, ${end.x} ${midY}, ${end.x} ${end.y}`;
}

interface GraphStepNodeProps {
  node: GraphNodeLayout;
  state: StepState;
  canRun: boolean;
  isSelected: boolean;
  usage?: StepLlmUsageStats;
  onSelect: () => void;
  onRun: () => void;
  onStop: () => void;
}

function GraphStepNode({
  node,
  state,
  canRun,
  isSelected,
  usage,
  onSelect,
  onRun,
  onStop,
}: GraphStepNodeProps) {
  const config = getStepConfig(node.id);
  const status = state.status;
  const styles = STATUS_STYLES[status];
  const isRunning = status === "running";

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!isRunning || !state.startTime) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isRunning, state.startTime]);

  const duration =
    state.startTime && state.endTime
      ? Math.floor((state.endTime - state.startTime) / 1000)
      : state.startTime && isRunning
        ? Math.floor(Math.max(0, now - state.startTime) / 1000)
        : null;

  return (
    <div
      className={cn(
        "absolute rounded-xl border-2 shadow-sm transition-all flex flex-col",
        styles.border,
        styles.bg,
        isSelected && "ring-2 ring-blue-500 ring-offset-2 ring-offset-background shadow-lg",
        isRunning && "shadow-blue-500/20 shadow-md"
      )}
      style={{
        left: node.x,
        top: node.y,
        width: node.width,
        height: node.height,
      }}
    >
      <button
        type="button"
        className="flex-1 text-left p-3 pb-2 min-w-0"
        onClick={onSelect}
      >
        <div className="flex items-center justify-between gap-1 mb-1">
          <span className="text-sm font-semibold truncate">{node.label}</span>
          {styles.icon === "check" && <Check className="w-3.5 h-3.5 text-green-500 shrink-0" />}
          {styles.icon === "spin" && <Loader2 className="w-3.5 h-3.5 text-blue-400 animate-spin shrink-0" />}
        </div>
        <span className={cn("inline-flex text-[10px] font-medium px-1.5 py-0.5 rounded", styles.badge)}>
          {status === "completed" ? "Done" : status.charAt(0).toUpperCase() + status.slice(1)}
          {duration !== null && ` · ${duration}s`}
        </span>
        {usage && usage.callCount > 0 && (
          <p className="text-[10px] text-muted-foreground mt-1">
            {usage.callCount} LLM call{usage.callCount !== 1 ? "s" : ""}
          </p>
        )}
        {config.llmUsage === "llm" && status === "pending" && !usage?.callCount && (
          <p className="text-[10px] text-violet-500/90 mt-1">Uses LLM</p>
        )}
      </button>

      <div className="px-3 pb-3 pt-0">
        {isRunning ? (
          <Button
            size="sm"
            variant="destructive"
            className="w-full h-7 text-xs"
            onClick={(e) => {
              e.stopPropagation();
              onStop();
            }}
          >
            <Square className="w-3 h-3 mr-1 fill-current" />
            Stop
          </Button>
        ) : (
          <Button
            size="sm"
            className="w-full h-7 text-xs"
            disabled={!canRun}
            onClick={(e) => {
              e.stopPropagation();
              onSelect();
              onRun();
            }}
          >
            <Play className="w-3 h-3 mr-1" />
            Run
          </Button>
        )}
      </div>
    </div>
  );
}

interface QuestionGenerationFlowProps {
  questionType: QuestionType;
  workflowSteps: StepId[];
  stepStates: Map<StepId, StepState>;
  stepUsage: Partial<Record<StepId, StepLlmUsageStats>>;
  onRun: (state: StepState) => void;
  onStop: (stepId: StepId) => void;
}

export function QuestionGenerationFlow({
  questionType,
  workflowSteps,
  stepStates,
  stepUsage,
  onRun,
  onStop,
}: QuestionGenerationFlowProps) {
  const layout = useMemo(() => buildQuestionGenerationGraph(questionType), [questionType]);
  const nodeMap = useMemo(() => new Map(layout.nodes.map((n) => [n.id, n])), [layout.nodes]);

  const [selectedStepId, setSelectedStepId] = useState<StepId | null>("generate_description");

  // Auto-focus whichever question-gen step is currently running.
  useEffect(() => {
    for (const node of layout.nodes) {
      if (stepStates.get(node.id)?.status === "running") {
        setSelectedStepId(node.id);
        return;
      }
    }
  }, [layout.nodes, stepStates]);

  const selectedState = selectedStepId ? stepStates.get(selectedStepId) : undefined;

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Question generation</CardTitle>
          <p className="text-xs text-muted-foreground">
            Run steps directly on the graph. Sibling nodes in a dashed box run in parallel with Run All.
          </p>
        </CardHeader>
        <CardContent className="pb-6">
          <div className="overflow-x-auto -mx-1 px-1">
            <div
              className="relative mx-auto"
              style={{ width: layout.width, height: layout.height, minWidth: layout.width }}
            >
              {/* Parallel swimlanes */}
              {layout.layerGroups.map((group) => (
                <div
                  key={group.layer}
                  className="absolute rounded-2xl border border-dashed border-muted-foreground/25 bg-muted/15 pointer-events-none"
                  style={{
                    left: group.x,
                    top: group.y,
                    width: group.width,
                    height: group.height,
                  }}
                >
                  <span className="absolute -top-0 left-3 -translate-y-1/2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/80 bg-card px-1.5 rounded">
                    {group.label}
                  </span>
                </div>
              ))}

              <svg
                className="absolute inset-0 pointer-events-none"
                width={layout.width}
                height={layout.height}
                aria-hidden
              >
                <defs>
                  <marker
                    id="qg-flow-arrow"
                    markerWidth="8"
                    markerHeight="8"
                    refX="7"
                    refY="4"
                    orient="auto"
                  >
                    <path d="M0,0 L8,4 L0,8 Z" className="fill-muted-foreground/45" />
                  </marker>
                </defs>
                {layout.edges.map((edge) => {
                  const from = nodeMap.get(edge.from);
                  const to = nodeMap.get(edge.to);
                  if (!from || !to) return null;
                  const fromDone = stepStates.get(edge.from)?.status === "completed";
                  const toActive =
                    stepStates.get(edge.to)?.status === "running" ||
                    stepStates.get(edge.to)?.status === "completed";
                  return (
                    <path
                      key={`${edge.from}-${edge.to}`}
                      d={edgePath(from, to)}
                      fill="none"
                      strokeWidth={2}
                      className={cn(
                        fromDone && toActive
                          ? "stroke-blue-500/55"
                          : fromDone
                            ? "stroke-muted-foreground/40"
                            : "stroke-muted-foreground/25"
                      )}
                      markerEnd="url(#qg-flow-arrow)"
                    />
                  );
                })}
              </svg>

              {layout.nodes.map((node) => {
                const state = stepStates.get(node.id);
                if (!state) return null;
                const prereq = getPrerequisiteStep(node.id, workflowSteps, questionType);
                const canRun =
                  state.status !== "running" &&
                  (prereq === null || stepStates.get(prereq)?.status === "completed");

                return (
                  <GraphStepNode
                    key={node.id}
                    node={node}
                    state={state}
                    canRun={canRun}
                    isSelected={selectedStepId === node.id}
                    usage={stepUsage[node.id]}
                    onSelect={() => setSelectedStepId(node.id)}
                    onRun={() => onRun(state)}
                    onStop={() => onStop(node.id)}
                  />
                );
              })}
            </div>
          </div>
        </CardContent>
      </Card>

      {selectedState && selectedStepId && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Step output
          </p>
          <StepDetailPanel stepState={selectedState} llmUsageStats={stepUsage[selectedStepId]} />
        </div>
      )}
    </div>
  );
}
