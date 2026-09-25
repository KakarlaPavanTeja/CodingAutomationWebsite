import { NextRequest, NextResponse } from "next/server";
import { requireProblemAccess } from "@/lib/auth/ownership";
import { assertSafeProblemId } from "@/lib/storage-path";
import { readStorageFile } from "@/lib/storage-sync";
import { renderRevisionNotesImage } from "@/lib/revision-notes/render";
import {
  parseRevisionNotes,
  REVISION_NOTES_FILE,
  revisionPages,
  type RevisionNotes,
} from "@/lib/revision-notes/types";

/** Unsaved notes posted for a preview are tiny; anything bigger is not notes. */
const MAX_PREVIEW_BYTES = 64 * 1024;

type Ctx = { params: Promise<{ id: string }> };

async function authorize(params: Ctx["params"]) {
  let problemId: string;
  try {
    problemId = assertSafeProblemId((await params).id);
  } catch (e) {
    return { error: NextResponse.json({ error: (e as Error).message }, { status: 400 }) };
  }
  const auth = await requireProblemAccess(problemId);
  if (auth.error) return { error: auth.error };
  return { problemId };
}

function fileName(notes: RevisionNotes, pageNo: number): string {
  const slug = notes.title.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "").slice(0, 60);
  return `${slug || "revision_notes"}_revision_notes_${pageNo}.png`;
}

/** `?page=` is 1-based; pages are listed by `revisionPages`. */
async function render(notes: RevisionNotes, request: NextRequest) {
  const pages = revisionPages(notes);
  const pageNo = Number(request.nextUrl.searchParams.get("page") ?? "1");
  if (!Number.isInteger(pageNo) || pageNo < 1 || pageNo > pages.length) {
    return NextResponse.json({ error: `No page ${pageNo} (these notes have ${pages.length})` }, { status: 404 });
  }
  const download = request.nextUrl.searchParams.get("download") === "1";
  try {
    return await renderRevisionNotesImage(notes, pages[pageNo - 1], {
      // Notes change whenever a reviewer edits or regenerates them.
      "Cache-Control": "private, no-store",
      "X-Revision-Pages": String(pages.length),
      ...(download ? { "Content-Disposition": `attachment; filename="${fileName(notes, pageNo)}"` } : {}),
    });
  } catch (err) {
    console.error("[revision-notes] render failed:", err);
    return NextResponse.json({ error: "Failed to render the revision notes image" }, { status: 500 });
  }
}

/** GET — one page of the saved revision notes as a PNG (`?page=1`, `?download=1`). */
export async function GET(request: NextRequest, { params }: Ctx) {
  const auth = await authorize(params);
  if ("error" in auth) return auth.error;

  let raw: string;
  try {
    raw = await readStorageFile(auth.problemId, REVISION_NOTES_FILE);
  } catch {
    return NextResponse.json({ error: "No revision notes yet" }, { status: 404 });
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: `${REVISION_NOTES_FILE} is not valid JSON` }, { status: 422 });
  }
  const parsed = parseRevisionNotes(json);
  if (!parsed.ok) {
    return NextResponse.json({ error: "Invalid revision notes", details: parsed.errors }, { status: 422 });
  }
  return render(parsed.notes, request);
}

/** POST — preview one page of unsaved notes (body: the notes object, `?page=`) without storing them. */
export async function POST(request: NextRequest, { params }: Ctx) {
  const auth = await authorize(params);
  if ("error" in auth) return auth.error;

  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > MAX_PREVIEW_BYTES) {
    return NextResponse.json({ error: "Request too large." }, { status: 413 });
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const parsed = parseRevisionNotes(json);
  if (!parsed.ok) {
    return NextResponse.json({ error: "Invalid revision notes", details: parsed.errors }, { status: 422 });
  }
  return render(parsed.notes, request);
}
