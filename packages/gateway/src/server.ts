import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join, resolve } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  ClientMessage,
  MODELS_PATH,
  PROTOCOL_VERSION,
  TOKEN_HEADER,
  WS_PATH,
  parseMessage,
  type ServerMessage,
} from '@ephemeralos/shared';
import { handleApi, serveModel } from './api.ts';
import type { GatewayConfig } from './config.ts';
import { allowedHosts, sendJson, tokensMatch } from './http.ts';
import { serveStatic } from './static.ts';
import { defaultTools } from './tools/index.ts';
import type { ToolRegistry } from './tools/registry.ts';
import { appendTranscript } from './transcripts.ts';

export interface GatewayOptions extends GatewayConfig {
  /** Tools the voice session may call through the gateway. Defaults to `defaultTools`. */
  tools?: ToolRegistry;
  /** Injected in tests; defaults to the global fetch. */
  fetch?: typeof fetch;
}

export interface Gateway {
  port: number;
  close(): Promise<void>;
}

const GATEWAY_VERSION = '0.0.0';

function send(ws: WebSocket, msg: ServerMessage): void {
  ws.send(JSON.stringify(msg));
}

export async function startGateway(config: GatewayOptions): Promise<Gateway> {
  const webRoot = config.webRoot ? resolve(config.webRoot) : null;
  const tools = config.tools ?? defaultTools({ homeDir: config.homeDir, fetch: config.fetch });
  const api = { homeDir: config.homeDir, tools, fetch: config.fetch };

  const port = (): number => (server.address() as AddressInfo).port;
  const origins = (): Set<string> =>
    new Set([`http://127.0.0.1:${port()}`, `http://localhost:${port()}`, ...config.extraOrigins]);
  const hostOk = (req: IncomingMessage): boolean =>
    allowedHosts(port(), config.extraOrigins).has(req.headers.host ?? '');
  // Same-origin GETs may omit Origin; anything that sends one must be ours.
  const originOk = (req: IncomingMessage, required: boolean): boolean =>
    req.headers.origin === undefined ? !required : origins().has(req.headers.origin);

  const server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;

    if (req.method === 'GET' && path === '/healthz') {
      sendJson(res, 200, { ok: true });
      return;
    }
    if (!hostOk(req)) {
      res.writeHead(421).end();
      return;
    }
    if (path.startsWith('/api/')) {
      const header = req.headers[TOKEN_HEADER];
      const token = Array.isArray(header) ? header[0] : header;
      if (!originOk(req, req.method !== 'GET') || !tokensMatch(token, config.token)) {
        sendJson(res, 403, { error: 'forbidden' });
        return;
      }
      handleApi(api, req, res, path).catch((error: unknown) => {
        console.error('[api]', error);
        if (!res.headersSent) sendJson(res, 500, { error: 'internal' });
      });
      return;
    }
    if (req.method === 'GET' && path.startsWith(MODELS_PATH)) {
      void serveModel(config.homeDir, path, res);
      return;
    }
    if (webRoot && (req.method === 'GET' || req.method === 'HEAD')) {
      void serveStatic(webRoot, req.url ?? '/', config.token, res);
      return;
    }
    res.writeHead(404).end();
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: 1 << 20 });

  server.on('upgrade', (req: IncomingMessage, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const ok =
      url.pathname === WS_PATH &&
      hostOk(req) &&
      originOk(req, true) &&
      tokensMatch(url.searchParams.get('token'), config.token);
    if (!ok) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  wss.on('connection', (ws) => {
    ws.on('message', (data) => {
      const parsed = parseMessage(ClientMessage, data.toString());
      if (!parsed.ok) {
        send(ws, { type: 'error', code: 'bad_message', message: parsed.error });
        return;
      }
      const msg = parsed.value;
      switch (msg.type) {
        case 'hello':
          if (msg.protocol !== PROTOCOL_VERSION) {
            send(ws, {
              type: 'error',
              code: 'protocol_mismatch',
              message: `gateway speaks protocol ${PROTOCOL_VERSION}`,
            });
            ws.close();
            return;
          }
          send(ws, { type: 'welcome', protocol: PROTOCOL_VERSION, gateway: GATEWAY_VERSION });
          return;
        case 'ping':
          send(ws, { type: 'pong', t: msg.t });
          return;
        case 'transcript':
          appendTranscript(join(config.homeDir, 'transcripts'), {
            sessionId: msg.sessionId,
            role: msg.role,
            text: msg.text,
          }).catch((error: unknown) => console.warn('[transcripts] could not write', error));
          return;
        case 'tool.call':
          void tools
            .call(msg.name, msg.arguments, {
              display: (args) => {
                if (ws.readyState === ws.OPEN) send(ws, { type: 'display', args });
              },
            })
            .then((output) => {
              if (ws.readyState === ws.OPEN) {
                send(ws, { type: 'tool.result', callId: msg.callId, output });
              }
            });
          return;
      }
    });
  });

  await new Promise<void>((done, fail) => {
    server.once('error', fail);
    server.listen(config.port, config.host, done);
  });

  return {
    port: port(),
    close: () =>
      new Promise((done) => {
        for (const client of wss.clients) client.terminate();
        wss.close();
        server.close(() => done());
      }),
  };
}
