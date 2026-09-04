import { NextRequest, NextResponse } from "next/server";
import { readStorageFile } from "@/lib/storage-sync";
import { requireProblemAccess, requireProblemManageAccess } from "@/lib/auth/ownership";
import { requireAuthApi } from "@/lib/auth/server";
import { assertSafeProblemId, assertSafeRelativePath } from "@/lib/storage-path";
import {
  parseCodingQuestionsPayload,
  type CodingQuestionRow,
} from "@/lib/loadings/coding-questions-json";
import { loadCodingQuestions } from "@/lib/loadings/load-coding-questions";
import { missingLoadingsConfig } from "@/lib/loadings/config";
import { extractQuestionsFromUpload } from "@/lib/loadings/upload-input";
import { regenerateQuestionIds } from "@/lib/loadings/regenerate-ids";
import {
  appendLoadLog,
  createLoadRecord,
  finishLoadRecord,
  formatLogLine,
  latestAttemptForProblem,
  latestLoadForProblem,
  runningLoadForProblem,
  type LoadSource,
} from "@/lib/loadings/load-records";

const DEFAULT_PATH = "forJSONPreparation/coding_questions.json";

// A loaded coding_questions.json can bundle testcases, multi-language
// solutions and an editorial for many questions (or arrive zipped, for the
// upload path) — the whole body is held in memory, so cap it generously but
// boundedly rather than leaving it unbounded.
const MAX_BODY_SIZE = 20 * 1024 * 1024; // 20MB

// No load configuration is read from the request. The question set, the unit
// title, its child order and its parent resource are all derived server-side
// by the planner (see `src/lib/loadings/load-coding-questions.ts`), and
// auto-unlock is fixed by the design spec. The only client-supplied values
// left are the questions themselves and `remarks`, and neither reaches a
// Google Sheets cell — so the former USER_ENTERED formula-injection guard on
// the form fields now has nothing to check and is gone with them.
//
// That says no CLIENT-SUPPLIED string reaches a cell. It does NOT say nothing
// untrusted does: `ResourcesData!A2` is written verbatim from the registry
// sheet's own column A (`readRegistry`), which the separate Loadings app also
// writes, so a `=`-prefixed value there would still land as a live formula.
// Guarding that belongs at the registry read, not on request fields that no
// longer exist.

/**
 * Is the flow configured, and (when `problemId` is given) what did this
 * problem last load? Lets the UI hide the button / show the warning instead
 * of failing mid-load.
 *
 * `missing` names unset environment variables, so this needs a session even
 * without a `problemId`: /api is exempt from the proxy's page auth, and an
 * anonymous caller would otherwise learn which credentials this deployment
 * lacks. Both callers (LoadToBeta, the upload page) are signed in.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAuthApi();
  if (auth.error) return auth.error;

  const missing = missingLoadingsConfig();
  const problemId = request.nextUrl.searchParams.get("problemId");
  if (!problemId) {
    return NextResponse.json({ configured: missing.length === 0, missing });
  }

  let safeProblemId: string;
  try {
    safeProblemId = assertSafeProblemId(problemId);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }

  const access = await requireProblemAccess(safeProblemId);
  if (access.error) return access.error;

  const lastLoad = await latestLoadForProblem(safeProblemId);
  // Only worth reporting when the most recent attempt overall actually
  // failed — a completed `lastLoad` already covers the success case, and a
  // still-`running` attempt has nothing useful to say here.
  const lastAttempt = await latestAttemptForProblem(safeProblemId);
  const lastFailedLoad = lastAttempt?.status === "failed" ? lastAttempt : null;
  // A load in flight is invisible in both rows above (`lastLoad` is
  // completed-only, a running attempt is neither completed nor failed), which
  // is what let a remounted panel read "never loaded" and start a second one.
  // Reporting it lets the UI refuse to start another AND re-attach its log
  // panel after a tab switch or a page reload.
  const runningLoad = await runningLoadForProblem(safeProblemId);
  return NextResponse.json({
    configured: missing.length === 0,
    missing,
    lastLoad,
    lastFailedLoad,
    runningLoad,
  });
}

/**
 * Start a coding_questions.json load into NKB beta and return immediately —
 * SHEET_LOADING alone can take several minutes, so the client polls
 * GET /api/loadings/coding-questions/<id> instead of holding this request open.
 *
 * Two input shapes:
 *   - JSON body + `?problemId=` (query): "pipeline" source, reads the
 *     problem's own output file. Requires manage access (this publishes to a
 *     shared beta environment).
 *   - multipart/form-data with a `file` field: "upload" source, the caller
 *     supplies coding_questions.json (or a zip containing it) directly.
 *     Requires only a session — there is no problem to authorise against.
 */
export async function POST(request: NextRequest) {
  const contentLength = parseInt(request.headers.get("content-length") || "0", 10);
  if (contentLength > MAX_BODY_SIZE) {
    return NextResponse.json(
      { error: `Request too large. Max ${MAX_BODY_SIZE / (1024 * 1024)}MB.` },
      { status: 413 },
    );
  }

  const isUpload = (request.headers.get("content-type") || "").includes("multipart/form-data");

  let problemId: string | null = null;
  let userId: string;
  let source: LoadSource;
  let questions: CodingQuestionRow[];
  let remarks: string | null;

  if (isUpload) {
    // Upload flow: no problem to authorise against — a session is enough.
    const auth = await requireAuthApi();
    if (auth.error) return auth.error;
    userId = auth.session.userId;
    source = "upload";

    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "file is required." }, { status: 400 });
    }
    // The content-length pre-check above is only a fast path: HTTP/2 omits
    // that header and chunked transfer-encoding omits it too, so a large
    // body can skip it entirely. `file.size` is accurate once formData() has
    // parsed the body, regardless of transfer encoding — check it before
    // buffering the whole file into memory.
    if (file.size > MAX_BODY_SIZE) {
      return NextResponse.json(
        { error: `File too large. Max ${MAX_BODY_SIZE / (1024 * 1024)}MB.` },
        { status: 413 },
      );
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    try {
      questions = await extractQuestionsFromUpload(buffer, file.name);
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 400 });
    }

    remarks = String(formData.get("remarks") ?? "").trim() || null;
  } else {
    // Pipeline flow: authorise BEFORE reading the body.
    let safeProblemId: string;
    try {
      safeProblemId = assertSafeProblemId(request.nextUrl.searchParams.get("problemId"));
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 400 });
    }

    // Loading publishes to a shared beta environment, so require manage
    // access rather than plain read access.
    const auth = await requireProblemManageAccess(safeProblemId);
    if (auth.error) return auth.error;
    problemId = safeProblemId;
    userId = auth.session.userId;
    source = "pipeline";

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }

    remarks = String(body.remarks ?? "").trim() || null;

    let safePath: string;
    try {
      safePath = assertSafeRelativePath(String(body.path ?? "").trim() || DEFAULT_PATH);
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 400 });
    }

    let raw: string;
    try {
      raw = await readStorageFile(problemId, safePath, "outputs");
    } catch {
      return NextResponse.json({ error: `Output file not found: ${safePath}` }, { status: 404 });
    }

    let parsed: CodingQuestionRow[] | null;
    try {
      parsed = parseCodingQuestionsPayload(JSON.parse(raw));
    } catch (e) {
      return NextResponse.json(
        { error: `Invalid JSON in ${safePath}: ${(e as Error).message}` },
        { status: 400 },
      );
    }
    if (!parsed?.length) {
      return NextResponse.json(
        {
          error:
            "Expected a non-empty array of questions (or an object with a coding_questions / questions / data / items array).",
        },
        { status: 400 },
      );
    }
    questions = parsed;
  }

  // Two gates, deliberately distinct so the UI can tell them apart:
  //   423 — a load for this problem is still running. Remarks do NOT lift it:
  //         a forced second load would race the first for the same childOrder
  //         under the real testing parent, or write the same questions twice.
  //   409 — a load already COMPLETED (below). That one is lifted by remarks,
  //         which is what regenerates the ids for a deliberate second copy.
  // ponytail: check-then-insert, so two POSTs landing in the same millisecond
  // can both pass. Closing that needs a partial unique index on
  // (problem_id) WHERE status = 'running' — a schema change. This gate already
  // covers the real case (one operator, two tabs / a remounted panel).
  if (problemId) {
    const running = await runningLoadForProblem(problemId);
    if (running) {
      return NextResponse.json(
        {
          error:
            "A load for this problem is already running. Watch it finish before starting another — starting a second one now would load into beta twice.",
          loadId: running.id,
        },
        { status: 423 },
      );
    }
  }

  if (problemId && !remarks) {
    const last = await latestLoadForProblem(problemId);
    if (last) {
      return NextResponse.json(last, { status: 409 });
    }
  }

  if (remarks) {
    questions = regenerateQuestionIds(questions);
  }

  const loadId = await createLoadRecord({ problemId, userId, source, remarks });

  // Deliberately not awaited: the load runs for minutes and the client polls
  // GET .../[id] for status. Every promise started here MUST end in a
  // .catch() — an unhandled rejection in a fire-and-forget promise kills the
  // whole Node process, not just this request (Node 15+ default).
  void (async () => {
    try {
      const result = await loadCodingQuestions(questions, {
        // Ids were just regenerated when remarks are present, so they cannot
        // collide with anything already in beta.
        skipDuplicateCheck: Boolean(remarks),
        onLog: (phase, message) => {
          appendLoadLog(loadId, formatLogLine(phase, message)).catch((err) =>
            console.error("[Loadings] appendLoadLog failed:", (err as Error).message),
          );
        },
      });
      // A load can split across several question sets, and every one of them
      // belongs in the audit row: recording only the last batch under-reported
      // both the sets written to and the questions loaded. `question_set_id`
      // is a single text column, so multiple sets are joined — the registry
      // sheet can legitimately list an id twice, hence the de-dupe.
      const { batches } = result;
      const questionSetIds = [...new Set(batches.map((b) => b.questionSetId))];
      // Only meaningful for the success-summary log (see `finishLoadRecord`)
      // — computed regardless of outcome since it's cheap, but ignored there
      // unless `status` is "completed".
      const orderRange = batches.length
        ? {
            start: Math.min(...batches.map((b) => b.orderStart)),
            end: Math.max(...batches.map((b) => b.orderStart + b.questionCount - 1)),
          }
        : null;
      await finishLoadRecord(loadId, {
        status: result.success ? "completed" : "failed",
        questionSetId: questionSetIds.join(", ") || null,
        questionIds: batches.flatMap((b) => b.questionIds),
        // On failure the loop stops at the failed batch, so the last batch's
        // task output is the one worth linking to.
        taskOutputUrl: batches[batches.length - 1]?.taskOutputUrl ?? null,
        error: result.error ?? null,
        orderRange,
      });
    } catch (e) {
      const message = (e as Error).message;
      // Do NOT await the log write here: finishLoadRecord must run even if
      // this rejects, or a transient DB blip strands the row at "running"
      // forever (no reaper polls it back to a terminal state).
      appendLoadLog(loadId, formatLogLine("error", message)).catch((err) =>
        console.error("[Loadings] appendLoadLog failed:", (err as Error).message),
      );
      await finishLoadRecord(loadId, { status: "failed", error: message });
    }
  })().catch((err) => {
    console.error("[Loadings] background coding-question load failed:", (err as Error).message);
  });

  return NextResponse.json({ loadId });
}
