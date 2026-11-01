import { describe, expect, test } from "bun:test";
import { ContainerStatusTracker, detectContainerProblems, effectiveContainerState, isManagedContainerName, parseContainerWatch, type WatchedContainer } from "./containerWatch";

function row(name: string, status: string, health = ""): WatchedContainer {
  return { name, status, exitCode: 0, oomKilled: false, restartCount: 0, restartPolicy: "always", health };
}

describe("container status tracker", () => {
  test("parses the optional health column", () => {
    expect(parseContainerWatch("/a|running|0|false|0|always|unhealthy")[0]?.health).toBe("unhealthy");
    expect(parseContainerWatch("/a|running|0|false|0|always|")[0]?.health).toBe("");
  });

  test("only yeah-managed containers are tracked and unhealthy outranks running", () => {
    expect(isManagedContainerName("yeah-app-1-web-1")).toBe(true);
    expect(isManagedContainerName("yeah-db-9")).toBe(true);
    expect(isManagedContainerName("portainer")).toBe(false);
    expect(effectiveContainerState(row("x", "running", "unhealthy"))).toBe("unhealthy");
    expect(effectiveContainerState(row("x", "exited", "unhealthy"))).toBe("exited");
  });

  test("learns on the first poll, then reports a change only once it is confirmed", () => {
    const tr = new ContainerStatusTracker(2, 0);
    expect(tr.observe([row("yeah-app-1", "running")])).toEqual([]);
    expect(tr.observe([row("yeah-app-1", "exited")])).toEqual([]);
    expect(tr.observe([row("yeah-app-1", "exited")])).toEqual([{ name: "yeah-app-1", from: "running", to: "exited" }]);
    expect(tr.observe([row("yeah-app-1", "exited")])).toEqual([]);
    tr.observe([row("yeah-app-1", "running")]);
    expect(tr.observe([row("yeah-app-1", "running")])).toEqual([{ name: "yeah-app-1", from: "exited", to: "running" }]);
  });

  test("a blip that returns to the reported state is never reported", () => {
    const tr = new ContainerStatusTracker(2, 0);
    tr.observe([row("yeah-app-1", "running")]);
    tr.observe([row("yeah-app-1", "restarting")]);
    expect(tr.observe([row("yeah-app-1", "running")])).toEqual([]);
    expect(tr.observe([row("yeah-app-1", "restarting")])).toEqual([]);
  });

  test("a flapping container is held for the minimum interval and then reports its settled state", () => {
    let now = 0;
    const tr = new ContainerStatusTracker(1, 5 * 60_000, () => now);
    tr.observe([row("yeah-app-1", "running")]);
    now = 60_000;
    expect(tr.observe([row("yeah-app-1", "exited")])).toHaveLength(1);
    now = 120_000;
    expect(tr.observe([row("yeah-app-1", "running")])).toEqual([]);
    now = 180_000;
    expect(tr.observe([row("yeah-app-1", "exited")])).toEqual([]);
    now = 400_000;
    expect(tr.observe([row("yeah-app-1", "running")])).toEqual([{ name: "yeah-app-1", from: "exited", to: "running" }]);
  });

  test("ignored, unmanaged and vanished containers produce nothing", () => {
    const tr = new ContainerStatusTracker(1, 0);
    tr.observe([row("yeah-app-1", "running"), row("other", "running"), row("yeah-app-2", "running")]);
    expect(tr.observe([row("yeah-app-1", "exited"), row("other", "exited")], new Set(["yeah-app-1"]))).toEqual([]);
    expect(tr.observe([row("yeah-app-1", "running")])).toEqual([]);
  });
});

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
