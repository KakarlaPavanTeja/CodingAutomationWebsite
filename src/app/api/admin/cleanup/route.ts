import { NextRequest, NextResponse } from "next/server";
import { and, eq, lt } from "drizzle-orm";
import { requireAdminApi, createServiceClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { problems } from "@/lib/db/schema";

const CLEANUP_HOURS = 5;

/**
 * Cleanup soft-deleted problems whose deleted_at is older than 5 hours.
 * Removes storage files and hard-deletes the DB record.
 * Called via pg_cron (with secret) or manually from admin (with auth).
 */
export async function POST(request: NextRequest) {
  const cronSecret = request.headers.get("x-cron-secret");
  let storageClient;

  if (cronSecret && cronSecret === process.env.CRON_SECRET) {
    storageClient = await createServiceClient();
  } else {
    const auth = await requireAdminApi();
    if (auth.error) return auth.error;
    storageClient = auth.supabase;
  }

  const cutoff = new Date(Date.now() - CLEANUP_HOURS * 60 * 60 * 1000);

  const stale = await db
    .select({ id: problems.id })
    .from(problems)
    .where(and(eq(problems.status, "deleted"), lt(problems.deletedAt, cutoff)));

  if (stale.length === 0) {
    return NextResponse.json({ cleaned: 0 });
  }

  const storage = storageClient.storage.from(process.env.STORAGE_BUCKET || "pipeline-files");
  let cleaned = 0;

  for (const problem of stale) {
    try {
      for (const subfolder of ["inputs", "outputs", "logs"]) {
        const { data: files } = await storage.list(`${problem.id}/${subfolder}`, { limit: 1000 });
        if (files && files.length > 0) {
          const paths = files.map((f) => `${problem.id}/${subfolder}/${f.name}`);
          await storage.remove(paths);
        }
      }
    } catch {
      // Continue even if storage cleanup fails
    }

    await db.delete(problems).where(eq(problems.id, problem.id));
    cleaned++;
  }

  return NextResponse.json({ cleaned });
}
