import { NextRequest, NextResponse } from "next/server";
import { readStorageFile } from "@/lib/storage-sync";
import { requireProblemManageAccess } from "@/lib/auth/ownership";
import { assertSafeProblemId, assertSafeRelativePath } from "@/lib/storage-path";
import { parseCodingQuestionsPayload } from "@/lib/loadings/coding-questions-json";
import { loadCodingQuestions, type LoadForm } from "@/lib/loadings/load-coding-questions";
import { missingLoadingsConfig } from "@/lib/loadings/config";

const DEFAULT_PATH = "forJSONPreparation/coding_questions.json";

/** Is the flow configured? Lets the UI hide the button instead of failing mid-load. */
export async function GET() {
  const missing = missingLoadingsConfig();
  return NextResponse.json({ configured: missing.length === 0, missing });
}

/**
 * Load a problem's coding_questions.json into NKB beta. Runs to completion —
 * SHEET_LOADING alone can take several minutes.
 */
export async function POST(request: NextRequest) {
  let safeProblemId: string;
  try {
    safeProblemId = assertSafeProblemId(request.nextUrl.searchParams.get("problemId"));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }

  // Loading publishes to a shared beta environment, so require manage access
  // rather than plain read access.
  const auth = await requireProblemManageAccess(safeProblemId);
  if (auth.error) return auth.error;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const str = (key: string) => String(body[key] ?? "").trim();
  const form: LoadForm = {
    sheetName: str("sheetName"),
    childOrder: str("childOrder"),
    parentResource: str("parentResource"),
    autoUnlock: str("autoUnlock"),
    title: str("title"),
    commonUnitId: str("commonUnitId") || undefined,
    durationInSec: str("durationInSec") || undefined,
  };
  const required: (keyof LoadForm)[] = [
    "sheetName",
    "childOrder",
    "parentResource",
    "autoUnlock",
    "title",
  ];
  const missingFields = required.filter((k) => !form[k]);
  if (missingFields.length) {
    return NextResponse.json(
      { error: `Missing required field(s): ${missingFields.join(", ")}` },
      { status: 400 },
    );
  }

  let safePath: string;
  try {
    safePath = assertSafeRelativePath(str("path") || DEFAULT_PATH);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }

  let raw: string;
  try {
    raw = await readStorageFile(safeProblemId, safePath, "outputs");
  } catch {
    return NextResponse.json({ error: `Output file not found: ${safePath}` }, { status: 404 });
  }

  let questions;
  try {
    questions = parseCodingQuestionsPayload(JSON.parse(raw));
  } catch (e) {
    return NextResponse.json(
      { error: `Invalid JSON in ${safePath}: ${(e as Error).message}` },
      { status: 400 },
    );
  }
  if (!questions?.length) {
    return NextResponse.json(
      {
        error:
          "Expected a non-empty array of questions (or an object with a coding_questions / questions / data / items array).",
      },
      { status: 400 },
    );
  }

  try {
    const result = await loadCodingQuestions(questions, form);
    return NextResponse.json(result, { status: result.success ? 200 : 500 });
  } catch (e) {
    console.error("[Loadings] coding question load failed:", e);
    return NextResponse.json({ error: (e as Error).message || "Load failed." }, { status: 500 });
  }
}
