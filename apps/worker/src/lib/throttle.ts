/** Lets an event through at most once per window per key — flapping conditions must not become a flood of alerts. */
export class Throttle {
  private last = new Map<string, number>();

  constructor(private readonly windowMs: number, private readonly now: () => number = Date.now) {}

  allow(key: string): boolean {
    const t = this.now();
    const previous = this.last.get(key);
    if (previous !== undefined && t - previous < this.windowMs) return false;
    this.last.set(key, t);
    return true;
  }
}
