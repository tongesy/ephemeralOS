import { describe, expect, it } from 'vitest';
import { ScreenArgs, parseDisplay, toolParameters, DisplayArgs } from '../src/display.ts';

describe('parseDisplay', () => {
  it('narrows a valid call to its component', () => {
    const result = parseDisplay({
      component: 'list',
      title: 'Hotels',
      items: [{ label: 'Sanders', detail: 'from 3,200 kr' }],
    });
    expect(result).toEqual({
      ok: true,
      value: {
        id: undefined,
        title: 'Hotels',
        ttlSeconds: undefined,
        content: { component: 'list', items: [{ label: 'Sanders', detail: 'from 3,200 kr' }] },
      },
    });
  });

  it('explains missing or mismatched fields in words the model can act on', () => {
    expect(parseDisplay({ component: 'card' })).toEqual({ ok: false, error: 'card needs body' });
    const ragged = parseDisplay({ component: 'table', columns: ['a', 'b'], rows: [['x']] });
    expect(ragged).toMatchObject({ ok: false, error: expect.stringContaining('row 1') });
    const chart = parseDisplay({
      component: 'chart',
      chart: { kind: 'bar', labels: ['a', 'b'], series: [{ name: 's', values: [1] }] },
    });
    expect(chart).toMatchObject({ ok: false, error: expect.stringContaining('1 values for 2') });
    expect(parseDisplay({ component: 'video' }).ok).toBe(false);
  });

  it('rejects non-URL images', () => {
    expect(
      parseDisplay({ component: 'card', body: 'x', image_url: 'javascript:alert(1)' }).ok,
    ).toBe(false);
  });
});

describe('tool schemas', () => {
  it('produce plain JSON Schema objects for Realtime', () => {
    const display = toolParameters(DisplayArgs);
    expect(display).not.toHaveProperty('$schema');
    expect(display).toMatchObject({ type: 'object', required: ['component'] });
    expect(toolParameters(ScreenArgs)).toMatchObject({ required: ['action'] });
  });
});
