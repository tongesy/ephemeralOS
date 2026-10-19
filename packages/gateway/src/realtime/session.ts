import { createHash } from 'node:crypto';
import {
  DISPLAY_TOOL_DESCRIPTION,
  DisplayArgs,
  SCREEN_TOOL_DESCRIPTION,
  ScreenArgs,
  toolParameters,
  type Config,
} from '@ephemeralos/shared';

const CLIENT_SECRETS_URL = 'https://api.openai.com/v1/realtime/client_secrets';

/** A function the voice model may call, in Realtime's tool format. */
export interface RealtimeFunction {
  type: 'function';
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** Tools the browser handles itself, without a round trip to the gateway. */
export const CLIENT_TOOLS: RealtimeFunction[] = [
  {
    type: 'function',
    name: 'display',
    description: DISPLAY_TOOL_DESCRIPTION,
    parameters: toolParameters(DisplayArgs),
  },
  {
    type: 'function',
    name: 'screen',
    description: SCREEN_TOOL_DESCRIPTION,
    parameters: toolParameters(ScreenArgs),
  },
  {
    type: 'function',
    name: 'end_session',
    description:
      'End the voice session and go back to sleep. Call after a short goodbye when the user is done.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
];

/** The Realtime session the browser will join. */
export function sessionConfig(
  config: Config,
  instructions: string,
  tools: RealtimeFunction[],
): Record<string, unknown> {
  return {
    type: 'realtime',
    model: config.realtimeModel,
    instructions,
    audio: {
      input: {
        noise_reduction: { type: 'far_field' },
        transcription: { model: 'gpt-4o-mini-transcribe' },
        // Barge-in: the user can interrupt; over WebRTC the server truncates unplayed audio.
        turn_detection: { type: 'semantic_vad', create_response: true, interrupt_response: true },
      },
      output: { voice: config.voice },
    },
    tools: [...CLIENT_TOOLS, ...tools],
    tool_choice: 'auto',
  };
}

export class RealtimeError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * Mint a short-lived client secret for one session. The real API key stays here; the
 * browser only ever sees the `ek_…` secret, which expires a minute after minting (it is
 * needed only to connect; the session itself then runs for up to 60 minutes).
 */
export async function mintClientSecret(options: {
  apiKey: string;
  session: Record<string, unknown>;
  /** Stable, anonymous id for this install, sent as OpenAI's safety identifier. */
  installId: string;
  fetch?: typeof fetch;
}): Promise<{ value: string; expiresAt: number }> {
  const doFetch = options.fetch ?? fetch;
  const response = await doFetch(CLIENT_SECRETS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      'Content-Type': 'application/json',
      'OpenAI-Safety-Identifier': createHash('sha256').update(options.installId).digest('hex'),
    },
    body: JSON.stringify({
      expires_after: { anchor: 'created_at', seconds: 60 },
      session: options.session,
    }),
  });
  if (!response.ok) {
    // OpenAI's error body names the problem (bad key, unknown model) without echoing the key.
    const detail = await response.text().catch(() => '');
    throw new RealtimeError(
      `OpenAI refused the session (${response.status}): ${detail.slice(0, 500)}`,
      response.status,
    );
  }
  const body = (await response.json()) as { value?: unknown; expires_at?: unknown };
  if (typeof body.value !== 'string' || typeof body.expires_at !== 'number') {
    throw new RealtimeError('OpenAI returned an unexpected client secret response', 502);
  }
  return { value: body.value, expiresAt: body.expires_at };
}
