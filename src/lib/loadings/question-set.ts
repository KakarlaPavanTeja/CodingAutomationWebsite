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
