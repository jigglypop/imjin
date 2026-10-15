// Which port names the map shows, on which side of their discs, and which discs step back to a small dot: so no name
// covers another or another port's disc, however low the camera looks. Pure: GrandMap measures, this decides.

export interface Rect { x0: number; y0: number; x1: number; y1: number }

export type Side = 'b' | 't' | 'l' | 'r';

/** Space kept between two names, in pixels. */
const GAP = 3;

export const overlaps = (a: Rect, b: Rect, gap = GAP) => a.x0 < b.x1 + gap && b.x0 < a.x1 + gap && a.y0 < b.y1 + gap && b.y0 < a.y1 + gap;

/** A name's rectangle `w` by `h` px on the given side of a disc at (x, y), `rad` px from its centre to its edge. */
export function labelRect(x: number, y: number, rad: number, side: Side, w: number, h: number): Rect {
  if (side === 't') return { x0: x - w / 2, y0: y - rad - 4 - h, x1: x + w / 2, y1: y - rad - 4 };
  if (side === 'l') return { x0: x - rad - 6 - w, y0: y - h / 2, x1: x - rad - 6, y1: y + h / 2 };
  if (side === 'r') return { x0: x + rad + 6, y0: y - h / 2, x1: x + rad + 6 + w, y1: y + h / 2 };
  return { x0: x - w / 2, y0: y + rad + 4, x1: x + w / 2, y1: y + rad + 4 + h };
}

/** The width in px of a name at the map's label size: Hangul and hanja about a square each, Latin narrower. */
export function nameWidth(name: string, latin = 7.2, square = 12.5) {
  let w = 0;
  for (const ch of name) w += ch.charCodeAt(0) > 0x2e80 ? square : ch === ' ' ? latin * 0.5 : latin;
  return w;
}

export interface Port {
  id: string;
  x: number;
  y: number;
  /** The disc's radius, px. */
  rad: number;
  /** Higher goes first: the selected and the hovered port, the player's own, the rest by worth. */
  priority: number;
}

export interface Named extends Port {
  /** The name's size, px, and the side it prefers. */
  w: number;
  h: number;
  side: Side;
}

const SIDES: Side[] = ['b', 't', 'r', 'l'];

/**
 * The discs drawn small: a disc that lies over one of higher priority (the hovered and selected ones have the highest)
 * steps back to a dot, so a cluster of ports reads as its most important one with its neighbours beside it.
 */
export function minorDiscs(ports: Port[]): Set<string> {
  const order = [...ports].sort((a, b) => b.priority - a.priority || (a.id < b.id ? -1 : 1));
  const kept: Port[] = [], minor = new Set<string>();
  for (const p of order) {
    if (kept.some((k) => Math.hypot(k.x - p.x, k.y - p.y) < k.rad + p.rad - 2)) minor.add(p.id);
    else kept.push(p);
  }
  return minor;
}

/**
 * Places the names in priority order, each on the first side, its preferred one first (or the side it held before, in
 * `held`, so a name does not hop about as the camera moves), where it covers no name already placed, no other port's
 * disc and stays on the screen (`screen`). A name that fits nowhere is not shown. Returns each shown name's side and
 * rectangle.
 */
export function placeLabels(names: Named[], discs: Port[], screen: Rect, held: ReadonlyMap<string, Side> = new Map()): Map<string, { side: Side; rect: Rect }> {
  // A name shown before keeps its place against a newcomer of a little higher priority.
  const order = [...names].sort((a, b) => b.priority + (held.has(b.id) ? 5 : 0) - (a.priority + (held.has(a.id) ? 5 : 0)) || (a.id < b.id ? -1 : 1));
  const placed = new Map<string, { side: Side; rect: Rect }>();
  const taken: Rect[] = [];
  const discRects = discs.map((d) => ({ id: d.id, rect: { x0: d.x - d.rad, y0: d.y - d.rad, x1: d.x + d.rad, y1: d.y + d.rad } }));
  for (const n of order) {
    const first = held.get(n.id) ?? n.side;
    for (const side of [first, ...SIDES.filter((s) => s !== first)]) {
      const rect = labelRect(n.x, n.y, n.rad, side, n.w, n.h);
      if (rect.x0 < screen.x0 || rect.y0 < screen.y0 || rect.x1 > screen.x1 || rect.y1 > screen.y1) continue;
      if (taken.some((t) => overlaps(t, rect))) continue;
      if (discRects.some((d) => d.id !== n.id && overlaps(d.rect, rect, 0))) continue;
      placed.set(n.id, { side, rect });
      taken.push(rect);
      break;
    }
  }
  return placed;
}
