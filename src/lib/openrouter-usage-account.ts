/**
 * Which OpenRouter account key a `llm_usage` row was billed to.
 *
 * There are two signals, and neither is trustworthy across the whole history, so
 * this picks the better one per row rather than committing to either.
 *
 *  1. `llm_usage.account` — set by /api/internal/llm-usage from a sha256 digest of
 *     the key the pipeline actually used (see accountForKeyFingerprint). This is
 *     authoritative, but only for rows written once that landed.
 *  2. `created_at` vs the second key's go-live instant — a guess. It cannot know
 *     that an admin flipped the active key back to "old", so on its own it labels
 *     every recent row "new".
 *
 * The dashboard used to use (2) alone and ignore (1) entirely, which meant the
 * key filter contradicted the recorded truth the attribution fix was written to
 * establish.
 */
import type { OpenRouterAccount } from "@/lib/openrouter";

/**
 * When the second key went live (2026-07-24 15:31 IST).
 *
 * Before this there was one key, and it is the one now configured as
 * OPENROUTER_API_KEY_OLD — so single-key-era spend belongs to "old". Those rows
 * carry `account = "new"` only because that is the column's DB default; the
 * column holds no real information for them, and the date does.
 */
export const NEW_KEY_START = new Date("2026-07-24T15:31:00+05:30");

/**
 * When per-row attribution became trustworthy (the fingerprint fix, 2026-08-31).
 *
 * Before it, /api/internal/llm-usage re-derived `account` from the
 * `openrouter_key_choice` toggle at insert time, and getOpenRouterKeyChoice()
 * silently returns "new" when its read throws — which tagged roughly $37.70 of
 * old-key spend as "new". Those rows were never backfilled, so `account` in the
 * window below is the best per-row signal available but is known to be imperfect.
 */
export const ACCOUNT_TRUSTWORTHY_FROM = new Date("2026-08-31T14:19:41+05:30");

/** How much to trust the answer, so the UI can say so instead of implying precision. */
export type AccountConfidence =
  /** `account` was set from the billed key's fingerprint. */
  | "recorded"
  /** Only one key existed, so the date settles it. */
  | "single-key-era"
  /** `account` came from the toggle, which mislabelled some old-key spend. */
  | "approximate";

export type UsageAccountRow = {
  account?: string | null;
  created_at: string | Date;
};

export type UsageAccount = {
  account: OpenRouterAccount;
  confidence: AccountConfidence;
};

function toDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

/** Normalize a stored `account` value; anything unrecognised is treated as absent. */
function storedAccount(value: string | null | undefined): OpenRouterAccount | null {
  return value === "new" || value === "old" ? value : null;
}

/**
 * Resolve one usage row's account, with how much the answer can be trusted.
 *
 * An unparseable or missing `created_at` falls back to the stored `account`, then
 * to "new" — a row is never dropped from a total just because its timestamp is junk.
 */
export function usageRowAccount(row: UsageAccountRow): UsageAccount {
  const stored = storedAccount(row.account);
  const created = toDate(row.created_at);

  if (Number.isNaN(created.getTime())) {
    return { account: stored ?? "new", confidence: "approximate" };
  }

  // One key existed, and it is the one now called "old". The column's default
  // says "new" here, but it was never written from anything real.
  if (created < NEW_KEY_START) {
    return { account: "old", confidence: "single-key-era" };
  }

  if (created >= ACCOUNT_TRUSTWORTHY_FROM) {
    // Post-fingerprint rows always have a real value; guard anyway so a
    // hand-inserted or backfilled row can't throw off the totals.
    return { account: stored ?? "new", confidence: stored ? "recorded" : "approximate" };
  }

  // Between the two: `account` is all we have, and some of it is wrong.
  return { account: stored ?? "new", confidence: "approximate" };
}

/** Just the account, for filtering. */
export function accountForUsageRow(row: UsageAccountRow): OpenRouterAccount {
  return usageRowAccount(row).account;
}

/**
 * Does this set of rows contain any whose attribution is only approximate?
 * Drives the dashboard's caveat, so an admin reading a per-key total knows
 * whether it is exact.
 */
export function hasApproximateAccounts(rows: UsageAccountRow[]): boolean {
  return rows.some((r) => usageRowAccount(r).confidence === "approximate");
}
