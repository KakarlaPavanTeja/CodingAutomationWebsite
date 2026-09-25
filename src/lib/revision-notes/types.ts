/**
 * Revision notes: the data behind the handwritten sticky-notes images.
 *
 * Written by `pipeline/Scripts/revision_notes_manager.py` to
 * `outputs/revision_notes.json`, optionally edited by a reviewer on the
 * Editorial tab, and rendered to PNG by `render.tsx`. Keep the field names in
 * sync with the Python validator.
 *
 * Version 2 added the "cheat corner" (tags, constraints hint, why-better,
 * edge cases, pitfalls, pattern cues, dry run). Version 1 files still parse —
 * the new fields just come back empty, and only page 1 is drawn.
 */

export const REVISION_NOTES_FILE = "revision_notes.json";
/** One note per editorial solution; they spill onto extra pages, NOTES_PER_PAGE at a time. */
export const MAX_APPROACHES = 8;
export const NOTES_PER_PAGE = 3;
export const MAX_LIST_ITEMS = 5;
export const MAX_DRY_RUN_ROWS = 8;
export const MAX_DRY_RUN_COLUMNS = 5;

export interface RevisionApproach {
  /** 1-based editorial solution this note summarises (null when unknown). */
  solutionIndex: number | null;
  /** Note header, e.g. "Brute" / "Better" / "Optimal". */
  label: string;
  /** Technique name, e.g. "Two Pointers". */
  name: string;
  intuition: string;
  /** What the code does, as numbered points in the editorial's names (current notes). */
  steps: string[];
  /** Legacy (notes made before code steps): a prose "how" and a pseudocode. */
  approach: string;
  /** Legacy. Newline-separated; leading spaces are meaningful indentation. */
  pseudocode: string;
  tc: string;
  sc: string;
  takeaway: string;
  /** Why this approach beats the previous one (empty for the first). */
  whyBetter: string;
}

export interface DryRun {
  /** Label of the approach being traced (normally the optimal one). */
  approach: string;
  /** The input being traced, e.g. "a = [1, 2], b = [2, 3]". */
  input: string;
  columns: string[];
  /** Each row has exactly `columns.length` cells. */
  rows: string[][];
  result: string;
}

export type AuditStatus = "passed" | "passed_with_warnings" | "needs_review";

export interface AuditCheck {
  id: string;
  label: string;
  level: "error" | "warning";
  ok: boolean;
  details: string[];
}

export interface AuditIssue {
  /** JSON path of the field, e.g. "dryRun.rows[3]". */
  path: string;
  severity: "error" | "warning";
  problem: string;
  fix: string;
}

/**
 * The safety check's report (revision_notes_audit.py). Written by the pipeline;
 * the app only reads it — and marks it `stale` when a reviewer saves edits.
 */
export interface RevisionAudit {
  status: AuditStatus;
  checks: AuditCheck[];
  issues: AuditIssue[];
  model: string;
  checkedAt: string;
  repairs: number;
  stale: boolean;
}

export interface RevisionNotes {
  version: 2;
  title: string;
  oneLiner: string;
  example: string;
  /** Topic / pattern tags, e.g. ["Arrays", "Two Pointers"]. */
  tags: string[];
  /** What the constraints imply, e.g. "N ≤ 10^5 → O(N log N) or better". */
  constraintsHint: string;
  approaches: RevisionApproach[];
  /** How to recognise this pattern in a new problem. */
  recognize: string[];
  edgeCases: string[];
  pitfalls: string[];
  dryRun: DryRun | null;
  /** Safety-check report; null for notes made before the check existed. */
  audit: RevisionAudit | null;
}

export type ParseResult =
  | { ok: true; notes: RevisionNotes }
  | { ok: false; errors: string[] };

const APPROACH_FIELDS = [
  "label",
  "name",
  "intuition",
  "approach",
  "pseudocode",
  "tc",
  "sc",
  "takeaway",
  "whyBetter",
] as const;

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function strList(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => str(v).trim()).filter(Boolean).slice(0, max);
}

function parseDryRun(raw: unknown, errors: string[]): DryRun | null {
  if (raw == null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    errors.push("dryRun must be an object or null");
    return null;
  }
  const d = raw as Record<string, unknown>;
  const columns = strList(d.columns, MAX_DRY_RUN_COLUMNS);
  const rows = Array.isArray(d.rows) ? d.rows.slice(0, MAX_DRY_RUN_ROWS) : [];
  if (columns.length === 0 || rows.length === 0) return null; // nothing to draw
  const cleanRows: string[][] = [];
  rows.forEach((row, i) => {
    if (!Array.isArray(row) || row.length !== columns.length) {
      errors.push(`dryRun row ${i + 1} must have ${columns.length} cells`);
      return;
    }
    cleanRows.push(row.map((c) => (typeof c === "number" ? String(c) : str(c).trim())));
  });
  return {
    approach: str(d.approach).trim(),
    input: str(d.input).trim(),
    columns,
    rows: cleanRows,
    result: str(d.result).trim(),
  };
}

const STATUSES: AuditStatus[] = ["passed", "passed_with_warnings", "needs_review"];

/** Lenient: a malformed report is treated as "no report", never as passed. */
function parseAudit(raw: unknown): RevisionAudit | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const a = raw as Record<string, unknown>;
  const status = STATUSES.includes(a.status as AuditStatus) ? (a.status as AuditStatus) : null;
  if (!status) return null;
  const checks = Array.isArray(a.checks)
    ? a.checks.flatMap((c): AuditCheck[] => {
        if (!c || typeof c !== "object") return [];
        const o = c as Record<string, unknown>;
        return [{
          id: str(o.id),
          label: str(o.label),
          level: o.level === "warning" ? "warning" : "error",
          ok: o.ok === true,
          details: strList(o.details, 50),
        }];
      })
    : [];
  const issues = Array.isArray(a.issues)
    ? a.issues.flatMap((i): AuditIssue[] => {
        if (!i || typeof i !== "object") return [];
        const o = i as Record<string, unknown>;
        const problem = str(o.problem).trim();
        if (!problem) return [];
        return [{ path: str(o.path), severity: o.severity === "error" ? "error" : "warning", problem, fix: str(o.fix) }];
      })
    : [];
  return {
    status,
    checks,
    issues,
    model: str(a.model),
    checkedAt: str(a.checkedAt),
    repairs: typeof a.repairs === "number" ? a.repairs : 0,
    stale: a.stale === true,
  };
}

/**
 * Validate untrusted JSON (from storage or a reviewer's edit) into
 * `RevisionNotes`. Structure is enforced; lengths are not — long text still
 * renders, it just wraps onto more lines.
 */
export function parseRevisionNotes(raw: unknown): ParseResult {
  const errors: string[] = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, errors: ["revision notes must be a JSON object"] };
  }
  const obj = raw as Record<string, unknown>;

  const title = str(obj.title).trim();
  if (!title) errors.push("missing title");

  const list = Array.isArray(obj.approaches) ? obj.approaches : null;
  if (!list || list.length === 0) {
    errors.push("approaches must be a non-empty list");
  } else if (list.length > MAX_APPROACHES) {
    errors.push(`at most ${MAX_APPROACHES} approaches are supported (got ${list.length})`);
  }

  const approaches: RevisionApproach[] = [];
  (list ?? []).slice(0, MAX_APPROACHES).forEach((item, i) => {
    if (!item || typeof item !== "object") {
      errors.push(`approach ${i + 1} is not an object`);
      return;
    }
    const a = item as Record<string, unknown>;
    const out = { solutionIndex: null } as RevisionApproach;
    for (const field of APPROACH_FIELDS) {
      const value = str(a[field]).replace(/\r\n/g, "\n");
      out[field] = field === "pseudocode" ? value.replace(/\s+$/, "") : value.trim();
    }
    out.steps = strList(a.steps, 10);
    if (!out.label) errors.push(`approach ${i + 1}: missing label`);
    out.solutionIndex =
      typeof a.solutionIndex === "number" && Number.isInteger(a.solutionIndex)
        ? a.solutionIndex
        : null;
    approaches.push(out);
  });

  const dryRun = parseDryRun(obj.dryRun, errors);

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    notes: {
      version: 2,
      title,
      oneLiner: str(obj.oneLiner).trim(),
      example: str(obj.example).trim(),
      tags: strList(obj.tags, 4),
      constraintsHint: str(obj.constraintsHint).trim(),
      approaches,
      recognize: strList(obj.recognize, MAX_LIST_ITEMS),
      edgeCases: strList(obj.edgeCases, MAX_LIST_ITEMS),
      pitfalls: strList(obj.pitfalls, MAX_LIST_ITEMS),
      dryRun,
      audit: parseAudit(obj.audit),
    },
  };
}

/**
 * A rendered image. Approach notes are split across as few pages as possible
 * (at most NOTES_PER_PAGE each, balanced: 4 → 2+2, 5 → 3+2), followed by the
 * cheat corner when it has content.
 */
export type RevisionPage =
  | { kind: "approaches"; from: number; to: number } // approaches[from, to)
  | { kind: "cheatsheet" };

export function revisionPages(notes: RevisionNotes): RevisionPage[] {
  const n = Math.max(1, notes.approaches.length);
  const count = Math.ceil(n / NOTES_PER_PAGE);
  const pages: RevisionPage[] = [];
  let from = 0;
  for (let p = 0; p < count; p++) {
    const size = Math.ceil((n - from) / (count - p));
    pages.push({ kind: "approaches", from, to: from + size });
    from += size;
  }
  const hasCheatsheet =
    notes.approaches.length > 1 ||
    notes.recognize.length > 0 ||
    notes.edgeCases.length > 0 ||
    notes.pitfalls.length > 0 ||
    notes.dryRun !== null;
  if (hasCheatsheet) pages.push({ kind: "cheatsheet" });
  return pages;
}

export function pageTitle(page: RevisionPage, notes: RevisionNotes): string {
  if (page.kind === "cheatsheet") return "Cheat corner";
  const total = notes.approaches.length;
  if (page.from === 0 && page.to >= total) return "Approaches";
  return page.to - page.from === 1 ? `Approach ${page.from + 1}` : `Approaches ${page.from + 1}–${page.to}`;
}

/**
 * Characters the bundled Kalam subset has no glyph for, mapped to ASCII that
 * reads the same in handwriting. Anything else outside the font is dropped by
 * `sanitizeForFont` rather than rendered as a tofu box.
 */
const GLYPH_FALLBACKS: Record<string, string> = {
  "→": "->",
  "⟶": "->",
  "⇒": "=>",
  "←": "<-",
  "↔": "<->",
  "⌊": "floor(",
  "⌋": ")",
  "⌈": "ceil(",
  "⌉": ")",
  "₀": "0",
  "₁": "1",
  "₂": "2",
  "²": "^2",
  "³": "^3",
  "⁰": "^0",
  "¹": "^1",
  "⁴": "^4",
  "⁵": "^5",
  "⁶": "^6",
  "⁷": "^7",
  "⁸": "^8",
  "⁹": "^9",
  "★": "*",
  "✓": "ok",
  "✗": "x",
  "\t": "  ",
  // Kalam has no Greek; complexity notes use a handful of letters.
  "Σ": "sigma",
  "α": "alpha",
  "β": "beta",
  "Θ": "Theta",
  "θ": "theta",
  "λ": "lambda",
  "π": "pi",
  "ε": "eps",
  "δ": "delta",
  "Δ": "delta",
  "φ": "phi",
  "ω": "omega",
  "Ω": "Omega",
};

export function sanitizeForFont(text: string, hasGlyph: (ch: string) => boolean): string {
  let out = "";
  for (const ch of text) {
    if (ch === "\n" || hasGlyph(ch)) out += ch;
    else if (GLYPH_FALLBACKS[ch] !== undefined) out += GLYPH_FALLBACKS[ch];
    else if (/\s/.test(ch)) out += " ";
    // else: no glyph and no fallback — drop it.
  }
  return out;
}
