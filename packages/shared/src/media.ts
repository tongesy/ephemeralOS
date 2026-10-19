import { z } from 'zod';

/**
 * Things to listen to and watch: podcast episodes (audio relayed by the gateway, so the
 * page loads nothing from third parties and the orb can move to the sound) and YouTube
 * videos (privacy-enhanced embeds, shown poster first). Only the gateway starts media,
 * after it has found and checked the item; the voice model steers it with `media`.
 */

/** URL path the gateway relays audio on: `/media/<id>`, for ids it handed out itself. */
export const MEDIA_PATH = '/media/';

/** URL path the gateway serves cached YouTube posters on: `/posters/<video id>`. */
export const POSTERS_PATH = '/posters/';

/** URL path the gateway serves cached podcast artwork on: `/art/<artwork URL>`. */
export const ARTWORK_PATH = '/art/';

/** Podcast artwork lives on Apple's image hosts; nothing else is fetched as artwork. */
const ARTWORK = /^https:\/\/is\d+-ssl\.mzstatic\.com\/[\w\-./%]+\.(?:jpg|jpeg|png|webp)$/;

/** Whether a URL is podcast artwork the gateway will fetch and cache. */
export function isArtworkUrl(raw: string): boolean {
  return raw.length <= 1000 && ARTWORK.test(raw) && !raw.includes('..');
}

/** The only origin the page frames: YouTube's privacy-enhanced (no cookies) player. */
export const YOUTUBE_EMBED_ORIGIN = 'https://www.youtube-nocookie.com';

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const MEDIA_ID = /^[a-f0-9]{32}$/;
const VIDEO_URL =
  /^(?:https?:\/\/)?(?:(?:www|m|music)\.)?(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:[^#\s]*&)?v=|shorts\/|live\/|embed\/|v\/)|youtu\.be\/)([A-Za-z0-9_-]{11})(?![A-Za-z0-9_-])/i;

/**
 * The YouTube video id in what was written: a bare id, or a watch, share, shorts, live or
 * embed URL on a YouTube host. Null for anything else.
 */
export function youtubeId(raw: string): string | null {
  const text = raw.trim();
  if (VIDEO_ID.test(text)) return text;
  return VIDEO_URL.exec(text)?.[1] ?? null;
}

const Text = (max: number) => z.string().min(1).max(max);

export const AudioItem = z.object({
  kind: z.literal('audio'),
  /** The relay id the gateway issued; the page plays `/media/<id>`. */
  id: z.string().regex(MEDIA_ID),
  title: Text(200),
  /** The show (podcast) or artist. */
  by: Text(200).optional(),
  /** Apple artwork; the page shows it through the gateway (`/art/…`). */
  artwork: z.string().max(1000).refine(isArtworkUrl).optional(),
  durationSeconds: z.number().int().min(1).max(86_400).optional(),
  /** When it came out, as an ISO date. */
  published: z.string().max(40).optional(),
});

export const VideoItem = z.object({
  kind: z.literal('video'),
  youtube: z.string().regex(VIDEO_ID),
  title: Text(200),
  /** The channel. */
  by: Text(200).optional(),
});

export const MediaItem = z.discriminatedUnion('kind', [AudioItem, VideoItem]);
export type MediaItem = z.infer<typeof MediaItem>;

export const MEDIA_ACTIONS = [
  'pause',
  'resume',
  'stop',
  'forward',
  'back',
  'restart',
  'louder',
  'quieter',
  'status',
] as const;
export type MediaAction = (typeof MEDIA_ACTIONS)[number];

export const MediaArgs = z.object({
  action: z
    .enum(MEDIA_ACTIONS)
    .describe(
      'pause, resume, stop (and put away), forward or back by some seconds, restart from the beginning, louder, quieter, or status (what is playing and where)',
    ),
  seconds: z
    .number()
    .int()
    .min(1)
    .max(3600)
    .optional()
    .describe('forward/back: how far; default 30'),
});
export type MediaArgs = z.infer<typeof MediaArgs>;

export const MEDIA_TOOL_DESCRIPTION =
  'Control what is playing (a podcast or video started with play): "pause", "carry on", "skip ahead a minute", "go back", "start again", "louder", "stop". Returns what is playing and where it is.';
