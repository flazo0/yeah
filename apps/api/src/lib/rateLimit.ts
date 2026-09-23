/**
 * In-memory fixed-window rate limiter. The API runs as a single process (see docker-compose.prod.yml),
 * so per-process counters are enough — no Redis round trip on every request.
 */

export interface RateRule {
  name: string;
  limit: number;
  windowMs: number;
}

export interface RateResult {
  allowed: boolean;
  remaining: number;
  retryAfterSec: number;
}

export class RateLimiter {
  private buckets = new Map<string, { count: number; resetAt: number }>();
  private sinceSweep = 0;

  hit(key: string, rule: RateRule, now = Date.now()): RateResult {
    if (++this.sinceSweep >= 500) this.sweep(now);

    const id = `${rule.name}:${key}`;
    let bucket = this.buckets.get(id);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + rule.windowMs };
      this.buckets.set(id, bucket);
    }
    bucket.count++;
    const allowed = bucket.count <= rule.limit;
    return {
      allowed,
      remaining: Math.max(0, rule.limit - bucket.count),
      retryAfterSec: allowed ? 0 : Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    };
  }

  private sweep(now: number): void {
    this.sinceSweep = 0;
    for (const [id, bucket] of this.buckets) if (bucket.resetAt <= now) this.buckets.delete(id);
  }
}

export const AUTH_RULE: RateRule = { name: "auth", limit: 10, windowMs: 5 * 60_000 };
export const WEBHOOK_RULE: RateRule = { name: "webhook", limit: 600, windowMs: 60_000 };
export const WRITE_RULE: RateRule = { name: "write", limit: 120, windowMs: 60_000 };

/** Picks the rule for a request, or null when the request isn't limited (plain reads). */
export function ruleFor(method: string, pathname: string): RateRule | null {
  if (method === "POST" && (pathname.endsWith("/auth/login") || pathname.endsWith("/auth/register"))) return AUTH_RULE;
  if (method === "POST" && pathname.endsWith("/webhooks/github")) return WEBHOOK_RULE;
  if (method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE") return WRITE_RULE;
  return null;
}

/** nginx (the only thing that can reach the API in production) overwrites X-Real-IP with the peer address. */
export function clientIp(headers: Headers, fallback?: string | null): string {
  return headers.get("x-real-ip")?.trim() || fallback || "unknown";
}
