import { describe, expect, it } from 'vitest';
import { Config, isSleepPhrase, normalisePhrase } from '../src/index.ts';

describe('Config', () => {
  it('fills every default from an empty file', () => {
    const config = Config.parse({});
    expect(config.voice).toBe('marin');
    expect(config.wakeWord.threshold).toBe(0.5);
    expect(config.sleepPhrases).toContain('go to sleep');
  });

  it('keeps partial nested settings', () => {
    const config = Config.parse({ wakeWord: { threshold: 0.7 } });
    expect(config.wakeWord).toMatchObject({ threshold: 0.7, model: 'hey_jarvis_v0.1' });
  });

  it('rejects nonsense', () => {
    expect(Config.safeParse({ silenceTimeoutSeconds: 0 }).success).toBe(false);
  });
});

describe('sleep phrases', () => {
  const phrases = ["that's all", "thanks, that's it", 'go to sleep'];

  it('normalises case and punctuation', () => {
    expect(normalisePhrase("  Thanks, THAT'S it! ")).toBe('thanks thats it');
  });

  it('matches whole or trailing phrases only', () => {
    expect(isSleepPhrase('Go to sleep.', phrases)).toBe(true);
    expect(isSleepPhrase('Okay, thanks, that’s it', phrases)).toBe(true);
    expect(isSleepPhrase("Is that's all the weather?", phrases)).toBe(false);
    expect(isSleepPhrase('Remind me to go to sleep at ten', phrases)).toBe(false);
  });
});
