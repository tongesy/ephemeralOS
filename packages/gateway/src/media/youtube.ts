import { join } from 'node:path';
import { z } from 'zod';
import { youtubeId } from '@ephemeralos/shared';
import { createImageCache, type Image } from '../images/image-cache.ts';

/*
 * YouTube without a key: oEmbed confirms a video exists and may be embedded (and gives its
 * title), and its poster is fetched from YouTube's image host and cached like any other
 * picture (`/posters/<id>`).
 */

const OEMBED = 'https://www.youtube.com/oembed';

const Oembed = z.looseObject({
  title: z.string().min(1),
  author_name: z.string().optional(),
});

export interface CheckedVideo {
  id: string;
  title: string;
  channel?: string;
}

/** The video's title and channel if it exists and its owner allows embedding; else null. */
export async function checkVideo(
  id: string,
  doFetch: typeof fetch = fetch,
): Promise<CheckedVideo | null> {
  if (youtubeId(id) !== id) return null;
  const watch = `https://www.youtube.com/watch?v=${id}`;
  const res = await doFetch(`${OEMBED}?${new URLSearchParams({ url: watch, format: 'json' })}`, {
    signal: AbortSignal.timeout(6000),
  });
  // 401: embedding is turned off; 404 or 400: no such video.
  if (!res.ok) return null;
  const parsed = Oembed.safeParse(await res.json().catch(() => null));
  if (!parsed.success) return null;
  return {
    id,
    title: parsed.data.title.slice(0, 200),
    ...(parsed.data.author_name && { channel: parsed.data.author_name.slice(0, 200) }),
  };
}

/** Poster images for a video, sharpest first (not every video has the largest). */
export function posterSources(id: string): string[] {
  return ['maxresdefault', 'sddefault', 'hqdefault'].map(
    (size) => `https://i.ytimg.com/vi/${id}/${size}.jpg`,
  );
}

export function createPosterService(options: { homeDir: string; fetch?: typeof fetch }): {
  get(id: string): Promise<Image | null>;
} {
  const cache = createImageCache({
    dir: join(options.homeDir, 'cache', 'posters'),
    maxBytes: 2 * 1024 * 1024,
    // YouTube answers a missing size with a tiny grey placeholder.
    minBytes: 2000,
    label: 'posters',
    fetch: options.fetch ?? fetch,
    sources: async (id) => posterSources(id),
  });
  return { get: (id) => (youtubeId(id) === id ? cache.get(id) : Promise.resolve(null)) };
}
