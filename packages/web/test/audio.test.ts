import { describe, expect, it } from 'vitest';
import {
  Envelope,
  SPECTRUM_SIZE,
  SpectrumEnvelope,
  rms,
  rmsToLevel,
  toBands,
  toLogSpectrum,
} from '../src/audio/envelope.ts';

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

describe('toLogSpectrum', () => {
  it('spreads a flat spectrum evenly and stays in range', () => {
    const bins = new Uint8Array(512).fill(128);
    const out = toLogSpectrum(bins, 48000 / 1024, new Float32Array(SPECTRUM_SIZE));
    for (const v of out) expect(v).toBeCloseTo(128 / 255);
  });

  it('puts low frequencies in the first bins', () => {
    const binHz = 48000 / 1024;
    const bins = new Uint8Array(512);
    bins[Math.round(100 / binHz)] = 255;
    const out = toLogSpectrum(bins, binHz, new Float32Array(SPECTRUM_SIZE));
    const peak = out.indexOf(Math.max(...out));
    expect(peak).toBeLessThan(SPECTRUM_SIZE / 4);
  });
});

describe('SpectrumEnvelope', () => {
  it('follows each bin independently', () => {
    const env = new SpectrumEnvelope(4);
    env.update(new Float32Array([1, 0, 1, 0]), 200);
    expect(env.values[0]).toBeGreaterThan(0.9);
    expect(env.values[1]).toBe(0);
  });
});
