import { getPrerequisiteStep, getQuestionGenerationSteps, getStepConfig } from "@/lib/pipeline-config";
import type { QuestionType, StepId } from "@/types/pipeline";

export interface GraphNodeLayout {
  id: StepId;
  label: string;
  layer: number;
  column: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GraphEdge {
  from: StepId;
  to: StepId;
}

export interface GraphLayerGroup {
  layer: number;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PipelineGraphLayout {
  nodes: GraphNodeLayout[];
  edges: GraphEdge[];
  layerGroups: GraphLayerGroup[];
  width: number;
  height: number;
}

export const GRAPH_NODE_WIDTH = 172;
export const GRAPH_NODE_HEIGHT = 108;
const LAYER_GAP_Y = 108;
const NODE_GAP_X = 16;
const PADDING_X = 28;
const PADDING_Y = 36;
const GROUP_PAD = 14;

const GRAPH_LABELS: Partial<Record<StepId, string>> = {
  generate_description: "Description",
  enforce_naming: "Naming",
  generate_titles: "Titles",
  generate_difficulty: "Difficulty",
  generate_topics: "Topics",
  translate_cpp: "C++",
  translate_java: "Java",
  translate_nodejs: "Node.js",
};

function graphLabel(stepId: StepId): string {
  return GRAPH_LABELS[stepId] ?? getStepConfig(stepId).label;
}

function layerGroupLabel(layer: number, questionType: QuestionType): string {
  if (layer === 0) return "";
  if (questionType === "function" && layer === 1) return "Parallel after description";
  if (questionType === "function" && layer === 2) return "Parallel after naming";
  return "Parallel after description";
}

function assignLayers(stepIds: StepId[], questionType: QuestionType): Map<StepId, number> {
  const layers = new Map<StepId, number>();

  if (questionType === "function") {
    layers.set("generate_description", 0);
    for (const id of ["enforce_naming", "generate_titles", "generate_difficulty", "generate_topics"] as StepId[]) {
      if (stepIds.includes(id)) layers.set(id, 1);
    }
    for (const id of ["translate_cpp", "translate_java", "translate_nodejs"] as StepId[]) {
      if (stepIds.includes(id)) layers.set(id, 2);
    }
  } else {
    layers.set("generate_description", 0);
    for (const id of stepIds) {
      if (id !== "generate_description") layers.set(id, 1);
    }
  }

  return layers;
}

export function buildQuestionGenerationGraph(questionType: QuestionType): PipelineGraphLayout {
  const stepIds = getQuestionGenerationSteps(questionType);
  const workflowSteps = stepIds;
  const layers = assignLayers(stepIds, questionType);

  const byLayer = new Map<number, StepId[]>();
  for (const id of stepIds) {
    const layer = layers.get(id) ?? 0;
    const list = byLayer.get(layer) ?? [];
    list.push(id);
    byLayer.set(layer, list);
  }

  const layerIndices = [...byLayer.keys()].sort((a, b) => a - b);
  const maxColumns = Math.max(...layerIndices.map((l) => byLayer.get(l)!.length), 1);

  const nodes: GraphNodeLayout[] = [];

  for (const layer of layerIndices) {
    const ids = byLayer.get(layer)!;
    const rowWidth = ids.length * GRAPH_NODE_WIDTH + (ids.length - 1) * NODE_GAP_X;
    const gridWidth = maxColumns * GRAPH_NODE_WIDTH + (maxColumns - 1) * NODE_GAP_X;
    const startX = PADDING_X + (gridWidth - rowWidth) / 2;

    ids.forEach((id, column) => {
      nodes.push({
        id,
        label: graphLabel(id),
        layer,
        column,
        x: startX + column * (GRAPH_NODE_WIDTH + NODE_GAP_X),
        y: PADDING_Y + layer * (GRAPH_NODE_HEIGHT + LAYER_GAP_Y),
        width: GRAPH_NODE_WIDTH,
        height: GRAPH_NODE_HEIGHT,
      });
    });
  }

  const layerGroups: GraphLayerGroup[] = [];
  for (const layer of layerIndices) {
    if (layer === 0) continue;
    const layerNodes = nodes.filter((n) => n.layer === layer);
    if (layerNodes.length < 2) continue;

    const minX = Math.min(...layerNodes.map((n) => n.x));
    const maxX = Math.max(...layerNodes.map((n) => n.x + n.width));
    const minY = Math.min(...layerNodes.map((n) => n.y));
    const maxY = Math.max(...layerNodes.map((n) => n.y + n.height));

    layerGroups.push({
      layer,
      label: layerGroupLabel(layer, questionType),
      x: minX - GROUP_PAD,
      y: minY - GROUP_PAD - 18,
      width: maxX - minX + GROUP_PAD * 2,
      height: maxY - minY + GROUP_PAD * 2 + 18,
    });
  }

  const edges: GraphEdge[] = [];
  for (const id of stepIds) {
    const prereq = getPrerequisiteStep(id, workflowSteps, questionType);
    if (prereq && stepIds.includes(prereq)) {
      edges.push({ from: prereq, to: id });
    }
  }

  const gridWidth = maxColumns * GRAPH_NODE_WIDTH + (maxColumns - 1) * NODE_GAP_X;
  const maxLayer = Math.max(...layerIndices, 0);

  return {
    nodes,
    edges,
    layerGroups,
    width: gridWidth + PADDING_X * 2,
    height: PADDING_Y * 2 + (maxLayer + 1) * GRAPH_NODE_HEIGHT + maxLayer * LAYER_GAP_Y,
  };
}

export function nodeBottomCenter(node: GraphNodeLayout): { x: number; y: number } {
  return { x: node.x + node.width / 2, y: node.y + node.height };
}

export function nodeTopCenter(node: GraphNodeLayout): { x: number; y: number } {
  return { x: node.x + node.width / 2, y: node.y };
}
