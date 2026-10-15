import type { Ship } from '../../sim/types';
import { anchorsFor, byModel } from '../../ships/anchors';
import { DECKS, mainDeck } from '../../ships/decks';

/** Where on a ship a fire can hold: the open deck, the bulwarks, the gun ports, the pavilion or tower, the masts and sails. */
export const Site = { Deck: 0, Rail: 1, Port: 2, Upper: 3, Rig: 4 } as const;
export type SiteKind = (typeof Site)[keyof typeof Site];

/**
 * One place a fire can burn, in ship space (+x bow, +y up, z across). `out` is the way its flames lean out of the hull
 * (a gun port's flames billow sideways before they rise); `size` scales its tongues; `from` is the fire level the
 * ship must reach before this place catches (rigging and upper works go last).
 */
export type BurnSite = { kind: SiteKind; x: number; y: number; z: number; outX: number; outZ: number; size: number; from: number };

const mulberry = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/** Height of the deck fires stand on: the fighting deck of an open ship, the hull's rim under the turtle's roof. */
export function deckHeight(ship: Ship) {
  const kind = ship.spec.kind;
  return byModel(DECKS, kind).open ? mainDeck(`${kind}#${ship.variant}`, kind, ship.spec.deck) : ship.spec.deck;
}

/**
 * The places a fire can take on this ship, `count` of them, seeded by the ship id so a replay burns the same way. They
 * come from the ship's own anchors where it has them (deck bounds, gun ports, the command deck, the masts), from its
 * spec otherwise.
 */
export function burnSites(ship: Ship, count: number): BurnSite[] {
  const r = mulberry(ship.id * 2654435761 + 97);
  const spec = ship.spec;
  const L = spec.length;
  const B = spec.beam;
  const deck = deckHeight(ship);
  const open = byModel(DECKS, spec.kind).open;
  const a = anchorsFor(`${spec.kind}#${ship.variant}`) ?? anchorsFor(`${spec.kind}#0`);
  const x0 = a?.deckBounds.x0 ?? -L * 0.42;
  const x1 = a?.deckBounds.x1 ?? L * 0.42;
  const half = (x: number) => Math.max(0.6, a ? a.deckBounds.halfBeam(x) : B * 0.42);
  const sites: BurnSite[] = [];
  const add = (kind: SiteKind, x: number, y: number, z: number, outX: number, outZ: number, size: number, from: number) => sites.push({ kind, x, y, z, outX, outZ, size, from });

  // Shares of the count: most of a fire is on the deck and along the bulwarks; the rest climbs the upper works and the rigging.
  const ports = a?.gunPorts ?? [];
  const masts = a?.mastTops ?? [];
  const upper = a?.commandDeck;
  const nRig = masts.length ? Math.round(count * 0.16) : 0;
  const nUpper = upper && open ? Math.round(count * 0.14) : 0;
  const nPort = ports.length ? Math.round(count * (open ? 0.16 : 0.34)) : 0;
  const nRail = Math.round(count * 0.18);
  const nDeck = Math.max(2, count - nRig - nUpper - nPort - nRail);

  for (let i = 0; i < nDeck; i += 1) {
    const x = x0 + (x1 - x0) * ((i + r()) / nDeck);
    const z = (r() * 2 - 1) * half(x) * 0.8;
    add(Site.Deck, x, deck + (open ? 0.1 : 0.2), z, 0, 0, 0.9 + r() * 0.5, 0);
  }
  for (let i = 0; i < nRail; i += 1) {
    const x = x0 + (x1 - x0) * r();
    const side = i % 2 ? 1 : -1;
    add(Site.Rail, x, deck + 0.5, side * (half(x) + 0.2), 0, side * 0.35, 0.8 + r() * 0.4, 0.15);
  }
  for (let i = 0; i < nPort; i += 1) {
    const p = ports[Math.floor(r() * ports.length)]!;
    add(Site.Port, p.pos[0], p.pos[1], p.pos[2] + Math.sign(p.pos[2] || 1) * 0.3, p.dir[0], p.dir[2], 0.65 + r() * 0.3, 0.25);
  }
  if (upper) {
    for (let i = 0; i < nUpper; i += 1) {
      const x = upper[0] + (r() * 2 - 1) * Math.min(5, L * 0.1);
      add(Site.Upper, x, upper[1] + r() * 2.2, (r() * 2 - 1) * Math.min(2.5, B * 0.25), 0, 0, 1 + r() * 0.5, 0.35);
    }
  }
  for (let i = 0; i < nRig; i += 1) {
    const m = masts[i % masts.length]!;
    const h = m[1] - deck;
    // Sail cloth hangs from the yard to a few metres over the deck; fire runs up it from the foot.
    add(Site.Rig, m[0] + (r() * 2 - 1) * 0.8, deck + h * (0.3 + r() * 0.55), (r() * 2 - 1) * Math.min(3, B * 0.3), 0, 0, 0.8 + r() * 0.4, 0.55);
  }
  return sites;
}
