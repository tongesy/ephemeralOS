/**
 * The one palette. The orb, the glass cards and (from M3) Vega-Lite charts all draw
 * from these values, so the screen always reads as a single object.
 *
 * Mood: Nordic dusk. Warm linen and stone for type and glass, muted natural accents,
 * set against true black so the orb owns the room.
 */
export const palette = {
  /** Page background. True black: the screen should feel switched off when idle. */
  void: '#000000',

  /** Primary type and glass highlights. */
  linen: '#F3EFE8',
  /** Secondary type. */
  stone: '#A8A199',
  /** Tertiary type, hairlines. */
  slate: '#5E5A55',

  /** Accents, named for where they come from. */
  fjord: '#8FB3C2',
  frost: '#D6E6EC',
  heather: '#B4ABD3',
  sand: '#E8D6BA',
  clay: '#C29A78',
  moss: '#9DB39A',
} as const;

export type PaletteColor = keyof typeof palette;

/** Series order for charts, chosen to stay distinguishable on black. */
export const seriesColors = [
  palette.fjord,
  palette.sand,
  palette.heather,
  palette.moss,
  palette.clay,
] as const;

/** Expose the palette to CSS as `--eos-<name>` custom properties. */
export function applyPalette(root: HTMLElement = document.documentElement): void {
  for (const [name, value] of Object.entries(palette)) {
    root.style.setProperty(`--eos-${name}`, value);
  }
}
