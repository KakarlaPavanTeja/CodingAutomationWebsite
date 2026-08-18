import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import type { Config } from "drizzle-kit";

function resolveDatabaseUrl(url: string): string {
  const m = url.match(/^postgres(ql)?:\/\/\/([^?/]+)$/);
  if (!m) return url;
  const db = m[2];
  const user = process.env.USER ?? process.env.USERNAME ?? "postgres";
  let socketDir = "/var/run/postgresql";
  if (process.platform !== "win32") {
    for (const dir of ["/var/run/postgresql", "/tmp"]) {
      if (existsSync(dir)) {
        socketDir = dir;
        break;
      }
    }
  }
  return `postgresql://${encodeURIComponent(user)}@localhost/${db}?host=${encodeURIComponent(socketDir)}`;
}

for (const file of [".env.local", ".env"]) {
  const path = resolve(process.cwd(), file);
  if (existsSync(path)) loadEnv({ path, quiet: true, override: true });
}

/**
 * The database drizzle-kit will act on.
 *
 * `override: true` above is deliberate — local setup needs `.env.local` to beat a stale
 * exported `DATABASE_URL` (see 469ad93). The side effect is that
 * `DATABASE_URL=... npx drizzle-kit push` is SILENTLY IGNORED: the value is loaded and
 * then overwritten, so the command runs against whatever `.env.local` points at. On this
 * repo that is the production cluster, and `db:push` passes `--force`. Someone doing the
 * obvious thing to target a scratch database gets a forced push to production instead,
 * with no warning — which is exactly what happened on 2026-08-18.
 *
 * `DRIZZLE_DATABASE_URL` is the unambiguous way to say "no, this one". It is never read
 * from a .env file, so setting it can only be deliberate, and it wins over everything.
 * The default path is unchanged.
 */
const target = process.env.DRIZZLE_DATABASE_URL?.trim() || process.env.DATABASE_URL;

if (!target) {
  throw new Error(
    "No database URL. Set DATABASE_URL in .env.local, or DRIZZLE_DATABASE_URL to " +
      "target a different database for this command.",
  );
}

if (process.env.DRIZZLE_DATABASE_URL?.trim()) {
  // Say so out loud. A migration silently hitting a database you did not intend is the
  // failure this block exists to prevent, in either direction.
  console.warn(`[drizzle] DRIZZLE_DATABASE_URL is set — targeting ${target.replace(/\/\/[^@]*@/, "//***@")}`);
}

export default {
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: resolveDatabaseUrl(target),
  },
  strict: true,
  verbose: true,
} satisfies Config;
