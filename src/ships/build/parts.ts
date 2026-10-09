/**
 * Modular ship parts. Everything is three-free: parts append triangles to a MeshBuilder, which hands plain typed
 * arrays to the renderer. One builder = one merged geometry = one draw call per ship model and LOD.
 *
 * Vertex layout of the merged mesh (see MeshData):
 *   position, normal, uv (tile space: repeats per atlas cell, wrapped in the shader), color (tint x AO),
 *   mat = (atlas cell, surface class), sway = (weight, phase) for cloth that flutters. bakeGrime adds a soot amount (0..1) to mat's surface class as a fraction of SOOT_STEP.
 * Ship space is +X bow, +Y up, Z across the beam, origin amidships on the waterline, metres.
 */
import { cellOf, type Faction } from './atlas';
import { SURF } from './surf';

export type V3 = [number, number, number];
export type V2 = [number, number];


export { SURF };

export type MeshData = {
  position: Float32Array;
  normal: Float32Array;
  uv: Float32Array;
  color: Float32Array;
  mat: Float32Array;
  sway: Float32Array;
  index: Uint32Array;
};

// ---------- vector helpers ----------

export const v3 = (x = 0, y = 0, z = 0): V3 => [x, y, z];
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
export const norm = (a: V3): V3 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
export const lerp3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
export const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Affine transform: row-major 3x3 rotation(+uniform scale) and a translation. */
export type Xf = { r: number[]; t: V3 };
export const IDENTITY: Xf = { r: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0] };
export const applyP = (m: Xf, p: V3): V3 => [
  m.r[0]! * p[0] + m.r[1]! * p[1] + m.r[2]! * p[2] + m.t[0],
  m.r[3]! * p[0] + m.r[4]! * p[1] + m.r[5]! * p[2] + m.t[1],
  m.r[6]! * p[0] + m.r[7]! * p[1] + m.r[8]! * p[2] + m.t[2],
];
export const applyV = (m: Xf, p: V3): V3 => [
  m.r[0]! * p[0] + m.r[1]! * p[1] + m.r[2]! * p[2],
  m.r[3]! * p[0] + m.r[4]! * p[1] + m.r[5]! * p[2],
  m.r[6]! * p[0] + m.r[7]! * p[1] + m.r[8]! * p[2],
];
/** a after b: applies b first. */
export const compose = (a: Xf, b: Xf): Xf => {
  const r: number[] = [];
  for (let i = 0; i < 3; i += 1) for (let j = 0; j < 3; j += 1) r.push(a.r[i * 3]! * b.r[j]! + a.r[i * 3 + 1]! * b.r[3 + j]! + a.r[i * 3 + 2]! * b.r[6 + j]!);
  return { r, t: applyP(a, b.t) };
};
export const xlate = (x: number, y: number, z: number): Xf => ({ r: IDENTITY.r, t: [x, y, z] });
export const rotX = (a: number): Xf => ({ r: [1, 0, 0, 0, Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a)], t: [0, 0, 0] });
export const rotY = (a: number): Xf => ({ r: [Math.cos(a), 0, Math.sin(a), 0, 1, 0, -Math.sin(a), 0, Math.cos(a)], t: [0, 0, 0] });
export const rotZ = (a: number): Xf => ({ r: [Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a), 0, 0, 0, 1], t: [0, 0, 0] });
export const scaleXf = (k: number): Xf => ({ r: [k, 0, 0, 0, k, 0, 0, 0, k], t: [0, 0, 0] });
/** Frame whose +X axis points along dir (+Y kept as close to up as possible), positioned at p. */
export const frameAlong = (p: V3, dir: V3, up: V3 = [0, 1, 0]): Xf => {
  const x = norm(dir);
  let z = cross(x, up);
  if (len(z) < 1e-5) z = cross(x, [0, 0, 1]);
  z = norm(z);
  const y = cross(z, x);
  return { r: [x[0], y[0], z[0], x[1], y[1], z[1], x[2], y[2], z[2]], t: p };
};

// ---------- paint ----------

export type PaintOpts = {
  surf?: number;
  tint?: V3;
  /** Metres per tile override. */
  size?: number;
  /** Fixed mapping into the cell in tile space (flags, panels): map(u, v) takes 0..1 inside it. */
  rect?: [number, number, number, number];
};

/** What a primitive looks like: which atlas cell, how it is lit, and how metres map to uv. */
export class Paint {
  constructor(
    readonly cell: number,
    readonly size: number,
    readonly surf: number,
    readonly tint: V3,
    readonly rect?: [number, number, number, number],
  ) {}

  /** u, v in metres for tiled paints; 0..1 for rect paints. */
  map(u: number, v: number): V2 {
    if (this.rect) return [this.rect[0] + (this.rect[2] - this.rect[0]) * u, this.rect[1] + (this.rect[3] - this.rect[1]) * v];
    return [u / this.size, v / this.size];
  }

  tinted(tint: V3) {
    return new Paint(this.cell, this.size, this.surf, tint, this.rect);
  }
}

/** Paint factory bound to a faction's atlas layout. */
export function paints(faction: Faction) {
  return (name: string, opts: PaintOpts = {}) => {
    const c = cellOf(faction, name);
    return new Paint(c.index, opts.size ?? c.size, opts.surf ?? c.surf, opts.tint ?? [1, 1, 1], opts.rect);
  };
}

// ---------- builder ----------

export class MeshBuilder {
  private p: number[] = [];
  private n: number[] = [];
  private uv: number[] = [];
  private c: number[] = [];
  private m: number[] = [];
  private s: number[] = [];
  private idx: number[] = [];
  private stack: Xf[] = [IDENTITY];

  get xf() {
    return this.stack[this.stack.length - 1]!;
  }

  get triCount() {
    return this.idx.length / 3;
  }

  get vertCount() {
    return this.p.length / 3;
  }

  /** Run fn with every vertex it adds transformed by xf (in the current local space). */
  with(xf: Xf, fn: () => void) {
    this.stack.push(compose(this.xf, xf));
    fn();
    this.stack.pop();
  }

  vert(pos: V3, nor: V3, uv: V2, paint: Paint, sway?: V2): number {
    const xf = this.xf;
    const P = applyP(xf, pos);
    const N = norm(applyV(xf, nor));
    this.p.push(P[0], P[1], P[2]);
    this.n.push(N[0], N[1], N[2]);
    this.uv.push(uv[0], uv[1]);
    this.c.push(paint.tint[0], paint.tint[1], paint.tint[2]);
    this.m.push(paint.cell, paint.surf);
    this.s.push(sway ? sway[0] : 0, sway ? sway[1] : 0);
    return this.p.length / 3 - 1;
  }

  tri(a: number, b: number, c: number) {
    this.idx.push(a, b, c);
  }

  quadIdx(a: number, b: number, c: number, d: number) {
    this.idx.push(a, b, c, a, c, d);
  }

  /** A flat quad, corners counter-clockwise seen from the front. Unit uv across it (mapped through the paint). */
  quad(paint: Paint, p0: V3, p1: V3, p2: V3, p3: V3, uvs?: [V2, V2, V2, V2], sway?: [number, number, number, number], phase = 0) {
    const nrm = norm(cross(sub(p1, p0), sub(p3, p0)));
    const u = uvs ?? [
      [0, 0],
      [len(sub(p1, p0)), 0],
      [len(sub(p2, p0)), len(sub(p3, p0))],
      [0, len(sub(p3, p0))],
    ];
    const pts = [p0, p1, p2, p3];
    const ids = pts.map((p, i) => this.vert(p, nrm, paint.map(u[i]![0], u[i]![1]), paint, sway ? [sway[i]!, phase] : undefined));
    this.quadIdx(ids[0]!, ids[1]!, ids[2]!, ids[3]!);
  }

  /** Flat quad wound so its normal faces the side `facing` points to, whatever order the corners come in. */
  quadF(paint: Paint, pts: [V3, V3, V3, V3], facing: V3, uvs?: [V2, V2, V2, V2]) {
    const n = cross(sub(pts[1], pts[0]), sub(pts[3], pts[0]));
    if (dot(n, facing) >= 0) this.quad(paint, pts[0], pts[1], pts[2], pts[3], uvs);
    else this.quad(paint, pts[0], pts[3], pts[2], pts[1], uvs ? [uvs[0], uvs[3], uvs[2], uvs[1]] : undefined);
  }

  data(): MeshData {
    return {
      position: new Float32Array(this.p),
      normal: new Float32Array(this.n),
      uv: new Float32Array(this.uv),
      color: new Float32Array(this.c),
      mat: new Float32Array(this.m),
      sway: new Float32Array(this.s),
      index: new Uint32Array(this.idx),
    };
  }
}

// ---------- grids ----------

export type GridOpts = {
  /** Wrap the last column onto the first for normals (tubes). Callers repeat the first column at the end for uv. */
  closedJ?: boolean;
  flip?: boolean;
  /** [rows] x [cols] weights, or a function of (i, j): flutter strength per vertex. */
  sway?: (i: number, j: number) => number;
  phase?: number;
  /** Override uv (metres or 0..1 for rect paints). Default: arc length along rows (u) and columns (v). */
  uvFn?: (i: number, j: number, u: number, v: number) => V2;
  /** Per-vertex tint multiplier (AO). */
  shade?: (i: number, j: number) => number;
};

/**
 * Surface from a lattice of points P[i][j]. Normal = dP/di x dP/dj, smoothed across the lattice. Quads wind
 * (i,j) (i+1,j) (i+1,j+1) (i,j+1), counter-clockwise seen from the normal side. Returns the first vertex index.
 */
export function grid(b: MeshBuilder, paint: Paint, P: V3[][], o: GridOpts = {}) {
  const rows = P.length;
  const cols = P[0]!.length;
  const sgn = o.flip ? -1 : 1;
  const fn: V3[][] = [];
  for (let i = 0; i < rows; i += 1) {
    fn.push([]);
    for (let j = 0; j < cols; j += 1) fn[i]!.push([0, 0, 0]);
  }
  const jn = (j: number) => (o.closedJ ? ((j % (cols - 1)) + (cols - 1)) % (cols - 1) : clamp(j, 0, cols - 1));
  for (let i = 0; i < rows; i += 1) {
    for (let j = 0; j < cols; j += 1) {
      const i0 = Math.max(0, i - 1);
      const i1 = Math.min(rows - 1, i + 1);
      const j0 = jn(j - 1);
      const j1 = jn(j + 1);
      const di = sub(P[i1]![j]!, P[i0]![j]!);
      const dj = sub(P[i]![j1]!, P[i]![j0]!);
      let nrm = cross(di, dj);
      if (len(nrm) < 1e-9) {
        // Degenerate pole: fall back to the neighbouring row.
        const ii = i === 0 ? Math.min(rows - 1, 1) : Math.max(0, rows - 2);
        nrm = cross(sub(P[Math.min(rows - 1, ii + 1)]![j]!, P[Math.max(0, ii - 1)]![j]!), sub(P[ii]![j1]!, P[ii]![j0]!));
      }
      fn[i]![j] = mul(norm(nrm), sgn);
    }
  }
  const uAcc: number[] = new Array(rows).fill(0);
  for (let i = 1; i < rows; i += 1) uAcc[i] = uAcc[i - 1]! + len(sub(P[i]![Math.floor(cols / 2)]!, P[i - 1]![Math.floor(cols / 2)]!));
  const first = b.vertCount;
  for (let i = 0; i < rows; i += 1) {
    let vAcc = 0;
    for (let j = 0; j < cols; j += 1) {
      if (j > 0) vAcc += len(sub(P[i]![j]!, P[i]![j - 1]!));
      const uvm = o.uvFn ? o.uvFn(i, j, uAcc[i]!, vAcc) : paint.map(uAcc[i]!, vAcc);
      const sw = o.sway ? o.sway(i, j) : 0;
      const sh = o.shade ? o.shade(i, j) : 1;
      const pt = sh === 1 ? paint : paint.tinted([paint.tint[0] * sh, paint.tint[1] * sh, paint.tint[2] * sh]);
      b.vert(P[i]![j]!, fn[i]![j]!, uvm, pt, sw ? [sw, o.phase ?? 0] : undefined);
    }
  }
  for (let i = 0; i < rows - 1; i += 1) {
    for (let j = 0; j < cols - 1; j += 1) {
      const a = first + i * cols + j;
      const bb = first + (i + 1) * cols + j;
      const c = first + (i + 1) * cols + j + 1;
      const d = first + i * cols + j + 1;
      if (o.flip) b.quadIdx(a, d, c, bb);
      else b.quadIdx(a, bb, c, d);
    }
  }
  return first;
}

/** Fan-fill a planar polygon (counter-clockwise seen from `facing`) from its centroid. */
export function polygon(b: MeshBuilder, paint: Paint, pts: V3[], facing: V3, uvFn?: (p: V3) => V2) {
  const centroid = pts.reduce((a, p) => add(a, p), [0, 0, 0] as V3).map((x) => x / pts.length) as V3;
  const nrm = norm(facing);
  const mk = (p: V3) => {
    const uv = uvFn ? uvFn(p) : paint.map(p[0], p[2]);
    return b.vert(p, nrm, uv, paint);
  };
  const c = mk(centroid);
  const ids = pts.map(mk);
  for (let i = 0; i < pts.length; i += 1) {
    const a = ids[i]!;
    const d = ids[(i + 1) % pts.length]!;
    const wind = dot(cross(sub(pts[i]!, centroid), sub(pts[(i + 1) % pts.length]!, centroid)), nrm);
    if (wind >= 0) b.tri(c, a, d);
    else b.tri(c, d, a);
  }
}

// ---------- solids ----------

export type BoxOpts = {
  /** Axis (0 x, 1 y, 2 z) the texture's u (grain) axis follows on faces that contain it. Default: the longest axis. */
  grain?: 0 | 1 | 2;
  /** Leave out faces: bit mask -x +x -y +y -z +z. */
  skip?: number;
};

/** Axis-aligned box with flat faces. */
export function box(b: MeshBuilder, paint: Paint, min: V3, max: V3, o: BoxOpts = {}) {
  const size = sub(max, min);
  const grain = o.grain ?? ((size[0] >= size[1] && size[0] >= size[2] ? 0 : size[1] >= size[2] ? 1 : 2) as 0 | 1 | 2);
  const faces: { axis: number; sign: number }[] = [
    { axis: 0, sign: -1 },
    { axis: 0, sign: 1 },
    { axis: 1, sign: -1 },
    { axis: 1, sign: 1 },
    { axis: 2, sign: -1 },
    { axis: 2, sign: 1 },
  ];
  faces.forEach((f, fi) => {
    if (o.skip && o.skip & (1 << fi)) return;
    const a1 = (f.axis + 1) % 3;
    const a2 = (f.axis + 2) % 3;
    // (a1, a2) is a right-handed pair around +axis, so counter-clockwise seen from +axis.
    const at = f.sign > 0 ? max[f.axis]! : min[f.axis]!;
    const pt = (s1: number, s2: number): V3 => {
      const p: V3 = [0, 0, 0];
      p[f.axis] = at;
      p[a1] = s1 ? max[a1]! : min[a1]!;
      p[a2] = s2 ? max[a2]! : min[a2]!;
      return p;
    };
    const nrm: V3 = [0, 0, 0];
    nrm[f.axis] = f.sign;
    // grain axis along u when the face contains it, else the longer side.
    const uAxis = a1 === grain ? a1 : a2 === grain ? a2 : size[a1]! >= size[a2]! ? a1 : a2;
    const corners = f.sign > 0 ? [pt(0, 0), pt(1, 0), pt(1, 1), pt(0, 1)] : [pt(0, 0), pt(0, 1), pt(1, 1), pt(1, 0)];
    const ids = corners.map((p) => {
      const u = uAxis === a1 ? p[a1]! : p[a2]!;
      const v = uAxis === a1 ? p[a2]! : p[a1]!;
      return b.vert(p, nrm, paint.map(u, v), paint);
    });
    b.quadIdx(ids[0]!, ids[1]!, ids[2]!, ids[3]!);
  });
}

/** Tapered tube around the segment p0 -> p1 (ends optionally capped), texture u along its length. */
export function cylinder(b: MeshBuilder, paint: Paint, p0: V3, p1: V3, r0: number, r1: number, seg = 8, caps = true, rings = 1) {
  const dir = sub(p1, p0);
  const f = frameAlong(p0, dir);
  const L = len(dir);
  b.with(f, () => {
    const P: V3[][] = [];
    for (let i = 0; i <= rings; i += 1) {
      const t = i / rings;
      const r = lerp(r0, r1, t);
      const row: V3[] = [];
      for (let j = 0; j <= seg; j += 1) {
        const a = (j / seg) * Math.PI * 2;
        row.push([L * t, Math.sin(a) * r, Math.cos(a) * r]);
      }
      P.push(row);
    }
    // Local axes: x along the tube, a goes y -> z... winding checked so the normal points outward.
    grid(b, paint, P, { closedJ: true });
    if (caps && r0 > 0.001) cap(b, paint, 0, r0, seg, -1);
    if (caps && r1 > 0.001) cap(b, paint, L, r1, seg, 1);
  });
}

function cap(b: MeshBuilder, paint: Paint, x: number, r: number, seg: number, sign: number) {
  const nrm: V3 = [sign, 0, 0];
  const c = b.vert([x, 0, 0], nrm, paint.map(0, 0), paint);
  const ids: number[] = [];
  for (let j = 0; j <= seg; j += 1) {
    const a = (j / seg) * Math.PI * 2;
    ids.push(b.vert([x, Math.sin(a) * r, Math.cos(a) * r], nrm, paint.map(Math.cos(a) * r, Math.sin(a) * r), paint));
  }
  for (let j = 0; j < seg; j += 1) {
    if (sign > 0) b.tri(c, ids[j + 1]!, ids[j]!);
    else b.tri(c, ids[j]!, ids[j + 1]!);
  }
}

/** Surface of revolution around local +Y: profile points (radius, y). Smooth shaded. */
export function lathe(b: MeshBuilder, paint: Paint, profile: V2[], seg = 10) {
  const P: V3[][] = profile.map(([r, y]) => {
    const row: V3[] = [];
    for (let j = 0; j <= seg; j += 1) {
      const a = (j / seg) * Math.PI * 2;
      row.push([Math.cos(a) * r, y, Math.sin(a) * r]);
    }
    return row;
  });
  grid(b, paint, P, { closedJ: true });
}

/** Ellipse cross-sections along a path: neck, jaws, horns, barrels. */
export type TubeStation = { p: V3; a: number; b: number };
export function tube(b: MeshBuilder, paint: Paint, stations: TubeStation[], seg = 8, o: { up?: V3; capStart?: boolean; capEnd?: boolean; shade?: (i: number, j: number) => number } = {}) {
  const up = o.up ?? [0, 1, 0];
  const P: V3[][] = [];
  stations.forEach((s, i) => {
    const prev = stations[Math.max(0, i - 1)]!;
    const next = stations[Math.min(stations.length - 1, i + 1)]!;
    const d = norm(sub(next.p, prev.p));
    let right = cross(d, up);
    if (len(right) < 1e-4) right = cross(d, [0, 0, 1]);
    right = norm(right);
    const upv = norm(cross(right, d));
    const row: V3[] = [];
    for (let j = 0; j <= seg; j += 1) {
      const a = (j / seg) * Math.PI * 2;
      row.push(add(s.p, add(mul(right, Math.cos(a) * s.a), mul(upv, Math.sin(a) * s.b))));
    }
    P.push(row);
  });
  grid(b, paint, P, { closedJ: true, shade: o.shade });
  const capAt = (i: number, flip: boolean) => {
    const ring = P[i]!.slice(0, seg);
    const d = norm(sub(stations[Math.min(stations.length - 1, i + 1)]!.p, stations[Math.max(0, i - 1)]!.p));
    polygon(b, paint, flip ? [...ring].reverse() : ring, mul(d, flip ? -1 : 1), (p) => paint.map(p[2] + p[0], p[1]));
  };
  if (o.capStart) capAt(0, true);
  if (o.capEnd) capAt(stations.length - 1, false);
}

/**
 * Prism swept along a polyline. section is a polygon in (right, up) of the path frame, counter-clockwise seen
 * from the path's start looking along it. Flat shaded sides (rails, battens, ropes, beams along curves).
 */
export function sweep(b: MeshBuilder, paint: Paint, path: V3[], section: V2[], o: { up?: V3; caps?: boolean; uScale?: number } = {}) {
  const up = o.up ?? [0, 1, 0];
  const frames = path.map((p, i) => {
    const d = norm(sub(path[Math.min(path.length - 1, i + 1)]!, path[Math.max(0, i - 1)]!));
    let right = cross(d, up);
    if (len(right) < 1e-4) right = cross(d, [0, 0, 1]);
    right = norm(right);
    return { p, right, upv: norm(cross(right, d)), d };
  });
  const at = (i: number, s: V2): V3 => add(frames[i]!.p, add(mul(frames[i]!.right, s[0]), mul(frames[i]!.upv, s[1])));
  for (let k = 0; k < section.length; k += 1) {
    const s0 = section[k]!;
    const s1 = section[(k + 1) % section.length]!;
    const P: V3[][] = path.map((_, i) => [at(i, s0), at(i, s1)]);
    grid(b, paint, P);
  }
  if (o.caps !== false && path.length > 1) {
    const ring = (i: number) => section.map((s) => at(i, s));
    polygon(b, paint, ring(0).reverse(), mul(frames[0]!.d, -1), (p) => paint.map(p[0], p[2]));
    polygon(b, paint, ring(path.length - 1), frames[path.length - 1]!.d, (p) => paint.map(p[0], p[2]));
  }
}

export const rectSection = (w: number, h: number): V2[] => [
  [-w / 2, -h / 2],
  [w / 2, -h / 2],
  [w / 2, h / 2],
  [-w / 2, h / 2],
];

/** Pyramid (4 sides) or cone spike standing on the point base, pointing along dir. */
export function spike(b: MeshBuilder, paint: Paint, base: V3, dir: V3, radius: number, height: number, seg = 4) {
  const f = frameAlong(base, dir);
  b.with(f, () => {
    const tip = b.vert([height, 0, 0], [1, 0, 0], paint.map(0.5, 1), paint);
    const ring: number[] = [];
    for (let j = 0; j <= seg; j += 1) {
      const a = (j / seg) * Math.PI * 2;
      const y = Math.sin(a) * radius;
      const z = Math.cos(a) * radius;
      const nrm = norm([radius / height, y / radius, z / radius]);
      ring.push(b.vert([0, y, z], nrm, paint.map(j / seg, 0), paint));
    }
    for (let j = 0; j < seg; j += 1) b.tri(tip, ring[j + 1]!, ring[j]!);
  });
}

// ---------- cloth ----------

export type ClothOpts = {
  nu: number;
  nv: number;
  /** Flutter strength across the width: 0 at the pole (u = 0) rising to this at the free edge. */
  flutter?: number;
  /** Bulge along the cloth normal, 0 at the edges to this at the middle (sails). */
  billow?: number;
  /** Static wave baked into the cloth along u. */
  wave?: number;
  phase?: number;
  /** Extra weight at the bottom of the cloth so hanging banners swing from the top. */
  hang?: boolean;
};

/**
 * Cloth hung on the edge o -> o+uAxis... origin at the pole/top-left corner, uAxis across the width (away from the
 * pole), vAxis down the height. Drawn on both faces (two layers of triangles with opposite normals) so the
 * material can stay single-sided.
 */
export function cloth(b: MeshBuilder, paint: Paint, origin: V3, uAxis: V3, vAxis: V3, o: ClothOpts) {
  const front = norm(cross(uAxis, vAxis));
  const mkGrid = (side: number) => {
    const P: V3[][] = [];
    for (let i = 0; i <= o.nu; i += 1) {
      const row: V3[] = [];
      for (let j = 0; j <= o.nv; j += 1) {
        const tu = i / o.nu;
        const tv = j / o.nv;
        const bulge = (o.billow ?? 0) * Math.sin(Math.PI * tu) * Math.sin(Math.PI * tv) + (o.wave ?? 0) * Math.sin(tu * Math.PI * 2.2 + (o.phase ?? 0)) * tu;
        row.push(add(add(origin, add(mul(uAxis, tu), mul(vAxis, tv))), mul(front, bulge + side * 0.012)));
      }
      P.push(row);
    }
    // i runs along u, j along v: normal = dP/di x dP/dj = uAxis x vAxis = front.
    const sway = (i: number, j: number) => {
      const w = (o.flutter ?? 0) * (i / o.nu);
      return o.hang ? w * (0.4 + 0.6 * (j / o.nv)) : w;
    };
    grid(b, paint, P, {
      flip: side < 0,
      sway,
      phase: o.phase,
      // Seen from the normal side u runs right-to-left, so the front layer mirrors u: print reads properly from both sides.
      uvFn: (i, j) => (paint.rect ? paint.map(side > 0 ? 1 - i / o.nu : i / o.nu, 1 - j / o.nv) : paint.map((i / o.nu) * len(uAxis), (j / o.nv) * len(vAxis))),
    });
  };
  mkGrid(1);
  mkGrid(-1);
}

/** Cloth strip that trails behind a point (pennants, whiskers): triangle or rectangle tapering to `tip` width. */
export function pennant(b: MeshBuilder, paint: Paint, origin: V3, along: V3, down: V3, length: number, width: number, tip: number, segs: number, o: { flutter?: number; phase?: number } = {}) {
  const P: V3[][] = [];
  const dir = norm(along);
  const dn = norm(down);
  for (let i = 0; i <= segs; i += 1) {
    const t = i / segs;
    const w = lerp(width, tip, t);
    const wave = 0.05 * length * Math.sin(t * 5 + (o.phase ?? 0)) * t;
    const base = add(origin, mul(dir, length * t));
    P.push([add(base, mul(cross(dir, dn), wave)), add(add(base, mul(dn, w)), mul(cross(dir, dn), wave))]);
  }
  // i along the length, j downward
  const sway = (i: number) => (o.flutter ?? 1) * (i / segs);
  const nrm = cross(dir, dn);
  grid(b, paint, P, { sway, phase: o.phase, flip: dot(cross(sub(P[1]![0]!, P[0]![0]!), sub(P[0]![1]!, P[0]![0]!)), nrm) < 0, uvFn: (i, j) => paint.map(i / segs, 1 - j) });
  grid(b, paint, P, { sway, phase: o.phase, flip: dot(cross(sub(P[1]![0]!, P[0]![0]!), sub(P[0]![1]!, P[0]![0]!)), nrm) >= 0, uvFn: (i, j) => paint.map(i / segs, 1 - j) });
}


// ---------- roofs ----------

export type RoofOpts = {
  /** Plan half sizes at the eave (overhang included): along ship x, across z. */
  hx: number;
  hz: number;
  /** Ridge half length along x. hx > ridge gives a hip roof (u-jin-gak); ridge = 0 a pyramid. */
  ridge: number;
  /** Eave height and ridge height above the eave. */
  y: number;
  rise: number;
  /** Upward flick of the eave corners and slope concavity exponent (1 straight, 2 strongly curved). */
  lift: number;
  concave: number;
  fascia?: number;
  /** Subdivisions up the slope and along the eave. */
  nSlope?: number;
  nEave?: number;
};

/**
 * Hip roof with upturned eave corners and a concave slope: tile paint on the slopes, trim paint on the fascia,
 * cap paint on the ridge and hip ridges. Centred on the origin in plan.
 */
export function hipRoof(b: MeshBuilder, tile: Paint, trim: Paint, capPaint: Paint, o: RoofOpts) {
  const nS = o.nSlope ?? 5;
  const nE = o.nEave ?? 10;
  const fascia = o.fascia ?? 0.3;
  const R = o.ridge;
  // Eave height at a point on the eave line: corners rise by `lift`, the middle stays put.
  const eaveY = (cornerness: number) => o.y + o.lift * Math.pow(cornerness, 3);
  type Side = { e0: V3; e1: V3; r0: V3; r1: V3; out: V3 };
  const sides: Side[] = [
    { e0: [-o.hx, 0, o.hz], e1: [o.hx, 0, o.hz], r0: [-R, 0, 0], r1: [R, 0, 0], out: [0, 0, 1] },
    { e0: [o.hx, 0, -o.hz], e1: [-o.hx, 0, -o.hz], r0: [R, 0, 0], r1: [-R, 0, 0], out: [0, 0, -1] },
    { e0: [o.hx, 0, o.hz], e1: [o.hx, 0, -o.hz], r0: [R, 0, 0], r1: [R, 0, 0], out: [1, 0, 0] },
    { e0: [-o.hx, 0, -o.hz], e1: [-o.hx, 0, o.hz], r0: [-R, 0, 0], r1: [-R, 0, 0], out: [-1, 0, 0] },
  ];
  sides.forEach((sd) => {
    const P: V3[][] = [];
    const eave: V3[] = [];
    for (let i = 0; i <= nS; i += 1) {
      const t = i / nS;
      const row: V3[] = [];
      for (let j = 0; j <= nE; j += 1) {
        const u = j / nE;
        const e = lerp3(sd.e0, sd.e1, u);
        const r = lerp3(sd.r0, sd.r1, u);
        const corner = Math.abs(2 * u - 1);
        const ey = eaveY(corner);
        const p = lerp3(e, r, t);
        // Curve the plan edge slightly too, so the eave line sags between the lifted corners.
        row.push([p[0], ey * (1 - t) + (o.y + o.rise) * t + (Math.pow(t, o.concave) - t) * o.rise, p[2]]);
      }
      P.push(row);
    }
    for (const p of P[0]!) eave.push(p);
    const half = Math.floor(nE / 2);
    const nrm = cross(sub(P[1]![half]!, P[0]![half]!), sub(P[0]![half + 1]!, P[0]![half]!));
    const eaveLen = len(sub(sd.e1, sd.e0));
    grid(b, tile, P, { flip: nrm[1] < 0, uvFn: (i, j) => tile.map((j / nE) * eaveLen, i * (o.rise + 1) * 0.55) });
    const F: V3[][] = eave.map((p) => [p, [p[0], p[1] - fascia, p[2]]]);
    const fn = cross(sub(F[1]![0]!, F[0]![0]!), sub(F[0]![1]!, F[0]![0]!));
    grid(b, trim, F, { flip: dot(fn, sd.out) < 0, uvFn: (i, j) => trim.map((i / nE) * eaveLen, j * fascia) });
    const dark = trim.tinted([trim.tint[0] * 0.5, trim.tint[1] * 0.5, trim.tint[2] * 0.5]);
    const S: V3[][] = eave.map((p) => [[p[0] * 0.8, p[1] - fascia * 0.8, p[2] * 0.8], [p[0], p[1] - fascia, p[2]]]);
    const sn = cross(sub(S[1]![0]!, S[0]![0]!), sub(S[0]![1]!, S[0]![0]!));
    grid(b, dark, S, { flip: sn[1] > 0 });
  });
  const top = o.y + o.rise;
  if (R > 0) sweep(b, capPaint, [[-R - 0.25, top + 0.05, 0], [R + 0.25, top + 0.05, 0]], [[-0.22, -0.1], [0.22, -0.1], [0.16, 0.3], [-0.16, 0.3]]);
  const hips: [V3, V3][] = [
    [[-R, top, 0], [-o.hx, eaveY(1), o.hz]],
    [[-R, top, 0], [-o.hx, eaveY(1), -o.hz]],
    [[R, top, 0], [o.hx, eaveY(1), o.hz]],
    [[R, top, 0], [o.hx, eaveY(1), -o.hz]],
  ];
  for (const [a, c] of hips) {
    const path: V3[] = [];
    for (let i = 0; i <= nS; i += 1) {
      const t = i / nS;
      const p = lerp3(a, c, t);
      // follow the slope curve: above the straight line by the concavity term, plus the corner lift
      const y = lerp(top, eaveY(1), t) + (Math.pow(1 - t, o.concave) - (1 - t)) * o.rise;
      path.push([p[0], y + 0.06, p[2]]);
    }
    sweep(b, capPaint, path, rectSection(0.26, 0.2));
  }
}
