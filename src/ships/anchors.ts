/**
 * Ship plans and anchors: pure data (no three.js), shared by the procedural ship builder and by anything that
 * needs to know where a deck, gun port, oar port or flag mount sits on a ship. Ship space: +X bow, +Y up, Z across
 * the beam (side 0 is -Z, side 1 is +Z, matching Battle.muzzle), origin amidships on the waterline, metres.
 */
import { SHIP_SPECS } from '../sim/catalog';
import type { GunType, ShipKind } from '../sim/types';

export type V3 = [number, number, number];

export type GunPort = { side: 0 | 1 | 2; index: number; gun: GunType; pos: V3; dir: V3 };
export type FlagMount = { id: string; pos: V3; kind: 'sashimono' | 'command' | 'pennant' | 'nobori' | 'ensign'; size: [number, number]; color: string };

export type ShipAnchors = {
  length: number;
  beam: number;
  waterline: 0;
  /** y of the fighting deck (crew stand here). */
  mainDeck: number;
  /** y of the rowers' floor, null when they row on the main deck. */
  oarDeck: number | null;
  commandDeck: V3 | null;
  deckBounds: { x0: number; x1: number; halfBeam: (x: number) => number };
  gunPorts: GunPort[];
  oarPorts: { side: 0 | 1; pos: V3; pitch: number }[];
  railStations: { pos: V3; yaw: number }[];
  rowStations: { pos: V3; yaw: number }[];
  boardingPoints: { pos: V3; side: 0 | 1 }[];
  lanterns: V3[];
  flagMounts: FlagMount[];
  mastTops: V3[];
  /** Where the dragon head of the turtle ship belches smoke. */
  smokeStack?: V3;
  fireSpots: V3[];
  damageSpots: V3[];
  stern: V3;
  bow: V3;
  ramTip?: V3;
};

// ---------- hull shape ----------

export type HullPlan = {
  length: number;
  beam: number;
  /** Depth of the keel below the waterline amidships. */
  draft: number;
  /** Height of the hull's top edge (main deck or gunwale) above the waterline. */
  deck: number;
  /** Flat bottom half-width as a fraction of the waterline half-beam. */
  flat: number;
  bilge: number;
  /** Fraction of the half-length that keeps full beam, then the bow/stern widths at the ends (fraction of beam). */
  mid: number;
  bowF: number;
  sternF: number;
  /** The bottom rises toward the ends by this much (power law). */
  rise: number;
  risePow: number;
  /** The side leans outward by this much from waterline to the top edge. */
  flare: number;
  /** Plan taper exponent: higher keeps the ends fuller. */
  taper: number;
  /** The top edge sinks by this much toward the bow (turtle ship: room for the dragon head). */
  bowDrop?: number;
};

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Half beam at the waterline at station x. */
export function halfBeamAt(p: HullPlan, x: number) {
  const s = x / p.length;
  const a = Math.abs(s) * 2;
  const end = s >= 0 ? p.bowF : p.sternF;
  if (a <= p.mid) return p.beam / 2;
  const t = (a - p.mid) / (1 - p.mid);
  return (p.beam / 2) * (1 - (1 - end) * Math.pow(smooth(0, 1, t), p.taper));
}

export const HULL_POINTS = 14;

/** Height of the hull top edge at station x. */
export function hullTop(p: HullPlan, x: number) {
  return p.deck - (p.bowDrop ?? 0) * smooth(0.55, 1, x / (p.length / 2));
}

/** Half cross-section at station x, from the keel centreline (z = 0) up to the top edge: [z, y] pairs. */
export function hullSection(p: HullPlan, x: number): [number, number][] {
  const hw = halfBeamAt(p, x);
  const a = Math.abs((x / p.length) * 2);
  const yk = -p.draft + p.rise * Math.pow(a, p.risePow);
  const fh = hw * p.flat * (1 - 0.25 * a);
  const top = hullTop(p, x);
  const br = Math.min(p.bilge, Math.max(0.3, top * 0.55 - yk));
  const out: [number, number][] = [
    [0, yk],
    [fh * 0.5, yk],
    [fh, yk],
  ];
  for (let k = 1; k <= 4; k += 1) {
    const th = (k / 4) * (Math.PI / 2);
    out.push([fh + (hw - fh) * Math.sin(th), yk + br * (1 - Math.cos(th))]);
  }
  const yb = yk + br;
  const sideN = HULL_POINTS - out.length;
  for (let k = 1; k <= sideN; k += 1) {
    const y = yb + ((top - yb) * k) / sideN;
    out.push([hw + (p.flare * Math.max(0, y)) / top, y]);
  }
  return out;
}

/** Outer half-breadth at station x and height y (interpolated up the side of the section). */
export function sideZ(p: HullPlan, x: number, y: number) {
  const sec = hullSection(p, x);
  for (let i = sec.length - 1; i > 0; i -= 1) {
    const [z0, y0] = sec[i - 1]!;
    const [z1, y1] = sec[i]!;
    if (y >= y0 && y <= y1 && y1 > y0) return z0 + ((z1 - z0) * (y - y0)) / (y1 - y0);
  }
  return sec[sec.length - 1]![0];
}

// ---------- plans ----------

export type MastPlan = { x: number; h: number; sailW: number; sailH: number; set: boolean; yardUp?: number; r: number };

export type PanokPlan = {
  hull: HullPlan;
  /** Parapet (shield wall) height above the main deck. */
  parapet: number;
  /** Rise of the parapet top toward bow and stern. */
  sheer: number;
  pavilion: { x: number; hx: number; hz: number; floorUp: number; postH: number; tiers: 1 | 2 | 3; roofRise: number };
  masts: MastPlan[];
  oars: { n: number; x0: number; x1: number; y: number };
  look: boolean;
  flagship: boolean;
};

const PANOK_HULL: HullPlan = { length: 40, beam: 11.5, draft: 1.6, deck: 3.9, flat: 0.36, bilge: 1.5, mid: 0.2, bowF: 0.6, sternF: 0.76, rise: 2.3, risePow: 2.4, flare: 0.5, taper: 1.4 };

export const PANOK_PLANS: PanokPlan[] = [
  {
    hull: PANOK_HULL,
    parapet: 2.05,
    sheer: 0.55,
    pavilion: { x: -7.2, hx: 3.4, hz: 3.0, floorUp: 3.2, postH: 3.0, tiers: 1, roofRise: 1.7 },
    masts: [
      { x: 3.5, h: 14.6, sailW: 8.4, sailH: 8.8, set: true, r: 0.34 },
      { x: 12.2, h: 10.6, sailW: 6.4, sailH: 6.6, set: true, r: 0.27 },
    ],
    oars: { n: 8, x0: -14.5, x1: 14.5, y: 2.2 },
    look: false,
    flagship: true,
  },
  {
    hull: { ...PANOK_HULL, deck: 4.0, beam: 11.5, flat: 0.32, bowF: 0.52, sternF: 0.7, rise: 2.6, mid: 0.26, flare: 0.65, bilge: 1.7 },
    parapet: 2.2,
    sheer: 0.8,
    pavilion: { x: -7.6, hx: 3.6, hz: 3.2, floorUp: 3.2, postH: 2.6, tiers: 2, roofRise: 1.5 },
    masts: [
      { x: 3.0, h: 14.2, sailW: 8.0, sailH: 8.4, set: false, r: 0.34 },
      { x: 12.0, h: 10.2, sailW: 6.0, sailH: 6.2, set: false, r: 0.27 },
    ],
    oars: { n: 8, x0: -14.5, x1: 14.5, y: 2.3 },
    look: false,
    flagship: false,
  },
  {
    hull: { ...PANOK_HULL, deck: 3.75, flat: 0.4, bowF: 0.68, sternF: 0.82, rise: 1.9, mid: 0.18, flare: 0.3, bilge: 1.3, taper: 1.8 },
    parapet: 1.9,
    sheer: 0.35,
    pavilion: { x: -7.2, hx: 3.4, hz: 3.0, floorUp: 3.2, postH: 2.2, tiers: 3, roofRise: 1.2 },
    masts: [
      { x: 2.2, h: 14.8, sailW: 8.0, sailH: 8.6, set: true, r: 0.34 },
      { x: 11.6, h: 11.0, sailW: 6.2, sailH: 6.6, set: true, r: 0.27 },
      { x: -16, h: 8, sailW: 3.8, sailH: 4.0, set: true, r: 0.2 },
    ],
    oars: { n: 8, x0: -14.5, x1: 14.5, y: 2.1 },
    look: true,
    flagship: false,
  },
];

export type GeobukPlan = {
  hull: HullPlan;
  /** Gun deck height, roof height at the ridge and the eave overhang. */
  floor: number;
  roofTop: number;
  overhang: number;
  oars: { n: number; x0: number; x1: number; y: number };
  /** Dragon head: mouth tip at +length/2, centre height. */
  head: { baseX: number; mouthY: number };
};

export const GEOBUK_PLAN: GeobukPlan = {
  hull: { length: 42, beam: 12, draft: 1.5, deck: 5, flat: 0.34, bilge: 1.6, mid: 0.24, bowF: 0.34, sternF: 0.5, rise: 2.0, risePow: 2.2, flare: 0.2, taper: 1.2, bowDrop: 1.9 },
  floor: 2.6,
  roofTop: 7.3,
  overhang: 0.45,
  oars: { n: 8, x0: -14, x1: 14, y: 1.5 },
  head: { baseX: 13.6, mouthY: 3.9 },
};

export type HyeopPlan = {
  hull: HullPlan;
  oars: { n: number; x0: number; x1: number; y: number };
  mast: MastPlan;
};

export const HYEOP_PLAN: HyeopPlan = {
  hull: { length: 13, beam: 3.6, draft: 0.5, deck: 1.6, flat: 0.3, bilge: 0.5, mid: 0.3, bowF: 0.3, sternF: 0.6, rise: 0.7, risePow: 2.2, flare: 0.3, taper: 1.2 },
  oars: { n: 4, x0: -3.2, x1: 3.2, y: 1.5 },
  mast: { x: 1.4, h: 5.2, sailW: 3.4, sailH: 3.6, set: true, r: 0.12 },
};


// ---------- Japanese plans ----------

export type Tier = { hx: number; hz: number; h: number };

export type AtakePlan = {
  hull: HullPlan;
  /** Tategaki wall height above the main deck and its rise at the ends. */
  parapet: number;
  sheer: number;
  /** Fortress (yagura) centre along the ship; tiers from the deck up, each narrower than the one below. */
  cx: number;
  tiers: Tier[];
  /** Rise of the skirt roof between tiers. */
  skirt: number;
  mast: MastPlan;
  oars: { n: number; x0: number; x1: number; y: number };
};

const ATAKE_FIRST: AtakePlan = {
  hull: { length: 40, beam: 12.5, draft: 1.9, deck: 3.8, flat: 0.5, bilge: 1.3, mid: 0.34, bowF: 0.5, sternF: 0.78, rise: 1.7, risePow: 2.2, flare: 0.25, taper: 1.3 },
  parapet: 1.55,
  sheer: 0.4,
  cx: -1.2,
  tiers: [
    { hx: 10.2, hz: 4.6, h: 2.6 },
    { hx: 7.0, hz: 3.3, h: 2.3 },
    { hx: 3.4, hz: 2.1, h: 1.7 },
  ],
  skirt: 1.0,
  mast: { x: 14.6, h: 13.4, sailW: 8.0, sailH: 7.6, set: true, r: 0.36 },
  oars: { n: 13, x0: -15.5, x1: 15.5, y: 2.5 },
};

/** The second atakebune: a lower two-tier castle set aft, a small turret on the foredeck and the mast moved forward. */
const ATAKE_SECOND: AtakePlan = {
  hull: { ...ATAKE_FIRST.hull, deck: 3.9, beam: 12, flat: 0.46, bowF: 0.44, sternF: 0.72, rise: 1.9, mid: 0.3, flare: 0.35 },
  parapet: 1.7,
  sheer: 0.7,
  cx: -6,
  tiers: [
    { hx: 8.6, hz: 4.3, h: 2.4 },
    { hx: 4.6, hz: 2.9, h: 2.2 },
  ],
  skirt: 1.1,
  mast: { x: 10.4, h: 14.5, sailW: 8.6, sailH: 7.4, set: true, r: 0.36 },
  oars: ATAKE_FIRST.oars,
};

export const ATAKE_PLANS: AtakePlan[] = [ATAKE_FIRST, ATAKE_SECOND];

/** Foredeck turret of the second atakebune: centre, half sizes and wall height. */
export const ATAKE_TURRET = { x: 15.6, hx: 2.5, hz: 2.4, h: 2.2 };

/** Heights of the fortress tiers: wall base, wall top and the plateau the next tier stands on. */
export function atakeLevels(p: AtakePlan) {
  let y = p.hull.deck;
  return p.tiers.map((t, i) => {
    const last = i === p.tiers.length - 1;
    const y0 = y;
    const y1 = y0 + t.h;
    const plateau = last ? y1 : y1 + p.skirt;
    y = plateau - 0.12;
    return { ...t, y0, y1, plateau, last };
  });
}

export type SekiPlan = {
  hull: HullPlan;
  parapet: number;
  sheer: number;
  cabin: { x: number; hx: number; hz: number; h: number };
  mast: MastPlan;
  oars: { n: number; x0: number; x1: number; y: number };
};

const SEKI_FIRST: SekiPlan = {
  hull: { length: 24, beam: 6, draft: 0.95, deck: 1.7, flat: 0.4, bilge: 0.8, mid: 0.25, bowF: 0.26, sternF: 0.6, rise: 1.2, risePow: 2.2, flare: 0.35, taper: 1.2, bowDrop: -0.7 },
  parapet: 1.35,
  sheer: 0.3,
  cabin: { x: -4.6, hx: 2.7, hz: 1.75, h: 1.7 },
  mast: { x: 4.4, h: 7.1, sailW: 4.6, sailH: 4.4, set: true, r: 0.2 },
  oars: { n: 7, x0: -8, x1: 8, y: 2.1 },
};

/** The second sekibune: no lacquer, the cabin amidships under a plain hip roof and the mast aft. */
const SEKI_SECOND: SekiPlan = {
  hull: { ...SEKI_FIRST.hull, deck: 1.75, beam: 6.3, flat: 0.42, bowF: 0.3, sternF: 0.66, rise: 1.3 },
  parapet: 1.25,
  sheer: 0.4,
  cabin: { x: 1.2, hx: 2.3, hz: 1.6, h: 1.5 },
  mast: { x: -6.4, h: 7.6, sailW: 4.2, sailH: 4.6, set: true, r: 0.2 },
  oars: SEKI_FIRST.oars,
};

export const SEKI_PLANS: SekiPlan[] = [SEKI_FIRST, SEKI_SECOND];

export type KobayaPlan = {
  hull: HullPlan;
  oars: { n: number; x0: number; x1: number; y: number };
  poles: { x: number; z: number; h: number }[];
};

export const KOBAYA_PLAN: KobayaPlan = {
  hull: { length: 13, beam: 3, draft: 0.45, deck: 1.2, flat: 0.34, bilge: 0.45, mid: 0.3, bowF: 0.2, sternF: 0.55, rise: 0.65, risePow: 2.0, flare: 0.3, taper: 1.1, bowDrop: -0.95 },
  oars: { n: 4, x0: -2.6, x1: 2.6, y: 1.45 },
  poles: [
    { x: -5.1, z: 0, h: 5.2 },
    { x: 0.5, z: 0, h: 4.8 },
  ],
};

// ---------- Ming plans ----------

export type MingPlan = {
  hull: HullPlan;
  parapet: number;
  /** Stern castle: lower cabin storey and the upper pavilion on its roof deck. */
  castle: { x: number; hx: number; hz: number; h1: number; h2: number };
  masts: (MastPlan & { yaw: number })[];
  oars: { n: number; x0: number; x1: number; y: number };
};

export const MING_PLAN: MingPlan = {
  hull: { length: 36, beam: 10, draft: 2.2, deck: 3.5, flat: 0.5, bilge: 1.2, mid: 0.3, bowF: 0.6, sternF: 0.84, rise: 2.0, risePow: 2.2, flare: 0.35, taper: 1.2 },
  parapet: 1.5,
  castle: { x: -13.4, hx: 4.6, hz: 3.9, h1: 3.1, h2: 2.4 },
  masts: [
    { x: 3.0, h: 18.4, sailW: 11.4, sailH: 14.2, set: true, r: 0.42, yaw: 0.3 },
    { x: 11.6, h: 14.2, sailW: 8.0, sailH: 10.6, set: true, r: 0.32, yaw: -0.24 },
    { x: -5.6, h: 13.4, sailW: 7.0, sailH: 9.2, set: true, r: 0.28, yaw: 0.34 },
  ],
  oars: { n: 8, x0: -14, x1: 14, y: 2.0 },
};

export type MingSmallPlan = {
  hull: HullPlan;
  parapet: number;
  cabin: { x: number; hx: number; hz: number; h: number };
  masts: (MastPlan & { yaw: number })[];
  oars: { n: number; x0: number; x1: number; y: number };
};

export const MINGSMALL_PLAN: MingSmallPlan = {
  hull: { length: 18, beam: 5, draft: 1.1, deck: 1.9, flat: 0.5, bilge: 0.7, mid: 0.3, bowF: 0.55, sternF: 0.78, rise: 1.0, risePow: 2.2, flare: 0.3, taper: 1.2 },
  parapet: 0.95,
  cabin: { x: -4.6, hx: 2.1, hz: 1.5, h: 1.5 },
  masts: [
    { x: 1.2, h: 8.6, sailW: 5.6, sailH: 7.0, set: true, r: 0.24, yaw: 0.28 },
    { x: 5.8, h: 6.6, sailW: 3.8, sailH: 4.8, set: true, r: 0.18, yaw: -0.22 },
  ],
  oars: { n: 5, x0: -5.6, x1: 4.0, y: 1.55 },
};

// ---------- anchors ----------

const sideSign = (side: number) => (side === 0 ? -1 : 1);

function gunSlots(kind: ShipKind) {
  const spec = SHIP_SPECS[kind];
  const out: Record<number, GunType[]> = { 0: [], 1: [], 2: [] };
  for (const b of spec.batteries) for (let i = 0; i < b.count; i += 1) out[b.side]!.push(b.gun);
  return out;
}

/** Along-ship position of a gun slot: the same spacing Battle.muzzle uses (0.66 of the length, bow-ward with slot). */
export const gunX = (length: number, slot: number, count: number) => (count <= 1 ? 0 : (slot / (count - 1) - 0.5) * length * 0.66);

function oarPorts(hull: HullPlan, o: { n: number; x0: number; x1: number; y: number }) {
  const ports: ShipAnchors['oarPorts'] = [];
  for (const side of [0, 1] as const) {
    for (let i = 0; i < o.n; i += 1) {
      const x = o.x0 + ((o.x1 - o.x0) * i) / (o.n - 1);
      ports.push({ side, pos: [x, o.y, sideSign(side) * (sideZ(hull, x, o.y) + 0.02)], pitch: 0.42 });
    }
  }
  return ports;
}

function sideRail(hull: HullPlan, x0: number, x1: number, n: number, y: number, inset: number, yaw0 = 0) {
  const out: { pos: V3; yaw: number }[] = [];
  for (const side of [0, 1]) {
    for (let i = 0; i < n; i += 1) {
      const x = x0 + ((x1 - x0) * (i + 0.5)) / n;
      out.push({ pos: [x, y, sideSign(side) * (sideZ(hull, x, y) - inset)], yaw: yaw0 + (side === 0 ? -Math.PI / 2 : Math.PI / 2) });
    }
  }
  return out;
}

function panokAnchors(plan: PanokPlan): ShipAnchors {
  const h = plan.hull;
  const L = h.length;
  const deck = h.deck;
  const slots = gunSlots('panokseon');
  const gunY = deck + 0.85;
  const gunPorts: GunPort[] = [];
  for (const side of [0, 1] as const) {
    slots[side]!.forEach((gun, i) => {
      const x = gunX(L, i, slots[side]!.length);
      gunPorts.push({ side, index: i, gun, pos: [x, gunY, sideSign(side) * (sideZ(h, x, deck) + 0.2)], dir: [0, 0, sideSign(side)] });
    });
  }
  const pv = plan.pavilion;
  const floorY = deck + pv.floorUp;
  const stern = -L / 2;
  const flags: FlagMount[] = [
    { id: 'command', pos: [pv.x - 0.3, floorY + pv.postH + pv.roofRise + 1.4, 0], kind: 'command', size: [4.4, 3.8], color: '#5b2c26' },
    ...plan.masts.map((m, i): FlagMount => ({ id: `mast${i}`, pos: [m.x, deck + m.h + 0.2, 0], kind: 'pennant', size: [5.5, 0.9], color: '#8d7442' })),
  ];
  const mastTops: V3[] = plan.masts.map((m) => [m.x, deck + m.h, 0]);
  return {
    length: L,
    beam: h.beam,
    waterline: 0,
    mainDeck: deck,
    oarDeck: deck - 1.9,
    commandDeck: [pv.x, floorY, 0],
    deckBounds: { x0: stern + 1.2, x1: L / 2 - 1.2, halfBeam: (x) => sideZ(h, x, deck) - 0.4 },
    gunPorts,
    oarPorts: oarPorts(h, plan.oars),
    railStations: sideRail(h, -13, 15, 10, deck, 0.55),
    rowStations: sideRail(h, plan.oars.x0, plan.oars.x1, plan.oars.n, deck - 1.9, 1.6),
    boardingPoints: [-12, -3, 6, 13].flatMap((x) => [0, 1].map((side) => ({ pos: [x, deck + 0.2, sideSign(side) * sideZ(h, x, deck)] as V3, side: side as 0 | 1 }))),
    lanterns: [
      [pv.x - pv.hx + 0.4, floorY + postHalf(pv), pv.hz - 0.4],
      [pv.x - pv.hx + 0.4, floorY + postHalf(pv), -pv.hz + 0.4],
      [pv.x + pv.hx - 0.4, floorY + postHalf(pv), pv.hz - 0.4],
      [pv.x + pv.hx - 0.4, floorY + postHalf(pv), -pv.hz + 0.4],
      [L / 2 - 1.5, deck + plan.parapet + 0.4, 0],
      [-L / 2 + 1.0, deck + plan.parapet + 0.4, 0],
    ],
    flagMounts: flags,
    mastTops,
    fireSpots: [
      [0, deck + 0.3, 0],
      [9, deck + 0.3, 2],
      [-10, deck + 0.3, -2],
      [pv.x, floorY + 0.4, 0],
    ],
    damageSpots: [
      [-12, deck - 0.8, sideZ(h, -12, deck - 0.8)],
      [-4, deck - 0.8, -sideZ(h, -4, deck - 0.8)],
      [6, deck - 0.8, sideZ(h, 6, deck - 0.8)],
      [14, deck - 0.8, -sideZ(h, 14, deck - 0.8)],
    ],
    stern: [stern, deck, 0],
    bow: [L / 2, deck, 0],
  };
}

const postHalf = (pv: PanokPlan['pavilion']) => pv.postH * 0.85;

function geobukAnchors(plan: GeobukPlan): ShipAnchors {
  const h = plan.hull;
  const L = h.length;
  const slots = gunSlots('geobukseon');
  const gunY = 3.1;
  const gunPorts: GunPort[] = [];
  for (const side of [0, 1] as const) {
    slots[side]!.forEach((gun, i) => {
      const x = gunX(L, i, slots[side]!.length);
      gunPorts.push({ side, index: i, gun, pos: [x, gunY, sideSign(side) * (sideZ(h, x, gunY) + 0.2)], dir: [0, 0, sideSign(side)] });
    });
  }
  slots[2]!.forEach((gun, i) => gunPorts.push({ side: 2, index: i, gun, pos: [L / 2 - 0.4, plan.head.mouthY, 0], dir: [1, 0, 0] }));
  return {
    length: L,
    beam: h.beam,
    waterline: 0,
    mainDeck: plan.floor,
    oarDeck: plan.floor - 2.5,
    commandDeck: null,
    deckBounds: { x0: -L / 2 + 4, x1: L / 2 - 6, halfBeam: (x) => sideZ(h, x, plan.floor) - 0.8 },
    gunPorts,
    oarPorts: oarPorts(h, plan.oars),
    railStations: sideRail(h, -8, 8, 2, plan.floor, 1.0),
    rowStations: sideRail(h, plan.oars.x0, plan.oars.x1, plan.oars.n, plan.floor - 2.5, 1.6),
    boardingPoints: [],
    lanterns: [
      [L / 2 - 6, plan.roofTop - 0.6, 0],
      [-L / 2 + 5, plan.roofTop - 1.2, 0],
    ],
    flagMounts: [
      { id: 'ensign', pos: [-4, plan.roofTop + 0.4, 0], kind: 'ensign', size: [2.8, 2.2], color: '#5b2c26' },
      { id: 'pennant', pos: [5, plan.roofTop + 0.4, 0], kind: 'pennant', size: [3.4, 0.8], color: '#8d7442' },
    ],
    mastTops: [
      [-4, plan.roofTop + 2.4, 0],
      [5, plan.roofTop + 1.9, 0],
    ],
    smokeStack: [L / 2 - 0.6, plan.head.mouthY, 0],
    fireSpots: [
      [0, plan.roofTop, 0],
      [-9, plan.roofTop - 1.2, 0],
      [9, plan.roofTop - 0.6, 0],
    ],
    damageSpots: [
      [-12, 2.2, sideZ(h, -12, 2.2)],
      [-3, 2.2, -sideZ(h, -3, 2.2)],
      [8, 2.2, sideZ(h, 8, 2.2)],
      [14, 2.2, -sideZ(h, 14, 2.2)],
    ],
    stern: [-L / 2, plan.floor, 0],
    bow: [L / 2, plan.head.mouthY, 0],
    ramTip: [L / 2, 1.2, 0],
  };
}

function hyeopAnchors(plan: HyeopPlan): ShipAnchors {
  const h = plan.hull;
  const L = h.length;
  const slots = gunSlots('hyeopseon');
  const gunPorts: GunPort[] = [];
  for (const side of [0, 1] as const) {
    slots[side]!.forEach((gun, i) => {
      const x = L * 0.2;
      gunPorts.push({ side, index: i, gun, pos: [x, h.deck + 0.55, sideSign(side) * (sideZ(h, x, h.deck) + 0.1)], dir: [0, 0, sideSign(side)] });
    });
  }
  return {
    length: L,
    beam: h.beam,
    waterline: 0,
    mainDeck: h.deck - 0.55,
    oarDeck: null,
    commandDeck: null,
    deckBounds: { x0: -L / 2 + 1.5, x1: L / 2 - 1.5, halfBeam: (x) => sideZ(h, x, h.deck) - 0.35 },
    gunPorts,
    oarPorts: oarPorts(h, plan.oars),
    railStations: sideRail(h, -3, 4, 3, h.deck - 0.55, 0.45),
    rowStations: sideRail(h, plan.oars.x0, plan.oars.x1, plan.oars.n, h.deck - 0.55, 0.6),
    boardingPoints: [0, 1].map((side) => ({ pos: [0, h.deck, sideSign(side) * sideZ(h, 0, h.deck)] as V3, side: side as 0 | 1 })),
    lanterns: [[-L / 2 + 0.6, h.deck + 1.2, 0]],
    flagMounts: [{ id: 'pennant', pos: [plan.mast.x, h.deck + plan.mast.h, 0], kind: 'pennant', size: [2.4, 0.5], color: '#8d7442' }],
    mastTops: [[plan.mast.x, h.deck + plan.mast.h, 0]],
    fireSpots: [[0, h.deck - 0.4, 0]],
    damageSpots: [
      [-2, h.deck - 0.3, sideZ(h, -2, h.deck - 0.3)],
      [2, h.deck - 0.3, -sideZ(h, 2, h.deck - 0.3)],
    ],
    stern: [-L / 2, h.deck, 0],
    bow: [L / 2, h.deck, 0],
  };
}


const BASE = (h: HullPlan, over: Partial<ShipAnchors>): ShipAnchors => ({
  length: h.length,
  beam: h.beam,
  waterline: 0,
  mainDeck: h.deck,
  oarDeck: null,
  commandDeck: null,
  deckBounds: { x0: -h.length / 2 + 1.5, x1: h.length / 2 - 1.5, halfBeam: (x) => sideZ(h, x, h.deck) - 0.4 },
  gunPorts: [],
  oarPorts: [],
  railStations: [],
  rowStations: [],
  boardingPoints: [],
  lanterns: [],
  flagMounts: [],
  mastTops: [],
  fireSpots: [],
  damageSpots: [],
  stern: [-h.length / 2, h.deck, 0],
  bow: [h.length / 2, h.deck, 0],
  ...over,
});

function boarding(h: HullPlan, xs: number[], y: number): ShipAnchors['boardingPoints'] {
  return xs.flatMap((x) => [0, 1].map((side) => ({ pos: [x, y, sideSign(side) * sideZ(h, x, y)] as V3, side: side as 0 | 1 })));
}

function sideGuns(kind: ShipKind, h: HullPlan, y: number, out = 0.2): GunPort[] {
  const slots = gunSlots(kind);
  const ports: GunPort[] = [];
  for (const side of [0, 1] as const) {
    slots[side]!.forEach((gun, i) => {
      const x = gunX(h.length, i, slots[side]!.length);
      ports.push({ side, index: i, gun, pos: [x, y, sideSign(side) * (sideZ(h, x, Math.min(y, h.deck)) + out)], dir: [0, 0, sideSign(side)] });
    });
  }
  return ports;
}

function atakeAnchors(plan: AtakePlan): ShipAnchors {
  const h = plan.hull;
  const L = h.length;
  const deck = h.deck;
  const lv = atakeLevels(plan);
  const top = lv[lv.length - 1]!;
  const noboriAt = (x: number, z: number, w: number, hh: number, key: string): FlagMount => ({ id: `nobori:${key}`, pos: [x, deck + 0.1, z], kind: 'nobori', size: [w, hh], color: '#e8e0d0' });
  const flags: FlagMount[] = [
    noboriAt(L / 2 - 3.4, -1.6, 1.8, 5.4, 'nobori_a/white'),
    noboriAt(L / 2 - 3.4, 1.6, 1.8, 5.4, 'nobori_a/linen'),
    noboriAt(-L / 2 + 2.4, -2.6, 1.8, 5.6, 'nobori_b/black'),
    noboriAt(-L / 2 + 2.4, 2.6, 1.8, 5.6, 'nobori_b/indigo'),
    noboriAt(plan.cx - 12.2, -3.8, 1.6, 4.8, 'nobori_a/white'),
    noboriAt(plan.cx - 12.2, 3.8, 1.6, 4.8, 'nobori_a/linen'),
    noboriAt(plan.cx + 12.2, -3.8, 1.6, 4.8, 'nobori_b/indigo'),
    noboriAt(plan.cx + 12.2, 3.8, 1.6, 4.8, 'nobori_b/black'),
    { id: 'command', pos: [plan.cx, top.plateau + 3.4, 0], kind: 'command', size: [1.5, 4.4], color: '#e8e0d0' },
  ];
  return BASE(h, {
    mainDeck: deck,
    oarDeck: deck - 2.2,
    commandDeck: [plan.cx, lv[1]!.y0, 0],
    deckBounds: { x0: -L / 2 + 1.5, x1: L / 2 - 1.5, halfBeam: (x) => sideZ(h, x, deck) - 0.5 },
    gunPorts: sideGuns('atakebune', h, deck + 0.95, 0.22),
    oarPorts: oarPorts(h, plan.oars),
    railStations: sideRail(h, -17, 17, 14, deck, 0.7),
    rowStations: sideRail(h, plan.oars.x0, plan.oars.x1, plan.oars.n, deck - 2.2, 1.6),
    boardingPoints: boarding(h, [-14, -6, 4, 14], deck + 0.2),
    lanterns: [
      [plan.cx - lv[0]!.hx + 0.3, lv[0]!.y1 - 0.4, lv[0]!.hz + 0.2],
      [plan.cx - lv[0]!.hx + 0.3, lv[0]!.y1 - 0.4, -lv[0]!.hz - 0.2],
      [plan.cx + lv[0]!.hx - 0.3, lv[0]!.y1 - 0.4, lv[0]!.hz + 0.2],
      [plan.cx + lv[0]!.hx - 0.3, lv[0]!.y1 - 0.4, -lv[0]!.hz - 0.2],
      [L / 2 - 1.2, deck + plan.parapet + 0.3, 0],
      [-L / 2 + 1.0, deck + plan.parapet + 0.3, 0],
    ],
    flagMounts: flags,
    mastTops: [[plan.mast.x, deck + plan.mast.h, 0]],
    fireSpots: [
      [plan.cx, lv[1]!.y0, 0],
      [11, deck + 0.3, 2],
      [-13, deck + 0.3, -2],
      [plan.cx, deck + 0.3, 0],
    ],
    damageSpots: [
      [-12, deck - 0.8, sideZ(h, -12, deck - 0.8)],
      [-4, deck - 0.8, -sideZ(h, -4, deck - 0.8)],
      [6, deck - 0.8, sideZ(h, 6, deck - 0.8)],
      [14, deck - 0.8, -sideZ(h, 14, deck - 0.8)],
    ],
    ramTip: [L / 2, 1.0, 0],
  });
}

function sekiAnchors(plan: SekiPlan): ShipAnchors {
  const h = plan.hull;
  const L = h.length;
  const deck = h.deck;
  const c = plan.cabin;
  const noboriAt = (x: number, z: number, key: string): FlagMount => ({ id: `nobori:${key}`, pos: [x, deck + 0.1, z], kind: 'nobori', size: [1.2, 3.5], color: '#e8e0d0' });
  return BASE(h, {
    mainDeck: deck,
    oarDeck: null,
    deckBounds: { x0: -L / 2 + 1.5, x1: L / 2 - 1.8, halfBeam: (x) => sideZ(h, x, deck) - 0.4 },
    gunPorts: [],
    oarPorts: oarPorts(h, plan.oars),
    railStations: sideRail(h, -9, 9, 7, deck, 0.55),
    rowStations: sideRail(h, plan.oars.x0, plan.oars.x1, plan.oars.n, deck, 0.7),
    boardingPoints: boarding(h, [-6, 0, 6], deck + 0.2),
    lanterns: [
      [c.x + c.hx - 0.3, deck + c.h - 0.3, c.hz + 0.2],
      [c.x + c.hx - 0.3, deck + c.h - 0.3, -c.hz - 0.2],
      [-L / 2 + 0.8, deck + plan.parapet + 0.2, 0],
    ],
    flagMounts: [
      noboriAt(-L / 2 + 1.4, -1.2, 'nobori_a/white'),
      noboriAt(-L / 2 + 1.4, 1.2, 'nobori_b/indigo'),
      noboriAt(c.x + 1.0, 0, 'nobori_a/linen'),
      { id: 'mast', pos: [plan.mast.x, deck + plan.mast.h, 0], kind: 'pennant', size: [3.2, 0.5], color: '#e8e0d0' },
    ],
    mastTops: [[plan.mast.x, deck + plan.mast.h, 0]],
    fireSpots: [[0, deck + 0.3, 0], [c.x, deck + 0.4, 0]],
    damageSpots: [
      [-4, deck - 0.4, sideZ(h, -4, deck - 0.4)],
      [4, deck - 0.4, -sideZ(h, 4, deck - 0.4)],
    ],
    ramTip: [L / 2, 0.8, 0],
  });
}

function kobayaAnchors(plan: KobayaPlan): ShipAnchors {
  const h = plan.hull;
  const L = h.length;
  return BASE(h, {
    mainDeck: 0.5,
    oarDeck: null,
    deckBounds: { x0: -L / 2 + 1.3, x1: L / 2 - 1.8, halfBeam: (x) => sideZ(h, x, h.deck) - 0.3 },
    oarPorts: oarPorts(h, plan.oars),
    railStations: sideRail(h, -2.5, 3.5, 3, h.deck - 0.45, 0.4),
    rowStations: sideRail(h, plan.oars.x0, plan.oars.x1, plan.oars.n, h.deck - 0.45, 0.45),
    boardingPoints: boarding(h, [0], h.deck),
    lanterns: [[-L / 2 + 0.5, h.deck + 1.0, 0]],
    flagMounts: plan.poles.map((p, i): FlagMount => ({ id: `nobori:${i ? 'nobori_b/black' : 'nobori_a/white'}`, pos: [p.x, h.deck - 0.4, p.z], kind: 'nobori', size: [1.0, p.h - 1.6], color: '#e8e0d0' })),
    mastTops: [],
    fireSpots: [[0, 0.8, 0]],
    damageSpots: [[0, 0.6, sideZ(h, 0, 0.6)], [2, 0.6, -sideZ(h, 2, 0.6)]],
    ramTip: [L / 2, 1.0, 0],
  });
}

function mingAnchors(plan: MingPlan): ShipAnchors {
  const h = plan.hull;
  const L = h.length;
  const deck = h.deck;
  const c = plan.castle;
  const floor2 = deck + c.h1;
  const flagsAt = (x: number, z: number, hh: number, sheet: string, name: string, id: string): FlagMount => ({ id: `${id}:${sheet}/${name}`, pos: [x, deck + plan.parapet + 0.1, z], kind: 'pennant', size: [1.2, hh], color: '#8d7442' });
  return BASE(h, {
    mainDeck: deck,
    oarDeck: deck - 1.4,
    commandDeck: [c.x, floor2, 0],
    deckBounds: { x0: -L / 2 + 1.5, x1: L / 2 - 1.5, halfBeam: (x) => sideZ(h, x, deck) - 0.45 },
    gunPorts: sideGuns('mingship', h, deck + 0.9, 0.2),
    oarPorts: oarPorts(h, plan.oars),
    railStations: sideRail(h, -17, 16, 12, deck, 0.6),
    rowStations: sideRail(h, plan.oars.x0, plan.oars.x1, plan.oars.n, deck - 1.4, 1.5),
    boardingPoints: boarding(h, [-6, 0, 7, 14], deck + 0.2),
    lanterns: [
      [c.x + c.hx - 0.4, floor2 + 2.0, c.hz - 0.4],
      [c.x + c.hx - 0.4, floor2 + 2.0, -c.hz + 0.4],
      [c.x - c.hx + 0.4, floor2 + 2.0, c.hz - 0.4],
      [c.x - c.hx + 0.4, floor2 + 2.0, -c.hz + 0.4],
      [L / 2 - 1.5, deck + plan.parapet + 0.4, 0],
    ],
    flagMounts: [
      { id: 'command', pos: [c.x, floor2 + c.h2 + 2.3, 0], kind: 'command', size: [3.4, 2.8], color: '#5b2c26' },
      flagsAt(L / 2 - 1.5, -2.3, 1.0, 'flags_a', 'red', 'bow'),
      flagsAt(L / 2 - 1.5, 2.3, 1.0, 'flags_b', 'yellow', 'bow'),
      ...plan.masts.map((m, i): FlagMount => ({ id: `mast${i}`, pos: [m.x, deck + m.h + 0.2, 0], kind: 'pennant', size: [6, 1.0], color: i % 2 ? '#8d7442' : '#5b2c26' })),
    ],
    mastTops: plan.masts.map((m): V3 => [m.x, deck + m.h, 0]),
    fireSpots: [[0, deck + 0.3, 0], [9, deck + 0.3, 2], [-6, deck + 0.3, -2], [c.x, floor2 + 0.4, 0]],
    damageSpots: [
      [-12, deck - 0.8, sideZ(h, -12, deck - 0.8)],
      [-4, deck - 0.8, -sideZ(h, -4, deck - 0.8)],
      [6, deck - 0.8, sideZ(h, 6, deck - 0.8)],
      [14, deck - 0.8, -sideZ(h, 14, deck - 0.8)],
    ],
    ramTip: [L / 2, 1.2, 0],
  });
}

function mingSmallAnchors(plan: MingSmallPlan): ShipAnchors {
  const h = plan.hull;
  const L = h.length;
  const deck = h.deck;
  const c = plan.cabin;
  return BASE(h, {
    mainDeck: deck,
    oarDeck: null,
    deckBounds: { x0: -L / 2 + 1.3, x1: L / 2 - 1.5, halfBeam: (x) => sideZ(h, x, deck) - 0.4 },
    gunPorts: sideGuns('mingsmall', h, deck + 0.5, 0.15),
    oarPorts: oarPorts(h, plan.oars),
    railStations: sideRail(h, -6, 6, 5, deck, 0.5),
    rowStations: sideRail(h, plan.oars.x0, plan.oars.x1, plan.oars.n, deck, 0.6),
    boardingPoints: boarding(h, [-3, 3], deck + 0.2),
    lanterns: [[c.x + c.hx - 0.2, deck + c.h, c.hz + 0.1], [c.x + c.hx - 0.2, deck + c.h, -c.hz - 0.1]],
    flagMounts: [
      { id: 'command', pos: [c.x, deck + c.h + 1.3, 0], kind: 'ensign', size: [1.6, 1.4], color: '#5b2c26' },
      ...plan.masts.map((m, i): FlagMount => ({ id: `mast${i}`, pos: [m.x, deck + m.h + 0.2, 0], kind: 'pennant', size: [3.4, 0.7], color: i ? '#8d7442' : '#5b2c26' })),
    ],
    mastTops: plan.masts.map((m): V3 => [m.x, deck + m.h, 0]),
    fireSpots: [[0, deck + 0.3, 0], [c.x, deck + 0.4, 0]],
    damageSpots: [
      [-3, deck - 0.5, sideZ(h, -3, deck - 0.5)],
      [3, deck - 0.5, -sideZ(h, 3, deck - 0.5)],
    ],
    ramTip: [L / 2, 0.8, 0],
  });
}

const registry = new Map<string, ShipAnchors>();

/** Anchors of a procedural ship model by its key (`kind#variant`); undefined for kinds still on the legacy models. */
export function anchorsFor(key: string): ShipAnchors | undefined {
  const cached = registry.get(key);
  if (cached) return cached;
  const [kind, v] = key.split('#');
  const variant = Number(v ?? 0);
  let a: ShipAnchors | undefined;
  if (kind === 'panokseon') a = panokAnchors(PANOK_PLANS[variant] ?? PANOK_PLANS[0]!);
  else if (kind === 'geobukseon') a = geobukAnchors(GEOBUK_PLAN);
  else if (kind === 'hyeopseon') a = hyeopAnchors(HYEOP_PLAN);
  else if (kind === 'atakebune') a = atakeAnchors(ATAKE_PLANS[variant] ?? ATAKE_PLANS[0]!);
  else if (kind === 'sekibune') a = sekiAnchors(SEKI_PLANS[variant] ?? SEKI_PLANS[0]!);
  else if (kind === 'kobaya') a = kobayaAnchors(KOBAYA_PLAN);
  else if (kind === 'mingship') a = mingAnchors(MING_PLAN);
  else if (kind === 'mingsmall') a = mingSmallAnchors(MINGSMALL_PLAN);
  if (a) registry.set(key, a);
  return a;
}

export const PROCEDURAL_KINDS: ShipKind[] = ['panokseon', 'geobukseon', 'hyeopseon', 'atakebune', 'sekibune', 'kobaya', 'mingship', 'mingsmall'];
/** How many models a kind has. */
export const variantCount = (kind: ShipKind) => (kind === 'panokseon' ? PANOK_PLANS.length : kind === 'atakebune' ? ATAKE_PLANS.length : kind === 'sekibune' ? SEKI_PLANS.length : 1);

/** Model variant of the i-th ship of a kind in a fleet: the flagship keeps the first, the rest alternate through the others. */
export function variantFor(kind: ShipKind, i: number, flagship = false) {
  const n = variantCount(kind);
  if (n === 1) return 0;
  if (kind === 'panokseon') return flagship ? 0 : 1 + (i % 2);
  return i % n;
}
