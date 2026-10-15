import { SHIP_SPECS } from '../../sim/catalog';
import { MAP_ASPECT, project } from './projection';
import { campLevel } from './campArt';
import { FOOTPRINT, METRES_PER_RADIUS, WALL_KINDS, WATER_KINDS, type PieceKind } from './campPieces';
import type { BuildingKind, FactionId, FleetView, RegionView, ReplayView, ShipClass, SpotView } from './types';

// What stands on the campaign map besides the terrain: at every port a Korean town, the camp of the navy that holds it
// and the works it has built, standing round each other on the land like the districts of a Civilization city; and a
// few ships where a fleet lies. Pure layout, no three.js (mapLayer.ts turns it into instances), so every camp level and
// town can be tested alone.

/** A settlement's radius in frame units: a camp covers about this much ground. */
export const SETTLEMENT_RADIUS = 0.013;

/**
 * One building of a place: its offset from the place's centre in settlement radii, turned by `rot` about the vertical
 * (its front, +z, then looks towards (sin rot, cos rot)); a stretch of wall runs `len` radii along its own x.
 */
export interface Piece { kind: PieceKind; x: number; z: number; rot: number; len?: number }

/** A field by a town: its centre and half sizes in radii, its turn, a wet rice paddy or a dry field. */
export interface Field { x: number; z: number; hx: number; hz: number; rot: number; paddy: boolean }

/** What a place leaves bare on the ground, in radii from its centre: its packed-earth yard, its lanes and its fields. */
export interface Grounds { yard: number; lanes: { x: number; z: number }[][]; fields: Field[] }

/**
 * One place on the land: a port's camp (its id is the region's), its town (`<region>/town`) or its beacon on the hill
 * above it (`<region>/beacon`), with its pieces laid out round (u, v) and already turned to the sea. `radius` is how far
 * in radii its pieces reach.
 */
export interface SettlementSpec {
  id: string;
  region: string;
  kind: 'camp' | 'town' | 'beacon';
  u: number;
  v: number;
  owner: FactionId | null;
  /** The camp's level; 0 for a town or a beacon. */
  level: number;
  radius: number;
  pieces: Piece[];
  grounds: Grounds;
}

const m = (metres: number) => metres / METRES_PER_RADIUS;
/** A building at (x, z) whose front looks towards `face` (0 east, pi / 2 south). */
const put = (kind: PieceKind, x: number, z: number, face: number): Piece => ({ kind, x, z, rot: Math.PI / 2 - face });

/** The side of an unturned camp that looks out to sea: its pier stands here, its gate on the opposite side (angle 0). */
export const SEA_SIDE = Math.PI;

/**
 * A ring of `n` stretches of wall of radius r round the centre, `gap` radii left open at the gate (angle 0). Each
 * stretch runs chord to chord a little long, so the ring has no gaps at its joints.
 */
function ring(kind: PieceKind, r: number, n: number, gap: number): Piece[] {
  const g = gap > 0 ? gap / (2 * r) : 0, span = Math.PI * 2 - 2 * g;
  return Array.from({ length: n }, (_, i) => {
    const a0 = g + (span * i) / n, a1 = g + (span * (i + 1)) / n, a = (a0 + a1) / 2, half = (a1 - a0) / 2;
    const rr = r * Math.cos(half);
    return { kind, x: Math.cos(a) * rr, z: Math.sin(a) * rr, rot: Math.PI / 2 - a, len: 2 * r * Math.sin(half) * 1.06 };
  });
}

/** The four sides of a square wall `h` radii out, about `n` stretches a side, the east side open `gap` radii at the gate. */
function square(kind: PieceKind, h: number, n: number, gap: number): Piece[] {
  const out: Piece[] = [];
  for (let s = 0; s < 4; s += 1) {
    const a = (s * Math.PI) / 2, ca = Math.cos(a), sa = Math.sin(a);
    const runs: [number, number][] = s === 0 && gap > 0 ? [[-h, -gap / 2], [gap / 2, h]] : [[-h, h]];
    for (const [t0, t1] of runs) {
      const k = Math.max(1, Math.round((n * (t1 - t0)) / (2 * h)));
      for (let i = 0; i < k; i += 1) {
        const t = t0 + ((t1 - t0) * (i + 0.5)) / k;
        out.push({ kind, x: ca * h - sa * t, z: sa * h + ca * t, rot: Math.PI / 2 - a, len: ((t1 - t0) / k) * 1.04 });
      }
    }
  }
  return out;
}

/** The landing on the sea side, its seaward end out from the wall. */
const pierAt = (r: number) => put('pier', -(r + m(FOOTPRINT.pier[1])), 0, SEA_SIDE);

/** A camp before it is turned to the sea: what it is made of and how far it reaches. */
export interface CampPlan { pieces: Piece[]; radius: number }

/**
 * A Joseon naval camp: a log stockade round an office and huts; then a watchtower, more houses and a landing; at the top
 * a granite wall with its white parapet and a gate pavilion round the commander's hall, barracks, a powder store and
 * banners.
 */
function joseonCamp(level: number): CampPlan {
  const S = Math.PI / 2;
  if (level === 1) return {
    radius: 0.6,
    pieces: [...ring('palisade', 0.55, 11, m(7.8)), put('jo_gate', 0.55, 0, 0), put('giwa', -0.2, 0, 0), put('choga', 0.12, -0.3, S), put('choga', 0.12, 0.3, -S), put('jo_banner', 0.34, -0.22, Math.PI)],
  };
  if (level === 2) return {
    radius: 0.73,
    pieces: [
      ...ring('palisade', 0.68, 13, m(7.8)), put('jo_gate', 0.68, 0, 0), pierAt(0.68),
      put('giwa', -0.28, 0, 0), put('giwa', 0.06, -0.42, S), put('choga', 0.06, 0.42, -S), put('choga', 0.38, -0.32, S),
      put('jo_tower', -0.32, 0.4, 0), put('jo_banner', 0.42, 0.24, Math.PI),
    ],
  };
  const r = 0.84;
  const pieces = [
    ...ring('stone', r, 18, m(15)), put('fortgate', r, 0, 0), pierAt(r),
    put('hall', -0.3, 0, 0), put('giwa', 0.18, -0.5, S), put('giwa', 0.18, 0.5, -S), put('choga', 0.52, -0.3, S), put('choga', 0.52, 0.3, -S),
    put('magazine', -0.5, 0.38, 0), put('jo_tower', -0.5, -0.4, 0), put('jo_banner', 0.6, -0.16, Math.PI), put('jo_banner', 0.6, 0.16, Math.PI),
  ];
  // The gatehouse stands out of the ring by its depth.
  return { radius: r + 0.15, pieces };
}

/**
 * A Japanese camp (wajo): curtains round tents and nobori; then a residence hall, a turret and a landing; at the top a
 * stone-based plaster wall with a turret gate round a three-tier keep, barracks and a corner turret.
 */
function japanCamp(level: number): CampPlan {
  const S = Math.PI / 2;
  if (level === 1) return {
    radius: 0.58,
    pieces: [
      ...ring('wa_fence', 0.55, 11, 0.2), put('wa_tent', -0.25, -0.2, 0), put('wa_tent', -0.25, 0.2, 0), put('wa_tent', 0.05, -0.3, 0), put('wa_tent', 0.05, 0.3, 0),
      put('wa_banner', 0.34, -0.24, Math.PI), put('wa_banner', 0.34, 0.24, Math.PI),
    ],
  };
  if (level === 2) return {
    radius: 0.71,
    pieces: [
      ...ring('wa_fence', 0.68, 13, 0.22), pierAt(0.68), put('wa_hall', -0.3, 0, 0), put('wa_tent', 0.1, -0.42, 0), put('wa_tent', 0.1, 0.42, 0), put('wa_tent', 0.38, -0.32, 0),
      put('wa_tent', -0.05, -0.2, 0),
      put('wa_tower', -0.26, 0.36, 0), put('wa_banner', 0.44, 0.26, Math.PI), put('wa_banner', 0.44, -0.08, Math.PI),
    ],
  };
  const r = 0.84;
  const pieces = [
    ...ring('wa_wall', r, 16, m(17.2)), put('wa_gate', r, 0, 0), pierAt(r),
    put('wa_keep3', -0.3, 0, 0), put('wa_hall', 0.2, -0.48, S), put('wa_tower', -0.45, 0.4, 0),
    put('wa_tent', 0.22, 0.44, 0), put('wa_tent', 0.5, 0.3, 0), put('wa_tent', 0, 0.25, 0), put('wa_tent', 0.3, -0.2, 0),
    put('wa_banner', 0.58, -0.2, Math.PI), put('wa_banner', 0.58, 0.14, Math.PI),
  ];
  return { radius: r + 0.14, pieces };
}

/**
 * A Ming fort: a square stockade round a watchtower, tents and flags; then a brick wall with its gate tower round two
 * barracks and a landing; at the top a larger square with corner bastions round the yamen hall.
 */
function mingCamp(level: number): CampPlan {
  const S = Math.PI / 2;
  if (level === 1) return {
    radius: 0.72,
    pieces: [
      ...square('mg_palisade', 0.5, 3, 0.2), put('mg_watch', -0.28, -0.28, 0), put('mg_tent', -0.25, 0.2, 0), put('mg_tent', 0.12, -0.26, 0),
      put('mg_tent', 0.12, 0.26, 0), put('mg_flag', 0.32, 0.24, Math.PI),
    ],
  };
  const h = level === 2 ? 0.6 : 0.75, n = level === 2 ? 3 : 4;
  const pieces = [...square('mg_brick', h, n, m(16.4)), put('mg_gate', h, 0, 0), pierAt(h)];
  if (level === 2) {
    pieces.push(
      put('mg_barracks', -0.05, -0.36, S), put('mg_barracks', -0.05, 0.36, -S), put('mg_watch', -0.4, 0, 0), put('mg_flag', 0.38, -0.24, Math.PI),
      put('mg_tent', 0.38, 0.24, 0), put('mg_tent', -0.18, -0.12, 0), put('mg_tent', -0.18, 0.12, 0),
    );
    return { radius: h * Math.SQRT2 + 0.06, pieces };
  }
  pieces.push(
    ...[[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([sx, sz]) => put('mg_corner', sx! * h, sz! * h, 0)),
    put('mg_hall', -0.3, 0, 0), put('mg_barracks', 0.2, -0.47, S), put('mg_barracks', 0.2, 0.47, -S), put('mg_watch', -0.48, 0.46, 0),
    put('mg_tent', 0.1, -0.2, 0), put('mg_tent', 0.1, 0.2, 0), put('mg_tent', -0.5, -0.45, 0),
    put('mg_flag', 0.56, -0.2, Math.PI), put('mg_flag', 0.56, 0.2, Math.PI),
  );
  // The corner bastions stand out of the square's corners.
  return { radius: (h + 0.12) * Math.SQRT2, pieces };
}

/**
 * The camp of a level (1 to 3, the campaign's highest: a higher one is drawn as 3) and navy, unturned: its sea side
 * looks west (SEA_SIDE). Every navy's camp has its own look, and a higher level keeps every building of the one below it
 * (a stockade gate becomes a gatehouse, a stockade a wall).
 */
export function campPlan(level: number, navy: FactionId): CampPlan {
  if (navy === 'japan') return japanCamp(level);
  if (navy === 'ming') return mingCamp(level);
  return joseonCamp(level);
}

/** The pieces of a camp of this level and owner, unturned; none below level 1. */
export const settlementPieces = (level: number, navy: FactionId = 'joseon'): Piece[] => (level < 1 ? [] : campPlan(level, navy).pieces);

/** Trees keep this far beyond a place's buildings and fields, in radii: about six metres. */
const CLEARANCE = 0.15;

/** How far round its centre a place keeps the ground clear of trees, in frame units: its buildings, its fields and a margin. */
export function clearingRadius(s: SettlementSpec) {
  let reach = s.radius;
  for (const f of s.grounds.fields) reach = Math.max(reach, Math.hypot(f.x, f.z) + Math.hypot(f.hx, f.hz));
  return (reach + CLEARANCE) * SETTLEMENT_RADIUS;
}

/** Cheap string hash (FNV-1a) so each place keeps its own turn and its town its own houses between renders. */
export function hash(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** A small deterministic random stream from a seed (mulberry32). */
function stream(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A town before it is placed: its pieces and grounds round its centre (its +x looks towards the camp) and its reach. */
export interface TownPlan { pieces: Piece[]; grounds: Grounds; radius: number }

/** How many houses a port's town has, and how many of them are tiled, by the region's value and whether it is a seat. */
export function townSize(value: number, seat: boolean) {
  const houses = [5, 8, 11][Math.max(0, Math.min(2, value - 1))]! + (seat ? 2 : 0);
  return { houses, tiled: [1, 2, 4][Math.max(0, Math.min(2, value - 1))]! + (seat ? 1 : 0), pavilion: value >= 3 || seat };
}

/**
 * A Korean town: thatched houses and a few tiled ones along one lane (two in a larger town), each facing the lane across
 * its front yard inside stone garden walls, the village's old tree and pavilion where the lane comes in from the camp
 * (+x), fields beyond the last houses. A Japanese village (Tsushima) has its own houses. The seed shuffles which plot
 * gets which house and turns each a little, so no two towns are alike.
 */
export function townPlan(houses: number, tiled: number, seed: number, japanese = false, pavilion = false): TownPlan {
  const rnd = stream(seed);
  const lanes = houses > 6 ? [-0.42, 0.42] : [0];
  const xs = [0, -0.38, 0.38];
  // Plots: the middle of each lane first, both sides, then outwards; a larger town fills its second lane in turn.
  const plots: { x: number; lane: number; side: 1 | -1 }[] = [];
  for (const xi of [0, 1, 2]) for (const side of [1, -1] as const) for (let l = 0; l < lanes.length; l += 1) plots.push({ x: xs[xi]!, lane: lanes[l]!, side });
  for (let i = plots.length - 1; i > 0; i -= 1) {
    // A light shuffle: neighbours trade places, so the centre still fills first.
    if (rnd() < 0.35) [plots[i], plots[i - 1]] = [plots[i - 1]!, plots[i]!];
  }
  const pieces: Piece[] = [];
  const walls = new Map<string, Piece>();
  const wall = (x: number, z: number, along: 'x' | 'z', len: number) => {
    const key = `${along}${x.toFixed(3)},${z.toFixed(3)}`;
    if (!walls.has(key)) walls.set(key, { kind: 'doldam', x, z, rot: along === 'x' ? 0 : Math.PI / 2, len });
  };
  const used = plots.slice(0, Math.min(houses, plots.length));
  used.forEach((p, i) => {
    const kind: PieceKind = japanese ? 'wa_house' : i < tiled ? 'giwa' : 'choga';
    const z = p.lane + p.side * 0.24;
    // The house faces the lane: a plot north of the lane looks south.
    pieces.push({ kind, x: p.x + (rnd() - 0.5) * 0.04, z, rot: (p.side > 0 ? Math.PI : 0) + (rnd() - 0.5) * 0.12 });
    wall(p.x, p.lane + p.side * 0.385, 'x', 0.38);
    for (const sx of [-1, 1]) wall(p.x + sx * 0.19, p.lane + p.side * 0.235, 'z', 0.3);
  });
  pieces.push(...walls.values());
  // Where the lane comes in from the camp: the village tree, and the pavilion of a larger town.
  const mid = lanes.length > 1 ? 0 : -0.14;
  pieces.push(put('tree', 0.64, mid, 0));
  if (pavilion) pieces.push(put('jeongja', 0.66, mid + (lanes.length > 1 ? 0.24 : 0.36), Math.PI));
  // Fields beyond the far end of each lane.
  const fields: Field[] = [];
  for (const lane of lanes) for (const side of [-1, 1]) fields.push({ x: -0.82, z: lane + side * 0.15, hx: 0.14, hz: 0.12, rot: (rnd() - 0.5) * 0.1, paddy: rnd() < 0.6 });
  const roads = lanes.map((z) => [{ x: -0.62, z }, { x: 0.8, z }]);
  if (lanes.length > 1) roads.push([{ x: 0.58, z: lanes[0]! }, { x: 0.58, z: lanes[1]! }]);
  let radius = 0;
  for (const p of pieces) {
    const [hx, hz] = FOOTPRINT[p.kind];
    radius = Math.max(radius, Math.hypot(Math.abs(p.x) + (p.len ?? m(hx)) / 2 + m(hz), Math.abs(p.z) + m(hz)));
  }
  for (const f of fields) radius = Math.max(radius, Math.hypot(Math.abs(f.x) + f.hx, Math.abs(f.z) + f.hz));
  return { pieces, grounds: { yard: 0, lanes: roads, fields }, radius };
}

/** The works a region can build and the kind each is drawn as for a navy. */
const WORKS: Partial<Record<BuildingKind, Record<FactionId, PieceKind>>> = {
  battery: { joseon: 'jo_battery', japan: 'wa_battery', ming: 'mg_battery' },
  shipyard: { joseon: 'jo_yard', japan: 'wa_yard', ming: 'mg_yard' },
  dock: { joseon: 'jo_dock', japan: 'wa_dock', ming: 'mg_dock' },
  granary: { joseon: 'jo_granary', japan: 'wa_granary', ming: 'mg_granary' },
  beacon: { joseon: 'jo_beacon', japan: 'wa_beacon', ming: 'mg_beacon' },
};
/** The piece a region's work is drawn as, in the style of whoever holds the port (Korea's own while nobody does). */
export const workKind = (work: BuildingKind, owner: FactionId | null): PieceKind | null => WORKS[work]?.[owner ?? 'joseon'] ?? null;

/** Frame point to "is this open water". */
export type IsSea = (u: number, v: number) => boolean;

/** Which way (east, south) a port's places are shifted from its marker, by the side the label takes. */
const LABEL_AWAY: Record<'b' | 't' | 'l' | 'r', [number, number]> = { b: [0, -1], t: [0, 1], l: [1, 0], r: [-1, 0] };

/** How far apart a lane is tested for water, and the shortest stretch of one worth drawing, in radii. */
const LANE_STEP = 0.05;
const LANE_LEAST = 0.15;

/**
 * The stretches of a lane that run over land, the lane's points in radii from a place at (cx, cz): a lane stops at the
 * first point of it found on the water and goes on where the land comes back, so no lane is drawn across a bay. A
 * stretch shorter than LANE_LEAST is left out.
 */
export function dryStretches(lane: { x: number; z: number }[], cx: number, cz: number, land: (x: number, z: number) => boolean) {
  const runs: { x: number; z: number }[][] = [];
  let run: { x: number; z: number }[] = [];
  for (let i = 0; i + 1 < lane.length; i += 1) {
    const a = lane[i]!, b = lane[i + 1]!;
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / LANE_STEP));
    for (let k = i === 0 ? 0 : 1; k <= n; k += 1) {
      const p = { x: a.x + ((b.x - a.x) * k) / n, z: a.z + ((b.z - a.z) * k) / n };
      if (land(cx + p.x, cz + p.z)) run.push(p);
      else if (run.length) {
        runs.push(run);
        run = [];
      }
    }
  }
  if (run.length) runs.push(run);
  const length = (r: { x: number; z: number }[]) => r.reduce((n, p, j) => (j ? n + Math.hypot(p.x - r[j - 1]!.x, p.z - r[j - 1]!.z) : 0), 0);
  // Each stretch keeps its ends and the lane's corners; the points tested in between lie on its straight runs.
  return runs.filter((r) => length(r) >= LANE_LEAST).map((r) => r.filter((p, j) => {
    if (j === 0 || j === r.length - 1) return true;
    const a = r[j - 1]!, b = r[j + 1]!;
    return Math.abs((p.x - a.x) * (b.z - p.z) - (p.z - a.z) * (b.x - p.x)) > 1e-9;
  }));
}

/** Turns a place's pieces by `turn` (its x towards its z) round its centre. */
export function turnPieces(pieces: Piece[], turn: number): Piece[] {
  const c = Math.cos(turn), s = Math.sin(turn);
  return pieces.map((p) => ({ ...p, x: p.x * c - p.z * s, z: p.x * s + p.z * c, rot: p.rot - turn }));
}

/**
 * The turn that puts a camp's sea side towards the most open water, with `sea` taking an offset in radii: of sixteen
 * turns the one with the most water off its sea side wins, ties going to the seed so neighbouring camps differ. Also
 * how much water it found, out of nine probes.
 */
function seaTurn(r: number, seed: number, sea: (x: number, z: number) => boolean) {
  let best = { turn: ((seed % 16) / 16) * Math.PI * 2, score: -1 };
  for (let k = 0; k < 16; k += 1) {
    const turn = (((k + seed) % 16) / 16) * Math.PI * 2;
    let score = 0;
    for (const d of [r + 0.15, r + 0.45, r + 0.9]) for (const spread of [-0.35, 0, 0.35]) {
      const a = SEA_SIDE + turn + spread;
      if (sea(Math.cos(a) * d, Math.sin(a) * d)) score += 1;
    }
    if (score > best.score) best = { turn, score };
  }
  return best;
}

/** Turns a camp's pieces so its sea side looks at the most open sea; the same seed always turns the same way. */
export function faceSea(pieces: Piece[], seed: number, isSea: (x: number, z: number) => boolean): { pieces: Piece[]; turn: number } {
  const { turn } = seaTurn(1, seed, isSea);
  return { turn, pieces: turnPieces(pieces, turn) };
}

/** The corners of a piece's footprint in radii, on the place whose centre is (cx, cz). */
function corners(p: Piece, cx = 0, cz = 0): [number, number][] {
  const [fx, fz] = FOOTPRINT[p.kind];
  const hx = p.len !== undefined ? p.len / 2 : m(fx), hz = m(fz);
  const c = Math.cos(p.rot), s = Math.sin(p.rot);
  // Local x goes to (cos rot, -sin rot), local z to (sin rot, cos rot).
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, w]) => [cx + p.x + u! * hx * c + w! * hz * s, cz + p.z - u! * hx * s + w! * hz * c]);
}

/** Ground already taken: a disc in radii. */
interface Disc { x: number; z: number; r: number }

/** A port as the layout sees it: its region, its marker in radii (x east, z south) and the way its places lean from it. */
interface Port { r: RegionView; x: number; z: number; ax: number; az: number; seed: number; level: number }

/** Probe points of a disc: its centre and two rings, in radii from it. */
const probes = (r: number) => [[0, 0], ...[0.45, 0.88].flatMap((k) => Array.from({ length: 10 }, (_, i) => [Math.cos((i / 10) * Math.PI * 2 + k) * r * k, Math.sin((i / 10) * Math.PI * 2 + k) * r * k]))] as [number, number][];

/** A step of the spiral of candidate spots round a preferred one: distances `ds`, `n` directions each. */
function* spiral(x: number, z: number, ds: number[], n: number) {
  for (const d of ds) for (let i = 0; i < (d === 0 ? 1 : n); i += 1) {
    const a = (i / n) * Math.PI * 2 + d * 1.7;
    yield { x: x + Math.cos(a) * d, z: z + Math.sin(a) * d, d };
  }
}

/**
 * Every on-map port's places: its camp, when its owner has built one, on the coast by the port with its sea side and pier
 * towards the open water; its Korean town beside the camp on the land side, its lane running to the camp's gate; the
 * works it has built round them (battery on the shore looking out to sea, shipyard and dock on the waterline, granary by
 * the town) and its beacon on the high ground inland. Larger camps choose first. Every place stands on land and keeps
 * clear of every other port's; without `isSea` (before the relief has loaded) each simply stands by its port.
 */
export function layoutSettlements(regions: RegionView[], isSea?: IsSea): SettlementSpec[] {
  const R = SETTLEMENT_RADIUS;
  const sea = (x: number, z: number) => !!isSea && isSea(x * R, z * R * MAP_ASPECT);
  const land = (x: number, z: number) => !isSea || !isSea(x * R, z * R * MAP_ASPECT);
  const landShare = (x: number, z: number, r: number) => {
    const list = probes(r);
    return list.filter(([dx, dz]) => land(x + dx, z + dz)).length / list.length;
  };
  const taken: Disc[] = [];
  const free = (x: number, z: number, r: number) => taken.every((o) => Math.hypot(x - o.x, z - o.z) >= r + o.r);
  const ports: Port[] = regions.filter((r) => !r.offMap).map((r) => {
    const p = project(r.lon, r.lat);
    const [ax, az] = LABEL_AWAY[r.labelSide ?? 'b'];
    return { r, x: p.u / R, z: p.v / MAP_ASPECT / R, ax, az, seed: hash(r.id), level: r.owner ? campLevel(r) : 0 };
  });
  const out: SettlementSpec[] = [];
  const place = (id: string, region: string, kind: SettlementSpec['kind'], x: number, z: number, owner: FactionId | null, level: number, pieces: Piece[], grounds: Grounds) => {
    const radius = pieces.reduce((n, p) => Math.max(n, ...corners(p).map(([cx, cz]) => Math.hypot(cx, cz))), 0.2);
    const spec: SettlementSpec = { id, region, kind, u: x * R, v: z * R * MAP_ASPECT, owner, level, radius, pieces, grounds };
    out.push(spec);
    return spec;
  };
  const camps = new Map<string, { x: number; z: number; turn: number; r: number; spec: SettlementSpec }>();
  // Camps, the highest level first.
  const withCamps = ports.filter((p) => p.level > 0).sort((a, b) => b.level - a.level || b.r.value - a.r.value);
  for (const port of withCamps) {
    const plan = campPlan(port.level, port.r.owner!);
    const r = plan.radius;
    const want = { x: port.x + port.ax * 1.1, z: port.z + port.az * 1.1 };
    let best: { x: number; z: number; turn: number; cost: number } | null = null;
    if (isSea) {
      for (const strict of [true, false]) {
        for (const c of spiral(want.x, want.z, [0, 0.2, 0.4, 0.6, 0.8, 1.0, 1.25, 1.5, 1.8], 16)) {
          if (!free(c.x, c.z, r + 0.04)) continue;
          const ground = landShare(c.x, c.z, r * 0.88);
          if (ground < (strict ? 0.95 : 0.7)) continue;
          const t = seaTurn(r, port.seed, (dx, dz) => sea(c.x + dx, c.z + dz));
          if (t.score < (strict ? 3 : 1)) continue;
          const cost = c.d + (9 - t.score) * 0.05 + (1 - ground) * 2;
          if (!best || cost < best.cost) best = { x: c.x, z: c.z, turn: t.turn, cost };
        }
        if (best) break;
      }
    }
    const spot = best ?? { ...want, turn: seaTurn(r, port.seed, (dx, dz) => sea(want.x + dx, want.z + dz)).turn };
    let pieces = turnPieces(plan.pieces, spot.turn);
    // The ring opens where the shore cuts into it, and the pier reaches from the shore out over the water.
    pieces = pieces.filter((p) => !WALL_KINDS.has(p.kind) || corners(p, spot.x, spot.z).every(([cx, cz]) => land(cx, cz)));
    pieces = pieces.flatMap((p) => (WATER_KINDS.has(p.kind) ? shore(p, spot.x, spot.z, land) : [p]));
    // The packed yard inside the wall, short of it so the wall stands on grass.
    const spec = place(port.r.id, port.r.id, 'camp', spot.x, spot.z, port.r.owner, port.level, pieces, { yard: r * 0.62, lanes: [], fields: [] });
    taken.push({ x: spot.x, z: spot.z, r });
    camps.set(port.r.id, { x: spot.x, z: spot.z, turn: spot.turn, r, spec });
  }
  // Towns, the larger first; each by its camp's gate when it has one, else by its port.
  const byValue = [...ports].sort((a, b) => b.r.value - a.r.value || Number(!!b.r.seat) - Number(!!a.r.seat));
  for (const port of byValue) {
    const camp = camps.get(port.r.id);
    const size = townSize(port.r.value, !!port.r.seat);
    let town: { plan: TownPlan; x: number; z: number; cost: number } | null = null;
    for (let houses = size.houses; houses >= 3 && !town; houses -= 2) {
      const plan = townPlan(houses, Math.min(size.tiled, houses - 2), port.seed, port.r.korea === false, size.pavilion && houses === size.houses);
      const rt = plan.radius;
      const spots = camp
        ? [...spiral(camp.x, camp.z, [0.06, 0.35, 0.7, 1.1, 1.6, 2.2].map((d) => camp.r + rt + d), 20)].map((c) => ({ ...c, d: c.d - camp.r - rt }))
        : [...spiral(port.x + port.ax * 0.9, port.z + port.az * 0.9, [0, 0.25, 0.5, 0.8, 1.1, 1.5, 1.9, 2.4, 3.0], 16)];
      for (const c of spots) {
        if (!free(c.x, c.z, rt + 0.03)) continue;
        const ground = landShare(c.x, c.z, rt * 0.92);
        if (ground < 0.8) continue;
        // Beside the camp: best on its land side, by its gate (the camp's angle 0 after its turn).
        const gate = camp ? Math.abs(Math.atan2(Math.sin(Math.atan2(c.z - camp.z, c.x - camp.x) - camp.turn), Math.cos(Math.atan2(c.z - camp.z, c.x - camp.x) - camp.turn))) : 0;
        const cost = c.d + gate * 0.35 + (1 - ground) * 1.5;
        if (!town || cost < town.cost) town = { plan, x: c.x, z: c.z, cost };
      }
      if (!isSea && !town) town = { plan, x: spots[0]!.x, z: spots[0]!.z, cost: 0 };
    }
    if (!town) continue;
    // The town looks towards its camp (or its port): its lane comes in from there.
    const to = camp ?? { x: port.x, z: port.z };
    const turn = Math.atan2(to.z - town.z, to.x - town.x);
    const keep = turnPieces(town.plan.pieces, turn).filter((p) => corners(p, town!.x, town!.z).every(([cx, cz]) => land(cx, cz)));
    const c = Math.cos(turn), s = Math.sin(turn);
    const rotate = (q: { x: number; z: number }) => ({ x: q.x * c - q.z * s, z: q.x * s + q.z * c });
    const drawn = town.plan.grounds.lanes.map((lane) => lane.map(rotate));
    if (camp) {
      // A lane from the town's end out to the camp's gate.
      const gate = { x: camp.x + Math.cos(camp.turn) * (camp.r + 0.05) - town.x, z: camp.z + Math.sin(camp.turn) * (camp.r + 0.05) - town.z };
      drawn.push([rotate({ x: 0.8, z: 0 }), gate]);
    }
    const lanes = drawn.flatMap((lane) => dryStretches(lane, town!.x, town!.z, land));
    const fields = town.plan.grounds.fields.map((f) => ({ ...f, ...rotate(f), rot: f.rot + turn })).filter((f) => land(town!.x + f.x, town!.z + f.z));
    place(`${port.r.id}/town`, port.r.id, 'town', town.x, town.z, port.r.owner, 0, keep, { yard: 0, lanes, fields });
    taken.push({ x: town.x, z: town.z, r: town.plan.radius });
  }
  // Works, round the camp (or the town when there is none), in the style of whoever holds the port.
  for (const port of ports) {
    const camp = camps.get(port.r.id);
    const base = camp?.spec ?? out.find((s) => s.id === `${port.r.id}/town`);
    if (!base) continue;
    const bx = base.u / R, bz = base.v / R / MAP_ASPECT;
    // Round a camp the works stand just outside its wall (its landing reaches further out over the water).
    const reach = camp ? camp.r : base.radius;
    for (const b of port.r.buildings) {
      if (b.kind === 'camp' || b.level < 1) continue;
      const kind = workKind(b.kind, port.r.owner);
      if (!kind) continue;
      const work = placeWork(kind, b.kind, port.seed, bx, bz, reach, { sea, land, free, isSea: !!isSea });
      if (!work) continue;
      taken.push({ x: work.x, z: work.z, r: work.r });
      if (b.kind === 'beacon') place(`${port.r.id}/beacon`, port.r.id, 'beacon', work.x, work.z, port.r.owner, 0, [{ ...work.piece, x: 0, z: 0 }], { yard: 0, lanes: [], fields: [] });
      else {
        base.pieces.push({ ...work.piece, x: work.x - bx, z: work.z - bz });
        base.radius = Math.max(base.radius, Math.hypot(work.x - bx, work.z - bz) + work.r);
      }
    }
  }
  return out;
}

/**
 * A water piece slid along its own axis until its landward end stands on the shore and its far end over the water, or
 * left out when no such place is near (a landing cannot stand inland).
 */
function shore(p: Piece, cx: number, cz: number, land: (x: number, z: number) => boolean): Piece[] {
  const half = m(FOOTPRINT[p.kind][1]);
  const dx = Math.sin(p.rot), dz = Math.cos(p.rot);
  for (let k = 0; k <= 24; k += 1) {
    const shift = (k % 2 ? -1 : 1) * Math.ceil(k / 2) * 0.05;
    const x = p.x + dx * shift, z = p.z + dz * shift;
    const back = land(cx + x - dx * half * 0.85, cz + z - dz * half * 0.85);
    const front = !land(cx + x + dx * half * 0.6, cz + z + dz * half * 0.6) && !land(cx + x + dx * half * 0.95, cz + z + dz * half * 0.95);
    if (back && front) return [{ ...p, x, z }];
  }
  return [];
}

/**
 * Where a work of `kind` stands round a place of radius `r` at (bx, bz), in radii: a battery on the land at the shore,
 * its guns towards the water; a shipyard or dock across the waterline; a granary on the land close by; a beacon on the
 * most inland ground within a couple of radii. Null when nothing fits.
 */
function placeWork(kind: PieceKind, work: BuildingKind, seed: number, bx: number, bz: number, r: number,
  o: { sea: (x: number, z: number) => boolean; land: (x: number, z: number) => boolean; free: (x: number, z: number, r: number) => boolean; isSea: boolean }) {
  const [fx, fz] = FOOTPRINT[kind];
  const reach = Math.hypot(m(fx), m(fz));
  const onLand = (p: Piece, x: number, z: number) => corners({ ...p, x: 0, z: 0 }, x, z).every(([cx, cz]) => o.land(cx, cz));
  let best: { x: number; z: number; piece: Piece; cost: number } | null = null;
  const n = 24;
  for (let i = 0; i < n; i += 1) {
    const a = ((i + (seed % n)) / n) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
    let piece = put(kind, 0, 0, work === 'granary' || work === 'beacon' ? a + Math.PI : a);
    if (work === 'shipyard' || work === 'dock') {
      // Out along the ray to the first water, the piece across the waterline there.
      for (let d = r + 0.05; d <= r + 1.3; d += 0.05) {
        if (o.isSea && !o.sea(bx + ca * d, bz + sa * d)) continue;
        const half = m(fz), x = bx + ca * (d + half * 0.1), z = bz + sa * (d + half * 0.1);
        const ok = !o.isSea || (o.land(x - ca * half * 0.85, z - sa * half * 0.85) && o.sea(x + ca * half * 0.6, z + sa * half * 0.6) && o.sea(x + ca * half * 0.95, z + sa * half * 0.95));
        if (ok && o.free(x, z, reach * 0.62)) {
          const cost = d - r;
          if (!best || cost < best.cost) best = { x, z, piece, cost };
        }
        break;
      }
      continue;
    }
    for (const extra of work === 'beacon' ? [0.9, 1.3, 1.7, 2.1] : [0.06, 0.25, 0.45]) {
      const d = r + reach + extra, x = bx + ca * d, z = bz + sa * d;
      let cost = extra;
      if (work === 'battery') {
        // On the shore, its guns turned to the nearest open water.
        let aim = { face: a, ahead: 0 };
        for (let k = 0; k < 8; k += 1) {
          const f = (k / 8) * Math.PI * 2, ahead = [0.2, 0.4, 0.6].filter((q) => o.sea(x + Math.cos(f) * (m(fz) + q), z + Math.sin(f) * (m(fz) + q))).length;
          if (ahead > aim.ahead) aim = { face: f, ahead };
        }
        if (o.isSea && aim.ahead < 1) continue;
        piece = put(kind, 0, 0, aim.face);
        cost += (3 - aim.ahead) * 0.3;
      }
      if (!o.free(x, z, reach) || !onLand(piece, x, z)) continue;
      if (work === 'beacon') {
        // High ground: as far from the water as the ring allows.
        const inland = [0.5, 0.9].reduce((nn, k) => nn + Array.from({ length: 8 }, (_, j) => o.land(x + Math.cos(j * 0.785) * k, z + Math.sin(j * 0.785) * k)).filter(Boolean).length, 0);
        cost -= inland * 0.12;
      }
      if (!best || cost < best.cost) best = { x, z, piece, cost };
      break;
    }
  }
  return best ? { ...best, r: reach } : null;
}

/**
 * The last layout and what it was made from: buildWorld runs whenever a fleet moves, and the places only change with
 * the ports (owner, camp, works) or with the relief.
 */
let memo: { key: string; isSea?: IsSea; settlements: SettlementSpec[] } | null = null;
function settled(regions: RegionView[], isSea?: IsSea) {
  const key = JSON.stringify(regions.map((r) => [r.id, r.owner, r.lon, r.lat, r.value, r.seat, r.korea, r.offMap, r.labelSide, r.buildings.map((b) => [b.kind, b.level, b.maxLevel])]));
  if (!memo || memo.key !== key || memo.isSea !== isSea) memo = { key, isSea, settlements: layoutSettlements(regions, isSea) };
  return memo.settlements;
}

export interface FleetSpec {
  key: string; u: number; v: number; faction: FactionId; count: number; seed: number;
  /** The kind of each of its `count` hulls, the largest first; empty when its ships' kinds are not known. */
  kinds: ShipClass[];
  /** Bow direction in frame units, or null at anchor. */
  heading: { du: number; dv: number } | null;
  /** At anchor: each hull's berth, in settlement radii from (u, v) with its bow heading; empty when the sea is not known. */
  berths: Berth[];
}
/** A hull at anchor: its place in settlement radii from the port and its heading (from +z towards +x). */
export interface Berth { x: number; z: number; rot: number }
/** A fleet that sailed during the closed turn, for the 3D ships to follow: its way as points in map units (x east, z south) and how many hulls. */
export interface SailSpec { key: string; faction: FactionId; count: number; points: { x: number; z: number }[]; lost: boolean }
export interface MapWorld { settlements: SettlementSpec[]; fleets: FleetSpec[]; sails: SailSpec[] }

/**
 * A hull's length in settlement radii: a ship reads as a ship beside a camp, about a quarter of the camp's width, and a
 * squadron of five at anchor still fits in a cove.
 */
export const HULL_LENGTH = 0.55;

/** At most this many hulls over the whole map, whatever the fleets: the layer stops adding ships here. */
export const SHIP_CAP = 140;

/** How many hulls a force is drawn with: a few for a small squadron, never more than five. */
export const hullsFor = (ships: number) => (ships < 1 ? 0 : Math.min(5, Math.ceil(Math.sqrt(ships / 1.5))));

/**
 * The kinds a force's `count` hulls are drawn as: picked evenly from its ships ordered largest first, so the flagship
 * leads and each kind shows about as often as it sails. None when no ship's kind is known.
 */
export function drawnKinds(kinds: ShipClass[], count: number): ShipClass[] {
  const known = kinds.filter((k) => SHIP_SPECS[k]).sort((a, b) => SHIP_SPECS[b].length - SHIP_SPECS[a].length);
  if (!known.length) return [];
  return Array.from({ length: count }, (_, i) => known[Math.floor(((i + 0.5) * known.length) / count)]!);
}

/**
 * How far along its lane a fleet in transit is, kept off both ports so it stays clear of their discs: the share of the
 * lane's turns already sailed, or the middle when the lane's length is unknown.
 */
export function transitShare(left: number, turns: number | undefined) {
  if (!turns || turns < 1) return 0.5;
  return Math.min(0.75, Math.max(0.25, (turns - left) / turns));
}

/** A fleet on a lane is kept at least this share of the lane off either port, so its ships clear the port's disc. */
const LANE_MARGIN = 0.08;

/**
 * Where the lane between two ports has the fleet that left `from` for `to`, and the share it has sailed: `progress` when
 * the campaign says how far it got (kept a little off both ports), otherwise the share its turns give. With `isSea` the
 * spot moves to the nearest open water, along the lane (never closer than the margin to either port) or up to two camp
 * radii to its side, so the hulls do not stand on an island the straight lane crosses; the map's marker takes the same spot.
 */
export function transitSpot(from: RegionView, to: RegionView, left: number, isSea?: IsSea, progress?: number) {
  const want = progress === undefined ? transitShare(left, from.laneTurns?.[to.id]) : Math.min(1 - LANE_MARGIN, Math.max(LANE_MARGIN, progress));
  const pa = project(from.lon, from.lat), pb = project(to.lon, to.lat);
  // Along and across the lane in frame units, where v is MAP_ASPECT times shorter than u.
  const lu = pb.u - pa.u, lz = (pb.v - pa.v) / MAP_ASPECT;
  const length = Math.hypot(lu, lz) || 1;
  const at = (share: number, side: number) => ({ u: pa.u + lu * share + (lz / length) * side, v: pa.v + (lz * share - (lu / length) * side) * MAP_ASPECT });
  let best = { share: want, side: 0, cost: Infinity };
  if (isSea) {
    for (let step = -35; step <= 35; step += 1) {
      const share = want + step * 0.02;
      if (share < LANE_MARGIN || share > 1 - LANE_MARGIN) continue;
      for (let k = -4; k <= 4; k += 1) {
        const side = k * SETTLEMENT_RADIUS * 0.5;
        const cost = Math.abs(share - want) * length + Math.abs(side);
        if (cost >= best.cost) continue;
        const p = at(share, side);
        if (isSea(p.u, p.v)) best = { share, side, cost };
      }
    }
  }
  return { share: best.share, ...at(best.share, best.side), du: lu, dv: pb.v - pa.v };
}

/**
 * The ports' places (camps, towns and beacons, see layoutSettlements), ships for every fleet in port (one group per
 * faction) or on a lane (kept off land when `isSea` is given), and the closed turn's sailings.
 */
export function buildWorld(regions: RegionView[], fleets: FleetView[], replay: ReplayView | null = null, isSea?: IsSea): MapWorld {
  const byId = new Map(regions.map((r) => [r.id, r]));
  const settlements = settled(regions, isSea);
  const groups = new Map<string, FleetSpec & { ships: ShipClass[] }>();
  for (const f of fleets) {
    if (!f.ships.length) continue;
    const ships = f.ships.map((s) => s.kind);
    if (f.at) {
      const r = byId.get(f.at);
      if (!r) continue;
      const key = `${f.at}/${f.faction}`;
      const g = groups.get(key);
      if (g) { g.ships.push(...ships); continue; }
      const p = project(r.lon, r.lat);
      groups.set(key, { key, u: p.u, v: p.v, faction: f.faction, count: 0, kinds: [], seed: hash(key), heading: null, berths: [], ships });
    } else if (f.transit) {
      const spot = laneSpot(f, byId, isSea);
      if (!spot) continue;
      groups.set(f.id, { key: f.id, u: spot.u, v: spot.v, faction: f.faction, count: 0, kinds: [], seed: hash(f.id), heading: { du: spot.du, dv: spot.dv }, berths: [], ships });
    }
  }
  const out: FleetSpec[] = [];
  for (const { ships, ...g } of groups.values()) {
    const count = hullsFor(ships.length);
    out.push({ ...g, count, kinds: drawnKinds(ships, count) });
  }
  if (isSea) berthFleets(out, byId, settlements, isSea);
  keepApart(out, isSea);
  return { settlements, fleets: out, sails: replay ? buildSails(replay, byId) : [] };
}

/**
 * Squadrons that stopped on their lanes close to each other (two navies meeting at sea) are drawn apart, so their ships
 * and markers do not lie on top of one another: each moves half the shortfall away from the other, onto water if it can.
 */
function keepApart(fleets: FleetSpec[], isSea?: IsSea) {
  const gap = SETTLEMENT_RADIUS * HULL_LENGTH * 3;
  const sailing = fleets.filter((f) => f.heading);
  for (let i = 0; i < sailing.length; i += 1) for (let j = i + 1; j < sailing.length; j += 1) {
    const a = sailing[i]!, b = sailing[j]!;
    const dx = b.u - a.u, dz = (b.v - a.v) / MAP_ASPECT, d = Math.hypot(dx, dz);
    if (d >= gap) continue;
    // Apart along the line between them; on the very same spot, across the first one's lane.
    const h = a.heading!, l = Math.hypot(h.du, h.dv / MAP_ASPECT) || 1;
    const [ux, uz] = d > 1e-9 ? [dx / d, dz / d] : [h.dv / MAP_ASPECT / l, -h.du / l];
    const shift = (gap - d) / 2;
    for (const [f, sign] of [[a, -1], [b, 1]] as const) {
      const u = f.u + sign * ux * shift, v = f.v + sign * uz * shift * MAP_ASPECT;
      if (!isSea || isSea(u, v)) { f.u = u; f.v = v; }
    }
  }
}

/** Where a fleet in transit stands on its lane (see `transitSpot`), or null when a port of its lane is unknown. */
export function laneSpot(f: FleetView, byId: Map<string, RegionView>, isSea?: IsSea) {
  const lane = f.transit;
  const a = lane && byId.get(lane.from), b = lane && byId.get(lane.to);
  if (!lane || !a || !b) return null;
  // How far along the lane the campaign has it, when it says so: a fleet may stop anywhere on its way.
  return transitSpot(a, b, lane.left, isSea, lane.progress);
}

/**
 * Berths for every squadron at anchor. The port's owner chooses first, so a besieger anchors off the port beside it;
 * every hull stays clear of the port's places (the camp with its landing, the town, the works on the waterline) and of
 * the hulls already berthed there.
 */
function berthFleets(fleets: FleetSpec[], byId: Map<string, RegionView>, settlements: SettlementSpec[], isSea: IsSea) {
  const byPort = new Map<string, FleetSpec[]>();
  for (const f of fleets) {
    if (f.heading) continue;
    const port = f.key.slice(0, f.key.lastIndexOf('/'));
    byPort.set(port, [...(byPort.get(port) ?? []), f]);
  }
  for (const [port, list] of byPort) {
    const owner = byId.get(port)?.owner;
    list.sort((a, b) => Number(b.faction === owner) - Number(a.faction === owner));
    const { u, v } = list[0]!;
    const avoid: Circle[] = settlements.filter((s) => s.region === port).map((s) => ({ x: (s.u - u) / SETTLEMENT_RADIUS, z: (s.v - v) / MAP_ASPECT / SETTLEMENT_RADIUS, r: s.radius + 0.1 }));
    const seaAt = (x: number, z: number) => isSea(u + x * SETTLEMENT_RADIUS, v + z * SETTLEMENT_RADIUS * MAP_ASPECT);
    for (const f of list) {
      f.berths = anchorage(f.count, f.seed, seaAt, avoid);
      for (const b of f.berths) avoid.push({ x: b.x, z: b.z, r: HULL_LENGTH * 0.8 });
    }
  }
}

/** The ways the closed turn's fleets sailed, as points on the map. A move whose ports are not on the map is left out. */
export function buildSails(replay: ReplayView, byId: Map<string, RegionView>): SailSpec[] {
  const sails: SailSpec[] = [];
  const spotAt = (s: SpotView) => {
    const a = byId.get(s.at);
    if (!a) return null;
    const pa = project(a.lon, a.lat);
    const b = s.to ? byId.get(s.to) : undefined;
    const pb = b ? project(b.lon, b.lat) : pa;
    const share = s.t ?? 0;
    return { x: pa.u + (pb.u - pa.u) * share - 0.5, z: (pa.v + (pb.v - pa.v) * share - 0.5) / MAP_ASPECT };
  };
  for (const m of replay.moves) {
    const points = m.path.map(spotAt).filter((p): p is { x: number; z: number } => !!p);
    const count = hullsFor(m.ships);
    if (points.length >= 2 && count) sails.push({ key: m.id, faction: m.faction, count, points, lost: m.lost });
  }
  return sails;
}

/** The point a share of the way along a polyline, and the bow direction there (angle from +z towards +x). */
export function pointAlong(points: { x: number; z: number }[], share: number) {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) total += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.z - points[i - 1]!.z);
  let left = total * Math.min(1, Math.max(0, share));
  let angle = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]!, b = points[i]!;
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    if (d > 0) angle = Math.atan2(b.x - a.x, b.z - a.z);
    if (left <= d && d > 0) return { x: a.x + ((b.x - a.x) * left) / d, z: a.z + ((b.z - a.z) * left) / d, angle };
    left -= d;
  }
  const end = points[points.length - 1]!;
  return { x: end.x, z: end.z, angle };
}

/**
 * Where each hull of a squadron of `count` rides relative to its leader, in hull lengths: `along` is behind it (negative),
 * `across` to starboard. A wedge rather than a column: the hulls of one rank ride abreast clear of each other's beam, so a
 * squadron stays about two hulls deep and does not trail back over the port it left.
 */
export function formation(count: number): { along: number; across: number }[] {
  const out: { along: number; across: number }[] = [];
  for (let k = 0; k < count; k += 1) {
    const rank = Math.ceil(k / 2);
    out.push({ along: rank ? -rank * 0.8 : 0, across: k === 0 ? 0 : (k % 2 ? -1 : 1) * rank * 0.45 });
  }
  return out;
}

/** A circle in settlement radii that a hull at anchor keeps out of. */
export interface Circle { x: number; z: number; r: number }

/**
 * Berths for a squadron of `count` round a port, in settlement radii from it: rows of up to three hulls abreast, all
 * heading the same way, bows out to sea, the nearest open water first. Every hull needs water under its bow, middle and
 * stern and stays out of the `avoid` circles (the camp's docks, ships already there). Of the headings that fit at the
 * same distance the one with the most open sea beyond wins, so the squadron lies off the port's sea side; ties go to
 * the seed. A port with no such water close by (a river mouth, a cove) still gets its ships, ringed just off its disc.
 */
export function anchorage(count: number, seed: number, isSea: (x: number, z: number) => boolean, avoid: Circle[] = []): Berth[] {
  if (count < 1) return [];
  const L = HULL_LENGTH;
  const layout = Array.from({ length: count }, (_, k) => {
    const row = Math.floor(k / 3), inRow = Math.min(3, count - row * 3);
    return { out: row * L * 1.25, across: ((k % 3) - (inRow - 1) / 2) * L * 0.5 };
  });
  const clear = (x: number, z: number) => isSea(x, z) && avoid.every((c) => Math.hypot(x - c.x, z - c.z) >= c.r);
  const DIRECTIONS = 16;
  const place = (a: number, d: number) => {
    const dx = Math.cos(a), dz = Math.sin(a);
    return layout.map((o) => ({ x: dx * (d + o.out) - dz * o.across, z: dz * (d + o.out) + dx * o.across, rot: Math.atan2(dx, dz) }));
  };
  // How open the sea is beyond a heading: water probes in a fan out to four radii.
  const open = (a: number) => {
    let n = 0;
    for (const r of [2, 3, 4]) for (const s of [-0.35, 0, 0.35]) if (isSea(Math.cos(a + s) * r, Math.sin(a + s) * r)) n += 1;
    return n / 9;
  };
  let best: { spots: Berth[]; cost: number } | null = null;
  for (let i = 0; i < DIRECTIONS; i += 1) {
    const a = (((i + seed) % DIRECTIONS) / DIRECTIONS) * Math.PI * 2;
    const openness = open(a);
    for (let d = 1.5; d <= 4.6; d += 0.2) {
      // Never cheaper than what is already found: the nearest berth first, the more open sea at the same distance.
      const cost = d - openness * 0.6;
      if (best && cost >= best.cost) break;
      const spots = place(a, d);
      const fits = spots.every((p) => {
        const fx = Math.sin(p.rot) * L * 0.5, fz = Math.cos(p.rot) * L * 0.5;
        return clear(p.x, p.z) && clear(p.x + fx, p.z + fz) && clear(p.x - fx, p.z - fz);
      });
      if (fits) { best = { spots, cost }; break; }
    }
  }
  if (best) return best.spots;
  const first = ((seed % 12) / 12) * Math.PI * 2;
  return Array.from({ length: count }, (_, i) => {
    const a = first + (i / count) * Math.PI * 2;
    return { x: Math.cos(a) * 1.7, z: Math.sin(a) * 1.7, rot: a + Math.PI / 2 };
  });
}
