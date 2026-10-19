import { join } from 'node:path';
import { z } from 'zod';
import { photoTitle } from '@ephemeralos/shared';
import { createImageCache, type Image } from './image-cache.ts';

/*
 * Photos of people, places and things: `/photos/Erling Haaland` is the lead image of that
 * Wikipedia article. No key is needed. Only the title is sent, only to Wikipedia, and
 * only images on Wikimedia's own upload host are fetched.
 */

/** Wikimedia asks API clients to say who they are. */
const USER_AGENT = 'ephemeralOS (https://github.com/tongesy/ephemeralOS)';
const UPLOADS = 'upload.wikimedia.org';

const Summary = z.looseObject({
  type: z.string().optional(),
  thumbnail: z.looseObject({ source: z.string() }).optional(),
});

/**
 * The photo URLs a Wikipedia summary offers, best first: the thumbnail at a size that
 * stays sharp on a high-density screen, then the thumbnail as given.
 */
export function photoSources(summary: unknown): string[] {
  const parsed = Summary.safeParse(summary);
  if (!parsed.success || parsed.data.type === 'disambiguation') return [];
  const source = parsed.data.thumbnail?.source;
  if (!source) return [];
  try {
    const url = new URL(source);
    if (url.protocol !== 'https:' || url.hostname !== UPLOADS) return [];
  } catch {
    return [];
  }
  const larger = source.replace(/\/\d+px-([^/]+)$/, '/640px-$1');
  return [...new Set([larger, source])];
}

export interface PhotoService {
  /** The photo for a Wikipedia article title; null when there is none. */
  get(title: string): Promise<Image | null>;
}

export function createPhotoService(options: {
  homeDir: string;
  fetch?: typeof fetch;
}): PhotoService {
  const doFetch = options.fetch ?? fetch;
  const identified: typeof fetch = (url, init) =>
    doFetch(url, { ...init, headers: { 'User-Agent': USER_AGENT } });
  const cache = createImageCache({
    dir: join(options.homeDir, 'cache', 'photos'),
    maxBytes: 2 * 1024 * 1024,
    minBytes: 1000,
    label: 'photos',
    fetch: identified,
    sources: async (title) => {
      const page = encodeURIComponent(title.replace(/ /g, '_'));
      const res = await identified(`https://en.wikipedia.org/api/rest_v1/page/summary/${page}`, {
        signal: AbortSignal.timeout(5000),
      });
      return res.ok ? photoSources(await res.json()) : [];
    },
  });
  return {
    get: (raw) => (photoTitle(raw) === raw ? cache.get(raw) : Promise.resolve(null)),
  };
}
