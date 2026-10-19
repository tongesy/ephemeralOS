import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { LOGOS_PATH, logoDomain } from '@ephemeralos/shared';
import { loadHome } from './home.ts';

/*
 * Logos for what the brain shows: `/logos/arsenal.com` is the club's logo. The page only
 * ever loads them from here, never from a third party, so no browsing data leaves the
 * machine with them. Without a key the gateway asks public favicon services; with a
 * logo.dev token (LOGO_DEV_TOKEN in .env) it asks logo.dev first. The token stays here.
 *
 * Only a bare public domain is ever sent, only to the fixed services below, and only
 * real raster images come back: the bytes are checked, never trusted from the upstream.
 */

const TIMEOUT_MS = 5000;
const MAX_BYTES = 256 * 1024;
/** A cached logo is refreshed after this long. */
const FRESH_MS = 30 * 24 * 60 * 60 * 1000;
/** A domain with no logo isn't asked about again for this long. */
const MISS_MS = 24 * 60 * 60 * 1000;

type ImageType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp' | 'image/x-icon';

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

/** Where to ask, best first. Each answers a miss with a 404. */
export function logoSources(domain: string, logoDevToken?: string): string[] {
  const name = encodeURIComponent(domain);
  return [
    ...(logoDevToken
      ? [
          `https://img.logo.dev/${name}?token=${encodeURIComponent(logoDevToken)}&size=128&format=png&fallback=404`,
        ]
      : []),
    `https://www.google.com/s2/favicons?domain=${name}&sz=128`,
    `https://icons.duckduckgo.com/ip3/${name}.ico`,
  ];
}

async function fetchImage(url: string, doFetch: typeof fetch): Promise<Uint8Array | null> {
  try {
    const res = await doFetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return null;
    if (Number(res.headers.get('content-length') ?? 0) > MAX_BYTES) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    // Tiny images are placeholders (a blank or default globe), not logos.
    return bytes.length > 100 && bytes.length <= MAX_BYTES && sniffImage(bytes) ? bytes : null;
  } catch {
    return null;
  }
}

export interface LogoService {
  /** The logo for a domain, from the cache or the web; null when there is none. */
  get(domain: string): Promise<{ bytes: Uint8Array; type: ImageType } | null>;
}

export function createLogoService(options: { homeDir: string; fetch?: typeof fetch }): LogoService {
  const doFetch = options.fetch ?? fetch;
  const dir = join(options.homeDir, 'cache', 'logos');
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

  async function lookUp(domain: string): Promise<Uint8Array | null> {
    const file = join(dir, domain);
    const hit = await cached(file);
    if (hit) return hit;
    const { secrets } = await loadHome(options.homeDir);
    for (const url of logoSources(domain, secrets.logoDevToken)) {
      const bytes = await fetchImage(url, doFetch);
      if (!bytes) continue;
      await mkdir(dir, { recursive: true, mode: 0o700 });
      await writeFile(file, bytes);
      return bytes;
    }
    misses.set(domain, Date.now() + MISS_MS);
    return null;
  }

  return {
    async get(raw) {
      const domain = logoDomain(raw);
      if (!domain || domain !== raw) return null;
      if ((misses.get(domain) ?? 0) > Date.now()) return null;
      let pending = inFlight.get(domain);
      if (!pending) {
        pending = lookUp(domain).finally(() => inFlight.delete(domain));
        inFlight.set(domain, pending);
      }
      const bytes = await pending;
      const type = bytes && sniffImage(bytes);
      return bytes && type ? { bytes, type } : null;
    },
  };
}

/**
 * Serve `/logos/<domain>`. An <img> can't send the token, so instead only the page's own
 * requests are answered: the Host check has already run, and a browser marks any
 * cross-site load with Sec-Fetch-Site.
 */
export async function serveLogo(
  logos: LogoService,
  req: IncomingMessage,
  path: string,
  res: ServerResponse,
): Promise<void> {
  const site = req.headers['sec-fetch-site'];
  if (site !== undefined && site !== 'same-origin' && site !== 'none') {
    res.writeHead(403).end();
    return;
  }
  let domain: string;
  try {
    domain = decodeURIComponent(path.slice(LOGOS_PATH.length));
  } catch {
    res.writeHead(404).end();
    return;
  }
  const logo = await logos.get(domain);
  if (!logo) {
    res.writeHead(404, { 'Cache-Control': 'no-store' }).end();
    return;
  }
  res
    .writeHead(200, {
      'Content-Type': logo.type,
      'Cache-Control': 'private, max-age=86400',
      'X-Content-Type-Options': 'nosniff',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    })
    .end(logo.bytes);
}
