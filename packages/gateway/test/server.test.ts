import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { PROTOCOL_VERSION, type ServerMessage } from '@ephemeralos/shared';
import { startGateway, type Gateway } from '../src/server.ts';
import { loadConfig } from '../src/config.ts';

const TOKEN = 'test-token';
let gateway: Gateway | undefined;

afterEach(async () => {
  await gateway?.close();
  gateway = undefined;
});

async function start(webRoot: string | null = null): Promise<Gateway> {
  gateway = await startGateway({
    host: '127.0.0.1',
    port: 0,
    token: TOKEN,
    extraOrigins: [],
    webRoot,
    homeDir: await mkdtemp(join(tmpdir(), 'eos-home-')),
  });
  return gateway;
}

function connect(port: number, opts: { token?: string; origin?: string } = {}): WebSocket {
  const token = opts.token ?? TOKEN;
  return new WebSocket(`ws://127.0.0.1:${port}/ws?token=${token}`, {
    origin: opts.origin ?? `http://localhost:${port}`,
  });
}

function rejected(ws: WebSocket): Promise<number> {
  return new Promise((done) => {
    ws.on('unexpected-response', (_req, res) => done(res.statusCode ?? 0));
    ws.on('error', () => done(-1));
  });
}

function nextMessage(ws: WebSocket): Promise<ServerMessage> {
  return new Promise((done) => ws.once('message', (d) => done(JSON.parse(d.toString()))));
}

describe('gateway WebSocket', () => {
  it('completes the hello handshake', async () => {
    const { port } = await start();
    const ws = connect(port);
    await new Promise((r) => ws.once('open', r));
    ws.send(JSON.stringify({ type: 'hello', protocol: PROTOCOL_VERSION }));
    expect(await nextMessage(ws)).toMatchObject({ type: 'welcome', protocol: PROTOCOL_VERSION });
    ws.close();
  });

  it('rejects a wrong token', async () => {
    const { port } = await start();
    expect(await rejected(connect(port, { token: 'nope' }))).toBe(403);
  });

  it('rejects a foreign origin', async () => {
    const { port } = await start();
    expect(await rejected(connect(port, { origin: 'https://evil.example' }))).toBe(403);
  });

  it('answers malformed frames with an error instead of crashing', async () => {
    const { port } = await start();
    const ws = connect(port);
    await new Promise((r) => ws.once('open', r));
    ws.send('not json');
    expect(await nextMessage(ws)).toMatchObject({ type: 'error', code: 'bad_message' });
    ws.close();
  });
});

describe('gateway HTTP', () => {
  it('injects the launch token into index.html and blocks path traversal', async () => {
    const root = await mkdtemp(join(tmpdir(), 'eos-web-'));
    await writeFile(join(root, 'index.html'), '<html><head></head><body></body></html>');
    const { port } = await start(root);

    const page = await fetch(`http://127.0.0.1:${port}/`);
    expect(await page.text()).toContain(`<meta name="eos-token" content="${TOKEN}">`);
    expect(page.headers.get('content-security-policy')).toContain("default-src 'self'");

    const traversal = await fetch(`http://127.0.0.1:${port}/..%2f..%2fetc%2fpasswd`);
    expect([403, 404]).toContain(traversal.status);
  });
});

describe('loadConfig', () => {
  it('always binds to loopback and mints a token', () => {
    const config = loadConfig({});
    expect(config.host).toBe('127.0.0.1');
    expect(config.token.length).toBeGreaterThanOrEqual(32);
  });

  it('rejects a nonsense port', () => {
    expect(() => loadConfig({ EOS_PORT: 'eighty' })).toThrow(/EOS_PORT/);
  });
});
