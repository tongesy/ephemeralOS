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

const Image = z.looseObject({ source: z.string(), width: z.number().optional() });
const Summary = z.looseObject({
  type: z.string().optional(),
  thumbnail: Image.optional(),
  originalimage: Image.optional(),
});

/**
 * The widths Wikimedia renders thumbnails at. It refuses any other width with a 429, so a
 * thumbnail URL is only ever rewritten to one of these.
 * https://www.mediawiki.org/wiki/Common_thumbnail_sizes
 */
const STEPS = [1280, 960, 500, 330, 250];

function onUploads(source: string): boolean {
  try {
    const url = new URL(source);
    return url.protocol === 'https:' && url.hostname === UPLOADS;
  } catch {
    return false;
  }
}

/**
 * The photo URLs a Wikipedia summary offers, best first: its thumbnail at standard widths
 * from sharp enough for a full-screen gallery down, then the original when it is no wider.
 */
export function photoSources(summary: unknown): string[] {
  const parsed = Summary.safeParse(summary);
  if (!parsed.success || parsed.data.type === 'disambiguation') return [];
  const thumb = parsed.data.thumbnail?.source;
  const original = parsed.data.originalimage;
  const urls: string[] = [];
  if (thumb && onUploads(thumb) && /\/\d+px-[^/]+$/.test(thumb)) {
    // A thumbnail can't be wider than its original; Wikimedia refuses that too.
    const widest = original?.width ?? Infinity;
    for (const width of STEPS.filter((w) => w < widest)) {
      urls.push(thumb.replace(/\/\d+px-([^/]+)$/, `/${width}px-$1`));
    }
  }
  if (original && onUploads(original.source)) urls.push(original.source);
  return [...new Set(urls)];
}

/*
 * When Wikipedia has no photo (or it won't load), Openverse: the open-licensed image search
 * run by WordPress (Flickr, Wikimedia Commons, museums), searchable without a key. Its
 * pictures come through its own thumbnail service, so only one more host is ever asked.
 */
const OPENVERSE = 'https://api.openverse.org/v1/images/';

const OpenverseImage = z.looseObject({
  id: z.string().regex(/^[0-9a-f-]{36}$/),
  width: z.number().nullish(),
  height: z.number().nullish(),
});
const OpenverseResults = z.looseObject({ results: z.array(z.unknown()) });

/** Openverse's pictures for a search, best first: wide photos, at full size then as a thumbnail. */
export function openverseSources(found: unknown): string[] {
  const parsed = OpenverseResults.safeParse(found);
  if (!parsed.success) return [];
  return parsed.data.results
    .flatMap((r) => {
      const image = OpenverseImage.safeParse(r);
      return image.success ? [image.data] : [];
    })
    .filter((r) => (r.width ?? 0) >= 800 && (r.width ?? 0) >= (r.height ?? 0) * 0.6)
    .slice(0, 3)
    .flatMap((r) => [`${OPENVERSE}${r.id}/thumb/?full_size=true`, `${OPENVERSE}${r.id}/thumb/`]);
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
    maxBytes: 6 * 1024 * 1024,
    minBytes: 1000,
    label: 'photos',
    fetch: identified,
    sources: async (title) => {
      const page = encodeURIComponent(title.replace(/ /g, '_'));
      const res = await identified(`https://en.wikipedia.org/api/rest_v1/page/summary/${page}`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) {
        console.info(`[photos] Wikipedia answered ${res.status} for "${title}"`);
        return [];
      }
      const sources = photoSources(await res.json());
      if (!sources.length) console.info(`[photos] Wikipedia has no photo for "${title}"`);
      return sources;
    },
    fallback: async (title) => {
      const query = new URLSearchParams({ q: title, page_size: '10', mature: 'false' });
      const res = await identified(`${OPENVERSE}?${query}`, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) {
        console.info(`[photos] Openverse answered ${res.status} for "${title}"`);
        return [];
      }
      return openverseSources(await res.json());
    },
  });
  return {
    get: (raw) => (photoTitle(raw) === raw ? cache.get(raw) : Promise.resolve(null)),
  };
}
