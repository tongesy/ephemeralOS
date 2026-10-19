import { createHash } from 'node:crypto';
import { z } from 'zod';
import { providerError, uniqueSources, type Brain, type WebAnswerRequest } from './types.ts';

const RESPONSES_URL = 'https://api.openai.com/v1/responses';

const Response_ = z.object({
  output: z.array(
    z.looseObject({
      type: z.string(),
      content: z
        .array(
          z.looseObject({
            type: z.string(),
            text: z.string().optional(),
            annotations: z
              .array(
                z.looseObject({
                  type: z.string(),
                  url: z.string().optional(),
                  title: z.string().optional(),
                }),
              )
              .optional(),
          }),
        )
        .optional(),
    }),
  ),
});

/** OpenAI's Responses API with its built-in `web_search` tool. */
export function openaiBrain(options: {
  apiKey: string;
  model: string;
  /** Stable, anonymous id for this install, sent as OpenAI's safety identifier. */
  installId: string;
  fetch?: typeof fetch;
}): Brain {
  const doFetch = options.fetch ?? fetch;
  return {
    provider: 'openai',
    model: options.model,
    async webAnswer(request: WebAnswerRequest) {
      const response = await doFetch(RESPONSES_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          'Content-Type': 'application/json',
          'OpenAI-Safety-Identifier': createHash('sha256').update(options.installId).digest('hex'),
        },
        body: JSON.stringify({
          model: options.model,
          instructions: request.instructions,
          input: request.question,
          reasoning: { effort: 'low' },
          tools: [
            {
              type: 'web_search',
              search_context_size: 'low',
              ...(request.location && {
                user_location: { type: 'approximate', ...request.location },
              }),
            },
          ],
          tool_choice: 'required',
          store: false,
        }),
        signal: request.signal,
      });
      if (!response.ok) throw await providerError('OpenAI', response);
      const body = Response_.parse(await response.json());
      const parts = body.output
        .filter((item) => item.type === 'message')
        .flatMap((item) => item.content ?? [])
        .filter((part) => part.type === 'output_text');
      return {
        text: parts.map((part) => part.text ?? '').join('\n\n'),
        sources: uniqueSources(
          parts
            .flatMap((part) => part.annotations ?? [])
            .filter((a) => a.type === 'url_citation' && a.url)
            .map((a) => ({ title: a.title ?? a.url!, url: a.url! })),
        ),
      };
    },
  };
}
