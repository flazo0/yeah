import { createHmac, createSign, timingSafeEqual } from "node:crypto";

export interface GithubConfig {
  appId: string;
  appSlug: string;
  privateKey: string;
  webhookSecret: string;
}

/**
 * GitHub App connection is opt-in infrastructure, unlike DATABASE_URL — most self-hosted
 * instances won't have registered a GitHub App, so missing env vars mean "feature disabled"
 * here, not a fatal boot error. `GITHUB_APP_PRIVATE_KEY_BASE64` holds a PEM; since `.env` files
 * don't handle embedded newlines well, it's expected base64-encoded and decoded here.
 */
export function getGithubConfig(): GithubConfig | null {
  const appId = process.env.GITHUB_APP_ID;
  const appSlug = process.env.GITHUB_APP_SLUG;
  const privateKeyB64 = process.env.GITHUB_APP_PRIVATE_KEY_BASE64;
  const webhookSecret = process.env.GITHUB_APP_WEBHOOK_SECRET;
  if (!appId || !appSlug || !privateKeyB64 || !webhookSecret) return null;

  return {
    appId,
    appSlug,
    privateKey: Buffer.from(privateKeyB64, "base64").toString("utf-8"),
    webhookSecret,
  };
}

function base64url(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input) : input;
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * A GitHub App authenticates as itself with a short-lived JWT (max 10 min), signed with the
 * private key generated when the App was created on github.com. This JWT is only used to mint
 * installation access tokens below — it's never sent to a user or stored anywhere.
 */
export function signAppJwt(appId: string, privateKeyPem: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  // -60s clock-drift allowance, matches GitHub's own documented example.
  const payload = base64url(JSON.stringify({ iat: now - 60, exp: now + 600, iss: appId }));
  const signingInput = `${header}.${payload}`;
  const signature = base64url(createSign("RSA-SHA256").update(signingInput).sign(privateKeyPem));
  return `${signingInput}.${signature}`;
}

export interface InstallationInfo {
  installationId: number;
  accountLogin: string;
  accountType: string;
}

export async function getInstallation(
  appId: string,
  privateKeyPem: string,
  installationId: number,
): Promise<InstallationInfo> {
  const jwt = signAppJwt(appId, privateKeyPem);
  const res = await fetch(`https://api.github.com/app/installations/${installationId}`, {
    headers: { Authorization: `Bearer ${jwt}`, Accept: "application/vnd.github+json" },
  });
  if (!res.ok) throw new Error(`GitHub API error fetching installation: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { id: number; account: { login: string; type: string } };
  return { installationId: body.id, accountLogin: body.account.login, accountType: body.account.type };
}

export interface InstallationToken {
  token: string;
  expiresAt: string;
}

export async function getInstallationToken(
  appId: string,
  privateKeyPem: string,
  installationId: number,
): Promise<InstallationToken> {
  const jwt = signAppJwt(appId, privateKeyPem);
  const res = await fetch(`https://api.github.com/app/installations/${installationId}/access_tokens`, {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}`, Accept: "application/vnd.github+json" },
  });
  if (!res.ok) throw new Error(`GitHub API error minting installation token: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { token: string; expires_at: string };
  return { token: body.token, expiresAt: body.expires_at };
}

export interface InstallationRepo {
  fullName: string;
  defaultBranch: string;
  private: boolean;
}

export async function listInstallationRepos(installationToken: string): Promise<InstallationRepo[]> {
  const repos: InstallationRepo[] = [];
  let page = 1;
  for (;;) {
    const res = await fetch(`https://api.github.com/installation/repositories?per_page=100&page=${page}`, {
      headers: { Authorization: `Bearer ${installationToken}`, Accept: "application/vnd.github+json" },
    });
    if (!res.ok) throw new Error(`GitHub API error listing repos: ${res.status} ${await res.text()}`);
    const body = (await res.json()) as {
      repositories: { full_name: string; default_branch: string; private: boolean }[];
    };
    repos.push(...body.repositories.map((r) => ({ fullName: r.full_name, defaultBranch: r.default_branch, private: r.private })));
    if (body.repositories.length < 100) break;
    page += 1;
  }
  return repos;
}

/** Embeds a fresh installation token in the clone URL — this is GitHub's documented way to `git clone` a repo an App installation can see, private or not. */
export function cloneUrlForRepo(installationToken: string, repoFullName: string): string {
  return `https://x-access-token:${installationToken}@github.com/${repoFullName}.git`;
}

/** Constant-time comparison, same rationale as any webhook/HMAC check — a timing side-channel would leak the secret one byte at a time. */
export function verifyWebhookSignature(rawBody: string, signatureHeader: string | null, secret: string): boolean {
  if (!signatureHeader?.startsWith("sha256=")) return false;
  const expected = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Posts `body` as a comment on a pull request, or edits the one that already carries `marker` — so a
 * PR gets one comment per preview no matter how many pushes it sees. `fetchImpl` is injectable for tests.
 */
export async function upsertPullRequestComment(
  installationToken: string,
  repoFullName: string,
  prNumber: number,
  marker: string,
  body: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const headers = { Authorization: `Bearer ${installationToken}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" };
  const base = `https://api.github.com/repos/${repoFullName}/issues/${prNumber}/comments`;
  const list = await fetchImpl(`${base}?per_page=100`, { headers });
  if (!list.ok) throw new Error(`GitHub API error listing comments: ${list.status}`);
  const comments = (await list.json()) as Array<{ id: number; body?: string }>;
  const existing = comments.find((c) => c.body?.includes(marker));
  const res = existing
    ? await fetchImpl(`https://api.github.com/repos/${repoFullName}/issues/comments/${existing.id}`, { method: "PATCH", headers, body: JSON.stringify({ body }) })
    : await fetchImpl(base, { method: "POST", headers, body: JSON.stringify({ body }) });
  if (!res.ok) throw new Error(`GitHub API error writing comment: ${res.status}`);
}
