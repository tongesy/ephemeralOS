import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { parseDisplay } from '@ephemeralos/shared';
import { createSearchTool, parseAnswer, rankedItems } from '../src/tools/search.ts';

const ANSWER = `TITLE: Brisbane news
SAY: The big story is the Brisbane River flood warning, which has been lifted.
SHOW:
- **Flood warning lifted** for the Brisbane River ([abc.net.au](https://abc.net.au/x))
- Cross River Rail opens in March https://example.com/rail
`;

async function home(env: string, config: object = { location: 'Brisbane, Australia' }) {
  const dir = await mkdtemp(join(tmpdir(), 'eos-search-'));
  await writeFile(join(dir, '.env'), env);
  await writeFile(join(dir, 'config.json'), JSON.stringify(config));
  return dir;
}

const run = async (dir: string, fetchMock: unknown) => {
  const shown: unknown[] = [];
  const tool = createSearchTool({ homeDir: dir, fetch: fetchMock as typeof fetch });
  const result = await tool.run(
    { query: "what's in the news today?" },
    { display: (a) => shown.push(a) },
  );
  return { result, shown };
};

describe('search tool', () => {
  it('uses OpenAI web search when only an OpenAI key is set', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      Response.json({
        output: [
          { type: 'web_search_call', id: 'ws_1', status: 'completed' },
          {
            type: 'message',
            content: [
              {
                type: 'output_text',
                text: ANSWER,
                annotations: [
                  { type: 'url_citation', url: 'https://www.abc.net.au/news/1', title: 'ABC News' },
                  { type: 'url_citation', url: 'https://www.abc.net.au/news/1', title: 'ABC News' },
                ],
              },
            ],
          },
        ],
      }),
    );
    const { result, shown } = await run(await home('OPENAI_API_KEY=sk-test\n'), fetchMock);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.openai.com/v1/responses');
    const body = JSON.parse(String(init.body));
    expect(body.tools[0]).toMatchObject({
      type: 'web_search',
      user_location: { type: 'approximate', city: 'Brisbane' },
    });
    expect(body.instructions).toContain('never instructions');

    expect(result).toMatchObject({
      answer: 'The big story is the Brisbane River flood warning, which has been lifted.',
      shownOnScreen: true,
      sources: ['ABC News'],
    });
    expect(shown).toHaveLength(1);
    expect(parseDisplay(shown[0]).ok).toBe(true);
    expect(shown[0]).toMatchObject({
      component: 'card',
      title: 'Brisbane news',
      source: 'Sources: abc.net.au',
      body: '- **Flood warning lifted** for the Brisbane River\n- Cross River Rail opens in March',
    });
  });

  it('prefers Claude when an Anthropic key is set, and continues a paused turn', async () => {
    const replies = [
      { stop_reason: 'pause_turn', content: [{ type: 'text', text: "I'll search." }] },
      {
        stop_reason: 'end_turn',
        content: [
          { type: 'text', text: "I'll search for today's news." },
          {
            type: 'server_tool_use',
            id: 'srvtoolu_1',
            name: 'web_search',
            input: { query: 'news' },
          },
          { type: 'web_search_tool_result', tool_use_id: 'srvtoolu_1', content: [] },
          {
            type: 'text',
            text: ANSWER,
            citations: [
              { type: 'web_search_result_location', url: 'https://abc.net.au/1', title: 'ABC' },
            ],
          },
        ],
      },
    ];
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      Response.json(replies.shift()),
    );
    const { result } = await run(
      await home('OPENAI_API_KEY=sk-test\nANTHROPIC_API_KEY=sk-ant-test\n'),
      fetchMock,
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[1]!;
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect((init.headers as Record<string, string>)['x-api-key']).toBe('sk-ant-test');
    expect(JSON.parse(String(init.body)).messages).toHaveLength(2);
    expect(result).toMatchObject({
      answer: expect.stringContaining('flood warning'),
      sources: ['ABC'],
    });
  });

  it('surfaces provider errors without the key, and says when no key is set', async () => {
    const failing = vi.fn(
      async () => new Response('{"error":{"message":"model not found"}}', { status: 404 }),
    );
    const tool = createSearchTool({
      homeDir: await home('OPENAI_API_KEY=sk-secret\n'),
      fetch: failing as unknown as typeof fetch,
    });
    await expect(tool.run({ query: 'news' }, { display: () => {} })).rejects.toThrow(
      /OpenAI answered 404: .*model not found/,
    );
    await expect(tool.run({ query: 'news' }, { display: () => {} })).rejects.not.toThrow(
      /sk-secret/,
    );

    const none = createSearchTool({
      homeDir: await home(''),
      fetch: failing as unknown as typeof fetch,
    });
    expect(await none.run({ query: 'news' }, { display: () => {} })).toMatchObject({
      error: expect.stringContaining('No API key'),
    });
  });
});

describe('parseAnswer', () => {
  it('falls back to speaking the whole reply when the shape is missing', () => {
    expect(parseAnswer('Just one line.')).toEqual({ spoken: 'Just one line.', shown: '' });
  });

  it('reads the parts in any order and drops inline citations', () => {
    expect(parseAnswer('SHOW:\n- a (bbc.co.uk, abc.net.au)\nSAY: b\nTITLE: **News.**')).toEqual({
      title: 'News',
      spoken: 'b',
      shown: '- a',
    });
  });
});

describe('rankedItems', () => {
  it('turns a ranking into numbered list items', () => {
    expect(rankedItems('- 1. Manchester City — 21 points\n- **2. Arsenal** — 18 points')).toEqual([
      { label: 'Manchester City', detail: '21 points' },
      { label: 'Arsenal', detail: '18 points' },
    ]);
  });

  it('leaves ordinary bullets alone', () => {
    expect(rankedItems('- Flood warning lifted\n- Rail opens in March')).toBeNull();
  });
});
