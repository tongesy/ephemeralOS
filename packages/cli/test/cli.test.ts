import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { parseEnv } from '@ephemeralos/gateway';
import { formatEnv } from '../src/env-file.ts';
import { KEYS, cleanKey, verifyKey } from '../src/keys.ts';
import { downloadModels, modelFiles } from '../src/models.ts';
import { TEMPLATES_DIR, resolveHome } from '../src/paths.ts';
import { copyTemplates } from '../src/templates.ts';

describe('formatEnv', () => {
  it('round-trips through the gateway parser and drops empty keys', () => {
    const text = formatEnv({ OPENAI_API_KEY: 'sk-a=b', ANTHROPIC_API_KEY: undefined });
    expect(parseEnv(text)).toEqual({ OPENAI_API_KEY: 'sk-a=b' });
  });

  it('refuses values that would break the file', () => {
    expect(() => formatEnv({ OPENAI_API_KEY: 'sk\nX=1' })).toThrow();
  });
});

describe('copyTemplates', () => {
  it('copies the starting files but never overwrites yours', async () => {
    const home = await mkdtemp(join(tmpdir(), 'eos-init-'));
    await writeFile(join(home, 'SOUL.md'), 'mine');
    const created = await copyTemplates(TEMPLATES_DIR, home);
    expect(created).toContain('config.json');
    expect(created).not.toContain('SOUL.md');
    expect(await readFile(join(home, 'SOUL.md'), 'utf8')).toBe('mine');
    expect(await readdir(join(home, 'transcripts'))).toEqual([]);
    expect(await copyTemplates(TEMPLATES_DIR, home)).toEqual([]);
  });
});

describe('downloadModels', () => {
  it('fetches only missing files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'eos-models-'));
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'melspectrogram.onnx'), 'have');
    const fetchMock = vi.fn(async () => new Response('bytes'));
    await downloadModels(dir, 'hey_jarvis_v0.1', () => {}, fetchMock as unknown as typeof fetch);
    expect(fetchMock).toHaveBeenCalledTimes(modelFiles('hey_jarvis_v0.1').length - 1);
    expect((await readdir(dir)).sort()).toEqual(modelFiles('hey_jarvis_v0.1').sort());
  });
});

describe('verifyKey', () => {
  const spec = KEYS[0]!;
  const respond = (status: number, body = '') =>
    vi.fn(async () => new Response(body, { status })) as unknown as typeof fetch;

  it('checks an OpenAI key by minting a Realtime secret, which restricted keys can do', async () => {
    const fetchMock = respond(200, '{"value":"ek_x"}');
    expect(await verifyKey(spec, 'k', fetchMock)).toEqual({ result: 'ok' });
    const [url, init] = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe('https://api.openai.com/v1/realtime/client_secrets');
    expect((init as RequestInit).method).toBe('POST');
  });

  it('tells a wrong key from a key missing a permission, and from no answer', async () => {
    const wrong = respond(401, '{"error":{"message":"Incorrect API key provided: sk-…abcd"}}');
    expect(await verifyKey(spec, 'k', wrong)).toEqual({
      result: 'rejected',
      detail: 'Incorrect API key provided: sk-…abcd',
    });
    expect((await verifyKey(spec, 'k', respond(403))).result).toBe('forbidden');
    expect((await verifyKey(spec, 'k', respond(429))).result).toBe('unreachable');
    const down = vi.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    expect((await verifyKey(spec, 'k', down)).result).toBe('unreachable');
  });
});

describe('cleanKey', () => {
  it('strips paste markers, spaces and newlines', () => {
    expect(cleanKey('\x1b[200~sk-proj-abc123\x1b[201~\n')).toBe('sk-proj-abc123');
    expect(cleanKey('  sk-ant-xyz ')).toBe('sk-ant-xyz');
  });
});

describe('resolveHome', () => {
  it('prefers the flag, then EOS_HOME, then ~/.ephemeralos', () => {
    expect(resolveHome('/a', { EOS_HOME: '/b' })).toBe('/a');
    expect(resolveHome(undefined, { EOS_HOME: '/b' })).toBe('/b');
    expect(resolveHome(undefined, {})).toMatch(/\.ephemeralos$/);
  });
});
