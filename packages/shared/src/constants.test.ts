import { describe, expect, test } from "bun:test";
import { buildProxyIsRunningCommand, buildProxyLogsCommand, buildProxyRestartCommand, PROXY_CONTAINER_NAME } from "./constants";

describe("proxy container commands", () => {
  test("restart targets the proxy's own container", () => {
    expect(buildProxyRestartCommand()).toBe(`docker restart '${PROXY_CONTAINER_NAME}'`);
  });
  test("logs: tail is clamped to at least 1 and both streams are merged", () => {
    expect(buildProxyLogsCommand(300)).toBe(`docker logs --tail 300 '${PROXY_CONTAINER_NAME}' 2>&1`);
    expect(buildProxyLogsCommand(0)).toContain("--tail 1 ");
    expect(buildProxyLogsCommand(-5)).toContain("--tail 1 ");
  });
  test("is-running never fails the shell even when the container doesn't exist", () => {
    expect(buildProxyIsRunningCommand()).toContain("|| true");
  });
});
