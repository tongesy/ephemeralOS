import { ORB_STATES, type OrbState } from '@ephemeralos/shared';

/** One weight per entry in ORB_STATES; always sums to 1. */
export type StateWeights = Float32Array;

export const STATE_COUNT = ORB_STATES.length;

/** Default cross-fade between states. The brief asks for 300–600 ms. */
export const DEFAULT_TRANSITION_MS = 450;

function oneHot(state: OrbState): StateWeights {
  const w = new Float32Array(STATE_COUNT);
  w[ORB_STATES.indexOf(state)] = 1;
  return w;
}

/** Quintic smootherstep: zero velocity and acceleration at both ends, so nothing snaps. */
export function smootherstep(x: number): number {
  const t = Math.min(Math.max(x, 0), 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/**
 * Cross-fades between orb states. Retargeting mid-transition starts from wherever the
 * blend currently is, so rapid state changes stay continuous.
 */
export class StateBlend {
  readonly weights: StateWeights;
  private from: StateWeights;
  private to: StateWeights;
  private elapsed = 0;
  private current: OrbState;

  constructor(
    initial: OrbState = 'zen',
    private readonly durationMs = DEFAULT_TRANSITION_MS,
  ) {
    this.current = initial;
    this.weights = oneHot(initial);
    this.from = oneHot(initial);
    this.to = oneHot(initial);
    this.elapsed = durationMs;
  }

  get state(): OrbState {
    return this.current;
  }

  get settled(): boolean {
    return this.elapsed >= this.durationMs;
  }

  set(state: OrbState): void {
    if (state === this.current) return;
    this.current = state;
    this.from = Float32Array.from(this.weights);
    this.to = oneHot(state);
    this.elapsed = 0;
  }

  /** Advance by `dtMs` and return the updated weights. */
  update(dtMs: number): StateWeights {
    if (this.settled) return this.weights;
    this.elapsed = Math.min(this.elapsed + dtMs, this.durationMs);
    const k = smootherstep(this.elapsed / this.durationMs);
    for (let i = 0; i < STATE_COUNT; i++) {
      this.weights[i] = this.from[i]! + (this.to[i]! - this.from[i]!) * k;
    }
    return this.weights;
  }
}
