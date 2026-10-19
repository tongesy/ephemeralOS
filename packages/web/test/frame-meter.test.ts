import { describe, expect, it, vi } from 'vitest';
import { FrameMeter, QualityGovernor } from '../src/perf/frame-meter.ts';

describe('FrameMeter', () => {
  it('reports fps, p95 and dropped frames', () => {
    const meter = new FrameMeter(100);
    for (let i = 0; i < 95; i++) meter.record(1000 / 60);
    for (let i = 0; i < 5; i++) meter.record(40);
    const stats = meter.stats();
    expect(stats.frames).toBe(100);
    expect(stats.droppedPct).toBeCloseTo(5);
    expect(stats.worstMs).toBe(40);
    expect(stats.fps).toBeLessThan(60);
  });
});

describe('QualityGovernor', () => {
  it('lowers resolution under sustained slow frames and restores it with headroom', () => {
    const apply = vi.fn();
    const gov = new QualityGovernor(2, 2, apply);
    for (let t = 0; t < 2000; t += 16) gov.update(30, 16);
    expect(gov.pixelRatio).toBe(1.75);
    for (let t = 0; t < 6000; t += 16) gov.update(8, 16);
    expect(gov.pixelRatio).toBe(2);
    expect(apply).toHaveBeenCalledTimes(2);
  });
});
