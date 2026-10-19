import { z } from 'zod';
import { ICON_NAMES } from './icons.ts';

/**
 * The `display` and `screen` tools: what the voice (and, from M4, the brain) can put on
 * screen and how the user steers it by voice. Defined once here; the gateway turns them
 * into Realtime tool definitions and the browser validates every call against them.
 *
 * Arguments are flat (one optional field per component) rather than a union: small voice
 * models fill flat schemas far more reliably. `parseDisplay` checks the right fields are
 * present for the chosen component.
 */

export const DISPLAY_COMPONENTS = ['card', 'list', 'table', 'chart', 'hero', 'gallery'] as const;
export type DisplayComponent = (typeof DISPLAY_COMPONENTS)[number];

/** An image the page may load: https only, so nothing local or scripted. */
const ImageUrl = z
  .string()
  .max(2000)
  .regex(/^https:\/\/[^\s]+$/, 'must be an https URL');

/** URL path the gateway serves cached logos on: `/logos/<domain>`. */
export const LOGOS_PATH = '/logos/';

const DOMAIN = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const PRIVATE_SUFFIX = /(?:^|\.)(?:localhost|local|internal|lan|home|arpa|test|example|invalid)$/;

/**
 * The public domain a logo can be looked up for, from what the brain wrote ("arsenal.com",
 * "https://www.arsenal.com/news"), or null. Names only: no IPs, ports or local names.
 */
export function logoDomain(raw: string): string | null {
  const host = raw
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, '')
    .replace(/[/?#].*$/, '')
    .replace(/^www\./, '')
    .replace(/\.$/, '');
  return DOMAIN.test(host) && !PRIVATE_SUFFIX.test(host) ? host : null;
}

/** A website whose logo the gateway fetches and caches; written as a bare domain. */
const Domain = z
  .string()
  .max(253)
  .refine((d) => logoDomain(d) === d, 'must be a bare public domain, like "arsenal.com"');

/** URL path the gateway serves photos on: `/photos/<Wikipedia article title>`. */
export const PHOTOS_PATH = '/photos/';

/**
 * The Wikipedia article title a photo can be looked up for ("Erling Haaland"), tidied,
 * or null. Titles only: nothing that could be read as a path, query or markup.
 */
export function photoTitle(raw: string): string | null {
  const title = raw.trim().replace(/_/g, ' ').replace(/\s+/g, ' ');
  // eslint-disable-next-line no-control-regex -- refusing control characters
  return title.length > 0 && title.length <= 200 && !/[/#?|<>[\]{}\\%\x00-\x1f]/.test(title)
    ? title
    : null;
}

/** A person, place or thing with a Wikipedia article, for its photo. */
const Photo = z
  .string()
  .max(200)
  .refine((t) => photoTitle(t) === t, 'must be a Wikipedia article title, like "Erling Haaland"');

/** One of the bundled icons (Phosphor, light), drawn in the palette. */
const Icon = z.enum(ICON_NAMES);

const ListItem = z.object({
  label: z.string().min(1).max(200),
  detail: z.string().max(400).optional().describe('One short line under the label.'),
  image_url: ImageUrl.optional().describe('A small logo, flag or photo beside the item'),
  domain: Domain.optional().describe("The item's own website, for its logo"),
  icon: Icon.optional().describe('A bundled icon beside the item, when no image fits'),
});

/** A picture in a gallery: a Wikipedia article's photo, or an https image, and a caption. */
const GalleryImage = z
  .object({
    photo: Photo.optional().describe('The English Wikipedia article title it shows'),
    image_url: ImageUrl.optional(),
    caption: z.string().max(160).optional(),
  })
  .refine((i) => i.photo || i.image_url, 'needs a photo or an image_url');
export type GalleryImage = z.infer<typeof GalleryImage>;

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

export const SKIES = [
  'clear',
  'partly-cloudy',
  'cloudy',
  'fog',
  'rain',
  'snow',
  'thunder',
] as const;
export type Sky = (typeof SKIES)[number];

/**
 * The world behind a surface: the page itself becomes the weather outside right now (rain
 * on the glass, drifting snow, a night sky) for as long as the surface is shown.
 */
export const Scene = z.object({
  kind: z.literal('weather'),
  sky: z.enum(SKIES),
  /** How heavy: drizzle to downpour, flurries to blizzard, haze to thick fog. */
  intensity: z.number().min(0).max(1),
  day: z.boolean(),
  /** Wind, 0 (still) to 1 (a gale); slants the rain and drives the clouds. */
  wind: z.number().min(0).max(1),
});
export type Scene = z.infer<typeof Scene>;

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
  kicker: z.string().max(40).optional().describe('hero: a word or two above the title'),
  image_url: ImageUrl.optional().describe('card or hero: optional https image'),
  photo: Photo.optional().describe(
    'card or hero: the English Wikipedia article title of who or what it is about, for a photo',
  ),
  items: z.array(ListItem).min(1).max(30).optional().describe('list: shown numbered'),
  columns: z.array(z.string().max(60)).min(1).max(8).optional().describe('table: headers'),
  rows: z.array(z.array(Cell).max(8)).min(1).max(50).optional().describe('table: shown numbered'),
  row_images: z
    .array(z.union([ImageUrl, z.literal('')]))
    .max(50)
    .optional()
    .describe('table: a small logo or flag per row, "" for none'),
  row_domains: z
    .array(z.union([Domain, z.literal('')]))
    .max(50)
    .optional()
    .describe('table: each row\'s own website, for its logo, "" for none'),
  row_icons: z
    .array(z.union([Icon, z.literal('')]))
    .max(50)
    .optional()
    .describe('table: a bundled icon per row (e.g. weather), "" for none'),
  icon_column: z
    .number()
    .int()
    .min(0)
    .max(7)
    .optional()
    .describe('table: which column (from 0) the row logos and icons sit in; default 0'),
  chart: Chart.optional().describe('chart: the data to plot'),
  images: z.array(GalleryImage).min(1).max(8).optional().describe('gallery: the pictures'),
  slideshow: z
    .boolean()
    .optional()
    .describe('gallery: one picture at a time, full screen, moving on by itself'),
  scene: Scene.optional().describe('weather only: turn the page into the weather right now'),
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
  | { component: 'card'; body: string; imageUrl?: string; photo?: string }
  | { component: 'list'; items: z.infer<typeof ListItem>[] }
  | {
      component: 'table';
      columns: string[];
      rows: (string | number)[][];
      rowImages?: string[];
      rowDomains?: string[];
      rowIcons?: string[];
      iconColumn?: number;
    }
  | { component: 'chart'; chart: Chart }
  | { component: 'hero'; body?: string; kicker?: string; photo?: string; imageUrl?: string }
  | { component: 'gallery'; images: GalleryImage[]; slideshow: boolean };

export interface DisplayRequest {
  id?: string;
  title?: string;
  source?: string;
  ttlSeconds?: number;
  scene?: Scene;
  content: DisplayContent;
}

/** How long each component stays before fading, unless the call says otherwise. */
export const DEFAULT_TTL_SECONDS: Record<DisplayComponent, number> = {
  card: 60,
  list: 120,
  table: 180,
  chart: 120,
  hero: 90,
  gallery: 150,
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
  const base = {
    id: a.id,
    title: a.title,
    source: a.source,
    ttlSeconds: a.ttl_seconds,
    ...(a.scene && { scene: a.scene }),
  };
  const missing = (field: string) => ({
    ok: false as const,
    error: `${a.component} needs ${field}`,
  });
  switch (a.component) {
    case 'card':
      if (!a.body) return missing('body');
      return {
        ok: true,
        value: {
          ...base,
          content: {
            component: 'card',
            body: a.body,
            ...(a.image_url && { imageUrl: a.image_url }),
            ...(a.photo && { photo: a.photo }),
          },
        },
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
        value: {
          ...base,
          content: {
            component: 'table',
            columns: a.columns,
            rows: a.rows,
            ...(a.row_images?.some(Boolean) && { rowImages: a.row_images }),
            ...(a.row_domains?.some(Boolean) && { rowDomains: a.row_domains }),
            ...(a.row_icons?.some(Boolean) && { rowIcons: a.row_icons }),
            ...(a.icon_column !== undefined && { iconColumn: a.icon_column }),
          },
        },
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
    case 'hero':
      if (!a.photo && !a.image_url) return missing('photo or image_url');
      return {
        ok: true,
        value: {
          ...base,
          content: {
            component: 'hero',
            ...(a.body && { body: a.body }),
            ...(a.kicker && { kicker: a.kicker }),
            ...(a.photo && { photo: a.photo }),
            ...(a.image_url && { imageUrl: a.image_url }),
          },
        },
      };
    case 'gallery':
      if (!a.images) return missing('images');
      return {
        ok: true,
        value: {
          ...base,
          content: { component: 'gallery', images: a.images, slideshow: a.slideshow ?? false },
        },
      };
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
  'Show something on screen. Use it for lists of 3+ options, numbers worth comparing, tables, charts and anything to follow along with. To show pictures ("photos of Italy", "show me the Colosseum"), use gallery (or hero for one), with each photo set to the exact title of an English Wikipedia article, such as "Amalfi Coast"; set slideshow for a full-screen show. Never describe pictures in a card instead. Then say a one-sentence gist; never read it out in full. Replaces what is shown (back brings it back).';

export const SCREEN_TOOL_DESCRIPTION =
  'Act on what is on screen when the user asks: "next", "go back", "scroll down", "open number two", "make it bigger", "dismiss", "clear the screen". Returns what is now shown.';
