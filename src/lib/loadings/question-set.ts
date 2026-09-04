/**
 * How full is a question_set_id? Answered by scraping the beta Django admin
 * changelist for Nkb_Question -> Question set questions.
 *
 * Ported from the Loadings app (lib/question-set-admin-http.js).
 */

import { QUESTION_SET_MAX } from "./config";
import { DjangoAdminSession, extractResultListSection } from "./django-admin";

const QUESTIONSETQUESTION_PATH = "nkb_question/questionsetquestion/";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface QuestionSetRow {
  questionSetId: string;
  questionId: string;
  order: number;
}

function decodeCellText(html: string): string {
  return String(html || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Columns are identified by shape, not position: UUID cells are the set/question
 * ids, and the first plain integer cell is the order.
 */
export function parseQuestionSetQuestionRows(html: string, questionSetId: string): QuestionSetRow[] {
  const target = String(questionSetId || "").trim().toLowerCase();
  const section = extractResultListSection(html);
  const rows: QuestionSetRow[] = [];
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let tr: RegExpExecArray | null;

  while ((tr = trRe.exec(section)) !== null) {
    const chunk = tr[1];
    if (/There are no|0 question/i.test(chunk)) continue;
    const cells = [...chunk.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) =>
      decodeCellText(c[1]),
    );
    if (!cells.length) continue;

    const uuids = cells.filter((c) => UUID_RE.test(c));
    const setIdCell = uuids.find((u) => u.toLowerCase() === target) || uuids[0] || "";
    if (target && setIdCell.toLowerCase() !== target) continue;

    const questionId = uuids.find((u) => u.toLowerCase() !== setIdCell.toLowerCase()) || "";
    let order = 0;
    for (const cell of cells) {
      if (UUID_RE.test(cell)) continue;
      if (/^(True|False|Yes|No)$/i.test(cell)) continue;
      if (/^\d+$/.test(cell)) {
        order = parseInt(cell, 10);
        break;
      }
    }
    rows.push({ questionSetId: setIdCell || questionSetId, questionId, order });
  }
  return rows;
}

export interface QuestionSetLookup {
  count: number;
  maxOrder: number;
  questionIds: string[];
}

export async function lookupQuestionSetQuestions(
  questionSetId: string,
  session?: DjangoAdminSession,
): Promise<QuestionSetLookup> {
  const setId = String(questionSetId || "").trim();
  if (!setId) return { count: 0, maxOrder: 0, questionIds: [] };

  const admin = session ?? new DjangoAdminSession();
  const allRows: QuestionSetRow[] = [];
  const maxPages = 25;

  for (let page = 0; page < maxPages; page++) {
    const url =
      `${admin.adminBase}${QUESTIONSETQUESTION_PATH}?q=${encodeURIComponent(setId)}` +
      (page > 0 ? `&p=${page}` : "");
    const html = await admin.fetchHtml(url);
    const rows = parseQuestionSetQuestionRows(html, setId);
    allRows.push(...rows);

    const hasNext =
      /<a\b[^>]*>\s*Next\s*<\/a>/i.test(html) ||
      /class=['"][^'"]*\bnext\b[^'"]*['"][^>]*>\s*Next/i.test(html);
    if (!hasNext || !rows.length) break;
  }

  let maxOrder = 0;
  const questionIds: string[] = [];
  for (const row of allRows) {
    if (row.order > maxOrder) maxOrder = row.order;
    if (row.questionId) questionIds.push(row.questionId);
  }
  return { count: allRows.length, maxOrder, questionIds };
}

export interface SetCapacity {
  room: number;
  nextOrder: number;
  full: boolean;
}

export function capacityFromLookup(lookup: QuestionSetLookup): SetCapacity {
  return {
    room: Math.max(0, QUESTION_SET_MAX - lookup.count),
    nextOrder: lookup.maxOrder > 0 ? lookup.maxOrder + 1 : 1,
    full: lookup.count >= QUESTION_SET_MAX,
  };
}

export interface ExistingQuestion {
  questionId: string;
  questionSetIds: string[];
}

/**
 * Which question set(s) in beta already hold this question id?
 *
 * The same changelist `lookupQuestionSetQuestions` scrapes is searchable by
 * QUESTION id as well as set id (verified against the live beta admin: a known
 * id returns its one row, an unknown one returns "0 question set questions").
 * `parseQuestionSetQuestionRows` matches the cell equal to the search term, so
 * with a question id as the term the row's OTHER uuid — the field it calls
 * `questionId` — is the set that holds it.
 */
export async function findQuestionSetsForQuestionId(
  questionId: string,
  session?: DjangoAdminSession,
): Promise<string[]> {
  const id = String(questionId || "").trim();
  if (!id) return [];
  const admin = session ?? new DjangoAdminSession();
  const html = await admin.fetchHtml(
    `${admin.adminBase}${QUESTIONSETQUESTION_PATH}?q=${encodeURIComponent(id)}`,
  );
  return parseQuestionSetQuestionRows(html, id)
    .map((row) => row.questionId)
    .filter(Boolean);
}

/**
 * Pre-flight duplicate check: which of these question ids are already in beta?
 *
 * The backend rejects a re-load of an existing question id, and says nothing
 * useful about why, ~70s in. `lookup` is injected so the decision logic is
 * testable without the admin; the default shares one logged-in session across
 * all ids.
 */
export async function findAlreadyLoadedQuestions(
  questionIds: string[],
  lookup?: (questionId: string) => Promise<string[]>,
): Promise<ExistingQuestion[]> {
  const ids = [...new Set(questionIds.map((id) => String(id || "").trim()).filter(Boolean))];
  if (!ids.length) return [];
  const session = lookup ? null : new DjangoAdminSession();
  const find = lookup ?? ((id: string) => findQuestionSetsForQuestionId(id, session!));

  const existing: ExistingQuestion[] = [];
  for (const id of ids) {
    const questionSetIds = await find(id);
    if (questionSetIds.length) existing.push({ questionId: id, questionSetIds });
  }
  return existing;
}

/** What the operator is told when the pre-flight finds the ids already in beta. */
export function alreadyLoadedMessage(existing: ExistingQuestion[]): string {
  const named = existing
    .map((e) =>
      e.questionSetIds.length
        ? `${e.questionId} (in question set ${e.questionSetIds.join(", ")})`
        : e.questionId,
    )
    .join("; ");
  return (
    `${existing.length} question id(s) are already loaded in beta: ${named}. ` +
    "The backend rejects a duplicate id, so this load would fail. " +
    'Tick "Load anyway (regenerate ids)", add remarks and retry to load a fresh copy with new ids.'
  );
}
