import { NextResponse } from "next/server";
import { desc, eq, ne, and } from "drizzle-orm";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { problems, profiles } from "@/lib/db/schema";
import { getProfileRoleById } from "@/lib/db/queries";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const profile = await getProfileRoleById(user.id);
  const isAdmin = profile?.role === "admin";

  const baseFilter = isAdmin
    ? ne(problems.status, "deleted")
    : and(ne(problems.status, "deleted"), eq(problems.createdBy, user.id));

  const rows = await db
    .select({
      problem: problems,
      creator_email: profiles.email,
      creator_display_name: profiles.displayName,
    })
    .from(problems)
    .leftJoin(profiles, eq(problems.createdBy, profiles.id))
    .where(baseFilter)
    .orderBy(desc(problems.createdAt));

  // Shape to match the legacy Supabase joined response
  const data = rows.map((r) => ({
    id: r.problem.id,
    created_by: r.problem.createdBy,
    name: r.problem.name,
    question_type: r.problem.questionType,
    mode: r.problem.mode,
    scenario_level: r.problem.scenarioLevel,
    languages: r.problem.languages,
    status: r.problem.status,
    storage_path: r.problem.storagePath,
    created_at: r.problem.createdAt,
    updated_at: r.problem.updatedAt,
    deletion_reason: r.problem.deletionReason,
    deleted_at: r.problem.deletedAt,
    profiles: r.creator_email
      ? { email: r.creator_email, display_name: r.creator_display_name }
      : null,
  }));

  return NextResponse.json({ problems: data });
}
