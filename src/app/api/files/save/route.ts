import { NextRequest, NextResponse } from "next/server";
import { writeStorageFile } from "@/lib/storage-sync";
import { requireProblemAccess } from "@/lib/auth/ownership";
import { assertSafeRelativePath, assertSafeProblemId } from "@/lib/storage-path";

const MAX_BODY_BYTES = 5 * 1024 * 1024;

export async function POST(request: NextRequest) {
  const contentLength = parseInt(request.headers.get("content-length") || "0", 10);
  if (contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Request too large." }, { status: 413 });
  }

  const body = await request.json();
  const { path: filePath, content, problemId } = body;

  if (typeof content !== "string") {
    return NextResponse.json({ error: "content must be a string" }, { status: 400 });
  }
  if (Buffer.byteLength(content, "utf8") > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Content too large." }, { status: 413 });
  }

  let safePath: string;
  let safeProblemId: string;
  try {
    safeProblemId = assertSafeProblemId(problemId);
    safePath = assertSafeRelativePath(filePath);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }

  const auth = await requireProblemAccess(safeProblemId);
  if (auth.error) return auth.error;

  try {
    await writeStorageFile(safeProblemId, safePath, content);
    return NextResponse.json({ success: true, path: safePath });
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to save: ${err instanceof Error ? err.message : "Unknown error"}` },
      { status: 500 },
    );
  }
}
