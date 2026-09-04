import { NextRequest, NextResponse } from "next/server";
import { requireProblemAccess } from "@/lib/auth/ownership";
import { requireAuthApi } from "@/lib/auth/server";
import { getLoadRecord } from "@/lib/loadings/load-records";

const NOT_FOUND = NextResponse.json({ error: "Not found" }, { status: 404 });

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
  const record = await getLoadRecord(id);
  if (!record) return NOT_FOUND;

  if (record.problemId) {
    const problemAuth = await requireProblemAccess(record.problemId);
    if (problemAuth.error) return problemAuth.error;
  } else {
    const isOwner = record.userId === auth.session.userId;
    const isAdmin = auth.session.profile.role === "admin";
    if (!isOwner && !isAdmin) return NOT_FOUND;
  }

  return NextResponse.json(record);
}
