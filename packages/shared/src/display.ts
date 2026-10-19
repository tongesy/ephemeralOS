import { z } from 'zod';

/**
 * The `display` and `screen` tools: what the voice (and, from M4, the brain) can put on
 * screen and how the user steers it by voice. Defined once here; the gateway turns them
 * into Realtime tool definitions and the browser validates every call against them.
 *
 * Arguments are flat (one optional field per component) rather than a union: small voice
 * models fill flat schemas far more reliably. `parseDisplay` checks the right fields are
 * present for the chosen component.
 */

export const DISPLAY_COMPONENTS = ['card', 'list', 'table', 'chart'] as const;
export type DisplayComponent = (typeof DISPLAY_COMPONENTS)[number];

const ListItem = z.object({
  label: z.string().min(1).max(200),
  detail: z.string().max(400).optional().describe('One short line under the label.'),
});

const Cell = z.union([z.string().max(200), z.number()]);

const ChartSeries = z.object({
  name: z.string().min(1).max(60),
  values: z.array(z.number()).min(1).max(60),
});

export const Chart = z.object({
  kind: z.enum(['bar', 'line']).describe('bar for comparing items, line for change over time'),
  labels: z.array(z.string().max(40)).min(1).max(60).describe('One label per value'),
  series: z.array(ChartSeries).min(1).max(4),
  unit: z.string().max(12).optional().describe('Shown after values, e.g. "°C", "kr", "%"'),
});
export type Chart = z.infer<typeof Chart>;

export const DisplayArgs = z.object({
  id: z
    .string()
    .max(80)
    .optional()
    .describe('Reuse an id to update something already on screen instead of adding more'),
  component: z.enum(DISPLAY_COMPONENTS),
  title: z.string().max(120).optional(),
  source: z.string().max(80).optional().describe('Where the data came from, shown small'),
  body: z
    .string()
    .max(4000)
    .optional()
    .describe('card: short Markdown (paragraphs, **bold**, *italic*, - bullets)'),
  image_url: z
    .string()
    .max(2000)
    .regex(/^https:\/\/[^\s]+$/, 'must be an https URL')
    .optional()
    .describe('card: optional https image'),
  items: z.array(ListItem).min(1).max(30).optional().describe('list: shown numbered'),
  columns: z.array(z.string().max(60)).min(1).max(8).optional().describe('table: headers'),
  rows: z.array(z.array(Cell).max(8)).min(1).max(50).optional().describe('table: shown numbered'),
  chart: Chart.optional().describe('chart: the data to plot'),
  ttl_seconds: z
    .number()
    .int()
    .min(5)
    .max(3600)
    .optional()
    .describe('Fade out after this long; defaults suit each component'),
});
export type DisplayArgs = z.infer<typeof DisplayArgs>;

/** A validated display call, narrowed to what its component needs. */
export type DisplayContent =
  | { component: 'card'; body: string; imageUrl?: string }
  | { component: 'list'; items: z.infer<typeof ListItem>[] }
  | { component: 'table'; columns: string[]; rows: (string | number)[][] }
  | { component: 'chart'; chart: Chart };

export interface DisplayRequest {
  id?: string;
  title?: string;
  source?: string;
  ttlSeconds?: number;
  content: DisplayContent;
}

/** How long each component stays before fading, unless the call says otherwise. */
export const DEFAULT_TTL_SECONDS: Record<DisplayComponent, number> = {
  card: 60,
  list: 120,
  table: 180,
  chart: 120,
};

/** Validate a display call. Errors are phrased for the model, so it can correct itself. */
export function parseDisplay(
  raw: unknown,
): { ok: true; value: DisplayRequest } | { ok: false; error: string } {
  const parsed = DisplayArgs.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    };
  }
  const a = parsed.data;
  const base = { id: a.id, title: a.title, source: a.source, ttlSeconds: a.ttl_seconds };
  const missing = (field: string) => ({
    ok: false as const,
    error: `${a.component} needs ${field}`,
  });
  switch (a.component) {
    case 'card':
      if (!a.body) return missing('body');
      return {
        ok: true,
        value: { ...base, content: { component: 'card', body: a.body, imageUrl: a.image_url } },
      };
    case 'list':
      if (!a.items) return missing('items');
      return { ok: true, value: { ...base, content: { component: 'list', items: a.items } } };
    case 'table': {
      if (!a.columns || !a.rows) return missing('columns and rows');
      const width = a.columns.length;
      const ragged = a.rows.findIndex((r) => r.length !== width);
      if (ragged >= 0) {
        return {
          ok: false,
          error: `table row ${ragged + 1} has ${a.rows[ragged]!.length} cells, expected ${width}`,
        };
      }
      return {
        ok: true,
        value: { ...base, content: { component: 'table', columns: a.columns, rows: a.rows } },
      };
    }
    case 'chart': {
      if (!a.chart) return missing('chart');
      const n = a.chart.labels.length;
      const bad = a.chart.series.find((s) => s.values.length !== n);
      if (bad)
        return {
          ok: false,
          error: `chart series "${bad.name}" has ${bad.values.length} values for ${n} labels`,
        };
      return { ok: true, value: { ...base, content: { component: 'chart', chart: a.chart } } };
    }
  }
}

export const SCREEN_ACTIONS = [
  'next',
  'back',
  'scroll_down',
  'scroll_up',
  'open',
  'enlarge',
  'dismiss',
  'dismiss_all',
] as const;
export type ScreenAction = (typeof SCREEN_ACTIONS)[number];

export const ScreenArgs = z.object({
  action: z
    .enum(SCREEN_ACTIONS)
    .describe(
      'next/back: move between things shown this session; open: focus a numbered item; enlarge: toggle full size; dismiss: hide what is shown; dismiss_all: clear the screen',
    ),
  index: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe('open: the item number the user said'),
});
export type ScreenArgs = z.infer<typeof ScreenArgs>;

/** A JSON Schema for a tool's parameters, as the Realtime API expects it. */
export function toolParameters(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema) as Record<string, unknown>;
  delete json.$schema;
  return json;
}

export const DISPLAY_TOOL_DESCRIPTION =
  'Show something on screen. Use it for lists of 3+ options, numbers worth comparing, tables, charts and anything to follow along with. Then say a one-sentence gist; never read it out in full. Replaces what is shown (back brings it back).';

export const SCREEN_TOOL_DESCRIPTION =
  'Act on what is on screen when the user asks: "next", "go back", "scroll down", "open number two", "make it bigger", "dismiss", "clear the screen". Returns what is now shown.';
