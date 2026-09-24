import { resourceSlug } from "./shell";

// Preview deployments: a GitHub pull request becomes a throw-away copy of an application, with its
// own hostname, deployed from the PR branch and removed when the PR closes.

export type PullRequestAction = "opened" | "reopened" | "synchronize" | "closed";

export interface PullRequestEvent {
  action: PullRequestAction;
  number: number;
  /** Branch the PR proposes (what the preview builds). */
  headRef: string;
  /** Branch it targets (must match the application's branch for the PR to get a preview). */
  baseRef: string;
  repo: string;
  /** True when the PR comes from a fork — its code is untrusted, so it never gets a preview. */
  fromFork: boolean;
  installationId: number | null;
}

const ACTIONS: PullRequestAction[] = ["opened", "reopened", "synchronize", "closed"];

/** Extracts the fields the preview logic needs from a `pull_request` webhook payload; null when it is not one we act on. */
export function parsePullRequestEvent(payload: unknown): PullRequestEvent | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as {
    action?: unknown;
    number?: unknown;
    installation?: { id?: unknown };
    repository?: { full_name?: unknown };
    pull_request?: { head?: { ref?: unknown; repo?: { full_name?: unknown } | null }; base?: { ref?: unknown } };
  };
  if (typeof p.action !== "string" || !ACTIONS.includes(p.action as PullRequestAction)) return null;
  const repo = p.repository?.full_name;
  const headRef = p.pull_request?.head?.ref;
  const baseRef = p.pull_request?.base?.ref;
  if (typeof p.number !== "number" || !Number.isInteger(p.number) || p.number < 1) return null;
  if (typeof repo !== "string" || typeof headRef !== "string" || typeof baseRef !== "string") return null;
  // A deleted fork has no head repo — treat as a fork.
  const headRepo = p.pull_request?.head?.repo?.full_name;
  return {
    action: p.action as PullRequestAction,
    number: p.number,
    headRef,
    baseRef,
    repo,
    fromFork: typeof headRepo !== "string" || headRepo !== repo,
    installationId: typeof p.installation?.id === "number" ? p.installation.id : null,
  };
}

export function previewName(parentName: string, prNumber: number): string {
  return `${parentName}-pr-${prNumber}`;
}

/** `pr-<n>-<app-slug>.<server wildcard>` — same slug rule as the generated domain of a normal app. */
export function previewDomain(parentName: string, prNumber: number, wildcardDomain: string): string {
  return `pr-${prNumber}-${resourceSlug(parentName)}.${wildcardDomain}`;
}

/** Hidden marker that lets the deploy job find and update its own comment instead of posting a new one each push. */
export function previewCommentMarker(applicationId: string): string {
  return `<!-- yeah-preview:${applicationId} -->`;
}

export function previewCommentBody(applicationId: string, state: "ready" | "failed", url: string, commit: string | null): string {
  const sha = commit ? ` (commit \`${commit.slice(0, 7)}\`)` : "";
  const text =
    state === "ready"
      ? `Preview pronto${sha}: ${url}`
      : `O deploy do preview falhou${sha}. Veja os logs no painel do yeah.`;
  return `${previewCommentMarker(applicationId)}\n${text}`;
}
