/**
 * Import users + profiles into local Postgres (from export-team-users.mts).
 *   npm run import:team-users
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { config as loadEnv } from "dotenv";
import postgres from "postgres";

const USER_TABLES = ["users", "profiles"] as const;

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    const isFlag = next === undefined || next.startsWith("--");
    out[key] = isFlag ? true : next;
    if (!isFlag) i++;
  }
  return out;
}

function isLocalPostgresUrl(url: string): boolean {
  if (/^postgres(ql)?:\/\/\/[^/]/.test(url)) return true;
  try {
    const host = new URL(url).hostname;
    return ["localhost", "127.0.0.1", "::1", ""].includes(host);
  } catch {
    return false;
  }
}

function connectPostgres(url: string) {
  const opts: postgres.Options<Record<string, never>> = { max: 1, prepare: false };
  if (isLocalPostgresUrl(url)) opts.ssl = false;
  return postgres(url, opts);
}

async function importUsers(sql: postgres.Sql, fromDir: string) {
  const jsonDir = join(fromDir, "json");
  if (!existsSync(jsonDir)) {
    throw new Error(`Missing ${jsonDir}`);
  }
  await sql.unsafe("SET session_replication_role = 'replica';");
  try {
    for (const table of USER_TABLES) {
      const file = join(jsonDir, `${table}.json`);
      if (!existsSync(file)) continue;
      const rows = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>[];
      if (rows.length === 0) continue;
      process.stdout.write(`${table}: importing ${rows.length} row(s)... `);
      for (let i = 0; i < rows.length; i += 100) {
        const chunk = rows.slice(i, i + 100);
        await sql`insert into ${sql(table)} ${sql(chunk)} on conflict do nothing`;
      }
      console.log("ok");
    }
  } finally {
    await sql.unsafe("SET session_replication_role = 'origin';");
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const fromDir = resolve(process.cwd(), String(args.from || "scripts/team-users-export"));
  for (const file of [".env.local", ".env"]) {
    const p = resolve(process.cwd(), file);
    if (existsSync(p)) loadEnv({ path: p, quiet: true });
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set in .env.local");
  if (!existsSync(join(fromDir, "json", "users.json"))) {
    throw new Error(`No export at ${fromDir}/json/users.json`);
  }
  const sql = connectPostgres(url);
  try {
    console.log(`Importing from: ${fromDir}`);
    await importUsers(sql, fromDir);
    console.log("Done — log in with your Replit email + password.");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error(`\nError: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
