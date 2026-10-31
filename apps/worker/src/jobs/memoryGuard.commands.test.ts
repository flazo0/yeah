import { describe, expect, test } from "bun:test";
import { buildGuardCandidates, staleShedFlags, type GuardAppRow, type GuardServiceRow } from "./memoryGuard.commands";

const app = (id: string, over: Partial<GuardAppRow> = {}): GuardAppRow => ({ id, name: `app-${id}`, priority: "normal", shedByGuard: false, status: "running", isCompose: false, ...over });
const svc = (id: string, over: Partial<GuardServiceRow> = {}): GuardServiceRow => ({ id, name: `svc-${id}`, priority: "normal", shedByGuard: false, status: "running", isStack: false, ...over });

describe("buildGuardCandidates", () => {
  test("a running single-container app is a candidate with its memory", () => {
    const [c] = buildGuardCandidates([app("a1")], [], [{ name: "yeah-app-a1", memUsedBytes: 123 }]);
    expect(c).toMatchObject({ kind: "application", id: "a1", status: "running", memBytes: 123 });
  });

  test("an app the database calls running but whose container is gone (asleep) is not a candidate", () => {
    const [c] = buildGuardCandidates([app("a1")], [], []);
    expect(c!.status).toBe("other");
  });

  test("compose apps and stacks are judged by status alone, with unknown memory", () => {
    const list = buildGuardCandidates([app("c1", { isCompose: true })], [svc("s1", { isStack: true })], []);
    expect(list.map((c) => [c.id, c.status, c.memBytes])).toEqual([["c1", "running", null], ["s1", "running", null]]);
  });

  test("services map to their own container name", () => {
    const [c] = buildGuardCandidates([], [svc("s9")], [{ name: "yeah-svc-s9", memUsedBytes: 5 }]);
    expect(c).toMatchObject({ kind: "service", status: "running", memBytes: 5 });
  });

  test("deploying and errored resources are never running candidates", () => {
    const list = buildGuardCandidates([app("a", { status: "deploying" }), app("b", { status: "error" })], [], [{ name: "yeah-app-a", memUsedBytes: 1 }, { name: "yeah-app-b", memUsedBytes: 1 }]);
    expect(list.every((c) => c.status === "other")).toBe(true);
  });

  test("stopped stays stopped", () => {
    expect(buildGuardCandidates([app("a", { status: "stopped" })], [], [])[0]!.status).toBe("stopped");
  });
});

describe("staleShedFlags", () => {
  test("flags on resources that are no longer stopped are stale", () => {
    const list = buildGuardCandidates([app("a", { shedByGuard: true, status: "running" }), app("b", { shedByGuard: true, status: "stopped" }), app("c", { status: "running" })], [], [{ name: "yeah-app-a", memUsedBytes: 1 }]);
    expect(staleShedFlags(list).map((c) => c.id)).toEqual(["a"]);
  });
});
