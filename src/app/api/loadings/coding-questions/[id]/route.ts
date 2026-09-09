import { NextRequest, NextResponse } from "next/server";
import { requireProblemAccess, requireProblemManageAccess } from "@/lib/auth/ownership";
import { requireAuthApi } from "@/lib/auth/server";
import { assertSafeProblemId } from "@/lib/storage-path";
import { cancelLoad, getLoadRecord, queuePositionForLoad } from "@/lib/loadings/load-records";
import { advanceLoadQueue } from "@/lib/loadings/advance-load-queue";

// A `NextResponse` body is single-use — a module-level instance returned
// more than once serves an empty body from the second call on, and (worse)
// makes malformed/missing/forbidden ids distinguishable by body content
// instead of all reading as the same generic 404. Build a fresh one per call.
function notFound(): NextResponse {
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

/**
 * Poll a background load's status/logs.
 *
 * Every read requires a session, full stop. A problem-sourced load is then
 * additionally gated by `requireProblemAccess`. An upload-sourced load has no
 * `problemId` by design (nothing to authorise against), so it is gated
 * instead by row ownership: only the uploader or an admin may read it —
 * otherwise this record (logs, question ids, question set id, remarks) would
 * be readable by anyone who guesses/knows the row id. "Not found" and "not
 * yours" return the same generic 404 so the id space can't be enumerated.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuthApi();
  if (auth.error) return auth.error;

  const { id } = await params;
  // The column is `uuid`, so a malformed id would otherwise reach Postgres
  // and raise 22P02 (uncaught -> 500) instead of the same generic 404 a
  // well-formed-but-missing id gets. Reuse the sibling route's UUID-shape
  // check rather than hand-rolling a new one.
  let safeId: string;
  try {
    safeId = assertSafeProblemId(id);
  } catch {
    return notFound();
  }

  const record = await getLoadRecord(safeId);
  if (!record) return notFound();

  if (record.problemId) {
    const problemAuth = await requireProblemAccess(record.problemId);
    if (problemAuth.error) return problemAuth.error;
  } else {
    const isOwner = record.userId === auth.session.userId;
    const isAdmin = auth.session.profile.role === "admin";
    if (!isOwner && !isAdmin) return notFound();
  }

  // The log panel polls this every two seconds, which makes it the cheapest
  // queue heartbeat available: if a deploy or a crash stranded a queue with
  // nothing running, this is what restarts it. Not awaited — this request
  // answers with what it already read — and the terminal .catch() is mandatory,
  // since an unhandled rejection here would kill the process.
  void advanceLoadQueue().catch((err) => {
    console.error("[Loadings] queue drain failed:", (err as Error).message);
  });

  return NextResponse.json({
    ...record,
    queuePosition: record.status === "queued" ? await queuePositionForLoad(record.id) : null,
  });
}

/**
 * Pull a load out of the queue, or clear one wedged in `running`.
 *
 * Authorised like a load START, not like a read: a problem-sourced load needs
 * MANAGE access, because cancelling changes what reaches shared beta. An
 * upload-sourced one has no problem to authorise against and is restricted to
 * its owner or an admin, same as the GET above. Do NOT copy the GET's weaker
 * `requireProblemAccess` here.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuthApi();
  if (auth.error) return auth.error;

  const { id } = await params;
  let safeId: string;
  try {
    safeId = assertSafeProblemId(id);
  } catch {
    return notFound();
  }

  const record = await getLoadRecord(safeId);
  if (!record) return notFound();

  if (record.problemId) {
    const problemAuth = await requireProblemManageAccess(record.problemId);
    if (problemAuth.error) return problemAuth.error;
  } else {
    const isOwner = record.userId === auth.session.userId;
    const isAdmin = auth.session.profile.role === "admin";
    if (!isOwner && !isAdmin) return notFound();
  }

  const outcome = await cancelLoad(safeId);
  if (outcome === "missing") return notFound();
  if (outcome === "not-cancellable") {
    return NextResponse.json(
      {
        error:
          `This load is ${record.status} and cannot be cancelled. A live load is left alone on ` +
          "purpose: an NKB task is writing to beta, and cancelling the row would only lose track " +
          "of it. It becomes cancellable once it has made no progress for 30 minutes.",
      },
      { status: 409 },
    );
  }

  // Cancelling a queued row frees the line immediately — drain now rather than
  // waiting for the next poll.
  void advanceLoadQueue().catch((err) => {
    console.error("[Loadings] queue drain failed:", (err as Error).message);
  });

  return NextResponse.json({ status: "cancelled" });
}
