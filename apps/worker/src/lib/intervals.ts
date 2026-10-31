/** Seconds from an env var as milliseconds, clamped to [min, max]; unset/invalid falls back to `defaultSeconds`. */
export function intervalMsFromEnv(value: string | undefined, defaultSeconds: number, minSeconds: number, maxSeconds = 86_400): number {
  const n = Number(value);
  const seconds = value && Number.isFinite(n) && n > 0 ? n : defaultSeconds;
  return Math.round(Math.min(maxSeconds, Math.max(minSeconds, seconds)) * 1000);
}
