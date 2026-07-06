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

export default {
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: resolveDatabaseUrl(process.env.DATABASE_URL!),
  },
  strict: true,
  verbose: true,
} satisfies Config;
