/**
 * One-off backfill: attach historical cp_prep LLM spend to the problem it produced.
 *
 * Prep runs before the problem row exists, so its usage rows were written with
 * problem_id NULL and nothing ever linked them — a problem's cost lived in two
 * places, and the prep half was invisible in every per-problem total.
 * `claimCpPrepUsageForProblem` fixes this going forward; this fixes the past.
 *
 * Match: the first problem the same user created within --window of the call.
 * Median gap in August's data is 1.5 minutes, and 91% also match on name, so
 * the heuristic is tight — but it IS a heuristic, hence dry-run by default.
 *
 *   npx tsx scripts/backfill-cp-prep-usage.mts                     # preview
 *   npx tsx scripts/backfill-cp-prep-usage.mts --apply              # write
 *   npx tsx scripts/backfill-cp-prep-usage.mts --since 2026-08-01 --window 6h
 *
 * Safe to re-run: only ever claims rows still NULL, so it cannot move spend off
 * a problem it already attributed.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";

const envPath = resolve(process.cwd(), ".env.local");
if (existsSync(envPath)) loadEnv({ path: envPath, quiet: true });

const argv = process.argv.slice(2);
const apply = argv.includes("--apply");
const argOf = (name: string, fallback: string) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const since = argOf("--since", "2026-08-01");
const windowSpec = argOf("--window", "6h");

if (Number.isNaN(Date.parse(since))) {
  console.error(`--since must be a date, got "${since}"`);
  process.exit(1);
}
if (!/^\d+[hm]$/.test(windowSpec)) {
  console.error(`--window must look like "6h" or "90m", got "${windowSpec}"`);
  process.exit(1);
}

// Import AFTER env is loaded — @/lib/db throws at import if DATABASE_URL is unset.
const { db } = await import("@/lib/db");
const { sql } = await import("drizzle-orm");

const intervalText = windowSpec.replace(/h$/, " hours").replace(/m$/, " minutes");
const interval = sql.raw(`interval '${intervalText}'`);

/** Orphan cp_prep rows paired with the problem they most likely paid for. */
const matched = await db.execute(sql`
  select u.id as usage_id,
         u.cost_usd,
         u.problem_name,
         p.id as problem_id,
         p.name as target_name,
         extract(epoch from (p.created_at - u.created_at)) / 60 as gap_min
  from llm_usage u
  join lateral (
    select p.id, p.name, p.created_at
    from problems p
    where p.created_by = u.user_id
      and p.created_at between u.created_at and u.created_at + ${interval}
    order by p.created_at
    limit 1
  ) p on true
  where u.step_id = 'cp_prep'
    and u.problem_id is null
    and u.created_at >= ${since}::timestamptz
`);

const rows = matched as unknown as Array<{
  usage_id: string;
  cost_usd: string;
  problem_name: string | null;
  problem_id: string;
  target_name: string | null;
  gap_min: string;
}>;

if (rows.length === 0) {
  console.log(`No unattributed cp_prep rows since ${since}. Nothing to do.`);
  process.exit(0);
}

const norm = (s: string | null) => (s ?? "").toLowerCase().replace(/_/g, " ").trim();
const nameAgrees = rows.filter((r) => norm(r.problem_name) === norm(r.target_name)).length;
const cost = rows.reduce((n, r) => n + Number(r.cost_usd || 0), 0);
const targets = new Set(rows.map((r) => r.problem_id));

console.log(`since ${since}, window ${windowSpec}`);
console.log(`  ${rows.length} unattributed cp_prep rows  ->  ${targets.size} problems`);
console.log(`  $${cost.toFixed(2)} of spend to attribute`);
console.log(`  ${nameAgrees}/${rows.length} also agree on problem name`);

const suspicious = rows.filter((r) => Number(r.gap_min) > 60);
if (suspicious.length) {
  console.log(`  ${suspicious.length} rows matched a problem created >1h later — review these:`);
  for (const r of suspicious.slice(0, 10)) {
    console.log(
      `    "${r.problem_name}" -> "${r.target_name}" (+${Number(r.gap_min).toFixed(0)}m, $${r.cost_usd})`
    );
  }
}

if (!apply) {
  console.log("\nDry run. Re-run with --apply to write.");
  process.exit(0);
}

// One statement, re-deriving the same match: no chance of the set drifting
// between the preview above and the write, and still NULL-guarded.
const updated = await db.execute(sql`
  update llm_usage u
  set problem_id = m.problem_id
  from (
    select u2.id as usage_id, p.id as problem_id
    from llm_usage u2
    join lateral (
      select p.id, p.created_at
      from problems p
      where p.created_by = u2.user_id
        and p.created_at between u2.created_at and u2.created_at + ${interval}
      order by p.created_at
      limit 1
    ) p on true
    where u2.step_id = 'cp_prep'
      and u2.problem_id is null
      and u2.created_at >= ${since}::timestamptz
  ) m
  where u.id = m.usage_id
    and u.problem_id is null
  returning u.id
`);

console.log(`\nAttributed ${(updated as unknown as unknown[]).length} rows.`);
process.exit(0);
