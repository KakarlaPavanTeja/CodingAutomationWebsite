import { NextRequest, NextResponse } from "next/server";
import { readStorageFile } from "@/lib/storage-sync";
import { requireProblemAccess } from "@/lib/auth/ownership";
import { assertSafeRelativePath, assertSafeProblemId } from "@/lib/storage-path";

export async function GET(request: NextRequest) {
  const filePath = request.nextUrl.searchParams.get("path");
  const problemId = request.nextUrl.searchParams.get("problemId");
  const subfolderRaw = request.nextUrl.searchParams.get("subfolder") || "outputs";

  // Allowlist subfolder values to prevent traversal via subfolder.
  const subfolder = subfolderRaw === "inputs" ? "inputs" : "outputs";

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
    const content = await readStorageFile(safeProblemId, safePath, subfolder);
    return NextResponse.json({ content, path: safePath });
  } catch {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }
}
