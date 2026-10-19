import { describe, expect, it, vi } from 'vitest';
import type { OrbState } from '@ephemeralos/shared';
import type { RealtimeHandlers, RealtimeLink } from '../src/voice/realtime-client.ts';
import { FALLBACK_LINE, VoiceSession } from '../src/voice/voice-session.ts';

function harness(options: { connectFails?: boolean } = {}) {
  vi.useFakeTimers();
  const states: OrbState[] = [];
  const sent: Record<string, unknown>[] = [];
  const transcripts: [string, string][] = [];
  const link: RealtimeLink = { send: (e) => sent.push(e), close: vi.fn() };
  let handlers!: RealtimeHandlers;
  const deps = {
    settings: { silenceTimeoutSeconds: 10, sleepPhrases: ["that's all"] },
    setState: (s: OrbState) => states.push(s),
    connect: vi.fn(async (h: RealtimeHandlers) => {
      handlers = h;
      if (options.connectFails) throw new Error('offline');
      return link;
    }),
    callTool: vi.fn(async () => '{"answer":42}'),
    transcript: (role: string, text: string) => transcripts.push([role, text]),
    speakFallback: vi.fn(),
    audio: vi.fn(),
    ready: vi.fn(),
    heard: vi.fn(),
    caughtUp: vi.fn(),
    ended: vi.fn(),
  };
  const session = new VoiceSession(deps);
  const emit = (type: string, extra: Record<string, unknown> = {}) =>
    handlers.onEvent({ type, ...extra });
  return { session, deps, link, states, sent, transcripts, emit, last: () => states.at(-1) };
}

describe('VoiceSession', () => {
  it('maps turn events to orb states', async () => {
    const h = harness();
    await h.session.start();
    expect(h.states).toEqual(['listening']);
    expect(h.deps.ready).toHaveBeenCalledTimes(1);
    h.emit('input_audio_buffer.speech_started');
    expect(h.deps.heard).toHaveBeenCalledTimes(1);
    h.emit('input_audio_buffer.speech_stopped');
    expect(h.last()).toBe('thinking');
    // A pause means the backlog from before the connection opened has been heard.
    expect(h.deps.caughtUp).toHaveBeenCalledTimes(1);
    h.emit('output_audio_buffer.started');
    expect(h.last()).toBe('speaking');
    h.emit('output_audio_buffer.stopped');
    expect(h.last()).toBe('listening');
  });

  it('goes back to sleep after the silence timeout, but not while someone talks', async () => {
    const h = harness();
    await h.session.start();
    h.emit('input_audio_buffer.speech_started');
    vi.advanceTimersByTime(30_000);
    expect(h.session.active).toBe(true);
    h.emit('output_audio_buffer.started');
    h.emit('output_audio_buffer.stopped');
    vi.advanceTimersByTime(9_999);
    expect(h.session.active).toBe(true);
    vi.advanceTimersByTime(1);
    expect(h.session.active).toBe(false);
    expect(h.last()).toBe('zen');
    expect(h.link.close).toHaveBeenCalled();
    expect(h.deps.ended).toHaveBeenCalled();
  });

  it('records transcripts and ends after the goodbye when a sleep phrase is said', async () => {
    const h = harness();
    await h.session.start();
    h.emit('conversation.item.input_audio_transcription.completed', {
      transcript: "Thanks, that's all.",
    });
    expect(h.transcripts).toEqual([['user', "Thanks, that's all."]]);
    h.emit('output_audio_buffer.started');
    expect(h.session.active).toBe(true);
    h.emit('response.output_audio_transcript.done', { transcript: 'Bye!' });
    h.emit('output_audio_buffer.stopped');
    expect(h.session.active).toBe(false);
    expect(h.transcripts.at(-1)).toEqual(['assistant', 'Bye!']);
  });

  it('closes on end_session, even if no goodbye is spoken', async () => {
    const h = harness();
    await h.session.start();
    h.emit('response.done', {
      response: {
        output: [{ type: 'function_call', name: 'end_session', call_id: 'e1', arguments: '{}' }],
      },
    });
    await vi.waitFor(() => expect(h.sent).toHaveLength(1));
    expect(h.sent[0]).toMatchObject({ item: { type: 'function_call_output', call_id: 'e1' } });
    vi.advanceTimersByTime(4000);
    expect(h.session.active).toBe(false);
  });

  it('relays other tool calls to the gateway and asks for a response', async () => {
    const h = harness();
    await h.session.start();
    h.emit('response.done', {
      response: {
        output: [{ type: 'function_call', name: 'lookup', call_id: 'c1', arguments: '{"q":1}' }],
      },
    });
    await vi.waitFor(() => expect(h.sent).toHaveLength(2));
    expect(h.deps.callTool).toHaveBeenCalledWith('c1', 'lookup', '{"q":1}');
    expect(h.sent[0]).toMatchObject({ item: { call_id: 'c1', output: '{"answer":42}' } });
    expect(h.sent[1]).toEqual({ type: 'response.create' });
  });

  it('waits for a slow tool and speaks its answer instead of idling out', async () => {
    const h = harness();
    let finish!: (output: string) => void;
    h.deps.callTool.mockImplementationOnce(() => new Promise<string>((done) => (finish = done)));
    await h.session.start();
    // "Let me check", then the search call, then the spoken part finishes.
    h.emit('output_audio_buffer.started');
    h.emit('response.done', {
      response: {
        output: [{ type: 'function_call', name: 'search', call_id: 'c1', arguments: '{}' }],
      },
    });
    h.emit('output_audio_buffer.stopped');
    expect(h.last()).toBe('thinking');

    vi.advanceTimersByTime(30_000);
    expect(h.deps.ended).not.toHaveBeenCalled();

    finish('{"answer":"news"}');
    await vi.waitFor(() => expect(h.sent).toHaveLength(2));
    expect(h.sent[1]).toEqual({ type: 'response.create' });

    h.emit('output_audio_buffer.started');
    h.emit('output_audio_buffer.stopped');
    expect(h.last()).toBe('listening');
    vi.advanceTimersByTime(10_000);
    expect(h.deps.ended).toHaveBeenCalled();
  });

  it('shows the error state and apologises out loud when voice is unreachable', async () => {
    const h = harness({ connectFails: true });
    await h.session.start();
    expect(h.last()).toBe('error');
    expect(h.deps.speakFallback).toHaveBeenCalledWith(FALLBACK_LINE);
    vi.advanceTimersByTime(3500);
    expect(h.last()).toBe('zen');
    expect(h.deps.ended).toHaveBeenCalled();
  });

  it('treats a dropped connection as an error', async () => {
    const h = harness();
    await h.session.start();
    // The link reports the drop through the handlers it was given.
    const handlers = h.deps.connect.mock.calls[0]![0];
    handlers.onClose('connection failed');
    expect(h.last()).toBe('error');
  });
});
