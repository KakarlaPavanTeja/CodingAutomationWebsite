import { NextRequest, NextResponse } from "next/server";
import { getLogContent } from "@/lib/storage-sync";
import { requireProblemAccess } from "@/lib/auth/ownership";
import { assertSafeProblemId } from "@/lib/storage-path";

export async function GET(request: NextRequest) {
  const problemId = request.nextUrl.searchParams.get("problemId");
  const stepId = request.nextUrl.searchParams.get("stepId");
  const runId = request.nextUrl.searchParams.get("runId");
  const tail = parseInt(request.nextUrl.searchParams.get("tail") || "100", 10);

  if (!problemId || !stepId) {
    return NextResponse.json(
      { error: "problemId and stepId are required" },
      { status: 400 },
    );
  }

  let safeProblemId: string;
  try {
    safeProblemId = assertSafeProblemId(problemId);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }

  // Allowlist stepId — known short identifiers, no path/SQL chars.
  if (!/^[A-Za-z0-9_.-]{1,64}$/.test(stepId)) {
    return NextResponse.json({ error: "Invalid stepId" }, { status: 400 });
  }
  if (runId !== null && !/^[0-9a-fA-F-]{36}$/.test(runId)) {
    return NextResponse.json({ error: "Invalid runId" }, { status: 400 });
  }

  const auth = await requireProblemAccess(safeProblemId);
  if (auth.error) return auth.error;

  try {
    const content = await getLogContent(safeProblemId, stepId, runId || undefined);

    if (!content) {
      return NextResponse.json({ content: "", totalLines: 0, source: "none" });
    }

    const lines = content.split("\n");
    const totalLines = lines.length;
    const tailedContent =
      tail > 0 && totalLines > tail ? lines.slice(-tail).join("\n") : content;

    return NextResponse.json({
      content: tailedContent,
      totalLines,
      source: "database",
    });
  } catch {
    return NextResponse.json({ content: "", totalLines: 0, source: "none" });
  }
}
