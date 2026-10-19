import {
  GatewayStatus,
  PROTOCOL_VERSION,
  RealtimeSession,
  ServerMessage,
  TOKEN_HEADER,
  TOKEN_META_NAME,
  WS_PATH,
  parseMessage,
  type ClientMessage,
} from '@ephemeralos/shared';

export type ConnectionStatus = 'connecting' | 'open' | 'closed';

/** An API call the gateway refused, with its explanation. */
export class GatewayError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * The browser's only link to the local gateway. Reconnects with backoff, because the
 * gateway may restart under the page (e.g. `tsx watch` in dev).
 */
export class GatewayClient {
  private ws: WebSocket | null = null;
  private retryMs = 500;
  private readonly listeners = new Set<(msg: ServerMessage) => void>();
  private readonly pendingTools = new Map<string, (output: string) => void>();
  status: ConnectionStatus = 'closed';

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
      const msg = parsed.value;
      if (msg.type === 'tool.result') {
        this.pendingTools.get(msg.callId)?.(msg.output);
        this.pendingTools.delete(msg.callId);
      }
      for (const listener of this.listeners) listener(msg);
    });
    ws.addEventListener('close', () => {
      this.status = 'closed';
      this.ws = null;
      // Calls in flight are lost with the socket; answer them so the model isn't left waiting.
      for (const resolve of this.pendingTools.values()) {
        resolve(JSON.stringify({ error: 'The gateway restarted; try again.' }));
      }
      this.pendingTools.clear();
      setTimeout(() => this.connect(), this.retryMs);
      this.retryMs = Math.min(this.retryMs * 2, 10_000);
    });
  }

  send(msg: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  /** Ask the gateway to run a tool for the voice session; resolves with its JSON output. */
  callTool(callId: string, name: string, args: string): Promise<string> {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      return Promise.resolve(JSON.stringify({ error: 'The gateway is not connected.' }));
    }
    return new Promise((resolve) => {
      this.pendingTools.set(callId, resolve);
      this.send({ type: 'tool.call', callId, name, arguments: args });
    });
  }

  /** What the gateway has set up: voice key, wake-word models, session settings. */
  async fetchStatus(): Promise<GatewayStatus> {
    return GatewayStatus.parse(await this.api('/api/status'));
  }

  /** Mint a short-lived Realtime client secret. The API key itself stays in the gateway. */
  async realtimeSession(): Promise<RealtimeSession> {
    return RealtimeSession.parse(await this.api('/api/realtime/session', { method: 'POST' }));
  }

  private async api(path: string, init: RequestInit = {}): Promise<unknown> {
    const res = await fetch(path, { ...init, headers: { [TOKEN_HEADER]: this.token } });
    const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    if (!res.ok) {
      throw new GatewayError(body.error ?? 'error', body.message ?? res.statusText, res.status);
    }
    return body;
  }

  onMessage(listener: (msg: ServerMessage) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
