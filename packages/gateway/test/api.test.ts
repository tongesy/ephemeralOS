import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { GatewayStatus, RealtimeSession, WAKE_WORD_FEATURE_MODELS } from '@ephemeralos/shared';
import { startGateway, type Gateway } from '../src/server.ts';
import { ToolRegistry } from '../src/tools/registry.ts';

const TOKEN = 'test-token';
const KEY = 'sk-test-secret-key';
let gateway: Gateway | undefined;

afterEach(async () => {
  await gateway?.close();
  gateway = undefined;
});

async function makeHome(files: Record<string, string> = {}): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'eos-home-'));
  for (const [name, body] of Object.entries(files)) {
    await mkdir(join(dir, name, '..'), { recursive: true });
    await writeFile(join(dir, name), body);
  }
  return dir;
}

async function start(homeDir: string, extra: { fetch?: typeof fetch; tools?: ToolRegistry } = {}) {
  gateway = await startGateway({
    host: '127.0.0.1',
    port: 0,
    token: TOKEN,
    extraOrigins: [],
    webRoot: null,
    homeDir,
    ...extra,
  });
  const base = `http://127.0.0.1:${gateway.port}`;
  const call = (path: string, init: RequestInit = {}) =>
    fetch(base + path, {
      ...init,
      headers: { 'x-eos-token': TOKEN, Origin: base, ...(init.headers ?? {}) },
    });
  return { base, call, port: gateway.port };
}

function okSecret() {
  return vi.fn(
    async () =>
      new Response(JSON.stringify({ value: 'ek_abc', expires_at: 1_900_000_000 }), {
        status: 200,
      }),
  );
}

describe('GET /api/status', () => {
  it('reports what is set up, never the keys', async () => {
    const models = Object.fromEntries(
      [...WAKE_WORD_FEATURE_MODELS, 'hey_jarvis_v0.1.onnx'].map((f) => [`models/${f}`, 'x']),
    );
    const home = await makeHome({
      '.env': `OPENAI_API_KEY=${KEY}\n`,
      'config.json': JSON.stringify({ name: 'Nova' }),
      ...models,
    });
    const { call } = await start(home);
    const res = await call('/api/status');
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text).not.toContain(KEY);
    const status = GatewayStatus.parse(JSON.parse(text));
    expect(status).toMatchObject({ name: 'Nova', voice: true, wakeWord: { available: true } });
  });

  it('says voice and wake word are unavailable on a fresh install', async () => {
    const { call } = await start(await makeHome());
    const status = GatewayStatus.parse(await (await call('/api/status')).json());
    expect(status.voice).toBe(false);
    expect(status.wakeWord.available).toBe(false);
  });

  it('refuses calls without the token, from other origins, or for other hosts', async () => {
    const { base, port } = await start(await makeHome());
    expect((await fetch(`${base}/api/status`)).status).toBe(403);
    const foreign = await fetch(`${base}/api/status`, {
      headers: { 'x-eos-token': TOKEN, Origin: 'https://evil.example' },
    });
    expect(foreign.status).toBe(403);
    // DNS rebinding: the attacker's page reaches us under its own host name.
    const rebound = await new Promise<number>((done) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${TOKEN}`, {
        headers: { Host: `evil.example:${port}` },
        origin: `http://evil.example:${port}`,
      });
      ws.on('unexpected-response', (_q, r) => done(r.statusCode ?? 0));
      ws.on('error', () => done(-1));
    });
    expect(rebound).toBe(403);
  });
});

describe('POST /api/realtime/session', () => {
  it('mints a client secret with the key, and returns only the secret', async () => {
    const home = await makeHome({
      '.env': `# keys\nOPENAI_API_KEY="${KEY}"\n`,
      'SOUL.md': 'Calm and dry.',
      'MEMORY.md': '- Prefers metric units.',
    });
    const fetchMock = okSecret();
    const { call } = await start(home, { fetch: fetchMock as unknown as typeof fetch });

    const res = await call('/api/realtime/session', { method: 'POST' });
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text).not.toContain(KEY);
    expect(RealtimeSession.parse(JSON.parse(text))).toEqual({
      clientSecret: 'ek_abc',
      expiresAt: 1_900_000_000,
      model: 'gpt-realtime-2.1-mini',
    });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/realtime/client_secrets');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(headers['OpenAI-Safety-Identifier']).toMatch(/^[0-9a-f]{64}$/);
    const body = JSON.parse(String(init.body));
    expect(body.expires_after).toEqual({ anchor: 'created_at', seconds: 60 });
    expect(body.session).toMatchObject({
      type: 'realtime',
      model: 'gpt-realtime-2.1-mini',
      audio: { output: { voice: 'marin' } },
    });
    expect(body.session.instructions).toContain('Calm and dry.');
    expect(body.session.instructions).toContain('Prefers metric units.');
    expect(body.session.tools.map((t: { name: string }) => t.name)).toContain('end_session');
  });

  it('explains a missing key instead of failing silently', async () => {
    const { call } = await start(await makeHome());
    const res = await call('/api/realtime/session', { method: 'POST' });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: 'no_openai_key' });
  });

  it('passes on an OpenAI refusal without leaking the key', async () => {
    const home = await makeHome({ '.env': `OPENAI_API_KEY=${KEY}` });
    const refuse = vi.fn(
      async () => new Response('{"error":{"message":"Incorrect API key"}}', { status: 401 }),
    );
    const { call } = await start(home, { fetch: refuse as unknown as typeof fetch });
    const res = await call('/api/realtime/session', { method: 'POST' });
    expect(res.status).toBe(401);
    expect(await res.text()).not.toContain(KEY);
  });
});

describe('models, transcripts and tools', () => {
  it('serves model files by name only', async () => {
    const home = await makeHome({ 'models/hey_jarvis_v0.1.onnx': 'onnx-bytes', '.env': 'x=1' });
    const { base } = await start(home);
    expect(await (await fetch(`${base}/models/hey_jarvis_v0.1.onnx`)).text()).toBe('onnx-bytes');
    expect((await fetch(`${base}/models/..%2f.env`)).status).toBe(404);
  });

  it('appends transcripts and relays tool calls', async () => {
    const home = await makeHome();
    const tools = new ToolRegistry();
    tools.register({
      definition: {
        type: 'function',
        name: 'echo',
        description: 'Echo',
        parameters: { type: 'object' },
      },
      run: async (args) => ({ heard: args }),
    });
    const { port } = await start(home, { tools });
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${TOKEN}`, {
      origin: `http://127.0.0.1:${port}`,
    });
    await new Promise((r) => ws.once('open', r));

    ws.send(JSON.stringify({ type: 'transcript', sessionId: 's1', role: 'user', text: 'Hello' }));
    ws.send(
      JSON.stringify({ type: 'tool.call', callId: 'c1', name: 'echo', arguments: '{"a":1}' }),
    );
    const result = await new Promise((done) =>
      ws.once('message', (d) => done(JSON.parse(d.toString()))),
    );
    expect(result).toEqual({ type: 'tool.result', callId: 'c1', output: '{"heard":{"a":1}}' });
    ws.close();

    // The transcript is written in the background; wait for it to land.
    const file = await vi.waitFor(async () => {
      const [name] = await readdir(join(home, 'transcripts')).catch(() => []);
      if (!name) throw new Error('no transcript yet');
      return name;
    });
    const line = JSON.parse((await readFile(join(home, 'transcripts', file), 'utf8')).trim());
    expect(line).toMatchObject({ sessionId: 's1', role: 'user', text: 'Hello' });
  });
});
