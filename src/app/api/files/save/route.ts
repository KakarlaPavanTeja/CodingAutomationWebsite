import { NextRequest, NextResponse } from "next/server";
import { writeFile } from "fs/promises";
import path from "path";

export async function POST(request: NextRequest) {
  const pipelineRoot = process.env.PIPELINE_ROOT;
  if (!pipelineRoot) {
    return NextResponse.json({ error: "PIPELINE_ROOT not configured" }, { status: 500 });
  }

  const body = await request.json();
  const { path: filePath, content } = body;

  if (!filePath || content === undefined) {
    return NextResponse.json({ error: "path and content required" }, { status: 400 });
  }

  const outputsDir = path.join(pipelineRoot, "Outputs");
  const resolved = path.resolve(outputsDir, filePath);

  // Path traversal protection
  if (!resolved.startsWith(outputsDir)) {
    return NextResponse.json({ error: "Invalid path" }, { status: 403 });
  }

  try {
    await writeFile(resolved, content, "utf-8");
    return NextResponse.json({ success: true, path: filePath });
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to save: ${err instanceof Error ? err.message : "Unknown error"}` },
      { status: 500 }
    );
  }
}
