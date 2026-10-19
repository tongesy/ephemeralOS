/** The keys `init` asks for, and how to check each one works. */
export interface KeySpec {
  env: 'OPENAI_API_KEY' | 'ANTHROPIC_API_KEY';
  label: string;
  why: string;
  where: string;
  required: boolean;
  check(key: string, doFetch: typeof fetch): Promise<Response>;
}

export const KEYS: KeySpec[] = [
  {
    env: 'OPENAI_API_KEY',
    label: 'OpenAI',
    why: 'the voice (Realtime speech in and out)',
    where: 'https://platform.openai.com/api-keys',
    required: true,
    check: (key, doFetch) =>
      doFetch('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${key}` } }),
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

/** Check a key against its provider. Never includes the key in the result. */
export async function verifyKey(
  spec: KeySpec,
  key: string,
  doFetch: typeof fetch = fetch,
): Promise<'ok' | 'rejected' | 'unreachable'> {
  try {
    const res = await spec.check(key, doFetch);
    if (res.ok) return 'ok';
    return res.status === 401 || res.status === 403 ? 'rejected' : 'unreachable';
  } catch {
    return 'unreachable';
  }
}
