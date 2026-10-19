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

  it('builds heroes and galleries from photos or https images', () => {
    const hero = parseDisplay({
      component: 'hero',
      title: 'Tromsø',
      kicker: 'Travel',
      photo: 'Tromsø',
    });
    expect(hero).toMatchObject({
      ok: true,
      value: { content: { component: 'hero', kicker: 'Travel', photo: 'Tromsø' } },
    });
    expect(parseDisplay({ component: 'hero', title: 'Tromsø' })).toMatchObject({ ok: false });

    const gallery = parseDisplay({
      component: 'gallery',
      slideshow: true,
      images: [
        { photo: 'Arctic Cathedral', caption: 'At dusk' },
        { image_url: 'https://x.org/a.jpg' },
      ],
    });
    expect(gallery).toMatchObject({
      ok: true,
      value: { content: { component: 'gallery', slideshow: true, images: [{}, {}] } },
    });
    expect(parseDisplay({ component: 'gallery' })).toMatchObject({ ok: false });
    expect(parseDisplay({ component: 'gallery', images: [{ caption: 'nothing' }] })).toMatchObject({
      ok: false,
    });
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

  it('carries row logos for tables and keeps them to https', () => {
    const table = { component: 'table', columns: ['Team'], rows: [['A'], ['B']] };
    const ok = parseDisplay({ ...table, row_images: ['https://x.org/a.png', ''] });
    expect(ok.ok && ok.value.content).toMatchObject({ rowImages: ['https://x.org/a.png', ''] });
    expect(parseDisplay({ ...table, row_images: ['http://x.org/a.png'] }).ok).toBe(false);
    const logos = parseDisplay({ ...table, row_domains: ['arsenal.com', ''] });
    expect(logos.ok && logos.value.content).toMatchObject({ rowDomains: ['arsenal.com', ''] });
    expect(parseDisplay({ ...table, row_domains: ['localhost'] }).ok).toBe(false);
  });
});
