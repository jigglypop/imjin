import { outlineArea, type Vec2 } from './types';

// Plane geometry of the settlements' sites, in a site's frame (x east, z south, model metres), shared by the solver, the
// lots and the ground works.

/** Whether (x, z) lies inside a polygon (even-odd). */
export function inside(poly: readonly Vec2[], x: number, z: number): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const [ax, az] = poly[j]!, [bx, bz] = poly[i]!;
    if ((az > z) !== (bz > z) && x < ((bx - ax) * (z - az)) / (bz - az) + ax) hit = !hit;
  }
  return hit;
}

/** Distance from (x, z) to the segment a-b. */
export function segmentDistance(x: number, z: number, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0], dz = b[1] - a[1], l = dx * dx + dz * dz;
  const t = l > 0 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l)) : 0;
  return Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t);
}

/** Distance from (x, z) to a line through `points`, joined back to its start when `closed`. */
export function lineDistance(points: readonly Vec2[], x: number, z: number, closed: boolean): number {
  let d = Infinity;
  const n = closed ? points.length : points.length - 1;
  for (let i = 0; i < n; i += 1) d = Math.min(d, segmentDistance(x, z, points[i]!, points[(i + 1) % points.length]!));
  return d;
}

/** Distance from (x, z) to a polygon's outline, negative inside it. */
export function polygonDistance(poly: readonly Vec2[], x: number, z: number): number {
  const d = lineDistance(poly, x, z, true);
  return inside(poly, x, z) ? -d : d;
}

/** The outline run the contract's way round (counter-clockwise seen from above, outlineArea > 0). */
export function ccw(points: Vec2[]): Vec2[] {
  return outlineArea(points) < 0 ? [...points].reverse() : points;
}

/** Length of a line through `points`. */
export function lineLength(points: readonly Vec2[], closed = false): number {
  let n = 0;
  const k = closed ? points.length : points.length - 1;
  for (let i = 0; i < k; i += 1) {
    const a = points[i]!, b = points[(i + 1) % points.length]!;
    n += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return n;
}

/** The point `s` metres along an open line and the unit direction it runs there. */
export function along(points: readonly Vec2[], s: number): { at: Vec2; dir: Vec2 } {
  let left = Math.max(0, s);
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i]!, b = points[i + 1]!;
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (l === 0) continue;
    const dir: Vec2 = [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
    if (left <= l || i === points.length - 2) {
      const t = Math.min(left, l);
      return { at: [a[0] + dir[0] * t, a[1] + dir[1] * t], dir };
    }
    left -= l;
  }
  const p = points[points.length - 1]!;
  return { at: [p[0], p[1]], dir: [1, 0] };
}

/** The stretch of an open line from `s0` to `s1` metres along it. */
export function slice(points: readonly Vec2[], s0: number, s1: number): Vec2[] {
  const out: Vec2[] = [along(points, s0).at];
  let at = 0;
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i]!, b = points[i + 1]!;
    at += Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (at > s0 && at < s1) out.push([b[0], b[1]]);
  }
  out.push(along(points, s1).at);
  return out;
}

/** An open line resampled every `step` metres or a little less, ends kept. */
export function resample(points: readonly Vec2[], step: number): Vec2[] {
  const length = lineLength(points);
  const n = Math.max(1, Math.round(length / step));
  return Array.from({ length: n + 1 }, (_, i) => along(points, (length * i) / n).at);
}

/** Douglas-Peucker: the fewest of `points` that keep an open line within `tolerance` of itself. */
export function simplify(points: readonly Vec2[], tolerance: number): Vec2[] {
  if (points.length < 3) return [...points];
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [i0, i1] = stack.pop()!;
    let worst = -1, at = -1;
    for (let i = i0 + 1; i < i1; i += 1) {
      const d = segmentDistance(points[i]![0], points[i]![1], points[i0]!, points[i1]!);
      if (d > worst) { worst = d; at = i; }
    }
    if (worst > tolerance) {
      keep[at] = 1;
      stack.push([i0, at], [at, i1]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/** Douglas-Peucker on a closed outline, split at its two farthest-apart points so the result keeps its shape. */
export function simplifyClosed(points: readonly Vec2[], tolerance: number): Vec2[] {
  let far = 0, best = -1;
  for (let i = 1; i < points.length; i += 1) {
    const d = Math.hypot(points[i]![0] - points[0]![0], points[i]![1] - points[0]![1]);
    if (d > best) { best = d; far = i; }
  }
  const a = simplify(points.slice(0, far + 1), tolerance);
  const b = simplify([...points.slice(far), points[0]!], tolerance);
  return [...a, ...b.slice(1, -1)];
}

/** Local x (across) and z (front) of a thing turned by `rot`, in a site's x and z. */
export const axes = (rot: number) => ({ across: [Math.cos(rot), -Math.sin(rot)] as Vec2, front: [Math.sin(rot), Math.cos(rot)] as Vec2 });

/** A turned rectangle: its middle, turn and size (w across, d along its front), as lots and slots are. */
export interface Box { x: number; z: number; rot: number; w: number; d: number }

/** The point of a box at its own (a across, b along its front). */
export function boxPoint(b: Box, a: number, f: number): Vec2 {
  const { across, front } = axes(b.rot);
  return [b.x + across[0] * a + front[0] * f, b.z + across[1] * a + front[1] * f];
}

/** A box's corners counter-clockwise seen from above. */
export function boxCorners(b: Box, grow = 0): Vec2[] {
  const hw = b.w / 2 + grow, hd = b.d / 2 + grow;
  return [boxPoint(b, -hw, -hd), boxPoint(b, -hw, hd), boxPoint(b, hw, hd), boxPoint(b, hw, -hd)];
}

/** Points over a box (corners, edges and inside), about `step` metres apart. */
export function boxSamples(b: Box, step: number, grow = 0): Vec2[] {
  const out: Vec2[] = [];
  const w = b.w + 2 * grow, d = b.d + 2 * grow;
  const nw = Math.max(1, Math.ceil(w / step)), nd = Math.max(1, Math.ceil(d / step));
  for (let i = 0; i <= nw; i += 1) for (let j = 0; j <= nd; j += 1) out.push(boxPoint(b, -w / 2 + (w * i) / nw, -d / 2 + (d * j) / nd));
  return out;
}

/** Whether two convex outlines overlap (separating axes); touching counts as apart. */
export function convexOverlap(a: readonly Vec2[], b: readonly Vec2[]): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i += 1) {
      const p = poly[i]!, q = poly[(i + 1) % poly.length]!;
      const nx = q[1] - p[1], nz = p[0] - q[0];
      let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
      for (const [x, z] of a) { const s = x * nx + z * nz; a0 = Math.min(a0, s); a1 = Math.max(a1, s); }
      for (const [x, z] of b) { const s = x * nx + z * nz; b0 = Math.min(b0, s); b1 = Math.max(b1, s); }
      if (a1 <= b0 || b1 <= a0) return false;
    }
  }
  return true;
}

/** Whether two boxes, each grown by `gap / 2`, overlap. */
export const boxesOverlap = (a: Box, b: Box, gap = 0) => convexOverlap(boxCorners(a, gap / 2), boxCorners(b, gap / 2));

/** Whether a box comes within `gap` of a polygon or a line (a box inside a polygon counts as touching it). */
export function boxNearLine(b: Box, points: readonly Vec2[], closed: boolean, gap: number): boolean {
  const corners = boxCorners(b);
  if (closed && inside(points, b.x, b.z)) return true;
  if (points.some(([x, z]) => inside(corners, x, z))) return true;
  const n = closed ? points.length : points.length - 1;
  for (let i = 0; i < n; i += 1) {
    const p = points[i]!, q = points[(i + 1) % points.length]!;
    if (corners.some(([x, z]) => segmentDistance(x, z, p, q) < gap)) return true;
    for (let k = 0; k < 4; k += 1) if (segmentsDistance(corners[k]!, corners[(k + 1) % 4]!, p, q) < gap) return true;
  }
  return false;
}

/** Least distance between the segments a-b and c-d. */
export function segmentsDistance(a: Vec2, b: Vec2, c: Vec2, d: Vec2): number {
  const cross = (p: Vec2, q: Vec2, r: Vec2) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = cross(a, b, c), d2 = cross(a, b, d), d3 = cross(c, d, a), d4 = cross(c, d, b);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return 0;
  return Math.min(segmentDistance(a[0], a[1], c, d), segmentDistance(b[0], b[1], c, d), segmentDistance(c[0], c[1], a, b), segmentDistance(d[0], d[1], a, b));
}

/** Turn of the shortest way from angle a to angle b. */
export const turnBetween = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

/** A deterministic hash of a string to 32 bits, to seed what varies between sites. */
export function hashString(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** A small deterministic random sequence in 0..1 from a seed (mulberry32). */
export function sequence(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- rasters ----------

/** Values on a grid over a rectangle of a site's frame, `step` metres apart, read at the nearest sample. */
export class Raster {
  readonly nx: number;
  readonly nz: number;
  readonly data: Float32Array;
  constructor(readonly x0: number, readonly z0: number, x1: number, z1: number, readonly step: number, value?: (x: number, z: number) => number) {
    this.nx = Math.max(2, Math.ceil((x1 - x0) / step) + 1);
    this.nz = Math.max(2, Math.ceil((z1 - z0) / step) + 1);
    this.data = new Float32Array(this.nx * this.nz);
    if (value) for (let j = 0; j < this.nz; j += 1) for (let i = 0; i < this.nx; i += 1) this.data[j * this.nx + i] = value(x0 + i * step, z0 + j * step);
  }
  /** The value at the sample nearest (x, z), `outside` beyond the grid. */
  at(x: number, z: number, outside = Infinity) {
    const i = Math.round((x - this.x0) / this.step), j = Math.round((z - this.z0) / this.step);
    return i < 0 || j < 0 || i >= this.nx || j >= this.nz ? outside : this.data[j * this.nx + i]!;
  }
  /** A raster on the same grid holding `data`. */
  with(data: Float32Array): Raster {
    const out = new Raster(this.x0, this.z0, this.x0 + (this.nx - 1) * this.step, this.z0 + (this.nz - 1) * this.step, this.step);
    out.data.set(data);
    return out;
  }
}

/** Whether two outlines come within `gap` of each other, one inside the other included. */
export function outlinesTouch(a: readonly Vec2[], b: readonly Vec2[], gap: number): boolean {
  if (a.some(([x, z]) => inside(b, x, z)) || b.some(([x, z]) => inside(a, x, z))) return true;
  for (let i = 0; i < a.length; i += 1) {
    const p = a[i]!, q = a[(i + 1) % a.length]!;
    for (let k = 0; k < b.length; k += 1) if (segmentsDistance(p, q, b[k]!, b[(k + 1) % b.length]!) < gap) return true;
  }
  return false;
}

/** The point of a polygon's outline nearest (x, z). */
export function nearestOnOutline(poly: readonly Vec2[], x: number, z: number): Vec2 {
  let best: Vec2 = poly[0]!, d = Infinity;
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i]!, b = poly[(i + 1) % poly.length]!;
    const dx = b[0] - a[0], dz = b[1] - a[1], l = dx * dx + dz * dz;
    const t = l > 0 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l)) : 0;
    const p: Vec2 = [a[0] + dx * t, a[1] + dz * t], e = Math.hypot(x - p[0], z - p[1]);
    if (e < d) { d = e; best = p; }
  }
  return best;
}

/**
 * Every closed line of a raster's marching-squares contour at `level`, round where it is at or below the level. The
 * grid's edge counts as above the level, so every line closes: where it runs along the edge it follows the outermost
 * samples.
 */
export function rasterLoops(r: Raster, level = 0): Vec2[][] {
  const { nx, nz, data, step, x0, z0 } = r;
  const value = (i: number, j: number) => (i < 0 || j < 0 || i >= nx || j >= nz ? Infinity : data[j * nx + i]!);
  const below = (i: number, j: number) => value(i, j) <= level;
  // Where the contour crosses each cell edge, keyed by the edge: horizontal edges 2k, vertical 2k + 1 (k the edge's
  // first corner), over a grid grown by one cell all round so the border is outside.
  const W = nx + 2;
  const key = (i: number, j: number, vertical: boolean) => 2 * ((j + 1) * W + (i + 1)) + (vertical ? 1 : 0);
  const crossing = (i: number, j: number, vertical: boolean): Vec2 => {
    const a = value(i, j), b = vertical ? value(i, j + 1) : value(i + 1, j);
    const t = !Number.isFinite(a) ? 1 : !Number.isFinite(b) ? 0 : Math.max(0, Math.min(1, (level - a) / (b - a)));
    return vertical ? [x0 + i * step, z0 + (j + t) * step] : [x0 + (i + t) * step, z0 + j * step];
  };
  const links = new Map<number, number[]>();
  const link = (a: number, b: number) => {
    (links.get(a) ?? links.set(a, []).get(a)!).push(b);
    (links.get(b) ?? links.set(b, []).get(b)!).push(a);
  };
  for (let j = -1; j < nz; j += 1) for (let i = -1; i < nx; i += 1) {
    const tl = below(i, j), tr = below(i + 1, j), br = below(i + 1, j + 1), bl = below(i, j + 1);
    const top = key(i, j, false), right = key(i + 1, j, true), bottom = key(i, j + 1, false), left = key(i, j, true);
    const edges: number[] = [];
    if (tl !== tr) edges.push(top);
    if (tr !== br) edges.push(right);
    if (br !== bl) edges.push(bottom);
    if (bl !== tl) edges.push(left);
    if (edges.length === 2) link(edges[0]!, edges[1]!);
    else if (edges.length === 4) {
      // A saddle: the middle decides which corners join.
      const middle = (value(i, j) + value(i + 1, j) + value(i + 1, j + 1) + value(i, j + 1)) / 4 <= level;
      if (middle === tl) { link(top, right); link(bottom, left); } else { link(top, left); link(bottom, right); }
    }
  }
  const point = (k: number): Vec2 => {
    const vertical = (k & 1) === 1, cell = k >> 1, j = Math.floor(cell / W) - 1, i = (cell % W) - 1;
    return crossing(i, j, vertical);
  };
  const seen = new Set<number>();
  const loops: Vec2[][] = [];
  for (const start of links.keys()) {
    if (seen.has(start)) continue;
    const loop: Vec2[] = [];
    let prev = -1, at = start;
    while (!seen.has(at)) {
      seen.add(at);
      loop.push(point(at));
      const next = links.get(at)!.find((n) => n !== prev && !seen.has(n));
      if (next === undefined) break;
      prev = at;
      at = next;
    }
    if (loop.length >= 3) loops.push(loop);
  }
  return loops;
}

/** The outline of where a raster is at or below `level`: its contour's largest loop, counter-clockwise, simplified to `tolerance`. */
export function rasterOutline(r: Raster, level = 0, tolerance = 0.3): Vec2[] {
  let best: Vec2[] = [], area = 0;
  for (const loop of rasterLoops(r, level)) {
    const a = Math.abs(outlineArea(loop));
    if (a > area) { area = a; best = loop; }
  }
  return best.length < 3 ? [] : ccw(simplifyClosed(best, tolerance));
}
