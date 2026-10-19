import { isSleepPhrase, type OrbState } from '@ephemeralos/shared';
import type { RealtimeEvent, RealtimeHandlers, RealtimeLink } from './realtime-client.ts';

/** Spoken when the voice service can't be reached; the brief's wording. */
export const FALLBACK_LINE = "I can't reach my voice service right now.";

/** After a goodbye, wait this long for the voice to start before closing anyway. */
const GOODBYE_GRACE_MS = 4000;
/** How long the error state shows before the orb rests again. */
const ERROR_HOLD_MS = 3500;

export interface VoiceSessionDeps {
  setState(state: OrbState): void;
  /** Mint a client secret (gateway) and open the Realtime connection. */
  connect(handlers: RealtimeHandlers): Promise<RealtimeLink>;
  /** Run a gateway tool; resolves with its JSON output. */
  callTool(callId: string, name: string, args: string): Promise<string>;
  /** Run a tool that lives in the page (display, screen); null if `name` isn't one. */
  localTool?(name: string, args: string): string | null;
  transcript(role: 'user' | 'assistant', text: string): void;
  /** Speak locally (speechSynthesis) when the voice service is unavailable. */
  speakFallback(text: string): void;
  /** Play and measure the voice's audio, or stop doing so (`null`). */
  audio(stream: MediaStream | null): void;
  /** The user started speaking (a new turn). */
  heard?(): void;
  /** The connection is open and hears the microphone (and what was said while it opened). */
  ready?(): void;
  /** The user paused: the connection can stop catching up and listen live. */
  caughtUp?(): void;
  /** The session ended, for whatever reason; the wake word can listen again. */
  ended(): void;
  settings: { silenceTimeoutSeconds: number; sleepPhrases: readonly string[] };
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
}

type Phase = 'idle' | 'connecting' | 'open' | 'error';

interface FunctionCallItem {
  type: 'function_call';
  name: string;
  call_id: string;
  arguments: string;
}

function functionCalls(event: RealtimeEvent): FunctionCallItem[] {
  const output = (event.response as { output?: unknown[] } | undefined)?.output ?? [];
  return output.filter(
    (item): item is FunctionCallItem =>
      typeof item === 'object' &&
      item !== null &&
      (item as { type?: unknown }).type === 'function_call',
  );
}

/**
 * One wake-to-sleep conversation: maps Realtime events to orb states, ends the
 * session on silence or a sleep phrase, relays tool calls, and falls back to a
 * local spoken apology when the voice service is down.
 */
export class VoiceSession {
  private phase: Phase = 'idle';
  private link: RealtimeLink | null = null;
  private speaking = false;
  private closing = false;
  /** Gateway tool calls still running. The session waits for them before it can idle out. */
  private pendingTools = 0;
  private silenceTimer: unknown = null;
  private goodbyeTimer: unknown = null;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;

  constructor(private readonly deps: VoiceSessionDeps) {
    this.setTimer = deps.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer =
      deps.clearTimeout ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  }

  get active(): boolean {
    return this.phase !== 'idle';
  }

  /** Wake: open a session. Ignored if one is already open. */
  async start(): Promise<void> {
    if (this.phase !== 'idle') return;
    this.phase = 'connecting';
    this.closing = false;
    this.speaking = false;
    this.pendingTools = 0;
    // What is said from now on is kept and heard once the connection opens, so the user can
    // talk straight away: the orb listens from the wake word on.
    this.deps.setState('listening');
    try {
      const link = await this.deps.connect({
        onEvent: (event) => this.handle(event),
        onAudio: (stream) => this.deps.audio(stream),
        onClose: (reason) => this.fail(reason),
      });
      if (this.phase !== 'connecting') {
        link.close();
        return;
      }
      this.link = link;
      this.phase = 'open';
      this.deps.ready?.();
      this.armSilence();
    } catch (error) {
      this.fail(error instanceof Error ? error.message : String(error));
    }
  }

  /** Close the session and go back to rest. */
  end(): void {
    if (this.phase === 'idle' || this.phase === 'error') return;
    this.teardown();
    this.deps.setState('zen');
    this.deps.ended();
  }

  private teardown(): void {
    this.clearTimer(this.silenceTimer);
    this.clearTimer(this.goodbyeTimer);
    this.silenceTimer = this.goodbyeTimer = null;
    this.link?.close();
    this.link = null;
    this.deps.audio(null);
    this.phase = 'idle';
  }

  private fail(reason: string): void {
    if (this.phase === 'idle' || this.phase === 'error') return;
    console.warn(`[voice] ${reason}`);
    this.teardown();
    this.phase = 'error';
    this.deps.setState('error');
    this.deps.speakFallback(FALLBACK_LINE);
    this.setTimer(() => {
      this.phase = 'idle';
      this.deps.setState('zen');
      this.deps.ended();
    }, ERROR_HOLD_MS);
  }

  private armSilence(): void {
    this.clearTimer(this.silenceTimer);
    this.silenceTimer = this.setTimer(
      () => this.end(),
      this.deps.settings.silenceTimeoutSeconds * 1000,
    );
  }

  private disarmSilence(): void {
    this.clearTimer(this.silenceTimer);
    this.silenceTimer = null;
  }

  /** Close once the goodbye has played; if it never starts, close after a grace period. */
  private windDown(): void {
    if (this.closing) return;
    this.closing = true;
    this.disarmSilence();
    this.goodbyeTimer = this.setTimer(() => {
      if (!this.speaking) this.end();
    }, GOODBYE_GRACE_MS);
  }

  private handle(event: RealtimeEvent): void {
    if (this.phase !== 'open') return;
    switch (event.type) {
      case 'input_audio_buffer.speech_started':
        // Also barge-in: the server cuts the reply short and truncates what wasn't heard.
        this.disarmSilence();
        this.deps.heard?.();
        this.deps.setState('listening');
        break;
      case 'input_audio_buffer.speech_stopped':
        this.deps.caughtUp?.();
        this.deps.setState('thinking');
        break;
      case 'output_audio_buffer.started':
        this.deps.caughtUp?.();
        this.speaking = true;
        this.disarmSilence();
        this.deps.setState('speaking');
        break;
      case 'output_audio_buffer.stopped':
      case 'output_audio_buffer.cleared':
        this.speaking = false;
        if (this.closing) {
          this.end();
          return;
        }
        // "Let me check" has finished but the tool hasn't: keep thinking, and don't let
        // the silence timer end the conversation before the answer is spoken.
        if (this.pendingTools > 0) {
          this.deps.setState('thinking');
          break;
        }
        this.deps.setState('listening');
        this.armSilence();
        break;
      case 'conversation.item.input_audio_transcription.completed': {
        const text = String(event.transcript ?? '').trim();
        if (!text) break;
        this.deps.transcript('user', text);
        if (isSleepPhrase(text, this.deps.settings.sleepPhrases)) this.windDown();
        break;
      }
      case 'response.output_audio_transcript.done': {
        const text = String(event.transcript ?? '').trim();
        if (text) this.deps.transcript('assistant', text);
        break;
      }
      case 'response.done':
        for (const call of functionCalls(event)) void this.runTool(call);
        break;
      case 'error':
        console.warn('[voice] Realtime error:', JSON.stringify(event.error));
        break;
    }
  }

  private async runTool(call: FunctionCallItem): Promise<void> {
    if (call.name === 'end_session') {
      this.reply(call.call_id, JSON.stringify({ ok: true }), false);
      this.windDown();
      return;
    }
    const local = this.deps.localTool?.(call.name, call.arguments);
    if (local != null) {
      this.reply(call.call_id, local, true);
      return;
    }
    this.deps.setState('thinking');
    this.disarmSilence();
    this.pendingTools++;
    console.info(`[voice] tool ${call.name} ${call.arguments}`);
    let output: string;
    try {
      output = await this.deps.callTool(call.call_id, call.name, call.arguments);
    } finally {
      this.pendingTools--;
    }
    console.info(`[voice] tool ${call.name} → ${output.slice(0, 300)}`);
    if (this.phase !== 'open') return;
    this.reply(call.call_id, output, true);
    // The reply should start speaking at once; if it never does, idle out as usual.
    if (this.pendingTools === 0 && !this.speaking) this.armSilence();
  }

  private reply(callId: string, output: string, respond: boolean): void {
    this.link?.send({
      type: 'conversation.item.create',
      item: { type: 'function_call_output', call_id: callId, output },
    });
    if (respond) this.link?.send({ type: 'response.create' });
  }
}
