import { describe, expect, test } from "bun:test";
import { shellQuote } from "./shell";

describe("shellQuote", () => {
  test("wraps a plain value in single quotes", () => {
    expect(shellQuote("hello")).toBe("'hello'");
  });

  test("escapes an embedded single quote", () => {
    // it's -> 'it'\''s'
    expect(shellQuote("it's")).toBe("'it'" + "\\''" + "s'");
  });

  test("neutralizes a command-injection attempt via single-quote breakout", () => {
    const malicious = "'; rm -rf / #";
    const quoted = shellQuote(malicious);
    expect(quoted).toBe("''\\''; rm -rf / #'");
  });

  test("neutralizes command substitution and variable expansion syntax", () => {
    // Single-quoted strings in POSIX shells don't expand $(...), `...` or $VAR at all — quoting
    // alone is sufficient here, no need to escape these characters specifically.
    const value = "$(whoami) `id` $HOME";
    expect(shellQuote(value)).toBe(`'${value}'`);
  });

  test("handles an empty string", () => {
    expect(shellQuote("")).toBe("''");
  });

  test("handles a value that is only single quotes", () => {
    expect(shellQuote("'''")).toBe("''\\'''\\'''\\'''");
  });

  test("passes through double quotes and backslashes literally (safe inside single quotes)", () => {
    const value = 'say "hi" \\ done';
    expect(shellQuote(value)).toBe(`'${value}'`);
  });

  test("round-trips through the POSIX single-quote escaping rules", () => {
    // The real invariant: decoding the quoted form per POSIX rules (each '\'' means a literal
    // quote, everything else between quotes is literal) must reproduce the original string —
    // regardless of the exact character sequence shellQuote happens to produce.
    for (const input of ["a'b'c", "''", "no quotes here", "'", "'; rm -rf / #", "🎉'quote'🎉"]) {
      const quoted = shellQuote(input);
      expect(quoted.startsWith("'")).toBe(true);
      expect(quoted.endsWith("'")).toBe(true);
      const decoded = quoted.slice(1, -1).split("'\\''").join("'");
      expect(decoded).toBe(input);
    }
  });
});

import { isSshGitUrl, isValidDockerImage, parseDockerOptions } from "./shell";

describe("parseDockerOptions", () => {
  test("splits on whitespace and keeps quoted groups together", () => {
    expect(parseDockerOptions(`--cap-add NET_ADMIN --shm-size=1g --label "a b=c d" --hostname 'my host'`)).toEqual({
      ok: true,
      args: ["--cap-add", "NET_ADMIN", "--shm-size=1g", "--label", "a b=c d", "--hostname", "my host"],
    });
  });

  test("empty or blank input yields no args", () => {
    expect(parseDockerOptions("")).toEqual({ ok: true, args: [] });
    expect(parseDockerOptions("  \n ")).toEqual({ ok: true, args: [] });
  });

  test("shell metacharacters stay literal words", () => {
    const result = parseDockerOptions("--label x=$(rm -rf /) ; echo hi");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.args).toEqual(["--label", "x=$(rm", "-rf", "/)", ";", "echo", "hi"]);
  });

  test("rejects unterminated quotes", () => {
    expect(parseDockerOptions(`--label "oops`).ok).toBe(false);
  });

  test("rejects flags the deploy controls, including the = form", () => {
    for (const bad of ["--name foo", "-d", "--rm", "--env-file=/x", "--restart always", "--detach"]) {
      expect(parseDockerOptions(bad).ok).toBe(false);
    }
  });
});

describe("isValidDockerImage", () => {
  test("accepts common references", () => {
    for (const ok of ["nginx", "nginx:1.27-alpine", "ghcr.io/org/app:v1.2.3", "registry.example.com:5000/team/app", "app@sha256:" + "a".repeat(64)]) {
      expect(isValidDockerImage(ok)).toBe(true);
    }
  });
  test("rejects anything with spaces or shell characters", () => {
    for (const bad of ["", "nginx latest", "nginx;rm -rf /", "$(id)", "a`b", "-flag", "img:tag:extra"]) {
      expect(isValidDockerImage(bad)).toBe(false);
    }
  });
});

describe("isSshGitUrl", () => {
  test("scp-like and ssh:// urls", () => {
    expect(isSshGitUrl("git@github.com:org/repo.git")).toBe(true);
    expect(isSshGitUrl("ssh://git@host:2222/org/repo.git")).toBe(true);
  });
  test("https urls and junk are not ssh urls", () => {
    expect(isSshGitUrl("https://github.com/org/repo")).toBe(false);
    expect(isSshGitUrl("git@host")).toBe(false);
    expect(isSshGitUrl("")).toBe(false);
  });
});
