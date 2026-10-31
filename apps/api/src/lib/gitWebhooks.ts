import { createHmac, timingSafeEqual } from "node:crypto";
import type { GitProvider } from "@yeah/shared";

// Push webhooks of GitLab, Gitea/Forgejo and Bitbucket Cloud: how each proves it came from the
// provider (a per-source secret) and where each puts the repository, branch and commit message.

const safeEqual = (a: string, b: string): boolean => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

const hmacHex = (secret: string, body: string) => createHmac("sha256", secret).update(body).digest("hex");

/** True when the request carries the source's secret in the way its provider does it. */
export function verifyGitWebhook(provider: GitProvider, headers: Headers, rawBody: string, secret: string): boolean {
  if (!secret) return false;
  if (provider === "gitlab") {
    // GitLab echoes the secret token back verbatim in a header (no signature).
    const token = headers.get("x-gitlab-token");
    return token !== null && safeEqual(token, secret);
  }
  const expected = hmacHex(secret, rawBody);
  if (provider === "gitea") {
    // Gitea/Forgejo: bare hex in X-Gitea-Signature / X-Forgejo-Signature; also GitHub-style when configured so.
    const bare = headers.get("x-gitea-signature") ?? headers.get("x-forgejo-signature");
    if (bare) return safeEqual(bare, expected);
    const prefixed = headers.get("x-hub-signature-256");
    return prefixed !== null && safeEqual(prefixed, `sha256=${expected}`);
  }
  // Bitbucket Cloud: "sha256=<hex>" in X-Hub-Signature.
  const sig = headers.get("x-hub-signature");
  return sig !== null && safeEqual(sig, `sha256=${expected}`);
}

export interface ParsedPush {
  /** "group/project". */
  repo: string;
  /** Every branch the push updated, each with the message of its newest commit. */
  branches: Array<{ branch: string; message: string | null }>;
}

const branchOf = (ref: unknown): string | null => (typeof ref === "string" && ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : null);

/** Extracts what a push webhook says; null for other events or payloads that are not a branch push. */
export function parseGitPush(provider: GitProvider, headers: Headers, payload: unknown): ParsedPush | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;

  if (provider === "gitlab") {
    if (headers.get("x-gitlab-event") !== "Push Hook") return null;
    const repo = (p.project as { path_with_namespace?: unknown } | undefined)?.path_with_namespace;
    const branch = branchOf(p.ref);
    if (typeof repo !== "string" || !branch) return null;
    const commits = Array.isArray(p.commits) ? (p.commits as Array<{ message?: unknown }>) : [];
    const last = commits.at(-1)?.message;
    return { repo, branches: [{ branch, message: typeof last === "string" ? last : null }] };
  }

  if (provider === "gitea") {
    const event = headers.get("x-gitea-event") ?? headers.get("x-forgejo-event") ?? headers.get("x-github-event");
    if (event !== "push") return null;
    const repo = (p.repository as { full_name?: unknown } | undefined)?.full_name;
    const branch = branchOf(p.ref);
    if (typeof repo !== "string" || !branch) return null;
    const head = (p.head_commit as { message?: unknown } | null | undefined)?.message;
    return { repo, branches: [{ branch, message: typeof head === "string" ? head : null }] };
  }

  if (headers.get("x-event-key") !== "repo:push") return null;
  const repo = (p.repository as { full_name?: unknown } | undefined)?.full_name;
  const changes = (p.push as { changes?: Array<{ new?: { type?: string; name?: string; target?: { message?: string } } | null }> } | undefined)?.changes;
  if (typeof repo !== "string" || !Array.isArray(changes)) return null;
  const branches = changes
    .filter((c) => c.new?.type === "branch" && typeof c.new.name === "string")
    .map((c) => ({ branch: c.new!.name!, message: c.new!.target?.message ?? null }));
  return branches.length ? { repo, branches } : null;
}
