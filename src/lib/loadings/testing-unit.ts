/**
 * Child order for a new unit under the testing parent: one past the highest
 * existing unit_order. Rows come from the NKB GET_UNIT_RESOURCE_DETAILS CSV,
 * header first.
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
