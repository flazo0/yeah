import { describe, expect, test } from "bun:test";
import { gitCloneUrlWithToken, gitRepoUrl, isValidGitBaseUrl, isValidGitRepoPath, normalizeGitBaseUrl, parseRepoList, repoListRequest } from "./gitSources";

describe("validation", () => {
  test("base urls", () => {
    for (const ok of ["https://gitlab.com", "https://git.example.com:8443", "http://10.0.0.4:3000", "https://host/gitlab"]) expect(isValidGitBaseUrl(ok)).toBe(true);
    for (const bad of ["gitlab.com", "ftp://x.com", "https://user:pw@host", "https://host/a b", "https://", "https://host?x=1", "javascript:alert(1)"]) expect(isValidGitBaseUrl(bad)).toBe(false);
    expect(normalizeGitBaseUrl(" https://gitlab.com/// ")).toBe("https://gitlab.com");
  });
  test("repo paths", () => {
    for (const ok of ["group/project", "group/sub/project", "my-org/my.repo_1"]) expect(isValidGitRepoPath(ok)).toBe(true);
    for (const bad of ["project", "/group/project", "group/project.git", "group/../x", "a/b c", "a/b;c", "a//b"]) expect(isValidGitRepoPath(bad)).toBe(false);
  });
});

describe("clone urls", () => {
  test("plain url has no credentials", () => {
    expect(gitRepoUrl("https://gitlab.com/", "grp/proj")).toBe("https://gitlab.com/grp/proj.git");
  });
  test("gitlab uses oauth2, gitea and bitbucket use the username", () => {
    expect(gitCloneUrlWithToken("gitlab", "https://gitlab.com", "ignored", "glpat-abc", "g/p")).toBe("https://oauth2:glpat-abc@gitlab.com/g/p.git");
    expect(gitCloneUrlWithToken("gitea", "http://10.0.0.4:3000", "bob", "tok", "o/r")).toBe("http://bob:tok@10.0.0.4:3000/o/r.git");
    expect(gitCloneUrlWithToken("bitbucket", "https://bitbucket.org", "me", "app-pw", "ws/repo")).toBe("https://me:app-pw@bitbucket.org/ws/repo.git");
  });
  test("odd characters in the token are percent-encoded, not injected", () => {
    const url = gitCloneUrlWithToken("gitea", "https://g.example.com", "u", "a@b/c:d#e", "o/r");
    expect(url.startsWith("https://u:")).toBe(true);
    expect(url.endsWith("@g.example.com/o/r.git")).toBe(true);
    expect(url.split("@").length).toBe(2);
  });
});

describe("repository listings", () => {
  test("gitlab", () => {
    expect(parseRepoList("gitlab", [{ path_with_namespace: "g/p", default_branch: "trunk", visibility: "private" }, { path_with_namespace: "g/pub", default_branch: null, visibility: "public" }, { nope: 1 }])).toEqual([
      { fullName: "g/p", defaultBranch: "trunk", private: true },
      { fullName: "g/pub", defaultBranch: "main", private: false },
    ]);
  });
  test("gitea (array or { data })", () => {
    const repo = { full_name: "o/r", default_branch: "dev", private: true };
    expect(parseRepoList("gitea", [repo])).toEqual([{ fullName: "o/r", defaultBranch: "dev", private: true }]);
    expect(parseRepoList("gitea", { data: [repo] })).toHaveLength(1);
  });
  test("bitbucket", () => {
    expect(parseRepoList("bitbucket", { values: [{ full_name: "ws/r", mainbranch: { name: "master" }, is_private: true }, { full_name: "ws/x", mainbranch: null }] })).toEqual([
      { fullName: "ws/r", defaultBranch: "master", private: true },
      { fullName: "ws/x", defaultBranch: "main", private: true },
    ]);
  });
  test("garbage never throws", () => {
    for (const p of ["gitlab", "gitea", "bitbucket"] as const) {
      expect(parseRepoList(p, null)).toEqual([]);
      expect(parseRepoList(p, "x")).toEqual([]);
    }
  });
});

describe("repoListRequest", () => {
  test("each provider authenticates its own way", () => {
    expect(repoListRequest("gitlab", "https://gitlab.com/", "u", "T").headers).toEqual({ "PRIVATE-TOKEN": "T" });
    expect(repoListRequest("gitea", "https://g.io", "u", "T")).toEqual({ url: "https://g.io/api/v1/user/repos?limit=50", headers: { Authorization: "token T" } });
    expect(repoListRequest("bitbucket", "https://bitbucket.org", "me", "pw").headers.Authorization).toBe(`Basic ${btoa("me:pw")}`);
  });
});
