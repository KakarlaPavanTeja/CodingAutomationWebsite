/**
 * Move oversized pipeline_logs.content into object storage.
 *
 * pipeline_logs is rewritten in full every PIPELINE_LOG_SYNC_MS while a step
 * runs, so a long run leaves tens of MB of TOASTed text in a single row.
 * syncLogToDb() now caps what it writes, but rows written before that cap still
 * hold the whole log, and those are what fill the database disk.
 *
 * Per row, largest first:
 *   1. Upload the content to the same keys uploadLog() uses — only when the
 *      object is missing, so a real archive is never overwritten.
 *   2. Confirm the stored object is at least as large as the content.
 *   3. Delete the row. getLogContent() reads these logs from storage now; the
 *      DB rows are what is left of the old scheme.
 *
 * A row is deleted only after step 2 passes. Anything else is reported and left
 * exactly as it was.
 *
 * Deleting rather than trimming is deliberate: an UPDATE writes a new version
 * of a multi-MB TOASTed value before anything can be reclaimed, which is the
 * wrong direction on a disk that is already full.
 *
 * Reading a row pulls its whole content into memory on both ends, and a 60 MB
 * value is enough to take down a small instance — one did crash mid-migration
 * here. So work in small batches, oldest-largest first, pausing between rows:
 * --limit bounds the batch, --max-mb skips rows too big for the headroom you
 * have, --pause-ms gives the server room to breathe between reads.
 *
 * Usage:
 *   npx tsx scripts/archive-pipeline-logs.mts                     # dry run
 *   npx tsx scripts/archive-pipeline-logs.mts --apply --limit 5    # gentle batch
 *   npx tsx scripts/archive-pipeline-logs.mts --apply --limit 1 --max-mb 10
 *   npx tsx scripts/archive-pipeline-logs.mts --apply --pause-ms 5000
 *
 * Safe to re-run: a row is deleted only after its archive is verified, so an
 * interrupted run leaves everything it had not finished exactly as it was.
 *
 * Postgres only returns the freed space to the disk after a rewrite:
 *   VACUUM FULL pipeline_logs;
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import postgres from "postgres";

const envPath = resolve(process.cwd(), ".env.local");
if (existsSync(envPath)) loadEnv({ path: envPath, quiet: true });

// Imported after loadEnv: object-storage picks its backend from env at module scope.
const { putObject, listObjects } = await import("../src/lib/object-storage");

function numArg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const n = Number(process.argv[i + 1]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const APPLY = process.argv.includes("--apply");
const MIN_BYTES = Math.round(numArg("min-mb", 1) * 1048576);
const MAX_BYTES = Math.round(numArg("max-mb", Number.MAX_SAFE_INTEGER / 1048576) * 1048576);
const LIMIT = numArg("limit", 10_000);
const PAUSE_MS = numArg("pause-ms", 1500);

const pause = () => new Promise((r) => setTimeout(r, PAUSE_MS));

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL is not set");

const sql = postgres(DATABASE_URL, { max: 1, connect_timeout: 60, prepare: false });

/** Sizes of everything already under `<problemId>/logs/`, fetched once per problem. */
const logIndex = new Map<string, Map<string, number>>();
async function storedSizes(problemId: string): Promise<Map<string, number>> {
  const cached = logIndex.get(problemId);
  if (cached) return cached;
  const sizes = new Map<string, number>();
  try {
    for (const o of await listObjects(`${problemId}/logs/`)) sizes.set(o.name, o.size);
  } catch {
    // Treated as "nothing archived yet" — every key then fails verification
    // below rather than trimming a row whose log is not safely stored.
  }
  logIndex.set(problemId, sizes);
  return sizes;
}

async function ensureArchived(problemId: string, key: string, content: string): Promise<boolean> {
  const expected = Buffer.byteLength(content, "utf8");
  const sizes = await storedSizes(problemId);
  const existing = sizes.get(key);
  if (existing !== undefined) return existing >= expected;
  if (!APPLY) return true; // dry run reports the intent; it uploads nothing

  await putObject(key, content);
  logIndex.delete(problemId);
  const after = (await storedSizes(problemId)).get(key);
  return after !== undefined && after >= expected;
}

const mb = (n: number) => (n / 1048576).toFixed(1).padStart(6);

let done = 0;
let skipped = 0;
let freed = 0;

try {
  if (APPLY) {
    // The database carries default_transaction_read_only = on. It is a
    // per-session GUC, so clearing it here affects only this connection and
    // leaves the database default in place for everyone else.
    await sql`set default_transaction_read_only = off`;
  }

  const targets = await sql<
    { id: string; problem_id: string | null; step_id: string; run_id: string | null; len: number }[]
  >`
    select id, problem_id, step_id, run_id, length(content) as len
    from pipeline_logs
    where length(content) > ${MIN_BYTES} and length(content) <= ${MAX_BYTES}
    order by length(content) desc
    limit ${LIMIT}`;

  console.log(
    `${targets.length} row(s) between ${(MIN_BYTES / 1048576).toFixed(1)} MB and ` +
      `${MAX_BYTES >= Number.MAX_SAFE_INTEGER ? "∞" : (MAX_BYTES / 1048576).toFixed(1)} MB` +
      (APPLY ? `, ${PAUSE_MS}ms between rows` : "   [DRY RUN — nothing uploaded or modified]") +
      "\n",
  );

  for (const row of targets) {
    if (!row.problem_id) {
      // Checked before the content is read: no point pulling tens of MB for a
      // row that cannot be archived anywhere.
      console.log(`SKIP  ${mb(row.len)} MB  ${row.step_id} — no problem_id, nowhere to archive it`);
      skipped++;
      continue;
    }

    // One row at a time: reading these values is what pressures a small instance.
    const [{ content }] = await sql<{ content: string }[]>`
      select content from pipeline_logs where id = ${row.id}`;

    const keys = [`${row.problem_id}/logs/${row.step_id}.log`];
    if (row.run_id) keys.push(`${row.problem_id}/logs/runs/${row.step_id}/${row.run_id}.log`);

    let ok = true;
    for (const key of keys) {
      if (!(await ensureArchived(row.problem_id, key, content))) ok = false;
    }
    if (!ok) {
      console.log(`FAIL  ${mb(row.len)} MB  ${row.step_id} — archive unverified, row left intact`);
      skipped++;
      continue;
    }

    if (APPLY) {
      await sql`delete from pipeline_logs where id = ${row.id}`;
    }
    done++;
    freed += row.len;
    console.log(`${APPLY ? "DONE " : "WOULD"} ${mb(row.len)} MB  ${row.step_id} → ${keys[0]}`);
    if (APPLY) await pause();
  }

  console.log(
    `\n${APPLY ? "archived" : "would archive"} ${done} row(s), ${skipped} skipped, ` +
      `${(freed / 1048576).toFixed(0)} MB of content out of Postgres`,
  );
  if (APPLY && done > 0) console.log("Now run:  VACUUM FULL pipeline_logs;");
} finally {
  await sql.end();
}
