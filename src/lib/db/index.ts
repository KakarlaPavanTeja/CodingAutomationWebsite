import { drizzle } from "drizzle-orm/postgres-js";
import { getSharedPostgresClient } from "./connect-postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL ?? "";
if (!connectionString) {
  throw new Error("DATABASE_URL is not set");
}

const client = getSharedPostgresClient(connectionString);

export const db = drizzle(client, { schema });
export { schema };
export type DB = typeof db;
