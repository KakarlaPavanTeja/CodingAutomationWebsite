import { parsePipelineRunStepKey } from "@/lib/pipeline-run-label";
import type { LlmUsage, QuestionSubStepId } from "@/types/pipeline";

/** Legacy step ids stored in older usage rows */
export const USAGE_STEP_ID_ALIASES: Record<string, string> = {
  create_testcases: "generate_testcases",
};

const GQ_SUB_PROBLEM_NAME_SUFFIXES: Partial<Record<QuestionSubStepId, string[]>> = {
  description: ["_description"],
  naming: ["_signature", "_refactor"],
  titles: ["_titles"],
  difficulty: ["_difficulty"],
  topics: ["_topics"],
  translate_cpp: ["_convert_C++", "_convert_cpp"],
  translate_java: ["_convert_Java", "_convert_java"],
  translate_nodejs: ["_convert_Node.js", "_convert_nodejs", "_convert_node.js"],
};

const ENRICHMENT_PROBLEM_NAME_LABELS: Record<string, string> = {
  enrichment_reallife: "reallife",
  enrichment_hints: "hints",
  enrichment_followups: "followups",
};

export function normalizeUsageStepId(stepId: string): string {
  return USAGE_STEP_ID_ALIASES[stepId] ?? stepId;
}

function problemNameMatchesRunStep(problemName: string | null, runStepKey: string): boolean {
  if (!problemName) return false;

  const parsed = parsePipelineRunStepKey(runStepKey);

  if (parsed.subStepId && parsed.parentStepId === "generate_question") {
    const suffixes = GQ_SUB_PROBLEM_NAME_SUFFIXES[parsed.subStepId];
    if (suffixes) {
      return suffixes.some((suffix) => problemName.endsWith(suffix));
    }
  }

  if (parsed.parentStepId === "generate_enrichment" && parsed.subStepId) {
    const label = ENRICHMENT_PROBLEM_NAME_LABELS[problemName];
    return label === parsed.subStepId;
  }

  if (parsed.parentStepId === "generate_enrichment" && !parsed.subStepId) {
    return problemName.startsWith("enrichment_");
  }

  return false;
}

export interface UsageRowLike {
  stepId: string | null;
  problemName: string | null;
  createdAt: Date | null;
  runId?: string | null;
}

/**
 * Match an llm_usage row to a pipeline run.
 *
 * Exact path (P1-M1): if the row carries a runId, it matches iff that equals the
 * run's id — no time window, no step-name heuristics, so re-runs and overlapping
 * parallel steps can't double-count. Rows without a runId (legacy / non-pipeline)
 * fall back to the step-key + time-window heuristic.
 */
export function usageRowMatchesRunStep(
  row: UsageRowLike,
  runStepKey: string,
  windowStartMs: number,
  windowEndMs: number,
  runId?: string | null
): boolean {
  // Exact run-id attribution when available on both sides.
  if (row.runId) {
    return Boolean(runId) && row.runId === runId;
  }

  if (!row.createdAt) return false;

  const ts = row.createdAt.getTime();
  if (ts < windowStartMs || ts > windowEndMs) return false;

  const rowStep = normalizeUsageStepId(row.stepId ?? "");
  const normalizedRunKey = normalizeUsageStepId(runStepKey);

  if (rowStep === normalizedRunKey) return true;

  const parsed = parsePipelineRunStepKey(normalizedRunKey);
  if (rowStep === parsed.parentStepId) {
    if (parsed.subStepId || parsed.langId) {
      return problemNameMatchesRunStep(row.problemName, normalizedRunKey);
    }
    return true;
  }

  return false;
}

export function formatPipelineCost(n: number): string {
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n >= 0.01) return `$${n.toFixed(3)}`;
  if (n > 0) return `$${n.toFixed(4)}`;
  return "$0.00";
}

/** Cost cell for pipeline step lists — shows dollar amount, No LLM, or pending. */
export function formatStepCostDisplay(
  costUsd: number | null | undefined,
  llmUsage: LlmUsage,
  status?: string
): string {
  if (costUsd != null && costUsd > 0) return formatPipelineCost(costUsd);
  if (status === "running" && llmUsage !== "none") return "…";
  if (llmUsage === "none") return "No LLM";
  return formatPipelineCost(0);
}

export function formatTokenCount(n: number): string {
  return n.toLocaleString();
}

export interface UsageRowAggregateInput {
  model: string;
  promptTokens: number;
  completionTokens: number;
  costUsd: string | number;
}

export interface RunUsageSummary {
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  models: string[];
  callCount: number;
}

export function aggregateUsageRows(rows: UsageRowAggregateInput[]): RunUsageSummary {
  const models = new Set<string>();
  let promptTokens = 0;
  let completionTokens = 0;
  let costUsd = 0;

  for (const row of rows) {
    if (row.model && row.model !== "unknown") models.add(row.model);
    promptTokens += row.promptTokens;
    completionTokens += row.completionTokens;
    costUsd += typeof row.costUsd === "number" ? row.costUsd : parseFloat(row.costUsd || "0");
  }

  return {
    promptTokens,
    completionTokens,
    costUsd,
    models: Array.from(models),
    callCount: rows.length,
  };
}

type UsageRowForRunMatch = UsageRowLike & UsageRowAggregateInput;

/** Match llm_usage rows to a single pipeline run by step key and time window. */
export function matchUsageRowsForRun(
  usageRows: UsageRowForRunMatch[],
  runStepKey: string,
  startedAt: Date | null,
  finishedAt: Date | null,
  status: string,
  runId?: string | null
): RunUsageSummary | null {
  if (!startedAt) return null;

  const endAt = finishedAt ?? (status === "running" ? new Date() : null);
  if (!endAt) return null;

  const endMs = endAt.getTime() + 30_000;
  const matched = usageRows.filter((row) =>
    usageRowMatchesRunStep(row, runStepKey, startedAt.getTime(), endMs, runId)
  );

  if (matched.length === 0) return null;
  return aggregateUsageRows(matched);
}
