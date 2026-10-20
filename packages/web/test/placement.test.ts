import { describe, expect, it } from 'vitest';
import {
  RESTING_SIZE,
  openSpacePlacement,
  restingPlacement,
  type Rect,
} from '../src/orb/placement.ts';
import { Spring } from '../src/orb/spring.ts';

const W = 1600;
const H = 1000;

describe('placement', () => {
  it('rests small and centred when the screen is clear', () => {
    expect(restingPlacement(W, H)).toEqual({ x: 800, y: 500, radius: H * RESTING_SIZE });
    expect(openSpacePlacement(W, H, [])).toEqual(restingPlacement(W, H));
  });

  it('waits in the bottom-right corner while content is up', () => {
    const card: Rect = { x: 400, y: 200, width: 800, height: 600 };
    const p = openSpacePlacement(W, H, [card]);
    expect(p.x).toBeGreaterThan(W * 0.85);
    expect(p.y).toBeGreaterThan(H * 0.8);
    expect(p.radius).toBeLessThan(restingPlacement(W, H).radius);
    // Well in from the edges, so its glow and its word below it have room.
    expect(H - p.y).toBeGreaterThanOrEqual(H * 0.06 + p.radius * 2.5);
  });

  it('keeps its corner when a gallery runs nearly to the edges', () => {
    // The gallery's own padding (6vw, 8vh) is all the room there is.
    const mosaic: Rect = { x: 96, y: 160, width: W - 192, height: H - 240 };
    const p = openSpacePlacement(W, H, [mosaic]);
    expect(p.x).toBeGreaterThan(W - 96);
    expect(p.y).toBeGreaterThan(H - 120);
    expect(Math.hypot(p.x - (W - 96), p.y - (H - 80))).toBeGreaterThan(p.radius);
  });

  it('takes the next clear corner when content sits in the bottom right', () => {
    const p = openSpacePlacement(W, H, [{ x: 1000, y: 500, width: 600, height: 500 }]);
    expect(p.x).toBeGreaterThan(W * 0.85);
    expect(p.y).toBeLessThan(H * 0.15);
  });

  it('never overlaps content', () => {
    const cards: Rect[] = [
      { x: 0, y: 0, width: 1600, height: 400 },
      { x: 0, y: 600, width: 1600, height: 400 },
    ];
    const p = openSpacePlacement(W, H, cards);
    expect(p.y - p.radius).toBeGreaterThanOrEqual(400);
    expect(p.y + p.radius).toBeLessThanOrEqual(600);
  });
});

describe('Spring', () => {
  it('eases to its target without overshooting', () => {
    const s = new Spring(0, 100, 600);
    let max = 0;
    for (let t = 0; t < 3000; t += 16) max = Math.max(max, s.update(16));
    expect(max).toBeLessThanOrEqual(100);
    expect(s.value).toBeCloseTo(100, 1);
  });

  it('starts slowly (eases in)', () => {
    const s = new Spring(0, 100, 600);
    const first = s.update(16);
    const second = s.update(16) - first;
    expect(second).toBeGreaterThan(first * 0.5);
  });
});
