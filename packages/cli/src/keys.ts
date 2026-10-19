import { Config } from '@ephemeralos/shared';

/** The keys `init` asks for, and how to check each one works. */
export interface KeySpec {
  env: 'OPENAI_API_KEY' | 'ANTHROPIC_API_KEY';
  label: string;
  why: string;
  where: string;
  required: boolean;
  /** Check the key the way ephemeralOS will use it, so a restricted key passes if it can. */
  check(key: string, doFetch: typeof fetch): Promise<Response>;
}

export const KEYS: KeySpec[] = [
  {
    env: 'OPENAI_API_KEY',
    label: 'OpenAI',
    why: 'the voice (Realtime speech in and out)',
    where: 'https://platform.openai.com/api-keys',
    required: true,
    // Minting a Realtime client secret is exactly what the gateway does with this key,
    // and it costs nothing. (Listing models would wrongly fail restricted keys.)
    check: (key, doFetch) =>
      doFetch('https://api.openai.com/v1/realtime/client_secrets', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expires_after: { anchor: 'created_at', seconds: 10 },
          session: { type: 'realtime', model: Config.parse({}).realtimeModel },
        }),
      }),
  },
  {
    env: 'ANTHROPIC_API_KEY',
    label: 'Anthropic',
    why: 'the brain (research and multi-step work, from M4)',
    where: 'https://console.anthropic.com/settings/keys',
    required: false,
    check: (key, doFetch) =>
      doFetch('https://api.anthropic.com/v1/models', {
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      }),
  },
];

export type KeyVerdict =
  /** The key works for what ephemeralOS needs. */
  | { result: 'ok' }
  /** The provider doesn't recognise the key. */
  | { result: 'rejected'; detail: string }
  /** The key is real but its permissions don't cover what we checked. */
  | { result: 'forbidden'; detail: string }
  /** Couldn't tell: offline, rate-limited, or the provider is down. */
  | { result: 'unreachable'; detail: string };

/**
 * Tidy a pasted key: terminals can wrap a paste in bracketed-paste markers, and
 * copying from a web page can add spaces or a trailing newline.
 */
export function cleanKey(raw: string): string {
  // eslint-disable-next-line no-control-regex -- matching the ESC that starts the marker
  return raw.replace(/\x1b\[20[01]~/g, '').replace(/[^\x21-\x7e]/g, '');
}

/** The provider's own error message; both mask keys in them. */
async function errorDetail(res: Response): Promise<string> {
  const text = await res.text().catch(() => '');
  try {
    const message = (JSON.parse(text) as { error?: { message?: string } }).error?.message;
    if (message) return message;
  } catch {
    // Not JSON; fall through.
  }
  return `HTTP ${res.status}`;
}

/** Check a key against its provider. The key itself is never part of the result. */
export async function verifyKey(
  spec: KeySpec,
  key: string,
  doFetch: typeof fetch = fetch,
): Promise<KeyVerdict> {
  let res: Response;
  try {
    res = await spec.check(key, doFetch);
  } catch (error) {
    return { result: 'unreachable', detail: error instanceof Error ? error.message : 'offline' };
  }
  if (res.ok) return { result: 'ok' };
  const detail = await errorDetail(res);
  if (res.status === 401) return { result: 'rejected', detail };
  if (res.status === 403) return { result: 'forbidden', detail };
  return { result: 'unreachable', detail };
}
