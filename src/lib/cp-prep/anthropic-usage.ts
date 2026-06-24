import type { OpenRouterCompletion } from "@/lib/openrouter";
import type { PrepUsageSummary } from "./types";

export interface AnthropicCallUsage {
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** OpenRouter returns USD when usage.include is set; otherwise a rough estimate. */
  estimatedCostUsd: number;
  callIndex: number;
  isRepair: boolean;
}

/** Rough USD estimate when OpenRouter does not return cost in the response. */
export function estimateAnthropicCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  // Fallback only — OpenRouter normally returns the real USD cost. Rough
  // per-million-token rates by model family so non-Anthropic models configured
  // via OPENROUTER_MODEL_CP_PREP aren't all priced as Claude (P2-M5).
  const m = model.toLowerCase();
  let inPerM = 3;
  let outPerM = 15;
  if (m.includes("opus")) {
    inPerM = 15;
    outPerM = 75;
  } else if (m.includes("haiku")) {
    inPerM = 0.8;
    outPerM = 4;
  } else if (m.includes("sonnet")) {
    inPerM = 3;
    outPerM = 15;
  } else if (m.includes("gpt-4o-mini") || m.includes("gpt-5-mini") || m.includes("mini")) {
    inPerM = 0.15;
    outPerM = 0.6;
  } else if (m.includes("gpt") || m.includes("openai")) {
    inPerM = 2.5;
    outPerM = 10;
  } else if (m.includes("gemini")) {
    inPerM = 1.25;
    outPerM = 5;
  }
  return (inputTokens / 1_000_000) * inPerM + (outputTokens / 1_000_000) * outPerM;
}

export function usageFromOpenRouterCompletion(
  completion: OpenRouterCompletion,
  meta: { callIndex: number; isRepair: boolean },
): AnthropicCallUsage {
  const { promptTokens, completionTokens, totalTokens, costUsd } = completion.usage;
  const model = completion.model ?? "unknown";
  return {
    model,
    promptTokens,
    completionTokens,
    totalTokens,
    estimatedCostUsd:
      costUsd ?? estimateAnthropicCostUsd(model, promptTokens, completionTokens),
    callIndex: meta.callIndex,
    isRepair: meta.isRepair,
  };
}

export function summarizePrepUsage(calls: AnthropicCallUsage[]): PrepUsageSummary | undefined {
  if (calls.length === 0) return undefined;
  const model = calls[calls.length - 1]?.model ?? calls[0].model;
  let promptTokens = 0;
  let completionTokens = 0;
  let estimatedCostUsd = 0;
  for (const c of calls) {
    promptTokens += c.promptTokens;
    completionTokens += c.completionTokens;
    estimatedCostUsd += c.estimatedCostUsd;
  }
  return {
    model,
    calls: calls.length,
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    estimatedCostUsd,
  };
}

export function formatUsageStatusLine(usage: AnthropicCallUsage): string {
  const label = usage.isRepair ? "repair" : "generation";
  return (
    `Model ${label} · ${usage.totalTokens.toLocaleString()} tokens` +
    ` (in ${usage.promptTokens.toLocaleString()}, out ${usage.completionTokens.toLocaleString()})` +
    ` · ~$${usage.estimatedCostUsd.toFixed(4)} est.`
  );
}

export function formatUsageSummaryLine(summary: PrepUsageSummary): string {
  return (
    `Total: ${summary.calls} API call${summary.calls === 1 ? "" : "s"}, ` +
    `${summary.totalTokens.toLocaleString()} tokens, ~$${summary.estimatedCostUsd.toFixed(4)} estimated` +
    ` (${summary.model})`
  );
}
