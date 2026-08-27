import { randomBytes, createHash } from "crypto";
import { cookies } from "next/headers";
import { eq, and, gt } from "drizzle-orm";
import { db } from "@/lib/db";
import { sessions, users, profiles } from "@/lib/db/schema";

export const SESSION_COOKIE = "session_token";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function sessionCookieOptions(maxAgeSec: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeSec,
  };
}

/** Create a new session row and return the raw token to set as a cookie. */
export async function createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = generateSessionToken();
  const id = hashSessionToken(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(sessions).values({ id, userId, expiresAt });
  return { token, expiresAt };
}

/** Set the session cookie on the current response. */
export async function setSessionCookie(token: string, expiresAt: Date) {
  const store = await cookies();
  const maxAge = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
  store.set(SESSION_COOKIE, token, sessionCookieOptions(maxAge));
}

export async function clearSessionCookie() {
  const store = await cookies();
  store.set(SESSION_COOKIE, "", { ...sessionCookieOptions(0), maxAge: 0 });
}

export type SessionUser = {
  userId: string;
  email: string;
  profile: {
    id: string;
    email: string;
    displayName: string | null;
    role: string;
    status: string;
  };
};

/** Look up a session by raw cookie token. Returns null when missing/expired. */
export async function getSessionByToken(token: string | undefined | null): Promise<SessionUser | null> {
  if (!token) return null;
  const id = hashSessionToken(token);
  const rows = await db
    .select({
      userId: sessions.userId,
      expiresAt: sessions.expiresAt,
      email: users.email,
      profileId: profiles.id,
      profileEmail: profiles.email,
      displayName: profiles.displayName,
      role: profiles.role,
      status: profiles.status,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .innerJoin(profiles, eq(profiles.id, sessions.userId))
    .where(and(eq(sessions.id, id), gt(sessions.expiresAt, new Date())))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    userId: row.userId,
    email: row.email,
    profile: {
      id: row.profileId,
      email: row.profileEmail,
      displayName: row.displayName,
      role: row.role,
      status: row.status,
    },
  };
}

/** Read the cookie and return the current session, if any. */
export async function getCurrentSession(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  return getSessionByToken(token);
}

/** Delete a single session by its raw token (best-effort). */
export async function deleteSessionByToken(token: string | undefined | null) {
  if (!token) return;
  const id = hashSessionToken(token);
  await db.delete(sessions).where(eq(sessions.id, id));
}

/** Delete all sessions belonging to a user. */
export async function deleteAllSessionsForUser(userId: string) {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

// Expired-session cleanup is a pg_cron job ("purge-expired-sessions", nightly at
// 04:00 UTC) rather than app code, so no request path pays for it. Inspect it with
//   select * from cron.job;
//   select * from cron.job_run_details order by start_time desc;
