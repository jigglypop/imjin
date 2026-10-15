import { REGION_ORDER, REGIONS } from '../../../sim/grand/regions';
import type { RegionId } from '../../../sim/grand/types';
import { DEM_RECT } from '../mapMath';
import { MAP_ASPECT, project } from '../projection';
import {
  ccw, inside, polygonDistance, simplifyClosed, turnBetween, type Box, boxCorners, boxSamples,
} from './lots';
import {
  ELEVATION_METRE, MODEL_METRE, PAD_MIN, rotToward, siteToFrame, SLOT_SIZE, type Ground, type Pad, type SiteRecord, type TownValue, type Vec2,
  type WorkKind,
} from './types';

// The settlements' site solver: one site per on-map region, laid out offline by scripts/build-grand-sites.mjs over the
// drawn terrain and baked into public/ui/grand_sites.json (README.md beside this file). Pure and deterministic: the same
// DEM always gives the same sites.
//
// It works in two passes round the terrain build. The first, over the land as the build fits it before any pad, chooses
// what changes the ground: each port's core pad (largest value first, so a seat or a rich port takes the best ground and a
// crowded neighbour moves aside) and the small pads of the works that need a level floor. The terrain build then levels
// those pads into the TIN, and the second pass lays out everything else on the ground exactly as the map will draw it:
// the harbour on the real shore, the walls and lots on the pad, the yards across the waterline, the town, its fields and
// the roads. Each site keeps to its own cell, the ground nearer its pad than any other, so neighbours never overlap.
//
// Distances are model metres in one frame for the whole map, east and south of the DEM's north-west texel; a site's own
// frame is that shifted to its origin.

/** The DEM's grid as the terrain build fits it before any pad (build-grand-terrain.mjs: prepareTerrain, seaGuard, PAD). */
export interface Fitted {
  W: number;
  H: number;
  /** 0 sea, 1 land, 2 land beside the sea (it may sink under the sea plane). */
  land: Uint8Array;
  /** Metres the land is fitted to; the sea's depth below 0. */
  target: Float32Array;
  /** Texels no pad or bank may touch, those within a few texels of the sea. */
  guard: Uint8Array;
  /**
   * How the build levels a pad (PAD there): flat `margin` texels past its outline, then a bank a texel wide and one more
   * per `bankRun` metres of step, up to `bankMax`, over land above `contour` metres only.
   */
  pad: { margin: number; bankRun: number; bankMax: number; contour: number };
}

/** The DEM's heights as the map draws them (build-grand-terrain.mjs drawnHeights): land above 0, water at or below. */
export interface Drawn {
  W: number;
  H: number;
  heights: Float32Array;
}

const SEA = 0;

/** Model metres east and south of the DEM's north-west texel, and the DEM's texels. */
export class Frame {
  /** Texels per model metre east and south. */
  readonly kx: number;
  readonly kz: number;
  constructor(readonly W: number, readonly H: number) {
    this.kx = (MODEL_METRE * (W - 1)) / DEM_RECT.w;
    this.kz = (MODEL_METRE * MAP_ASPECT * (H - 1)) / DEM_RECT.h;
  }
  /** The frame point (u, v) of a point. */
  uv(X: number, Z: number) {
    return { u: DEM_RECT.u + X * MODEL_METRE, v: DEM_RECT.v + Z * MODEL_METRE * MAP_ASPECT };
  }
  /** The point at a frame point. */
  fromUV(u: number, v: number): Vec2 {
    return [(u - DEM_RECT.u) / MODEL_METRE, (v - DEM_RECT.v) / (MODEL_METRE * MAP_ASPECT)];
  }
  /** A grid read bilinearly between its texels, as MapLayer.surface reads the map's heights. */
  bilinear(grid: ArrayLike<number>, X: number, Z: number, map?: (h: number) => number) {
    const { W, H } = this;
    const x = Math.max(0, Math.min(W - 1, X * this.kx)), y = Math.max(0, Math.min(H - 1, Z * this.kz));
    const x0 = Math.min(W - 2, Math.floor(x)), y0 = Math.min(H - 2, Math.floor(y)), fx = x - x0, fy = y - y0;
    const i = y0 * W + x0;
    const a = map ? map(grid[i]!) : grid[i]!, b = map ? map(grid[i + 1]!) : grid[i + 1]!;
    const c = map ? map(grid[i + W]!) : grid[i + W]!, d = map ? map(grid[i + W + 1]!) : grid[i + W + 1]!;
    return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
  }
  /** The texel a point falls in. */
  texel(X: number, Z: number) {
    const x = Math.max(0, Math.min(this.W - 1, Math.round(X * this.kx))), y = Math.max(0, Math.min(this.H - 1, Math.round(Z * this.kz)));
    return y * this.W + x;
  }
}

/**
 * Euclidean distance in texels from every texel to the nearest seed texel (Felzenszwalb and Huttenlocher's transform of
 * squared distances, a column pass then a row pass).
 */
export function distanceField(W: number, H: number, seed: (i: number) => boolean): Float32Array {
  const INF = 1e20, n = Math.max(W, H);
  const grid = new Float64Array(W * H);
  for (let i = 0; i < W * H; i += 1) grid[i] = seed(i) ? 0 : INF;
  const f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  const line = (length: number) => {
    let k = 0;
    v[0] = 0;
    z[0] = -INF;
    z[1] = INF;
    for (let q = 1; q < length; q += 1) {
      let s = (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
      while (s <= z[k]!) {
        k -= 1;
        s = (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
      }
      k += 1;
      v[k] = q;
      z[k] = s;
      z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < length; q += 1) {
      while (z[k + 1]! < q) k += 1;
      d[q] = (q - v[k]!) * (q - v[k]!) + f[v[k]!]!;
    }
  };
  for (let x = 0; x < W; x += 1) {
    for (let y = 0; y < H; y += 1) f[y] = grid[y * W + x]!;
    line(H);
    for (let y = 0; y < H; y += 1) grid[y * W + x] = d[y]!;
  }
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) f[x] = grid[y * W + x]!;
    line(W);
    for (let x = 0; x < W; x += 1) grid[y * W + x] = d[x]!;
  }
  return Float32Array.from(grid, Math.sqrt);
}

// ---------- the ports ----------

/** A port as the solver sees it: its region, its marker in the map frame and what the rules fix about it. */
export interface Port {
  id: RegionId;
  /** The marker, model metres east and south of the DEM's north-west texel. */
  X: number;
  Z: number;
  value: TownValue;
  seat: boolean;
  culture: 'korean' | 'japanese';
}

/** Every on-map port, in the order sites are solved: the richest first, a seat before its equals, then the rules' order. */
export function solveOrder(frame: Frame): Port[] {
  return REGION_ORDER.filter((id) => !REGIONS[id].edge).map((id) => {
    const r = REGIONS[id];
    const p = project(r.lon, r.lat);
    const [X, Z] = frame.fromUV(p.u, p.v);
    return { id, X, Z, value: r.value, seat: !!r.capitalOf, culture: r.korea ? 'korean' as const : 'japanese' as const };
  }).sort((a, b) => b.value - a.value || Number(b.seat) - Number(a.seat) || REGION_ORDER.indexOf(a.id) - REGION_ORDER.indexOf(b.id));
}

// ---------- the first pass: pads ----------

/** The nominal core pad: a superellipse 2A along the shore by 2B toward the sea, of exponent N. */
const CORE = { A: 42, B: 32.5, N: 4.5 };
/** The pad's radius toward the angle phi from its own across axis (along the shore) toward its front (the sea). */
const coreRadius = (phi: number) => {
  const c = Math.abs(Math.cos(phi)), s = Math.abs(Math.sin(phi));
  return 1 / ((c / CORE.A) ** CORE.N + (s / CORE.B) ** CORE.N) ** (1 / CORE.N);
};
/** The part of the pad that must stand whole: a pad is never clipped under about 60 % of its size across. */
const CORE_WHOLE = { A: 25.5, B: 19.5 };
/** How far a port's pad may stand from its marker, and from any other site's pads. */
const SEARCH = 110, APART = 4;
/** The most land the quay's apron may cover between the shore and the core pad. */
const APRON = 15;
/**
 * The most a core pad may cut into the ground or stand over it (model metres): a pad stops short of steeper ground, so no
 * bank round it rises much higher than a camp's wall.
 */
const CUT = 4;

/** The first pass's decision for one port: the core pad and the works that stand on pads of their own. */
export interface PadPlan {
  port: Port;
  /** The site's origin, the middle of the core pad. */
  X: number;
  Z: number;
  /** The turn the site faces the sea by: its gates, hall and harbour look along facing(rot). */
  rot: number;
  /** Pads in the site's frame, the core first. */
  pads: Pad[];
  /** The works' slots chosen with their pads, in the site's frame. */
  works: Partial<Record<WorkKind, Box & { y: number }>>;
}

/** The ground of the first pass: the fitted land, where pads may go, and what earlier sites have taken. */
class FittedGround {
  readonly frame: Frame;
  /** Texels from each texel to the nearest one no pad may touch. */
  private readonly blocked: Float32Array;
  /** Texels from each texel to the nearest sea texel. */
  readonly seaDistance: Float32Array;
  /** The site (index + 1) whose pads, banks and the room round them hold a texel, 0 for none. */
  private readonly taken: Int16Array;
  /** Texels a pad or bank of any site levels, and a little round them: no other pad may come there. */
  private readonly levelled: Uint8Array;
  constructor(readonly fitted: Fitted) {
    const { W, H, guard, land } = fitted;
    this.frame = new Frame(W, H);
    this.blocked = distanceField(W, H, (i) => guard[i] === 1 || land[i] === SEA);
    this.seaDistance = distanceField(W, H, (i) => land[i] === SEA);
    this.taken = new Int16Array(W * H);
    this.levelled = new Uint8Array(W * H);
  }
  /** Metres of sea a straight line from (X0, Z0) to (X1, Z1) crosses. */
  seaBetween(X0: number, Z0: number, X1: number, Z1: number) {
    const length = Math.hypot(X1 - X0, Z1 - Z0), steps = Math.ceil(length / 2);
    let wet = 0;
    for (let i = 1; i < steps; i += 1) if (this.sea(X0 + ((X1 - X0) * i) / steps, Z0 + ((Z1 - Z0) * i) / steps)) wet += 1;
    return steps ? (wet * length) / steps : 0;
  }
  /** Model metres above the sea plane, the sea's depth below 0. */
  height(X: number, Z: number) {
    return this.frame.bilinear(this.fitted.target, X, Z) * ELEVATION_METRE;
  }
  sea(X: number, Z: number) {
    return this.fitted.land[this.frame.texel(X, Z)] === SEA;
  }
  /** Model metres to the nearest sea texel. */
  toSea(X: number, Z: number) {
    return this.frame.bilinear(this.seaDistance, X, Z) / this.frame.kx;
  }
  /**
   * Whether a pad's outline may pass through the point: the build flattens the texels within `margin` texels of it, so
   * the nearest texel it may not level must be farther than that; and no other site holds it.
   */
  open(X: number, Z: number, site: number) {
    const { frame } = this;
    const x = X * frame.kx, y = Z * frame.kz, need = this.fitted.pad.margin + 0.25;
    const ix = Math.round(x), iy = Math.round(y);
    if (ix < 1 || iy < 1 || ix >= frame.W - 1 || iy >= frame.H - 1) return false;
    const owner = this.taken[iy * frame.W + ix]!;
    if ((owner && owner !== site + 1) || this.levelled[iy * frame.W + ix]) return false;
    const d = this.blocked[iy * frame.W + ix]!;
    if (d - 0.75 >= need) return true;
    if (d + 0.75 < need) return false;
    const r = Math.ceil(need) + 1;
    for (let j = iy - r; j <= iy + r; j += 1) for (let i = ix - r; i <= ix + r; i += 1) {
      if (i < 0 || j < 0 || i >= frame.W || j >= frame.H) continue;
      const k = j * frame.W + i;
      if ((this.fitted.guard[k] === 1 || this.fitted.land[k] === SEA) && Math.hypot(i - x, j - y) < need) return false;
    }
    return true;
  }
  /**
   * Marks what a site's pad at `h0` model metres levels: its flat and the bank the build eases beyond it, worked out as
   * the build does (levelPads), and a texel round them; and, APART texels further, the room its neighbours keep off.
   */
  take(poly: readonly Vec2[], h0: number, site: number) {
    const { frame, fitted } = this;
    const { margin, bankRun, bankMax, contour } = fitted.pad;
    const metres = h0 / ELEVATION_METRE, reach = margin + bankMax + APART;
    const xs = poly.map((p) => p[0] * frame.kx), ys = poly.map((p) => p[1] * frame.kz);
    const texels: Vec2[] = poly.map(([X, Z]) => [X * frame.kx, Z * frame.kz]);
    for (let y = Math.max(0, Math.floor(Math.min(...ys) - reach)); y <= Math.min(frame.H - 1, Math.ceil(Math.max(...ys) + reach)); y += 1) {
      for (let x = Math.max(0, Math.floor(Math.min(...xs) - reach)); x <= Math.min(frame.W - 1, Math.ceil(Math.max(...xs) + reach)); x += 1) {
        const i = y * frame.W + x, own = fitted.target[i]!;
        const bank = own > contour && !fitted.guard[i] ? Math.min(bankMax, 1 + Math.abs(own - metres) / bankRun) : 0;
        const d = polygonDistance(texels, x, y) - margin - bank;
        if (d <= 1) this.levelled[i] = 1;
        if (d <= APART && !this.taken[i]) this.taken[i] = site + 1;
      }
    }
  }
}

/** The local axes of a site turned by `rot`: along the shore (its across) and toward the sea (its front). */
const siteAxes = (rot: number) => ({ t: [Math.cos(rot), -Math.sin(rot)] as Vec2, s: [Math.sin(rot), Math.cos(rot)] as Vec2 });

/** The middle value of a list (sorted in place). */
function median(values: number[]) {
  values.sort((a, b) => a - b);
  const m = values.length >> 1;
  return values.length % 2 ? values[m]! : (values[m - 1]! + values[m]!) / 2;
}

/** Points over the nominal core pad in its own axes (along the shore, toward the sea), `step` metres apart. */
const coreLattice = (step: number) => {
  const out: Vec2[] = [];
  for (let q = -CORE.B; q <= CORE.B; q += step) for (let p = -CORE.A; p <= CORE.A; p += step) {
    if (Math.abs(p / CORE.A) ** CORE.N + Math.abs(q / CORE.B) ** CORE.N <= 1) out.push([p, q]);
  }
  return out;
};

/**
 * How strict a core pad's search is: the part of the pad that must stand whole, how many of seven lanes along its front
 * must find the shore within an apron's width and open water beyond, how far from its marker it may go, and how far any
 * of the whole part may lie from the pad's level.
 */
interface CoreRules { whole: { A: number; B: number }; shore: number; open: number; search: number; steep: number }
const STRICT: CoreRules = { whole: CORE_WHOLE, shore: 3, open: 2, search: SEARCH, steep: CUT * 1.4 };
/** For the few ports whose coast holds no pad by the strict rules: half the nominal pad whole, a shorter front, further off. */
const LOOSE: CoreRules = { whole: { A: 21, B: 16.5 }, shore: 2, open: 1, search: SEARCH * 1.3, steep: CUT * 2 };
/** For a port crowded out of every spot by the loose rules too: the least pad that still holds a camp, further off. */
const LAST: CoreRules = { whole: { A: 18, B: 14 }, shore: 1, open: 1, search: SEARCH * 1.6, steep: CUT * 2.5 };
/** The rules strictest first, and what a pad that holds only by looser ones costs over a strict one. */
const TIERS: readonly { rules: CoreRules; price: number }[] = [{ rules: STRICT, price: 0 }, { rules: LOOSE, price: 1.5 }, { rules: LAST, price: 3 }];

/** A core pad that could stand at (X, Z) turned by `rot`, at the level `h0`, and what it would cost. */
interface CoreSpot { X: number; Z: number; rot: number; cost: number; h0: number }

/**
 * The search for a port's core pad. A pad is tried as `fit` says; `spots` tries every spot within the search of its marker
 * (a 6 m lattice, 22.5 degree turns) and keeps the best of each neighbourhood, and `refine` tries round one of them a metre
 * and two and a half degrees apart.
 */
class CoreSearch {
  private readonly territory: Float32Array;
  private readonly cells: number;
  private readonly coarse: { whole: Vec2[]; rest: Vec2[] };
  private readonly fine: { whole: Vec2[]; rest: Vec2[] };
  /** Why candidates fell, to say so when none is left. */
  readonly tried = { spots: 0, shore: 0, whole: 0 };
  constructor(private readonly g: FittedGround, readonly port: Port, private readonly site: number, ports: readonly Port[], readonly rules: CoreRules) {
    // How far into another port's waters a point lies (nearer its marker than this port's own), 0 to 1 over 20 m, on a
    // 2 m grid round the port.
    const others = ports.filter((o) => o !== port && Math.hypot(o.X - port.X, o.Z - port.Z) < 3 * rules.search);
    this.cells = Math.ceil((rules.search + CORE.A + 5) / 2) * 2 + 1;
    const half = (this.cells - 1) / 2;
    this.territory = new Float32Array(this.cells * this.cells);
    for (let j = 0; j < this.cells; j += 1) for (let i = 0; i < this.cells; i += 1) {
      const x = port.X + (i - half) * 2, z = port.Z + (j - half) * 2;
      const excess = Math.hypot(x - port.X, z - port.Z) - others.reduce((n, o) => Math.min(n, Math.hypot(o.X - x, o.Z - z)), Infinity);
      this.territory[j * this.cells + i] = Math.min(1, Math.max(0, excess / 20));
    }
    const lattice = (step: number) => {
      const all = coreLattice(step);
      const whole = all.filter(([p, q]) => Math.abs(p) <= rules.whole.A && Math.abs(q) <= rules.whole.B);
      return { whole, rest: all.filter((pq) => !whole.includes(pq)) };
    };
    this.coarse = lattice(4);
    this.fine = lattice(2);
  }

  private intrude(x: number, z: number) {
    const half = (this.cells - 1) / 2;
    const i = Math.round((x - this.port.X) / 2 + half), j = Math.round((z - this.port.Z) / 2 + half);
    return i < 0 || j < 0 || i >= this.cells || j >= this.cells ? 1 : this.territory[j * this.cells + i]!;
  }

  /**
   * A core pad at (X, Z) turned by `rot`, or why it does not fit. Along the middle of its front the pad reaches as far
   * toward the shore as it may and the water begins no more than an apron's width beyond, open water still a pier's
   * length out. The part that must stand whole does, within `steep` of the pad's level; the rest of the nominal pad
   * counts where it may be levelled within CUT. Cheapest is the least earth moved, the least clipped, nearest the port's
   * own marker, on its side of the water and out of its neighbours' waters, with a long shore before it, looking south
   * where the camera looks from.
   */
  fit(X: number, Z: number, rot: number, lattice = this.coarse): CoreSpot | 'shore' | 'whole' {
    const { g, site, rules } = this;
    const { t, s } = siteAxes(rot);
    const at = (p: number, q: number): Vec2 => [X + t[0] * p + s[0] * q, Z + t[1] * p + s[1] * q];
    let shore = 0, open = 0;
    const LANES = 7;
    for (let i = 0; i < LANES; i += 1) {
      const p = -15 + i * 5;
      let front = -1, water = -1;
      for (let q = rules.whole.B; q <= CORE.B + 20; q += 1) {
        const [x, z] = at(p, q);
        if (front < 0 && !g.open(x, z, site)) front = q;
        if (g.sea(x, z)) { water = q; break; }
      }
      if (water < 0 || front < 0 || water - front > APRON) continue;
      shore += 1;
      const [x, z] = at(p, water + 18);
      if (g.sea(x, z)) open += 1;
    }
    if (shore < rules.shore || open < rules.open) return 'shore';
    const whole: number[] = [];
    for (const [p, q] of lattice.whole) {
      const [x, z] = at(p, q);
      if (!g.open(x, z, site)) return 'whole';
      whole.push(g.height(x, z));
    }
    const h0 = Math.max(PAD_MIN, median(whole));
    if (whole.some((h) => Math.abs(h - h0) > rules.steep)) return 'whole';
    let earth = whole.reduce((n, h) => n + Math.abs(h - h0), 0), kept = whole.length, trespass = 0;
    for (const [p, q] of lattice.whole) trespass += this.intrude(...at(p, q));
    for (const [p, q] of lattice.rest) {
      const [x, z] = at(p, q);
      if (!g.open(x, z, site)) continue;
      const h = g.height(x, z);
      if (Math.abs(h - h0) > CUT) continue;
      earth += Math.abs(h - h0);
      trespass += this.intrude(x, z);
      kept += 1;
    }
    const share = kept / (lattice.whole.length + lattice.rest.length);
    const far = Math.hypot(X - this.port.X, Z - this.port.Z);
    // Across the water from the marker: on another island or the far side of a strait.
    const abroad = Math.max(0, g.seaBetween(this.port.X, this.port.Z, X, Z) - 12) / 12;
    const cost = (earth / kept) * 1.5 + (1 - share) * 3 + far / 15 + (trespass / kept) * 4 + abroad + (1 - s[1]) * 0.35
      + (LANES - shore) * 0.15 + (LANES - open) * 0.15;
    return { X, Z, rot, cost, h0 };
  }

  /** The best spots of the search, one per neighbourhood (8 m and 30 degrees), cheapest first. */
  spots(): CoreSpot[] {
    const { port, rules, g } = this;
    const found: CoreSpot[] = [];
    for (let dz = -rules.search; dz <= rules.search; dz += 6) for (let dx = -rules.search; dx <= rules.search; dx += 6) {
      if (Math.hypot(dx, dz) > rules.search) continue;
      const X = port.X + dx, Z = port.Z + dz;
      const toSea = g.toSea(X, Z);
      if (toSea < rules.whole.B + 4 || toSea > CORE.B + 18 || !g.open(X, Z, this.site)) continue;
      this.tried.spots += 1;
      for (let k = 0; k < 16; k += 1) {
        const result = this.fit(X, Z, (k / 16) * Math.PI * 2);
        if (typeof result === 'string') this.tried[result] += 1;
        else found.push(result);
      }
    }
    found.sort((a, b) => a.cost - b.cost);
    const kept: CoreSpot[] = [];
    for (const spot of found) {
      if (kept.length >= 50) break;
      if (kept.some((k) => Math.hypot(k.X - spot.X, k.Z - spot.Z) < 8 && Math.abs(turnBetween(k.rot, spot.rot)) < Math.PI / 6)) continue;
      kept.push(spot);
    }
    return kept;
  }

  /**
   * The best pad round a spot, tried more finely as the ground now is; the spot itself as first tried when no finer one
   * fits; null when even that no longer does.
   */
  refine(seed: CoreSpot): CoreSpot | null {
    const again = this.fit(seed.X, seed.Z, seed.rot);
    let best: CoreSpot | null = typeof again === 'string' ? null : again;
    for (let dz = -3; dz <= 3; dz += 1) for (let dx = -3; dx <= 3; dx += 1) for (let k = -4; k <= 4; k += 1) {
      const X = seed.X + dx, Z = seed.Z + dz;
      if (Math.hypot(X - this.port.X, Z - this.port.Z) > this.rules.search || !this.g.open(X, Z, this.site)) continue;
      const result = this.fit(X, Z, seed.rot + (k * Math.PI) / 64, this.fine);
      if (typeof result !== 'string' && (!best || result.cost < best.cost)) best = result;
    }
    return best;
  }

  /** Why no spot was found. */
  failure() {
    const { tried } = this;
    return `${this.port.id}: no core pad fits within ${this.rules.search} m of the port (${tried.spots} spots, ${tried.shore} turns off the shore, ${tried.whole} clipped or too steep)`;
  }
}

/**
 * The core pad's outline round (X, Z) turned by `rot`: the nominal superellipse, each of its rays drawn in to the last
 * point a pad may reach within CUT of the height `h0`, so the coast, the neighbours and the hills behind clip it; a ray may
 * then reach at most a little further than the rays beside it, so no thin spur runs out along a ridge or a valley.
 */
function coreOutline(g: FittedGround, spot: CoreSpot, site: number, whole: { A: number; B: number }): Vec2[] {
  const { X, Z, rot, h0 } = spot;
  const { t, s } = siteAxes(rot);
  const RAYS = 96;
  const reach = Array.from({ length: RAYS }, (_, i) => {
    const phi = (i / RAYS) * Math.PI * 2, r = coreRadius(phi);
    const dx = (t[0] * Math.cos(phi) + s[0] * Math.sin(phi)), dz = (t[1] * Math.cos(phi) + s[1] * Math.sin(phi));
    // The part that must stand whole is not clipped by the hills: within it the pad cuts as deep as it has to.
    const firm = Math.min(Math.abs(whole.A / Math.cos(phi)), Math.abs(whole.B / Math.sin(phi)));
    let keep = 0;
    for (let d = 0.5; d <= r; d += 0.5) {
      const x = X + dx * d, z = Z + dz * d;
      if (!g.open(x, z, site) || (d > firm && Math.abs(g.height(x, z) - h0) > CUT)) break;
      keep = d;
    }
    return keep;
  });
  for (let pass = 0; pass < 2; pass += 1) {
    for (let i = 0; i < RAYS; i += 1) {
      for (let k = 1; k <= 4; k += 1) {
        reach[i] = Math.min(reach[i]!, reach[(i + k) % RAYS]! + 2.5 * k, reach[(i - k + RAYS) % RAYS]! + 2.5 * k);
      }
    }
  }
  const outline: Vec2[] = reach.map((r, i) => {
    const phi = (i / RAYS) * Math.PI * 2, d = Math.max(0, r - 0.25);
    return [X + (t[0] * Math.cos(phi) + s[0] * Math.sin(phi)) * d, Z + (t[1] * Math.cos(phi) + s[1] * Math.sin(phi)) * d];
  });
  return ccw(simplifyClosed(outline, 0.35));
}

/** A pad's level: the middle of the ground under it, but never lower than `least`. */
function padLevel(g: FittedGround, poly: readonly Vec2[], least: number) {
  const xs = poly.map((p) => p[0]), zs = poly.map((p) => p[1]);
  const heights: number[] = [];
  for (let Z = Math.min(...zs); Z <= Math.max(...zs); Z += 1.5) for (let X = Math.min(...xs); X <= Math.max(...xs); X += 1.5) {
    if (inside(poly, X, Z)) heights.push(g.height(X, Z));
  }
  return Math.max(least, heights.length ? median(heights) : least);
}

/** Model metres from (X, Z) to the bisector between two sites' origins, positive on the side of `a`. */
const bisector = (a: Vec2, b: Vec2, X: number, Z: number) => {
  const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2, dx = a[0] - b[0], dz = a[1] - b[1], l = Math.hypot(dx, dz) || 1;
  return ((X - mx) * dx + (Z - mz) * dz) / l;
};

/** How close two sites' core pads may come and leave room for both their banks and the lane between. */
const CLASH = 12;

/** Whether two outlines come within `gap` metres of each other. */
function outlinesNear(a: readonly Vec2[], b: readonly Vec2[], gap: number) {
  return a.some(([x, z]) => polygonDistance(b, x, z) < gap) || b.some(([x, z]) => polygonDistance(a, x, z) < gap);
}

/** The works whose slots stand on pads of their own. */
const PADDED = ['battery', 'granary', 'beacon'] as const;

/** What it costs a later port to lose every spot it had. */
const LOST = 10;

/**
 * A spot a port's core pad could take: the outline it would have on an empty map, the part of it that must stand whole
 * (a neighbour may clip the rest), and whether it is still free.
 */
interface Option { spot: CoreSpot; search: CoreSearch; outline: Vec2[]; whole: Vec2[]; centre: Vec2; reach: number; live: boolean }

/**
 * Each port's spots on its own, searched by the loosest rules, each kept by the strictest rules it holds by and priced up
 * as TIERS says, cheapest first, with the outline it would take on an empty map.
 */
function portOptions(g: FittedGround, port: Port, site: number, ports: readonly Port[]): Option[] {
  const searches = TIERS.map((tier) => new CoreSearch(g, port, site, ports, tier.rules));
  const options = searches[searches.length - 1]!.spots().map((spot) => {
    let at = TIERS.length - 1, chosen = spot;
    for (let k = 0; k < TIERS.length - 1; k += 1) {
      const fit = searches[k]!.fit(spot.X, spot.Z, spot.rot);
      if (typeof fit !== 'string') { at = k; chosen = fit; break; }
    }
    const { rules, price } = TIERS[at]!;
    chosen = { ...chosen, cost: chosen.cost + price };
    const outline = coreOutline(g, chosen, site, rules.whole);
    const whole = boxCorners({ x: spot.X, z: spot.Z, rot: spot.rot, w: 2 * rules.whole.A, d: 2 * rules.whole.B });
    const reach = Math.max(...outline.map(([x, z]) => Math.hypot(x - spot.X, z - spot.Z)));
    return { spot: chosen, search: searches[at]!, outline, whole, centre: [spot.X, spot.Z] as Vec2, reach, live: true };
  });
  return options.sort((a, b) => a.spot.cost - b.spot.cost);
}

/**
 * Whether a later port's option no longer fits once a pad stands at `taken`: the part of the option that must stand whole
 * comes so close to the pad that the pad's bank and the lane between leave it no room. The rest of it would be clipped.
 */
function clashes(later: Option, taken: Pick<Option, 'outline' | 'centre' | 'reach'>) {
  if (Math.hypot(later.centre[0] - taken.centre[0], later.centre[1] - taken.centre[1]) > later.reach + taken.reach + CLASH) return false;
  return outlinesNear(later.whole, taken.outline, CLASH);
}

/**
 * The first pass over every port. First each port's spots for a core pad as if it stood alone. Then, in solve order, each
 * port takes the spot that costs least as the ground now is, its cost raised by what it would cost the ports still to come
 * (how much dearer each one's best free spot becomes, or LOST when it leaves one none), so a rich port does not take the
 * only good coast a poorer neighbour has when it has another nearly as good. A port crowded out of all its spots searches
 * the ground as it now is, by the loose rules and then the last. Then each site's battery, granary and beacon on pads of
 * their own, near its pad and best inside its cell, the ground nearer its pad than any other's.
 */
export function planPads(fitted: Fitted): { plans: PadPlan[]; failures: string[] } {
  const g = new FittedGround(fitted);
  const plans: (PadPlan & { site: number })[] = [];
  const failures: string[] = [];
  const ports = solveOrder(g.frame);
  const choices = ports.map((port, site) => portOptions(g, port, site, ports));
  const bestFree = (options: Option[], without?: Option) => options.find((o) => o.live && !(without && clashes(o, without)))?.spot.cost ?? Infinity;
  ports.forEach((port, site) => {
    const options = choices[site]!;
    const later = choices.slice(site + 1).filter((o, k) => Math.hypot(ports[site + 1 + k]!.X - port.X, ports[site + 1 + k]!.Z - port.Z) < 2 * LAST.search + 2 * CORE.A + CLASH);
    const tolled = options.filter((o) => o.live).slice(0, 16).map((option) => {
      let toll = 0;
      for (const other of later) {
        const before = bestFree(other);
        if (before === Infinity) continue;
        const after = bestFree(other, option);
        toll += after === Infinity ? LOST : after - before;
      }
      return { option, cost: option.spot.cost + toll };
    }).sort((a, b) => a.cost - b.cost);
    let best: { spot: CoreSpot; rules: CoreRules } | null = null, bestCost = Infinity;
    for (const [i, { option, cost }] of tolled.entries()) {
      // The cheapest few are tried finely as the ground now is; past them the first that still fits will do.
      if (best && i >= 4) break;
      const spot = option.search.refine(option.spot);
      const price = TIERS.find((t) => t.rules === option.search.rules)!.price;
      const total = spot ? spot.cost + price + (cost - option.spot.cost) : Infinity;
      if (spot && total < bestCost) { best = { spot, rules: option.search.rules }; bestCost = total; }
    }
    if (!best) {
      const crowded = new CoreSearch(g, port, site, ports, LAST);
      const spot = crowded.spots()[0];
      if (spot) best = { spot: crowded.refine(spot) ?? spot, rules: LAST };
      else failures.push(`${crowded.failure()} once its neighbours stood`);
    }
    if (!best) return;
    const outline = coreOutline(g, best.spot, site, best.rules.whole);
    const h0 = padLevel(g, outline, PAD_MIN);
    g.take(outline, h0, site);
    const placed = { outline, centre: [best.spot.X, best.spot.Z] as Vec2, reach: Math.max(...outline.map(([x, z]) => Math.hypot(x - best!.spot.X, z - best!.spot.Z))) };
    for (const other of later) for (const o of other) if (o.live && clashes(o, placed)) o.live = false;
    const { X, Z, rot } = best.spot;
    plans.push({ port, site, X, Z, rot, pads: [{ id: 'core', poly: outline.map(([x, z]) => [x - X, z - Z]), h0 }], works: {} });
  });
  for (const plan of plans) {
    const others = plans.filter((o) => o !== plan && Math.hypot(o.X - plan.X, o.Z - plan.Z) < 2 * (SEARCH + 160)).map((o) => [o.X, o.Z] as Vec2);
    const inCell = (X: number, Z: number, gap: number) => others.every((o) => bisector([plan.X, plan.Z], o, X, Z) >= gap);
    for (const kind of PADDED) {
      const slot = placeWorkPad(g, plan, kind, plan.site, inCell);
      // Where no pad fits, the second pass finds the work level ground of its own.
      if (!slot) continue;
      const poly = ccw(boxCorners(slot, 1));
      const h0 = padLevel(g, poly, 0.06);
      g.take(poly, h0, plan.site);
      plan.works[kind] = { ...slot, x: slot.x - plan.X, z: slot.z - plan.Z, y: h0 };
      plan.pads.push({ id: kind, poly: poly.map(([x, z]) => [x - plan.X, z - plan.Z]), h0 });
    }
  }
  return {
    plans: plans.map(({ site: _, ...plan }) => ({ ...plan, pads: plan.pads.map((p) => ({ ...p, poly: p.poly.map(([x, z]) => [round1(x), round1(z)] as Vec2), h0: round2(p.h0) })) })),
    failures,
  };
}

/**
 * A padded work's slot in the map frame: the battery on open ground over the shore with open water before its guns,
 * best on the seaward flank; the granary behind the camp by its land gate, facing the gate; the beacon on the highest
 * ground in reach, looking out to sea. Each keeps to its site's cell where it can; a crowded site's may stand beyond it,
 * on ground no other site holds.
 */
function placeWorkPad(g: FittedGround, plan: PadPlan, kind: 'battery' | 'granary' | 'beacon', site: number, inCell: (X: number, Z: number, gap: number) => boolean): Box | null {
  const { w, d } = SLOT_SIZE[kind];
  const { s } = siteAxes(plan.rot);
  const gate: Vec2 = [plan.X - s[0] * (CORE.B + 4), plan.Z - s[1] * (CORE.B + 4)];
  let best: { box: Box; cost: number } | null = null;
  const range = kind === 'beacon' ? [35, 180] : kind === 'battery' ? [30, 160] : [25, 140];
  const heights: number[] = [];
  for (let dz = -range[1]!; dz <= range[1]!; dz += 3) for (let dx = -range[1]!; dx <= range[1]!; dx += 3) {
    const far = Math.hypot(dx, dz);
    if (far < range[0]! || far > range[1]!) continue;
    const X = plan.X + dx, Z = plan.Z + dz;
    if (!g.open(X, Z, site)) continue;
    const away = inCell(X, Z, 4) ? 0 : 2;
    for (let k = 0; k < (kind === 'battery' ? 16 : 8); k += 1) {
      const rot = kind === 'battery' ? (k / 16) * Math.PI * 2
        : kind === 'granary' ? rotToward(gate[0] - X, gate[1] - Z) + ((k - 3.5) / 8) * 0.6
          : rotToward(s[0], s[1]) + ((k - 3.5) / 8) * 1.2;
      let cost = away;
      if (kind === 'battery') {
        // Open water before the guns, and the seaward side of the camp.
        let wet = 0;
        const front = [Math.sin(rot), Math.cos(rot)], across = [Math.cos(rot), -Math.sin(rot)];
        for (const ahead of [7, 14, 22, 32]) for (const side of [-6, 0, 6]) {
          if (g.sea(X + front[0]! * (d / 2 + ahead) + across[0]! * side, Z + front[1]! * (d / 2 + ahead) + across[1]! * side)) wet += 1;
        }
        if (wet < 5) continue;
        const seaward = (dx * s[0] + dz * s[1]) / far;
        cost += (12 - wet) * 0.15 + far / 90 + (1 - seaward) * 0.4;
      } else if (kind === 'granary') {
        cost += Math.hypot(X - gate[0], Z - gate[1]) / 25;
      } else {
        cost += far / 300;
      }
      const box: Box = { x: X, z: Z, rot, w, d };
      heights.length = 0;
      let fits = true;
      for (const [x, z] of boxSamples(box, 2.5, 1)) {
        if (!g.open(x, z, site)) { fits = false; break; }
        heights.push(g.height(x, z));
      }
      if (!fits) continue;
      const h0 = median(heights);
      let earth = 0;
      for (const h of heights) earth += Math.abs(h - h0);
      earth /= heights.length;
      // A battery likes a bluff; the beacon wants the summit above all but a pad's worth of earth moved.
      if (kind === 'battery') cost += earth - Math.min(h0, 3) * 0.08;
      else if (kind === 'granary') cost += earth;
      else cost += earth * 0.4 - h0;
      if (!best || cost < best.cost) best = { box, cost };
    }
  }
  return best?.box ?? null;
}

const round1 = (x: number) => Math.round(x * 10) / 10;
const round2 = (x: number) => Math.round(x * 100) / 100;

/** The pads of every site in the DEM's texels with their heights in metres, as the terrain build levels them. */
export function padsInTexels(sites: readonly Pick<SiteRecord, 'id' | 'u' | 'v' | 'pads'>[], W: number, H: number) {
  return sites.flatMap((site) => site.pads.map((pad) => ({
    site: site.id,
    id: pad.id,
    h0: pad.h0 / ELEVATION_METRE,
    poly: pad.poly.map(([x, z]) => {
      const { u, v } = siteToFrame(site, x, z);
      return [((u - DEM_RECT.u) / DEM_RECT.w) * (W - 1), ((v - DEM_RECT.v) / DEM_RECT.h) * (H - 1)] as Vec2;
    }),
  })));
}

/** A plan's site origin as the frame point the records keep. */
export function planOrigin(frame: Frame, plan: PadPlan) {
  return frame.uv(plan.X, plan.Z);
}

/** The ground of a site as the map draws it: heights bilinear like MapLayer.surface, the waterline where the drawn land meets the sea. */
export function gridGround(drawn: Drawn, origin: { u: number; v: number }): Ground {
  const frame = new Frame(drawn.W, drawn.H);
  const [X0, Z0] = frame.fromUV(origin.u, origin.v);
  return groundAt(drawn, frame, X0, Z0);
}

function groundAt(drawn: Drawn, frame: Frame, X0: number, Z0: number): Ground {
  const lift = (h: number) => Math.max(0, h);
  return {
    height: (x, z) => frame.bilinear(drawn.heights, X0 + x, Z0 + z, lift) * ELEVATION_METRE,
    water: (x, z) => frame.bilinear(drawn.heights, X0 + x, Z0 + z) <= 0,
  };
}

// ---------- the second pass: everything else, on the ground as the map draws it ----------

/** How far round its origin a site's things may reach, model metres. */
const REACH = 230;

/** A site's ground for the second pass: the drawn ground on a metre grid round its origin, and each sample's distance to the water and to the land. */
class SiteGround {
  readonly ground: Ground;
  /** Model metres above the sea plane, at or below 0 over the water: the drawn waterline. */
  readonly signed: Raster;
  /** Metres from each sample to the nearest water, and to the nearest land. */
  readonly toWater: Raster;
  readonly toLand: Raster;
  constructor(drawn: Drawn, frame: Frame, X0: number, Z0: number) {
    this.ground = groundAt(drawn, frame, X0, Z0);
    this.signed = new Raster(-REACH, -REACH, REACH, REACH, 1, (x, z) => frame.bilinear(drawn.heights, X0 + x, Z0 + z) * ELEVATION_METRE);
    const { nx, nz, data } = this.signed;
    this.toWater = this.signed.with(distanceField(nx, nz, (i) => data[i]! <= 0));
    this.toLand = this.signed.with(distanceField(nx, nz, (i) => data[i]! > 0));
  }
  water(x: number, z: number) {
    return this.ground.water(x, z);
  }
  height(x: number, z: number) {
    return this.ground.height(x, z);
  }
  /** The least and greatest ground under a box, and whether every metre of it is land at least `clear` metres from the water. */
  under(box: Box, clear = 0) {
    let lo = Infinity, hi = -Infinity, dry = true;
    for (const [x, z] of boxSamples(box, 1)) {
      if (this.water(x, z) || (clear > 0 && this.toWater.at(x, z, 0) < clear)) dry = false;
      const h = this.height(x, z);
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
    }
    return { lo, hi, dry };
  }
  /** Whether every metre and a half of a box is water at least `clear` metres from the land. */
  afloat(box: Box, clear: number) {
    return boxSamples(box, 1.5).every(([x, z]) => this.water(x, z) && this.toLand.at(x, z) >= clear);
  }
}

/** What a site has put down so far, in the map frame, for every later thing of any site to keep clear of. */
class Claims {
  private readonly list: { site: number; outline: Vec2[]; centre: Vec2; reach: number }[] = [];
  add(site: number, outline: readonly Vec2[]) {
    const centre: Vec2 = [outline.reduce((n, p) => n + p[0], 0) / outline.length, outline.reduce((n, p) => n + p[1], 0) / outline.length];
    this.list.push({ site, outline: [...outline], centre, reach: Math.max(...outline.map(([x, z]) => Math.hypot(x - centre[0], z - centre[1]))) });
  }
  /** Whether an outline in the map frame keeps `gap` from everything claimed (of every site, or of the others only). */
  clear(outline: readonly Vec2[], gap: number, except = -1) {
    const centre: Vec2 = [outline.reduce((n, p) => n + p[0], 0) / outline.length, outline.reduce((n, p) => n + p[1], 0) / outline.length];
    const reach = Math.max(...outline.map(([x, z]) => Math.hypot(x - centre[0], z - centre[1])));
    return this.list.every((c) => c.site === except || Math.hypot(c.centre[0] - centre[0], c.centre[1] - centre[1]) > c.reach + reach + gap || !outlinesTouch(c.outline, outline, gap));
  }
}

/** A site as the second pass lays it out: its plan, its ground, its cell, and the claims of every site. */
interface Layout {
  plan: PadPlan;
  site: number;
  sg: SiteGround;
  claims: Claims;
  /** Whether a point of the site's frame lies `gap` metres inside its cell, the ground nearer its pad than any other's. */
  inCell(x: number, z: number, gap: number): boolean;
}

/** Whether an outline in a site's frame stands inside its cell and clear of everything put down so far. */
function free(l: Layout, outline: readonly Vec2[], gap: number) {
  return outline.every(([x, z]) => l.inCell(x, z, 1)) && l.claims.clear(outline.map(([x, z]) => [x + l.plan.X, z + l.plan.Z] as Vec2), gap);
}

/** Puts an outline in a site's frame down as claimed. */
function claim(l: Layout, outline: readonly Vec2[]) {
  l.claims.add(l.site, outline.map(([x, z]) => [x + l.plan.X, z + l.plan.Z] as Vec2));
}

/** The coast round a site: the drawn waterline as lines with the water on their right, cut where they reach the grid's edge. */
function coastLines(sg: SiteGround): Vec2[][] {
  const edge = REACH - 2;
  const onEdge = (p: Vec2) => Math.abs(p[0]) >= edge || Math.abs(p[1]) >= edge;
  const lines: Vec2[][] = [];
  for (const loop of rasterLoops(sg.signed, 0)) {
    // Which way round: the water must lie to the right of the way the line runs.
    let k = 0;
    while (k < loop.length - 2 && Math.hypot(loop[k + 1]![0] - loop[k]![0], loop[k + 1]![1] - loop[k]![1]) < 0.2) k += 1;
    const a = loop[k]!, b = loop[k + 1]!, l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const right: Vec2 = [(a[0] + b[0]) / 2 - ((b[1] - a[1]) / l) * 0.4, (a[1] + b[1]) / 2 + ((b[0] - a[0]) / l) * 0.4];
    const ordered = sg.water(right[0], right[1]) ? loop : [...loop].reverse();
    const start = ordered.findIndex(onEdge);
    if (start < 0) {
      lines.push([...ordered, ordered[0]!]);
      continue;
    }
    let run: Vec2[] = [];
    for (const p of [...ordered.slice(start), ...ordered.slice(0, start)]) {
      if (!onEdge(p)) run.push(p);
      else {
        if (run.length > 1) lines.push(run);
        run = [];
      }
    }
    if (run.length > 1) lines.push(run);
  }
  return lines;
}

/** The unit normal toward the water of a line with the water on its right, at `s` metres along it, over a few metres of it. */
function waterSide(line: readonly Vec2[], s: number): Vec2 {
  const a = along(line, s - 3).at, b = along(line, s + 3).at, l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  return [-(b[1] - a[1]) / l, (b[0] - a[0]) / l];
}

/** Metres along a line to each of its points. */
function stations(line: readonly Vec2[]) {
  const out = [0];
  for (let i = 1; i < line.length; i += 1) out.push(out[i - 1]! + Math.hypot(line[i]![0] - line[i - 1]![0], line[i]![1] - line[i - 1]![1]));
  return out;
}

/** The most land the quay may stand from the core pad, and the length of the quay each tier builds. */
const QUAY_REACH = 15, QUAY_SPAN: Record<Tier, number> = { 1: 0, 2: 22, 3: 52 };
/** Each tier's pier: the lengths it tries, longest first, and its width. */
const PIERS: Record<Tier, { len: number[]; width: number }> = {
  1: { len: [13.5, 12, 10.5], width: 3 },
  2: { len: [17.5, 15.5, 13.5], width: 3.5 },
  3: { len: [19.5, 17.5, 15], width: 4 },
};
/** How many hulls a port can take, at its berths and at anchor together. */
const HULLS = 12;

/**
 * The quay: the stretch of the coast before the core pad every point of which is within QUAY_REACH of the pad over land
 * only, set half a metre inside the waterline, smoothed and resampled every 2 m, the water on its right.
 */
function quayLine(sg: SiteGround, pad: readonly Vec2[], coast: readonly Vec2[][]): Vec2[] | null {
  const reaches = (p: Vec2) => {
    const d = polygonDistance(pad, p[0], p[1]);
    if (d < 0 || d > QUAY_REACH) return false;
    const q = nearestOnOutline(pad, p[0], p[1]);
    for (let t = 0.1; t < 0.95; t += 0.1) if (sg.water(q[0] + (p[0] - q[0]) * t, q[1] + (p[1] - q[1]) * t)) return false;
    return true;
  };
  let best: Vec2[] = [];
  for (const line of coast) {
    let run: Vec2[] = [];
    for (const p of [...line, null]) {
      if (p && reaches(p)) run.push(p);
      else {
        if (lineLength(run) > lineLength(best)) best = run;
        run = [];
      }
    }
  }
  if (lineLength(best) < 12) return null;
  const fine = resample(best, 1);
  const inland = fine.map((p, i): Vec2 => {
    const a = fine[Math.max(0, i - 2)]!, b = fine[Math.min(fine.length - 1, i + 2)]!, l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [p[0] + ((b[1] - a[1]) / l) * 0.5, p[1] - ((b[0] - a[0]) / l) * 0.5];
  });
  return resample(simplify(inland, 0.25), 2);
}

/** A pier's footprint from its root on the quay out `len` metres along `rot`. */
const pierBox = (p: { x: number; z: number; rot: number; len: number; width: number }): Box => ({
  x: p.x + Math.sin(p.rot) * (p.len / 2), z: p.z + Math.cos(p.rot) * (p.len / 2), rot: p.rot, w: p.width, d: p.len,
});

/**
 * The harbour before the core pad: the quay on the real shore, the gate where the camp's axis meets it, the stretch each
 * tier builds round the gate, a pier for each tier out over open water (the first at the gate, the next to either side)
 * with hulls moored alongside where there is room. The anchorage comes later, once the yards are down.
 */
function solveHarbour(l: Layout, coast: readonly Vec2[][]): Omit<Harbour, 'anchorage'> | string {
  const { sg, plan } = l;
  const pad = plan.pads[0]!.poly;
  const quay = quayLine(sg, pad, coast);
  if (!quay) return 'no stretch of shore within reach of the pad for a quay';
  const at = stations(quay), L = at[at.length - 1]!;
  const s: Vec2 = [Math.sin(plan.rot), Math.cos(plan.rot)];
  // The gate: the quay point nearest the camp's axis out to sea.
  let gateAt = 0, off = Infinity;
  quay.forEach((p, i) => {
    const across = Math.abs(p[0] * s[1] - p[1] * s[0]);
    if (p[0] * s[0] + p[1] * s[1] > 0 && across < off) { off = across; gateAt = at[i]!; }
  });
  const gatePoint = along(quay, gateAt).at, gateSide = waterSide(quay, gateAt);
  const gate: Place = { x: gatePoint[0], z: gatePoint[1], rot: rotToward(gateSide[0], gateSide[1]) };
  const stretch = (length: number): [number, number] => {
    if (length === 0) return [gateAt, gateAt];
    const from = Math.max(0, Math.min(gateAt - length / 2, L - length));
    return [from, Math.min(L, from + length)];
  };
  const span = { 1: stretch(QUAY_SPAN[1]), 2: stretch(QUAY_SPAN[2]), 3: stretch(QUAY_SPAN[3]) };
  const piers: Pier[] = [];
  for (const tier of [1, 2, 3] as const) {
    const { len, width } = PIERS[tier];
    // The first at the gate, the second toward the longer side of the quay, the third toward the other.
    const longer = L - gateAt > gateAt ? 1 : -1;
    const want = gateAt + (tier === 1 ? 0 : tier === 2 ? 14 * longer : -14 * longer);
    const tries = Array.from({ length: Math.floor(L) + 1 }, (_, i) => i).sort((a, b) => Math.abs(a - want) - Math.abs(b - want));
    let placed: Pier | null = null;
    for (const a of tries) {
      if (piers.some((p) => Math.abs(stationOf(quay, p) - a) < 13)) continue;
      const root = along(quay, a).at, side = waterSide(quay, a), rot = rotToward(side[0], side[1]);
      for (const length of len) {
        const pier = { x: root[0], z: root[1], rot, len: length, width, from: tier, berths: [] as Place[] };
        const box = pierBox(pier);
        // Out over the water past its first two metres, the far end in open water, clear of the other piers.
        const out: Box = { ...pierBox({ ...pier, len: length - 2 }), x: box.x + side[0], z: box.z + side[1] };
        if (!sg.afloat(out, 0) || sg.toLand.at(root[0] + side[0] * length, root[1] + side[1] * length) < 2.5) continue;
        if (piers.some((p) => boxesOverlap(pierBox(p), box, 6))) continue;
        if (!free(l, boxCorners(box), 1)) continue;
        placed = pier;
        break;
      }
      if (placed) break;
    }
    if (!placed) return `no pier of tier ${tier} fits off the quay`;
    piers.push(placed);
  }
  // Hulls moored alongside each pier, bows out, their sterns a metre and a half off the quay.
  const berths: Box[] = [];
  for (const pier of piers) {
    const dir = [Math.sin(pier.rot), Math.cos(pier.rot)], across = [Math.cos(pier.rot), -Math.sin(pier.rot)];
    for (const sign of [1, -1]) {
      const off = pier.width / 2 + BERTH.beam / 2 + 0.6;
      const hull: Box = { x: pier.x + dir[0]! * (BERTH.length / 2 + 1.5) + across[0]! * off * sign, z: pier.z + dir[1]! * (BERTH.length / 2 + 1.5) + across[1]! * off * sign, rot: pier.rot, w: BERTH.beam, d: BERTH.length };
      if (!sg.afloat(hull, 1)) continue;
      if (piers.some((p) => boxesOverlap(pierBox(p), hull, 0.5)) || berths.some((b) => boxesOverlap(b, hull, 1.5))) continue;
      if (!free(l, boxCorners(hull), 1)) continue;
      berths.push(hull);
      pier.berths.push({ x: hull.x, z: hull.z, rot: hull.rot });
    }
  }
  for (const pier of piers) claim(l, boxCorners(pierBox(pier)));
  for (const hull of berths) claim(l, boxCorners(hull));
  return { quay, span, gate, piers, breakwater: [] };
}

/** Metres along the quay to a pier's root. */
function stationOf(quay: readonly Vec2[], pier: Place): number {
  let best = 0, d = Infinity;
  const at = stations(quay);
  quay.forEach((p, i) => {
    const e = Math.hypot(p[0] - pier.x, p[1] - pier.z);
    if (e < d) { d = e; best = at[i]!; }
  });
  return best;
}

/**
 * A yard or a dock across the waterline: its land part (local z below `shore`) on low ground that varies by no more than
 * PAD_RANGE, its water part open water, its front out to sea; along the coast within the site's cell, nearest the gate,
 * clear of the harbour and everything else.
 */
function placeSlipway(l: Layout, coast: readonly Vec2[][], kind: 'shipyard' | 'dock', near: Vec2): WorkSlot | null {
  const { w, d } = SLOT_SIZE[kind];
  const shore = kind === 'shipyard' ? -6 : -5;
  let best: { slot: WorkSlot; cost: number } | null = null;
  for (const line of coast) {
    const total = lineLength(line);
    for (let a = 3; a < total - 3; a += 2) {
      const p = along(line, a).at;
      const far = Math.hypot(p[0], p[1]);
      if (far < 30 || far > 170) continue;
      const side = waterSide(line, a), rot = rotToward(side[0], side[1]);
      // The waterline at local z = shore: the slot's middle lies |shore| metres out from it.
      const box: Box = { x: p[0] - side[0] * shore, z: p[1] - side[1] * shore, rot, w, d };
      // A part of the slot from local z0 to z1, the waterline at local z = shore.
      const part = (z0: number, z1: number): Box => ({ x: p[0] + side[0] * ((z0 + z1) / 2 - shore), z: p[1] + side[1] * ((z0 + z1) / 2 - shore), rot, w, d: z1 - z0 });
      // The water's ground is the sea plane, so the most the ground varies under the slot is the land part's highest.
      const ground = l.sg.under(part(-d / 2, shore - 1));
      if (!ground.dry || ground.hi > PAD_RANGE) continue;
      if (!l.sg.afloat(part(shore + 1.5, d / 2), 0.5)) continue;
      if (!free(l, boxCorners(box), 2)) continue;
      const cost = Math.hypot(box.x - near[0], box.z - near[1]) / 40 + ground.hi;
      if (!best || cost < best.cost) best = { slot: { kind, ...box, y: ground.hi, drop: ground.hi, shore }, cost };
    }
  }
  return best?.slot ?? null;
}
