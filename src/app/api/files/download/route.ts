import { NextRequest, NextResponse } from "next/server";
import archiver from "archiver";
import { PassThrough } from "stream";
import { downloadAllOutputs, exportRunLogsFromStorage, readStorageFileBuffer } from "@/lib/storage-sync";
import { requireProblemAccess } from "@/lib/auth/ownership";
import { assertSafeProblemId, assertSafeRelativePath } from "@/lib/storage-path";

const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  json: "application/json",
  md: "text/markdown",
  txt: "text/plain",
  py: "text/x-python",
  cpp: "text/x-c++src",
  h: "text/x-c++hdr",
  java: "text/x-java-source",
  js: "text/javascript",
  lua: "text/x-lua",
};

export async function GET(request: NextRequest) {
  const problemId = request.nextUrl.searchParams.get("problemId");
  const pathParam = request.nextUrl.searchParams.get("path");

  let safeProblemId: string;
  try {
    safeProblemId = assertSafeProblemId(problemId);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }

  const auth = await requireProblemAccess(safeProblemId);
  if (auth.error) return auth.error;

  // Single-file download when a `path` is supplied (e.g. the upload-ready
  // coding_questions.json). Falls back to the full ZIP when omitted.
  if (pathParam !== null) {
    let safePath: string;
    try {
      safePath = assertSafeRelativePath(pathParam);
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 400 });
    }

    let buffer: Buffer;
    try {
      buffer = await readStorageFileBuffer(safeProblemId, safePath);
    } catch {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    const filename = safePath.split("/").pop() || "download";
    const ext = filename.split(".").pop()?.toLowerCase() || "";
    const contentType = CONTENT_TYPE_BY_EXT[ext] || "application/octet-stream";

    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  }

  let outputFiles: { path: string; buffer: Buffer }[];
  try {
    outputFiles = await downloadAllOutputs(safeProblemId);
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to fetch outputs: ${err instanceof Error ? err.message : "Unknown"}` },
      { status: 500 },
    );
  }

  // Every run's log, from object storage (one object per run — the complete
  // history). Non-fatal: a log-read failure must not block the outputs download.
  let runLogs: { path: string; buffer: Buffer }[] = [];
  try {
    runLogs = await exportRunLogsFromStorage(safeProblemId);
  } catch {
    // Non-fatal — proceed with outputs only.
  }

  if (outputFiles.length === 0 && runLogs.length === 0) {
    return NextResponse.json({ error: "No output files found" }, { status: 404 });
  }

  const passthrough = new PassThrough();
  const archive = archiver("zip", { zlib: { level: 5 } });

  archive.on("error", (err) => {
    passthrough.destroy(err);
  });

  archive.pipe(passthrough);

  for (const file of outputFiles) {
    archive.append(file.buffer, { name: `Outputs/${file.path}` });
  }
  for (const log of runLogs) {
    archive.append(log.buffer, { name: log.path });
  }

  archive.finalize();

  const readable = new ReadableStream({
    start(controller) {
      passthrough.on("data", (chunk: Buffer) => {
        controller.enqueue(new Uint8Array(chunk));
      });
      passthrough.on("end", () => {
        controller.close();
      });
      passthrough.on("error", (err) => {
        controller.error(err);
      });
    },
    cancel() {
      passthrough.destroy();
      archive.abort();
    },
  });

  const filename = `outputs-${safeProblemId.slice(0, 8)}-${Date.now()}.zip`;

  return new Response(readable, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
