import { randomBytes, createHash } from "crypto";
import { eq, sql, and, isNull, gt } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, profiles, passwordResetTokens } from "@/lib/db/schema";
import { hashPassword, verifyPassword } from "./passwords";
import { createSession, deleteAllSessionsForUser } from "./session";

export type SignupInput = {
  email: string;
  password: string;
  displayName: string;
  role: "admin" | "problem_setter";
};

export type SignupResult =
  | { ok: true; userId: string; status: "active" | "pending_approval"; sessionToken: string; expiresAt: Date }
  | { ok: false; error: string; field?: string };

export async function signup(input: SignupInput): Promise<SignupResult> {
  const email = input.email.trim().toLowerCase();

  // Check for existing user (case-insensitive). users.email has a lower() unique index.
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.email}) = ${email}`)
    .limit(1);

  if (existing.length > 0) {
    return { ok: false, error: "An account with this email already exists.", field: "email" };
  }

  const passwordHash = await hashPassword(input.password);
  const status = input.role === "admin" ? "active" : "pending_approval";

  let userId: string;
  try {
    userId = await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(users)
        .values({ email, passwordHash, emailVerifiedAt: new Date() })
        .returning({ id: users.id });
      const id = inserted[0].id;
      await tx.insert(profiles).values({
        id,
        email,
        displayName: input.displayName,
        role: input.role,
        status,
      });
      return id;
    });
  } catch (err) {
    // Race-safe: unique-index collision means email was taken between check and insert.
    const code = (err as { code?: string } | null)?.code;
    if (code === "23505") {
      return { ok: false, error: "An account with this email already exists.", field: "email" };
    }
    throw err;
  }

  const { token, expiresAt } = await createSession(userId);
  return { ok: true, userId, status, sessionToken: token, expiresAt };
}

export type LoginResult =
  | { ok: true; userId: string; status: string; sessionToken: string; expiresAt: Date }
  | { ok: false; error: string };

export async function login(emailRaw: string, password: string): Promise<LoginResult> {
  const email = emailRaw.trim().toLowerCase();

  const rows = await db
    .select({
      id: users.id,
      passwordHash: users.passwordHash,
      profileStatus: profiles.status,
    })
    .from(users)
    .leftJoin(profiles, eq(profiles.id, users.id))
    .where(sql`lower(${users.email}) = ${email}`)
    .limit(1);

  const row = rows[0];
  // Generic error to prevent user enumeration
  const invalidMsg = "Invalid email or password.";

  if (!row || !row.passwordHash) {
    // Still hash a dummy password to roughly equalize timing
    await verifyPassword(password, "$2b$12$abcdefghijklmnopqrstuv");
    return { ok: false, error: invalidMsg };
  }

  const ok = await verifyPassword(password, row.passwordHash);
  if (!ok) return { ok: false, error: invalidMsg };

  if (row.profileStatus === "deactivated") {
    return { ok: false, error: "This account has been deactivated." };
  }

  const { token, expiresAt } = await createSession(row.id);
  return { ok: true, userId: row.id, status: row.profileStatus ?? "active", sessionToken: token, expiresAt };
}

const RESET_TTL_MS = 60 * 60 * 1000; // 1 hour

export async function createPasswordResetToken(emailRaw: string): Promise<string | null> {
  const email = emailRaw.trim().toLowerCase();
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.email}) = ${email}`)
    .limit(1);
  const user = rows[0];
  if (!user) return null;

  const raw = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(raw).digest("hex");
  const expiresAt = new Date(Date.now() + RESET_TTL_MS);

  await db.insert(passwordResetTokens).values({ tokenHash, userId: user.id, expiresAt });
  return raw;
}

export type ConfirmResetResult =
  | { ok: true; userId: string }
  | { ok: false; error: string };

export async function confirmPasswordReset(rawToken: string, newPassword: string): Promise<ConfirmResetResult> {
  if (!rawToken || typeof rawToken !== "string") {
    return { ok: false, error: "Invalid reset token." };
  }
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  const passwordHash = await hashPassword(newPassword);
  const now = new Date();

  // Atomic claim: only consume if still unused and unexpired. Returning gives us
  // the userId iff exactly one row was claimed, preventing replay/race wins.
  const claimed = await db
    .update(passwordResetTokens)
    .set({ usedAt: now })
    .where(
      and(
        eq(passwordResetTokens.tokenHash, tokenHash),
        isNull(passwordResetTokens.usedAt),
        gt(passwordResetTokens.expiresAt, now),
      ),
    )
    .returning({ userId: passwordResetTokens.userId });

  if (claimed.length === 0) {
    return { ok: false, error: "This reset link is invalid or has expired." };
  }
  const userId = claimed[0].userId;

  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ passwordHash, passwordResetRequired: false, updatedAt: now })
      .where(eq(users.id, userId));
    // Invalidate every other outstanding reset token for this user.
    await tx
      .update(passwordResetTokens)
      .set({ usedAt: now })
      .where(
        and(eq(passwordResetTokens.userId, userId), isNull(passwordResetTokens.usedAt)),
      );
  });

  // Wipe every existing session for this user.
  await deleteAllSessionsForUser(userId);

  return { ok: true, userId };
}

export async function userExistsByEmail(emailRaw: string): Promise<boolean> {
  const email = emailRaw.trim().toLowerCase();
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.email}) = ${email}`)
    .limit(1);
  return rows.length > 0;
}
