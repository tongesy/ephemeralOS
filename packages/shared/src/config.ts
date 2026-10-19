import { z } from 'zod';

/**
 * Non-secret settings, stored as `config.json` in the user's home folder
 * (`~/.ephemeralos/` by default). Every field has a default, so a partial or
 * hand-edited file still loads. API keys never live here; they are in `.env`.
 */
export const Config = z.object({
  /** What the agent calls itself. */
  name: z.string().min(1).default('Orb'),
  /** Realtime voice; `marin` and `cedar` are OpenAI's recommended voices. */
  voice: z.string().min(1).default('marin'),
  realtimeModel: z.string().min(1).default('gpt-realtime-2.1-mini'),
  wakeWord: z
    .object({
      /** File name (without `.onnx`) of the openWakeWord model in `models/`. */
      model: z.string().min(1).default('hey_jarvis_v0.1'),
      /** How the wake phrase is spoken, for prompts and docs. */
      phrase: z.string().min(1).default('Hey Jarvis'),
      /** Detection score (0..1) that counts as a wake. Higher is stricter. */
      threshold: z.number().min(0.05).max(0.99).default(0.5),
    })
    .prefault({}),
  /** Close the voice session after this long with nobody speaking. */
  silenceTimeoutSeconds: z.number().int().min(3).max(120).default(10),
  /** Saying any of these ends the session. Matched loosely (case and punctuation). */
  sleepPhrases: z
    .array(z.string().min(1))
    .default(["that's all", "thanks, that's it", 'go to sleep']),
});

export type Config = z.infer<typeof Config>;

/**
 * openWakeWord's shared feature models, used with every wake-word model. They are
 * downloaded by `ephemeralos init` into `models/` (their licence forbids bundling them).
 */
export const WAKE_WORD_FEATURE_MODELS = [
  'melspectrogram.onnx',
  'embedding_model.onnx',
  'silero_vad.onnx',
] as const;

/** URL path the gateway serves `models/` on. */
export const MODELS_PATH = '/models/';

/** What the browser needs to know about the gateway's setup. Never includes secrets. */
export const GatewayStatus = z.object({
  name: z.string(),
  /** An OpenAI key is configured, so voice sessions can start. */
  voice: z.boolean(),
  wakeWord: z.object({
    /** The wake-word models are installed. */
    available: z.boolean(),
    model: z.string(),
    phrase: z.string(),
    threshold: z.number(),
  }),
  silenceTimeoutSeconds: z.number(),
  sleepPhrases: z.array(z.string()),
});

export type GatewayStatus = z.infer<typeof GatewayStatus>;

/** Response from `POST /api/realtime/session`. */
export const RealtimeSession = z.object({
  /** Short-lived key (`ek_…`) valid only for connecting this one session. */
  clientSecret: z.string(),
  /** Unix seconds. */
  expiresAt: z.number(),
  model: z.string(),
});

export type RealtimeSession = z.infer<typeof RealtimeSession>;

/** Loose match for sleep phrases: lower case, letters, digits and single spaces. */
export function normalisePhrase(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** True if `transcript` is, or ends with, one of the sleep phrases. */
export function isSleepPhrase(transcript: string, phrases: readonly string[]): boolean {
  const said = normalisePhrase(transcript);
  return phrases.some((p) => {
    const phrase = normalisePhrase(p);
    return phrase.length > 0 && (said === phrase || said.endsWith(` ${phrase}`));
  });
}
