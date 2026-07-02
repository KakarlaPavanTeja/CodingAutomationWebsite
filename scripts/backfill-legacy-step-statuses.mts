/**
 * One-time backfill for legacy pipeline_states records.
 *
 * Problem: steps like `generate_wrong_solutions` and `benchmark_testcases` were
 * inserted into the workflow AHEAD of `package_platform` after some questions
 * were already in progress. Those older records have no saved status for the new
 * steps, so on load they default to "pending" (src/lib/pipeline-context.tsx) and
 * permanently block `package_platform` (and everything downstream) — the Run
 * button stays disabled. See src/lib/pipeline-prerequisites.ts.
 *
 * Fix (gate logic unchanged): for any workflow step that is ABSENT from a
 * record's step_statuses, if ANY LATER workflow step is already "completed",
 * mark the absent step "completed". This mirrors the existing legacy-reconcile
 * heuristic ("downstream progress implies prerequisites were met") and only ever
 * fabricates completion for steps a finished-further pipeline must have passed.
 * Records that are genuinely early (no later step completed) are left untouched
 * and stay correctly blocked on their real pending work.
 *
 * Reads DATABASE_URL from `.env.local` (gitignored).
 *
 * Usage:
 *   npx tsx scripts/backfill-legacy-step-statuses.mts            # dry run (default)
 *   npx tsx scripts/backfill-legacy-step-statuses.mts --apply    # write changes
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import postgres from "postgres";

const envPath = resolve(process.cwd(), ".env.local");
if (existsSync(envPath)) loadEnv({ path: envPath, quiet: true });

/** Steps that never gate downstream work — no need to backfill them. */
const NON_BLOCKING = new Set<string>(["harden_testcases"]);

/**
 * Linear workflow order — must stay in sync with getWorkflowSteps() in
 * src/lib/pipeline-config.ts.
 */
function getWorkflowSteps(questionType: string, mode: string): string[] {
  const core = [
    "generate_question",
    "generate_testcases",
    "generate_wrong_solutions",
    "benchmark_testcases",
    "harden_testcases",
  ];

  if (questionType === "nonfunction") {
    const steps = [...core, "execute_tests_nonfunction"];
    if (mode === "practice") steps.push("generate_enrichment");
    steps.push("package_platform", "generate_editorial", "prepare_platform_json", "execute_editorial");
    return steps;
  }

  const steps = [...core, "split_code", "execute_tests_function"];
  if (mode === "practice") steps.push("generate_enrichment");
  steps.push("package_platform", "generate_editorial", "prepare_platform_json", "execute_editorial");
  return steps;
}

type StatusEntry = { status?: string; exitCode?: number | null; startTime?: number | null; endTime?: number | null };
type StepStatuses = Record<string, StatusEntry>;

/** Returns the list of step ids to backfill, or [] if the record needs no change. */
function planBackfill(
  questionType: string,
  mode: string,
  statuses: StepStatuses,
): string[] {
  const workflow = getWorkflowSteps(questionType, mode);
  const isCompleted = (id: string) => statuses[id]?.status === "completed";
  const isAbsent = (id: string) => !(id in statuses);

  const toFill: string[] = [];
  for (let i = 0; i < workflow.length; i++) {
    const step = workflow[i];
    if (step === "generate_question") continue; // tracked via sub-steps, never touch
    if (NON_BLOCKING.has(step)) continue;
    if (!isAbsent(step)) continue;

    const laterCompleted = workflow.slice(i + 1).some(isCompleted);
    if (laterCompleted) toFill.push(step);
  }
  return toFill;
}

function maskUrl(url: string): string {
  try {
    const u = new URL(url);
    return `host=${u.hostname} db=${u.pathname.replace(/^\//, "")} user=${u.username || "?"}`;
  } catch {
    return "(unparseable url)";
  }
}

function connect(url: string) {
  let isLocal = false;
  try {
    const host = new URL(url).hostname;
    isLocal = ["localhost", "127.0.0.1", "::1"].includes(host);
  } catch {
    /* fall through */
  }
  return postgres(url, {
    max: 1,
    idle_timeout: 5,
    connect_timeout: 10,
    prepare: false,
    ssl: isLocal ? false : "require",
    connection: { application_name: "backfill-legacy-step-statuses", statement_timeout: 20000 },
    onnotice: () => {},
  });
}

async function main() {
  const apply = process.argv.includes("--apply");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set. Add it to .env.local.");

  const sql = connect(url);
  try {
    console.log(`Connected: ${maskUrl(url)}`);
    console.log(apply ? "Mode: APPLY (will write changes)\n" : "Mode: DRY RUN (no changes) — pass --apply to write\n");

    const rows = await sql<
      { problem_id: string; question_type: string; mode: string; step_statuses: StepStatuses | null }[]
    >`select problem_id, question_type, mode, step_statuses from pipeline_states`;

    let changed = 0;
    for (const row of rows) {
      const statuses: StepStatuses = { ...(row.step_statuses ?? {}) };
      const toFill = planBackfill(row.question_type, row.mode, statuses);
      if (toFill.length === 0) continue;

      changed++;
      console.log(
        `${row.problem_id.slice(0, 8)}  ${row.question_type}/${row.mode}  +[${toFill.join(", ")}]`,
      );

      if (apply) {
        for (const step of toFill) {
          statuses[step] = { status: "completed", exitCode: 0, startTime: null, endTime: null };
        }
        // Leave updated_at untouched so this migration doesn't reshuffle "recent" ordering.
        await sql`update pipeline_states set step_statuses = ${sql.json(statuses)} where problem_id = ${row.problem_id}`;
      }
    }

    console.log(`\n${changed} record(s) ${apply ? "updated" : "would be updated"} (of ${rows.length} scanned).`);
    if (!apply && changed > 0) console.log("Re-run with --apply to write these changes.");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error(`\nError: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
