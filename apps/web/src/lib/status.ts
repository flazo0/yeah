export type StatusTone = "good" | "warn" | "bad" | "neutral";

const TONES: Record<string, StatusTone> = {
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

/** One place that decides which color every status string across the app gets. */
export function statusTone(status: string): StatusTone {
  return TONES[status] ?? "neutral";
}
