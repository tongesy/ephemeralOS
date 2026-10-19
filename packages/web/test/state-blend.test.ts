import { describe, expect, it } from 'vitest';
import { StateBlend, smootherstep } from '../src/orb/state-blend.ts';

const sum = (w: Float32Array): number => w.reduce((s, x) => s + x, 0);

describe('smootherstep', () => {
  it('clamps and hits both ends exactly', () => {
    expect(smootherstep(-1)).toBe(0);
    expect(smootherstep(0)).toBe(0);
    expect(smootherstep(0.5)).toBeCloseTo(0.5);
    expect(smootherstep(1)).toBe(1);
    expect(smootherstep(2)).toBe(1);
  });
});

describe('StateBlend', () => {
  it('starts settled on the initial state', () => {
    const blend = new StateBlend('zen');
    expect(Array.from(blend.weights)).toEqual([1, 0, 0, 0, 0]);
    expect(blend.settled).toBe(true);
  });

  it('cross-fades over the transition duration without snapping', () => {
    const blend = new StateBlend('zen', 400);
    blend.set('listening');
    blend.update(100);
    expect(blend.weights[0]).toBeGreaterThan(0.5);
    expect(blend.weights[1]).toBeGreaterThan(0);
    expect(sum(blend.weights)).toBeCloseTo(1);
    blend.update(300);
    expect(blend.weights[1]).toBe(1);
    expect(blend.settled).toBe(true);
  });

  it('retargets mid-transition from the current blend', () => {
    const blend = new StateBlend('zen', 400);
    blend.set('listening');
    blend.update(200);
    const before = Float32Array.from(blend.weights);
    blend.set('speaking');
    blend.update(0.001);
    for (let i = 0; i < before.length; i++) expect(blend.weights[i]).toBeCloseTo(before[i]!, 3);
    blend.update(400);
    expect(Array.from(blend.weights)).toEqual([0, 0, 0, 1, 0]);
  });

  it('ignores setting the current state', () => {
    const blend = new StateBlend('thinking');
    blend.set('thinking');
    expect(blend.settled).toBe(true);
  });
});
