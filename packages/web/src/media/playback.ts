import { YOUTUBE_EMBED_ORIGIN } from '@ephemeralos/shared';

/*
 * The parts of playback that are plain logic, kept out of the player so they can be
 * tested: clocks, where the player sits, how loud it plays, and what YouTube's player
 * reports back.
 */

/** While a conversation is open, what is playing drops to this share of its volume. */
export const DUCK = 0.12;
/** "Louder" and "quieter" move the volume by this much. */
export const VOLUME_STEP = 0.2;
/** A podcast stays large on its own for this long, then settles into the corner. */
export const STAGE_MS = 20_000;

/** "4:05", "1:02:09". */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** "12 Oct · 34 min", from what the gateway knows about an episode. */
export function episodeLine(published?: string, durationSeconds?: number): string {
  const parts: string[] = [];
  if (published) {
    const date = new Date(`${published}T12:00:00`);
    if (!Number.isNaN(date.getTime())) {
      parts.push(date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }));
    }
  }
  if (durationSeconds) parts.push(`${Math.max(1, Math.round(durationSeconds / 60))} min`);
  return parts.join(' · ');
}

/**
 * Whether the player sits small in the corner rather than on stage. Anything else on
 * screen takes the stage. A video otherwise stays large (it is there to be watched); a
 * podcast is large while it starts, or while you talk about it, then settles.
 */
export function docked(state: {
  kind: 'audio' | 'video';
  screenBusy: boolean;
  conversing: boolean;
  sinceStageMs: number;
}): boolean {
  if (state.screenBusy) return true;
  if (state.kind === 'video') return false;
  return !state.conversing && state.sinceStageMs >= STAGE_MS;
}

/** The volume to play at, 0..1: the chosen level, lowered while a conversation is open. */
export function effectiveVolume(volume: number, ducked: boolean): number {
  return Math.min(Math.max(volume, 0), 1) * (ducked ? DUCK : 1);
}

/** YouTube's player states, as its iframe API numbers them. */
export const YT_ENDED = 0;
export const YT_PLAYING = 1;
export const YT_PAUSED = 2;

export interface PlayerReport {
  state?: number;
  time?: number;
  duration?: number;
}

/**
 * Read a message from the YouTube player frame. It is someone else's page, so only a few
 * numbers are taken from it, and only from the embed origin.
 */
export function readPlayerMessage(origin: string, data: unknown): PlayerReport | null {
  if (origin !== YOUTUBE_EMBED_ORIGIN || typeof data !== 'string' || data.length > 20_000) {
    return null;
  }
  let message: unknown;
  try {
    message = JSON.parse(data);
  } catch {
    return null;
  }
  if (!message || typeof message !== 'object') return null;
  const { event, info } = message as { event?: unknown; info?: unknown };
  const number = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  if (event === 'onStateChange') {
    const state = number(info);
    return state === undefined ? null : { state };
  }
  if (event === 'infoDelivery' && info && typeof info === 'object') {
    const i = info as Record<string, unknown>;
    const report: PlayerReport = {};
    const state = number(i.playerState);
    const time = number(i.currentTime);
    const duration = number(i.duration);
    if (state !== undefined) report.state = state;
    if (time !== undefined) report.time = time;
    if (duration !== undefined && duration > 0) report.duration = duration;
    return Object.keys(report).length ? report : null;
  }
  return null;
}

/** A command for the YouTube player frame (its iframe API, spoken over postMessage). */
export function playerCommand(func: string, args: unknown[] = []): string {
  return JSON.stringify({ event: 'command', func, args, id: 1, channel: 'widget' });
}

/** The embed URL: privacy-enhanced, autoplaying, no related videos from other channels. */
export function embedUrl(id: string, pageOrigin: string): string {
  const params = new URLSearchParams({
    autoplay: '1',
    enablejsapi: '1',
    playsinline: '1',
    controls: '0',
    rel: '0',
    iv_load_policy: '3',
    origin: pageOrigin,
  });
  return `${YOUTUBE_EMBED_ORIGIN}/embed/${id}?${params}`;
}
