import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';

/*
 * Pictures the page shows beside what the brain found (logos, photos of people and
 * places) are fetched here and served from the gateway, so the page never loads anything
 * from a third party. Only raster images come back: the bytes are checked by signature,
 * never trusted from the upstream, and cached under `~/.ephemeralos/cache`.
 */

const TIMEOUT_MS = 5000;
/** A cached image is refreshed after this long. */
const FRESH_MS = 30 * 24 * 60 * 60 * 1000;
/** Something with no image isn't asked about again for this long. */
const MISS_MS = 24 * 60 * 60 * 1000;

export type ImageType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp' | 'image/x-icon';

export interface Image {
  bytes: Uint8Array;
  type: ImageType;
}

/** What the bytes are, from their signature. Anything else (SVG, HTML) is refused. */
export function sniffImage(bytes: Uint8Array): ImageType | null {
  const at = (i: number, ...sig: number[]) => sig.every((b, j) => bytes[i + j] === b);
  if (at(0, 0x89, 0x50, 0x4e, 0x47)) return 'image/png';
  if (at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (at(0, 0x47, 0x49, 0x46, 0x38)) return 'image/gif';
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'image/webp';
  if (at(0, 0x00, 0x00, 0x01, 0x00)) return 'image/x-icon';
  return null;
}

export interface ImageCacheOptions {
  /** Folder under the cache, e.g. "logos". */
  dir: string;
  maxBytes: number;
  /** Smaller images are placeholders (a blank or a default globe), not the real thing. */
  minBytes: number;
  /** Where the image for a key might be, best first. Each answers a miss with a 404. */
  sources(key: string): Promise<string[]>;
  /** Where else to look, asked only when none of `sources` gave an image. */
  fallback?(key: string): Promise<string[]>;
  fetch: typeof fetch;
  label: string;
}

export interface ImageCache {
  /** The image for an already validated key, from the cache or the web; null if none. */
  get(key: string): Promise<Image | null>;
}

/** Host and path, trimmed, for a log line. */
function shortUrl(url: string): string {
  try {
    const { host, pathname } = new URL(url);
    const path = pathname.length > 70 ? `…${pathname.slice(-70)}` : pathname;
    return `${host}${path}`;
  } catch {
    return 'a malformed URL';
  }
}

export function createImageCache(options: ImageCacheOptions): ImageCache {
  const misses = new Map<string, number>();
  const inFlight = new Map<string, Promise<Uint8Array | null>>();

  async function cached(file: string): Promise<Uint8Array | null> {
    try {
      if (Date.now() - (await stat(file)).mtimeMs > FRESH_MS) return null;
      return new Uint8Array(await readFile(file));
    } catch {
      return null;
    }
  }

  async function download(url: string): Promise<Uint8Array | null> {
    // Why a picture didn't come, said plainly, so a missing one can be diagnosed.
    const why = (reason: string) => {
      console.info(`[${options.label}] ${reason}: ${shortUrl(url)}`);
      return null;
    };
    try {
      const res = await options.fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) return why(`answered ${res.status}`);
      if (Number(res.headers.get('content-length') ?? 0) > options.maxBytes) {
        return why('too large');
      }
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.length <= options.minBytes) return why(`too small (${bytes.length} bytes)`);
      if (bytes.length > options.maxBytes) return why('too large');
      return sniffImage(bytes) ? bytes : why('not an image');
    } catch (error) {
      return why(error instanceof Error ? error.name : 'failed');
    }
  }

  async function lookUp(key: string): Promise<Uint8Array | null> {
    // Hashed, so no key can name a path.
    const file = join(options.dir, createHash('sha256').update(key).digest('hex').slice(0, 32));
    const hit = await cached(file);
    if (hit) return hit;
    const lookups = [options.sources, ...(options.fallback ? [options.fallback] : [])];
    for (const lookup of lookups) {
      for (const url of await lookup(key).catch(() => [])) {
        const bytes = await download(url);
        if (!bytes) continue;
        await mkdir(options.dir, { recursive: true, mode: 0o700 });
        await writeFile(file, bytes);
        return bytes;
      }
    }
    console.info(`[${options.label}] none found for ${key}`);
    misses.set(key, Date.now() + MISS_MS);
    return null;
  }

  return {
    async get(key) {
      if ((misses.get(key) ?? 0) > Date.now()) return null;
      let pending = inFlight.get(key);
      if (!pending) {
        pending = lookUp(key).finally(() => inFlight.delete(key));
        inFlight.set(key, pending);
      }
      const bytes = await pending;
      const type = bytes && sniffImage(bytes);
      return bytes && type ? { bytes, type } : null;
    },
  };
}

/**
 * Serve one image path such as `/logos/arsenal.com`. An <img> can't send the token, so
 * instead only the page's own requests are answered: the Host check has already run, and a
 * browser marks any cross-site load with Sec-Fetch-Site.
 */
export async function serveImage(
  lookup: (key: string) => Promise<Image | null>,
  req: IncomingMessage,
  encodedKey: string,
  res: ServerResponse,
): Promise<void> {
  const site = req.headers['sec-fetch-site'];
  if (site !== undefined && site !== 'same-origin' && site !== 'none') {
    res.writeHead(403).end();
    return;
  }
  let key: string;
  try {
    key = decodeURIComponent(encodedKey);
  } catch {
    res.writeHead(404).end();
    return;
  }
  const image = await lookup(key);
  if (!image) {
    res.writeHead(404, { 'Cache-Control': 'no-store' }).end();
    return;
  }
  res
    .writeHead(200, {
      'Content-Type': image.type,
      'Cache-Control': 'private, max-age=86400',
      'X-Content-Type-Options': 'nosniff',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    })
    .end(image.bytes);
}
