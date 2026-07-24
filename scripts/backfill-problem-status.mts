/**
 * One-off backfill: re-derive problems.status for every draft/processing problem
 * using the REAL reconcile logic (no reimplementation), so stale rows that were
 * never revisited get their correct status under the new policy
 * (draft = no step ever ran; partial = ran but not packaged; stopped -> failed).
 *
 *   npx tsx scripts/backfill-problem-status.mts          # apply
 *   npx tsx scripts/backfill-problem-status.mts --dry    # preview only
 *
 * Safe to re-run: recompute only writes when the derived status differs.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";

const envPath = resolve(process.cwd(), ".env.local");
if (existsSync(envPath)) loadEnv({ path: envPath, quiet: true });

const dry = process.argv.includes("--dry");

// Import AFTER env is loaded — @/lib/db throws at import if DATABASE_URL is unset.
const { db } = await import("@/lib/db");
const { problems } = await import("@/lib/db/schema");
const { reconcileStalePipelineRuns, recomputeProblemStatus } = await import(
  "@/lib/reconcile-pipeline-runs"
);
const { inArray, eq } = await import("drizzle-orm");

const targets = await db
  .select({ id: problems.id, status: problems.status })
  .from(problems)
  .where(inArray(problems.status, ["draft", "processing"]));

console.log(`${dry ? "[DRY] " : ""}Re-deriving ${targets.length} draft/processing problems...\n`);

const changes: Record<string, number> = {};
let changed = 0;

for (const { id, status: before } of targets) {
  if (!dry) {
    // Close zombie `running` rows (dead PIDs / crashes), then derive final status.
    await reconcileStalePipelineRuns(id);
    await recomputeProblemStatus(id);
  }
  const [after] = await db
    .select({ status: problems.status })
    .from(problems)
    .where(eq(problems.id, id))
    .limit(1);
  if (after && after.status !== before) {
    const key = `${before} -> ${after.status}`;
    changes[key] = (changes[key] ?? 0) + 1;
    changed++;
    console.log(`  ${id.slice(0, 8)}  ${key}`);
  }
}

console.log(`\n${dry ? "[DRY] would change" : "changed"} ${changed}/${targets.length}:`);
for (const [k, n] of Object.entries(changes).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${n.toString().padStart(3)}  ${k}`);
}

process.exit(0);
