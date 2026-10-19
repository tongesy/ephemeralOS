import {
  PROTOCOL_VERSION,
  ServerMessage,
  TOKEN_META_NAME,
  WS_PATH,
  parseMessage,
  type ClientMessage,
} from '@ephemeralos/shared';

export type GatewayStatus = 'connecting' | 'open' | 'closed';

/**
 * The browser's only link to the local gateway. Reconnects with backoff, because the
 * gateway may restart under the page (e.g. `tsx watch` in dev).
 */
export class GatewayClient {
  private ws: WebSocket | null = null;
  private retryMs = 500;
  private readonly listeners = new Set<(msg: ServerMessage) => void>();
  status: GatewayStatus = 'closed';

  constructor(private readonly token: string) {}

  static fromPage(): GatewayClient | null {
    const token = document
      .querySelector<HTMLMetaElement>(`meta[name="${TOKEN_META_NAME}"]`)
      ?.content.trim();
    return token ? new GatewayClient(token) : null;
  }

  connect(): void {
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${scheme}://${location.host}${WS_PATH}?token=${encodeURIComponent(this.token)}`;
    this.status = 'connecting';
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.addEventListener('open', () => {
      this.status = 'open';
      this.retryMs = 500;
      this.send({ type: 'hello', protocol: PROTOCOL_VERSION });
    });
    ws.addEventListener('message', (event) => {
      const parsed = parseMessage(ServerMessage, String(event.data));
      if (!parsed.ok) {
        console.warn('[gateway] ignoring malformed message:', parsed.error);
        return;
      }
      for (const listener of this.listeners) listener(parsed.value);
    });
    ws.addEventListener('close', () => {
      this.status = 'closed';
      this.ws = null;
      setTimeout(() => this.connect(), this.retryMs);
      this.retryMs = Math.min(this.retryMs * 2, 10_000);
    });
  }

  send(msg: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  onMessage(listener: (msg: ServerMessage) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
