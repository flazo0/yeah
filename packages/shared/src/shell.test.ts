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
