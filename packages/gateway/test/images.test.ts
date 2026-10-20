import { mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { logoDomain } from '@ephemeralos/shared';
import { sniffImage } from '../src/images/image-cache.ts';
import { createLogoService, logoSources } from '../src/images/logos.ts';
import {
  createPhotoService,
  openverseSources,
  pageImageSources,
  photoSources,
} from '../src/images/photos.ts';
import { startGateway, type Gateway } from '../src/server.ts';

/** A PNG signature padded past the placeholder threshold. */
const PNG = new Uint8Array([
  0x89,
  0x50,
  0x4e,
  0x47,
  0x0d,
  0x0a,
  0x1a,
  0x0a,
  ...new Array(200).fill(0),
]);
const SVG = new TextEncoder().encode(
  `<svg xmlns="http://www.w3.org/2000/svg">${' '.repeat(200)}</svg>`,
);

async function home(env = ''): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'eos-logos-'));
  await writeFile(join(dir, '.env'), env);
  return dir;
}

describe('logoDomain', () => {
  it('reduces what the brain wrote to a bare public domain', () => {
    expect(logoDomain('arsenal.com')).toBe('arsenal.com');
    expect(logoDomain('https://www.BBC.co.uk/news?x=1')).toBe('bbc.co.uk');
  });

  it('refuses addresses, ports and local names', () => {
    for (const bad of [
      '127.0.0.1',
      'localhost',
      'router.local',
      'a.internal',
      'x.com:8080/a',
      'no',
      '',
    ]) {
      expect(logoDomain(bad), bad).toBeNull();
    }
  });
});

describe('logo service', () => {
  it('asks logo.dev first only when a token is set', () => {
    expect(logoSources('arsenal.com')[0]).toMatch(/^https:\/\/www\.google\.com\//);
    const [first] = logoSources('arsenal.com', 'pk_abc');
    expect(first).toMatch(/^https:\/\/img\.logo\.dev\/arsenal\.com\?token=pk_abc&/);
  });

  it('checks the bytes, falls through sources, and caches what it finds', async () => {
    const fetchMock = vi.fn(async (url: string | URL) =>
      String(url).includes('google')
        ? new Response(SVG, { headers: { 'content-type': 'image/png' } })
        : new Response(PNG),
    );
    const dir = await home();
    const logos = createLogoService({ homeDir: dir, fetch: fetchMock as unknown as typeof fetch });

    expect(sniffImage(SVG)).toBeNull();
    const logo = await logos.get('arsenal.com');
    expect(logo?.type).toBe('image/png');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await readdir(join(dir, 'cache', 'logos'))).toHaveLength(1);

    await logos.get('arsenal.com');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('remembers a miss and never fetches for a bad name', async () => {
    const fetchMock = vi.fn(async () => new Response('nope', { status: 404 }));
    const logos = createLogoService({
      homeDir: await home(),
      fetch: fetchMock as unknown as typeof fetch,
    });
    expect(await logos.get('nowhere.example.org')).toBeNull();
    expect(await logos.get('nowhere.example.org')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await logos.get('../../etc/passwd')).toBeNull();
    expect(await logos.get('169.254.169.254')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('photos', () => {
  const thumb =
    'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Haaland.jpg/330px-Haaland.jpg';

  it('takes the lead image from a Wikipedia summary, larger when it can', () => {
    // Only Wikimedia's standard widths (it refuses others), never wider than the original.
    const original = 'https://upload.wikimedia.org/wikipedia/commons/a/a1/Haaland.jpg';
    expect(
      photoSources({
        type: 'standard',
        thumbnail: { source: thumb },
        originalimage: { source: original, width: 1000 },
      }),
    ).toEqual([
      thumb.replace('330px', '960px'),
      thumb.replace('330px', '500px'),
      thumb,
      thumb.replace('330px', '250px'),
      original,
    ]);
    expect(photoSources({ type: 'standard', thumbnail: { source: thumb } })[0]).toBe(
      thumb.replace('330px', '1280px'),
    );
    expect(photoSources({ type: 'disambiguation', thumbnail: { source: thumb } })).toEqual([]);
    expect(photoSources({ thumbnail: { source: 'https://evil.example/x.jpg' } })).toEqual([]);
    expect(photoSources({ title: 'No image' })).toEqual([]);
    // A thumbnail in a shape we can't resize is still used as it is.
    const odd = 'https://upload.wikimedia.org/wikipedia/commons/a/a1/Haaland.jpg?width=640';
    expect(photoSources({ thumbnail: { source: odd } })).toEqual([odd]);
  });

  it('looks the title up on Wikipedia, says who is asking, and checks the image', async () => {
    const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(2000).fill(0)]);
    const fetchMock = vi.fn(async (url: string | URL) =>
      String(url).startsWith('https://en.wikipedia.org/api/rest_v1/page/summary/Erling_Haaland')
        ? Response.json({ type: 'standard', thumbnail: { source: thumb } })
        : new Response(JPEG),
    );
    const photos = createPhotoService({
      homeDir: await home(),
      fetch: fetchMock as unknown as typeof fetch,
    });
    expect((await photos.get('Erling Haaland'))?.type).toBe('image/jpeg');
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.headers).toMatchObject({ 'User-Agent': expect.stringContaining('ephemeralOS') });
    expect(await photos.get('../etc/passwd')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('pageimages, when the summary has no photo', () => {
  const thumb =
    'https://upload.wikimedia.org/wikipedia/commons/thumb/6/6b/Venice.jpg/1280px-Venice.jpg';

  it('reads the lead image from the action API', () => {
    expect(
      pageImageSources({
        query: {
          pages: [
            {
              title: 'Venice',
              thumbnail: { source: thumb, width: 1280 },
              original: { source: thumb.replace(/thumb\/|\/1280px-Venice.jpg/g, ''), width: 4000 },
            },
          ],
        },
      }).slice(0, 2),
    ).toEqual([thumb, thumb.replace('1280px', '960px')]);
    expect(pageImageSources({ query: { pages: [{ missing: true }] } })).toEqual([]);
    expect(pageImageSources({ error: 'nope' })).toEqual([]);
  });

  it('says in the log why a lookup came back empty', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const fetchMock = vi.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.includes('/page/summary/')) return new Response('<html>blocked</html>');
      if (u.includes('/w/api.php?')) return new Response('slow down', { status: 429 });
      throw new TypeError('fetch failed', { cause: new Error('getaddrinfo ENOTFOUND') });
    });
    const photos = createPhotoService({
      homeDir: await home(),
      fetch: fetchMock as unknown as typeof fetch,
    });
    expect(await photos.get('Venice')).toBeNull();
    const lines = info.mock.calls.map(([line]) => String(line));
    expect(lines).toContain(
      `[photos] Wikipedia summary sent something that isn't JSON for "Venice": <html>blocked</html>`,
    );
    expect(lines).toContain(`[photos] Wikipedia pageimages answered 429 for "Venice": slow down`);
    expect(lines).toContain(
      `[photos] Openverse failed for "Venice": TypeError: fetch failed (getaddrinfo ENOTFOUND)`,
    );
  });
});

describe('Openverse, when Wikipedia has no photo', () => {
  const id = '0aff3595-8168-440b-83ff-7a80b65dea42';

  it('takes wide photos, through its own thumbnail service', () => {
    expect(
      openverseSources({
        results: [
          { id, width: 2000, height: 1300 },
          { id: id.replace('0a', 'ff'), width: 300, height: 200 },
          { id: 'not-an-id', width: 4000, height: 3000 },
        ],
      }),
    ).toEqual([
      `https://api.openverse.org/v1/images/${id}/thumb/?full_size=true`,
      `https://api.openverse.org/v1/images/${id}/thumb/`,
    ]);
    expect(openverseSources({ nothing: true })).toEqual([]);
  });

  it('is asked only when Wikipedia has nothing', async () => {
    const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(2000).fill(0)]);
    const fetchMock = vi.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.includes('/page/summary/')) return Response.json({ type: 'standard' });
      if (u.includes('/w/api.php?')) return Response.json({ query: { pages: [{ title: 'x' }] } });
      if (u.startsWith('https://api.openverse.org/v1/images/?')) {
        return Response.json({ results: [{ id, width: 1600, height: 1000 }] });
      }
      return u.includes(id) ? new Response(JPEG) : new Response('', { status: 404 });
    });
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const photos = createPhotoService({
      homeDir: await home(),
      fetch: fetchMock as unknown as typeof fetch,
    });
    expect((await photos.get('Amalfi Coast'))?.type).toBe('image/jpeg');
    const asked = fetchMock.mock.calls.map(([u]) => String(u));
    expect(asked[1]).toContain('prop=pageimages');
    expect(asked[2]).toContain('q=Amalfi+Coast');
    expect(asked[3]).toContain(`${id}/thumb/?full_size=true`);
  });
});

describe('/logos/', () => {
  let gateway: Gateway | undefined;
  afterEach(async () => {
    await gateway?.close();
    gateway = undefined;
  });

  it('serves the page its logos and refuses other sites', async () => {
    gateway = await startGateway({
      host: '127.0.0.1',
      port: 0,
      token: 't',
      extraOrigins: [],
      webRoot: null,
      homeDir: await home(),
      fetch: (async () => new Response(PNG)) as unknown as typeof fetch,
    });
    const url = `http://127.0.0.1:${gateway.port}/logos/arsenal.com`;

    const ok = await fetch(url, { headers: { 'sec-fetch-site': 'same-origin' } });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toBe('image/png');
    expect(ok.headers.get('x-content-type-options')).toBe('nosniff');

    const cross = await fetch(url, { headers: { 'sec-fetch-site': 'cross-site' } });
    expect(cross.status).toBe(403);
    expect((await fetch(`http://127.0.0.1:${gateway.port}/logos/localhost`)).status).toBe(404);
  });
});
