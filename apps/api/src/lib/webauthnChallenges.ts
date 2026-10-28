// One-shot WebAuthn challenges, kept in memory for a few minutes. A challenge is created by the "options"
// call and consumed (once) by the matching "verify" call, so a captured response can never be replayed.
// The API runs as a single process; if it ever scales out, move this to Redis.

const TTL_MS = 5 * 60 * 1000;

export class ChallengeStore {
  private map = new Map<string, { challenge: string; expires: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  put(key: string, challenge: string): void {
    this.sweep();
    this.map.set(key, { challenge, expires: this.now() + TTL_MS });
  }

  /** Returns the challenge once; unknown, expired or already-used keys give null. */
  take(key: string): string | null {
    const entry = this.map.get(key);
    this.map.delete(key);
    if (!entry || entry.expires < this.now()) return null;
    return entry.challenge;
  }

  private sweep(): void {
    const t = this.now();
    for (const [k, v] of this.map) if (v.expires < t) this.map.delete(k);
  }
}

export const challenges = new ChallengeStore();

/** The relying-party id for a request: the hostname of an Origin the panel is configured to serve, else null. */
export function relyingParty(origin: string | null, allowedOrigins: string[]): { rpID: string; origin: string } | null {
  if (!origin || !allowedOrigins.includes(origin)) return null;
  try {
    return { rpID: new URL(origin).hostname, origin };
  } catch {
    return null;
  }
}
