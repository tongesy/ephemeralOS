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
  fetch: typeof fetch;
  label: string;
}

export interface ImageCache {
  /** The image for an already validated key, from the cache or the web; null if none. */
  get(key: string): Promise<Image | null>;
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
    try {
      const res = await options.fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) return null;
      if (Number(res.headers.get('content-length') ?? 0) > options.maxBytes) return null;
      const bytes = new Uint8Array(await res.arrayBuffer());
      const sized = bytes.length > options.minBytes && bytes.length <= options.maxBytes;
      return sized && sniffImage(bytes) ? bytes : null;
    } catch {
      return null;
    }
  }

  async function lookUp(key: string): Promise<Uint8Array | null> {
    // Hashed, so no key can name a path.
    const file = join(options.dir, createHash('sha256').update(key).digest('hex').slice(0, 32));
    const hit = await cached(file);
    if (hit) return hit;
    for (const url of await options.sources(key).catch(() => [])) {
      const bytes = await download(url);
      if (!bytes) continue;
      await mkdir(options.dir, { recursive: true, mode: 0o700 });
      await writeFile(file, bytes);
      return bytes;
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
