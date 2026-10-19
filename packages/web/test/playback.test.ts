import { describe, expect, it } from 'vitest';
import {
  DUCK,
  STAGE_MS,
  clock,
  docked,
  effectiveVolume,
  embedUrl,
  playerCommand,
  readPlayerMessage,
} from '../src/media/playback.ts';

const YT = 'https://www.youtube-nocookie.com';

describe('playback', () => {
  it('writes times as a clock', () => {
    expect(clock(0)).toBe('0:00');
    expect(clock(65.9)).toBe('1:05');
    expect(clock(3729)).toBe('1:02:09');
    expect(clock(-4)).toBe('0:00');
  });

  it('gives the stage to other content, keeps a video large, and settles a podcast', () => {
    const base = { screenBusy: false, conversing: false, sinceStageMs: 0 };
    expect(docked({ ...base, kind: 'audio', screenBusy: true })).toBe(true);
    expect(docked({ ...base, kind: 'video', screenBusy: true })).toBe(true);
    expect(docked({ ...base, kind: 'video', sinceStageMs: 10 * STAGE_MS })).toBe(false);
    expect(docked({ ...base, kind: 'audio' })).toBe(false);
    expect(docked({ ...base, kind: 'audio', sinceStageMs: STAGE_MS })).toBe(true);
    expect(docked({ ...base, kind: 'audio', sinceStageMs: STAGE_MS, conversing: true })).toBe(
      false,
    );
  });

  it('ducks while a conversation is open', () => {
    expect(effectiveVolume(1, false)).toBe(1);
    expect(effectiveVolume(0.5, true)).toBeCloseTo(0.5 * DUCK);
    expect(effectiveVolume(3, false)).toBe(1);
  });

  it('reads only a few numbers, and only from the YouTube player', () => {
    const info = JSON.stringify({
      event: 'infoDelivery',
      info: { playerState: 1, currentTime: 12.5, duration: 200, videoData: { title: 'x' } },
    });
    expect(readPlayerMessage(YT, info)).toEqual({ state: 1, time: 12.5, duration: 200 });
    expect(readPlayerMessage(YT, JSON.stringify({ event: 'onStateChange', info: 0 }))).toEqual({
      state: 0,
    });
    expect(readPlayerMessage('https://evil.example', info)).toBeNull();
    expect(readPlayerMessage(YT, 'not json')).toBeNull();
    expect(readPlayerMessage(YT, { event: 'onStateChange' })).toBeNull();
    expect(readPlayerMessage(YT, JSON.stringify({ event: 'infoDelivery', info: 'x' }))).toBeNull();
  });

  it('speaks the player API and embeds privately', () => {
    expect(JSON.parse(playerCommand('seekTo', [30, true]))).toEqual({
      event: 'command',
      func: 'seekTo',
      args: [30, true],
      id: 1,
      channel: 'widget',
    });
    const url = new URL(embedUrl('dQw4w9WgXcQ', 'http://127.0.0.1:4317'));
    expect(url.origin).toBe(YT);
    expect(url.pathname).toBe('/embed/dQw4w9WgXcQ');
    expect(url.searchParams.get('enablejsapi')).toBe('1');
    expect(url.searchParams.get('origin')).toBe('http://127.0.0.1:4317');
  });
});
