import { eq, sql } from "drizzle-orm";
import { db } from "./index";
import { profiles } from "./schema";

export async function getProfileById(userId: string) {
  const rows = await db.select().from(profiles).where(eq(profiles.id, userId)).limit(1);
  return rows[0] ?? null;
}

export async function getProfileRoleById(userId: string) {
  const rows = await db
    .select({ id: profiles.id, role: profiles.role })
    .from(profiles)
    .where(eq(profiles.id, userId))
    .limit(1);
  return rows[0] ?? null;
}

export const nowExpr = sql`now()`;
