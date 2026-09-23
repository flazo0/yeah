export type StatusTone = "good" | "warn" | "bad" | "neutral";

const RESOURCE_TONES: Record<string, StatusTone> = {
  running: "good",
  connected: "good",
  active: "good",
  success: "good",
  deploying: "warn",
  provisioning: "warn",
  pending: "warn",
  queued: "warn",
  error: "bad",
  failed: "bad",
  idle: "neutral",
  inactive: "neutral",
};

/** Deploys, backups and platform operations: "running" means in progress, "queued" just waiting. */
const JOB_TONES: Record<string, StatusTone> = {
  queued: "neutral",
  running: "warn",
  success: "good",
  failed: "bad",
};

export type StatusKind = "resource" | "job";

/** One place that decides which color every status string across the app gets. */
export function statusTone(status: string, kind: StatusKind = "resource"): StatusTone {
  return (kind === "job" ? JOB_TONES : RESOURCE_TONES)[status] ?? "neutral";
}
