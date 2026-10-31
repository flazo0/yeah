import { describe, expect, test } from "bun:test";
import { buildTimeEntries, expandReferences, isValidVariableKey, parseEnvContent, renderRuntimeEnv } from "./env";

describe("parseEnvContent", () => {
  test("reads plain, build: and both: lines and skips comments and blanks", () => {
    const entries = parseEnvContent("# comment\n\nA=1\nbuild:NPM_TOKEN=secret\nboth:MODE=prod\r\nB=x=y\nnot a line\n");
    expect(entries).toEqual([
      { key: "A", value: "1", availability: "runtime" },
      { key: "NPM_TOKEN", value: "secret", availability: "build" },
      { key: "MODE", value: "prod", availability: "both" },
      { key: "B", value: "x=y", availability: "runtime" },
    ]);
  });

  test("values keep everything after the first equals sign, including spaces and quotes", () => {
    expect(parseEnvContent('URL=postgres://u:p@h/db?a=b\nMSG="hello world"')).toEqual([
      { key: "URL", value: "postgres://u:p@h/db?a=b", availability: "runtime" },
      { key: "MSG", value: '"hello world"', availability: "runtime" },
    ]);
  });
});

describe("runtime vs build-time", () => {
  const entries = parseEnvContent("A=1\nbuild:B=2\nboth:C=3");
  test("the container env file gets runtime and both, never build-only", () => {
    expect(renderRuntimeEnv(entries)).toBe("A=1\nC=3\n");
  });
  test("the build gets build and both, never runtime-only", () => {
    expect(buildTimeEntries(entries).map((e) => e.key)).toEqual(["B", "C"]);
  });
  test("an empty env renders as an empty file", () => {
    expect(renderRuntimeEnv([])).toBe("");
  });
});

describe("expandReferences", () => {
  const vars = [
    { scope: "project" as const, key: "NODE_ENV", value: "production" },
    { scope: "team" as const, key: "SMTP", value: "smtp.example.com" },
    { scope: "environment" as const, key: "NODE_ENV", value: "staging" },
  ];

  test("replaces references in any position, tolerating spaces inside the braces", () => {
    const { entries, missing } = expandReferences(parseEnvContent("A={{project.NODE_ENV}}\nB=host={{ team.SMTP }}:25\nC={{environment.NODE_ENV}}"), vars);
    expect(entries.map((e) => e.value)).toEqual(["production", "host=smtp.example.com:25", "staging"]);
    expect(missing).toEqual([]);
  });

  test("the same name in different scopes never collides — each reference names its scope", () => {
    const { entries } = expandReferences(parseEnvContent("A={{project.NODE_ENV}}\nB={{environment.NODE_ENV}}"), vars);
    expect(entries.map((e) => e.value)).toEqual(["production", "staging"]);
  });

  test("reports missing references instead of silently blanking them", () => {
    const { entries, missing } = expandReferences(parseEnvContent("A={{project.NOPE}}\nB={{team.SMTP}}\nC={{project.NOPE}}"), vars);
    expect(missing).toEqual(["project.NOPE"]);
    expect(entries[0]!.value).toBe("");
  });

  test("an unknown scope is left untouched (it is not a reference)", () => {
    expect(expandReferences(parseEnvContent("A={{global.X}}"), vars).entries[0]!.value).toBe("{{global.X}}");
  });

  test("values with $ or backslashes are inserted literally", () => {
    const { entries } = expandReferences(parseEnvContent("A={{team.P}}"), [{ scope: "team", key: "P", value: "pa$$word\\1$&" }]);
    expect(entries[0]!.value).toBe("pa$$word\\1$&");
  });
});

describe("isValidVariableKey", () => {
  test("shell-style identifiers only", () => {
    expect(isValidVariableKey("NODE_ENV")).toBe(true);
    expect(isValidVariableKey("_x1")).toBe(true);
    for (const bad of ["", "1A", "A-B", "A B", "A=B", "a.b"]) expect(isValidVariableKey(bad)).toBe(false);
  });
});
