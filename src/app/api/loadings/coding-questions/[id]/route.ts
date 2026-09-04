import { NextRequest, NextResponse } from "next/server";
import { requireProblemAccess } from "@/lib/auth/ownership";
import { requireAuthApi } from "@/lib/auth/server";
import { assertSafeProblemId } from "@/lib/storage-path";
import { getLoadRecord } from "@/lib/loadings/load-records";

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

  return NextResponse.json(record);
}
