import { NextRequest, NextResponse } from "next/server";
import { readStorageFile } from "@/lib/storage-sync";

export async function GET(request: NextRequest) {
  const filePath = request.nextUrl.searchParams.get("path");
  if (!filePath) {
    return NextResponse.json({ error: "path parameter required" }, { status: 400 });
  }

  const problemId = request.nextUrl.searchParams.get("problemId");
  if (!problemId) {
    return NextResponse.json({ error: "problemId parameter required" }, { status: 400 });
  }

  try {
    const content = await readStorageFile(problemId, filePath);
    return NextResponse.json({ content, path: filePath });
  } catch {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }
}
