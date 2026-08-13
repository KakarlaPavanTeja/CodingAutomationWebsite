/**
 * Ad-hoc, read-only query tool for the Postgres DB.
 *
 * Reads DATABASE_URL from `.env.local` (gitignored).
 *
 * Usage:
 *   npx tsx scripts/db.mts --list
 *   npx tsx scripts/db.mts --tables
 *   npx tsx scripts/db.mts --problem 6ab80b66
 *   npx tsx scripts/db.mts --sql "select id, name, status from problems order by created_at desc limit 10"
 *
 * Safety: queries run inside a READ ONLY transaction. Pass --allow-write to disable
 * (you almost never should against a shared database).
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import postgres from "postgres";

const envPath = resolve(process.cwd(), ".env.local");
if (existsSync(envPath)) loadEnv({ path: envPath, quiet: true });

const WRITE_KEYWORDS = new Set([
  "insert", "update", "delete", "drop", "alter", "truncate", "create",
  "grant", "revoke", "comment", "merge", "copy", "do", "call", "vacuum",
  "reindex", "cluster", "lock", "set",
]);

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const short: Record<string, string> = {
    q: "sql", p: "problem", l: "list", t: "tables", h: "help",
  };
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    let key: string | null = null;
    if (a.startsWith("--")) key = a.slice(2);
    else if (a.startsWith("-") && a.length === 2) key = short[a[1]] ?? a[1];
    if (!key) continue;
    const next = argv[i + 1];
    const isFlag = next === undefined || (next.startsWith("--")) ||
      (next.startsWith("-") && next.length === 2 && !/^-\d/.test(next));
    if (isFlag) {
      out[key] = true;
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
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
    connection: { application_name: "cursor-db-tool", statement_timeout: 20000 },
    onnotice: () => {},
  });
}

function assertReadOnly(query: string) {
  for (const stmt of query.split(";")) {
    const first = stmt.trim().replace(/^\(+/, "").split(/\s+/)[0]?.toLowerCase();
    if (first && WRITE_KEYWORDS.has(first)) {
      throw new Error(
        `Refusing to run a write/DDL statement ("${first}") without --allow-write.`,
      );
    }
  }
}

function printRows(label: string, rows: readonly unknown[], limit: number) {
  const shown = rows.slice(0, limit);
  console.log(`\n=== ${label} (${rows.length} row${rows.length === 1 ? "" : "s"}${rows.length > limit ? `, showing ${limit}` : ""}) ===`);
  if (rows.length === 0) {
    console.log("(none)");
    return;
  }
  console.log(JSON.stringify(shown, null, 2));
}

async function runProblemBundle(sql: postgres.Sql, idArg: string, limit: number) {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idArg);
  const matchClause = isUuid ? sql`id = ${idArg}` : sql`id::text like ${idArg + "%"}`;
  const problems = await sql`select * from problems where ${matchClause}`;
  if (problems.length === 0) {
    console.log(`No problem matched "${idArg}".`);
    return;
  }
  if (problems.length > 1) {
    printRows("problems (ambiguous prefix — refine the id)", problems, limit);
    return;
  }
  const pid = (problems[0] as { id: string }).id;
  printRows("problem", problems, limit);

  printRows("problem_access", await sql`select * from problem_access where problem_id = ${pid}`, limit);
  printRows("pipeline_states", await sql`select * from pipeline_states where problem_id = ${pid}`, limit);
  printRows(
    "pipeline_runs",
    await sql`select id, step_id, status, exit_code, started_at, finished_at, pid, logs_summary
              from pipeline_runs where problem_id = ${pid} order by started_at desc nulls last`,
    limit,
  );
  // No pipeline_logs section: logs live in object storage, never in Postgres.
  // Read them at {problemId}/logs/{stepId}.log — see docs/postgres-operations.md.
  printRows(
    "llm_usage_summary",
    await sql`select purpose, step_id, model,
                     count(*) as calls,
                     sum(prompt_tokens) as prompt_tokens,
                     sum(completion_tokens) as completion_tokens,
                     sum(total_tokens) as total_tokens,
                     round(sum(cost_usd), 4) as cost_usd
              from llm_usage where problem_id = ${pid}
              group by purpose, step_id, model order by cost_usd desc nulls last`,
    100,
  );
  printRows(
    "llm_usage_total",
    await sql`select count(*) as calls, sum(total_tokens) as total_tokens, round(sum(cost_usd), 4) as cost_usd
              from llm_usage where problem_id = ${pid}`,
    1,
  );
}

function printHelp() {
  console.log(`db.mts — read-only Postgres query tool

Flags:
  --problem, -p <uuid|prefix>  dump a problem + its runs/state/usage
  --sql, -q "<query>"          run an arbitrary SELECT (read-only tx)
  --tables, -t                 list tables in the public schema
  --list, -l                   show whether DATABASE_URL is configured
  --limit <n>                  max rows to print per result (default 100)
  --allow-write                disable the read-only guard (dangerous)
  --help, -h                   this help

Examples:
  npx tsx scripts/db.mts --list
  npx tsx scripts/db.mts -p 6ab80b66
  npx tsx scripts/db.mts -q "select id, name, status from problems limit 20"`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    return;
  }

  const url = process.env.DATABASE_URL;

  if (args.list || (!args.sql && !args.problem && !args.tables)) {
    console.log("Configured database (from .env.local):");
    console.log(`  DATABASE_URL  ${url ? maskUrl(url) : "(not set)"}`);
    if (!args.list) {
      console.log("\nNothing to do. Pass --help for usage.");
    }
    return;
  }

  if (!url) {
    throw new Error("DATABASE_URL is not set. Add it to .env.local.");
  }

  const limit = args.limit ? Math.max(1, parseInt(String(args.limit), 10) || 100) : 100;
  const sql = connect(url);
  try {
    console.log(`Connected: ${maskUrl(url)}`);

    if (args.tables) {
      const rows = await sql`
        select table_name,
               (select count(*) from information_schema.columns c
                 where c.table_name = t.table_name and c.table_schema = 'public') as columns
        from information_schema.tables t
        where table_schema = 'public' and table_type = 'BASE TABLE'
        order by table_name`;
      printRows("tables", rows, 200);
    }

    if (args.problem) {
      await runProblemBundle(sql, String(args.problem), limit);
    }

    if (args.sql) {
      const query = String(args.sql);
      if (!args["allow-write"]) assertReadOnly(query);
      const rows = await (args["allow-write"]
        ? sql.unsafe(query)
        : sql.begin(async (tx) => {
            await tx.unsafe("set transaction read only");
            return tx.unsafe(query);
          }));
      printRows("query", rows as readonly unknown[], limit);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error(`\nError: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
