/**
 * Internal endpoint for the Python pipeline scripts to record LLM usage.
 *
 * Authentication: shared `X-Internal-Secret` header that must equal CRON_SECRET.
 * The Python process gets this secret via the env var `INTERNAL_API_SECRET`,
 * which is set by `src/app/api/pipeline/run/route.ts` when it spawns python.
 *
 * Body: a single llm_usage row (camelCase or snake_case keys both accepted).
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { llmUsage } from "@/lib/db/schema";
import { getOpenRouterKeyChoice } from "@/lib/openrouter-key";
import { accountForKeyFingerprint } from "@/lib/openrouter";
import { timingSafeEqual } from "crypto";

function safeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Server not configured." }, { status: 500 });
  }
  const provided = request.headers.get("x-internal-secret") ?? "";
  if (!safeEqualStr(provided, secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const get = (a: string, b?: string) => body[a] ?? (b ? body[b] : undefined);

  const safeStr = (v: unknown, fallback: string, max = 200): string => {
    if (typeof v !== "string") return fallback;
    return v.length > max ? v.slice(0, max) : v;
  };
  const optStr = (v: unknown, max = 200): string | null => {
    if (typeof v !== "string" || !v) return null;
    return v.length > max ? v.slice(0, max) : v;
  };
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const optUuid = (v: unknown): string | null => {
    // The run_id column is a uuid; reject anything that isn't one so a bad value
    // can't make the whole usage insert fail.
    return typeof v === "string" && UUID_RE.test(v) ? v : null;
  };
  const safeInt = (v: unknown): number => {
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.min(Math.floor(n), 10_000_000);
  };
  const safeCost = (v: unknown): string => {
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n) || n < 0) return "0";
    return Math.min(n, 1_000_000).toFixed(6);
  };

  const promptTokens = safeInt(get("promptTokens", "prompt_tokens"));
  const completionTokens = safeInt(get("completionTokens", "completion_tokens"));
  const explicitTotal = get("totalTokens", "total_tokens");
  const totalTokens =
    explicitTotal === undefined ? promptTokens + completionTokens : safeInt(explicitTotal);

  // Attribute to the key that was actually billed. The pipeline sends a digest
  // of the key it used; only when that is absent or unrecognised do we fall back
  // to the toggle, which is what silently mislabelled ~$37 of August spend.
  const account =
    accountForKeyFingerprint(optStr(get("keyFp", "key_fp"), 32)) ??
    (await getOpenRouterKeyChoice());

  // The caller generates the row id, so a retry of a request whose response was
  // lost re-sends the same id and is discarded rather than double-billed.
  const id = optUuid(get("id"));
  const createdAtRaw = get("createdAt", "created_at");
  const createdAt =
    typeof createdAtRaw === "string" && !Number.isNaN(Date.parse(createdAtRaw))
      ? new Date(createdAtRaw)
      : undefined;

  try {
    await db
      .insert(llmUsage)
      .values({
        ...(id ? { id } : {}),
        ...(createdAt ? { createdAt } : {}),
        account,
        model: safeStr(get("model"), "unknown", 100),
        purpose: safeStr(get("purpose"), "unknown", 100),
        promptTokens,
        completionTokens,
        totalTokens,
        costUsd: safeCost(get("costUsd", "cost_usd")),
        problemId: optStr(get("problemId", "problem_id"), 64),
        userId: optStr(get("userId", "user_id"), 64),
        problemName: optStr(get("problemName", "problem_name"), 200),
        stepId: optStr(get("stepId", "step_id"), 100),
        runId: optUuid(get("runId", "run_id")),
      })
      .onConflictDoNothing({ target: llmUsage.id });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[internal/llm-usage] insert failed:", err);
    return NextResponse.json({ error: "insert failed" }, { status: 500 });
  }
}
