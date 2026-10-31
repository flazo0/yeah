import { describe, expect, test } from "bun:test";
import { buildLifecycleCommand, lifecycleResultStatus } from "./lifecycleApplication.commands";

describe("buildLifecycleCommand", () => {
  test("start has no grace period", () => {
    expect(buildLifecycleCommand("start", "yeah-app-1", 10)).toBe("docker start 'yeah-app-1'");
  });
  test("stop and restart pass the grace period", () => {
    expect(buildLifecycleCommand("stop", "yeah-app-1", 25)).toBe("docker stop -t 25 'yeah-app-1'");
    expect(buildLifecycleCommand("restart", "yeah-app-1", 5)).toBe("docker restart -t 5 'yeah-app-1'");
  });
  test("a negative or fractional grace is clamped to a whole, non-negative number", () => {
    expect(buildLifecycleCommand("stop", "c", -3)).toContain("-t 0 ");
    expect(buildLifecycleCommand("stop", "c", 2.9)).toContain("-t 2 ");
  });
  test("result status", () => {
    expect(lifecycleResultStatus("stop")).toBe("stopped");
    expect(lifecycleResultStatus("start")).toBe("running");
    expect(lifecycleResultStatus("restart")).toBe("running");
  });
});
