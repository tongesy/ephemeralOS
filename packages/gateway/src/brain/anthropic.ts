import { z } from 'zod';
import {
  BrainError,
  providerError,
  uniqueSources,
  type Brain,
  type WebAnswerRequest,
} from './types.ts';

const MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';
/** A long search turn can pause; send it back to continue, but not forever. */
const MAX_CONTINUATIONS = 2;

const Block = z.looseObject({
  type: z.string(),
  text: z.string().optional(),
  citations: z
    .array(
      z.looseObject({ type: z.string(), url: z.string().optional(), title: z.string().optional() }),
    )
    .nullish(),
});
const Message = z.object({ content: z.array(Block), stop_reason: z.string().nullish() });

/** Claude's Messages API with Anthropic's server-side `web_search` tool. */
export function anthropicBrain(options: {
  apiKey: string;
  model: string;
  fetch?: typeof fetch;
}): Brain {
  const doFetch = options.fetch ?? fetch;
  return {
    provider: 'anthropic',
    model: options.model,
    async webAnswer(request: WebAnswerRequest) {
      const tool = {
        type: 'web_search_20250305',
        name: 'web_search',
        max_uses: 3,
        ...(request.location && { user_location: { type: 'approximate', ...request.location } }),
      };
      const messages: unknown[] = [{ role: 'user', content: request.question }];
      let message: z.infer<typeof Message>;
      for (let turn = 0; ; turn++) {
        const response = await doFetch(MESSAGES_URL, {
          method: 'POST',
          headers: {
            'x-api-key': options.apiKey,
            'anthropic-version': API_VERSION,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: options.model,
            max_tokens: 1024,
            system: request.instructions,
            messages,
            tools: [tool],
          }),
          signal: request.signal,
        });
        if (!response.ok) throw await providerError('Anthropic', response);
        message = Message.parse(await response.json());
        if (message.stop_reason !== 'pause_turn') break;
        if (turn >= MAX_CONTINUATIONS) throw new BrainError('The search took too long.');
        messages.push({ role: 'assistant', content: message.content });
      }
      const content = message.content;
      // Claude often says "I'll search for…" first; the answer is the text after the results.
      const lastResult = content.findLastIndex((b) => b.type === 'web_search_tool_result');
      const answer = content.slice(lastResult + 1).filter((b) => b.type === 'text');
      return {
        text: answer
          .map((b) => b.text ?? '')
          .join('')
          .trim(),
        sources: uniqueSources(
          answer
            .flatMap((b) => b.citations ?? [])
            .filter((c) => c.type === 'web_search_result_location' && c.url)
            .map((c) => ({ title: c.title ?? c.url!, url: c.url! })),
        ),
      };
    },
  };
}
