import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export interface GatewayConfig {
  host: '127.0.0.1';
  port: number;
  /** Per-launch token the browser must present on the WebSocket. */
  token: string;
  /** Origins allowed to open the WebSocket, besides the gateway's own. */
  extraOrigins: string[];
  /** Built web client to serve, or null when Vite serves it (dev). */
  webRoot: string | null;
}

const DEFAULT_PORT = 4317;

/**
 * Read gateway settings from the environment. Secrets (API keys) are not read here;
 * they arrive in M2 from `~/.ephemeralos/.env` and never leave the gateway.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): GatewayConfig {
  const port = env.EOS_PORT ? Number(env.EOS_PORT) : DEFAULT_PORT;
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`EOS_PORT must be a port number, got "${env.EOS_PORT}"`);
  }
  const isDev = env.NODE_ENV !== 'production';
  return {
    // Never configurable: the gateway is not to be exposed to the network.
    host: '127.0.0.1',
    port,
    token: env.EOS_TOKEN || randomBytes(32).toString('base64url'),
    extraOrigins: (env.EOS_ALLOWED_ORIGINS ?? '').split(',').filter(Boolean),
    webRoot: isDev
      ? null
      : (env.EOS_WEB_ROOT ?? fileURLToPath(new URL('../../web/dist', import.meta.url))),
  };
}
