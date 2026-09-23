/**
 * Per-key circuit breaker for the periodic jobs that poll servers over SSH. After `threshold`
 * consecutive failures the circuit opens and attempts are skipped for a cooldown that doubles on
 * each further failure (capped), so a dead server isn't hammered — and its errors don't flood the
 * log — every tick forever. Once the cooldown passes, one probe attempt is let through: success
 * closes the circuit, failure re-opens it with the longer cooldown.
 */

export interface BreakerOptions {
  threshold: number;
  baseCooldownMs: number;
  maxCooldownMs: number;
}

interface State {
  failures: number;
  openUntil: number;
}

export type BreakerTransition = "opened" | "closed" | null;

export class CircuitBreaker {
  private states = new Map<string, State>();

  constructor(private readonly options: BreakerOptions) {}

  shouldAttempt(key: string, now = Date.now()): boolean {
    const state = this.states.get(key);
    return !state || state.openUntil <= now;
  }

  recordSuccess(key: string): BreakerTransition {
    const state = this.states.get(key);
    this.states.delete(key);
    return state && state.failures >= this.options.threshold ? "closed" : null;
  }

  /** Returns "opened" on the failure that trips the circuit (first time only), null otherwise. */
  recordFailure(key: string, now = Date.now()): BreakerTransition {
    const state = this.states.get(key) ?? { failures: 0, openUntil: 0 };
    const wasOpen = state.failures >= this.options.threshold;
    state.failures++;
    if (state.failures >= this.options.threshold) {
      const doublings = state.failures - this.options.threshold;
      state.openUntil = now + Math.min(this.options.baseCooldownMs * 2 ** doublings, this.options.maxCooldownMs);
    }
    this.states.set(key, state);
    return !wasOpen && state.failures >= this.options.threshold ? "opened" : null;
  }

  /** Forget a key entirely (e.g. server deleted or explicitly re-tested by the user). */
  reset(key: string): void {
    this.states.delete(key);
  }
}
