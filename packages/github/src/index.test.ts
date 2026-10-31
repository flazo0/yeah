import { createVerify, generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cloneUrlForRepo, getGithubConfig, signAppJwt, verifyWebhookSignature , upsertPullRequestComment } from "./index";

function base64urlDecode(input: string): Buffer {
  const padded = input + "=".repeat((4 - (input.length % 4)) % 4);
  return Buffer.from(padded.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

describe("signAppJwt", () => {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const privateKeyPem = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
  const publicKeyPem = publicKey.export({ type: "pkcs1", format: "pem" }).toString();

  test("produces a JWT with the expected header and claims", () => {
    const jwt = signAppJwt("12345", privateKeyPem);
    const [headerB64, payloadB64] = jwt.split(".");
    const header = JSON.parse(base64urlDecode(headerB64!).toString());
    const payload = JSON.parse(base64urlDecode(payloadB64!).toString());

    expect(header).toEqual({ alg: "RS256", typ: "JWT" });
    expect(payload.iss).toBe("12345");
    const now = Math.floor(Date.now() / 1000);
    // 60s clock-drift allowance behind "now", exp 10 minutes ahead of iat.
    expect(payload.iat).toBeLessThanOrEqual(now - 59);
    expect(payload.exp - payload.iat).toBe(660);
  });

  test("produces a signature verifiable with the matching public key", () => {
    const jwt = signAppJwt("12345", privateKeyPem);
    const [headerB64, payloadB64, signatureB64] = jwt.split(".");
    const signingInput = `${headerB64}.${payloadB64}`;
    const verifier = createVerify("RSA-SHA256");
    verifier.update(signingInput);
    expect(verifier.verify(publicKeyPem, base64urlDecode(signatureB64!))).toBe(true);
  });

  test("a tampered payload fails verification", () => {
    const jwt = signAppJwt("12345", privateKeyPem);
    const [headerB64, , signatureB64] = jwt.split(".");
    const tamperedPayload = Buffer.from(JSON.stringify({ iss: "99999" })).toString("base64url");
    const verifier = createVerify("RSA-SHA256");
    verifier.update(`${headerB64}.${tamperedPayload}`);
    expect(verifier.verify(publicKeyPem, base64urlDecode(signatureB64!))).toBe(false);
  });
});

describe("verifyWebhookSignature", () => {
  const secret = "test-webhook-secret";
  const body = JSON.stringify({ ref: "refs/heads/main" });

  function sign(payload: string, withSecret: string): string {
    return `sha256=${require("node:crypto").createHmac("sha256", withSecret).update(payload).digest("hex")}`;
  }

  test("accepts a correctly signed payload", () => {
    expect(verifyWebhookSignature(body, sign(body, secret), secret)).toBe(true);
  });

  test("rejects a payload signed with the wrong secret", () => {
    expect(verifyWebhookSignature(body, sign(body, "wrong-secret"), secret)).toBe(false);
  });

  test("rejects a tampered body with an otherwise-valid-looking signature", () => {
    const signature = sign(body, secret);
    expect(verifyWebhookSignature(body + " ", signature, secret)).toBe(false);
  });

  test("rejects a missing signature header", () => {
    expect(verifyWebhookSignature(body, null, secret)).toBe(false);
  });

  test("rejects a header without the sha256= prefix", () => {
    expect(verifyWebhookSignature(body, "abc123", secret)).toBe(false);
  });

  test("rejects a signature of the wrong length outright (no timingSafeEqual length crash)", () => {
    expect(verifyWebhookSignature(body, "sha256=short", secret)).toBe(false);
  });
});

describe("cloneUrlForRepo", () => {
  test("embeds the installation token as the git credential", () => {
    expect(cloneUrlForRepo("ghs_abc123", "flazo0/yeah")).toBe(
      "https://x-access-token:ghs_abc123@github.com/flazo0/yeah.git",
    );
  });
});

describe("getGithubConfig", () => {
  const keys = ["GITHUB_APP_ID", "GITHUB_APP_SLUG", "GITHUB_APP_PRIVATE_KEY_BASE64", "GITHUB_APP_WEBHOOK_SECRET"] as const;
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
    for (const k of keys) delete process.env[k];
  });

  afterEach(() => {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  test("returns null when any required env var is missing", () => {
    process.env.GITHUB_APP_ID = "123";
    expect(getGithubConfig()).toBeNull();
  });

  test("decodes the base64 private key when fully configured", () => {
    process.env.GITHUB_APP_ID = "123";
    process.env.GITHUB_APP_SLUG = "yeah-app";
    process.env.GITHUB_APP_PRIVATE_KEY_BASE64 = Buffer.from("fake-pem-content").toString("base64");
    process.env.GITHUB_APP_WEBHOOK_SECRET = "shh";

    expect(getGithubConfig()).toEqual({
      appId: "123",
      appSlug: "yeah-app",
      privateKey: "fake-pem-content",
      webhookSecret: "shh",
    });
  });
});

describe("upsertPullRequestComment", () => {
  const calls: Array<{ url: string; method: string; body?: string }> = [];
  const stub = (existing: Array<{ id: number; body: string }>) =>
    (async (url: string, init?: { method?: string; body?: string }) => {
      calls.push({ url: String(url), method: init?.method ?? "GET", body: init?.body });
      if (!init?.method) return new Response(JSON.stringify(existing), { status: 200 });
      return new Response("{}", { status: 201 });
    }) as unknown as typeof fetch;

  test("posts a new comment when none carries the marker", async () => {
    calls.length = 0;
    await upsertPullRequestComment("tok", "org/repo", 5, "<!-- m -->", "<!-- m -->\nhi", stub([{ id: 1, body: "unrelated" }]));
    expect(calls.map((c) => c.method)).toEqual(["GET", "POST"]);
    expect(calls[1]!.url).toBe("https://api.github.com/repos/org/repo/issues/5/comments");
  });
  test("edits the comment that already has the marker", async () => {
    calls.length = 0;
    await upsertPullRequestComment("tok", "org/repo", 5, "<!-- m -->", "new", stub([{ id: 9, body: "<!-- m -->\nold" }]));
    expect(calls.map((c) => c.method)).toEqual(["GET", "PATCH"]);
    expect(calls[1]!.url).toBe("https://api.github.com/repos/org/repo/issues/comments/9");
    expect(JSON.parse(calls[1]!.body!)).toEqual({ body: "new" });
  });
  test("throws when GitHub rejects the write", async () => {
    const failing = (async (_u: string, init?: { method?: string }) => (init?.method ? new Response("no", { status: 403 }) : new Response("[]", { status: 200 }))) as unknown as typeof fetch;
    await expect(upsertPullRequestComment("tok", "o/r", 1, "m", "b", failing)).rejects.toThrow("403");
  });
});
