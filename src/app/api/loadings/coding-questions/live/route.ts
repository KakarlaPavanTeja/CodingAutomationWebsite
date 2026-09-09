import { NextResponse } from "next/server";
import { and, asc, eq, isNotNull, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { codingQuestionLoads, problems } from "@/lib/db/schema";
import { getProfileRoleById, visibleProblemsFilter } from "@/lib/db/queries";
import { requireAuthApi } from "@/lib/auth/server";
import { advanceLoadQueue } from "@/lib/loadings/advance-load-queue";

/**
 * Every load the caller may see, in one request, plus when tracking began.
 *
 * The per-problem GET beside this one answers for a single problem, which is
 * all the problem page needs. The problems LIST needs an answer for twenty at
 * once, and twenty requests every two seconds is not that answer.
 *
 * Visibility is `visibleProblemsFilter`, the same rule `/api/problems` uses —
 * deliberately the same function, not a second copy, because a load is
 * readable exactly when its problem is. Upload-sourced loads have no problem
 * and never appear here; they belong to the upload page.
 *
 * `trackingStartedAt` is the oldest load on record. A problem created before
 * it with no load of its own may well be in beta, loaded by hand before any of
 * this existed — the list says so rather than implying it was never loaded.
 * Null when nothing has ever been recorded, which makes that claim unmakeable
 * and is exactly right: with no evidence, "loaded earlier" would be a guess.
 *
 * `queuePosition` is computed here rather than per row by the client: the
 * ordering is over ALL queued loads (including ones on problems this caller
 * cannot see), so "2 ahead" stays truthful instead of counting only the subset
 * that happens to be visible.
 */
export async function GET() {
  const auth = await requireAuthApi();
  if (auth.error) return auth.error;

  const profile = await getProfileRoleById(auth.session.userId);
  const isAdmin = profile?.role === "admin";

  // Global FIFO order, before any visibility filtering — see the note above.
  const queuedIds = (
    await db
      .select({ id: codingQuestionLoads.id })
      .from(codingQuestionLoads)
      .where(eq(codingQuestionLoads.status, "queued"))
      .orderBy(asc(codingQuestionLoads.queuedAt))
  ).map((r) => r.id);
  const positionOf = new Map(queuedIds.map((id, i) => [id, i + 1]));

  const [oldest] = await db
    .select({ queuedAt: codingQuestionLoads.queuedAt })
    .from(codingQuestionLoads)
    .orderBy(asc(codingQuestionLoads.queuedAt))
    .limit(1);

  // ponytail: every visible problem's loads, reduced per problem in the client.
  // Linear in total loads forever — ~60 rows today. Move to
  // `DISTINCT ON (problem_id)` per status when that stops being trivial.
  const rows = await db
    .select({ load: codingQuestionLoads })
    .from(codingQuestionLoads)
    .innerJoin(problems, eq(problems.id, codingQuestionLoads.problemId))
    .where(
      and(
        isNotNull(codingQuestionLoads.problemId),
        ne(codingQuestionLoads.status, "cancelled"),
        visibleProblemsFilter({ userId: auth.session.userId, isAdmin }),
      ),
    )
    .orderBy(asc(codingQuestionLoads.queuedAt));

  // Same opportunistic drain as the per-id GET: this is polled while a batch is
  // in flight, so it doubles as a heartbeat that restarts a queue stranded by a
  // deploy. Not awaited, and the terminal .catch() is mandatory — an unhandled
  // rejection here would kill the process.
  void advanceLoadQueue().catch((err) => {
    console.error("[Loadings] queue drain failed:", (err as Error).message);
  });

  return NextResponse.json({
    trackingStartedAt: oldest?.queuedAt ?? null,
    loads: rows.map((r) => ({
      ...r.load,
      queuePosition: positionOf.get(r.load.id) ?? null,
    })),
  });
}
