import { cache } from "react";
import { NextResponse } from "next/server";
import { getCurrentSession, type SessionUser } from "./session";

export const getSession = cache(async (): Promise<SessionUser | null> => {
  return getCurrentSession();
});

export async function requireAuth(): Promise<SessionUser> {
  const session = await getSession();
  if (!session) {
    const { unauthorized } = await import("next/navigation");
    unauthorized();
  }
  return session!;
}

export async function requireAdmin(): Promise<SessionUser> {
  const session = await getSession();
  if (!session) {
    const { unauthorized } = await import("next/navigation");
    unauthorized();
  }
  if (session!.profile.role !== "admin") {
    const { forbidden } = await import("next/navigation");
    forbidden();
  }
  return session!;
}

/**
 * API-route variant: returns a 401/403 Response on failure.
 * Requires the account to be active (not pending_approval / deactivated / left).
 */
export async function requireAuthApi(): Promise<
  | { session: SessionUser; error?: never }
  | { error: NextResponse; session?: never }
> {
  const session = await getSession();
  if (!session) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (session.profile.status !== "active") {
    return {
      error: NextResponse.json(
        { error: "Account not active.", status: session.profile.status },
        { status: 403 },
      ),
    };
  }
  return { session };
}

export async function requireAdminApi(): Promise<
  | { session: SessionUser; profile: SessionUser["profile"]; error?: never }
  | { error: NextResponse; session?: never; profile?: never }
> {
  const session = await getSession();
  if (!session) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (session.profile.status !== "active") {
    return {
      error: NextResponse.json(
        { error: "Account not active.", status: session.profile.status },
        { status: 403 },
      ),
    };
  }
  if (session.profile.role !== "admin") {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { session, profile: session.profile };
}
