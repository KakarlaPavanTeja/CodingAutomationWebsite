/**
 * Resolves the trusted base URL for building security-sensitive links
 * (e.g. password-reset URLs sent in emails).
 *
 * NEVER derive these from request headers like `Origin` or `Host`, since both
 * are attacker-controlled on unauthenticated endpoints and can poison the
 * destination of links delivered to real users.
 *
 * Resolution order:
 *   1. APP_URL                     — explicit production configuration (preferred).
 *   2. NEXT_PUBLIC_APP_URL         — same, exposed to client bundles.
 *   3. REPLIT_DEPLOYMENT + REPLIT_DEV_DOMAIN — Replit-deployed runtime.
 *   4. REPLIT_DEV_DOMAIN           — Replit dev workspace.
 *
 * Throws if none are configured, so we never silently fall back to a
 * caller-controlled origin.
 */
export function getAppUrl(): string {
  const explicit = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL;
  if (explicit) return stripTrailingSlash(explicit);
  const replit = process.env.REPLIT_DEV_DOMAIN;
  if (replit) return `https://${replit}`;
  throw new Error(
    "Trusted app URL is not configured. Set APP_URL to your site's public origin (e.g. https://app.example.com).",
  );
}

function stripTrailingSlash(s: string): string {
  return s.endsWith("/") ? s.slice(0, -1) : s;
}

export function buildResetUrl(token: string): string {
  return `${getAppUrl()}/reset-password?mode=update&token=${encodeURIComponent(token)}`;
}
