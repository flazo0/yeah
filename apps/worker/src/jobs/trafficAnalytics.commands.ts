// Pure command builder + Prometheus-text parser for Traefik's per-router request counter — kept
// separate so they can be unit tested without loading ssh2 (same split as the other jobs).

/** Reads Traefik's Prometheus metrics from the loopback-only port provisionProxy.ts publishes. */
export function buildFetchTrafficMetricsCommand(): string {
  return "curl -s http://127.0.0.1:8082/metrics || true";
}

const ROUTER_LINE = /^traefik_router_requests_total\{([^}]*)\}\s+([0-9eE.+-]+)\s*$/;
const ROUTER_LABEL = /router="([^"]*)"/;
/** Traefik's docker provider suffixes every router/service name with "@docker" — strip that back off. */
const APP_ROUTER_NAME = /^(yeah-app-[0-9a-f-]{36})(@docker)?$/;

/**
 * Sums `traefik_router_requests_total` across every status-code/method line for each `yeah-app-<id>`
 * router, returning the raw cumulative count per application id — never a delta (see
 * trafficSamples.ts for why). Any line that isn't a well-formed counter for one of our own app
 * routers (another resource's router, a @internal router, a malformed line) is silently skipped.
 */
export function parseTrafficMetrics(metricsText: string): Map<string, number> {
  const totals = new Map<string, number>();
  for (const line of metricsText.split("\n")) {
    const match = ROUTER_LINE.exec(line);
    if (!match) continue;
    const [, labels, rawValue] = match;
    const router = ROUTER_LABEL.exec(labels!)?.[1];
    if (!router) continue;
    const appMatch = APP_ROUTER_NAME.exec(router);
    if (!appMatch) continue;
    const value = Number(rawValue);
    if (!Number.isFinite(value)) continue;
    const applicationId = appMatch[1]!.slice("yeah-app-".length);
    totals.set(applicationId, (totals.get(applicationId) ?? 0) + value);
  }
  return totals;
}
