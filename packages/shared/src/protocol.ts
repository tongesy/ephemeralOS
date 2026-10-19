import { z } from 'zod';

/** Bumped whenever the browser ⇄ gateway wire format changes incompatibly. */
export const PROTOCOL_VERSION = 1;

/** Path the gateway serves its WebSocket on. */
export const WS_PATH = '/ws';

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

export const ClientMessage = z.discriminatedUnion('type', [ClientHello, ClientPing]);
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

export const ServerMessage = z.discriminatedUnion('type', [ServerWelcome, ServerPong, ServerError]);
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
