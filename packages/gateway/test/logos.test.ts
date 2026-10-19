import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { logoDomain } from '@ephemeralos/shared';
import { createLogoService, logoSources, sniffImage } from '../src/logos.ts';
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
    expect(new Uint8Array(await readFile(join(dir, 'cache', 'logos', 'arsenal.com')))).toEqual(PNG);

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
