import { ORB_STATES, type OrbState } from '@ephemeralos/shared';
import { Color } from 'three';
import { palette } from '../theme/palette.ts';
import type { StateWeights } from './state-blend.ts';

/**
 * How the orb looks in one state. Every visual knob lives here, so tuning the orb
 * means editing this table, not the shader.
 */
export interface OrbLook {
  /** Light at the heart of the orb. */
  core: string;
  /** Colour of the medium the light sits in. */
  deep: string;
  /** Glass rim and halo. */
  rim: string;
  /** Overall light output; above ~1 starts to bloom. */
  intensity: number;
  /** Internal swirl speed (radians per second at the centre). */
  swirl: number;
  /** Speed of the internal drift. */
  flow: number;
  /** How strongly the surface ripples with the microphone. */
  ripple: number;
  /** Breathing amplitude as a fraction of the radius. */
  breath: number;
  /** How strongly the orb pulses with the voice output. */
  pulse: number;
}

export const LOOKS: Record<OrbState, OrbLook> = {
  zen: {
    core: palette.linen,
    deep: '#16232B',
    rim: palette.fjord,
    intensity: 0.55,
    swirl: 0.04,
    flow: 0.05,
    ripple: 0,
    breath: 0.018,
    pulse: 0,
  },
  listening: {
    core: '#FFFFFF',
    deep: '#1E3D4A',
    rim: palette.frost,
    intensity: 0.7,
    swirl: 0.12,
    flow: 0.18,
    ripple: 1,
    breath: 0.006,
    pulse: 0,
  },
  thinking: {
    core: '#EEE9F7',
    deep: '#231F38',
    rim: palette.heather,
    intensity: 0.68,
    swirl: 0.9,
    flow: 0.35,
    ripple: 0.08,
    breath: 0.008,
    pulse: 0,
  },
  speaking: {
    core: '#FFF7EC',
    deep: '#3A2E24',
    rim: palette.sand,
    intensity: 0.6,
    swirl: 0.2,
    flow: 0.22,
    ripple: 0.15,
    breath: 0.004,
    pulse: 1,
  },
  error: {
    core: palette.clay,
    deep: '#24180F',
    rim: '#8C6E59',
    intensity: 0.38,
    swirl: 0.02,
    flow: 0.04,
    ripple: 0,
    breath: 0.012,
    pulse: 0,
  },
};

/** A look resolved to linear-space colours, ready to upload as uniforms. */
export interface BlendedLook {
  core: Color;
  deep: Color;
  rim: Color;
  intensity: number;
  swirl: number;
  flow: number;
  ripple: number;
  breath: number;
  pulse: number;
}

const NUMERIC = ['intensity', 'swirl', 'flow', 'ripple', 'breath', 'pulse'] as const;
const COLORS = ['core', 'deep', 'rim'] as const;

const resolved = ORB_STATES.map((s) => ({
  ...LOOKS[s],
  core: new Color(LOOKS[s].core),
  deep: new Color(LOOKS[s].deep),
  rim: new Color(LOOKS[s].rim),
}));

export function createBlendedLook(): BlendedLook {
  return { ...LOOKS.zen, core: new Color(), deep: new Color(), rim: new Color() };
}

/** Weighted average of every state's look, written into `out` (no allocation per frame). */
export function blendLook(weights: StateWeights, out: BlendedLook): BlendedLook {
  for (const key of NUMERIC) out[key] = 0;
  for (const key of COLORS) out[key].setRGB(0, 0, 0);
  resolved.forEach((look, i) => {
    const w = weights[i] ?? 0;
    if (w === 0) return;
    for (const key of NUMERIC) out[key] += look[key] * w;
    for (const key of COLORS) {
      out[key].r += look[key].r * w;
      out[key].g += look[key].g * w;
      out[key].b += look[key].b * w;
    }
  });
  return out;
}
