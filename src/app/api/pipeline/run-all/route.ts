import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { pipelineRuns, pipelineStates, problems } from "@/lib/db/schema";
import { requireProblemAccess, requireProblemManageAccess } from "@/lib/auth/ownership";
import { assertSafeProblemId } from "@/lib/storage-path";
import { pipelineStateCacheInvalidate } from "@/lib/pipeline-state-cache";
import { LANGUAGES, getPipelineUiWorkflowSteps } from "@/lib/pipeline-config";
import {
  getTitlesSubStepStatus,
  packagingTitleResolvable,
  titleGatedSteps,
  titleSkipReason,
} from "@/lib/pipeline-title";
import { advanceQueue } from "@/lib/pipeline/advance-queue";
import { clearQueue, readQueue, writeQueue } from "@/lib/pipeline/queue-store";
import { deriveParentStatuses, stepStatesFromRuns } from "@/lib/pipeline/step-states-from-runs";
import type { GQSubStepContext } from "@/lib/pipeline-question";
import type { PipelineMode, QuestionType, StepId } from "@/types/pipeline";

interface GlobalCfg {
  ownerTitle?: string;
  generateTitleWithAi?: boolean;
  defaultTagNames?: string;
}

/**
 * Start a server-owned "Run all".
 *
 * The queue this builds is the same one the browser used to build and hold in
 * React state — same workflow list, same "not yet completed" filter, same
 * title-gating. The difference is where it lives: on `pipeline_states`, so a
 * refresh, a closed tab or a sleeping laptop cannot lose it.
 */
export async function POST(request: NextRequest) {
  let body: { problemId?: string; steps?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  if (
    body.steps !== undefined &&
    (!Array.isArray(body.steps) || body.steps.some((s) => typeof s !== "string"))
  ) {
    return NextResponse.json({ error: "Invalid steps" }, { status: 400 });
  }
  const requested = body.steps as string[] | undefined;

  let safeProblemId: string;
  try {
    safeProblemId = assertSafeProblemId(body.problemId);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }

  // Authorise before reading anything about the problem.
  const auth = await requireProblemManageAccess(safeProblemId);
  if (auth.error) return auth.error;

  // A queue already in flight: refuse rather than start a second one, so a
  // double click cannot run every step twice.
  if (await readQueue(safeProblemId)) {
    return NextResponse.json({ error: "A run is already in progress" }, { status: 409 });
  }

  const probRows = await db
    .select({
      questionType: problems.questionType,
      mode: problems.mode,
      difficulty: problems.difficulty,
    })
    .from(problems)
    .where(eq(problems.id, safeProblemId))
    .limit(1);
  if (!probRows[0]) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const questionType = probRows[0].questionType as QuestionType;
  const mode = probRows[0].mode as PipelineMode;

  const stateRows = await db
    .select({
      enabledLanguages: pipelineStates.enabledLanguages,
      stepConfigs: pipelineStates.stepConfigs,
      stepStatuses: pipelineStates.stepStatuses,
    })
    .from(pipelineStates)
    .where(eq(pipelineStates.problemId, safeProblemId))
    .limit(1);
  // A brand-new problem may have no pipeline_states row yet: the page writes
  // one when something changes, so Run All can legitimately arrive first. The
  // queue is stored ON that row via UPDATE, so without it the queue would be
  // silently discarded and nothing would ever run. Create it with the same
  // defaults the client starts from.
  //
  // enabled_languages is set explicitly: the column's DB default holds display
  // LABELS ('Python', 'Node.js') while every consumer matches on ids
  // ('python', 'nodejs'), so letting the default apply yields a language set
  // that nothing recognises.
  const defaultLanguages = LANGUAGES.filter((l) => l.defaultEnabled).map((l) => l.id);
  if (!stateRows[0]) {
    await db
      .insert(pipelineStates)
      .values({
        problemId: safeProblemId,
        userId: auth.session.userId,
        questionType,
        mode,
        enabledLanguages: defaultLanguages,
      })
      .onConflictDoNothing();
    pipelineStateCacheInvalidate(safeProblemId);
  }
  const languages = stateRows[0]?.enabledLanguages ?? defaultLanguages;
  const stepConfigs = (stateRows[0]?.stepConfigs as Record<string, unknown>) ?? {};
  const globalCfg = (stepConfigs["__global__"] as GlobalCfg | undefined) ?? {};
  const ownerTitle = globalCfg.ownerTitle?.trim() ?? "";
  const generateTitleWithAi = globalCfg.generateTitleWithAi ?? false;

  const gqContext: GQSubStepContext = {
    questionType,
    mode,
    languages,
    generateTitleWithAi,
    ownerTitle,
    ownerDifficulty: probRows[0].difficulty ?? "",
  };

  const runRows = await db
    .select({
      id: pipelineRuns.id,
      stepId: pipelineRuns.stepId,
      status: pipelineRuns.status,
      exitCode: pipelineRuns.exitCode,
      startedAt: pipelineRuns.startedAt,
      finishedAt: pipelineRuns.finishedAt,
    })
    .from(pipelineRuns)
    .where(eq(pipelineRuns.problemId, safeProblemId));

  const stepStates = deriveParentStatuses(stepStatesFromRuns(runRows), {
    questionType,
    gqContext,
    languages,
  });

  const workflow = getPipelineUiWorkflowSteps(questionType, mode);

  // Two ways in. "Run all" queues every workflow step that isn't already done
  // (a step with no run row has never run, so it counts as incomplete).
  // "Re-run affected" names its steps explicitly — those go in even when their
  // newest run says `completed`, because that completion is the stale result
  // being replaced, so they are also the `force` list. Workflow order is
  // imposed here either way; the caller's ordering is not trusted.
  const incomplete = requested
    ? workflow.filter((id) => requested.includes(id))
    : workflow.filter((id) => stepStates.get(id)?.status !== "completed");

  // Packaging steps need a title. Without one, they and their editorial
  // dependents are marked "skipped" (visible in the UI, reason in the log)
  // instead of silently dropped — dropping only the packaging steps used to
  // leave the dependents queued forever behind a prerequisite that never ran.
  const titleResolvable = packagingTitleResolvable({
    ownerTitle,
    generateTitleWithAi,
    titlesSubStepStatus: getTitlesSubStepStatus(stepStates.get("generate_question")?.subStepRuns),
    generateQuestionStillQueued: incomplete.includes("generate_question"),
  });
  const gated = titleResolvable ? new Set<StepId>() : titleGatedSteps(incomplete);

  if (gated.size > 0) {
    // `pipeline_runs.status` only allows running/completed/failed, so a skip
    // cannot be a run row. It goes where the client put it: step_statuses.
    const stepStatuses = (stateRows[0].stepStatuses as Record<string, unknown>) ?? {};
    const now = Date.now();
    for (const id of gated) {
      stepStatuses[id] = {
        status: "skipped",
        exitCode: null,
        endTime: now,
        reason: titleSkipReason(id),
      };
    }
    await db
      .update(pipelineStates)
      .set({ stepStatuses, updatedAt: new Date() })
      .where(eq(pipelineStates.problemId, safeProblemId));
    pipelineStateCacheInvalidate(safeProblemId);
  }

  const steps = incomplete.filter((id) => !gated.has(id));
  if (steps.length === 0) {
    return NextResponse.json({ queued: [], skipped: [...gated] });
  }

  await writeQueue(safeProblemId, {
    steps,
    questionType,
    mode,
    gqContext,
    userId: auth.session.userId,
    force: requested ? steps : undefined,
    startedAt: new Date().toISOString(),
  });

  // Kick it off. Everything after this is driven by each step's close handler.
  const result = await advanceQueue(safeProblemId);

  return NextResponse.json({ queued: steps, launched: result.launched, skipped: [...gated] });
}

/**
 * Cancel an in-flight Run All.
 *
 * Only the queue is dropped: steps already spawned keep running to completion,
 * exactly as cancelling did on the client. Stopping a running step is what the
 * per-step Stop button is for.
 */
export async function DELETE(request: NextRequest) {
  const problemId = request.nextUrl.searchParams.get("problemId");

  let safeProblemId: string;
  try {
    safeProblemId = assertSafeProblemId(problemId);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }

  const auth = await requireProblemManageAccess(safeProblemId);
  if (auth.error) return auth.error;

  await clearQueue(safeProblemId);
  return NextResponse.json({ cancelled: true });
}

/** The in-flight queue for a problem, for the client to observe. */
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

  const queue = await readQueue(safeProblemId);
  return NextResponse.json({ active: queue !== null, steps: queue?.steps ?? [] });
}
