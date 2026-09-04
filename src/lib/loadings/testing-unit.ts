import { randomUUID } from "crypto";
import { DjangoAdminSession, extractResultListSection } from "./django-admin";

// No import from ./practice-set-db — that module imports this one, and the
// cycle breaks at runtime. Existing unit names arrive as an argument instead.

const PARENT_RESOURCE_THROUGH_PATH = "nkb_resources/resourceparentresourcethroughmodel/";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
 * Child units of `parentResource`, as rows with a synthetic header whose
 * third column is "unit_order" so `nextChildOrder` reads them unchanged.
 *
 * Scrapes nkb_resources/resourceparentresourcethroughmodel/, whose changelist
 * columns are [checkbox, "From resource id" (child), "To resource id"
 * (parent), "Order" (child order)]. Searching `?q=<parentId>` also returns the
 * parent's own row as some other resource's child, so rows are filtered to
 * "To resource id" === parentResource.
 */
export async function fetchTestingUnitRows(parentResource: string): Promise<string[][]> {
  const parent = String(parentResource || "").trim().toLowerCase();
  const rows: string[][] = [["unit_id", "parent_resource_id", "unit_order"]];
  if (!parent) return rows;

  const admin = new DjangoAdminSession();
  const maxPages = 25;

  for (let page = 0; page < maxPages; page++) {
    const url =
      `${admin.adminBase}${PARENT_RESOURCE_THROUGH_PATH}?q=${encodeURIComponent(parentResource)}` +
      (page > 0 ? `&p=${page}` : "");
    const html = await admin.fetchHtml(url);
    const section = extractResultListSection(html);
    const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let tr: RegExpExecArray | null;
    let pageRowCount = 0;

    while ((tr = trRe.exec(section)) !== null) {
      const cells = [...tr[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) =>
        decodeCellText(c[1]),
      );
      if (!cells.length) continue;
      pageRowCount++;

      const uuids = cells.filter((c) => UUID_RE.test(c));
      const [childId, toId] = uuids;
      if (!childId || !toId || toId.toLowerCase() !== parent) continue;

      let order = "";
      for (const cell of cells) {
        if (UUID_RE.test(cell)) continue;
        if (/^\d+$/.test(cell)) {
          order = cell;
          break;
        }
      }
      rows.push([childId, toId, order]);
    }

    const hasNext =
      /<a\b[^>]*>\s*Next\s*<\/a>/i.test(html) ||
      /class=['"][^'"]*\bnext\b[^'"]*['"][^>]*>\s*Next/i.test(html);
    if (!hasNext || !pageRowCount) break;
  }

  return rows;
}

export async function createNextTestingUnit(opts: {
  existingUnitNames?: string[];
  /**
   * How many units this same rollover run has already minted, so a second
   * (or third...) mint in one `planQuestionSetBatches` call advances past the
   * first instead of re-deriving the same order from unchanged beta state —
   * this task writes nothing to beta, so a second `fetchTestingUnitRows` call
   * in the same run would otherwise see identical rows and repeat order 10.
   */
  childOrderOffset?: number;
  onLog?: (phase: string, message: string) => void;
  /** Test seam — defaults to the real `fetchTestingUnitRows`. */
  fetchRows?: (parentResource: string) => Promise<string[][]>;
}): Promise<{ questionSetId: string; commonUnitId: string; title: string; childOrder: number }> {
  const parentResource = (process.env.NKB_TESTING_PARENT_RESOURCE || "").trim();
  if (!parentResource) {
    throw new Error(
      "All testing question sets are full and NKB_TESTING_PARENT_RESOURCE is not set, so a new unit cannot be created.",
    );
  }
  const log = opts.onLog ?? (() => {});
  const fetchRows = opts.fetchRows ?? fetchTestingUnitRows;

  log("create unit", "reading existing testing units");
  const rows = await fetchRows(parentResource);
  // Row 0 is the synthetic header, so <= 1 means no children were scraped.
  // The testing parent always has children, so this is a BROKEN scrape (the
  // admin changelist columns, its ?q= search or the paginator changed), not an
  // empty parent. Proceeding would mint a unit at child order 1 in the live
  // beta course tree, silently reordering real content.
  if (rows.length <= 1) {
    throw new Error(
      `No child units found under NKB_TESTING_PARENT_RESOURCE ${parentResource}. That parent always has children, so the Django admin scrape in fetchTestingUnitRows is broken (changelist columns, the ?q= search or pagination changed). Refusing to mint a unit that would land at child order 1 — fix the scrape, then load again.`,
    );
  }
  const childOrder = nextChildOrder(rows) + (opts.childOrderOffset ?? 0);
  const title = nextTestingUnitTitle(opts.existingUnitNames ?? []);
  const questionSetId = randomUUID();
  const commonUnitId = randomUUID();
  log("create unit", `"${title}" at child order ${childOrder} (set ${questionSetId})`);

  return { questionSetId, commonUnitId, title, childOrder };
}

/**
 * Child order for a new unit under the testing parent: one past the highest
 * existing unit_order. Rows come from `fetchTestingUnitRows` scraping the
 * Django admin resourceparentresourcethroughmodel changelist, header first.
 */
export function nextChildOrder(rows: string[][]): number {
  if (!rows.length) return 1;
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = header.indexOf("unit_order");
  if (col < 0) return 1;

  let max = 0;
  for (const row of rows.slice(1)) {
    const n = Number(String(row[col] ?? "").trim());
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max + 1;
}

const TESTING_UNIT_RE = /^Coding Testing (\d+)$/i;

/** "Coding Testing 9" -> "Coding Testing 10". */
export function nextTestingUnitTitle(existingNames: string[]): string {
  let max = 0;
  for (const name of existingNames) {
    const m = String(name || "").trim().match(TESTING_UNIT_RE);
    if (m) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n > max) max = n;
    }
  }
  return `Coding Testing ${max + 1}`;
}
