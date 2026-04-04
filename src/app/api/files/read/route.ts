import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";

export async function GET(request: NextRequest) {
  const pipelineRoot = process.env.PIPELINE_ROOT;
  if (!pipelineRoot) {
    return NextResponse.json({ error: "PIPELINE_ROOT not configured" }, { status: 500 });
  }

  const filePath = request.nextUrl.searchParams.get("path");
  if (!filePath) {
    return NextResponse.json({ error: "path parameter required" }, { status: 400 });
  }

  const outputsDir = path.join(pipelineRoot, "Outputs");
  const resolved = path.resolve(outputsDir, filePath);

  // Path traversal protection
  if (!resolved.startsWith(outputsDir)) {
    return NextResponse.json({ error: "Invalid path" }, { status: 403 });
  }

  try {
    const content = await readFile(resolved, "utf-8");
    return NextResponse.json({ content, path: filePath });
  } catch {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }
}
