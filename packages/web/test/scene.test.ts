import { describe, expect, it } from 'vitest';
import type { Scene } from '@ephemeralos/shared';
import { approachLook, createSceneLook, sceneLook } from '../src/scene/scene-look.ts';

const scene = (over: Partial<Scene>): Scene => ({
  kind: 'weather',
  sky: 'clear',
  intensity: 0.5,
  day: true,
  wind: 0,
  ...over,
});

describe('scene look', () => {
  it('rains and beads the glass only when it is raining', () => {
    const wet = sceneLook(scene({ sky: 'rain', intensity: 1 }));
    expect(wet.rain).toBe(1);
    expect(wet.drops).toBe(1);
    expect(wet.snow).toBe(0);
    const dry = sceneLook(scene({ sky: 'partly-cloudy' }));
    expect(dry.rain + dry.drops + dry.snow).toBe(0);
  });

  it('shows stars and a moon on a clear night, and hides the sun behind storms', () => {
    const night = sceneLook(scene({ day: false }));
    expect(night.stars).toBeGreaterThan(0.9);
    expect(night.skyTop.getHSL({ h: 0, s: 0, l: 0 }).l).toBeLessThan(0.1);
    const storm = sceneLook(scene({ sky: 'thunder', intensity: 1 }));
    expect(storm.glow).toBe(0);
    expect(storm.storm).toBe(1);
  });

  it('eases from one weather to the next', () => {
    const current = sceneLook(scene({}));
    const goal = sceneLook(scene({ sky: 'snow', intensity: 1 }), createSceneLook());
    approachLook(current, goal, 0.5);
    expect(current.snow).toBeCloseTo(0.5);
    approachLook(current, goal, 1);
    expect(current.snow).toBe(1);
    expect(current.skyTop.equals(goal.skyTop)).toBe(true);
  });
});
