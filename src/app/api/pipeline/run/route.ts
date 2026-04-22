import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import path from "path";
import { mkdirSync, createWriteStream } from "fs";
import { readFile } from "fs/promises";
import { eq } from "drizzle-orm";
import { buildCommand } from "@/lib/pipeline-config";
import { getSession } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { problems, pipelineRuns, pipelineStates } from "@/lib/db/schema";
import {
  createTempWorkspace,
  uploadOutputsFromDir,
  uploadLog,
  cleanupTempDir,
  startPeriodicSync,
} from "@/lib/storage-sync";
import { registerProcess, unregisterProcess } from "@/lib/process-registry";
import type { RunRequest } from "@/types/pipeline";

export async function POST(request: NextRequest) {
  // Auth first — never leak any info / do any work before authentication.
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.profile.status !== "active") {
    return NextResponse.json({ error: "Account not active." }, { status: 403 });
  }
  const user = { id: session.userId, email: session.email };

  const body: RunRequest = await request.json();
  const { stepId, mode, subSteps, languages, testcaseCount, problemId } = body;

  const pythonPath = process.env.PYTHON_PATH || "python3";

  if (!problemId) {
    return NextResponse.json({ error: "problemId is required" }, { status: 400 });
  }

  const pipelineRoot = process.env.PIPELINE_ROOT;
  const scriptsDir = process.env.PIPELINE_SCRIPTS_DIR ||
    (pipelineRoot ? path.join(pipelineRoot, "Scripts") : null);

  if (!scriptsDir) {
    return NextResponse.json(
      { error: "PIPELINE_SCRIPTS_DIR or PIPELINE_ROOT not configured" },
      { status: 500 }
    );
  }

  const { script, args } = buildCommand(stepId, mode, subSteps, languages, testcaseCount);

  const scriptBasename = path.basename(script);
  const scriptPath = path.join(scriptsDir, scriptBasename);

  let runId: string | null = null;
  let userId: string | null = user.id;
  let previousStatus: string | null = null;

  try {
    {
      userId = user.id;

      const probRows = await db
        .select({ status: problems.status })
        .from(problems)
        .where(eq(problems.id, problemId))
        .limit(1);
      previousStatus = probRows[0]?.status ?? null;

      await db
        .update(problems)
        .set({ status: "processing", updatedAt: new Date() })
        .where(eq(problems.id, problemId));

      const runRows = await db
        .insert(pipelineRuns)
        .values({
          problemId,
          userId: user.id,
          stepId,
          status: "running",
        })
        .returning({ id: pipelineRuns.id });

      runId = runRows[0]?.id ?? null;
    }
  } catch {
    // Don't block execution
  }

  let tmpDir: string;
  try {
    tmpDir = await createTempWorkspace(problemId);
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to create workspace: ${err instanceof Error ? err.message : "Unknown"}` },
      { status: 500 }
    );
  }

  const logsDir = path.join(tmpDir, "logs");
  mkdirSync(logsDir, { recursive: true });
  const logFilePath = path.join(logsDir, `${stepId}.log`);

  const outputsDir = path.join(tmpDir, "Outputs");
  const periodicSync = startPeriodicSync(problemId, outputsDir, 5000);

  let logSyncInterval: ReturnType<typeof setInterval> | null = null;
  if (runId) {
    logSyncInterval = setInterval(async () => {
      try {
        const logContent = await readFile(logFilePath, "utf-8").catch(() => "");
        if (logContent) {
          await uploadLog(problemId, stepId, runId!, logContent);
        }
      } catch {
        // Non-fatal
      }
    }, 3000);
  }

  const proc = spawn(pythonPath, [scriptPath, ...args], {
    cwd: tmpDir,
    env: {
      ...process.env,
      PYTHONUNBUFFERED: "1",
      PIPELINE_BASE_DIR: tmpDir,
      PIPELINE_USER_ID: userId || "",
      PIPELINE_PROBLEM_ID: problemId,
      PIPELINE_STEP_ID: stepId || "",
    },
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (runId && proc.pid) {
    registerProcess(runId, proc.pid);
  }

  const PIPELINE_TIMEOUT_MS = 45 * 60 * 1000;
  const timeoutHandle = setTimeout(() => {
    try {
      process.kill(-proc.pid!, "SIGTERM");
    } catch {
      try {
        process.kill(proc.pid!, "SIGTERM");
      } catch {
        // Already dead
      }
    }
  }, PIPELINE_TIMEOUT_MS);

  const logStream = createWriteStream(logFilePath, { flags: "w" });
  const timestamp = () => new Date().toISOString();

  logStream.write(`[${timestamp()}] Starting ${stepId}...\n`);

  let stdoutBuffer = "";
  proc.stdout?.on("data", (chunk: Buffer) => {
    stdoutBuffer += chunk.toString();
    const lines = stdoutBuffer.split("\n");
    stdoutBuffer = lines.pop() || "";
    for (const line of lines) {
      if (line.trim()) {
        logStream.write(`[${timestamp()}] ${line}\n`);
      }
    }
  });
  proc.stdout?.on("end", () => {
    if (stdoutBuffer.trim()) {
      logStream.write(`[${timestamp()}] ${stdoutBuffer}\n`);
    }
  });

  proc.stderr?.on("data", (chunk: Buffer) => {
    const lines = chunk.toString().split("\n");
    for (const line of lines) {
      if (line.trim()) {
        logStream.write(`[${timestamp()}] [STDERR] ${line}\n`);
      }
    }
  });

  proc.on("close", async (code) => {
    clearTimeout(timeoutHandle);

    if (runId) unregisterProcess(runId);

    logStream.write(`\n[${timestamp()}] Process exited with code ${code ?? 1}\n`);
    logStream.end();

    if (logSyncInterval) clearInterval(logSyncInterval);
    await periodicSync.stop();

    try {
      await uploadOutputsFromDir(problemId, outputsDir);
    } catch {
      // Non-fatal
    }

    try {
      const logContent = await readFile(logFilePath, "utf-8");
      if (runId) {
        await uploadLog(problemId, stepId, runId, logContent);
      }
    } catch {
      // Non-fatal
    }

    if (runId) {
      try {
        await db
          .update(pipelineRuns)
          .set({
            status: code === 0 ? "completed" : "failed",
            exitCode: code ?? 1,
            finishedAt: new Date(),
          })
          .where(eq(pipelineRuns.id, runId));

        const stateRows = await db
          .select({ stepStatuses: pipelineStates.stepStatuses })
          .from(pipelineStates)
          .where(eq(pipelineStates.problemId, problemId))
          .limit(1);

        if (stateRows[0]) {
          const stepStatuses = (stateRows[0].stepStatuses as Record<string, unknown>) || {};
          stepStatuses[stepId] = {
            status: code === 0 ? "completed" : "failed",
            exitCode: code ?? 1,
            endTime: Date.now(),
          };
          await db
            .update(pipelineStates)
            .set({ stepStatuses, updatedAt: new Date() })
            .where(eq(pipelineStates.problemId, problemId));
        }

        const currRunRows = await db
          .select({ exitCode: pipelineRuns.exitCode })
          .from(pipelineRuns)
          .where(eq(pipelineRuns.id, runId))
          .limit(1);
        const wasStopped = currRunRows[0]?.exitCode === -1;

        if (code !== 0 && !wasStopped) {
          await db
            .update(problems)
            .set({ status: "failed", updatedAt: new Date() })
            .where(eq(problems.id, problemId));
        } else if (stepId === "package_platform" || previousStatus === "completed") {
          await db
            .update(problems)
            .set({ status: "completed", updatedAt: new Date() })
            .where(eq(problems.id, problemId));
        }
      } catch {
        // Background DB update failed
      }
    }

    await cleanupTempDir(tmpDir);
  });

  proc.unref();

  return NextResponse.json({
    runId,
    stepId,
    status: "running",
    logFile: `logs/${stepId}.log`,
  });
}
