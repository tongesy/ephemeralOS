import { timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  ClientMessage,
  PROTOCOL_VERSION,
  WS_PATH,
  parseMessage,
  type ServerMessage,
} from '@ephemeralos/shared';
import type { GatewayConfig } from './config.ts';
import { serveStatic } from './static.ts';

export type GatewayOptions = GatewayConfig;

export interface Gateway {
  port: number;
  close(): Promise<void>;
}

const GATEWAY_VERSION = '0.0.0';

function tokensMatch(given: string | null, expected: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function send(ws: WebSocket, msg: ServerMessage): void {
  ws.send(JSON.stringify(msg));
}

export async function startGateway(config: GatewayOptions): Promise<Gateway> {
  const webRoot = config.webRoot ? resolve(config.webRoot) : null;

  const server = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"ok":true}');
      return;
    }
    if (webRoot && (req.method === 'GET' || req.method === 'HEAD')) {
      void serveStatic(webRoot, req.url ?? '/', config.token, res);
      return;
    }
    res.writeHead(404).end();
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: 1 << 20 });

  const allowedOrigins = (port: number): Set<string> =>
    new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`, ...config.extraOrigins]);

  server.on('upgrade', (req: IncomingMessage, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const port = (server.address() as AddressInfo).port;
    const originOk = allowedOrigins(port).has(req.headers.origin ?? '');
    const tokenOk = tokensMatch(url.searchParams.get('token'), config.token);
    if (url.pathname !== WS_PATH || !originOk || !tokenOk) {
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
      }
    });
  });

  await new Promise<void>((done, fail) => {
    server.once('error', fail);
    server.listen(config.port, config.host, done);
  });

  return {
    port: (server.address() as AddressInfo).port,
    close: () =>
      new Promise((done) => {
        for (const client of wss.clients) client.terminate();
        wss.close();
        server.close(() => done());
      }),
  };
}
