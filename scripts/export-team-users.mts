/**
 * Export users + profiles for local team setup.
 *
 * Replit has SEPARATE dev and production databases.
 * Shell `DATABASE_URL` = development. For prod logins use --production.
 *
 * Development (wrong for live site passwords):
 *   npm run export:team-users
 *
 * Production (correct — passwords from coding-question-automation.replit.app):
 *   PRODUCTION_DATABASE_URL='<from Replit Publishing → Production secrets>' \
 *     npm run export:team-users -- --production
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
  const opts: postgres.Options<Record<string, never>> = {
    max: 1,
    prepare: false,
    connect_timeout: 30,
  };
  if (isLocalPostgresUrl(url)) opts.ssl = false;
  return postgres(url, opts);
}

function resolveDatabaseUrl(useProduction: boolean): { url: string; environment: string } {
  if (useProduction) {
    const prod =
      process.env.PRODUCTION_DATABASE_URL?.trim() ||
      process.env.DATABASE_URL_PRODUCTION?.trim();
    if (!prod) {
      throw new Error(
        "Production export needs PRODUCTION_DATABASE_URL.\n\n" +
          "1. Replit → Publishing → Production → Secrets → copy DATABASE_URL\n" +
          "2. Run:\n" +
          "   PRODUCTION_DATABASE_URL='<paste>' npm run export:team-users -- --production",
      );
    }
    return { url: prod, environment: "production" };
  }
  const dev = process.env.DATABASE_URL;
  if (!dev) throw new Error("DATABASE_URL is not set.");
  return { url: dev, environment: "development" };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  loadEnvFiles();

  const useProduction = Boolean(args.production);
  const { url, environment } = resolveDatabaseUrl(useProduction);

  const outRoot = resolve(process.cwd(), String(args.out || "scripts/team-users-export"));
  const jsonDir = join(outRoot, "json");
  mkdirSync(jsonDir, { recursive: true });

  console.log(`Export target: ${outRoot}`);
  console.log(`Environment: ${environment.toUpperCase()}`);
  console.log(`Source: ${maskUrl(url)}`);
  if (!useProduction) {
    console.warn("\n⚠  WARNING: exporting DEVELOPMENT database.");
    console.warn("   Live site passwords are in PRODUCTION. Re-run with --production\n");
  }
  console.log("Tables: users, profiles (logins only — no problems)\n");

  const sql = connectPostgres(url);
  const manifest = {
    exportedAt: new Date().toISOString(),
    environment,
    database: maskUrl(url),
    tables: {} as Record<string, number>,
    usersWithPassword: 0,
    usersWithoutPassword: 0,
    purpose: "team-local-auth-import",
  };

  try {
    for (const table of USER_TABLES) {
      process.stdout.write(`Exporting ${table}... `);
      const rows = await sql.unsafe(`select * from "${table}"`);
      manifest.tables[table] = rows.length;
      if (table === "users") {
        for (const row of rows as { password_hash: string | null }[]) {
          if (row.password_hash) manifest.usersWithPassword++;
          else manifest.usersWithoutPassword++;
        }
      }
      writeFileSync(join(jsonDir, `${table}.json`), JSON.stringify(rows, null, 2));
      console.log(`${rows.length} rows`);
    }
    writeFileSync(join(outRoot, "manifest.json"), JSON.stringify(manifest, null, 2));

    console.log(`\nPassword hashes: ${manifest.usersWithPassword} yes, ${manifest.usersWithoutPassword} missing`);
    if (manifest.usersWithoutPassword > 0) {
      console.warn("  Users with null password_hash cannot log in until they reset password.");
    }
    console.log(`\nDone. Share scripts/team-users-export/ with team.`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error(`\nError: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
