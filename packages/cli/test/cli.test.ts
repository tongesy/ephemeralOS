import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { parseEnv } from '@ephemeralos/gateway';
import { formatEnv } from '../src/env-file.ts';
import { KEYS, verifyKey } from '../src/keys.ts';
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
  it('tells a rejected key from an unreachable provider', async () => {
    const spec = KEYS[0]!;
    const status = (s: number) => vi.fn(async () => new Response('', { status: s }));
    expect(await verifyKey(spec, 'k', status(200) as unknown as typeof fetch)).toBe('ok');
    expect(await verifyKey(spec, 'k', status(401) as unknown as typeof fetch)).toBe('rejected');
    const down = vi.fn(async () => {
      throw new Error('offline');
    });
    expect(await verifyKey(spec, 'k', down as unknown as typeof fetch)).toBe('unreachable');
  });
});

describe('resolveHome', () => {
  it('prefers the flag, then EOS_HOME, then ~/.ephemeralos', () => {
    expect(resolveHome('/a', { EOS_HOME: '/b' })).toBe('/a');
    expect(resolveHome(undefined, { EOS_HOME: '/b' })).toBe('/b');
    expect(resolveHome(undefined, {})).toMatch(/\.ephemeralos$/);
  });
});
