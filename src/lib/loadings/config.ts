/**
 * Loadings (NKB content loading) configuration — beta only.
 *
 * Reuses the platform's existing AWS_* credentials: the content-loading zip
 * bucket (new-assets.ccbp.in) is the same bucket the pipeline already writes to.
 */

export const NKB_BETA_API_BASE = (
  process.env.NKB_BETA_API_BASE_URL || "https://nkb-backend-ccbp-beta.earlywave.in"
).replace(/\/$/, "");

export const NKB_BETA_ADMIN_URL = (() => {
  const raw = (process.env.DJANGO_ADMIN_URL || `${NKB_BETA_API_BASE}/admin/`).trim();
  return raw.endsWith("/") ? raw : `${raw}/`;
})();

/** Coding practice "new unit" sheet template (ResourcesData / Units / QuestionSet). */
export const CODING_QUESTIONS_TEMPLATE_URL =
  process.env.CODING_QUESTIONS_LOADING_SHEET_URL || "";

/** Registry sheet of question_set_id | unit_name, shared with the Loadings app. */
export const PRACTICE_SET_SHEET_ID =
  process.env.CODING_PRACTICE_SET_SHEET_ID || "1eZ7DAlSNOV-VzmmWIK9fVIZqcPoIEhtphABaCdtKDdU";
export const PRACTICE_SET_SHEET_GID = 1529142853;

/** A question set may hold at most 50 questions. */
export const QUESTION_SET_MAX = 50;

/** S3 key prefix + public CDN base the NKB backend fetches the zip from. */
export const ZIP_KEY_PREFIX = (
  process.env.NKB_ZIP_KEY_PREFIX || "frontend/ccbp_beta/content_loading/uploads/"
).replace(/\/?$/, "/");
export const ZIP_PUBLIC_URL_BASE = (
  process.env.NKB_ZIP_PUBLIC_URL_BASE ||
  "https://new-assets.ccbp.in/frontend/ccbp_beta/content_loading/uploads/"
).replace(/\/$/, "");

// NKB_TESTING_PARENT_RESOURCE (the parent the auto-created "Coding Testing N"
// units hang off) is deliberately NOT a constant here: a module-load snapshot
// could drift from what `createNextTestingUnit` derives the child order
// against. It is read there, at call time, and travels with the batch.

export function nkbLoadCredentials() {
  return {
    username: (process.env.NKB_LOAD_DATA_USERNAME || "content_loader").trim(),
    password: (process.env.NKB_LOAD_DATA_PASSWORD || "").trim(),
  };
}

export function djangoAdminCredentials() {
  return {
    username: (process.env.DJANGO_ADMIN_USERNAME || "").trim(),
    password: (process.env.DJANGO_ADMIN_PASSWORD || "").trim(),
  };
}

/**
 * Every credential/config this flow needs, so the UI can say what is missing
 * before a load starts instead of failing halfway through.
 */
export function missingLoadingsConfig(): string[] {
  const missing: string[] = [];
  if (!nkbLoadCredentials().password) missing.push("NKB_LOAD_DATA_PASSWORD");
  const admin = djangoAdminCredentials();
  if (!admin.username || !admin.password) {
    missing.push("DJANGO_ADMIN_USERNAME / DJANGO_ADMIN_PASSWORD");
  }
  if (!CODING_QUESTIONS_TEMPLATE_URL) missing.push("CODING_QUESTIONS_LOADING_SHEET_URL");
  if (
    !process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim() &&
    !process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim()
  ) {
    missing.push("GOOGLE_APPLICATION_CREDENTIALS or GOOGLE_SERVICE_ACCOUNT_JSON");
  }
  if (!process.env.AWS_ACCESS_KEY_ID?.trim() || !process.env.AWS_SECRET_ACCESS_KEY?.trim()) {
    missing.push("AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY");
  }
  return missing;
}
