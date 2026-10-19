import { ORB_STATES, type OrbState } from '@ephemeralos/shared';
import { Color } from 'three';
import { palette } from '../theme/palette.ts';
import type { StateWeights } from './state-blend.ts';

/**
 * How the orb looks in one state. Every visual knob lives here, so tuning the orb
 * means editing this table, not the shader.
 */
export interface OrbLook {
  /** The three colours the plasma is mixed from: two that flow, one that accents. */
  colors: readonly [string, string, string];
  /** How brightly the plasma glows; lifts the hot filaments towards white. */
  intensity: number;
  /** How much the plasma folds over itself (domain-warp strength). */
  warp: number;
  /** Swirl speed (radians per second at the centre). */
  swirl: number;
  /** Speed of the plasma's drift. */
  flow: number;
  /** How strongly the edge ripples with the microphone. */
  ripple: number;
  /** Breathing amplitude as a fraction of the radius. */
  breath: number;
  /** How strongly the orb pulses with the voice output. */
  pulse: number;
  /** Strength of the coloured light the orb casts onto the page. */
  aura: number;
}

export const LOOKS: Record<OrbState, OrbLook> = {
  zen: {
    colors: [palette.fjord, palette.glacier, palette.lilac],
    intensity: 0.45,
    warp: 0.7,
    swirl: 0.05,
    flow: 0.07,
    ripple: 0,
    breath: 0.02,
    pulse: 0,
    aura: 0.4,
  },
  listening: {
    colors: [palette.azure, palette.glacier, palette.moss],
    intensity: 0.85,
    warp: 0.95,
    swirl: 0.12,
    flow: 0.22,
    ripple: 1,
    breath: 0.006,
    pulse: 0,
    aura: 0.65,
  },
  thinking: {
    colors: [palette.heather, palette.lilac, palette.fjord],
    intensity: 0.65,
    warp: 1.25,
    swirl: 0.75,
    flow: 0.3,
    ripple: 0.08,
    breath: 0.008,
    pulse: 0,
    aura: 0.5,
  },
  speaking: {
    colors: [palette.coral, palette.sand, palette.rose],
    intensity: 0.8,
    warp: 0.95,
    swirl: 0.18,
    flow: 0.26,
    ripple: 0.15,
    breath: 0.004,
    pulse: 1,
    aura: 0.65,
  },
  error: {
    colors: [palette.clay, '#D8CEC4', '#A79E96'],
    intensity: 0.2,
    warp: 0.4,
    swirl: 0.02,
    flow: 0.03,
    ripple: 0,
    breath: 0.012,
    pulse: 0,
    aura: 0.2,
  },
};

/** A look resolved to linear-space colours, ready to upload as uniforms. */
export interface BlendedLook {
  colors: [Color, Color, Color];
  intensity: number;
  warp: number;
  swirl: number;
  flow: number;
  ripple: number;
  breath: number;
  pulse: number;
  aura: number;
}

const NUMERIC = [
  'intensity',
  'warp',
  'swirl',
  'flow',
  'ripple',
  'breath',
  'pulse',
  'aura',
] as const;

const resolved = ORB_STATES.map((s) => ({
  ...LOOKS[s],
  colors: LOOKS[s].colors.map((hex) => new Color(hex)),
}));

export function createBlendedLook(): BlendedLook {
  return { ...LOOKS.zen, colors: [new Color(), new Color(), new Color()] };
}

/** Weighted average of every state's look, written into `out` (no allocation per frame). */
export function blendLook(weights: StateWeights, out: BlendedLook): BlendedLook {
  for (const key of NUMERIC) out[key] = 0;
  for (const color of out.colors) color.setRGB(0, 0, 0);
  resolved.forEach((look, i) => {
    const w = weights[i] ?? 0;
    if (w === 0) return;
    for (const key of NUMERIC) out[key] += look[key] * w;
    look.colors.forEach((c, j) => {
      const target = out.colors[j]!;
      target.r += c.r * w;
      target.g += c.g * w;
      target.b += c.b * w;
    });
  });
  return out;
}
