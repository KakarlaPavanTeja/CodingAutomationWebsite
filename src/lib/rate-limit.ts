type RateLimitEntry = {
  count: number;
  resetAt: number;
};

class RateLimiter {
  private store = new Map<string, RateLimitEntry>();
  private windowMs: number;
  private maxRequests: number;

  constructor(windowMs: number, maxRequests: number) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;

    // Cleanup stale entries every 60 seconds
    if (typeof setInterval !== "undefined") {
      setInterval(() => this.cleanup(), 60_000);
    }
  }

  check(key: string): {
    allowed: boolean;
    remaining: number;
    resetAt: number;
  } {
    // Skip rate limiting in development
    if (process.env.NODE_ENV === "development") {
      return { allowed: true, remaining: this.maxRequests, resetAt: Date.now() + this.windowMs };
    }

    const now = Date.now();
    const entry = this.store.get(key);

    // No existing entry or window expired — allow and start fresh
    if (!entry || now > entry.resetAt) {
      const resetAt = now + this.windowMs;
      this.store.set(key, { count: 1, resetAt });
      return { allowed: true, remaining: this.maxRequests - 1, resetAt };
    }

    // Within window — increment
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

  private cleanup() {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now > entry.resetAt) {
        this.store.delete(key);
      }
    }
  }
}

// 20 auth attempts per 15 minutes per IP
export const authLimiter = new RateLimiter(15 * 60 * 1000, 20);

// 10 password reset requests per hour per IP
export const passwordResetLimiter = new RateLimiter(60 * 60 * 1000, 10);

export function getClientIP(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwarded) return forwarded;

  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp;

  // In development, use a unique-ish identifier from other headers
  const host = request.headers.get("host") || "localhost";
  return `local:${host}`;
}
