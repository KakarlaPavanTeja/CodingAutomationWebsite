/**
 * Import users + profiles into local Postgres (from export-team-users.mts).
 * Upserts by id so production password hashes overwrite stale local rows.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { config as loadEnv } from "dotenv";
import type postgres from "postgres";
import { connectPostgres } from "./resolve-database-url.mts";

const USER_TABLES = ["users", "profiles"] as const;

const USER_UPSERT_COLS = [
  "email", "password_hash", "email_verified_at", "password_reset_required",
  "created_at", "updated_at",
] as const;

const PROFILE_UPSERT_COLS = [
  "email", "display_name", "role", "status", "created_at", "updated_at",
] as const;

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

function connectPostgresForImport(url: string) {
  return connectPostgres(url);
}

async function upsertRows(
  sql: postgres.Sql,
  table: "users" | "profiles",
  rows: Record<string, unknown>[],
) {
  const cols = table === "users" ? USER_UPSERT_COLS : PROFILE_UPSERT_COLS;
  const setClause = cols.map((c) => `"${c}" = excluded."${c}"`).join(", ");

  for (const row of rows) {
    const colsList = Object.keys(row).map((c) => `"${c}"`).join(", ");
    const vals = Object.values(row);
    const placeholders = vals.map((_, i) => `$${i + 1}`).join(", ");
    await sql.unsafe(
      `insert into "${table}" (${colsList}) values (${placeholders})
       on conflict (id) do update set ${setClause}`,
      vals as never[],
    );
  }
}

async function importUsers(sql: postgres.Sql, fromDir: string) {
  const jsonDir = join(fromDir, "json");
  if (!existsSync(jsonDir)) throw new Error(`Missing ${jsonDir}`);

  const manifestPath = join(fromDir, "manifest.json");
  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      environment?: string;
      usersWithPassword?: number;
    };
    if (manifest.environment === "development") {
      console.warn("⚠  Export is from DEVELOPMENT DB — passwords may not match live site.");
      console.warn("   Ask team lead to re-export with --production\n");
    }
    if (manifest.usersWithPassword === 0) {
      console.warn("⚠  No password hashes in export — nobody can log in.\n");
    }
  }

  await sql.unsafe("SET session_replication_role = 'replica';");
  try {
    for (const table of USER_TABLES) {
      const file = join(jsonDir, `${table}.json`);
      if (!existsSync(file)) continue;
      const rows = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>[];
      if (rows.length === 0) continue;
      process.stdout.write(`${table}: upserting ${rows.length} row(s)... `);
      await upsertRows(sql, table, rows);
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
    if (existsSync(p)) loadEnv({ path: p, quiet: true, override: true });
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set in .env.local");
  if (!existsSync(join(fromDir, "json", "users.json"))) {
    throw new Error(`No export at ${fromDir}/json/users.json`);
  }
  const sql = connectPostgresForImport(url);
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
