import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { parseDisplay } from '@ephemeralos/shared';
import { createSearchTool, parseAnswer } from '../src/tools/search.ts';

const ANSWER = `Here is what I found:
{"title": "Premier League table",
 "say": "Manchester City lead on 21 points, three clear of Arsenal.",
 "show": {"component": "table", "columns": ["Team", "Pts"],
   "rows": [["Manchester City", 21], ["Arsenal ([bbc.co.uk](https://bbc.co.uk/x))", 18]],
   "row_images": ["https://upload.wikimedia.org/city.svg", "javascript:alert(1)"],
   "row_domains": ["https://www.mancity.com/", "127.0.0.1"],
   "row_icons": ["crest-of-arms", "trophy"]}}`;

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
      answer: 'Manchester City lead on 21 points, three clear of Arsenal.',
      shownOnScreen: true,
      sources: ['ABC News'],
    });
    expect(shown).toHaveLength(1);
    expect(parseDisplay(shown[0]).ok).toBe(true);
    expect(shown[0]).toMatchObject({
      component: 'table',
      title: 'Premier League table',
      source: 'Sources: abc.net.au',
      rows: [
        ['Manchester City', 21],
        ['Arsenal', 18],
      ],
      row_images: ['https://upload.wikimedia.org/city.svg', ''],
      row_domains: ['mancity.com', ''],
      row_icons: ['', 'trophy'],
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
      answer: expect.stringContaining('Manchester City'),
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
  it('speaks a reply that is not the JSON shape', () => {
    expect(parseAnswer('Just one line (bbc.co.uk).')).toEqual({ spoken: 'Just one line.' });
  });

  it('reads the JSON even with words around it', () => {
    expect(
      parseAnswer('Sure! {"title": "News.", "say": "b", "show": {"component": "card"}} Done.'),
    ).toEqual({
      title: 'News',
      spoken: 'b',
      show: { component: 'card' },
    });
  });
});
