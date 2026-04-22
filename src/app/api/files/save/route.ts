import { NextRequest, NextResponse } from "next/server";
import { writeStorageFile } from "@/lib/storage-sync";
import { requireAuthApi } from "@/lib/auth/server";

export async function POST(request: NextRequest) {
  const auth = await requireAuthApi();
  if (auth.error) return auth.error;

  const body = await request.json();
  const { path: filePath, content, problemId } = body;

  if (!filePath || content === undefined) {
    return NextResponse.json({ error: "path and content required" }, { status: 400 });
  }

  if (!problemId) {
    return NextResponse.json({ error: "problemId required" }, { status: 400 });
  }

  try {
    await writeStorageFile(problemId, filePath, content);
    return NextResponse.json({ success: true, path: filePath });
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to save: ${err instanceof Error ? err.message : "Unknown error"}` },
      { status: 500 },
    );
  }
}
