/**
 * Account statuses that are barred from signing in and from browsing the app.
 *
 * `left` counts: a departed teammate keeps their name and email (so an admin can
 * reactivate them) but must not be able to log back in.
 */
export function isBlockedStatus(status: string | null | undefined): boolean {
  return status === "deactivated" || status === "left";
}
