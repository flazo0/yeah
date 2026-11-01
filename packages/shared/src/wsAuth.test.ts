import { describe, expect, test } from "bun:test";
import { canReceive, isOriginAllowed, parseCookieHeader, routeEvent, sessionIdFromCookieHeader } from "./wsAuth";

describe("cookies", () => {
  test("parses pairs, quotes and encoding", () => {
    expect(parseCookieHeader('a=1; b="two"; c=x%20y; bad; =z')).toEqual({ a: "1", b: "two", c: "x y" });
    expect(parseCookieHeader(null)).toEqual({});
  });
  test("first duplicate wins; bad encoding kept raw", () => {
    expect(parseCookieHeader("a=1; a=2; b=%E0%A4%A")).toEqual({ a: "1", b: "%E0%A4%A" });
  });
  test("extracts the session id", () => {
    expect(sessionIdFromCookieHeader("x=1; yeah_session=abc123")).toBe("abc123");
    expect(sessionIdFromCookieHeader("x=1")).toBeNull();
    expect(sessionIdFromCookieHeader("yeah_session=")).toBeNull();
  });
});

describe("isOriginAllowed", () => {
  test("allows when unconfigured or without Origin", () => {
    expect(isOriginAllowed("https://evil.test", undefined)).toBe(true);
    expect(isOriginAllowed(null, "https://panel.test")).toBe(true);
  });
  test("matches the configured list, ignoring trailing slashes", () => {
    const allowed = "https://panel.test/, http://localhost:8080";
    expect(isOriginAllowed("https://panel.test", allowed)).toBe(true);
    expect(isOriginAllowed("http://localhost:8080", allowed)).toBe(true);
    expect(isOriginAllowed("https://evil.test", allowed)).toBe(false);
  });
  test("is case-insensitive, so a capitalised WEB_ORIGIN does not lock everyone out", () => {
    expect(isOriginAllowed("https://panel.test", "https://Panel.Test")).toBe(true);
    expect(isOriginAllowed("https://evil.test", "https://Panel.Test")).toBe(false);
  });
});

describe("routeEvent", () => {
  test("routes by owning resource", () => {
    expect(routeEvent({ type: "server.status", serverId: "s1", status: "ready" } as never)).toEqual({ scope: "resource", kind: "server", id: "s1" });
    expect(routeEvent({ type: "deployment.log", deploymentId: "d1", line: "x" })).toEqual({ scope: "resource", kind: "deployment", id: "d1" });
    expect(routeEvent({ type: "backup.status", executionId: "e", scheduleId: "b1", status: "success" } as never)).toEqual({ scope: "resource", kind: "backup-schedule", id: "b1" });
    expect(routeEvent({ type: "application.status", applicationId: "a1", status: "running" } as never)).toEqual({ scope: "resource", kind: "application", id: "a1" });
  });
  test("an explicit teamId wins", () => {
    expect(routeEvent({ type: "deployment.log", deploymentId: "d1", line: "x", teamId: "t1" } as never)).toEqual({ scope: "team", teamId: "t1" });
  });
  test("platform operations go to everyone; unknown or id-less events are dropped", () => {
    expect(routeEvent({ type: "platform-operation.log", operationId: "o", line: "x" })).toEqual({ scope: "all" });
    expect(routeEvent({ type: "nope" } as never)).toBeNull();
    expect(routeEvent({ type: "server.status", serverId: "" } as never)).toBeNull();
  });
});

describe("canReceive", () => {
  const teams = new Set(["t1"]);
  test("team and resource scopes check membership", () => {
    expect(canReceive({ scope: "team", teamId: "t1" }, null, teams)).toBe(true);
    expect(canReceive({ scope: "team", teamId: "t2" }, null, teams)).toBe(false);
    expect(canReceive({ scope: "resource", kind: "server", id: "s" }, "t1", teams)).toBe(true);
    expect(canReceive({ scope: "resource", kind: "server", id: "s" }, "t2", teams)).toBe(false);
    expect(canReceive({ scope: "resource", kind: "server", id: "s" }, null, teams)).toBe(false);
  });
  test("global scope reaches any member", () => {
    expect(canReceive({ scope: "all" }, null, new Set())).toBe(true);
  });
});
