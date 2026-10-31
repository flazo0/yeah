import { describe, expect, test } from "bun:test";
import { guardStep, INITIAL_GUARD_STATE, isGuardPriority, pickToRestore, pickToShed, RESTORE_AFTER_SAMPLES, SHED_AFTER_SAMPLES, validateMemoryGuardLimits, type GuardCandidate, type GuardState, type MemoryGuardSettings } from "./memoryGuard";

const c = (name: string, over: Partial<GuardCandidate> = {}): GuardCandidate => ({ kind: "application", id: name, name, priority: "normal", memBytes: 100, shedByGuard: false, status: "running", ...over });
const settings: MemoryGuardSettings = { enabled: true, threshold: 90, recover: 75 };

describe("validateMemoryGuardLimits", () => {
  test("accepts sensible limits", () => {
    expect(validateMemoryGuardLimits(92, 80)).toBeNull();
    expect(validateMemoryGuardLimits(70, 65)).toBeNull();
  });
  test("rejects out-of-range and too-close values", () => {
    expect(validateMemoryGuardLimits(100, 80)).not.toBeNull();
    expect(validateMemoryGuardLimits(60, 40)).not.toBeNull();
    expect(validateMemoryGuardLimits(90, 88)).not.toBeNull();
    expect(validateMemoryGuardLimits(90.5, 70)).not.toBeNull();
    expect(validateMemoryGuardLimits(90, 30)).not.toBeNull();
  });
});

describe("isGuardPriority", () => {
  test("only the three known values", () => {
    expect(isGuardPriority("low")).toBe(true);
    expect(isGuardPriority("critical")).toBe(true);
    expect(isGuardPriority("high")).toBe(false);
    expect(isGuardPriority(undefined)).toBe(false);
  });
});

describe("pickToShed", () => {
  test("never picks a critical resource, even when it is the only one", () => {
    expect(pickToShed([c("db-ui", { priority: "critical" })])).toBeNull();
  });
  test("low before normal, whatever their memory", () => {
    expect(pickToShed([c("big-normal", { memBytes: 9000 }), c("small-low", { priority: "low", memBytes: 10 })])?.name).toBe("small-low");
  });
  test("within a tier the biggest memory user goes first; unknown memory goes last", () => {
    expect(pickToShed([c("a", { memBytes: 100 }), c("b", { memBytes: 500 }), c("c", { memBytes: null })])?.name).toBe("b");
  });
  test("skips resources that are not running or already stopped by the guard", () => {
    expect(pickToShed([c("x", { status: "stopped" }), c("y", { status: "other" }), c("z", { shedByGuard: true })])).toBeNull();
  });
  test("ties break by name so the choice is stable", () => {
    expect(pickToShed([c("b", { memBytes: 1 }), c("a", { memBytes: 1 })])?.name).toBe("a");
  });
});

describe("pickToRestore", () => {
  test("only what the guard stopped, most important first", () => {
    const list = [c("low-one", { priority: "low", shedByGuard: true, status: "stopped" }), c("normal-one", { shedByGuard: true, status: "stopped" }), c("manual", { status: "stopped" })];
    expect(pickToRestore(list)?.name).toBe("normal-one");
  });
  test("a resource somebody started by hand is no longer the guard's to restore", () => {
    expect(pickToRestore([c("x", { shedByGuard: true, status: "running" })])).toBeNull();
  });
});

describe("guardStep", () => {
  const list = [c("keep", { priority: "critical" }), c("victim", { priority: "low", memBytes: 500 })];

  test("does nothing when disabled and resets the counters", () => {
    const r = guardStep({ high: 5, low: 5 }, 99, { ...settings, enabled: false }, list);
    expect(r.action.type).toBe("none");
    expect(r.state).toEqual(INITIAL_GUARD_STATE);
  });

  test("a single high sample is not enough", () => {
    const r = guardStep(INITIAL_GUARD_STATE, 95, settings, list);
    expect(r.action.type).toBe("none");
    expect(r.state.high).toBe(1);
  });

  test(`stops one resource after ${SHED_AFTER_SAMPLES} samples in a row, then starts counting again`, () => {
    let state: GuardState = INITIAL_GUARD_STATE;
    let action = guardStep(state, 95, settings, list);
    state = action.state;
    action = guardStep(state, 96, settings, list);
    expect(action.action).toEqual({ type: "stop", target: list[1]! });
    expect(action.state).toEqual(INITIAL_GUARD_STATE);
  });

  test("a dip between the limits breaks the streak", () => {
    let r = guardStep(INITIAL_GUARD_STATE, 95, settings, list);
    r = guardStep(r.state, 85, settings, list);
    expect(r.state).toEqual(INITIAL_GUARD_STATE);
    r = guardStep(r.state, 95, settings, list);
    expect(r.action.type).toBe("none");
  });

  test("keeps counting when everything left is critical (nothing to stop)", () => {
    const only = [c("keep", { priority: "critical" })];
    let r = guardStep(INITIAL_GUARD_STATE, 95, settings, only);
    r = guardStep(r.state, 95, settings, only);
    expect(r.action.type).toBe("none");
    expect(r.state.high).toBe(2);
  });

  test(`starts one stopped resource after ${RESTORE_AFTER_SAMPLES} calm samples`, () => {
    const stopped = [c("victim", { priority: "low", shedByGuard: true, status: "stopped" })];
    let r = guardStep(INITIAL_GUARD_STATE, 60, settings, stopped);
    r = guardStep(r.state, 60, settings, stopped);
    expect(r.action.type).toBe("none");
    r = guardStep(r.state, 60, settings, stopped);
    expect(r.action.type).toBe("start");
  });

  test("does not restore while memory sits between the limits", () => {
    const stopped = [c("victim", { shedByGuard: true, status: "stopped" })];
    let state: GuardState = INITIAL_GUARD_STATE;
    for (let i = 0; i < 10; i++) {
      const r = guardStep(state, 82, settings, stopped);
      expect(r.action.type).toBe("none");
      state = r.state;
    }
  });
});
