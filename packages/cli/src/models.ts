import { mkdir, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { WAKE_WORD_FEATURE_MODELS } from '@ephemeralos/shared';

const RELEASE = 'https://github.com/dscripka/openWakeWord/releases/download/v0.5.1';

export const MODELS_LICENCE = `The wake-word models come from openWakeWord (github.com/dscripka/openWakeWord).
The code is Apache-2.0, but the pretrained models are CC BY-NC-SA 4.0: free for personal,
non-commercial use. They are downloaded to your machine, not bundled with ephemeralOS.`;

/** Files `init` fetches for a given wake-word model. */
export function modelFiles(wakeWordModel: string): string[] {
  return [...WAKE_WORD_FEATURE_MODELS, `${wakeWordModel}.onnx`];
}

async function present(path: string): Promise<boolean> {
  return stat(path).then(
    (s) => s.size > 0,
    () => false,
  );
}

/** Download any missing model files. Writes to a temp name first, so a cut-off download never looks complete. */
export async function downloadModels(
  modelsDir: string,
  wakeWordModel: string,
  log: (line: string) => void,
  doFetch: typeof fetch = fetch,
): Promise<void> {
  await mkdir(modelsDir, { recursive: true });
  for (const file of modelFiles(wakeWordModel)) {
    const target = join(modelsDir, file);
    if (await present(target)) {
      log(`  ✓ ${file} (already here)`);
      continue;
    }
    const response = await doFetch(`${RELEASE}/${file}`);
    if (!response.ok) throw new Error(`Could not download ${file} (HTTP ${response.status}).`);
    const body = Buffer.from(await response.arrayBuffer());
    await writeFile(`${target}.part`, body);
    await rename(`${target}.part`, target);
    log(`  ✓ ${file} (${(body.length / 1024 / 1024).toFixed(1)} MB)`);
  }
}
