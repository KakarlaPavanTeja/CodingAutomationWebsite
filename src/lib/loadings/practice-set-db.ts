/**
 * Question-set registry backed by a Google Sheet (A = question_set_id, B = unit_name).
 *
 * Reuse any set that still has room (< 50 questions in beta admin); mint and
 * append new ids only when every set in the sheet is full.
 *
 * Ported from the Loadings app (lib/coding-practice-set-sheet-db.js). Unlike
 * the original, a batch larger than the remaining room is split across sets
 * instead of overflowing one past 50.
 */

import { randomUUID } from "crypto";
import { PRACTICE_SET_SHEET_GID, PRACTICE_SET_SHEET_ID, QUESTION_SET_MAX } from "./config";
import {
  appendValues,
  batchUpdateCells,
  ensureTab,
  getValues,
  quoteRange,
  resolveTabTitle,
  spreadsheetEditUrl,
} from "./google-sheets";
import { DjangoAdminSession } from "./django-admin";
import { capacityFromLookup, lookupQuestionSetQuestions } from "./question-set";

const HEADER = ["question_set_id", "unit_name"];

export const PRACTICE_SET_SHEET_URL = spreadsheetEditUrl(PRACTICE_SET_SHEET_ID);

export interface RegistryRow {
  rowNumber: number;
  questionSetId: string;
  unitName: string;
}

let cachedTabTitle = "";

async function registryTab(): Promise<string> {
  if (cachedTabTitle) return cachedTabTitle;
  const title = await resolveTabTitle(PRACTICE_SET_SHEET_ID, PRACTICE_SET_SHEET_GID);
  await ensureTab(PRACTICE_SET_SHEET_ID, title, HEADER);
  cachedTabTitle = title;
  return title;
}

export async function readRegistry(): Promise<RegistryRow[]> {
  const tab = await registryTab();
  const values = await getValues(PRACTICE_SET_SHEET_ID, quoteRange(tab, "A2:B"));
  const rows: RegistryRow[] = [];
  values.forEach((row, idx) => {
    const questionSetId = String(row?.[0] || "").trim();
    if (!questionSetId) return;
    rows.push({ rowNumber: idx + 2, questionSetId, unitName: String(row?.[1] || "").trim() });
  });
  return rows;
}

/** Update column B for a known set id, or append a new row. Never overwrites other ids. */
export async function upsertRegistryRow(
  questionSetId: string,
  unitName = "",
): Promise<RegistryRow> {
  const setId = String(questionSetId || "").trim();
  if (!setId) throw new Error("question_set_id is required to write the registry sheet.");
  const name = String(unitName || "").trim();
  const tab = await registryTab();
  const rows = await readRegistry();
  const existing = rows.find((r) => r.questionSetId.toLowerCase() === setId.toLowerCase());

  if (existing) {
    if (name && name !== existing.unitName) {
      await batchUpdateCells(PRACTICE_SET_SHEET_ID, [
        { range: quoteRange(tab, `B${existing.rowNumber}`), values: [[name]] },
      ]);
    }
    return { ...existing, unitName: name || existing.unitName };
  }

  await appendValues(PRACTICE_SET_SHEET_ID, quoteRange(tab, "A:B"), [[setId, name]]);
  return { rowNumber: rows.length + 2, questionSetId: setId, unitName: name };
}

export interface LoadBatch {
  questionSetId: string;
  /** Slice of the uploaded questions this set receives. */
  startIndex: number;
  count: number;
  orderStart: number;
  existingCount: number;
  /**
   * An empty set needs the sheet template + SHEET_LOADING to create the unit;
   * a set that already has questions only needs JSON_LOADING.
   */
  loadVia: "sheet" | "json";
  isNewSet: boolean;
}

/**
 * Split `total` questions across registry sets with room, minting new sets when
 * the registry is exhausted. Every returned batch fits inside the 50-per-set cap.
 */
export async function planQuestionSetBatches(
  total: number,
  unitName = "",
): Promise<{ batches: LoadBatch[]; registryRows: number }> {
  if (total <= 0) return { batches: [], registryRows: 0 };

  const rows = await readRegistry();
  const admin = new DjangoAdminSession();
  const batches: LoadBatch[] = [];
  let placed = 0;

  for (const row of rows) {
    if (placed >= total) break;
    let capacity;
    try {
      capacity = capacityFromLookup(await lookupQuestionSetQuestions(row.questionSetId, admin));
    } catch (err) {
      console.warn(
        `[Loadings] question set lookup failed for ${row.questionSetId}:`,
        (err as Error).message,
      );
      continue;
    }
    if (capacity.room <= 0) continue;

    const count = Math.min(total - placed, capacity.room);
    const existingCount = QUESTION_SET_MAX - capacity.room;
    batches.push({
      questionSetId: row.questionSetId,
      startIndex: placed,
      count,
      orderStart: capacity.nextOrder,
      existingCount,
      loadVia: existingCount === 0 ? "sheet" : "json",
      isNewSet: false,
    });
    placed += count;
  }

  while (placed < total) {
    const questionSetId = randomUUID();
    const count = Math.min(total - placed, QUESTION_SET_MAX);
    await upsertRegistryRow(questionSetId, unitName);
    batches.push({
      questionSetId,
      startIndex: placed,
      count,
      orderStart: 1,
      existingCount: 0,
      loadVia: "sheet",
      isNewSet: true,
    });
    placed += count;
  }

  return { batches, registryRows: rows.length };
}
