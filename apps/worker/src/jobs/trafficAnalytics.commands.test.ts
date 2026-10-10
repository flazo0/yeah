import { describe, expect, test } from "bun:test";
import { buildFetchTrafficMetricsCommand, parseTrafficMetrics } from "./trafficAnalytics.commands";

describe("buildFetchTrafficMetricsCommand", () => {
  test("curls the loopback-only metrics port and never fails the SSH exec", () => {
    const command = buildFetchTrafficMetricsCommand();
    expect(command).toBe("curl -s http://127.0.0.1:8082/metrics || true");
  });
});

describe("parseTrafficMetrics", () => {
  const appId = "11111111-1111-1111-1111-111111111111";
  const otherAppId = "22222222-2222-2222-2222-222222222222";

  test("sums every status/method line for the same app router", () => {
    const text = [
      `traefik_router_requests_total{code="200",method="GET",protocol="http",router="yeah-app-${appId}@docker",service="yeah-app-${appId}@docker"} 40`,
      `traefik_router_requests_total{code="404",method="GET",protocol="http",router="yeah-app-${appId}@docker",service="yeah-app-${appId}@docker"} 2`,
    ].join("\n");
    expect(parseTrafficMetrics(text).get(appId)).toBe(42);
  });

  test("keeps separate apps separate", () => {
    const text = [
      `traefik_router_requests_total{code="200",router="yeah-app-${appId}@docker"} 10`,
      `traefik_router_requests_total{code="200",router="yeah-app-${otherAppId}@docker"} 5`,
    ].join("\n");
    const totals = parseTrafficMetrics(text);
    expect(totals.get(appId)).toBe(10);
    expect(totals.get(otherAppId)).toBe(5);
  });

  test("ignores comments, blank lines, unrelated metrics and non-app routers", () => {
    const text = [
      "# HELP traefik_router_requests_total How many HTTP requests processed",
      "# TYPE traefik_router_requests_total counter",
      "",
      `traefik_router_request_duration_seconds_sum{router="yeah-app-${appId}@docker"} 1.5`,
      `traefik_router_requests_total{code="200",router="dashboard@internal"} 999`,
      `traefik_router_requests_total{code="200",router="yeah-svc-${appId}@docker"} 7`,
      `traefik_router_requests_total{code="200",router="yeah-app-${appId}@docker"} 3`,
    ].join("\n");
    const totals = parseTrafficMetrics(text);
    expect(totals.size).toBe(1);
    expect(totals.get(appId)).toBe(3);
  });

  test("returns an empty map for empty or garbage input", () => {
    expect(parseTrafficMetrics("").size).toBe(0);
    expect(parseTrafficMetrics("not prometheus text at all").size).toBe(0);
  });
});
