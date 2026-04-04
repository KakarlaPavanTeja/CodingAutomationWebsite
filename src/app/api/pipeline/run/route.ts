import { NextRequest } from "next/server";
import { spawn } from "child_process";
import path from "path";
import { buildCommand } from "@/lib/pipeline-config";
import type { RunRequest } from "@/types/pipeline";

let isRunning = false;

export async function POST(request: NextRequest) {
  if (isRunning) {
    return new Response(
      JSON.stringify({ error: "Another step is already running" }),
      { status: 409, headers: { "Content-Type": "application/json" } }
    );
  }

  const body: RunRequest = await request.json();
  const { stepId, mode, subSteps, languages, testcaseCount } = body;

  const pipelineRoot = process.env.PIPELINE_ROOT;
  const pythonPath = process.env.PYTHON_PATH || "python3";

  if (!pipelineRoot) {
    return new Response(
      JSON.stringify({ error: "PIPELINE_ROOT not configured" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  const { script, args } = buildCommand(stepId, mode, subSteps, languages, testcaseCount);
  const scriptPath = path.join(pipelineRoot, script);

  isRunning = true;

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      function send(event: string, data: object) {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        );
      }

      send("log", {
        stream: "stdout",
        line: `$ ${pythonPath} ${script} ${args.join(" ")}`,
        ts: Date.now(),
      });

      const proc = spawn(pythonPath, [scriptPath, ...args], {
        cwd: pipelineRoot,
        env: { ...process.env, PYTHONUNBUFFERED: "1" },
      });

      let stdoutBuffer = "";
      let stderrBuffer = "";

      proc.stdout.on("data", (chunk: Buffer) => {
        stdoutBuffer += chunk.toString();
        const lines = stdoutBuffer.split("\n");
        stdoutBuffer = lines.pop() || "";
        for (const line of lines) {
          send("log", { stream: "stdout", line, ts: Date.now() });
        }
      });

      proc.stderr.on("data", (chunk: Buffer) => {
        stderrBuffer += chunk.toString();
        const lines = stderrBuffer.split("\n");
        stderrBuffer = lines.pop() || "";
        for (const line of lines) {
          send("log", { stream: "stderr", line, ts: Date.now() });
        }
      });

      proc.on("close", (code) => {
        if (stdoutBuffer) {
          send("log", { stream: "stdout", line: stdoutBuffer, ts: Date.now() });
        }
        if (stderrBuffer) {
          send("log", { stream: "stderr", line: stderrBuffer, ts: Date.now() });
        }
        send("done", { exitCode: code ?? 1, stepId });
        isRunning = false;
        controller.close();
      });

      proc.on("error", (err) => {
        send("error", { message: err.message });
        isRunning = false;
        controller.close();
      });

      // Heartbeat to keep connection alive
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {
          clearInterval(heartbeat);
        }
      }, 15000);

      proc.on("close", () => clearInterval(heartbeat));
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
