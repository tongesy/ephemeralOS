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

  it('moves into the open side when content fills the left', () => {
    const card: Rect = { x: 100, y: 200, width: 600, height: 600 };
    const p = openSpacePlacement(W, H, [card]);
    expect(p.x).toBeGreaterThan(card.x + card.width + p.radius);
    expect(p.radius).toBeLessThan(restingPlacement(W, H).radius);
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
