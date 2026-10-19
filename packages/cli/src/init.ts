import { chmod, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Config } from '@ephemeralos/shared';
import { parseEnv } from '@ephemeralos/gateway';
import { formatEnv } from './env-file.ts';
import { KEYS, verifyKey } from './keys.ts';
import { MODELS_LICENCE, downloadModels } from './models.ts';
import { TEMPLATES_DIR } from './paths.ts';
import { ask, askSecret, confirm } from './prompt.ts';
import { copyTemplates } from './templates.ts';

/** OpenAI's Realtime voices; marin and cedar are the ones it recommends. */
const VOICES = [
  'marin',
  'cedar',
  'alloy',
  'ash',
  'ballad',
  'coral',
  'echo',
  'sage',
  'shimmer',
  'verse',
];

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;

async function readText(path: string): Promise<string> {
  return readFile(path, 'utf8').catch(() => '');
}

/**
 * Set up the home folder. Safe to re-run: existing files are kept, and each key
 * already present can be kept or replaced. Keys are typed here, in the terminal,
 * and never spoken or pasted into the orb.
 */
export async function init(options: { homeDir: string; models: boolean }): Promise<void> {
  const { homeDir } = options;
  console.log(`\n${bold('ephemeralOS setup')}  ${dim(homeDir)}\n`);

  const created = await copyTemplates(TEMPLATES_DIR, homeDir);
  await chmod(homeDir, 0o700);
  for (const file of created) console.log(`  + ${file}`);
  if (created.length) console.log('');

  const envPath = join(homeDir, '.env');
  const existing = parseEnv(await readText(envPath));
  const values: Record<string, string | undefined> = { ...existing };

  for (const spec of KEYS) {
    console.log(`${bold(spec.label)} key, for ${spec.why}. ${dim(spec.where)}`);
    if (existing[spec.env] && (await confirm('  A key is already saved. Keep it?'))) {
      console.log('');
      continue;
    }
    for (;;) {
      const key = await askSecret(`  Paste key${spec.required ? '' : ' (Enter to skip)'}: `);
      if (!key) {
        if (spec.required) {
          console.log(dim('  Voice needs this key. You can add it later by running init again.'));
        }
        break;
      }
      const verdict = await verifyKey(spec, key);
      if (verdict === 'rejected') {
        console.log(`  ${spec.label} rejected that key. Try again, or press Enter to skip.`);
        continue;
      }
      console.log(
        verdict === 'ok'
          ? '  ✓ Key works.'
          : dim(`  Couldn't reach ${spec.label} to check it; saved anyway.`),
      );
      values[spec.env] = key;
      break;
    }
    console.log('');
  }

  await writeFile(envPath, formatEnv(values), { mode: 0o600 });
  await chmod(envPath, 0o600);
  console.log(`  ✓ Keys saved to ${envPath} ${dim('(readable only by you)')}\n`);

  const configPath = join(homeDir, 'config.json');
  const configText = await readText(configPath);
  const stored = (configText ? JSON.parse(configText) : {}) as Record<string, unknown>;
  const current = Config.parse(stored);
  console.log(bold('Persona'));
  const name = (await ask(`  What should it be called? [${current.name}] `)) || current.name;
  const voice =
    (await ask(`  Voice (${VOICES.join(', ')}) [${current.voice}] `)).toLowerCase() ||
    current.voice;
  const config = Config.parse({ ...stored, name, voice });
  await writeFile(configPath, `${JSON.stringify({ ...stored, name, voice }, null, 2)}\n`);
  console.log('');
  if (options.models) {
    console.log(`${bold('Wake word')}: "${config.wakeWord.phrase}"\n${dim(MODELS_LICENCE)}`);
    if (await confirm('  Download the models now (about 5 MB)?')) {
      await downloadModels(join(homeDir, 'models'), config.wakeWord.model, (l) => console.log(l));
    } else {
      console.log(
        dim('  Skipped. Without them, click the orb to talk instead of saying the wake word.'),
      );
    }
    console.log('');
  }

  console.log(`Done. Run ${bold('pnpm ephemeralos start')} and open the address it prints.\n`);
}
