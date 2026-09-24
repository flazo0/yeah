import { describe, expect, test } from "bun:test";
import { parsePullRequestEvent, previewCommentBody, previewCommentMarker, previewDomain, previewName } from "./preview";

const payload = (over: Record<string, unknown> = {}) => ({
  action: "opened",
  number: 7,
  installation: { id: 42 },
  repository: { full_name: "org/repo" },
  pull_request: { head: { ref: "feature/x", repo: { full_name: "org/repo" } }, base: { ref: "main" } },
  ...over,
});

describe("parsePullRequestEvent", () => {
  test("extracts the fields", () => {
    expect(parsePullRequestEvent(payload())).toEqual({
      action: "opened",
      number: 7,
      headRef: "feature/x",
      baseRef: "main",
      repo: "org/repo",
      fromFork: false,
      installationId: 42,
    });
  });
  test("a PR from another repository is a fork; so is one whose head repo was deleted", () => {
    expect(parsePullRequestEvent(payload({ pull_request: { head: { ref: "x", repo: { full_name: "someone/repo" } }, base: { ref: "main" } } }))?.fromFork).toBe(true);
    expect(parsePullRequestEvent(payload({ pull_request: { head: { ref: "x", repo: null }, base: { ref: "main" } } }))?.fromFork).toBe(true);
  });
  test("ignores actions we do not act on and malformed payloads", () => {
    expect(parsePullRequestEvent(payload({ action: "labeled" }))).toBeNull();
    expect(parsePullRequestEvent(payload({ number: "7" }))).toBeNull();
    expect(parsePullRequestEvent(payload({ repository: {} }))).toBeNull();
    expect(parsePullRequestEvent(null)).toBeNull();
    expect(parsePullRequestEvent("x")).toBeNull();
  });
  test("accepts every action that deploys or removes", () => {
    for (const action of ["opened", "reopened", "synchronize", "closed"]) expect(parsePullRequestEvent(payload({ action }))?.action as string).toBe(action);
  });
});

describe("preview naming", () => {
  test("name and domain", () => {
    expect(previewName("My API", 12)).toBe("My API-pr-12");
    expect(previewDomain("My API", 12, "apps.example.com")).toBe("pr-12-my-api.apps.example.com");
  });
  test("comment body carries the marker so it can be updated in place", () => {
    const body = previewCommentBody("app-1", "ready", "https://x.example.com", "abcdef1234567");
    expect(body.startsWith(previewCommentMarker("app-1"))).toBe(true);
    expect(body).toContain("https://x.example.com");
    expect(body).toContain("abcdef1");
    expect(previewCommentBody("app-1", "failed", "u", null)).toContain("falhou");
  });
});
