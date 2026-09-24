import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { parseGitPush, verifyGitWebhook } from "./gitWebhooks";

const sig = (secret: string, body: string) => createHmac("sha256", secret).update(body).digest("hex");
const H = (o: Record<string, string>) => new Headers(o);

describe("verifyGitWebhook", () => {
  const body = '{"a":1}';
  test("gitlab compares the shared token", () => {
    expect(verifyGitWebhook("gitlab", H({ "x-gitlab-token": "s3" }), body, "s3")).toBe(true);
    expect(verifyGitWebhook("gitlab", H({ "x-gitlab-token": "nope" }), body, "s3")).toBe(false);
    expect(verifyGitWebhook("gitlab", H({}), body, "s3")).toBe(false);
  });
  test("gitea accepts the bare and the github-style signature, rejects a wrong one", () => {
    expect(verifyGitWebhook("gitea", H({ "x-gitea-signature": sig("k", body) }), body, "k")).toBe(true);
    expect(verifyGitWebhook("gitea", H({ "x-forgejo-signature": sig("k", body) }), body, "k")).toBe(true);
    expect(verifyGitWebhook("gitea", H({ "x-hub-signature-256": `sha256=${sig("k", body)}` }), body, "k")).toBe(true);
    expect(verifyGitWebhook("gitea", H({ "x-gitea-signature": sig("other", body) }), body, "k")).toBe(false);
    expect(verifyGitWebhook("gitea", H({ "x-gitea-signature": sig("k", body) }), body + " ", "k")).toBe(false);
  });
  test("bitbucket uses sha256= in X-Hub-Signature", () => {
    expect(verifyGitWebhook("bitbucket", H({ "x-hub-signature": `sha256=${sig("k", body)}` }), body, "k")).toBe(true);
    expect(verifyGitWebhook("bitbucket", H({ "x-hub-signature": sig("k", body) }), body, "k")).toBe(false);
  });
  test("an empty secret never verifies", () => {
    expect(verifyGitWebhook("gitlab", H({ "x-gitlab-token": "" }), body, "")).toBe(false);
  });
});

describe("parseGitPush", () => {
  test("gitlab push", () => {
    const payload = { ref: "refs/heads/main", project: { path_with_namespace: "g/p" }, commits: [{ message: "first" }, { message: "last [skip ci]" }] };
    expect(parseGitPush("gitlab", H({ "x-gitlab-event": "Push Hook" }), payload)).toEqual({ repo: "g/p", branches: [{ branch: "main", message: "last [skip ci]" }] });
    expect(parseGitPush("gitlab", H({ "x-gitlab-event": "Tag Push Hook" }), payload)).toBeNull();
    expect(parseGitPush("gitlab", H({ "x-gitlab-event": "Push Hook" }), { ...payload, ref: "refs/tags/v1" })).toBeNull();
  });
  test("gitea push", () => {
    const payload = { ref: "refs/heads/dev", repository: { full_name: "o/r" }, head_commit: { message: "msg" } };
    expect(parseGitPush("gitea", H({ "x-gitea-event": "push" }), payload)).toEqual({ repo: "o/r", branches: [{ branch: "dev", message: "msg" }] });
    expect(parseGitPush("gitea", H({ "x-gitea-event": "issues" }), payload)).toBeNull();
  });
  test("bitbucket push with several changes, tags ignored", () => {
    const payload = {
      repository: { full_name: "ws/r" },
      push: { changes: [{ new: { type: "branch", name: "main", target: { message: "m1" } } }, { new: { type: "tag", name: "v1" } }, { new: null }] },
    };
    expect(parseGitPush("bitbucket", H({ "x-event-key": "repo:push" }), payload)).toEqual({ repo: "ws/r", branches: [{ branch: "main", message: "m1" }] });
    expect(parseGitPush("bitbucket", H({ "x-event-key": "pullrequest:created" }), payload)).toBeNull();
  });
  test("garbage is null", () => {
    expect(parseGitPush("gitlab", H({ "x-gitlab-event": "Push Hook" }), null)).toBeNull();
    expect(parseGitPush("gitea", H({ "x-gitea-event": "push" }), "x")).toBeNull();
  });
});
