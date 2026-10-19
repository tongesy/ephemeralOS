import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Config } from '@ephemeralos/shared';

/** Keys from `<home>/.env`. Held only in the gateway process; never logged or sent. */
export interface Secrets {
  openaiApiKey?: string;
  anthropicApiKey?: string;
}

/** The persona and memory files, as Markdown. Missing files read as empty. */
export interface Persona {
  soul: string;
  user: string;
  memory: string;
}

export interface Home {
  dir: string;
  config: Config;
  secrets: Secrets;
  persona: Persona;
  modelsDir: string;
  transcriptsDir: string;
}

/** Parse a `.env` file: `KEY=value` lines, `#` comments, optional quotes. No expansion. */
export function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line
      .slice(0, eq)
      .replace(/^export\s+/, '')
      .trim();
    let value = line.slice(eq + 1).trim();
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
    out[key] = value;
  }
  return out;
}

async function readOptional(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return '';
  }
}

/**
 * Read the home folder. Called per voice session rather than once at boot, so edits
 * to the persona, memory or settings apply to the next conversation without a restart.
 */
export async function loadHome(dir: string): Promise<Home> {
  const [envText, configText, soul, user, memory] = await Promise.all([
    readOptional(join(dir, '.env')),
    readOptional(join(dir, 'config.json')),
    readOptional(join(dir, 'SOUL.md')),
    readOptional(join(dir, 'USER.md')),
    readOptional(join(dir, 'MEMORY.md')),
  ]);

  let config: Config;
  try {
    config = Config.parse(configText ? JSON.parse(configText) : {});
  } catch (error) {
    console.warn(`[home] ${join(dir, 'config.json')} is invalid; using defaults.`, error);
    config = Config.parse({});
  }

  const env = parseEnv(envText);
  return {
    dir,
    config,
    secrets: {
      openaiApiKey: env.OPENAI_API_KEY || undefined,
      anthropicApiKey: env.ANTHROPIC_API_KEY || undefined,
    },
    persona: { soul, user, memory },
    modelsDir: join(dir, 'models'),
    transcriptsDir: join(dir, 'transcripts'),
  };
}
