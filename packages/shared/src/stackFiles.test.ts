import { describe, expect, test } from "bun:test";
import { isSafeStackPath, renderStackFile, stackDirsCommand, stackFileWrites, validateStackFiles } from "./stackFiles";

describe("stack file paths", () => {
  test("relative plain paths only", () => {
    expect(isSafeStackPath("nginx/nginx.conf")).toBe(true);
    expect(isSafeStackPath("volumes/db/_supabase.sql")).toBe(true);
    expect(isSafeStackPath("../etc/passwd")).toBe(false);
    expect(isSafeStackPath("/etc/passwd")).toBe(false);
    expect(isSafeStackPath("a//b")).toBe(false);
    expect(isSafeStackPath("a/./b")).toBe(false);
    expect(isSafeStackPath("a b")).toBe(false);
    expect(isSafeStackPath("")).toBe(false);
  });

  test("validation reports the first problem", () => {
    expect(validateStackFiles({ files: { "ok.conf": "x" }, dirs: ["data"] })).toBeNull();
    expect(validateStackFiles({ files: { "../x": "x" }, dirs: [] })).toContain("../x");
    expect(validateStackFiles({ files: { big: "x".repeat(600 * 1024) }, dirs: [] })).toContain("big");
  });
});

describe("renderStackFile", () => {
  const env = { PASS: "s3cret", EMPTY: "" };
  test("substitutes known names and defaults, leaves everything else alone", () => {
    expect(renderStackFile("pw=${PASS} u=${USERX:-admin} e=${EMPTY:-d} k=${UNKNOWN}", env)).toBe("pw=s3cret u=admin e=d k=${UNKNOWN}");
  });
  test("shell variables and SQL dollar quoting are untouched", () => {
    const sql = "CREATE FUNCTION f() AS $$ BEGIN RETURN $1; END $$; echo $HOME ${PASS}";
    expect(renderStackFile(sql, env)).toBe("CREATE FUNCTION f() AS $$ BEGIN RETURN $1; END $$; echo $HOME s3cret");
  });
});

describe("writes and directories", () => {
  const stack = { files: { "b/run.sh": "#!/bin/sh\necho ${PASS}\n", "a.conf": "x" }, dirs: ["data/uploads"] };
  test("scripts are executable, output is sorted and rendered", () => {
    const w = stackFileWrites(stack, { PASS: "p" });
    expect(w.map((f) => f.path)).toEqual(["a.conf", "b/run.sh"]);
    expect(w[1]).toMatchObject({ executable: true, content: "#!/bin/sh\necho p\n" });
    expect(w[0]?.executable).toBe(false);
  });
  test("mkdir covers parents of files and the empty folders", () => {
    expect(stackDirsCommand("/opt/s", stack)).toBe("mkdir -p '/opt/s/b' '/opt/s/data/uploads'");
    expect(stackDirsCommand("/opt/s", { files: {}, dirs: [] })).toBe("true");
  });
});
