import { describe, expect, test } from "bun:test";
import { isSafeBrowserPath, joinBrowserPath, listDirCommand, looksLikeText, parentBrowserPath, parseListing, readFileCommand } from "./fileBrowser";

const app = { id: "abc", buildPack: "dockerfile", composeService: null };

describe("browser paths", () => {
  test("only absolute, clean paths are accepted", () => {
    expect(isSafeBrowserPath("/")).toBe(true);
    expect(isSafeBrowserPath("/app/src/index.ts")).toBe(true);
    expect(isSafeBrowserPath("app")).toBe(false);
    expect(isSafeBrowserPath("/app/../etc")).toBe(false);
    expect(isSafeBrowserPath("/a\nb")).toBe(false);
    expect(isSafeBrowserPath("")).toBe(false);
  });

  test("join and parent", () => {
    expect(joinBrowserPath("/", "etc")).toBe("/etc");
    expect(joinBrowserPath("/app/", "src")).toBe("/app/src");
    expect(parentBrowserPath("/app/src")).toBe("/app");
    expect(parentBrowserPath("/app")).toBe("/");
    expect(parentBrowserPath("/")).toBe("/");
  });
});

describe("commands", () => {
  test("path goes in as a quoted argument after --", () => {
    expect(listDirCommand(app, "/a b/$(x)")).toContain("ls -lAp -- '/a b/$(x)'");
    expect(readFileCommand(app, "/etc/hosts")).toContain("head -c 262145 -- '/etc/hosts'");
    expect(listDirCommand(app, "/")).toContain("c='yeah-app-abc'");
  });

  test("a compose application resolves the container by project and service", () => {
    const cmd = listDirCommand({ id: "abc", buildPack: "docker_compose", composeService: "web" }, "/");
    expect(cmd).toContain("label=com.docker.compose.project=");
    expect(cmd).toContain("label=com.docker.compose.service=web");
  });
});

describe("parseListing", () => {
  const gnu = [
    "total 20",
    "drwxr-xr-x 2 root root 4096 Oct 11 12:00 src/",
    "-rw-r--r-- 1 root root  220 Oct 11 12:00 package.json",
    "lrwxrwxrwx 1 root root    7 Oct 11 12:00 current -> ./v1.2",
    "-rw-r--r-- 1 root root   12 Oct 11 12:00 my file.txt",
  ].join("\n");

  test("directories first, names intact, link target dropped, sizes parsed", () => {
    const entries = parseListing(gnu);
    expect(entries.map((e) => e.name)).toEqual(["src", "current", "my file.txt", "package.json"]);
    expect(entries[0]).toMatchObject({ kind: "dir", size: null });
    expect(entries.find((e) => e.name === "current")?.kind).toBe("link");
    expect(entries.find((e) => e.name === "package.json")).toMatchObject({ kind: "file", size: 220 });
  });

  test("BusyBox column spacing parses too", () => {
    const entries = parseListing("drwxr-xr-x    2 root     root          4096 Oct 11 12:00 node_modules/\n-rwxr-xr-x    1 root     root           512 Oct 11  2024 run.sh");
    expect(entries.map((e) => e.name)).toEqual(["node_modules", "run.sh"]);
    expect(entries[1]?.size).toBe(512);
  });

  test("error output yields no entries", () => {
    expect(parseListing("ls: /nope: No such file or directory")).toEqual([]);
  });

  test("text detection", () => {
    expect(looksLikeText("hello")).toBe(true);
    expect(looksLikeText("a\u0000b")).toBe(false);
  });
});
