export type LogDrainKind = "loki" | "axiom" | "new_relic" | "fluent_bit_http";

export interface LogDrainConfig {
  kind: LogDrainKind;
  // loki: push endpoint base URL (e.g. "https://loki.example.com"); fluent_bit_http: the URL of
  // its http input plugin. Unused by axiom/new_relic (they have their own fixed API hosts).
  url: string | null;
  lokiUsername: string | null;
  lokiPassword: string | null;
  axiomDataset: string | null;
  axiomToken: string | null;
  newRelicLicenseKey: string | null;
}

export interface LogLine {
  message: string;
  timestamp: Date;
  /** Attached to every line as labels (Loki) / attributes (Axiom, New Relic) / extra fields (Fluent Bit). */
  labels: Record<string, string>;
}

/**
 * Forwards a batch of log lines from one job (a deploy, a scheduled task run) to a configured drain.
 * Best-effort, like sendNotification — a drain being down or misconfigured must never fail the job
 * that produced the logs. Callers fire-and-forget.
 */
export async function sendLogs(drain: LogDrainConfig, lines: LogLine[]): Promise<boolean> {
  if (lines.length === 0) return true;
  try {
    switch (drain.kind) {
      case "loki":
        return await sendLoki(drain, lines);
      case "axiom":
        return await sendAxiom(drain, lines);
      case "new_relic":
        return await sendNewRelic(drain, lines);
      case "fluent_bit_http":
        return await sendFluentBit(drain, lines);
    }
  } catch (err) {
    console.error(`[logdrains] failed to send via ${drain.kind}:`, err);
    return false;
  }
}

/** Loki wants every line in a stream sharing the exact same label set; lines here always do
 * (one call = one job's lines, same labels throughout), so this is one stream, not a real grouping. */
export function buildLokiPayload(lines: LogLine[]): { streams: Array<{ stream: Record<string, string>; values: [string, string][] }> } {
  const labels = lines[0]!.labels;
  return {
    streams: [
      {
        stream: labels,
        // Loki wants nanosecond-precision unix timestamps as strings.
        values: lines.map((l) => [`${l.timestamp.getTime()}000000`, l.message] as [string, string]),
      },
    ],
  };
}

async function sendLoki(drain: LogDrainConfig, lines: LogLine[]): Promise<boolean> {
  if (!drain.url) return false;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (drain.lokiUsername && drain.lokiPassword) {
    headers.Authorization = `Basic ${Buffer.from(`${drain.lokiUsername}:${drain.lokiPassword}`).toString("base64")}`;
  }
  const res = await fetch(`${drain.url.replace(/\/$/, "")}/loki/api/v1/push`, {
    method: "POST",
    headers,
    body: JSON.stringify(buildLokiPayload(lines)),
  });
  return res.ok;
}

export function buildAxiomPayload(lines: LogLine[]): Array<Record<string, string>> {
  return lines.map((l) => ({ _time: l.timestamp.toISOString(), message: l.message, ...l.labels }));
}

async function sendAxiom(drain: LogDrainConfig, lines: LogLine[]): Promise<boolean> {
  if (!drain.axiomDataset || !drain.axiomToken) return false;
  const res = await fetch(`https://api.axiom.co/v1/datasets/${encodeURIComponent(drain.axiomDataset)}/ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${drain.axiomToken}` },
    body: JSON.stringify(buildAxiomPayload(lines)),
  });
  return res.ok;
}

export function buildNewRelicPayload(lines: LogLine[]): Array<{ common: { attributes: Record<string, string> }; logs: Array<{ timestamp: number; message: string }> }> {
  return [{ common: { attributes: lines[0]!.labels }, logs: lines.map((l) => ({ timestamp: l.timestamp.getTime(), message: l.message })) }];
}

async function sendNewRelic(drain: LogDrainConfig, lines: LogLine[]): Promise<boolean> {
  if (!drain.newRelicLicenseKey) return false;
  const res = await fetch("https://log-api.newrelic.com/log/v1", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Api-Key": drain.newRelicLicenseKey },
    body: JSON.stringify(buildNewRelicPayload(lines)),
  });
  return res.ok;
}

/** For a Fluent Bit `http` input configured with `Format json` — one JSON array of records per request. */
export function buildFluentBitPayload(lines: LogLine[]): Array<Record<string, string>> {
  return lines.map((l) => ({ time: l.timestamp.toISOString(), message: l.message, ...l.labels }));
}

async function sendFluentBit(drain: LogDrainConfig, lines: LogLine[]): Promise<boolean> {
  if (!drain.url) return false;
  const res = await fetch(drain.url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildFluentBitPayload(lines)),
  });
  return res.ok;
}

/** Splits a captured job log (with ANSI color codes and a trailing newline) into individual lines. */
export function splitLogLines(log: string): string[] {
  return log
    .split("\n")
    .map((l) => l.replace(/\x1b\[[0-9;]*m/g, "").trimEnd())
    .filter((l) => l.length > 0);
}
