// Which city cards (a camp's picture and name) the map shows. Pure: GrandMap measures the rectangles, this decides.

export interface Rect { x0: number; y0: number; x1: number; y1: number }

export interface CardCandidate {
  id: string;
  /** The player's own port. */
  own: boolean;
  /** Camp level, the higher one first among equals. */
  level: number;
  /** Distance from the centre of the screen: the nearer one first among equals. */
  distance: number;
  rect: Rect;
}

/** A port's disc on screen, which no other port's card may cover. */
export interface Disc { id: string; rect: Rect }

/** Space kept between two cards, in pixels. */
const GAP = 4;

export const overlaps = (a: Rect, b: Rect, gap = GAP) => a.x0 < b.x1 + gap && b.x0 < a.x1 + gap && a.y0 < b.y1 + gap && b.y0 < a.y1 + gap;

/** The card's rectangle on its port at (x, y), on the side its label takes (b, t, l or r), `rad` px from the centre to the disc's edge. */
export function cardRect(x: number, y: number, rad: number, side: string, width: number, height: number): Rect {
  if (side === 't') return { x0: x - width / 2, y0: y - rad - 4 - height, x1: x + width / 2, y1: y - rad - 4 };
  if (side === 'l') return { x0: x - rad - 6 - width, y0: y - height / 2, x1: x - rad - 6, y1: y + height / 2 };
  if (side === 'r') return { x0: x + rad + 6, y0: y - height / 2, x1: x + rad + 6 + width, y1: y + height / 2 };
  return { x0: x - width / 2, y0: y + rad + 4, x1: x + width / 2, y1: y + rad + 4 + height };
}

/**
 * The ids to show a card for, at most `limit`. The selected port goes first, then the hovered one, then the player's
 * own ports, then the rest; within each group higher camps and then those nearer the screen's centre. A card that would
 * cover one already shown is dropped (its port keeps its name and level badge), and so is one that would hide another
 * port's disc, which must stay in sight to be clicked; only the selected port's card may do that.
 */
export function pickCards(candidates: CardCandidate[], selected: string | null | undefined, hovered: string | null | undefined, limit: number, discs: Disc[] = []): string[] {
  const rank = (c: CardCandidate) => (c.id === selected ? 0 : c.id === hovered ? 1 : c.own ? 2 : 3);
  const order = [...candidates].sort((a, b) => rank(a) - rank(b) || b.level - a.level || a.distance - b.distance || (a.id < b.id ? -1 : 1));
  const shown: CardCandidate[] = [];
  for (const c of order) {
    if (shown.length >= limit) break;
    if (c.id !== selected && discs.some((d) => d.id !== c.id && overlaps(d.rect, c.rect, 0))) continue;
    if (shown.every((s) => !overlaps(s.rect, c.rect))) shown.push(c);
  }
  return shown.map((c) => c.id);
}
