import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import path from "path";
import { mkdirSync, createWriteStream } from "fs";
import { readFile } from "fs/promises";
import { buildCommand } from "@/lib/pipeline-config";
import { createClient, createServiceClient } from "@/lib/supabase/server";
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

  const pythonPath = process.env.PYTHON_PATH || "python3";

  if (!problemId) {
    return NextResponse.json({ error: "problemId is required" }, { status: 400 });
  }

  // Determine pipeline scripts location
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

  // The script path is relative like "Scripts/generate_full_question.py"
  // We need the absolute path to the script
  const scriptBasename = path.basename(script);
  const scriptPath = path.join(scriptsDir, scriptBasename);

  // Create pipeline_run record
  let runId: string | null = null;
  let userId: string | null = null;
  let previousStatus: string | null = null;

  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (user) {
      userId = user.id;

      // Capture previous status before updating
      const { data: problemData } = await supabase
        .from("problems")
        .select("status")
        .eq("id", problemId)
        .single();
      previousStatus = problemData?.status || null;

      // Update problem status
      await supabase
        .from("problems")
        .update({ status: "processing", updated_at: new Date().toISOString() })
        .eq("id", problemId);

      // Insert pipeline run record
      const { data: run } = await supabase
        .from("pipeline_runs")
        .insert({
          problem_id: problemId,
          user_id: user.id,
          step_id: stepId,
          status: "running",
        })
        .select("id")
        .single();

      runId = run?.id || null;
    }
  } catch {
    // Don't block execution
  }

  // Create temporary workspace — downloads inputs + outputs from Supabase Storage
  let tmpDir: string;
  try {
    tmpDir = await createTempWorkspace(problemId);
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to create workspace: ${err instanceof Error ? err.message : "Unknown"}` },
      { status: 500 }
    );
  }

  // Create log file
  const logsDir = path.join(tmpDir, "logs");
  mkdirSync(logsDir, { recursive: true });
  const logFilePath = path.join(logsDir, `${stepId}.log`);

  // Start periodic sync — uploads new outputs every 5s during execution
  const outputsDir = path.join(tmpDir, "Outputs");
  const periodicSync = startPeriodicSync(problemId, outputsDir, 5000);

  // Start periodic log sync — uploads log content to DB every 3s for live tailing
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

  // Spawn Python process
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

  // Register PID so the stop endpoint can kill it
  if (runId && proc.pid) {
    registerProcess(runId, proc.pid);
  }

  // Write logs to file
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
    // Unregister from process registry
    if (runId) unregisterProcess(runId);

    logStream.write(`\n[${timestamp()}] Process exited with code ${code ?? 1}\n`);
    logStream.end();

    // Stop periodic syncs
    if (logSyncInterval) clearInterval(logSyncInterval);
    await periodicSync.stop();

    // Upload final outputs to Supabase Storage
    try {
      await uploadOutputsFromDir(problemId, outputsDir);
    } catch {
      // Log but don't crash
    }

    // Upload log to DB + storage
    try {
      const logContent = await readFile(logFilePath, "utf-8");
      if (runId) {
        await uploadLog(problemId, stepId, runId, logContent);
      }
    } catch {
      // Log upload failed — non-fatal
    }

    // Update DB records
    if (runId) {
      try {
        const supabase = await createServiceClient();

        // Update pipeline run
        await supabase
          .from("pipeline_runs")
          .update({
            status: code === 0 ? "completed" : "failed",
            exit_code: code ?? 1,
            finished_at: new Date().toISOString(),
          })
          .eq("id", runId);

        // Update pipeline state
        const { data: stateData } = await supabase
          .from("pipeline_states")
          .select("step_statuses")
          .eq("problem_id", problemId)
          .single();

        if (stateData) {
          const stepStatuses = stateData.step_statuses || {};
          stepStatuses[stepId] = {
            status: code === 0 ? "completed" : "failed",
            exitCode: code ?? 1,
            endTime: Date.now(),
          };
          await supabase
            .from("pipeline_states")
            .update({ step_statuses: stepStatuses, updated_at: new Date().toISOString() })
            .eq("problem_id", problemId);
        }

        // Update problem status
        if (code !== 0) {
          await supabase
            .from("problems")
            .update({ status: "failed", updated_at: new Date().toISOString() })
            .eq("id", problemId);
        } else if (stepId === "package_platform" || previousStatus === "completed") {
          await supabase
            .from("problems")
            .update({ status: "completed", updated_at: new Date().toISOString() })
            .eq("id", problemId);
        }
      } catch {
        // Background DB update failed
      }
    }

    // Clean up temp workspace
    await cleanupTempDir(tmpDir);
  });

  // Unref so Node.js doesn't wait for the child process
  proc.unref();

  return NextResponse.json({
    runId,
    stepId,
    status: "running",
    logFile: `logs/${stepId}.log`,
  });
}
