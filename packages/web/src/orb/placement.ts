/** A rectangle in CSS pixels, origin top-left (as `getBoundingClientRect` reports). */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Where the orb sits: its centre and radius in CSS pixels, origin top-left. */
export interface Placement {
  x: number;
  y: number;
  radius: number;
}

/** Orb radius as a fraction of the shorter screen side: small, so the page feels open. */
export const RESTING_SIZE = 0.0425;
/** Radius while content is on screen. */
export const SHARING_SIZE = 0.03;
/** Breathing room between the orb, content and the screen edge (fraction of shorter side). */
const GAP = 0.06;
/** A cornered orb's gap to the screen edges (beyond its glow), the closer gap it takes when
    content leaves no more, the least room it keeps from content, and the smallest it will
    shrink to there (fractions of the shorter side). */
const CORNER_INSET = 0.06;
const TIGHT_INSET = 0.045;
const CORNER_ROOM = 0.012;
const CORNER_MIN = 0.018;
/** Candidate positions per axis when searching for open space. */
const GRID = 15;

/** The orb alone on the page: centred, at rest. */
export function restingPlacement(width: number, height: number): Placement {
  return { x: width / 2, y: height / 2, radius: Math.min(width, height) * RESTING_SIZE };
}

function distanceToRect(px: number, py: number, r: Rect): number {
  const dx = Math.max(r.x - px, 0, px - (r.x + r.width));
  const dy = Math.max(r.y - py, 0, py - (r.y + r.height));
  return Math.hypot(dx, dy);
}

/**
 * Where the orb waits while content is up: the bottom-right corner, where people expect an
 * assistant to sit, then the other corners if content is there.
 */
const CORNERS: ReadonlyArray<readonly [right: boolean, bottom: boolean]> = [
  [true, true],
  [true, false],
  [false, true],
  [false, false],
];

/**
 * Where the orb goes while `occupied` rects hold content: out of the way in the first clear
 * corner (bottom right unless something is there). When every corner is taken, the most open
 * spot left: the point farthest from every rect and screen edge, ties going to the point
 * nearest the centre so the orb never wanders further than it needs to.
 */
export function openSpacePlacement(width: number, height: number, occupied: Rect[]): Placement {
  if (occupied.length === 0) return restingPlacement(width, height);

  const short = Math.min(width, height);
  const radius = short * SHARING_SIZE;
  const margin = short * GAP + radius;

  // In a corner the orb sits well in from the edges, glow and word clear of them. Where a
  // gallery runs nearly to the edges it tucks in closer and shrinks a little rather than
  // give up its corner.
  for (const [right, bottom] of CORNERS) {
    for (const [inset, minimum] of [
      [(r: number) => short * CORNER_INSET + r * 2.5, radius],
      [(r: number) => short * TIGHT_INSET + r, short * CORNER_MIN],
    ] as const) {
      for (let r = radius; r >= minimum; r -= short * 0.002) {
        const x = right ? width - inset(r) : inset(r);
        const y = bottom ? height - inset(r) : inset(r);
        const room = short * CORNER_ROOM;
        if (occupied.every((rect) => distanceToRect(x, y, rect) >= r + room)) {
          return { x, y, radius: r };
        }
      }
    }
  }
  let best = { x: width / 2, y: height / 2, clearance: -Infinity, centre: Infinity };

  for (let i = 0; i < GRID; i++) {
    for (let j = 0; j < GRID; j++) {
      const x = margin + ((width - 2 * margin) * i) / (GRID - 1);
      const y = margin + ((height - 2 * margin) * j) / (GRID - 1);
      let clearance = Math.min(x, y, width - x, height - y);
      for (const rect of occupied) clearance = Math.min(clearance, distanceToRect(x, y, rect));
      const centre = Math.hypot(x - width / 2, y - height / 2);
      const better =
        clearance > best.clearance + 1 ||
        (Math.abs(clearance - best.clearance) <= 1 && centre < best.centre);
      if (better) best = { x, y, clearance, centre };
    }
  }

  // If the content leaves very little room, shrink rather than overlap.
  const fit = Math.max(best.clearance - short * GAP * 0.5, short * 0.015);
  return { x: best.x, y: best.y, radius: Math.min(radius, fit) };
}
