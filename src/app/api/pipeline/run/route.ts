import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import path from "path";
import { mkdirSync, createWriteStream } from "fs";
import { readFile } from "fs/promises";
import { eq } from "drizzle-orm";
import { buildCommand, getStepConfig, getAllTrackedStepIds, STEP_CONFIGS, LANGUAGES } from "@/lib/pipeline-config";
import { requireProblemAccess } from "@/lib/auth/ownership";
import { db } from "@/lib/db";
import { problems, pipelineRuns, pipelineStates } from "@/lib/db/schema";
import { assertSafeProblemId } from "@/lib/storage-path";
import { getActiveOpenRouterKey } from "@/lib/openrouter-key";
import {
  createTempWorkspace,
  uploadOutputsFromDir,
  uploadLog,
  syncLogToStorage,
  cleanupTempDir,
  startPeriodicSync,
  mirrorInputsFromDir,
  readStorageFile,
} from "@/lib/storage-sync";
import { parseGeneratedTitleFirstLine } from "@/lib/pipeline-title";
import { registerProcess, unregisterProcess } from "@/lib/process-registry";
import { pipelineRunLogKey } from "@/lib/pipeline-run-label";
import { recomputeProblemStatus } from "@/lib/reconcile-pipeline-runs";
import { pipelineStateCacheInvalidate } from "@/lib/pipeline-state-cache";
import { resolveOpenRouterBaseUrl } from "@/lib/openrouter";
import type { RunRequest, PipelineMode, QuestionType, StepId } from "@/types/pipeline";

async function markRunTerminal(
  runId: string | null,
  status: "failed" | "completed",
  exitCode: number
): Promise<void> {
  if (!runId) return;
  try {
    await db
      .update(pipelineRuns)
      .set({
        status,
        exitCode,
        finishedAt: new Date(),
        pid: null,
      })
      .where(eq(pipelineRuns.id, runId));
  } catch {
    // Non-fatal
  }
}

/**
 * Resolve the base URL the spawned Python pipeline uses to POST usage/cost rows
 * back to *this* app's `/api/internal/llm-usage` endpoint.
 *
 * The base MUST point at the instance that owns the current request's database:
 *  - In the deployment (REPLIT_DEPLOYMENT set) → the deployment's own public
 *    origin. `127.0.0.1:5001` and the dev domain both fail there: the former
 *    returns a 404 HTML page, the latter (if even set) targets the *dev*
 *    workspace, so every cost row silently degrades to "local only" and never
 *    reaches the production database.
 *  - In the dev workspace → the loopback (`127.0.0.1:<port>`). The spawned
 *    Python runs on the same machine as this server and shares the same dev
 *    database, so a local POST is both correct and reliable. Routing through the
 *    public dev domain instead sends the request out to Replit's proxy and back;
 *    whenever that proxy is not actively serving (cold proxy, mid-restart,
 *    sleep) it returns the "This app isn't live yet" 404 HTML splash, which
 *    every LLM-using step then logs as `internal insert failed (404)`.
 *
 * An explicit INTERNAL_API_URL always wins for manual overrides.
 */
async function resolveOwnerTitleForPipeline(
  problemId: string,
  ownerTitleFromConfig: string
): Promise<string> {
  if (ownerTitleFromConfig) return ownerTitleFromConfig;
  try {
    const content = await readStorageFile(problemId, "Outputs/generated_titles.txt", "outputs");
    return parseGeneratedTitleFirstLine(content);
  } catch {
    return "";
  }
}

function resolveInternalApiUrl(): string {
  const explicit = process.env.INTERNAL_API_URL || process.env.NEXTAUTH_URL;
  if (explicit) return explicit;

  // Same-container loopback avoids billing outbound hairpin via the public URL.
  if (process.env.PIPELINE_INTERNAL_LOOPBACK !== "0") {
    return `http://127.0.0.1:${process.env.PORT || 5001}`;
  }

  const isDeployment = Boolean(process.env.REPLIT_DEPLOYMENT);
  if (isDeployment) {
    const appUrl = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL;
    if (appUrl) return appUrl;
    const firstDomain = process.env.REPLIT_DOMAINS?.split(",")[0]?.trim();
    if (firstDomain) return `https://${firstDomain}`;
  }

  return `http://127.0.0.1:${process.env.PORT || 5001}`;
}

function stepMayCallLlm(stepId: StepId): boolean {
  const usage = getStepConfig(stepId).llmUsage;
  return usage === "llm" || usage === "conditional";
}

/** Env for spawned Python — OpenRouter only; strip direct provider keys. */
function pipelineSpawnEnv(overrides: Record<string, string>): NodeJS.ProcessEnv {
  const env = { ...process.env, ...overrides };
  delete env.OPENAI_API_KEY;
  delete env.ANTHROPIC_API_KEY;
  return env;
}

export async function POST(request: NextRequest) {
  const body: RunRequest = await request.json();
  const { stepId, mode, subSteps, languages, testcaseCount, problemId, runKey, refineNote } = body;

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
  const allowedLangIds = new Set(LANGUAGES.map((l) => l.id));
  if (languages !== undefined) {
    if (!Array.isArray(languages) || languages.some((l) => typeof l !== "string" || !allowedLangIds.has(l))) {
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
  // testcaseCount is optional. 0 / unset means "let the generator auto-scale"
  // (buildCommand omits --count for falsy values), so only a positive number
  // outside the supported range is actually invalid.
  if (
    testcaseCount !== undefined &&
    testcaseCount !== null &&
    (typeof testcaseCount !== "number" ||
      !Number.isInteger(testcaseCount) ||
      testcaseCount < 0 ||
      testcaseCount > 1000)
  ) {
    return NextResponse.json({ error: "Invalid testcaseCount" }, { status: 400 });
  }
  if (
    runKey !== undefined &&
    (typeof runKey !== "string" || !/^[a-z0-9_]{1,64}$/.test(runKey))
  ) {
    return NextResponse.json({ error: "Invalid runKey" }, { status: 400 });
  }
  // Reviewer refinement note — optional free text folded into the LLM prompt.
  // Passed via env (not argv), so only length is constrained here.
  if (
    refineNote !== undefined &&
    (typeof refineNote !== "string" || refineNote.length > 4000)
  ) {
    return NextResponse.json({ error: "Invalid refineNote" }, { status: 400 });
  }

  // Auth + ownership/admin gate.
  const auth = await requireProblemAccess(safeProblemId);
  if (auth.error) return auth.error;
  const user = { id: auth.session.userId, email: auth.session.email };

  // The stored problem config — not the client request — is the source of truth
  // for which steps are valid and which mode the pipeline runs in. This stops a
  // caller from running, say, a function-only step (split_code / execute_tests_function)
  // on a non-function problem, or driving the pipeline in a mode the problem
  // was never set up for.
  const cfgRows = await db
    .select({
      questionType: problems.questionType,
      mode: problems.mode,
      difficulty: problems.difficulty,
      score: problems.score,
    })
    .from(problems)
    .where(eq(problems.id, safeProblemId))
    .limit(1);
  if (!cfgRows[0]) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const storedQuestionType = cfgRows[0].questionType as QuestionType;
  const storedMode = cfgRows[0].mode as PipelineMode;
  const ownerDifficulty = cfgRows[0].difficulty ?? "";
  const ownerScore = cfgRows[0].score != null ? String(cfgRows[0].score) : "";

  const stateRows = await db
    .select({ stepConfigs: pipelineStates.stepConfigs })
    .from(pipelineStates)
    .where(eq(pipelineStates.problemId, safeProblemId))
    .limit(1);
  const globalCfg = (stateRows[0]?.stepConfigs as Record<string, unknown> | undefined)?.[
    "__global__"
  ] as { ownerTitle?: string; defaultTagNames?: string; generateTitleWithAi?: boolean } | undefined;
  const ownerTitleFromConfig = globalCfg?.ownerTitle?.trim() ?? "";
  const ownerTitle = await resolveOwnerTitleForPipeline(safeProblemId, ownerTitleFromConfig);
  const defaultTagNames = globalCfg?.defaultTagNames?.trim() ?? "";

  // Reject a step that isn't tracked for this problem (workflow + GQ-embedded e.g. brute force).
  const allowedSteps = getAllTrackedStepIds(storedQuestionType, storedMode);
  if (!allowedSteps.includes(stepId as StepId)) {
    return NextResponse.json(
      { error: "Step is not part of this problem's workflow" },
      { status: 400 }
    );
  }

  // Reject a client mode that contradicts the stored mode; otherwise derive it.
  if (mode !== undefined && mode !== storedMode) {
    return NextResponse.json(
      { error: "Mode does not match the problem configuration" },
      { status: 400 }
    );
  }
  const effectiveMode: PipelineMode = storedMode;

  const openRouterKey = await getActiveOpenRouterKey();
  if (stepMayCallLlm(stepId as StepId) && !openRouterKey) {
    return NextResponse.json(
      {
        error:
          "OPENROUTER_API_KEY is not set. Add it to .env.local (https://openrouter.ai/keys).",
      },
      { status: 503 }
    );
  }

  const pythonPath = process.env.PYTHON_PATH || "python3";

  const pipelineRoot = process.env.PIPELINE_ROOT || path.join(process.cwd(), "pipeline");
  const scriptsDir = process.env.PIPELINE_SCRIPTS_DIR || path.join(pipelineRoot, "Scripts");

  const { script, args } = buildCommand(stepId, effectiveMode, subSteps, languages, testcaseCount);

  const logStepKey = pipelineRunLogKey(
    stepId as StepId,
    subSteps,
    runKey
  );

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
          stepId: logStepKey,
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
    await mirrorInputsFromDir(safeProblemId, path.join(tmpDir, "Inputs"));
  } catch (err) {
    await markRunTerminal(runId, "failed", 1);
    // We optimistically set problems.status = "processing" above; the process
    // never started, so restore the prior status instead of stranding the
    // problem in "processing" forever (reconcile only scans running runs) (P1-H7).
    try {
      await db
        .update(problems)
        .set({ status: previousStatus ?? "draft", updatedAt: new Date() })
        .where(eq(problems.id, safeProblemId));
    } catch {
      // Non-fatal
    }
    return NextResponse.json(
      { error: `Failed to create workspace: ${err instanceof Error ? err.message : "Unknown"}` },
      { status: 500 }
    );
  }

  const logsDir = path.join(tmpDir, "logs");
  mkdirSync(logsDir, { recursive: true });
  const logFilePath = path.join(logsDir, `${logStepKey}.log`);

  const outputsDir = path.join(tmpDir, "Outputs");
  const outputSyncMs = Math.max(
    10_000,
    parseInt(process.env.PIPELINE_OUTPUT_SYNC_MS || "30000", 10) || 30_000,
  );
  const logSyncMs = Math.max(
    5_000,
    parseInt(process.env.PIPELINE_LOG_SYNC_MS || "12000", 10) || 12_000,
  );
  // Everything the workspace was hydrated with is ALREADY in storage, so only files
  // this step writes may be published. Without this bound each step re-uploads its
  // whole hydrated Outputs copy and parallel steps revert each other — naming's
  // normalized PYTHON.py lost to whichever sibling finished last. Captured before
  // spawn so nothing the step writes is missed; one second of slack absorbs
  // filesystem mtime granularity.
  const runStartedAtMs = Date.now() - 1_000;
  const periodicSync = startPeriodicSync(
    safeProblemId,
    outputsDir,
    outputSyncMs,
    runStartedAtMs,
  );

  let logSyncInterval: ReturnType<typeof setInterval> | null = null;
  if (runId) {
    logSyncInterval = setInterval(async () => {
      try {
        const logContent = await readFile(logFilePath, "utf-8").catch(() => "");
        if (logContent) {
          // Storage only — the log viewer reads the same key. Never Postgres:
          // rewriting a TOASTed column every tick is what filled the DB disk.
          await syncLogToStorage(safeProblemId, logStepKey, runId!, logContent);
        }
      } catch {
        // Non-fatal
      }
    }, logSyncMs);
  }

  const internalApiUrl = resolveInternalApiUrl();
  console.log(`[pipeline/run] usage POST base = ${internalApiUrl}`);

  const proc = spawn(pythonPath, [scriptPath, ...args], {
    cwd: tmpDir,
    env: pipelineSpawnEnv({
      PYTHONUNBUFFERED: "1",
      PIPELINE_BASE_DIR: tmpDir,
      PIPELINE_USER_ID: userId || "",
      PIPELINE_PROBLEM_ID: safeProblemId,
      PIPELINE_STEP_ID: logStepKey,
      // Exact run id so usage rows attribute to THIS run, not a time window (P1-M1).
      PIPELINE_RUN_ID: runId ?? "",
      // Owner-set, FINAL difficulty/score. Empty string means "not set" — the
      // pipeline then falls back to auto-generating difficulty and deriving the
      // weightage from it.
      PIPELINE_OWNER_DIFFICULTY: ownerDifficulty,
      PIPELINE_OWNER_SCORE: ownerScore,
      PIPELINE_OWNER_TITLE: ownerTitle,
      PIPELINE_DEFAULT_TAGS: defaultTagNames,
      PIPELINE_GENERATE_TITLE_WITH_AI: globalCfg?.generateTitleWithAi ? "true" : "false",
      PIPELINE_MODE: effectiveMode,
      // Question type so editorial_execution_manager can pick function vs
      // non-function execution without re-deriving it from disk state.
      PIPELINE_QUESTION_TYPE: storedQuestionType || "",
      PIPELINE_ENABLED_LANGS: (languages ?? []).join(","),
      // Reviewer's refinement instruction for a re-run of a completed LLM step.
      // Empty string means "no extra instructions" (the normal generation path).
      PIPELINE_REFINE_NOTE: (refineNote ?? "").slice(0, 4000),
      // Base URL the Python pipeline uses to POST cost/usage back to this same
      // app (`/api/internal/llm-usage`). It MUST resolve to THIS environment's
      // own running instance — in the deployment to the deployment, in dev to
      // the dev workspace. A wrong base silently drops every cost row to
      // "local only" (the row never reaches the database).
      INTERNAL_API_URL: internalApiUrl,
      INTERNAL_API_SECRET: process.env.CRON_SECRET || "",
      OPENROUTER_API_KEY: openRouterKey ?? "",
      OPENROUTER_BASE_URL: resolveOpenRouterBaseUrl(),
    }),
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (runId && proc.pid) {
    registerProcess(runId, proc.pid);
  }

  // Stay above the LLM read timeout (45 min for testcases in llm_client.py) so a
  // long reasoning call can finish and the step still has headroom for setup,
  // parsing, and running the generated script before this hard cap fires.
  const PIPELINE_TIMEOUT_MS = 60 * 60 * 1000;
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

  logStream.write(`[${timestamp()}] Starting ${logStepKey}...\n`);

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
      await uploadOutputsFromDir(safeProblemId, outputsDir, runStartedAtMs);
    } catch {
      // Non-fatal
    }

    try {
      const logContent = await readFile(logFilePath, "utf-8");
      if (runId) {
        await uploadLog(safeProblemId, logStepKey, runId, logContent);
      }
    } catch {
      // Non-fatal
    }

    if (runId) {
      try {
        // Detect a stop that already marked this run (exitCode === -1) BEFORE we
        // overwrite exitCode below, otherwise the stop signal is clobbered and a
        // force-killed run can be misreported as completed (P1-M5).
        const priorRunRows = await db
          .select({ exitCode: pipelineRuns.exitCode })
          .from(pipelineRuns)
          .where(eq(pipelineRuns.id, runId))
          .limit(1);
        const wasStopped = priorRunRows[0]?.exitCode === -1;

        await db
          .update(pipelineRuns)
          .set({
            status: wasStopped ? "failed" : code === 0 ? "completed" : "failed",
            exitCode: wasStopped ? -1 : code ?? 1,
            finishedAt: new Date(),
          })
          .where(eq(pipelineRuns.id, runId));

        // Only stamp the PARENT step status for atomic top-level steps. For GQ
        // sub-steps and per-language split/execute runs (logStepKey !== stepId)
        // the client recomputes and persists the parent status from its
        // sub-runs, so writing the bare parent here would clobber sibling
        // progress (P1-C2/M2).
        if (logStepKey === stepId) {
          const stateRows = await db
            .select({ stepStatuses: pipelineStates.stepStatuses })
            .from(pipelineStates)
            .where(eq(pipelineStates.problemId, safeProblemId))
            .limit(1);

          if (stateRows[0]) {
            const stepStatuses = (stateRows[0].stepStatuses as Record<string, unknown>) || {};
            stepStatuses[stepId] = {
              status: wasStopped ? "failed" : code === 0 ? "completed" : "failed",
              exitCode: wasStopped ? -1 : code ?? 1,
              endTime: Date.now(),
            };
            await db
              .update(pipelineStates)
              .set({ stepStatuses, updatedAt: new Date() })
              .where(eq(pipelineStates.problemId, safeProblemId));
          }
        }

        // Single derivation of problems.status from the run rows (P1-H6),
        // replacing the previous ad-hoc failed/completed writes here. The run
        // row was just marked terminal above, so this reflects reality.
        await recomputeProblemStatus(safeProblemId);

        // Invalidate the pipeline-state GET cache so the dashboard picks up
        // the new step status on its next poll.
        pipelineStateCacheInvalidate(safeProblemId);
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
