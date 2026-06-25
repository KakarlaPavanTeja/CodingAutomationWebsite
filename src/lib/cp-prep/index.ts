// Core routine: raw problem + reference solution  ->  { problem.md, solution.py, report }.
//
// Flow:
//   1. Ask the model to generate the statement, I/O format, and Python port (as JSON).
//   2. Execute the Python against every provided example.
//   3. If any example fails, send the failures back to the model to repair, then re-run.
//      Repeat up to maxRepairAttempts.
//   4. Return the best result with a verification report.

import { openRouterChatCompletion, type OpenRouterChatMessage } from "@/lib/openrouter";
import { verifySolution } from "./python-runner";
import {
  SYSTEM_PROMPT,
  buildGeneratePrompt,
  buildRefinePrompt,
  buildRepairPrompt,
} from "./prompts";
import { resolveVerifyExamples, extractExamplesFromStatement } from "./example-extractor";
import {
  usageFromOpenRouterCompletion,
  summarizePrepUsage,
  formatUsageStatusLine,
  formatUsageSummaryLine,
} from "./anthropic-usage";
import type {
  PrepInput,
  PrepOptions,
  PrepResult,
  ExampleRunResult,
  Example,
  AnthropicCallUsage,
} from "./types";

// Strong fallback model — also the top rung of the default escalation ladder.
const DEFAULT_CP_PREP_MODEL = "anthropic/claude-opus-4.5";

// Cheap → expensive ladder. A faithful PORT starts on the cheap rung and only
// climbs when the examples don't pass; a hard call error also escalates.
const DEFAULT_MODEL_TIERS = ["anthropic/claude-sonnet-4.6", DEFAULT_CP_PREP_MODEL];

const DEFAULTS = {
  maxRepairAttempts: 3,
  perExampleTimeoutMs: 10_000,
  pythonBin: "python3",
};

/**
 * Resolve the cheap→expensive model ladder. Precedence:
 *  1. options.modelTiers (explicit ladder, e.g. from tests)
 *  2. options.model or OPENROUTER_MODEL_CP_PREP — pins a single model (escalation off)
 *  3. OPENROUTER_CP_PREP_MODEL_TIERS — comma-separated ladder
 *  4. the built-in DEFAULT_MODEL_TIERS
 */
function resolveModelTiers(options: PrepOptions): string[] {
  if (options.modelTiers && options.modelTiers.length > 0) return options.modelTiers;
  const pinned = options.model?.trim() || process.env.OPENROUTER_MODEL_CP_PREP?.trim();
  if (pinned) return [pinned];
  const envTiers = process.env.OPENROUTER_CP_PREP_MODEL_TIERS?.trim();
  if (envTiers) {
    const tiers = envTiers.split(",").map((s) => s.trim()).filter(Boolean);
    if (tiers.length > 0) return tiers;
  }
  return DEFAULT_MODEL_TIERS;
}

interface ModelJson {
  slug: string;
  problemMarkdown: string;
  solutionPython: string;
  report: string;
}

function emitProgress(
  options: PrepOptions,
  event: { type: "status" | "warning"; message: string },
) {
  options.onProgress?.(event);
}

/** Pull the JSON object out of the model's reply, tolerating accidental fences. */
function parseModelJson(text: string): ModelJson {
  let t = text.trim();
  const fence = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fence) t = fence[1].trim();
  if (!t.startsWith("{")) {
    const first = t.indexOf("{");
    const last = t.lastIndexOf("}");
    if (first !== -1 && last > first) t = t.slice(first, last + 1);
  }
  const obj = JSON.parse(t) as Partial<ModelJson>;
  if (
    typeof obj.slug !== "string" ||
    typeof obj.problemMarkdown !== "string" ||
    typeof obj.solutionPython !== "string" ||
    typeof obj.report !== "string"
  ) {
    throw new Error("Model JSON missing one of: slug, problemMarkdown, solutionPython, report");
  }
  return obj as ModelJson;
}

function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 80) || "problem"
  );
}

/**
 * Turn a raw CP problem with a reference solution into a clean Markdown statement
 * and a verified Python port. Executes the Python against the provided examples
 * and iterates with the model until they pass (or attempts run out).
 */
export async function prepProblem(
  input: PrepInput,
  options: PrepOptions = {},
): Promise<PrepResult> {
  const opts = {
    ...DEFAULTS,
    pythonBin: process.env.PYTHON_PATH || DEFAULTS.pythonBin,
    ...options,
  };
  const hasRef = Boolean(input.referenceSolution?.trim());
  const inputExamples = input.examples ?? [];
  const isRefine = Boolean(input.refine?.instruction?.trim());

  const modelTiers = resolveModelTiers(opts);
  // PORT mode leans on a reference, so start on the cheapest tier and escalate on
  // failure. AUTHOR mode (no reference) must design the algorithm — start at the top.
  let tierIndex = hasRef ? 0 : modelTiers.length - 1;

  const messages: OpenRouterChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: isRefine ? buildRefinePrompt(input) : buildGeneratePrompt(input),
    },
  ];

  let current: ModelJson | null = null;
  let lastResults: ExampleRunResult[] = [];
  let lastVerifyExamples: Example[] = [];
  let repairAttempts = 0;
  const usageCalls: AnthropicCallUsage[] = [];
  let callIndex = 0;

  // One model call at the current tier, climbing the ladder on a hard call error
  // (bad slug, upstream 5xx) until the top rung is reached, then rethrowing.
  async function callCurrentTier() {
    for (;;) {
      const model = modelTiers[tierIndex];
      try {
        return await openRouterChatCompletion({
          apiKey: opts.apiKey,
          model,
          messages,
          maxTokens: 8000,
          signal: opts.signal,
        });
      } catch (err) {
        if (tierIndex >= modelTiers.length - 1) throw err;
        const next = modelTiers[tierIndex + 1];
        tierIndex++;
        emitProgress(opts, {
          type: "warning",
          message: `Model ${model} call failed (${
            err instanceof Error ? err.message : String(err)
          }); escalating to ${next}.`,
        });
      }
    }
  }

  for (let attempt = 0; attempt <= opts.maxRepairAttempts; attempt++) {
    const isRepair = attempt > 0;
    const model = modelTiers[tierIndex];
    emitProgress(opts, {
      type: "status",
      message: isRepair
        ? `Calling ${model} (repair attempt ${attempt}/${opts.maxRepairAttempts})…`
        : isRefine
          ? `Calling ${model} (applying your changes)…`
          : `Calling ${model} (generation)…`,
    });

    const completion = await callCurrentTier();

    const callUsage = usageFromOpenRouterCompletion(completion, {
      callIndex: callIndex++,
      isRepair: attempt > 0,
    });
    usageCalls.push(callUsage);
    opts.onUsage?.(callUsage);
    emitProgress(opts, {
      type: "status",
      message: formatUsageStatusLine(callUsage),
    });

    const replyText = completion.content;
    messages.push({ role: "assistant", content: replyText });

    // A truncated/garbled reply (e.g. cut off at maxTokens) makes JSON.parse
    // throw. Spend a repair attempt asking for valid JSON instead of aborting
    // the whole run on the first bad parse (P2-L1).
    try {
      current = parseModelJson(replyText);
    } catch (parseErr) {
      if (attempt === opts.maxRepairAttempts) {
        throw new Error(
          `Model did not return valid JSON after ${attempt + 1} attempt(s): ${
            parseErr instanceof Error ? parseErr.message : String(parseErr)
          }`,
        );
      }
      repairAttempts++;
      // A garbled/truncated reply often means the tier was overwhelmed — climb.
      tierIndex = Math.min(tierIndex + 1, modelTiers.length - 1);
      emitProgress(opts, {
        type: "warning",
        message: "Model reply was not valid JSON — asking it to resend as JSON.",
      });
      messages.push({
        role: "user",
        content:
          "Your previous reply was not valid JSON (it may have been truncated). " +
          "Resend ONLY a single valid JSON object with keys slug, problemMarkdown, " +
          "solutionPython, report — no prose, no markdown fences.",
      });
      continue;
    }

    const verifyExamples = resolveVerifyExamples(current.problemMarkdown, inputExamples);
    lastVerifyExamples = verifyExamples;

    if (verifyExamples.length > 0) {
      const fromGenerated =
        extractExamplesFromStatement(current.problemMarkdown).length > 0;
      emitProgress(opts, {
        type: "status",
        message: `Running ${verifyExamples.length} example${verifyExamples.length === 1 ? "" : "s"} (from ${fromGenerated ? "generated statement" : "raw input"})…`,
      });
    } else {
      emitProgress(opts, {
        type: "warning",
        message: "No examples found to verify — review the generated files manually.",
      });
    }

    lastResults = await verifySolution(current.solutionPython, verifyExamples, {
      pythonBin: opts.pythonBin,
      perExampleTimeoutMs: opts.perExampleTimeoutMs,
    });

    const failing = lastResults.filter((r) => !r.passed);
    const passed = lastResults.filter((r) => r.passed).length;

    if (verifyExamples.length > 0) {
      emitProgress(opts, {
        type: "status",
        message:
          failing.length === 0
            ? `All ${passed} example${passed === 1 ? "" : "s"} passed.`
            : `${failing.length} of ${verifyExamples.length} example${verifyExamples.length === 1 ? "" : "s"} failed.`,
      });
    }

    if (failing.length === 0 || attempt === opts.maxRepairAttempts) break;

    repairAttempts++;
    // Examples failed → the current tier wasn't strong enough. Escalate the repair.
    if (tierIndex < modelTiers.length - 1) {
      tierIndex++;
      emitProgress(opts, {
        type: "status",
        message: `Escalating to ${modelTiers[tierIndex]} for the repair.`,
      });
    }
    messages.push({
      role: "user",
      content: buildRepairPrompt(failing, verifyExamples, hasRef),
    });
  }

  if (!current) throw new Error("No solution was produced.");

  const allPassed = lastResults.every((r) => r.passed);
  const slug = /^[a-z0-9_]+$/.test(current.slug) ? current.slug : slugify(input.title);

  emitProgress(opts, {
    type: "status",
    message: allPassed
      ? "Generation complete."
      : "Generation complete (some examples did not pass).",
  });

  const usageSummary = summarizePrepUsage(usageCalls);
  if (usageSummary) {
    emitProgress(opts, {
      type: "status",
      message: formatUsageSummaryLine(usageSummary),
    });
  }

  return {
    slug,
    problemMarkdown: current.problemMarkdown,
    solutionPython: current.solutionPython,
    verified: allPassed,
    examplesRun: lastVerifyExamples.length,
    exampleResults: lastResults,
    repairAttempts,
    report: current.report,
    usage: usageSummary,
  };
}

export type { PrepInput, PrepOptions, PrepResult, Example, ExampleRunResult } from "./types";
export { extractExamplesFromStatement, resolveVerifyExamples } from "./example-extractor";
export { parseCombinedInput } from "./parse-combined-input";
