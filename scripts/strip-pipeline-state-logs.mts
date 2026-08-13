/**
 * Move per-run log lines out of pipeline_states.step_configs into object storage.
 *
 * The pipeline UI used to persist its whole in-memory run state, so every
 * autosave rewrote `step_configs.languageSubRuns[<lang>].logs` (and the same
 * field under `subStepRuns`) as a multi-MB TOASTed jsonb value. That is the
 * pipeline_logs failure all over again: each rewrite leaves the previous copy
 * dead and amplifies WAL enormously. The app no longer writes these logs —
 * this script clears what earlier versions left behind.
 *
 * Per row, largest first:
 *   1. For every run entry holding log lines, render them back to the stored
 *      `[ISO] line` format and upload to the SAME key the run route uses
 *      (`{problemId}/logs/{stepKey}.log`) — only when that object is missing,
 *      so a complete log written by an actual run is never overwritten by the
 *      truncated tail the UI happened to be holding.
 *   2. Confirm the stored object is at least as large as what we hold.
 *   3. Only then write the row back with every `logs` array emptied.
 *
 * If any key in a row fails verification the whole row is left exactly as it
 * was. Safe to re-run.
 *
 * Unlike pipeline_logs, this table CANNOT be truncated — it holds live config
 * (languages, testcase counts, step statuses, owner title). Stripping is
 * therefore an UPDATE, which writes a new row version before anything can be
 * reclaimed. On a disk that is already full that makes things worse before
 * better, so: check free space first, work in small batches (--limit) with
 * --pause-ms between rows, and use --max-mb to skip rows too big for the
 * headroom you have.
 *
 * Usage:
 *   npx tsx scripts/strip-pipeline-state-logs.mts                       # dry run
 *   npx tsx scripts/strip-pipeline-state-logs.mts --apply --limit 5      # gentle batch
 *   npx tsx scripts/strip-pipeline-state-logs.mts --apply --limit 1 --max-mb 5
 *
 * Postgres only returns the freed space after a rewrite:
 *   VACUUM FULL pipeline_states;
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import postgres from "postgres";

const envPath = resolve(process.cwd(), ".env.local");
if (existsSync(envPath)) loadEnv({ path: envPath, quiet: true });

// Imported after loadEnv: object-storage picks its backend from env at module scope.
const { putObject, listObjects } = await import("../src/lib/object-storage");
const { formatPipelineLogContent } = await import("../src/lib/pipeline-log-parse");

type LogLine = { stream: "stdout" | "stderr"; line: string; ts: number };
type RunState = { logs?: LogLine[] } & Record<string, unknown>;
type StepConfig = {
  subStepRuns?: Record<string, RunState | undefined>;
  languageSubRuns?: Record<string, RunState | undefined>;
} & Record<string, unknown>;

function numArg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const n = Number(process.argv[i + 1]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const APPLY = process.argv.includes("--apply");
// pg_column_size() returns integer, so the "no maximum" sentinel has to stay
// inside int4 — a larger default is rejected outright as out of range.
const NO_MAX_BYTES = 2_147_483_647;
const MIN_BYTES = Math.round(numArg("min-kb", 64) * 1024);
const MAX_BYTES = Math.min(
  NO_MAX_BYTES,
  Math.round(numArg("max-mb", NO_MAX_BYTES / 1048576) * 1048576),
);
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
    // below rather than stripping a row whose log is not safely stored.
  }
  logIndex.set(problemId, sizes);
  return sizes;
}

/**
 * Whether `key` holds at least this much log, uploading it when it does not.
 *
 * A key that already exists is left alone: it was written by the run itself and
 * is the complete log, while what is held here is at best the tail the UI had
 * in memory. An existing object SMALLER than our copy is not trusted — the row
 * is left intact rather than losing lines we still hold.
 *
 * Reported per outcome rather than as a boolean so a dry run distinguishes
 * "already safely in storage" from "this would be a fresh upload" — the two
 * carry very different risk, and collapsing them made the dry run look
 * reassuring about logs that were not actually archived anywhere.
 */
type ArchiveResult = "present" | "would-upload" | "uploaded" | "failed";

async function ensureArchived(
  problemId: string,
  key: string,
  content: string,
): Promise<ArchiveResult> {
  const expected = Buffer.byteLength(content, "utf8");
  const sizes = await storedSizes(problemId);
  const existing = sizes.get(key);
  if (existing !== undefined) return existing >= expected ? "present" : "failed";
  if (!APPLY) return "would-upload"; // dry run uploads nothing

  await putObject(key, content);
  logIndex.delete(problemId);
  const after = (await storedSizes(problemId)).get(key);
  return after !== undefined && after >= expected ? "uploaded" : "failed";
}

/**
 * Every run entry in a step_configs blob that still carries log lines, paired
 * with the object-storage key the run route would have written it to.
 *
 * Key formats mirror pipelineRunLogKey(): `generate_question__<subStep>` for GQ
 * sub-steps (subStepLogKey) and `<stepId>__<lang>` for per-language sub-runs
 * (languageSubStepLogKey) — both are `<stepId>__<name>`.
 */
function collectRunLogs(
  configs: Record<string, StepConfig>,
): { stepKey: string; logs: LogLine[]; run: RunState }[] {
  const found: { stepKey: string; logs: LogLine[]; run: RunState }[] = [];
  for (const [stepId, config] of Object.entries(configs)) {
    if (!config || typeof config !== "object") continue;
    for (const field of ["subStepRuns", "languageSubRuns"] as const) {
      for (const [name, run] of Object.entries(config[field] ?? {})) {
        if (!run || !Array.isArray(run.logs) || run.logs.length === 0) continue;
        found.push({ stepKey: `${stepId}__${name}`, logs: run.logs, run });
      }
    }
  }
  return found;
}

const kb = (n: number) => (n / 1024).toFixed(0).padStart(7);

let done = 0;
let skipped = 0;
let freed = 0;
const totals: Record<ArchiveResult, number> = {
  present: 0,
  "would-upload": 0,
  uploaded: 0,
  failed: 0,
};

try {
  const [sizes] = await sql<{ pretty: string; bytes: string }[]>`
    select pg_size_pretty(pg_database_size(current_database())) as pretty,
           pg_database_size(current_database())::text as bytes`;
  const [{ total }] = await sql<{ total: string }[]>`
    select coalesce(sum(pg_column_size(step_configs)), 0)::text as total from pipeline_states`;
  console.log(
    `database ${sizes.pretty} (${sizes.bytes} bytes) — ` +
      `step_configs ${(Number(total) / 1048576).toFixed(1)} MB\n`,
  );

  if (APPLY) {
    // An UPDATE writes a new row version before the old one can be reclaimed.
    // The 2026-08-12 outages were exactly this on a disk that was already full.
    console.log(
      "NOTE: --apply rewrites rows; space is only returned by VACUUM FULL afterwards.\n" +
        "      Confirm the instance has free disk before continuing — UPDATE on a full\n" +
        "      disk makes things worse, not better.\n",
    );

    // The database carries default_transaction_read_only = on under disk
    // pressure. It is a per-session GUC, so clearing it here affects only this
    // connection and leaves the database default in place for everyone else.
    await sql`set default_transaction_read_only = off`;
  }

  const targets = await sql<{ problem_id: string; len: number }[]>`
    select problem_id, pg_column_size(step_configs) as len
    from pipeline_states
    where pg_column_size(step_configs) > ${MIN_BYTES}
      and pg_column_size(step_configs) <= ${MAX_BYTES}
    order by pg_column_size(step_configs) desc
    limit ${LIMIT}`;

  console.log(
    `${targets.length} row(s) between ${(MIN_BYTES / 1024).toFixed(0)} kB and ` +
      `${MAX_BYTES >= NO_MAX_BYTES ? "∞" : (MAX_BYTES / 1048576).toFixed(1)} MB` +
      (APPLY ? `, ${PAUSE_MS}ms between rows` : "   [DRY RUN — nothing uploaded or modified]") +
      "\n",
  );

  for (const row of targets) {
    // One row at a time: reading these values is what pressures a small instance.
    const [stored] = await sql<{ step_configs: Record<string, StepConfig> }[]>`
      select step_configs from pipeline_states where problem_id = ${row.problem_id}`;
    const configs = stored?.step_configs;
    if (!configs) {
      skipped++;
      continue;
    }

    const entries = collectRunLogs(configs);
    if (entries.length === 0) {
      console.log(`SKIP  ${kb(row.len)} kB  ${row.problem_id} — no log lines held`);
      skipped++;
      continue;
    }

    const tally: Record<ArchiveResult, number> = {
      present: 0,
      "would-upload": 0,
      uploaded: 0,
      failed: 0,
    };
    for (const { stepKey, logs } of entries) {
      const key = `${row.problem_id}/logs/${stepKey}.log`;
      const result = await ensureArchived(row.problem_id, key, formatPipelineLogContent(logs));
      tally[result]++;
      totals[result]++;
    }
    if (tally.failed > 0) {
      console.log(
        `FAIL  ${kb(row.len)} kB  ${row.problem_id} — ${tally.failed} key(s) unverified, row intact`,
      );
      skipped++;
      continue;
    }

    if (APPLY) {
      for (const { run } of entries) run.logs = [];
      await sql`
        update pipeline_states
        set step_configs = ${sql.json(configs)}
        where problem_id = ${row.problem_id}`;
    }
    done++;
    freed += row.len;
    console.log(
      `${APPLY ? "DONE " : "WOULD"} ${kb(row.len)} kB  ${row.problem_id} — ` +
        `${entries.length} run log(s), ${tally.present} already in storage, ` +
        `${APPLY ? tally.uploaded : tally["would-upload"]} ${APPLY ? "uploaded" : "to upload"}`,
    );
    if (APPLY) await pause();
  }

  console.log(
    `\n${APPLY ? "stripped" : "would strip"} ${done} row(s), ${skipped} skipped, ` +
      `${(freed / 1048576).toFixed(0)} MB of step_configs out of Postgres`,
  );
  console.log(
    `run logs: ${totals.present} already in storage, ` +
      `${APPLY ? `${totals.uploaded} uploaded` : `${totals["would-upload"]} would be uploaded`}, ` +
      `${totals.failed} unverified`,
  );
  if (APPLY && done > 0) console.log("Now run:  VACUUM FULL pipeline_states;");
} finally {
  await sql.end();
}
