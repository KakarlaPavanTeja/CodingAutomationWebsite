/**
 * Export Replit users + profiles for local team setup.
 * Run INSIDE Replit only.
 *
 *   npm run export:team-users
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
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

function maskUrl(url: string): string {
  try {
    const u = new URL(url);
    return `host=${u.hostname} db=${u.pathname.replace(/^\//, "")}`;
  } catch {
    return "(local/socket)";
  }
}

function resolveSsl(url: string): false | "require" {
  if (/^postgres(ql)?:\/\/\/[^/]/.test(url)) return false;
  try {
    const u = new URL(url);
    if (["localhost", "127.0.0.1", "::1", ""].includes(u.hostname)) return false;
  } catch {
    return false;
  }
  return "require";
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const envPath = resolve(process.cwd(), ".env.local");
  if (existsSync(envPath)) loadEnv({ path: envPath, quiet: true });

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set. Run this inside Replit.");

  const outRoot = resolve(process.cwd(), String(args.out || "scripts/team-users-export"));
  const jsonDir = join(outRoot, "json");
  mkdirSync(jsonDir, { recursive: true });

  console.log(`Export target: ${outRoot}`);
  console.log(`Source: ${maskUrl(url)}`);
  console.log("Tables: users, profiles (logins only — no problems)\n");

  const sql = postgres(url, { max: 1, prepare: false, ssl: resolveSsl(url) });
  const manifest = {
    exportedAt: new Date().toISOString(),
    database: maskUrl(url),
    tables: {} as Record<string, number>,
    purpose: "team-local-auth-import",
  };

  try {
    for (const table of USER_TABLES) {
      process.stdout.write(`Exporting ${table}... `);
      const rows = await sql.unsafe(`select * from "${table}"`);
      manifest.tables[table] = rows.length;
      writeFileSync(join(jsonDir, `${table}.json`), JSON.stringify(rows, null, 2));
      console.log(`${rows.length} rows`);
    }
    writeFileSync(join(outRoot, "manifest.json"), JSON.stringify(manifest, null, 2));
    const total = Object.values(manifest.tables).reduce((a, b) => a + b, 0);
    console.log(`\nDone. ${total} rows exported.`);
    console.log("\nNext: zip scripts/team-users-export/ and share with team.");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error(`\nError: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
