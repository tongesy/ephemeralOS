import { describe, expect, it } from 'vitest';
import type { DisplayRequest } from '@ephemeralos/shared';
import { formatTick, niceScale } from '../src/display/chart.ts';
import { DisplayStack } from '../src/display/display-stack.ts';
import { parseInline, parseMarkdown } from '../src/display/markdown.ts';
import { isNumericColumn, ranksItself } from '../src/display/table-layout.ts';
import { wouldReplaceToolResult } from '../src/display/tool-result.ts';

const card = (id?: string, body = 'x'): DisplayRequest => ({
  id,
  content: { component: 'card', body },
});

describe('DisplayStack', () => {
  it('shows the newest, walks back and forward, and updates by id in place', () => {
    const stack = new DisplayStack();
    stack.show(card('a'));
    stack.show(card('b'));
    expect(stack.position()).toBe('2 of 2');
    expect(stack.step(1)).toBe(false);
    expect(stack.step(-1)).toBe(true);
    expect(stack.shown?.request.id).toBe('a');

    const { updated } = stack.show(card('b', 'new'));
    expect(updated).toBe(true);
    expect(stack.entries).toHaveLength(2);
    expect(stack.shown?.request.content).toMatchObject({ body: 'new' });
  });

  it('hides without forgetting, so "back" brings it back', () => {
    const stack = new DisplayStack();
    stack.show(card());
    stack.hide();
    expect(stack.shown).toBeNull();
    expect(stack.step(1)).toBe(false);
    expect(stack.step(-1)).toBe(true);
    expect(stack.shown).not.toBeNull();
    stack.clear();
    expect(stack.step(-1)).toBe(false);
  });

  it('gives each component a default lifetime unless told otherwise', () => {
    const stack = new DisplayStack();
    expect(stack.show(card()).entry.ttlMs).toBe(60_000);
    expect(stack.show({ ...card(), ttlSeconds: 10 }).entry.ttlMs).toBe(10_000);
  });
});

describe('markdown subset', () => {
  it('parses paragraphs, bullets and inline emphasis', () => {
    expect(parseMarkdown('# Title\nHello **there**\n\n- one\n- *two*')).toEqual([
      {
        kind: 'p',
        inlines: [
          { kind: 'strong', text: 'Title' },
          { kind: 'text', text: ' Hello ' },
          { kind: 'strong', text: 'there' },
        ],
      },
      { kind: 'ul', items: [[{ kind: 'text', text: 'one' }], [{ kind: 'em', text: 'two' }]] },
    ]);
  });

  it('keeps markup-looking text as text', () => {
    expect(parseInline('<img src=x onerror=alert(1)>')).toEqual([
      { kind: 'text', text: '<img src=x onerror=alert(1)>' },
    ]);
    expect(parseInline('2 * 3 = 6 and `a*b`')).toEqual([
      { kind: 'text', text: '2 * 3 = 6 and ' },
      { kind: 'code', text: 'a*b' },
    ]);
  });
});

describe('chart scale', () => {
  it('rounds to tidy steps', () => {
    expect(niceScale(5, 16)).toEqual({ min: 5, max: 20, step: 5 });
    expect(niceScale(0, 1234)).toEqual({ min: 0, max: 1500, step: 500 });
    expect(niceScale(3, 3).max).toBeGreaterThan(3);
  });

  it('formats ticks compactly', () => {
    expect(formatTick(1500, 500)).toBe('1500');
    expect(formatTick(25_000, 5000)).toBe('25k');
    expect(formatTick(0.25, 0.05)).toBe('0.25');
  });
});

describe('table layout', () => {
  const rows = [
    [1, 'Manchester City', '-4', '21'],
    [2, 'Arsenal', '+6', '18%'],
  ];

  it('right-aligns numbers, including numbers written as text', () => {
    expect([0, 1, 2, 3].map((c) => isNumericColumn(rows, c))).toEqual([true, false, true, true]);
  });

  it('numbers rows only when the table does not already rank them', () => {
    expect(ranksItself('Pos', rows)).toBe(true);
    expect(ranksItself('#', [['1.'], ['2.']])).toBe(true);
    expect(ranksItself('Played', [[1], [2]])).toBe(false);
    expect(ranksItself('Pos', [[2], [1]])).toBe(false);
  });
});

describe('tool results', () => {
  const table = { key: 'd1', id: 'standings' };
  it('keeps a search result until the user speaks again', () => {
    const base = { toolResult: 'd1', shown: table, fromTool: false };
    expect(wouldReplaceToolResult(base)).toBe(true);
    expect(wouldReplaceToolResult({ ...base, incomingId: 'summary' })).toBe(true);
    expect(wouldReplaceToolResult({ ...base, incomingId: 'standings' })).toBe(false);
    expect(wouldReplaceToolResult({ ...base, fromTool: true })).toBe(false);
    expect(wouldReplaceToolResult({ ...base, toolResult: null })).toBe(false);
    expect(wouldReplaceToolResult({ ...base, shown: { key: 'd2' } })).toBe(false);
  });
});
