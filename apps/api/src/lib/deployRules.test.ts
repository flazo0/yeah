import { describe, expect, test } from "bun:test";
import { generateDeployToken, hashDeployToken, shouldSkipDeploy, validateAdvancedSettings } from "./deployRules";

const valid = {
  healthPath: "/health",
  healthIntervalSeconds: 30,
  healthTimeoutSeconds: 5,
  healthRetries: 3,
  healthStartPeriodSeconds: 30,
  dockerOptions: "",
  stopGraceSeconds: 10,
};

describe("shouldSkipDeploy", () => {
  test("recognizes the skip markers case-insensitively, anywhere in the message", () => {
    for (const msg of ["docs: typo [skip ci]", "wip [SKIP CD]", "[ci skip] readme", "chore [no ci]", "x\n\nbody [cd skip]"]) {
      expect(shouldSkipDeploy(msg)).toBe(true);
    }
  });
  test("ordinary messages deploy", () => {
    for (const msg of ["fix: skip the cache", "ci: update workflow", "", undefined, null]) {
      expect(shouldSkipDeploy(msg)).toBe(false);
    }
  });
});

describe("deploy token", () => {
  test("random, 48 hex chars, and hashes deterministically", () => {
    const a = generateDeployToken();
    expect(a).toMatch(/^[0-9a-f]{48}$/);
    expect(generateDeployToken()).not.toBe(a);
    expect(hashDeployToken(a)).toBe(hashDeployToken(a));
    expect(hashDeployToken(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashDeployToken(a)).not.toContain(a);
  });
});

describe("validateAdvancedSettings", () => {
  test("accepts sane values, including no healthcheck path", () => {
    expect(validateAdvancedSettings(valid)).toBeNull();
    expect(validateAdvancedSettings({ ...valid, healthPath: null })).toBeNull();
    expect(validateAdvancedSettings({ ...valid, healthPath: "" })).toBeNull();
  });
  test("rejects a health path that is not a plain absolute path", () => {
    for (const p of ["health", "/a b", "/x;rm -rf", "/$(id)", "/a'b", "/a`b"]) {
      expect(validateAdvancedSettings({ ...valid, healthPath: p })).not.toBeNull();
    }
  });
  test("rejects out-of-range numbers", () => {
    expect(validateAdvancedSettings({ ...valid, healthRetries: 0 })).toContain("tentativas");
    expect(validateAdvancedSettings({ ...valid, stopGraceSeconds: -1 })).toContain("tolerância");
    expect(validateAdvancedSettings({ ...valid, healthIntervalSeconds: 1.5 })).toContain("intervalo");
  });
  test("rejects reserved docker flags and unterminated quotes", () => {
    expect(validateAdvancedSettings({ ...valid, dockerOptions: "--name x" })).toContain("--name");
    expect(validateAdvancedSettings({ ...valid, dockerOptions: '--label "x' })).toContain("aspas");
  });
});
