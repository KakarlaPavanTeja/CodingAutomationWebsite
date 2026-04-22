import { NextRequest, NextResponse } from "next/server";
import archiver from "archiver";
import { PassThrough } from "stream";
import { downloadAllOutputs } from "@/lib/storage-sync";
import { requireProblemAccess } from "@/lib/auth/ownership";
import { assertSafeProblemId } from "@/lib/storage-path";

export async function GET(request: NextRequest) {
  const problemId = request.nextUrl.searchParams.get("problemId");

  let safeProblemId: string;
  try {
    safeProblemId = assertSafeProblemId(problemId);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }

  const auth = await requireProblemAccess(safeProblemId);
  if (auth.error) return auth.error;

  let outputFiles: { path: string; buffer: Buffer }[];
  try {
    outputFiles = await downloadAllOutputs(safeProblemId);
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to fetch outputs: ${err instanceof Error ? err.message : "Unknown"}` },
      { status: 500 },
    );
  }

  if (outputFiles.length === 0) {
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
