import { NextResponse } from "next/server";
import path from "path";
import archiver from "archiver";
import { PassThrough } from "stream";

export async function GET() {
  const pipelineRoot = process.env.PIPELINE_ROOT;
  if (!pipelineRoot) {
    return NextResponse.json(
      { error: "PIPELINE_ROOT not configured" },
      { status: 500 }
    );
  }

  const outputsDir = path.join(pipelineRoot, "Outputs");

  // Create a zip archive streaming through a PassThrough
  const passthrough = new PassThrough();
  const archive = archiver("zip", { zlib: { level: 5 } });

  archive.on("error", (err) => {
    passthrough.destroy(err);
  });

  archive.pipe(passthrough);

  // Add the entire Outputs directory
  archive.directory(outputsDir, "Outputs");

  // Finalize (don't await — it writes asynchronously)
  archive.finalize();

  // Convert Node stream to Web ReadableStream
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

  return new Response(readable, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="outputs-${Date.now()}.zip"`,
    },
  });
}
