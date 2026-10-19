import { describe, expect, it } from 'vitest';
import { MAX_CATCH_UP_S, catchUpDelay } from '../src/audio/catch-up.ts';

describe('catching up after the wake word', () => {
  it('listens from the moment the wake word fired, up to a limit', () => {
    expect(catchUpDelay(10, 11.4)).toBeCloseTo(1.4);
    expect(catchUpDelay(10, 30)).toBe(MAX_CATCH_UP_S);
    expect(catchUpDelay(null, 30)).toBe(0);
    expect(catchUpDelay(10, 9)).toBe(0);
  });
});
