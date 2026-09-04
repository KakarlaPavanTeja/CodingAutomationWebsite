import { NextRequest, NextResponse } from "next/server";
import { STEP_CONFIGS, LANGUAGES } from "@/lib/pipeline-config";
import { requireProblemAccess } from "@/lib/auth/ownership";
import { assertSafeProblemId } from "@/lib/storage-path";
import { startStep } from "./start-step";
import type { RunRequest, StepId } from "@/types/pipeline";

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

  const result = await startStep({
    problemId: safeProblemId,
    userId: auth.session.userId,
    stepId: stepId as StepId,
    mode,
    subSteps,
    languages,
    testcaseCount: testcaseCount ?? undefined,
    runKey,
    refineNote,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    runId: result.runId,
    stepId: result.stepId,
    status: "running",
    logFile: `logs/${stepId}.log`,
  });
}
