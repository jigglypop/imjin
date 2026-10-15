import type { FactionId } from '../types';

// What a hero camp is made of, as plain data in its site's frame (model metres, x east, z south, y up): the levelled
// pads and the ground laid on them, the pieces standing there, the ships at its quay and where its hearths smoke. The
// layouts (layouts.ts) write a plan; the builder (build.ts) and the ground (ground.ts) turn it into meshes. Pure TS.

export type P2 = readonly [number, number];

/** What a stretch of ground is: the land's own grass, or something laid or trodden on it. */
export type Surface = 'earth' | 'yard' | 'lane' | 'quay' | 'slip' | 'paddy' | 'field' | 'gravel';
/** The face of a pad's retaining skirt. */
export type Facing = 'granite' | 'rubble' | 'ishigaki' | 'brick' | 'earth';

/** Levelled ground: flat at h0 inside the outline, a retaining skirt down to the ground (or to `floor`) round it. */
export interface Pad { poly: P2[]; h0: number; top: Surface; face: Facing; floor?: number }
/** Ground laid flat at y (on a pad) or following the ground when y is null. */
export interface Flat { poly: P2[]; y: number | null; surface: Surface }
/** A lane or road along a line, at y or following the ground. */
export interface Strip { line: P2[]; width: number; y: number | null; surface: Surface }

/** The look of a building's body: whose it is and what its walls are. */
export type BodyLook =
  | 'jo_lime' | 'jo_red' | 'jo_store' | 'jo_house' | 'jo_thatch' | 'jo_shed' | 'jo_granary'
  | 'wa_lime' | 'wa_house' | 'wa_shed' | 'wa_hut' | 'wa_tent'
  | 'mg_red' | 'mg_barracks' | 'mg_shed' | 'mg_store';
export type RoofStyle = 'hip' | 'gable' | 'hipgable' | 'pyramid';
export type WallLook =
  | 'jo_granite' | 'jo_court' | 'jo_stockade' | 'jo_fence' | 'doldam' | 'parapet'
  | 'wa_dobei' | 'wa_outer' | 'wa_curtain'
  | 'mg_brick' | 'mg_court';
export type BoxLook =
  | 'bastion' | 'pier' | 'platform' | 'gun' | 'stack' | 'well' | 'timber' | 'plank_pile' | 'beacon_base' | 'gate_pier'
  | 'wa_bastion' | 'mg_bastion' | 'mg_pier' | 'brick_beam' | 'step';

export type Piece =
  | { kind: 'bldg'; x: number; z: number; rot: number; y: number; w: number; d: number; wallH: number; rise: number; overhang: number; style: RoofStyle; base: number; look: BodyLook; hip?: number }
  | { kind: 'wall'; a: P2; b: P2; y: number; h: number; thick: number; look: WallLook; crenel?: number }
  | { kind: 'box'; x: number; z: number; rot: number; y: number; w: number; d: number; h: number; look: BoxLook }
  | { kind: 'pass'; x: number; z: number; rot: number; y: number; w: number; thick: number; h: number; look: WallLook }
  | { kind: 'pavilion'; x: number; z: number; rot: number; y: number; w: number; d: number; storeys: number; look: 'jo' | 'mg' | 'mg_plain' }
  | { kind: 'turret'; x: number; z: number; rot: number; y: number; s: number; look: 'jo' | 'mg' }
  | { kind: 'yagura'; x: number; z: number; rot: number; y: number; w: number; d: number; storeys: number }
  | { kind: 'tenshu'; x: number; z: number; y: number }
  | { kind: 'yamen'; x: number; z: number; y: number }
  | { kind: 'banner'; x: number; z: number; y: number; h: number; colour: Colour; w: number; fh: number; rot: number; flag: 'flag' | 'nobori' }
  | { kind: 'soldiers'; x: number; z: number; y: number; rows: number; cols: number; dx: number; dz: number; navy: FactionId }
  | { kind: 'stocks'; x: number; z: number; rot: number; y: number; len: number; beam: number; depth: number }
  | { kind: 'tree'; x: number; z: number; y: number; r: number };

/** A banner's colour: the Korean five directions, Japanese nobori, Ming red and yellow. */
export type Colour = 'blue' | 'red' | 'white' | 'black' | 'yellow';

/** A ship at the quay or at anchor: the map's own model of its kind, bow towards (sin rot, cos rot). */
export interface Moored { kind: 'panokseon' | 'atakebune' | 'sekibune' | 'mingship' | 'mingsmall' | 'kobaya' | 'sahuseon' | 'hoseon'; x: number; z: number; rot: number }

/** The ground of the site as drawn: natural height in model metres (negative under the sea) and whether a point is water. */
export interface Ground {
  natural(x: number, z: number): number;
  water(x: number, z: number): boolean;
}

export class Plan {
  readonly pads: Pad[] = [];
  readonly flats: Flat[] = [];
  readonly strips: Strip[] = [];
  readonly pieces: { navy: FactionId; piece: Piece }[] = [];
  readonly ships: Moored[] = [];
  /** Where a hearth smokes: (x, y, z) at its roof. */
  readonly smoke: [number, number, number][] = [];
  /** Discs (x, z, r) kept clear of the map's trees. */
  readonly clear: [number, number, number][] = [];

  constructor(readonly ground: Ground, public navy: FactionId) {}

  /** The ground with the pads laid so far: a pad's level inside it (the last laid on top), else the land. */
  at(x: number, z: number) {
    for (let i = this.pads.length - 1; i >= 0; i -= 1) if (inside(this.pads[i]!.poly, x, z)) return this.pads[i]!.h0;
    return this.ground.natural(x, z);
  }

  natural(x: number, z: number) {
    return this.ground.natural(x, z);
  }

  water(x: number, z: number) {
    return this.ground.water(x, z);
  }

  pad(poly: P2[], h0: number, top: Surface = 'earth', face: Facing = 'granite', floor?: number) {
    this.pads.push({ poly, h0, top, face, floor });
  }

  flat(poly: P2[], y: number | null, surface: Surface) {
    this.flats.push({ poly, y, surface });
  }

  strip(line: P2[], width: number, surface: Surface = 'lane', y: number | null = null) {
    this.strips.push({ line, width, y, surface });
  }

  add(piece: Piece, navy: FactionId = this.navy) {
    this.pieces.push({ navy, piece });
  }

  /** A wall along a line, its foot at y, cut where a gate (x, z, width) stands on it; closed lines run back to the start. */
  wallLine(pts: P2[], y: number, h: number, thick: number, look: WallLook, o: { closed?: boolean; crenel?: number; gaps?: [number, number, number][] } = {}) {
    const closed = o.closed ?? true;
    const n = pts.length;
    for (let i = 0; i < (closed ? n : n - 1); i += 1) {
      const a = pts[i]!, b = pts[(i + 1) % n]!;
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L < 1e-6) continue;
      // The stretches of this side left between the gates on it.
      const cuts: [number, number][] = [];
      for (const [gx, gz, gw] of o.gaps ?? []) {
        const t = ((gx - a[0]) * (b[0] - a[0]) + (gz - a[1]) * (b[1] - a[1])) / (L * L);
        const off = Math.abs((gx - a[0]) * (b[1] - a[1]) - (gz - a[1]) * (b[0] - a[0])) / L;
        if (off < 0.8 && t > -0.1 && t < 1.1) cuts.push([t - gw / 2 / L, t + gw / 2 / L]);
      }
      cuts.sort((p, q) => p[0] - q[0]);
      let t0 = 0;
      const runs: [number, number][] = [];
      for (const [c0, c1] of cuts) {
        if (c0 > t0) runs.push([t0, c0]);
        t0 = Math.max(t0, c1);
      }
      if (t0 < 1) runs.push([t0, 1]);
      for (const [r0, r1] of runs) {
        if ((r1 - r0) * L < 0.3) continue;
        const p = (t: number): P2 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        this.add({ kind: 'wall', a: p(r0), b: p(r1), y, h, thick, look, crenel: o.crenel });
      }
    }
  }

  banner(x: number, z: number, y: number, h: number, colour: Colour, w = 1.2, fh = 2.4, rot = 0, flag: 'flag' | 'nobori' = 'flag') {
    this.add({ kind: 'banner', x, z, y, h, colour, w, fh, rot, flag });
  }

  /** Banners every `every` metres along a closed line, the colours in turn, none within a gate's reach. */
  bannersOn(pts: P2[], y: number, every: number, colours: Colour[], o: { flag?: 'flag' | 'nobori'; h?: number; skip?: [number, number, number][] } = {}) {
    let i = 0;
    const flag = o.flag ?? 'flag';
    for (const [x, z, a] of along(pts, every)) {
      if (o.skip?.some(([sx, sz, sr]) => Math.hypot(x - sx, z - sz) < sr)) continue;
      this.banner(x, z, y, o.h ?? 6.5, colours[i % colours.length]!, flag === 'flag' ? 1.1 : 0.8, flag === 'flag' ? 2.2 : 3.6, a, flag);
      i += 1;
    }
  }

  ship(kind: Moored['kind'], x: number, z: number, rot: number) {
    this.ships.push({ kind, x, z, rot });
  }
}

/** A rectangle's corners (x0, z0), (x1, z0), (x1, z1), (x0, z1), its corners cut by `ch` when given. */
export function rect(x0: number, x1: number, z0: number, z1: number, ch = 0): P2[] {
  if (ch <= 0) return [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
  return [[x0 + ch, z0], [x1 - ch, z0], [x1, z0 + ch], [x1, z1 - ch], [x1 - ch, z1], [x0 + ch, z1], [x0, z1 - ch], [x0, z0 + ch]];
}

/** Points every `every` metres along a line, with the direction of travel as an angle (atan2(dx, dz)). */
export function along(pts: P2[], every: number, closed = true): [number, number, number][] {
  const out: [number, number, number][] = [];
  const n = pts.length;
  for (let i = 0; i < (closed ? n : n - 1); i += 1) {
    const a = pts[i]!, b = pts[(i + 1) % n]!;
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const k = Math.max(1, Math.floor(L / every));
    for (let j = 0; j < k; j += 1) {
      const t = (j + 0.5) / k;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, Math.atan2(b[0] - a[0], b[1] - a[1])]);
    }
  }
  return out;
}

/** Whether (x, z) lies inside a closed outline (even-odd rule). */
export function inside(poly: readonly P2[], x: number, z: number) {
  let hit = false;
  for (let i = 0, n = poly.length; i < n; i += 1) {
    const a = poly[i]!, b = poly[(i + 1) % n]!;
    if ((a[1] > z) !== (b[1] > z) && x < a[0] + ((z - a[1]) * (b[0] - a[0])) / (b[1] - a[1])) hit = !hit;
  }
  return hit;
}

/** How far (x, z) lies outside a closed outline (0 inside). */
export function outside(poly: readonly P2[], x: number, z: number) {
  if (inside(poly, x, z)) return 0;
  let best = Infinity;
  for (let i = 0, n = poly.length; i < n; i += 1) {
    const a = poly[i]!, b = poly[(i + 1) % n]!;
    const dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l2));
    best = Math.min(best, Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t));
  }
  return best;
}

/** A small seeded generator (mulberry32): the same village every time. */
export function seeded(seed: number) {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { next, uniform: (a: number, b: number) => a + (b - a) * next() };
}
