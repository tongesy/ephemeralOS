import { access, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { loadConfig, startGateway } from '@ephemeralos/gateway';
import { WEB_DIST_DIR } from './paths.ts';

/** Start the gateway serving the production build. */
export async function start(options: { homeDir: string }): Promise<void> {
  try {
    await access(join(WEB_DIST_DIR, 'index.html'));
  } catch {
    throw new Error('The web client is not built yet. Run `pnpm build` first.');
  }

  const envPath = join(options.homeDir, '.env');
  const mode = await stat(envPath).then(
    (s) => s.mode & 0o777,
    () => null,
  );
  if (mode === null) {
    console.warn('No keys found. Run `pnpm ephemeralos init` to set up voice.');
  } else if (mode & 0o077) {
    console.warn(`${envPath} is readable by other users. Fix it with: chmod 600 ${envPath}`);
  }

  const config = {
    ...loadConfig({ ...process.env, NODE_ENV: 'production' }),
    homeDir: options.homeDir,
    webRoot: WEB_DIST_DIR,
  };
  const gateway = await startGateway(config);
  console.log(`ephemeralOS is running. Open http://localhost:${gateway.port} in Chrome.`);

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => void gateway.close().then(() => process.exit(0)));
  }
}
