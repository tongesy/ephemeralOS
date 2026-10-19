import { randomBytes } from 'node:crypto';
import { get } from 'node:https';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { isIP } from 'node:net';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { isPublicAddress, publicLookup } from './address.ts';

/*
 * Audio relay: `/media/<id>` streams a podcast episode through the gateway, so the page
 * loads nothing from third parties and can measure the sound (the orb moves to it).
 * Only URLs the gateway itself registered are relayed (the page names an id, never a
 * URL), only over https to public addresses, through at most a few redirects, and only
 * if the answer is audio. Seeking works: the browser's Range requests pass through.
 */

/** How many recent items stay playable. */
const MAX_ITEMS = 32;
const MAX_REDIRECTS = 5;
const CONNECT_TIMEOUT_MS = 10_000;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
/** Some hosts label audio as plain bytes; those are served as MP3 (the usual case). */
const OCTETS = /^(application|binary)\/octet-stream$/;

export interface Upstream {
  status: number;
  headers: Record<string, string | undefined>;
  body: Readable;
}

/** Open one https request, without following redirects. Injected in tests. */
export type OpenUpstream = (
  url: URL,
  headers: Record<string, string>,
  signal: AbortSignal,
) => Promise<Upstream>;

const httpsOpen: OpenUpstream = (url, headers, signal) =>
  new Promise((resolve, reject) => {
    const req = get(url, { headers, lookup: publicLookup, signal }, (res) => {
      req.setTimeout(0);
      const flat: Record<string, string | undefined> = {};
      for (const [k, v] of Object.entries(res.headers)) flat[k] = Array.isArray(v) ? v[0] : v;
      resolve({ status: res.statusCode ?? 0, headers: flat, body: res });
    });
    req.setTimeout(CONNECT_TIMEOUT_MS, () => req.destroy(new Error('timed out')));
    req.on('error', reject);
  });

/** Whether the relay may fetch this URL: https on the usual port, to a public host. */
export function relayable(url: URL): boolean {
  if (url.protocol !== 'https:' || (url.port !== '' && url.port !== '443')) return false;
  if (url.username || url.password) return false;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  // Names are checked when they resolve (publicLookup); addresses are checked here.
  return isIP(host)
    ? isPublicAddress(host)
    : host.includes('.') && !/\.local$|^localhost$/i.test(host);
}

export class MediaRelay {
  private readonly urls = new Map<string, string>();

  constructor(private readonly open: OpenUpstream = httpsOpen) {}

  /** Make an https URL playable; returns the id the page asks for, or null. */
  register(raw: string): string | null {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return null;
    }
    if (!relayable(url)) return null;
    const id = randomBytes(16).toString('hex');
    this.urls.set(id, url.href);
    // Oldest first: keep the most recent few.
    while (this.urls.size > MAX_ITEMS) this.urls.delete(this.urls.keys().next().value!);
    return id;
  }

  /** Serve `/media/<id>`. Like pictures, only the page's own requests are answered. */
  async serve(req: IncomingMessage, id: string, res: ServerResponse): Promise<void> {
    const site = req.headers['sec-fetch-site'];
    if (site !== undefined && site !== 'same-origin' && site !== 'none') {
      res.writeHead(403).end();
      return;
    }
    const start = this.urls.get(id);
    if (!start) {
      res.writeHead(404).end();
      return;
    }
    const abort = new AbortController();
    res.on('close', () => abort.abort());

    const headers: Record<string, string> = {
      'User-Agent': 'ephemeralOS (https://github.com/tongesy/ephemeralOS)',
      Accept: 'audio/*, */*;q=0.5',
    };
    const range = req.headers.range;
    if (typeof range === 'string' && /^bytes=\d*-\d*$/.test(range)) headers.Range = range;

    let upstream: Upstream;
    try {
      let url = new URL(start);
      for (let hop = 0; ; hop++) {
        if (!relayable(url) || hop > MAX_REDIRECTS) throw new Error('refused');
        const answer = await this.open(url, headers, abort.signal);
        const location = answer.headers.location;
        if (REDIRECTS.has(answer.status) && location) {
          answer.body.resume();
          url = new URL(location, url);
          continue;
        }
        upstream = answer;
        break;
      }
    } catch (error) {
      if (!abort.signal.aborted) {
        console.warn(`[media] could not reach the audio: ${(error as Error).message}`);
        res.writeHead(502).end();
      }
      return;
    }

    const { status, headers: got, body } = upstream;
    const type = (got['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
    const audio = type.startsWith('audio/');
    if ((status !== 200 && status !== 206) || !(audio || OCTETS.test(type))) {
      body.resume();
      if (status === 416) res.writeHead(416).end();
      else {
        console.warn(`[media] upstream answered ${status} ${type || 'without a type'}`);
        res.writeHead(502).end();
      }
      return;
    }
    const out: Record<string, string> = {
      'Content-Type': audio ? type : 'audio/mpeg',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    };
    if (got['content-length']) out['Content-Length'] = got['content-length'];
    if (status === 206 && got['content-range']) out['Content-Range'] = got['content-range'];
    res.writeHead(status, out);
    await pipeline(body, res).catch(() => undefined);
  }
}
