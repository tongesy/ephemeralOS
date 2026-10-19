/*
 * Choreography for surfaces. The glass panel itself fades with CSS; this moves what is
 * inside it: content arrives in a soft cascade (title, then each row or item), leaves in
 * one quick breath, and the panel eases to its new size in between. Charts draw
 * themselves: lines trace left to right, bars rise from the baseline.
 */

const EASE_OUT = 'cubic-bezier(0.16, 1, 0.3, 1)';
const EASE_IN = 'cubic-bezier(0.4, 0, 1, 1)';

/** Delay between one row and the next as content cascades in. */
const STAGGER_MS = 40;
/** The cascade never takes longer than this, however many rows there are. */
const MAX_STAGGER_MS = 480;
const ENTER_MS = 560;
const LEAVE_MS = 200;
const RESIZE_MS = 520;
const DRAW_MS = 1100;

export function reducedMotion(): boolean {
  return matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** The pieces of a surface that move on their own, in reading order. */
function beats(surface: HTMLElement): Element[] {
  const out: Element[] = [];
  for (const child of surface.children) {
    if (child.matches('.surface__list')) out.push(...child.children);
    else if (child.matches('.surface__table')) out.push(...child.querySelectorAll('tr'));
    else out.push(child);
  }
  return out;
}

/** Cascade a surface's content in, starting after `delayMs`. */
export function reveal(surface: HTMLElement, delayMs = 0): void {
  if (reducedMotion()) return;
  const parts = beats(surface);
  const step = Math.min(STAGGER_MS, MAX_STAGGER_MS / Math.max(parts.length, 1));
  parts.forEach((part, i) => {
    part.animate(
      [
        { opacity: 0, transform: 'translateY(8px)', filter: 'blur(4px)' },
        { opacity: 1, transform: 'none', filter: 'none' },
      ],
      { duration: ENTER_MS, delay: delayMs + i * step, easing: EASE_OUT, fill: 'backwards' },
    );
  });
  const chart = surface.querySelector('.surface__chart svg');
  if (chart) drawChart(chart, delayMs + step);
}

/** Let a surface's content go in one quick breath; resolves when it is gone. */
export async function conceal(surface: HTMLElement): Promise<void> {
  if (reducedMotion()) return;
  const parts = beats(surface);
  const step = Math.min(12, 120 / Math.max(parts.length, 1));
  const animations = parts.map((part, i) =>
    part.animate(
      [
        { opacity: 1, transform: 'none', filter: 'none' },
        { opacity: 0, transform: 'translateY(-6px)', filter: 'blur(4px)' },
      ],
      { duration: LEAVE_MS, delay: i * step, easing: EASE_IN, fill: 'forwards' },
    ),
  );
  await Promise.allSettled(animations.map((a) => a.finished));
}

/** Ease a panel from the size it had to the size its new content needs. */
export function resize(surface: HTMLElement, from: DOMRect): Promise<void> {
  const to = surface.getBoundingClientRect();
  if (
    reducedMotion() ||
    (Math.abs(to.width - from.width) < 1 && Math.abs(to.height - from.height) < 1)
  ) {
    return Promise.resolve();
  }
  const animation = surface.animate(
    [
      { width: `${from.width}px`, height: `${from.height}px` },
      { width: `${to.width}px`, height: `${to.height}px` },
    ],
    { duration: RESIZE_MS, easing: EASE_OUT },
  );
  return animation.finished.then(
    () => undefined,
    () => undefined,
  );
}

function drawChart(svg: Element, delayMs: number): void {
  const lines = [...svg.querySelectorAll<SVGPolylineElement>('.chart__line')];
  lines.forEach((line, s) => {
    const length = line.getTotalLength();
    line.animate(
      [
        { strokeDasharray: `${length}`, strokeDashoffset: `${length}` },
        { strokeDasharray: `${length}`, strokeDashoffset: '0' },
      ],
      {
        duration: DRAW_MS,
        delay: delayMs + s * 120,
        easing: 'cubic-bezier(0.65, 0, 0.35, 1)',
        fill: 'backwards',
      },
    );
  });
  // Points and bars follow the sweep from left to right.
  for (const mark of svg.querySelectorAll<SVGElement>('.chart__point, .chart__bar')) {
    const at = Number(mark.dataset.at ?? 0);
    const series = Number(mark.dataset.series ?? 0);
    const bar = mark.classList.contains('chart__bar');
    mark.animate(
      bar
        ? [{ transform: 'scaleY(0)' }, { transform: 'none' }]
        : [
            { opacity: 0, transform: 'scale(0.4)' },
            { opacity: 1, transform: 'none' },
          ],
      {
        duration: bar ? 700 : 360,
        delay: delayMs + series * 120 + at * (bar ? 0.5 : 0.85) * DRAW_MS,
        easing: EASE_OUT,
        fill: 'backwards',
      },
    );
  }
}
