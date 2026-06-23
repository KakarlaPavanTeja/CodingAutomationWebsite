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

const DEFAULT_CP_PREP_MODEL = "anthropic/claude-opus-4.5";

const DEFAULTS = {
  model: process.env.OPENROUTER_MODEL_CP_PREP?.trim() || DEFAULT_CP_PREP_MODEL,
  maxRepairAttempts: 3,
  perExampleTimeoutMs: 10_000,
  pythonBin: "python3",
};

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

  const messages: OpenRouterChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: buildGeneratePrompt(input) },
  ];

  let current: ModelJson | null = null;
  let lastResults: ExampleRunResult[] = [];
  let lastVerifyExamples: Example[] = [];
  let repairAttempts = 0;
  const usageCalls: AnthropicCallUsage[] = [];
  let callIndex = 0;

  for (let attempt = 0; attempt <= opts.maxRepairAttempts; attempt++) {
    const isRepair = attempt > 0;
    emitProgress(opts, {
      type: "status",
      message: isRepair
        ? `Calling model (repair attempt ${attempt}/${opts.maxRepairAttempts})…`
        : "Calling model (generation)…",
    });

    const completion = await openRouterChatCompletion({
      apiKey: opts.apiKey,
      model: opts.model,
      messages,
      maxTokens: 8000,
      signal: opts.signal,
    });

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
