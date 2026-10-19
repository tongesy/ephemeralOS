import { access, readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import {
  MODELS_PATH,
  WAKE_WORD_FEATURE_MODELS,
  type GatewayStatus,
  type RealtimeSession,
} from '@ephemeralos/shared';
import { loadHome, type Home } from './home.ts';
import { sendJson } from './http.ts';
import { buildInstructions } from './realtime/instructions.ts';
import { RealtimeError, mintClientSecret, sessionConfig } from './realtime/session.ts';
import type { ToolRegistry } from './tools/registry.ts';

export interface ApiContext {
  homeDir: string;
  tools: ToolRegistry;
  /** Injected in tests; defaults to the global fetch. */
  fetch?: typeof fetch;
}

const MODEL_FILE = /^[\w.-]+\.onnx$/;

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

async function wakeWordInstalled(home: Home): Promise<boolean> {
  const files = [...WAKE_WORD_FEATURE_MODELS, `${home.config.wakeWord.model}.onnx`];
  const found = await Promise.all(files.map((f) => exists(join(home.modelsDir, f))));
  return found.every(Boolean);
}

export async function status(home: Home): Promise<GatewayStatus> {
  return {
    name: home.config.name,
    voice: Boolean(home.secrets.openaiApiKey),
    wakeWord: { available: await wakeWordInstalled(home), ...home.config.wakeWord },
    silenceTimeoutSeconds: home.config.silenceTimeoutSeconds,
    sleepPhrases: home.config.sleepPhrases,
  };
}

/**
 * Handle `/api/*`. The caller has already checked the host, origin and token.
 * Errors name the problem for the browser but never include a key.
 */
export async function handleApi(
  ctx: ApiContext,
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
): Promise<void> {
  const home = await loadHome(ctx.homeDir);

  if (req.method === 'GET' && path === '/api/status') {
    sendJson(res, 200, await status(home));
    return;
  }

  if (req.method === 'POST' && path === '/api/realtime/session') {
    const apiKey = home.secrets.openaiApiKey;
    if (!apiKey) {
      sendJson(res, 503, { error: 'no_openai_key', message: 'Run `ephemeralos init` to add one.' });
      return;
    }
    const session = sessionConfig(
      home.config,
      buildInstructions(home.config, home.persona),
      ctx.tools.definitions(),
    );
    try {
      const secret = await mintClientSecret({
        apiKey,
        session,
        installId: home.dir,
        fetch: ctx.fetch,
      });
      const body: RealtimeSession = {
        clientSecret: secret.value,
        expiresAt: secret.expiresAt,
        model: home.config.realtimeModel,
      };
      sendJson(res, 200, body);
    } catch (error) {
      const status = error instanceof RealtimeError ? error.status : 502;
      const message = error instanceof Error ? error.message : 'Could not reach OpenAI';
      console.warn(`[realtime] ${message}`);
      sendJson(res, status >= 500 ? 502 : status, { error: 'realtime_unavailable', message });
    }
    return;
  }

  sendJson(res, 404, { error: 'not_found' });
}

/** Serve a wake-word model from `<home>/models`. Models are public files, not secrets. */
export async function serveModel(homeDir: string, path: string, res: ServerResponse) {
  const name = decodeURIComponent(path.slice(MODELS_PATH.length));
  if (!MODEL_FILE.test(name)) {
    res.writeHead(404).end();
    return;
  }
  try {
    const body = await readFile(join(homeDir, 'models', name));
    res
      .writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
      })
      .end(body);
  } catch {
    res.writeHead(404).end();
  }
}
