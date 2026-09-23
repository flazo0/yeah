import { describe, expect, test } from "bun:test";
import { AUTH_RULE, clientIp, RateLimiter, ruleFor } from "./rateLimit";

describe("RateLimiter", () => {
  test("allows up to the limit then blocks with a retry-after", () => {
    const limiter = new RateLimiter();
    const rule = { name: "t", limit: 3, windowMs: 60_000 };
    for (let i = 0; i < 3; i++) expect(limiter.hit("ip", rule, 1000).allowed).toBe(true);
    const blocked = limiter.hit("ip", rule, 1000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBe(60);
  });

  test("window resets and keys are independent", () => {
    const limiter = new RateLimiter();
    const rule = { name: "t", limit: 1, windowMs: 1000 };
    expect(limiter.hit("a", rule, 0).allowed).toBe(true);
    expect(limiter.hit("a", rule, 500).allowed).toBe(false);
    expect(limiter.hit("b", rule, 500).allowed).toBe(true);
    expect(limiter.hit("a", rule, 1001).allowed).toBe(true);
  });

  test("different rules keep separate counters", () => {
    const limiter = new RateLimiter();
    limiter.hit("ip", AUTH_RULE);
    expect(limiter.hit("ip", { name: "other", limit: 1, windowMs: 1000 }).allowed).toBe(true);
  });
});

describe("ruleFor", () => {
  test("login/register get the strict auth rule, webhooks their own, writes the default, reads none", () => {
    expect(ruleFor("POST", "/auth/login")?.name).toBe("auth");
    expect(ruleFor("POST", "/api/auth/register")?.name).toBe("auth");
    expect(ruleFor("POST", "/webhooks/github")?.name).toBe("webhook");
    expect(ruleFor("DELETE", "/teams/1/servers/2")?.name).toBe("write");
    expect(ruleFor("GET", "/teams/1/servers")).toBeNull();
    expect(ruleFor("GET", "/auth/me")).toBeNull();
  });
});

describe("clientIp", () => {
  test("prefers X-Real-IP, falls back, then unknown", () => {
    expect(clientIp(new Headers({ "x-real-ip": "1.2.3.4" }), "9.9.9.9")).toBe("1.2.3.4");
    expect(clientIp(new Headers(), "9.9.9.9")).toBe("9.9.9.9");
    expect(clientIp(new Headers())).toBe("unknown");
  });
});
