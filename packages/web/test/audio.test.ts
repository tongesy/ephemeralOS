import { describe, expect, it } from 'vitest';
import { Envelope, rms, rmsToLevel, toBands } from '../src/audio/envelope.ts';

describe('audio features', () => {
  it('maps silence to 0 and loud speech to 1', () => {
    expect(rmsToLevel(0)).toBe(0);
    expect(rmsToLevel(1e-4)).toBe(0);
    expect(rmsToLevel(0.5)).toBe(1);
    expect(rmsToLevel(0.01)).toBeGreaterThan(0.3);
  });

  it('computes RMS', () => {
    expect(rms(new Float32Array([1, -1, 1, -1]))).toBe(1);
    expect(rms(new Float32Array(0))).toBe(0);
  });

  it('rises faster than it falls', () => {
    const env = new Envelope(40, 260);
    const up = env.update(1, 40);
    const env2 = new Envelope(40, 260);
    env2.value = 1;
    const down = 1 - env2.update(0, 40);
    expect(up).toBeGreaterThan(down);
  });

  it('splits a spectrum into four bands', () => {
    const bins = new Uint8Array(512).fill(255);
    const bands = toBands(bins, 48000 / 1024, new Float32Array(4));
    expect(Array.from(bands)).toEqual([1, 1, 1, 1]);
  });
});
