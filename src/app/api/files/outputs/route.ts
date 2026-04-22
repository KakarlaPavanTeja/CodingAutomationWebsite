import { NextRequest, NextResponse } from "next/server";
import { listOutputFiles } from "@/lib/storage-sync";
import { requireProblemAccess } from "@/lib/auth/ownership";
import { assertSafeProblemId } from "@/lib/storage-path";

export async function GET(request: NextRequest) {
  const problemId = request.nextUrl.searchParams.get("problemId");

  let safeProblemId: string;
  try {
    safeProblemId = assertSafeProblemId(problemId);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }

  const auth = await requireProblemAccess(safeProblemId);
  if (auth.error) return auth.error;

  try {
    const files = await listOutputFiles(safeProblemId);
    return NextResponse.json({ files });
  } catch {
    return NextResponse.json({ files: [] });
  }
}
