import { NextResponse } from "next/server";
import { and, asc, eq, ne } from "drizzle-orm";
import { requireAuthApi } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { profiles } from "@/lib/db/schema";

/**
 * List active members, for populating a "share with" member picker.
 * Available to any authenticated, active user (owners as well as admins) so a
 * problem setter can grant access to their own problems.
 * Excludes the requesting user (you can't share a problem with yourself).
 */
export async function GET() {
  const auth = await requireAuthApi();
  if (auth.error) return auth.error;

  const rows = await db
    .select({
      id: profiles.id,
      email: profiles.email,
      display_name: profiles.displayName,
    })
    .from(profiles)
    .where(and(eq(profiles.status, "active"), ne(profiles.id, auth.session.userId)))
    .orderBy(asc(profiles.displayName), asc(profiles.email));

  return NextResponse.json({ members: rows });
}
