import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import path from "path";
import { mkdirSync, createWriteStream } from "fs";
import { readFile } from "fs/promises";
import { eq } from "drizzle-orm";
import { buildCommand, STEP_CONFIGS, LANGUAGES } from "@/lib/pipeline-config";
import { requireProblemAccess } from "@/lib/auth/ownership";
import { db } from "@/lib/db";
import { problems, pipelineRuns, pipelineStates } from "@/lib/db/schema";
import { assertSafeProblemId } from "@/lib/storage-path";
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
  const body: RunRequest = await request.json();
  const { stepId, mode, subSteps, languages, testcaseCount, problemId } = body;

  // Validate problemId shape before any DB work.
  let safeProblemId: string;
  try {
    safeProblemId = assertSafeProblemId(problemId);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }

  // Allowlist every value that ends up as a CLI argument to the python script.
  // We pass via spawn() argv (no shell), but constraining inputs prevents
  // surprise behavior and confines the attack surface.
  const allowedStepIds = new Set(STEP_CONFIGS.map((s) => s.id));
  if (typeof stepId !== "string" || !allowedStepIds.has(stepId as never)) {
    return NextResponse.json({ error: "Invalid stepId" }, { status: 400 });
  }
  if (mode !== undefined && mode !== "practice" && mode !== "exam") {
    return NextResponse.json({ error: "Invalid mode" }, { status: 400 });
  }
  const allowedLangLabels = new Set(LANGUAGES.map((l) => l.label));
  if (languages !== undefined) {
    if (!Array.isArray(languages) || languages.some((l) => typeof l !== "string" || !allowedLangLabels.has(l))) {
      return NextResponse.json({ error: "Invalid languages" }, { status: 400 });
    }
  }
  if (subSteps !== undefined) {
    if (
      !Array.isArray(subSteps) ||
      subSteps.some((s) => typeof s !== "string" || !/^[a-z0-9_]{1,32}$/.test(s))
    ) {
      return NextResponse.json({ error: "Invalid subSteps" }, { status: 400 });
    }
  }
  if (
    testcaseCount !== undefined &&
    testcaseCount !== null &&
    (typeof testcaseCount !== "number" ||
      !Number.isInteger(testcaseCount) ||
      testcaseCount < 1 ||
      testcaseCount > 1000)
  ) {
    return NextResponse.json({ error: "Invalid testcaseCount" }, { status: 400 });
  }

  // Auth + ownership/admin gate.
  const auth = await requireProblemAccess(safeProblemId);
  if (auth.error) return auth.error;
  const user = { id: auth.session.userId, email: auth.session.email };

  const pythonPath = process.env.PYTHON_PATH || "python3";

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
        .where(eq(problems.id, safeProblemId))
        .limit(1);
      previousStatus = probRows[0]?.status ?? null;

      await db
        .update(problems)
        .set({ status: "processing", updatedAt: new Date() })
        .where(eq(problems.id, safeProblemId));

      const runRows = await db
        .insert(pipelineRuns)
        .values({
          problemId: safeProblemId,
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
    tmpDir = await createTempWorkspace(safeProblemId);
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
  const periodicSync = startPeriodicSync(safeProblemId, outputsDir, 5000);

  let logSyncInterval: ReturnType<typeof setInterval> | null = null;
  if (runId) {
    logSyncInterval = setInterval(async () => {
      try {
        const logContent = await readFile(logFilePath, "utf-8").catch(() => "");
        if (logContent) {
          await uploadLog(safeProblemId, stepId, runId!, logContent);
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
      PIPELINE_PROBLEM_ID: safeProblemId,
      PIPELINE_STEP_ID: stepId || "",
      INTERNAL_API_URL:
        process.env.INTERNAL_API_URL ||
        process.env.NEXTAUTH_URL ||
        (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "") ||
        "http://127.0.0.1:5000",
      INTERNAL_API_SECRET: process.env.CRON_SECRET || "",
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
      await uploadOutputsFromDir(safeProblemId, outputsDir);
    } catch {
      // Non-fatal
    }

    try {
      const logContent = await readFile(logFilePath, "utf-8");
      if (runId) {
        await uploadLog(safeProblemId, stepId, runId, logContent);
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
          .where(eq(pipelineStates.problemId, safeProblemId))
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
            .where(eq(pipelineStates.problemId, safeProblemId));
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
            .where(eq(problems.id, safeProblemId));
        } else if (stepId === "package_platform" || previousStatus === "completed") {
          await db
            .update(problems)
            .set({ status: "completed", updatedAt: new Date() })
            .where(eq(problems.id, safeProblemId));
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
