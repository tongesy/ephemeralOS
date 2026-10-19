import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The repo's `home/` folder: starting persona, memory and settings for a new install. */
export const TEMPLATES_DIR = fileURLToPath(new URL('../../../home', import.meta.url));

/** The built web client the gateway serves in production. */
export const WEB_DIST_DIR = fileURLToPath(new URL('../../web/dist', import.meta.url));

export function resolveHome(flag?: string, env: NodeJS.ProcessEnv = process.env): string {
  if (flag) return resolve(flag);
  if (env.EOS_HOME) return resolve(env.EOS_HOME);
  return join(homedir(), '.ephemeralos');
}
