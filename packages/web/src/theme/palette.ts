/**
 * The one palette. The orb, the glass cards and (from M3) Vega-Lite charts all draw
 * from these values, so the screen always reads as a single object.
 *
 * Mood: Nordic daylight. Warm paper white, soft ink, and a handful of clear pastel
 * accents that the orb's plasma is mixed from.
 */
export const palette = {
  /** Page background: a warm, paper white. */
  paper: '#F7F5F2',

  /** Primary type. */
  ink: '#1C1B19',
  /** Secondary type. */
  stone: '#76716B',
  /** Tertiary type, hairlines. */
  mist: '#C9C4BD',

  /** Accents, named for where they come from. */
  fjord: '#6E9DB3',
  azure: '#4FA3D1',
  glacier: '#9CD3E2',
  heather: '#9A8CD0',
  lilac: '#C9B6EC',
  sand: '#E8C08F',
  coral: '#E8937A',
  rose: '#DE8FAE',
  moss: '#8DB59A',
  clay: '#B98E70',
} as const;

export type PaletteColor = keyof typeof palette;

/**
 * The skies the page turns into for the weather, top of the screen then horizon. Soft and
 * a little desaturated, so glass cards and the orb still sit naturally on top.
 */
export const skyPalette = {
  dayTop: '#7FAFD6',
  dayHorizon: '#DCE9F2',
  overcastTop: '#9AA6B1',
  overcastHorizon: '#D9DDE0',
  stormTop: '#4E5966',
  stormHorizon: '#8F9AA3',
  nightTop: '#0E1A2E',
  nightHorizon: '#2C3E5C',
  nightOvercastTop: '#141A22',
  nightOvercastHorizon: '#2A323C',
  fog: '#E4E6E6',
  nightFog: '#3A424B',
  sun: '#FFE6B8',
  moon: '#E6ECF5',
  cloud: '#FAFBFC',
  cloudShade: '#B8C1C9',
  nightCloud: '#323B48',
  nightCloudShade: '#161B23',
} as const;

/** Series order for charts, chosen to stay distinguishable on paper. */
export const seriesColors = [
  palette.fjord,
  palette.coral,
  palette.heather,
  palette.moss,
  palette.sand,
] as const;

/** Expose the palette to CSS as `--eos-<name>` custom properties. */
export function applyPalette(root: HTMLElement = document.documentElement): void {
  for (const [name, value] of Object.entries(palette)) {
    root.style.setProperty(`--eos-${name}`, value);
  }
}
