import { getPrerequisiteStep, getQuestionGenerationSteps, getStepConfig } from "@/lib/pipeline-config";
import type { QuestionType, StepId } from "@/types/pipeline";

export interface GraphNodeLayout {
  id: StepId;
  label: string;
  layer: number;
  /** Index within the layer (left → right). */
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

export interface PipelineGraphLayout {
  nodes: GraphNodeLayout[];
  edges: GraphEdge[];
  width: number;
  height: number;
}

const NODE_WIDTH = 148;
const NODE_HEIGHT = 76;
const LAYER_GAP_Y = 88;
const NODE_GAP_X = 20;
const PADDING_X = 24;
const PADDING_Y = 20;

/** Short labels for compact graph nodes. */
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

/**
 * Layered DAG for question-generation steps. Layers are chosen for readability
 * (parallel siblings share a row), not strict topological depth only.
 */
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
  const workflowSteps = stepIds; // prerequisites resolved within this subgraph
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
    const rowWidth = ids.length * NODE_WIDTH + (ids.length - 1) * NODE_GAP_X;
    const gridWidth = maxColumns * NODE_WIDTH + (maxColumns - 1) * NODE_GAP_X;
    const startX = PADDING_X + (gridWidth - rowWidth) / 2;

    ids.forEach((id, column) => {
      nodes.push({
        id,
        label: graphLabel(id),
        layer,
        column,
        x: startX + column * (NODE_WIDTH + NODE_GAP_X),
        y: PADDING_Y + layer * (NODE_HEIGHT + LAYER_GAP_Y),
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
      });
    });
  }

  const edges: GraphEdge[] = [];
  for (const id of stepIds) {
    const prereq = getPrerequisiteStep(id, workflowSteps, questionType);
    if (prereq && stepIds.includes(prereq)) {
      edges.push({ from: prereq, to: id });
    }
  }

  const gridWidth = maxColumns * NODE_WIDTH + (maxColumns - 1) * NODE_GAP_X;
  const maxLayer = Math.max(...layerIndices, 0);

  return {
    nodes,
    edges,
    width: gridWidth + PADDING_X * 2,
    height: PADDING_Y * 2 + (maxLayer + 1) * NODE_HEIGHT + maxLayer * LAYER_GAP_Y,
  };
}

/** Center-bottom of a node (edge start for downward flow). */
export function nodeBottomCenter(node: GraphNodeLayout): { x: number; y: number } {
  return { x: node.x + node.width / 2, y: node.y + node.height };
}

/** Center-top of a node (edge end). */
export function nodeTopCenter(node: GraphNodeLayout): { x: number; y: number } {
  return { x: node.x + node.width / 2, y: node.y };
}
