import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import type { Config } from "drizzle-kit";
import { resolveDatabaseUrl } from "./src/lib/db/resolve-database-url";

// drizzle-kit does not use Next.js env loading — mirror .env.local / .env (same as scripts/db.mts).
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
