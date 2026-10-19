import type { Scene } from '@ephemeralos/shared';
import { Color } from 'three';
import { skyPalette as sky } from '../theme/palette.ts';

/**
 * How the page looks as a given weather. Like the orb's look table, every visual knob is
 * here and the shader only reads the blended values, so tuning a sky means editing
 * numbers, not GLSL.
 */
export interface SceneLook {
  skyTop: Color;
  skyHorizon: Color;
  /** The sun or moon: its colour and how strongly it glows through. */
  light: Color;
  glow: number;
  /** Stars, on a clear night. */
  stars: number;
  /** How much of the sky is cloud, and the clouds' lit and shaded colours. */
  cover: number;
  cloud: Color;
  cloudShade: Color;
  /** Milky haze rising from the horizon. */
  haze: number;
  hazeColor: Color;
  /** Falling rain and snow, 0 to 1. */
  rain: number;
  snow: number;
  /** Raindrops on the glass in front of it all. */
  drops: number;
  /** Lightning: how often the sky flashes. */
  storm: number;
  wind: number;
}

const NUMERIC = [
  'glow',
  'stars',
  'cover',
  'haze',
  'rain',
  'snow',
  'drops',
  'storm',
  'wind',
] as const;
const COLORS = ['skyTop', 'skyHorizon', 'light', 'cloud', 'cloudShade', 'hazeColor'] as const;

const c = (hex: string) => new Color(hex);

export function createSceneLook(): SceneLook {
  return {
    skyTop: c(sky.dayTop),
    skyHorizon: c(sky.dayHorizon),
    light: c(sky.sun),
    glow: 0,
    stars: 0,
    cover: 0,
    cloud: c(sky.cloud),
    cloudShade: c(sky.cloudShade),
    haze: 0,
    hazeColor: c(sky.fog),
    rain: 0,
    snow: 0,
    drops: 0,
    storm: 0,
    wind: 0,
  };
}

/** The look for a scene: its sky, by day or night, scaled by how heavy the weather is. */
export function sceneLook(scene: Scene, out: SceneLook = createSceneLook()): SceneLook {
  const { day, intensity: k } = scene;
  // How grey the sky is, from a clear blue (0) to a storm (1).
  const grey = {
    clear: 0,
    'partly-cloudy': 0.15 * k,
    cloudy: 0.45 + 0.25 * k,
    fog: 0.5,
    rain: 0.55 + 0.35 * k,
    snow: 0.5 + 0.2 * k,
    thunder: 0.9 + 0.1 * k,
  }[scene.sky];
  const stormy = Math.max(grey - 0.6, 0) / 0.4;

  const top = day
    ? [sky.dayTop, sky.overcastTop, sky.stormTop]
    : [sky.nightTop, sky.nightOvercastTop, sky.nightOvercastTop];
  const horizon = day
    ? [sky.dayHorizon, sky.overcastHorizon, sky.stormHorizon]
    : [sky.nightHorizon, sky.nightOvercastHorizon, sky.nightOvercastHorizon];
  const between = (stops: readonly string[], target: Color) => {
    const t = Math.min(grey / 0.6, 1);
    target.set(stops[0]!).lerp(c(stops[1]!), t).lerp(c(stops[2]!), stormy);
  };
  between(top, out.skyTop);
  between(horizon, out.skyHorizon);

  out.light.set(day ? sky.sun : sky.moon);
  out.glow = Math.max(1 - grey * 1.6, 0) * (day ? 1 : 0.55);
  out.stars = day ? 0 : Math.max(1 - grey * 2.5, 0);
  out.cover = {
    clear: 0.04,
    'partly-cloudy': 0.25 + 0.35 * k,
    cloudy: 0.7 + 0.25 * k,
    fog: 0.5,
    rain: 0.8 + 0.2 * k,
    snow: 0.75 + 0.2 * k,
    thunder: 1,
  }[scene.sky];
  out.cloud
    .set(day ? sky.cloud : sky.nightCloud)
    .lerp(c(day ? sky.cloudShade : sky.nightCloudShade), stormy * 0.6);
  out.cloudShade
    .set(day ? sky.cloudShade : sky.nightCloudShade)
    .lerp(c(sky.stormTop), stormy * 0.5);
  out.haze =
    scene.sky === 'fog'
      ? 0.55 + 0.45 * k
      : scene.sky === 'rain' || scene.sky === 'snow'
        ? 0.25 * k
        : 0;
  out.hazeColor.set(day ? sky.fog : sky.nightFog);
  out.rain = scene.sky === 'rain' || scene.sky === 'thunder' ? 0.25 + 0.75 * k : 0;
  out.snow = scene.sky === 'snow' ? 0.3 + 0.7 * k : 0;
  out.drops = scene.sky === 'rain' || scene.sky === 'thunder' ? 0.35 + 0.65 * k : 0;
  out.storm = scene.sky === 'thunder' ? 0.5 + 0.5 * k : 0;
  out.wind = scene.wind;
  return out;
}

/** Move `current` a step towards `target`; `amount` is the share of the gap closed. */
export function approachLook(current: SceneLook, target: SceneLook, amount: number): void {
  for (const key of NUMERIC) current[key] += (target[key] - current[key]) * amount;
  for (const key of COLORS) current[key].lerp(target[key], amount);
}
