import { createServiceClient } from "@/lib/supabase/server";

/**
 * Database-backed rate limiter using Supabase.
 * Survives restarts and works across multiple server instances.
 * Falls back to in-memory if DB call fails (graceful degradation).
 */

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

// In-memory fallback for when DB is unreachable
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
    // Skip rate limiting in development
    if (process.env.NODE_ENV === "development") {
      return { allowed: true, remaining: this.maxRequests, resetAt: Date.now() + this.windowMs };
    }

    try {
      return await this.checkDb(key);
    } catch {
      // Fallback to in-memory if DB fails
      return this.checkMemory(key);
    }
  }

  private async checkDb(key: string): Promise<{
    allowed: boolean;
    remaining: number;
    resetAt: number;
  }> {
    const supabase = await createServiceClient();
    const compositeKey = `${this.name}:${key}`;
    const now = Date.now();

    // Try to get existing entry
    const { data } = await supabase
      .from("rate_limits")
      .select("attempt_count, reset_at")
      .eq("key", compositeKey)
      .single();

    if (!data || now > new Date(data.reset_at).getTime()) {
      // No entry or window expired — upsert fresh
      const resetAt = new Date(now + this.windowMs).toISOString();
      await supabase
        .from("rate_limits")
        .upsert(
          { key: compositeKey, attempt_count: 1, reset_at: resetAt, updated_at: new Date().toISOString() },
          { onConflict: "key" }
        );
      return { allowed: true, remaining: this.maxRequests - 1, resetAt: now + this.windowMs };
    }

    // Within window — increment
    const newCount = data.attempt_count + 1;
    await supabase
      .from("rate_limits")
      .update({ attempt_count: newCount, updated_at: new Date().toISOString() })
      .eq("key", compositeKey);

    const resetAtMs = new Date(data.reset_at).getTime();

    if (newCount > this.maxRequests) {
      return { allowed: false, remaining: 0, resetAt: resetAtMs };
    }

    return {
      allowed: true,
      remaining: this.maxRequests - newCount,
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
