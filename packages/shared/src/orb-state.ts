/**
 * Session lifecycle states, shared by the voice pipeline and the orb.
 * The order is load-bearing: it is the index into the orb's `uState` weights.
 */
export const ORB_STATES = ['zen', 'listening', 'thinking', 'speaking', 'error'] as const;

export type OrbState = (typeof ORB_STATES)[number];

export function isOrbState(value: unknown): value is OrbState {
  return typeof value === 'string' && (ORB_STATES as readonly string[]).includes(value);
}
