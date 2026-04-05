import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

const CLEANUP_HOURS = 5;

/**
 * Cleanup soft-deleted problems whose deleted_at is older than 5 hours.
 * Removes storage files and hard-deletes the DB record.
 * Can be called via cron or manually from admin.
 */
export async function POST() {
  const supabase = await createServiceClient();
  const cutoff = new Date(Date.now() - CLEANUP_HOURS * 60 * 60 * 1000).toISOString();

  // Find problems soft-deleted more than 5 hours ago
  const { data: problems } = await supabase
    .from("problems")
    .select("id")
    .eq("status", "deleted")
    .lt("deleted_at", cutoff);

  if (!problems || problems.length === 0) {
    return NextResponse.json({ cleaned: 0 });
  }

  const storage = supabase.storage.from(process.env.STORAGE_BUCKET || "pipeline-files");
  let cleaned = 0;

  for (const problem of problems) {
    // Remove storage files
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

    // Hard delete from DB
    await supabase.from("problems").delete().eq("id", problem.id);
    cleaned++;
  }

  return NextResponse.json({ cleaned });
}
