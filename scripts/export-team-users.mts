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

function loadEnvFiles() {
  for (const file of [".env.local", ".env"]) {
    const p = resolve(process.cwd(), file);
    if (existsSync(p)) loadEnv({ path: p, quiet: true });
  }
}

function maskUrl(url: string): string {
  try {
    const u = new URL(url);
    const kind = u.hostname.includes("helium") ? "replit-helium" : "postgres";
    return `${kind} host=${u.hostname} db=${u.pathname.replace(/^\//, "")}`;
  } catch {
    return "(local/socket)";
  }
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
  // Match src/lib/db/index.ts — do not force ssl: "require" (breaks Replit Helium).
  const opts: postgres.Options<Record<string, never>> = {
    max: 1,
    prepare: false,
    connect_timeout: 30,
  };
  if (isLocalPostgresUrl(url)) opts.ssl = false;
  return postgres(url, opts);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  loadEnvFiles();

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set. Run this inside Replit.");

  const outRoot = resolve(process.cwd(), String(args.out || "scripts/team-users-export"));
  const jsonDir = join(outRoot, "json");
  mkdirSync(jsonDir, { recursive: true });

  console.log(`Export target: ${outRoot}`);
  console.log(`Source: ${maskUrl(url)}`);
  console.log("Tables: users, profiles (logins only — no problems)\n");

  const sql = connectPostgres(url);
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
