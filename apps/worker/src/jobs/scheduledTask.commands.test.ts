import { describe, expect, test } from "bun:test";
import { appendCapped, buildTaskCommand } from "./scheduledTask.commands";

describe("buildTaskCommand", () => {
  test("runs the command through sh -c inside the container, quoting both", () => {
    expect(buildTaskCommand("yeah-app-1", "php artisan schedule:run")).toBe("docker exec 'yeah-app-1' sh -c 'php artisan schedule:run'");
  });
  test("quotes shell metacharacters and single quotes literally", () => {
    const cmd = buildTaskCommand("c", "echo 'hi'; rm -rf / && $(id)");
    expect(cmd.startsWith("docker exec 'c' sh -c ")).toBe(true);
    expect(cmd).toContain(String.raw`'echo '\''hi'\''; rm -rf / && $(id)'`);
  });
});

describe("appendCapped", () => {
  test("appends normally under the cap", () => {
    expect(appendCapped("ab", "cd", 10)).toBe("abcd");
  });
  test("truncates at the cap with a marker, then ignores further output", () => {
    const once = appendCapped("aaaa", "bbbbbbbb", 6);
    expect(once.startsWith("aaaabb")).toBe(true);
    expect(once).toContain("[saída truncada]");
    expect(appendCapped(once, "more", 6)).toBe(once);
  });
});
