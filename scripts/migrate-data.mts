/**
 * Phase 6 — Data migration: Supabase → Replit Postgres.
 *
 * Source: Supabase REST + Auth Admin APIs (the direct Postgres host is no longer
 *         reachable from this environment, only the pooler/REST is).
 * Target: Replit Postgres via Drizzle (src/lib/db).
 *
 * Strategy:
 *   - Idempotent: every insert is ON CONFLICT (id) DO NOTHING.
 *   - Users: imported with password_hash=NULL and password_reset_required=true.
 *     Every existing Supabase user must complete password reset on first login.
 *   - Skipped: rate_limits (transient), auth_audit_log (historical, not load-bearing),
 *     sessions / password_reset_tokens (don't exist on the Supabase side).
 *
 * Run: npx tsx scripts/migrate-data.mts
 *      npx tsx scripts/migrate-data.mts --dry-run   (counts only, no writes)
 */
import { db } from "@/lib/db";
import {
  users,
  profiles,
  problems,
  pipelineRuns,
  pipelineStates,
  pipelineLogs,
  llmUsage,
} from "@/lib/db/schema";
import { sql } from "drizzle-orm";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const DRY_RUN = process.argv.includes("--dry-run");

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const H = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };

async function fetchAllRest<T = Record<string, unknown>>(table: string, orderCol = "created_at"): Promise<T[]> {
  const PAGE = 1000;
  const out: T[] = [];
  let from = 0;
  for (;;) {
    const to = from + PAGE - 1;
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=*&order=${orderCol}.asc.nullsfirst`, {
      headers: { ...H, Range: `${from}-${to}`, "Range-Unit": "items" },
    });
    if (!r.ok) {
      throw new Error(`REST GET ${table} ${from}-${to} -> ${r.status}: ${await r.text()}`);
    }
    const batch = (await r.json()) as T[];
    out.push(...batch);
    if (batch.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

async function fetchAllAuthUsers(): Promise<
  Array<{ id: string; email: string | null; email_confirmed_at: string | null; created_at: string }>
> {
  const out: Array<{ id: string; email: string | null; email_confirmed_at: string | null; created_at: string }> = [];
  let page = 1;
  for (;;) {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=200&page=${page}`, { headers: H });
    if (!r.ok) throw new Error(`auth admin users page ${page} -> ${r.status}: ${await r.text()}`);
    const j = (await r.json()) as { users?: typeof out };
    const batch = j.users ?? [];
    out.push(...batch);
    if (batch.length < 200) break;
    page += 1;
  }
  return out;
}

function ts(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function migrate() {
  console.log(`mode: ${DRY_RUN ? "DRY-RUN" : "WRITE"}\n`);

  // --- 1. users (synthesised from auth.users) ---
  console.log("→ Fetching auth.users …");
  const authUsers = await fetchAllAuthUsers();
  console.log(`  source: ${authUsers.length} auth users`);

  const userRows = authUsers
    .filter((u) => u.email)
    .map((u) => ({
      id: u.id,
      email: u.email!.toLowerCase(),
      passwordHash: null as string | null,
      emailVerifiedAt: ts(u.email_confirmed_at),
      passwordResetRequired: true,
      createdAt: ts(u.created_at) ?? new Date(),
      updatedAt: new Date(),
    }));

  if (!DRY_RUN && userRows.length > 0) {
    await db.insert(users).values(userRows).onConflictDoNothing({ target: users.id });
  }
  console.log(`  inserted (or skipped): ${userRows.length} users\n`);

  // --- 2. profiles ---
  console.log("→ Fetching profiles …");
  const supProfiles = await fetchAllRest<{
    id: string; email: string; display_name: string | null; role: string; status: string;
    created_at: string | null; updated_at: string | null;
  }>("profiles");
  console.log(`  source: ${supProfiles.length} profiles`);

  const validUserIds = new Set(userRows.map((u) => u.id));
  const profileRows = supProfiles
    .filter((p) => validUserIds.has(p.id))
    .map((p) => ({
      id: p.id,
      email: p.email.toLowerCase(),
      displayName: p.display_name,
      role: p.role,
      status: p.status,
      createdAt: ts(p.created_at) ?? new Date(),
      updatedAt: ts(p.updated_at) ?? new Date(),
    }));

  if (!DRY_RUN && profileRows.length > 0) {
    await db.insert(profiles).values(profileRows).onConflictDoNothing({ target: profiles.id });
  }
  console.log(`  inserted (or skipped): ${profileRows.length} profiles`);
  if (supProfiles.length !== profileRows.length) {
    console.log(`  WARN: ${supProfiles.length - profileRows.length} profiles dropped (no matching user)`);
  }
  console.log();

  // --- 3. problems ---
  console.log("→ Fetching problems …");
  const supProblems = await fetchAllRest<{
    id: string; created_by: string; name: string; question_type: string; mode: string;
    scenario_level: string; languages: string[] | null; status: string; storage_path: string | null;
    created_at: string | null; updated_at: string | null;
    deletion_reason: string | null; deleted_at: string | null;
  }>("problems");
  console.log(`  source: ${supProblems.length} problems`);

  const validProfileIds = new Set(profileRows.map((p) => p.id));
  const problemRows = supProblems
    .filter((p) => validProfileIds.has(p.created_by))
    .map((p) => ({
      id: p.id,
      createdBy: p.created_by,
      name: p.name,
      questionType: p.question_type,
      mode: p.mode,
      scenarioLevel: p.scenario_level ?? "none",
      languages: p.languages ?? [],
      status: p.status,
      storagePath: p.storage_path,
      createdAt: ts(p.created_at) ?? new Date(),
      updatedAt: ts(p.updated_at) ?? new Date(),
      deletionReason: p.deletion_reason,
      deletedAt: ts(p.deleted_at),
    }));

  if (!DRY_RUN && problemRows.length > 0) {
    await db.insert(problems).values(problemRows).onConflictDoNothing({ target: problems.id });
  }
  console.log(`  inserted (or skipped): ${problemRows.length} problems`);
  if (supProblems.length !== problemRows.length) {
    console.log(`  WARN: ${supProblems.length - problemRows.length} problems dropped (no creator)`);
  }
  console.log();

  // --- 4. pipeline_states ---
  console.log("→ Fetching pipeline_states …");
  const supStates = await fetchAllRest<{
    id: string; problem_id: string; user_id: string; question_type: string; mode: string;
    enabled_languages: string[] | null; testcase_count: number | null;
    step_configs: unknown; step_statuses: unknown;
    created_at: string | null; updated_at: string | null;
  }>("pipeline_states");
  const validProblemIds = new Set(problemRows.map((p) => p.id));
  const stateRows = supStates
    .filter((s) => validProblemIds.has(s.problem_id) && validProfileIds.has(s.user_id))
    .map((s) => ({
      id: s.id,
      problemId: s.problem_id,
      userId: s.user_id,
      questionType: s.question_type ?? "function",
      mode: s.mode ?? "practice",
      enabledLanguages: s.enabled_languages ?? ["Python", "C++", "Java", "Node.js"],
      testcaseCount: s.testcase_count ?? 48,
      stepConfigs: (s.step_configs ?? {}) as Record<string, unknown>,
      stepStatuses: (s.step_statuses ?? {}) as Record<string, unknown>,
      createdAt: ts(s.created_at) ?? new Date(),
      updatedAt: ts(s.updated_at) ?? new Date(),
    }));

  if (!DRY_RUN && stateRows.length > 0) {
    await db.insert(pipelineStates).values(stateRows).onConflictDoNothing({ target: pipelineStates.id });
  }
  console.log(`  inserted (or skipped): ${stateRows.length} pipeline_states (source=${supStates.length})\n`);

  // --- 5. pipeline_runs ---
  console.log("→ Fetching pipeline_runs …");
  const supRuns = await fetchAllRest<{
    id: string; problem_id: string; user_id: string; step_id: string; status: string;
    exit_code: number | null; started_at: string | null; finished_at: string | null;
    logs_summary: string | null; pid: number | null;
  }>("pipeline_runs", "started_at");
  const ALLOWED_RUN_STATUS = new Set(["running", "completed", "failed"]);
  const runRows = supRuns
    .filter((r) => validProblemIds.has(r.problem_id) && validProfileIds.has(r.user_id))
    .map((r) => ({
      id: r.id,
      problemId: r.problem_id,
      userId: r.user_id,
      stepId: r.step_id,
      // Coerce any unexpected statuses to 'failed' so the check constraint holds.
      status: ALLOWED_RUN_STATUS.has(r.status) ? r.status : "failed",
      exitCode: r.exit_code,
      startedAt: ts(r.started_at) ?? new Date(),
      finishedAt: ts(r.finished_at),
      logsSummary: r.logs_summary,
      pid: r.pid,
    }));

  if (!DRY_RUN && runRows.length > 0) {
    // Insert in chunks of 500 to keep parameter count safe.
    for (let i = 0; i < runRows.length; i += 500) {
      const chunk = runRows.slice(i, i + 500);
      await db.insert(pipelineRuns).values(chunk).onConflictDoNothing({ target: pipelineRuns.id });
    }
  }
  console.log(`  inserted (or skipped): ${runRows.length} pipeline_runs (source=${supRuns.length})\n`);

  // --- 6. pipeline_logs ---
  console.log("→ Fetching pipeline_logs …");
  const supLogs = await fetchAllRest<{
    id: string; problem_id: string | null; step_id: string; run_id: string | null;
    content: string; created_at: string | null;
  }>("pipeline_logs");
  const validRunIds = new Set(runRows.map((r) => r.id));
  const logRows = supLogs
    .filter((l) => (l.problem_id ? validProblemIds.has(l.problem_id) : true))
    .filter((l) => (l.run_id ? validRunIds.has(l.run_id) : true))
    .map((l) => ({
      id: l.id,
      problemId: l.problem_id,
      stepId: l.step_id,
      runId: l.run_id,
      content: l.content,
      createdAt: ts(l.created_at) ?? new Date(),
    }));

  if (!DRY_RUN && logRows.length > 0) {
    for (let i = 0; i < logRows.length; i += 200) {
      const chunk = logRows.slice(i, i + 200);
      await db.insert(pipelineLogs).values(chunk).onConflictDoNothing({ target: pipelineLogs.id });
    }
  }
  console.log(`  inserted (or skipped): ${logRows.length} pipeline_logs (source=${supLogs.length})\n`);

  // --- 7. llm_usage ---
  console.log("→ Fetching llm_usage …");
  const supLlm = await fetchAllRest<{
    id: string; problem_id: string | null; user_id: string | null; model: string; purpose: string;
    prompt_tokens: number; completion_tokens: number; total_tokens: number;
    cost_usd: string | number; problem_name: string | null;
    created_at: string | null; step_id: string | null;
  }>("llm_usage");
  const llmRows = supLlm.map((l) => ({
    id: l.id,
    problemId: l.problem_id && validProblemIds.has(l.problem_id) ? l.problem_id : null,
    userId: l.user_id && validProfileIds.has(l.user_id) ? l.user_id : null,
    model: l.model,
    purpose: l.purpose,
    promptTokens: l.prompt_tokens ?? 0,
    completionTokens: l.completion_tokens ?? 0,
    totalTokens: l.total_tokens ?? 0,
    costUsd: String(l.cost_usd ?? 0),
    problemName: l.problem_name,
    createdAt: ts(l.created_at) ?? new Date(),
    stepId: l.step_id,
  }));

  if (!DRY_RUN && llmRows.length > 0) {
    for (let i = 0; i < llmRows.length; i += 500) {
      const chunk = llmRows.slice(i, i + 500);
      await db.insert(llmUsage).values(chunk).onConflictDoNothing({ target: llmUsage.id });
    }
  }
  console.log(`  inserted (or skipped): ${llmRows.length} llm_usage (source=${supLlm.length})\n`);

  // --- final tally from Replit DB ---
  if (!DRY_RUN) {
    console.log("→ Replit row counts after migration:");
    const tables = ["users", "profiles", "problems", "pipeline_states", "pipeline_runs", "pipeline_logs", "llm_usage"];
    for (const t of tables) {
      const r = await db.execute(sql.raw(`SELECT count(*)::int AS n FROM "${t}"`));
      // postgres-js returns rows directly; drizzle wraps differently — handle both.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const n = (r as any).rows?.[0]?.n ?? (r as any)[0]?.n;
      console.log(`  ${t} = ${n}`);
    }
  }
}

migrate()
  .then(() => {
    console.log("\nDone.");
    process.exit(0);
  })
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
