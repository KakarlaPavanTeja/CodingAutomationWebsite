import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { rateLimits } from "@/lib/db/schema";

/**
 * Database-backed rate limiter using Replit Postgres via Drizzle.
 * Survives restarts and works across multiple server instances.
 * Falls back to in-memory if DB call fails (graceful degradation).
 */

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

const memoryFallback = new Map<string, RateLimitEntry>();

class RateLimiter {
  private windowMs: number;
  private maxRequests: number;
  private name: string;

  constructor(name: string, windowMs: number, maxRequests: number) {
    this.name = name;
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
  }

  async check(key: string): Promise<{
    allowed: boolean;
    remaining: number;
    resetAt: number;
  }> {
    if (process.env.NODE_ENV === "development") {
      return { allowed: true, remaining: this.maxRequests, resetAt: Date.now() + this.windowMs };
    }

    try {
      return await this.checkDb(key);
    } catch {
      return this.checkMemory(key);
    }
  }

  private async checkDb(key: string): Promise<{
    allowed: boolean;
    remaining: number;
    resetAt: number;
  }> {
    const compositeKey = `${this.name}:${key}`;
    const now = Date.now();
    const newResetAt = new Date(now + this.windowMs);

    // Atomic upsert: if key doesn't exist or window expired -> reset to 1
    // Otherwise -> increment count
    const result = await db
      .insert(rateLimits)
      .values({
        key: compositeKey,
        attemptCount: 1,
        resetAt: newResetAt,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: rateLimits.key,
        set: {
          attemptCount: sql`CASE WHEN ${rateLimits.resetAt} <= now() THEN 1 ELSE ${rateLimits.attemptCount} + 1 END`,
          resetAt: sql`CASE WHEN ${rateLimits.resetAt} <= now() THEN ${newResetAt.toISOString()}::timestamptz ELSE ${rateLimits.resetAt} END`,
          updatedAt: sql`now()`,
        },
      })
      .returning({ count: rateLimits.attemptCount, resetAt: rateLimits.resetAt });

    const row = result[0];
    if (!row) {
      return { allowed: true, remaining: this.maxRequests - 1, resetAt: now + this.windowMs };
    }

    const resetAtMs = new Date(row.resetAt).getTime();
    if (row.count > this.maxRequests) {
      return { allowed: false, remaining: 0, resetAt: resetAtMs };
    }
    return {
      allowed: true,
      remaining: this.maxRequests - row.count,
      resetAt: resetAtMs,
    };
  }

  private checkMemory(key: string): {
    allowed: boolean;
    remaining: number;
    resetAt: number;
  } {
    const compositeKey = `${this.name}:${key}`;
    const now = Date.now();
    const entry = memoryFallback.get(compositeKey);

    if (!entry || now > entry.resetAt) {
      const resetAt = now + this.windowMs;
      memoryFallback.set(compositeKey, { count: 1, resetAt });
      return { allowed: true, remaining: this.maxRequests - 1, resetAt };
    }

    entry.count++;

    if (entry.count > this.maxRequests) {
      return { allowed: false, remaining: 0, resetAt: entry.resetAt };
    }

    return {
      allowed: true,
      remaining: this.maxRequests - entry.count,
      resetAt: entry.resetAt,
    };
  }
}

// Reference to silence unused-import warning if eq is not used elsewhere
void eq;

// 20 auth attempts per 15 minutes per IP
export const authLimiter = new RateLimiter("auth", 15 * 60 * 1000, 20);

// 10 password reset requests per hour per IP
export const passwordResetLimiter = new RateLimiter("pwd_reset", 60 * 60 * 1000, 10);

export function getClientIP(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwarded) return forwarded;

  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp;

  const host = request.headers.get("host") || "localhost";
  return `local:${host}`;
}
