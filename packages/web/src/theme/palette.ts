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
