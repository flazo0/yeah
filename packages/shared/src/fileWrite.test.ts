import { describe, expect, test } from "bun:test";
import { listDirCommand } from "./fileBrowser";
import {
  confirmsDelete,
  decodeEditableText,
  deleteCommand,
  fileWritesEnabled,
  isSafeStagingPath,
  isValidEntryName,
  mkdirCommand,
  normalizeBrowserPath,
  prepareStagingCommand,
  uploadLimitBytes,
  writeFileCommand,
  writeRefusal,
} from "./fileWrite";

const app = { id: "abc", buildPack: "dockerfile", composeService: null };
const svc = { kind: "service" as const, id: "s1", container: "web" };
const dbt = { kind: "database" as const, id: "d1" };
const staging = "/tmp/yeah-fb-0123abcd-ef01";

describe("opt-in and limits", () => {
  test("writes are off unless explicitly enabled", () => {
    expect(fileWritesEnabled(undefined)).toBe(false);
    expect(fileWritesEnabled("")).toBe(false);
    expect(fileWritesEnabled("false")).toBe(false);
    expect(fileWritesEnabled("yes")).toBe(false);
    expect(fileWritesEnabled("true")).toBe(true);
    expect(fileWritesEnabled(" 1 ")).toBe(true);
  });

  test("upload cap defaults to 10 MB and is clamped", () => {
    expect(uploadLimitBytes(undefined)).toBe(10 * 1024 * 1024);
    expect(uploadLimitBytes("abc")).toBe(10 * 1024 * 1024);
    expect(uploadLimitBytes("0")).toBe(10 * 1024 * 1024);
    expect(uploadLimitBytes("25")).toBe(25 * 1024 * 1024);
    expect(uploadLimitBytes("5000")).toBe(100 * 1024 * 1024);
  });
});

describe("path normalization", () => {
  test("canonicalizes slashes and rejects traversal and control characters", () => {
    expect(normalizeBrowserPath("/app//src/")).toBe("/app/src");
    expect(normalizeBrowserPath("/")).toBe("/");
    expect(normalizeBrowserPath("/app/../etc")).toBeNull();
    expect(normalizeBrowserPath("/app/./x")).toBeNull();
    expect(normalizeBrowserPath("app")).toBeNull();
    expect(normalizeBrowserPath("/a\u0000b")).toBeNull();
    expect(normalizeBrowserPath("/a\nb")).toBeNull();
    expect(normalizeBrowserPath(42)).toBeNull();
    expect(normalizeBrowserPath("/" + "a".repeat(300))).toBeNull();
  });

  test("entry names", () => {
    expect(isValidEntryName("notes.txt")).toBe(true);
    expect(isValidEntryName("a b")).toBe(true);
    expect(isValidEntryName("..")).toBe(false);
    expect(isValidEntryName("a/b")).toBe(false);
    expect(isValidEntryName("")).toBe(false);
    expect(isValidEntryName("a\nb")).toBe(false);
  });
});

describe("write refusals", () => {
  test("pseudo filesystems, root, sockets and non-canonical paths are refused", () => {
    expect(writeRefusal("/", "save")).not.toBeNull();
    expect(writeRefusal("/proc/1/mem", "save")).not.toBeNull();
    expect(writeRefusal("/sys", "mkdir")).not.toBeNull();
    expect(writeRefusal("/dev/null", "upload")).not.toBeNull();
    expect(writeRefusal("/var/run/docker.sock", "save")).not.toBeNull();
    expect(writeRefusal("/app//x", "save")).toBe("invalid path");
    expect(writeRefusal("/app/x/", "save")).toBe("invalid path");
    expect(writeRefusal("/procfs/x", "save")).toBeNull();
    expect(writeRefusal("/app/config.json", "save")).toBeNull();
  });

  test("top-level folders cannot be deleted, their content can", () => {
    expect(writeRefusal("/etc", "delete")).toBe("top-level folders cannot be deleted");
    expect(writeRefusal("/etc/app.conf", "delete")).toBeNull();
    expect(writeRefusal("/etc", "mkdir")).toBeNull();
  });

  test("delete needs the exact path repeated", () => {
    expect(confirmsDelete("/a/b", "/a/b")).toBe(true);
    expect(confirmsDelete("/a/b", "/a/c")).toBe(false);
    expect(confirmsDelete("/a/b", true)).toBe(false);
    expect(confirmsDelete("/a/b", undefined)).toBe(false);
  });
});

describe("binary detection", () => {
  test("text decodes, NUL bytes and invalid UTF-8 do not", () => {
    expect(decodeEditableText(new TextEncoder().encode("héllo\n"))).toBe("héllo\n");
    expect(decodeEditableText(new Uint8Array([0x61, 0, 0x62]))).toBeNull();
    expect(decodeEditableText(new Uint8Array([0xff, 0xfe, 0x41]))).toBeNull();
    expect(decodeEditableText(new Uint8Array())).toBe("");
  });
});

describe("command builders", () => {
  test("staging path must be a yeah temp file", () => {
    expect(isSafeStagingPath(staging)).toBe(true);
    expect(isSafeStagingPath("/tmp/yeah-fb-x; rm -rf /")).toBe(false);
    expect(isSafeStagingPath("/etc/passwd")).toBe(false);
    expect(() => writeFileCommand(app, "/a", "/tmp/evil", {})).toThrow();
    expect(() => prepareStagingCommand("/tmp/../etc")).toThrow();
    expect(prepareStagingCommand(staging)).toBe(`umask 077; : > '${staging}'`);
  });

  test("write passes the path as a quoted positional argument, never inside the script", () => {
    const cmd = writeFileCommand(app, "/app/it's $(x).txt", staging);
    expect(cmd).toContain(`sh '/app/it'\\''s $(x).txt' < '${staging}'`);
    expect(cmd).toContain(`cat > "$1"`);
    expect(cmd).toContain('docker exec -i "$c" sh -c');
    expect(cmd).toContain(`rm -f '${staging}'; exit $rc`);
    expect(cmd).toContain("c='yeah-app-abc'");
    expect(cmd).not.toContain('-e "$1"');
  });

  test("onlyNew refuses to overwrite", () => {
    expect(writeFileCommand(app, "/a", staging, { onlyNew: true })).toContain("already exists");
  });

  test("mkdir and delete quote the path after --", () => {
    expect(mkdirCommand(app, "/a b/$(x)")).toContain("mkdir -- '/a b/$(x)'");
    expect(deleteCommand(app, "/a;b")).toContain("rm -r -- '/a;b'");
  });

  test("service and database targets resolve their own containers", () => {
    expect(listDirCommand(dbt, "/")).toContain("c='yeah-db-d1'");
    const s = listDirCommand(svc, "/");
    expect(s).toContain("label=com.docker.compose.project=yeah-svc-s1");
    expect(s).toContain("label=com.docker.compose.service=web");
    expect(deleteCommand(svc, "/x/y")).toContain("label=com.docker.compose.service=web");
    expect(listDirCommand({ kind: "service", id: "s1", container: "a; rm -rf /" }, "/")).toContain("service=invalid");
  });
});
