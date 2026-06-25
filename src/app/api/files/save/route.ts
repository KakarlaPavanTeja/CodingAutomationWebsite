import { NextRequest, NextResponse } from "next/server";
import { writeStorageFile } from "@/lib/storage-sync";
import { requireProblemAccess } from "@/lib/auth/ownership";
import { assertSafeRelativePath, assertSafeProblemId } from "@/lib/storage-path";

// Generated pipeline outputs (testcases.json, coding_questions.json, …) are
// legitimately large — observed up to ~120 MB — so the save cap must be high
// enough to let owners/admins edit and re-save them. The route is
// authenticated + ownership-checked, so the abuse surface is limited.
// Override with FILE_SAVE_MAX_BYTES if needed.
const MAX_BODY_BYTES = (() => {
  const fromEnv = parseInt(process.env.FILE_SAVE_MAX_BYTES || "", 10);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : 256 * 1024 * 1024;
})();

export async function POST(request: NextRequest) {
  // Authorize BEFORE reading/parsing the (potentially large) body so an
  // unauthenticated or non-owner caller can never force a big in-memory parse.
  // `problemId` is taken from the query string for exactly this reason.
  let safeProblemId: string;
  try {
    safeProblemId = assertSafeProblemId(request.nextUrl.searchParams.get("problemId"));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }

  const auth = await requireProblemAccess(safeProblemId);
  if (auth.error) return auth.error;

  const contentLength = parseInt(request.headers.get("content-length") || "0", 10);
  if (contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Request too large." }, { status: 413 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const { path: filePath, content } = (body ?? {}) as {
    path?: unknown;
    content?: unknown;
  };

  if (typeof content !== "string") {
    return NextResponse.json({ error: "content must be a string" }, { status: 400 });
  }
  if (Buffer.byteLength(content, "utf8") > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Content too large." }, { status: 413 });
  }

  let safePath: string;
  try {
    safePath = assertSafeRelativePath(filePath);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }

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
