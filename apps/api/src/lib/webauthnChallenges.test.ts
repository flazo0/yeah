import { describe, expect, test } from "bun:test";
import { ChallengeStore, relyingParty } from "./webauthnChallenges";

describe("ChallengeStore", () => {
  test("a challenge can be taken once", () => {
    const s = new ChallengeStore();
    s.put("k", "abc");
    expect(s.take("k")).toBe("abc");
    expect(s.take("k")).toBeNull();
  });

  test("expires after five minutes", () => {
    let now = 0;
    const s = new ChallengeStore(() => now);
    s.put("k", "abc");
    now = 5 * 60 * 1000 + 1;
    expect(s.take("k")).toBeNull();
  });
});

describe("relyingParty", () => {
  const allowed = ["https://panel.example.com", "http://localhost:5173"];
  test("uses the hostname of a configured origin", () => {
    expect(relyingParty("https://panel.example.com", allowed)).toEqual({ rpID: "panel.example.com", origin: "https://panel.example.com" });
    expect(relyingParty("http://localhost:5173", allowed)?.rpID).toBe("localhost");
  });
  test("rejects unknown or missing origins", () => {
    expect(relyingParty("https://evil.example.com", allowed)).toBeNull();
    expect(relyingParty(null, allowed)).toBeNull();
  });
});
