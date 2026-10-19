import { mkdtemp, writeFile } from 'node:fs/promises';
import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MediaItem } from '@ephemeralos/shared';
import { isPublicAddress } from '../src/media/address.ts';
import { findEpisode, pickEpisode } from '../src/media/podcasts.ts';
import { MediaRelay, relayable, type OpenUpstream } from '../src/media/relay.ts';
import { checkVideo, posterSources } from '../src/media/youtube.ts';
import { createPlayTool } from '../src/tools/play.ts';

describe('isPublicAddress', () => {
  it('refuses loopback, private, link-local and special addresses', () => {
    for (const ip of [
      '127.0.0.1',
      '10.1.2.3',
      '172.20.0.1',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '::1',
      '::',
      'fe80::1',
      'fd00::1',
      '::ffff:127.0.0.1',
      '::ffff:10.0.0.1',
      'not-an-ip',
    ]) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
  });

  it('accepts public addresses', () => {
    for (const ip of ['93.184.216.34', '1.1.1.1', '2606:4700:4700::1111', '::ffff:8.8.8.8']) {
      expect(isPublicAddress(ip), ip).toBe(true);
    }
  });
});

describe('relayable', () => {
  it('allows only https on the usual port to public hosts', () => {
    expect(relayable(new URL('https://traffic.megaphone.fm/a.mp3'))).toBe(true);
    for (const bad of [
      'http://traffic.megaphone.fm/a.mp3',
      'https://traffic.megaphone.fm:8443/a.mp3',
      'https://127.0.0.1/a.mp3',
      'https://[::1]/a.mp3',
      'https://localhost/a.mp3',
      'https://printer.local/a.mp3',
      'https://user:pw@example.com/a.mp3',
      'file:///etc/passwd',
    ]) {
      expect(relayable(new URL(bad)), bad).toBe(false);
    }
  });
});

/** A gateway-like HTTP server in front of a relay, so requests go through real sockets. */
async function relayServer(relay: MediaRelay): Promise<{ server: Server; port: number }> {
  const server = createServer((req, res) => {
    void relay.serve(req, (req.url ?? '').replace('/media/', ''), res);
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  return { server, port: (server.address() as AddressInfo).port };
}

function get(
  port: number,
  path: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; headers: Record<string, unknown>; body: string }> {
  return new Promise((done, fail) => {
    const req = request({ host: '127.0.0.1', port, path, headers }, (res) => {
      let body = '';
      res.on('data', (c: Buffer) => (body += c.toString()));
      res.on('end', () => done({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on('error', fail);
    req.end();
  });
}

const answer = (status: number, headers: Record<string, string>, body = '') => ({
  status,
  headers,
  body: Readable.from([body]),
});

describe('MediaRelay', () => {
  let server: Server | null = null;
  afterEach(() => {
    server?.close();
    server = null;
  });

  it('relays registered audio, following redirects and passing ranges through', async () => {
    const open = vi.fn<OpenUpstream>(async (url, headers) => {
      if (url.hostname === 'pdst.fm') {
        return answer(302, { location: 'https://cdn.example.com/ep.mp3' });
      }
      expect(headers.Range).toBe('bytes=100-');
      return answer(
        206,
        {
          'content-type': 'audio/mpeg',
          'content-range': 'bytes 100-104/105',
          'content-length': '5',
        },
        'audio',
      );
    });
    const relay = new MediaRelay(open);
    const id = relay.register('https://pdst.fm/e/ep.mp3')!;
    expect(id).toMatch(/^[a-f0-9]{32}$/);
    ({ server } = await relayServer(relay));
    const { port } = server.address() as AddressInfo;

    const res = await get(port, `/media/${id}`, { range: 'bytes=100-' });
    expect(res.status).toBe(206);
    expect(res.body).toBe('audio');
    expect(res.headers['content-type']).toBe('audio/mpeg');
    expect(res.headers['content-range']).toBe('bytes 100-104/105');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(open).toHaveBeenCalledTimes(2);
  });

  it('refuses unknown ids, other sites, redirects inward and anything but audio', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const open = vi.fn<OpenUpstream>(async (url) => {
      if (url.pathname === '/inward') return answer(302, { location: 'https://127.0.0.1/admin' });
      return answer(200, { 'content-type': 'text/html' }, '<html>');
    });
    const relay = new MediaRelay(open);
    expect(relay.register('http://example.com/a.mp3')).toBeNull();
    expect(relay.register('https://10.0.0.1/a.mp3')).toBeNull();
    const inward = relay.register('https://example.com/inward')!;
    const html = relay.register('https://example.com/page')!;
    ({ server } = await relayServer(relay));
    const { port } = server.address() as AddressInfo;

    expect((await get(port, `/media/${'0'.repeat(32)}`)).status).toBe(404);
    expect((await get(port, `/media/${html}`, { 'sec-fetch-site': 'cross-site' })).status).toBe(
      403,
    );
    expect((await get(port, `/media/${inward}`)).status).toBe(502);
    expect(open).toHaveBeenCalledTimes(1); // the inward hop was never opened
    const page = await get(port, `/media/${html}`);
    expect(page.status).toBe(502);
    expect(page.body).toBe('');
  });

  it('keeps only the most recent items playable', () => {
    const relay = new MediaRelay(vi.fn<OpenUpstream>());
    const first = relay.register('https://example.com/0.mp3')!;
    for (let i = 1; i <= 40; i++) relay.register(`https://example.com/${i}.mp3`);
    expect((relay as unknown as { urls: Map<string, string> }).urls.has(first)).toBe(false);
  });
});

const SHOW = {
  collectionId: 1200361736,
  collectionName: 'The Daily',
  artistName: 'The New York Times',
  artworkUrl600: 'https://is1-ssl.mzstatic.com/image/thumb/daily/600x600bb.jpg',
};

const episode = (title: string, date: string, url = `https://cdn.example.com/${date}.mp3`) => ({
  wrapperType: 'podcastEpisode',
  trackName: title,
  episodeUrl: url,
  releaseDate: `${date}T10:00:00Z`,
  trackTimeMillis: 1_800_000,
});

function itunes(episodes: unknown[]) {
  return vi.fn(async (url: string) => {
    if (url.startsWith('https://itunes.apple.com/search?')) {
      return Response.json({ results: [{ kind: 'nonsense' }, SHOW] });
    }
    if (url.startsWith('https://itunes.apple.com/lookup?')) {
      return Response.json({ results: [{ wrapperType: 'track', ...SHOW }, ...episodes] });
    }
    return new Response('', { status: 404 });
  });
}

describe('podcasts', () => {
  it('finds the show and its latest playable episode', async () => {
    const fetchMock = itunes([
      episode('Older', '2026-10-10'),
      episode('Latest', '2026-10-18'),
      episode('Not https', '2026-10-19', 'http://cdn.example.com/x.mp3'),
    ]);
    const found = await findEpisode('the daily', undefined, { fetch: fetchMock as typeof fetch });
    expect(found).toEqual({
      audioUrl: 'https://cdn.example.com/2026-10-18.mp3',
      title: 'Latest',
      show: 'The Daily',
      artwork: SHOW.artworkUrl600,
      durationSeconds: 1800,
      published: '2026-10-18',
    });
    const search = new URL(String(fetchMock.mock.calls[0]![0]));
    expect(search.searchParams.get('term')).toBe('the daily');
    expect(search.searchParams.get('media')).toBe('podcast');
  });

  it('picks the episode whose title matches what was asked for', () => {
    const episodes = [
      { trackName: 'The election, explained' },
      { trackName: 'Inside the Louvre heist' },
    ];
    expect(pickEpisode(episodes, 'the louvre one')?.trackName).toBe('Inside the Louvre heist');
    expect(pickEpisode(episodes, 'nothing matching')?.trackName).toBe('The election, explained');
    expect(pickEpisode([], 'x')).toBeUndefined();
  });

  it('says so when there is no such show', async () => {
    const none = vi.fn(async () => Response.json({ results: [] }));
    expect(await findEpisode('zzz', undefined, { fetch: none as typeof fetch })).toBeNull();
  });
});

describe('YouTube', () => {
  it('checks a video exists and may be embedded', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.includes('dQw4w9WgXcQ')
        ? Response.json({ title: 'Never Gonna Give You Up', author_name: 'Rick Astley' })
        : new Response('Unauthorized', { status: 401 }),
    );
    expect(await checkVideo('dQw4w9WgXcQ', fetchMock as typeof fetch)).toEqual({
      id: 'dQw4w9WgXcQ',
      title: 'Never Gonna Give You Up',
      channel: 'Rick Astley',
    });
    expect(await checkVideo('aaaaaaaaaaa', fetchMock as typeof fetch)).toBeNull();
    expect(await checkVideo('../x', fetchMock as typeof fetch)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("looks for posters on YouTube's image host, sharpest first", () => {
    expect(posterSources('dQw4w9WgXcQ')[0]).toBe(
      'https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg',
    );
  });
});

describe('play tool', () => {
  async function home(env: string) {
    const dir = await mkdtemp(join(tmpdir(), 'eos-play-'));
    await writeFile(join(dir, '.env'), env);
    return dir;
  }

  it('starts a podcast episode on the page through the relay', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const relay = new MediaRelay(vi.fn<OpenUpstream>());
    const fetchMock = itunes([episode('Latest', '2026-10-18')]);
    const tool = createPlayTool({
      homeDir: await home(''),
      relay,
      fetch: fetchMock as typeof fetch,
    });
    const started: MediaItem[] = [];
    const result = await tool.run(
      { kind: 'podcast', query: 'The Daily' },
      { display: () => {}, media: (item) => started.push(item) },
    );
    expect(result).toMatchObject({ playing: 'Latest', show: 'The Daily', minutes: 30 });
    expect(started).toEqual([
      expect.objectContaining({ kind: 'audio', title: 'Latest', by: 'The Daily' }),
    ]);
    expect((started[0] as { id: string }).id).toMatch(/^[a-f0-9]{32}$/);
  });

  it('finds a video with a web search and plays only one YouTube confirms', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const fetchMock = vi.fn(async (url: string) => {
      if (url === 'https://api.openai.com/v1/responses') {
        return Response.json({
          output: [
            {
              type: 'message',
              content: [
                {
                  type: 'output_text',
                  // An invented id first; the cited one is real.
                  text: '{"url": "https://www.youtube.com/watch?v=madeUpId01"}',
                  annotations: [
                    {
                      type: 'url_citation',
                      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
                      title: 'Rick Astley',
                    },
                  ],
                },
              ],
            },
          ],
        });
      }
      if (url.includes('oembed') && url.includes('dQw4w9WgXcQ')) {
        return Response.json({ title: 'Never Gonna Give You Up', author_name: 'Rick Astley' });
      }
      return new Response('Not Found', { status: 404 });
    });
    const tool = createPlayTool({
      homeDir: await home('OPENAI_API_KEY=sk-test\n'),
      relay: new MediaRelay(vi.fn<OpenUpstream>()),
      fetch: fetchMock as typeof fetch,
    });
    const started: MediaItem[] = [];
    const result = await tool.run(
      { kind: 'music', query: 'never gonna give you up' },
      { display: () => {}, media: (item) => started.push(item) },
    );
    expect(result).toMatchObject({ playing: 'Never Gonna Give You Up', channel: 'Rick Astley' });
    expect(started).toEqual([
      {
        kind: 'video',
        youtube: 'dQw4w9WgXcQ',
        title: 'Never Gonna Give You Up',
        by: 'Rick Astley',
      },
    ]);
  });
});
