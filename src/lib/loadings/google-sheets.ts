/**
 * Minimal Drive/Sheets REST client for the loading flow.
 *
 * Uses google-auth-library (already a dependency) + fetch rather than the full
 * `googleapis` package — this flow needs six endpoints.
 *
 * Credentials come from GOOGLE_SERVICE_ACCOUNT_JSON (inline JSON) or
 * GOOGLE_APPLICATION_CREDENTIALS (file path).
 */

import { GoogleAuth } from "google-auth-library";

const SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive",
];

let _auth: GoogleAuth | null = null;

function getAuth(): GoogleAuth {
  if (_auth) return _auth;
  const inline = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  if (inline) {
    _auth = new GoogleAuth({ credentials: JSON.parse(inline), scopes: SCOPES });
    return _auth;
  }
  const keyFile = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  if (!keyFile) {
    throw new Error(
      "Google Sheets access requires GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_APPLICATION_CREDENTIALS.",
    );
  }
  _auth = new GoogleAuth({ keyFile, scopes: SCOPES });
  return _auth;
}

/** Google returns 429/5xx under load; dying on one of those wastes a whole run. */
const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 4;

async function googleFetch(url: string, init: RequestInit = {}): Promise<unknown> {
  let lastError = new Error("Google API request never ran");

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, 500 * 2 ** (attempt - 1)));
    }

    const token = await getAuth().getAccessToken();
    let res: Response;
    try {
      res = await fetch(url, {
        ...init,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          ...(init.headers || {}),
        },
      });
    } catch (e) {
      // Network-level failure (DNS, reset) — same transient class as a 503.
      lastError = new Error(`Google API request failed: ${(e as Error).message}`);
      continue;
    }

    const text = await res.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { raw: text };
    }
    if (res.ok) return body;

    const err = body as { error?: { message?: string } } | null;
    lastError = new Error(
      `Google API ${res.status}: ${err?.error?.message || text || `HTTP ${res.status}`}`,
    );
    if (!RETRY_STATUSES.has(res.status)) throw lastError;
  }

  throw lastError;
}

export function spreadsheetIdFromUrl(url: string): string {
  const m = String(url || "").match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : "";
}

export function spreadsheetEditUrl(spreadsheetId: string): string {
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
}

/** Sheet titles may contain spaces/quotes, so every range is quoted. */
export function quoteRange(sheetTitle: string, a1: string): string {
  return `'${String(sheetTitle).replace(/'/g, "''")}'!${a1}`;
}

export async function copySpreadsheet(
  templateId: string,
  newTitle: string,
): Promise<{ spreadsheetId: string; url: string }> {
  const body = (await googleFetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(templateId)}/copy?supportsAllDrives=true`,
    { method: "POST", body: JSON.stringify({ name: newTitle }) },
  )) as { id?: string };
  if (!body?.id) throw new Error("Drive files.copy did not return a spreadsheet id");
  return { spreadsheetId: body.id, url: spreadsheetEditUrl(body.id) };
}

function defaultShareEmails(): string[] {
  return (process.env.GOOGLE_SHEET_SHARE_EMAILS || "")
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);
}

/** Best-effort — a copy the team cannot open is still a usable load. */
export async function shareSpreadsheet(spreadsheetId: string, emails?: string[]): Promise<void> {
  for (const email of emails?.length ? emails : defaultShareEmails()) {
    try {
      await googleFetch(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(spreadsheetId)}/permissions?sendNotificationEmail=false&supportsAllDrives=true`,
        {
          method: "POST",
          body: JSON.stringify({ type: "user", role: "writer", emailAddress: email }),
        },
      );
    } catch (err) {
      console.warn(`[Sheets] could not share with ${email}:`, (err as Error).message);
    }
  }
}

export interface CellUpdate {
  range: string;
  values: (string | number)[][];
}

export async function batchUpdateCells(
  spreadsheetId: string,
  updates: CellUpdate[],
): Promise<void> {
  const data = updates.filter((u) => u?.range && Array.isArray(u.values));
  if (!data.length) return;
  await googleFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values:batchUpdate`,
    { method: "POST", body: JSON.stringify({ valueInputOption: "USER_ENTERED", data }) },
  );
}

export async function clearValues(spreadsheetId: string, rangeA1: string): Promise<void> {
  await googleFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(rangeA1)}:clear`,
    { method: "POST", body: "{}" },
  );
}

export async function getValues(spreadsheetId: string, rangeA1: string): Promise<string[][]> {
  const body = (await googleFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(rangeA1)}`,
  )) as { values?: string[][] };
  return body?.values || [];
}

export async function appendValues(
  spreadsheetId: string,
  rangeA1: string,
  values: (string | number)[][],
): Promise<void> {
  if (!values.length) return;
  await googleFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(rangeA1)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    { method: "POST", body: JSON.stringify({ values }) },
  );
}

interface SheetProps {
  properties?: { sheetId?: number; title?: string };
}

async function sheetProperties(spreadsheetId: string): Promise<SheetProps[]> {
  const body = (await googleFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=${encodeURIComponent("sheets.properties(sheetId,title)")}`,
  )) as { sheets?: SheetProps[] };
  return body?.sheets || [];
}

/** Tab title for a gid, falling back to the first tab. */
export async function resolveTabTitle(spreadsheetId: string, gid: number): Promise<string> {
  const sheets = await sheetProperties(spreadsheetId);
  const byGid = sheets.find((s) => Number(s.properties?.sheetId) === Number(gid));
  const title = byGid?.properties?.title ?? sheets[0]?.properties?.title;
  if (!title) throw new Error(`Spreadsheet ${spreadsheetId} has no tabs`);
  return title;
}

/** Create the tab if missing and write the header row when it is absent. */
export async function ensureTab(
  spreadsheetId: string,
  title: string,
  header: string[],
): Promise<void> {
  const sheets = await sheetProperties(spreadsheetId);
  if (!sheets.some((s) => s.properties?.title === title)) {
    await googleFetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`,
      {
        method: "POST",
        body: JSON.stringify({ requests: [{ addSheet: { properties: { title } } }] }),
      },
    );
  }
  if (!header.length) return;
  const headRange = quoteRange(title, `A1:${columnLetter(header.length)}1`);
  const existing = await getValues(spreadsheetId, headRange);
  if (!existing[0] || existing[0][0] !== header[0]) {
    await batchUpdateCells(spreadsheetId, [{ range: headRange, values: [header] }]);
  }
}

function columnLetter(index: number): string {
  let n = index;
  let s = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s || "A";
}
