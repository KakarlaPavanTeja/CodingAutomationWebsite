import { NextRequest, NextResponse } from "next/server";
import { and, eq, lt } from "drizzle-orm";
import { requireAdminApi } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { problems } from "@/lib/db/schema";
import { deletePrefix } from "@/lib/object-storage";

const CLEANUP_HOURS = 5;

/**
 * Cleanup soft-deleted problems whose deleted_at is older than 5 hours.
 * Removes storage files and hard-deletes the DB record.
 * Called via pg_cron (with secret) or manually from admin (with auth).
 */
export async function POST(request: NextRequest) {
  const cronSecret = request.headers.get("x-cron-secret");

  if (!(cronSecret && cronSecret === process.env.CRON_SECRET)) {
    const auth = await requireAdminApi();
    if (auth.error) return auth.error;
  }

  const cutoff = new Date(Date.now() - CLEANUP_HOURS * 60 * 60 * 1000);

  const stale = await db
    .select({ id: problems.id })
    .from(problems)
    .where(and(eq(problems.status, "deleted"), lt(problems.deletedAt, cutoff)));

  if (stale.length === 0) {
    return NextResponse.json({ cleaned: 0 });
  }

  let cleaned = 0;

  for (const problem of stale) {
    try {
      for (const subfolder of ["inputs", "outputs", "logs"]) {
        await deletePrefix(`${problem.id}/${subfolder}/`);
      }
    } catch {
      // Continue even if storage cleanup fails
    }

    await db.delete(problems).where(eq(problems.id, problem.id));
    cleaned++;
  }

  return NextResponse.json({ cleaned });
}
