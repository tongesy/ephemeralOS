import { z } from 'zod';
import { MediaItem } from './media.ts';

/** Bumped whenever the browser ⇄ gateway wire format changes incompatibly. */
export const PROTOCOL_VERSION = 4;

/** Path the gateway serves its WebSocket on. */
export const WS_PATH = '/ws';

/** Header carrying the per-launch token on HTTP API calls. */
export const TOKEN_HEADER = 'x-eos-token';

/** Name of the `<meta>` tag the gateway injects the per-launch token into. */
export const TOKEN_META_NAME = 'eos-token';

export const ClientHello = z.object({
  type: z.literal('hello'),
  protocol: z.number().int(),
});

export const ClientPing = z.object({
  type: z.literal('ping'),
  t: z.number(),
});

/** A finished turn of conversation, for the local JSONL transcript. */
export const ClientTranscript = z.object({
  type: z.literal('transcript'),
  sessionId: z.string().max(200),
  role: z.enum(['user', 'assistant']),
  text: z.string().max(20_000),
});

/** A function call from the voice session, relayed for the gateway to run. */
export const ClientToolCall = z.object({
  type: z.literal('tool.call'),
  callId: z.string().max(200),
  name: z.string().max(100),
  /** JSON-encoded arguments, exactly as the model produced them. */
  arguments: z.string().max(100_000),
});

export const ClientMessage = z.discriminatedUnion('type', [
  ClientHello,
  ClientPing,
  ClientTranscript,
  ClientToolCall,
]);
export type ClientMessage = z.infer<typeof ClientMessage>;

export const ServerWelcome = z.object({
  type: z.literal('welcome'),
  protocol: z.number().int(),
  gateway: z.string(),
});

export const ServerPong = z.object({
  type: z.literal('pong'),
  t: z.number(),
});

export const ServerError = z.object({
  type: z.literal('error'),
  code: z.enum(['bad_message', 'protocol_mismatch']),
  message: z.string(),
});

/** The outcome of a relayed tool call; `output` goes back to the model as-is. */
export const ServerToolResult = z.object({
  type: z.literal('tool.result'),
  callId: z.string(),
  /** JSON-encoded result. */
  output: z.string(),
});

/**
 * Put something on screen from the gateway side. `args` are `display` tool arguments;
 * the page validates them with `parseDisplay` like any other display call.
 */
export const ServerDisplay = z.object({
  type: z.literal('display'),
  args: z.unknown(),
});

/** Start playing something the gateway found and checked (a podcast episode, a video). */
export const ServerMedia = z.object({
  type: z.literal('media'),
  item: MediaItem,
});

export const ServerMessage = z.discriminatedUnion('type', [
  ServerWelcome,
  ServerPong,
  ServerError,
  ServerToolResult,
  ServerDisplay,
  ServerMedia,
]);
export type ServerMessage = z.infer<typeof ServerMessage>;

/** Parse a raw WebSocket frame as JSON, then validate it. Never throws. */
export function parseMessage<T extends z.ZodType>(
  schema: T,
  raw: string,
): { ok: true; value: z.infer<T> } | { ok: false; error: string } {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'invalid JSON' };
  }
  const result = schema.safeParse(json);
  return result.success
    ? { ok: true, value: result.data }
    : { ok: false, error: result.error.issues.map((i) => i.message).join('; ') };
}
