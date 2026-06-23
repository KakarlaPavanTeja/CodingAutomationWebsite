import { NextRequest } from "next/server";
import { requireAuthApi } from "@/lib/auth/server";
import { recordLlmUsage } from "@/lib/record-llm-usage";
import { cpPrepLimiter, getClientIP } from "@/lib/rate-limit";
import {
  prepProblem,
  extractExamplesFromStatement,
  parseCombinedInput,
} from "@/lib/cp-prep";
import type { Example, PrepInput, PrepProgressEvent } from "@/lib/cp-prep/types";

export const runtime = "nodejs";
export const maxDuration = 300;

const KEEPALIVE_MS = 15_000;

// Strict size/shape limits so a single request cannot post megabytes of text
// into LLM prompts + Python stdin (cost amplification / DoS).
const MAX_BODY_BYTES = 256 * 1024; // 256 KB total request body
const MAX_TITLE_LEN = 300;
const MAX_STATEMENT_LEN = 60_000;
const MAX_SOLUTION_LEN = 60_000;
const MAX_LANGUAGE_LEN = 40;
const MAX_EXAMPLES = 50;
const MAX_EXAMPLE_FIELD_LEN = 20_000;

function isValid(body: unknown): body is PrepInput {
  if (typeof body !== "object" || body === null) return false;
  const b = body as Record<string, unknown>;
  return (
    typeof b.title === "string" &&
    b.title.trim().length > 0 &&
    b.title.length <= MAX_TITLE_LEN &&
    typeof b.problemStatement === "string" &&
    b.problemStatement.trim().length > 0 &&
    b.problemStatement.length <= MAX_STATEMENT_LEN &&
    (b.referenceSolution === undefined ||
      (typeof b.referenceSolution === "string" && b.referenceSolution.length <= MAX_SOLUTION_LEN)) &&
    (b.referenceLanguage === undefined ||
      (typeof b.referenceLanguage === "string" && b.referenceLanguage.length <= MAX_LANGUAGE_LEN))
  );
}

/** Accept only well-formed examples; silently drop anything malformed so a bad
 * `examples` field can never reach renderExamples / verifySolution as junk. */
function sanitizeExamples(raw: unknown): Example[] {
  if (!Array.isArray(raw)) return [];
  const out: Example[] = [];
  for (const item of raw) {
    if (out.length >= MAX_EXAMPLES) break;
    if (typeof item !== "object" || item === null) continue;
    const e = item as Record<string, unknown>;
    if (typeof e.input !== "string" || typeof e.expectedOutput !== "string") continue;
    if (e.input.length > MAX_EXAMPLE_FIELD_LEN || e.expectedOutput.length > MAX_EXAMPLE_FIELD_LEN) continue;
    out.push({ input: e.input, expectedOutput: e.expectedOutput });
  }
  return out;
}

function sseEncode(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function POST(req: NextRequest) {
  // Reject unauthenticated AND inactive (pending_approval / deactivated / left)
  // accounts before any paid LLM work or Python execution (P2-C1).
  const auth = await requireAuthApi();
  if (auth.error) return auth.error;
  const session = auth.session;

  if (!process.env.OPENROUTER_API_KEY?.trim()) {
    return new Response(JSON.stringify({ error: "OPENROUTER_API_KEY is not configured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Rate limit this expensive endpoint per user (falls back to IP).
  const rlKey = session.userId || getClientIP(req);
  const rl = await cpPrepLimiter.check(rlKey);
  if (!rl.allowed) {
    return new Response(
      JSON.stringify({ error: "Rate limit exceeded. Try again later." }),
      {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": String(Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000))),
        },
      },
    );
  }

  // Reject oversized bodies up front when the client declares Content-Length.
  const declaredLen = Number(req.headers.get("content-length") || 0);
  if (declaredLen > MAX_BODY_BYTES) {
    return new Response(JSON.stringify({ error: "Request body too large" }), {
      status: 413,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body: unknown;
  try {
    const text = await req.text();
    if (text.length > MAX_BODY_BYTES) {
      return new Response(JSON.stringify({ error: "Request body too large" }), {
        status: 413,
        headers: { "Content-Type": "application/json" },
      });
    }
    body = JSON.parse(text);
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!isValid(body)) {
    return new Response(
      JSON.stringify({
        error:
          "Missing or invalid fields. Required: title, problemStatement (non-empty strings). Optional: referenceSolution, referenceLanguage.",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const encoder = new TextEncoder();
  let keepaliveTimer: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(sseEncode(event, data)));
        } catch {
          // Controller already closed (client disconnected) — stop emitting.
          closed = true;
        }
      };

      keepaliveTimer = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": keepalive\n\n"));
        } catch {
          /* stream closed */
        }
      }, KEEPALIVE_MS);

      const onProgress = (event: PrepProgressEvent) => {
        send(event.type, { message: event.message });
      };

      try {
        send("status", { message: "Preparing input…" });

        const providedExamples = sanitizeExamples(body.examples);
        const inputExamples =
          providedExamples.length > 0
            ? providedExamples
            : extractExamplesFromStatement(body.problemStatement);

        if (inputExamples.length > 0) {
          send("status", {
            message: `Found ${inputExamples.length} example${inputExamples.length === 1 ? "" : "s"} in raw input (hints for Claude).`,
          });
        } else {
          send("status", {
            message: "No examples in raw input — will verify using examples from Claude's generated statement.",
          });
        }

        const prepInput: PrepInput = {
          title: body.title.trim(),
          problemStatement: body.problemStatement.trim(),
          referenceSolution: body.referenceSolution?.trim() || undefined,
          referenceLanguage: body.referenceLanguage?.trim() || undefined,
          examples: inputExamples,
        };

        const problemTitle = prepInput.title;

        const result = await prepProblem(prepInput, {
          signal: req.signal,
          onProgress,
          onUsage: (usage) => {
            void recordLlmUsage({
              model: usage.model,
              purpose: "cp_prep",
              promptTokens: usage.promptTokens,
              completionTokens: usage.completionTokens,
              totalTokens: usage.totalTokens,
              costUsd: usage.estimatedCostUsd,
              userId: session.userId,
              problemName: problemTitle,
              stepId: "cp_prep",
            });
          },
        });
        send("done", result);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        send("error", { message });
      } finally {
        if (keepaliveTimer) clearInterval(keepaliveTimer);
        controller.close();
      }
    },
    cancel() {
      if (keepaliveTimer) clearInterval(keepaliveTimer);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}