import { drizzle } from "drizzle-orm/postgres-js";
import type postgres from "postgres";
import { createPostgresClient } from "./connect-postgres";
import * as schema from "./schema";

declare global {
  // eslint-disable-next-line no-var
  var __pgClient: ReturnType<typeof postgres> | undefined;
}

const connectionString = process.env.DATABASE_URL ?? "";
if (!connectionString) {
  throw new Error("DATABASE_URL is not set");
}

const client =
  globalThis.__pgClient ??
  createPostgresClient(connectionString);

if (process.env.NODE_ENV !== "production") {
  globalThis.__pgClient = client;
}

export const db = drizzle(client, { schema });
export { schema };
export type DB = typeof db;
