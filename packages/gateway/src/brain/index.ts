import type { Config } from '@ephemeralos/shared';
import type { Secrets } from '../home.ts';
import { anthropicBrain } from './anthropic.ts';
import { openaiBrain } from './openai.ts';
import type { Brain } from './types.ts';

/** The brain, by key: Claude when an Anthropic key is set, otherwise OpenAI. */
export function chooseBrain(options: {
  config: Config;
  secrets: Secrets;
  installId: string;
  fetch?: typeof fetch;
}): Brain | null {
  const { config, secrets } = options;
  if (secrets.anthropicApiKey) {
    return anthropicBrain({
      apiKey: secrets.anthropicApiKey,
      model: config.brain.anthropicModel,
      fetch: options.fetch,
    });
  }
  if (secrets.openaiApiKey) {
    return openaiBrain({
      apiKey: secrets.openaiApiKey,
      model: config.brain.openaiModel,
      installId: options.installId,
      fetch: options.fetch,
    });
  }
  return null;
}

export { BrainError, type Brain, type Source, type WebAnswer } from './types.ts';
