/**
 * One OpenAI Realtime session over WebRTC. Audio flows both ways on the peer
 * connection; events (transcripts, turn boundaries, function calls) on the
 * `oai-events` data channel. Authenticates with a short-lived client secret only.
 */

const CALLS_URL = 'https://api.openai.com/v1/realtime/calls';
const CONNECT_TIMEOUT_MS = 10_000;
/** `?debug` in the address bar logs every Realtime event (except streaming deltas). */
const TRACE = new URLSearchParams(location.search).has('debug');

/** A server event. Only the fields the session reads are typed; see OpenAI's Realtime reference. */
export interface RealtimeEvent {
  type: string;
  [key: string]: unknown;
}

export interface RealtimeHandlers {
  onEvent(event: RealtimeEvent): void;
  /** The voice's audio; play it and measure it. */
  onAudio(stream: MediaStream): void;
  /** The connection dropped (not called after `close()`). */
  onClose(reason: string): void;
}

export interface RealtimeLink {
  send(event: Record<string, unknown>): void;
  close(): void;
}

export async function connectRealtime(
  clientSecret: string,
  microphone: MediaStreamTrack,
  handlers: RealtimeHandlers,
): Promise<RealtimeLink> {
  const pc = new RTCPeerConnection();
  const channel = pc.createDataChannel('oai-events');
  // A clone, so ending the session never stops the microphone the wake word listens on.
  const track = microphone.clone();
  let closed = false;

  const close = (): void => {
    if (closed) return;
    closed = true;
    channel.close();
    pc.close();
    track.stop();
  };
  const drop = (reason: string): void => {
    if (closed) return;
    close();
    handlers.onClose(reason);
  };

  pc.addTrack(track);
  pc.ontrack = (event) => {
    if (TRACE) console.info('[realtime] remote audio track', event.track.readyState);
    const stream = event.streams[0] ?? new MediaStream([event.track]);
    handlers.onAudio(stream);
  };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
      drop(`connection ${pc.connectionState}`);
    }
  };
  channel.onmessage = (message) => {
    try {
      const event = JSON.parse(String(message.data)) as RealtimeEvent;
      if (TRACE && !event.type.endsWith('.delta')) console.info('[realtime] ←', event.type, event);
      handlers.onEvent(event);
    } catch {
      console.warn('[realtime] ignoring a malformed event');
    }
  };
  channel.onclose = () => drop('event channel closed');

  try {
    await pc.setLocalDescription(await pc.createOffer());
    const response = await fetch(CALLS_URL, {
      method: 'POST',
      body: pc.localDescription!.sdp,
      headers: { Authorization: `Bearer ${clientSecret}`, 'Content-Type': 'application/sdp' },
    });
    if (!response.ok) {
      throw new Error(`OpenAI refused the call (${response.status}): ${await response.text()}`);
    }
    await pc.setRemoteDescription({ type: 'answer', sdp: await response.text() });
    await new Promise<void>((resolve, reject) => {
      if (channel.readyState === 'open') return resolve();
      const timer = setTimeout(() => reject(new Error('timed out connecting')), CONNECT_TIMEOUT_MS);
      channel.addEventListener('open', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  } catch (error) {
    close();
    throw error;
  }

  return {
    send(event) {
      if (TRACE) console.info('[realtime] →', event.type, event);
      if (channel.readyState === 'open') channel.send(JSON.stringify(event));
    },
    close,
  };
}
