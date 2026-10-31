import { describe, expect, test } from "bun:test";
import { detectContainerProblems, parseContainerWatch } from "./containerWatch";

const out = ["/web|running|0|false|0|unless-stopped", "/worker|restarting|1|false|12|always", "/db|running|0|true|1|unless-stopped", "/flaky|running|0|false|5|always", "garbage"].join("\n");

describe("container watch", () => {
  test("parses inspect lines", () => {
    const rows = parseContainerWatch(out);
    expect(rows).toHaveLength(4);
    expect(rows[1]).toMatchObject({ name: "worker", status: "restarting", exitCode: 1, restartCount: 12 });
    expect(rows[2]?.oomKilled).toBe(true);
  });

  test("the first pass only learns counts", () => {
    const prev = new Map<string, number>();
    expect(detectContainerProblems(prev, parseContainerWatch(out))).toEqual([]);
    expect(prev.get("flaky")).toBe(5);
  });

  test("flags restart loops, OOM kills and constant restarting, ignoring sleeping apps", () => {
    const prev = new Map([["web", 0], ["worker", 12], ["db", 0], ["flaky", 1]]);
    const problems = detectContainerProblems(prev, parseContainerWatch(out));
    expect(problems.map((p) => [p.name, p.reason])).toEqual([["worker", "restarting"], ["db", "oom-killed"], ["flaky", "restart-loop"]]);
    const prev2 = new Map([["web", 0], ["worker", 12], ["db", 0], ["flaky", 1]]);
    expect(detectContainerProblems(prev2, parseContainerWatch(out), new Set(["worker", "db"])).map((p) => p.name)).toEqual(["flaky"]);
  });
});
