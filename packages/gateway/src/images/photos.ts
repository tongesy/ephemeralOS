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
  if (thumb && onUploads(thumb)) {
    if (/\/\d+px-[^/]+$/.test(thumb)) {
      // A thumbnail can't be wider than its original; Wikimedia refuses that too.
      const widest = original?.width ?? Infinity;
      for (const width of STEPS.filter((w) => w < widest)) {
        urls.push(thumb.replace(/\/\d+px-([^/]+)$/, `/${width}px-$1`));
      }
    }
    // A thumbnail in a shape we don't know how to resize is still a picture.
    urls.push(thumb);
  }
  if (original && onUploads(original.source)) urls.push(original.source);
  return [...new Set(urls)];
}

const PageImages = z.looseObject({
  query: z.looseObject({
    pages: z.array(
      z.looseObject({
        missing: z.boolean().optional(),
        thumbnail: Image.optional(),
        original: Image.optional(),
      }),
    ),
  }),
});

/**
 * The same lead image through MediaWiki's own API (`prop=pageimages`), for when the summary
 * service offers none: it follows redirects and answers even where the summary is thin.
 */
export function pageImageSources(found: unknown): string[] {
  const parsed = PageImages.safeParse(found);
  const page = parsed.success ? parsed.data.query.pages[0] : undefined;
  if (!page || page.missing) return [];
  return photoSources({ thumbnail: page.thumbnail, originalimage: page.original });
}

/** What a reply was, briefly, for the log when it held nothing we could use. */
function gist(body: string): string {
  return body.replace(/\s+/g, ' ').slice(0, 200);
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

/** Openverse's pictures for a search, best first: photos wide enough to fill a frame (or of unknown size), at full size then as a thumbnail. */
export function openverseSources(found: unknown): string[] {
  const parsed = OpenverseResults.safeParse(found);
  if (!parsed.success) return [];
  return parsed.data.results
    .flatMap((r) => {
      const image = OpenverseImage.safeParse(r);
      return image.success ? [image.data] : [];
    })
    .filter((r) => (r.width ?? 1280) >= 640 && (r.width ?? 1280) >= (r.height ?? 0) * 0.6)
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
  /** Asks one source for a title's picture URLs, and says in the log exactly why when none. */
  async function ask(
    name: string,
    title: string,
    url: string,
    read: (found: unknown) => string[],
  ): Promise<string[]> {
    try {
      const res = await identified(url, { signal: AbortSignal.timeout(5000) });
      const body = await res.text();
      if (!res.ok) {
        console.info(`[photos] ${name} answered ${res.status} for "${title}": ${gist(body)}`);
        return [];
      }
      let found: unknown;
      try {
        found = JSON.parse(body);
      } catch {
        console.info(
          `[photos] ${name} sent something that isn't JSON for "${title}": ${gist(body)}`,
        );
        return [];
      }
      const sources = read(found);
      if (!sources.length)
        console.info(`[photos] ${name} has no photo for "${title}": ${gist(body)}`);
      return sources;
    } catch (error) {
      // Node's fetch hides the real reason (refused, DNS, certificate) in `cause`.
      const cause = error instanceof Error && error.cause instanceof Error ? error.cause : null;
      const why =
        error instanceof Error
          ? `${error.name}: ${error.message}${cause ? ` (${cause.message})` : ''}`
          : String(error);
      console.info(`[photos] ${name} failed for "${title}": ${why}`);
      return [];
    }
  }
  const cache = createImageCache({
    dir: join(options.homeDir, 'cache', 'photos'),
    maxBytes: 6 * 1024 * 1024,
    minBytes: 1000,
    label: 'photos',
    fetch: identified,
    sources: async (title) => {
      const page = encodeURIComponent(title.replace(/ /g, '_'));
      const summary = await ask(
        'Wikipedia summary',
        title,
        `https://en.wikipedia.org/api/rest_v1/page/summary/${page}`,
        photoSources,
      );
      if (summary.length) return summary;
      const query = new URLSearchParams({
        action: 'query',
        prop: 'pageimages',
        piprop: 'original|thumbnail',
        pithumbsize: '1280',
        redirects: '1',
        format: 'json',
        formatversion: '2',
        titles: title,
      });
      return ask(
        'Wikipedia pageimages',
        title,
        `https://en.wikipedia.org/w/api.php?${query}`,
        pageImageSources,
      );
    },
    fallback: (title) => {
      const query = new URLSearchParams({ q: title, page_size: '20', mature: 'false' });
      return ask('Openverse', title, `${OPENVERSE}?${query}`, openverseSources);
    },
  });
  return {
    get: (raw) => (photoTitle(raw) === raw ? cache.get(raw) : Promise.resolve(null)),
  };
}
