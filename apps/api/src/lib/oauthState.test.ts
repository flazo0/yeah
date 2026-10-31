import { describe, expect, test } from "bun:test";
import { createOAuthState, OAUTH_STATE_TTL_MS, verifyOAuthState } from "./oauthState";

describe("oauth state", () => {
  test("round-trips team and user", () => {
    const state = createOAuthState("team-1", "user-1");
    expect(verifyOAuthState(state)).toEqual({ teamId: "team-1", userId: "user-1" });
  });

  test("expires after the TTL", () => {
    const now = 1_000_000;
    const state = createOAuthState("team-1", "user-1", now);
    expect(verifyOAuthState(state, now + OAUTH_STATE_TTL_MS - 1)).not.toBeNull();
    expect(verifyOAuthState(state, now + OAUTH_STATE_TTL_MS + 1)).toBeNull();
  });

  test("rejects a bare teamId and malformed input", () => {
    expect(verifyOAuthState("5b1f0c9e-team-id")).toBeNull();
    expect(verifyOAuthState("")).toBeNull();
    expect(verifyOAuthState("a.b.c")).toBeNull();
  });

  test("rejects a tampered payload", () => {
    const [body, signature] = createOAuthState("team-1", "user-1").split(".");
    const forged = Buffer.from(JSON.stringify({ teamId: "team-2", userId: "user-1", exp: Date.now() + 60_000 })).toString("base64url");
    expect(verifyOAuthState(`${forged}.${signature}`)).toBeNull();
    expect(verifyOAuthState(`${body}.${signature}x`)).toBeNull();
  });

  test("rejects a state signed with another secret", () => {
    const state = createOAuthState("team-1", "user-1");
    const original = process.env.SESSION_SECRET;
    process.env.SESSION_SECRET = "a-different-secret";
    try {
      expect(verifyOAuthState(state)).toBeNull();
    } finally {
      process.env.SESSION_SECRET = original;
    }
  });
});
