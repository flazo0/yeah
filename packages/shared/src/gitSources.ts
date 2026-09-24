// Git sources other than the GitHub App: GitLab, Bitbucket Cloud and Gitea (also Forgejo), each
// authenticated by an access token the team pastes in. The token is used to list repositories, to
// clone, and (with a per-source secret) the provider's webhook triggers deploys.

export type GitProvider = "gitlab" | "bitbucket" | "gitea";
export const GIT_PROVIDERS: GitProvider[] = ["gitlab", "bitbucket", "gitea"];

export const GIT_PROVIDER_LABELS: Record<GitProvider, string> = { gitlab: "GitLab", bitbucket: "Bitbucket", gitea: "Gitea / Forgejo" };

/** Where each provider lives by default (self-hosted GitLab and Gitea set their own base URL). */
export const GIT_PROVIDER_DEFAULT_URL: Record<GitProvider, string | null> = {
  gitlab: "https://gitlab.com",
  bitbucket: "https://bitbucket.org",
  gitea: null,
};

export interface GitSourceDto {
  id: string;
  provider: GitProvider;
  name: string;
  baseUrl: string;
  username: string;
  /** The token is write-only. */
  hasToken: boolean;
  /** Path to register as the provider's webhook (append to the panel's API URL). */
  webhookPath: string;
  createdAt: string;
}

export interface GitRepoDto {
  /** "group/project" — what the clone URL and the webhook use. */
  fullName: string;
  defaultBranch: string;
  private: boolean;
}

/** "https://host[:port][/prefix]" with no credentials, query or trailing slash. */
export function normalizeGitBaseUrl(input: string): string {
  return input.trim().replace(/\/+$/, "");
}

export function isValidGitBaseUrl(url: string): boolean {
  return /^https?:\/\/[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:[0-9]{1,5})?(\/[A-Za-z0-9._~\/-]*)?$/i.test(url) && !url.includes("@");
}

/** "group/sub-group/project" — path segments of letters, digits and . _ - only. */
export function isValidGitRepoPath(path: string): boolean {
  return path.length <= 255 && /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)+$/.test(path) && !path.split("/").some((p) => p === "." || p === ".." || p.endsWith(".git"));
}

/** Clone URL without credentials (what is stored and shown). */
export function gitRepoUrl(baseUrl: string, repoPath: string): string {
  return `${normalizeGitBaseUrl(baseUrl)}/${repoPath}.git`;
}

/**
 * Clone URL with the token embedded, valid only for the duration of a deploy (never stored). GitLab
 * accepts any user with a personal/project token, conventionally "oauth2"; Gitea and Bitbucket use the
 * account's username. Both parts are percent-encoded so a token with odd characters cannot break the URL.
 */
export function gitCloneUrlWithToken(provider: GitProvider, baseUrl: string, username: string, token: string, repoPath: string): string {
  const url = new URL(gitRepoUrl(baseUrl, repoPath));
  url.username = provider === "gitlab" ? "oauth2" : username;
  url.password = token;
  return url.toString();
}

// ---- repository listings (provider REST responses → GitRepoDto)

interface GitlabProject { path_with_namespace?: string; default_branch?: string | null; visibility?: string }
interface GiteaRepo { full_name?: string; default_branch?: string; private?: boolean }
interface BitbucketRepo { full_name?: string; mainbranch?: { name?: string } | null; is_private?: boolean }

export function parseRepoList(provider: GitProvider, json: unknown): GitRepoDto[] {
  if (provider === "gitlab") {
    return (Array.isArray(json) ? (json as GitlabProject[]) : [])
      .filter((p) => typeof p.path_with_namespace === "string")
      .map((p) => ({ fullName: p.path_with_namespace!, defaultBranch: p.default_branch || "main", private: p.visibility !== "public" }));
  }
  if (provider === "gitea") {
    const list = Array.isArray(json) ? (json as GiteaRepo[]) : (json as { data?: GiteaRepo[] } | null)?.data ?? [];
    return list.filter((r) => typeof r.full_name === "string").map((r) => ({ fullName: r.full_name!, defaultBranch: r.default_branch || "main", private: r.private !== false }));
  }
  const values = (json as { values?: BitbucketRepo[] } | null)?.values ?? [];
  return values
    .filter((r) => typeof r.full_name === "string")
    .map((r) => ({ fullName: r.full_name!, defaultBranch: r.mainbranch?.name || "main", private: r.is_private !== false }));
}

/** The request that lists the repositories the token can see. Bitbucket authenticates with username + app password. */
export function repoListRequest(provider: GitProvider, baseUrl: string, username: string, token: string): { url: string; headers: Record<string, string> } {
  const base = normalizeGitBaseUrl(baseUrl);
  if (provider === "gitlab") return { url: `${base}/api/v4/projects?membership=true&simple=true&per_page=100&order_by=last_activity_at`, headers: { "PRIVATE-TOKEN": token } };
  if (provider === "gitea") return { url: `${base}/api/v1/user/repos?limit=50`, headers: { Authorization: `token ${token}` } };
  return {
    url: "https://api.bitbucket.org/2.0/repositories?role=member&pagelen=100",
    headers: { Authorization: `Basic ${btoa(`${username}:${token}`)}` },
  };
}
