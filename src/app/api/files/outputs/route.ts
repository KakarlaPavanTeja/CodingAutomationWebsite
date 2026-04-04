import { NextResponse } from "next/server";
import { readdir, stat } from "fs/promises";
import path from "path";
import type { OutputFile } from "@/types/pipeline";

async function listFilesRecursive(dir: string, base: string): Promise<OutputFile[]> {
  const results: OutputFile[] = [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.join(base, entry.name);

      if (entry.isDirectory()) {
        results.push({
          path: relativePath,
          name: entry.name,
          size: 0,
          modifiedAt: "",
          isDirectory: true,
        });
        const children = await listFilesRecursive(fullPath, relativePath);
        results.push(...children);
      } else {
        const stats = await stat(fullPath);
        results.push({
          path: relativePath,
          name: entry.name,
          size: stats.size,
          modifiedAt: stats.mtime.toISOString(),
          isDirectory: false,
        });
      }
    }
  } catch {
    // Directory may not exist yet
  }
  return results;
}

export async function GET() {
  const pipelineRoot = process.env.PIPELINE_ROOT;
  if (!pipelineRoot) {
    return NextResponse.json({ error: "PIPELINE_ROOT not configured" }, { status: 500 });
  }

  const outputsDir = path.join(pipelineRoot, "Outputs");
  const files = await listFilesRecursive(outputsDir, "");

  return NextResponse.json({ files });
}
