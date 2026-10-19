/** A web page an answer drew on. */
export interface Source {
  title: string;
  url: string;
}

/** What a brain found on the web: its answer as Markdown, and where it came from. */
export interface WebAnswer {
  text: string;
  sources: Source[];
}

export interface WebAnswerRequest {
  /** System instructions: how to search and how to shape the answer. */
  instructions: string;
  question: string;
  /** Roughly where the user is, so "near me" and local news mean something. */
  location?: { city?: string; timezone?: string };
  signal?: AbortSignal;
}

/** A model provider that can search the web and answer. */
export interface Brain {
  readonly provider: 'anthropic' | 'openai';
  readonly model: string;
  webAnswer(request: WebAnswerRequest): Promise<WebAnswer>;
}

export class BrainError extends Error {}

/** Read a provider's error body for the log, without ever echoing a request header. */
export async function providerError(provider: string, response: Response): Promise<BrainError> {
  const detail = await response.text().catch(() => '');
  return new BrainError(`${provider} answered ${response.status}: ${detail.slice(0, 300)}`);
}

/** Keep each source once, in the order first cited. */
export function uniqueSources(sources: Source[]): Source[] {
  const seen = new Set<string>();
  return sources.filter((s) => !seen.has(s.url) && seen.add(s.url));
}
