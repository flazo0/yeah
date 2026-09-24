import { describe, expect, test } from "bun:test";
import { containerTerminalCommand, parseTerminalMessage } from "./terminal";

describe("parseTerminalMessage", () => {
  test("accepts input and resize frames, as JSON text or objects", () => {
    expect(parseTerminalMessage(JSON.stringify({ type: "input", data: "ls\r" }))).toEqual({ type: "input", data: "ls\r" });
    expect(parseTerminalMessage({ type: "resize", cols: 120, rows: 40 })).toEqual({ type: "resize", cols: 120, rows: 40 });
  });
  test("rejects garbage, unknown types and out-of-range sizes", () => {
    for (const bad of ["not json", "null", '"str"', { type: "nope" }, { type: "input", data: 5 }, { type: "resize", cols: 1, rows: 24 }, { type: "resize", cols: 80, rows: 9999 }, { type: "resize", cols: "x", rows: 24 }]) {
      expect(parseTerminalMessage(bad)).toBeNull();
    }
  });
  test("rejects an oversized input frame", () => {
    expect(parseTerminalMessage({ type: "input", data: "a".repeat(70_000) })).toBeNull();
  });
});

describe("containerTerminalCommand", () => {
  test("plain app: exec into the named container, bash if present", () => {
    const cmd = containerTerminalCommand({ id: "abc", buildPack: "dockerfile", composeService: null });
    expect(cmd.startsWith("exec docker exec -it 'yeah-app-abc' sh -c ")).toBe(true);
    expect(cmd).toContain("exec bash || exec sh");
  });
  test("compose app: picks the first container of the service by label", () => {
    const cmd = containerTerminalCommand({ id: "abc", buildPack: "docker_compose", composeService: "web" });
    expect(cmd).toContain("label=com.docker.compose.project=yeah-app-abc");
    expect(cmd).toContain("label=com.docker.compose.service=web");
    expect(cmd).toContain("head -n 1");
  });
  test("compose app with a bad stored service name ignores it instead of injecting", () => {
    const cmd = containerTerminalCommand({ id: "abc", buildPack: "docker_compose", composeService: "x'; rm -rf /" });
    expect(cmd).not.toContain("rm -rf");
    expect(cmd).not.toContain("compose.service");
  });
});
