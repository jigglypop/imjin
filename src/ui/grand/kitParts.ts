import { MeshBuilder, Paint, box, cross, cylinder, dot, grid, lerp, polygon, sub, sweep, type PaintOpts, type V2, type V3 } from '../../ships/build/parts';

// The parts the campaign map's buildings are made of, on the battle ships' builder (src/ships/build/parts.ts): every face
// names a cell of its navy's building atlas and repeats that cell's texture by the metre, so a wall is lime plaster, a
// roof is rows of tiles and a gate is studded planks, close up as in the battle. Adds what ships do not need: walls
// round a footprint, battered stone bases, pictures (doors, windows, gates) and the curved tiled roofs of Korea, Japan
// and Ming China, with ridges, upturned corners, a thick eave edge and a painted soffit. Pure TS, tested in node.
//
// Everything is in metres with y up, a building's front towards +z.

/** A building in progress: its mesh, whether it is the close level of detail, and its navy's paints by atlas cell. */
export interface Kit { b: MeshBuilder; near: boolean; P: (name: string, o?: PaintOpts) => Paint }

/** Faces `box` leaves out: -x, +x, -y (the bottom, on the ground or inside what it stands on), +y, -z, +z. */
export const NX = 1, PX = 2, NY = 4, PY = 8, NZ = 16, PZ = 32;

/** A block whose texture runs along its longest side, bottom left out. */
export function block(k: Kit, p: Paint, min: V3, max: V3, skip = NY) {
  box(k.b, p, min, max, { skip });
}

/** A surface through the lattice P[i][j] wound to face `out`, its uv (metres, or 0..1 on a picture) from `uv`. */
export function surface(k: Kit, p: Paint, P: V3[][], out: V3, uv: (i: number, j: number) => V2) {
  const mi = Math.max(0, Math.floor((P.length - 2) / 2)), mj = Math.max(0, Math.floor((P[0]!.length - 2) / 2));
  const n = cross(sub(P[mi + 1]![mj]!, P[mi]![mj]!), sub(P[mi]![mj + 1]!, P[mi]![mj]!));
  grid(k.b, p, P, { flip: dot(n, out) < 0, uvFn: (i, j) => { const [u, v] = uv(i, j); return p.map(u, v); } });
}

/** A flat quad facing `facing`, with uv in metres (or 0..1 on a picture); by default its own edge lengths. */
export function face(k: Kit, p: Paint, pts: [V3, V3, V3, V3], facing: V3, uv?: [V2, V2, V2, V2]) {
  k.b.quadF(p, pts, facing, uv);
}

/**
 * Upright walls round a footprint (corners counter-clockwise seen from above) from y0 to y1. The texture runs on round
 * the corners, so plaster and stone courses meet there.
 */
export function walls(k: Kit, p: Paint, outline: [number, number][], y0: number, y1: number) {
  let run = 0;
  for (let i = 0; i < outline.length; i += 1) {
    const [ax, az] = outline[i]!, [bx, bz] = outline[(i + 1) % outline.length]!;
    const l = Math.hypot(bx - ax, bz - az);
    const out: V3 = [bz - az, 0, -(bx - ax)];
    face(k, p, [[ax, y0, az], [bx, y0, bz], [bx, y1, bz], [ax, y1, az]], out, [[run, y0], [run + l, y0], [run + l, y1], [run, y1]]);
    run += l;
  }
}

/** A rectangle's corners counter-clockwise seen from above. */
export const rect = (x0: number, z0: number, x1: number, z1: number): [number, number][] => [[x0, z1], [x1, z1], [x1, z0], [x0, z0]];

/** A flat top over a convex footprint at height y. */
export function lid(k: Kit, p: Paint, outline: [number, number][], y: number, down = false) {
  polygon(k.b, p, outline.map(([x, z]): V3 => [x, y, z]), [0, down ? -1 : 1, 0], (q) => p.map(q[0], q[2]));
}

/** A picture (door, window, gate leaf) on the wall plane z = z, facing +z when out is 1, a few centimetres proud of it. */
export function picture(k: Kit, p: Paint, x0: number, x1: number, y0: number, y1: number, z: number, out: 1 | -1) {
  const zz = z + out * 0.03;
  const [a, b] = out > 0 ? [x0, x1] : [x1, x0];
  face(k, p, [[a, y0, zz], [b, y0, zz], [b, y1, zz], [a, y1, zz]], [0, 0, out], [[0, 0], [1, 0], [1, 1], [0, 1]]);
}

/** The same on the wall plane x = x, facing +x when out is 1. */
export function pictureX(k: Kit, p: Paint, z0: number, z1: number, y0: number, y1: number, x: number, out: 1 | -1) {
  const xx = x + out * 0.03;
  const [a, b] = out > 0 ? [z1, z0] : [z0, z1];
  face(k, p, [[xx, y0, a], [xx, y0, b], [xx, y1, b], [xx, y1, a]], [out, 0, 0], [[0, 0], [1, 0], [1, 1], [0, 1]]);
}

/**
 * A battered block: its foot `bx` by `bz` half sizes, its top `tx` by `tz`, sides sloping between (stone bases, castle
 * walls, tapering towers). The sides' texture runs level along the courses and up the slant.
 */
export function batter(k: Kit, side: Paint, top: Paint | null, cx: number, cz: number, bx: number, bz: number, tx: number, tz: number, y0: number, y1: number) {
  const B = (sx: number, sz: number): V3 => [cx + sx * bx, y0, cz + sz * bz];
  const T = (sx: number, sz: number): V3 => [cx + sx * tx, y1, cz + sz * tz];
  const sides: [number, number, number, number, V3][] = [[-1, 1, 1, 1, [0, 0, 1]], [1, 1, 1, -1, [1, 0, 0]], [1, -1, -1, -1, [0, 0, -1]], [-1, -1, -1, 1, [-1, 0, 0]]];
  let run = 0;
  for (const [ax, az, cx2, cz2, out] of sides) {
    const w = Math.hypot(B(cx2, cz2)[0] - B(ax, az)[0], B(cx2, cz2)[2] - B(ax, az)[2]);
    const tw = Math.hypot(T(cx2, cz2)[0] - T(ax, az)[0], T(cx2, cz2)[2] - T(ax, az)[2]);
    const slant = Math.hypot(y1 - y0, Math.abs(bx - tx) + Math.abs(bz - tz));
    face(k, side, [B(ax, az), B(cx2, cz2), T(cx2, cz2), T(ax, az)], [out[0], 0.3, out[2]], [[run, 0], [run + w, 0], [run + (w + tw) / 2, slant], [run + (w - tw) / 2, slant]]);
    run += w;
  }
  if (top) face(k, top, [T(-1, 1), T(1, 1), T(1, -1), T(-1, -1)], [0, 1, 0], [[cx - tx, cz + tz], [cx + tx, cz + tz], [cx + tx, cz - tz], [cx - tx, cz - tz]]);
}

/** A square post from y0 to y1, its texture along it, the ends left out (they sit in what it stands on and carries). */
export function post(k: Kit, p: Paint, x: number, z: number, w: number, y0: number, y1: number) {
  box(k.b, p, [x - w / 2, y0, z - w / 2], [x + w / 2, y1, z + w / 2], { skip: NY | PY, grain: 1 });
}

/** An upright round column (`seg` sided, faceted far away), capped on top when `capped`. */
export function column(k: Kit, p: Paint, x: number, z: number, r0: number, r1: number, y0: number, y1: number, seg: number, capped = false) {
  cylinder(k.b, p, [x, y0, z], [x, y1, z], r0, r1, seg, capped);
}

// ---------- roofs ----------

/** A roof's paints: tiles, the eave's edge, the soffit under it, the ridges, the gables and the ridge ends' ornaments. */
export interface RoofLook {
  tile: Paint;
  edge: Paint;
  under: Paint;
  ridge: Paint;
  gable: Paint;
  /** Korean curls, Japanese gilt fish, or Chinese hooks at the main ridge's ends. */
  ends?: 'curl' | 'fish' | 'hook';
  end?: Paint;
}

export interface RoofOpts {
  /** Eave half sizes, overhang included: x along the ridge (the longer side), z across. */
  ex: number;
  ez: number;
  /** Eave height at the middle of a long side, and the ridge's height. */
  y: number;
  top: number;
  /**
   * 'hip' four slopes up to a ridge, 'hipgable' gables standing on the hips (Korean paljak, Japanese irimoya, Chinese
   * xieshan), 'gable' two slopes with gable walls, 'pyramid' four slopes to a point.
   */
  form: 'hip' | 'hipgable' | 'gable' | 'pyramid';
  /** hipgable: the share of the slope, from the eave, where the gables stand. */
  gableAt?: number;
  /** How far the corners curl up (metres) and how the slopes sag (1 straight, 1.6 a strong Korean curve). */
  lift: number;
  sag: number;
  /** The eave's edge thickness and how far the soffit runs in under it (to the wall). */
  edge: number;
  overhang: number;
  /** gable: how far the roof runs on past the gable wall. */
  verge?: number;
  /** The main ridge's width and height; hips and rakes are a little slighter. */
  ridgeW: number;
  ridgeH: number;
  /** Rows up a slope and columns along a long eave close up; far away a fixed few. */
  rows?: number;
  cols?: number;
  /** Hips and rakes drawn as ridges too (close up only): a small house goes without to stay light. */
  trims?: boolean;
}

/** What a roof leaves for the kit to build on: where its main ridge ends and how high its top is. */
export interface RoofTop { ridgeX: number; ridgeY: number }

/**
 * A tiled roof centred on the origin with its ridge along x. Its slopes sag and their corners curl up, every slope ends
 * in a thick edge with the soffit under it, the ridges are capped, and a hip-and-gable roof stands its gables on the
 * hips. All four sides meet exactly, so no seam opens at a corner. The tiles' columns run down the slopes.
 */
export function roof(k: Kit, look: RoofLook, o: RoofOpts): RoofTop {
  const { ex, ez, near } = { ...o, near: k.near };
  const H = o.top - o.y;
  const form = o.form;
  // Where the hips end, as a share of the slope from the eave: at the ridge for a hip roof, at the gables' foot for a
  // hip-and-gable one, nowhere for a gabled one.
  const tg = form === 'gable' ? 0 : form === 'hipgable' ? (o.gableAt ?? 0.5) : 1;
  const gx = ex - ez * tg;
  const prof = (t: number) => Math.pow(t, o.sag);
  // The corner's curl fades up the hip (or up the slope at a gable's verge).
  const curl = (c: number, t: number) => o.lift * c * c * c * Math.pow(Math.max(0, 1 - t / (tg > 0 ? tg : 1)), 2);
  const yAt = (c: number, t: number) => o.y + H * prof(t) + curl(c, t);
  const hipRows = near ? (o.rows ?? 3) : 1, topRows = near ? Math.max(2, (o.rows ?? 3) - 1) : 1;
  const ts: number[] = [];
  if (tg > 0) for (let i = 0; i <= hipRows; i += 1) ts.push((tg * i) / hipRows);
  if (tg < 1) for (let i = tg > 0 ? 1 : 0; i <= topRows; i += 1) ts.push(tg + ((1 - tg) * i) / topRows);
  const cols = near ? (o.cols ?? 6) : 2;
  const X = (t: number) => (t <= tg ? ex - ez * t : gx);
  // Distance up a slope from its eave at each row, for the tiles' rows.
  const sv = ts.map((t, i) => (i === 0 ? 0 : Math.hypot(ez * (t - ts[i - 1]!), yAt(0, t) - yAt(0, ts[i - 1]!))));
  for (let i = 1; i < sv.length; i += 1) sv[i]! += sv[i - 1]!;
  // The long slopes (+z and -z).
  for (const sz of [1, -1]) {
    const P = ts.map((t) => Array.from({ length: cols + 1 }, (_, j): V3 => {
      const u = j / cols;
      return [lerp(-X(t), X(t), u), yAt(Math.abs(2 * u - 1), t), sz * ez * (1 - t)];
    }));
    surface(k, look.tile, P, [0, 1, sz], (i, j) => [P[i]![j]![0] * sz, sv[i]!]);
  }
  // The end slopes (+x and -x) up to the hips' end.
  const endTs = ts.filter((t) => t <= tg + 1e-9);
  const endCols = near ? Math.max(2, Math.round((cols * ez) / ex)) : 2;
  if (endTs.length > 1) for (const sx of [1, -1]) {
    const P = endTs.map((t) => Array.from({ length: endCols + 1 }, (_, j): V3 => {
      const u = j / endCols;
      return [sx * (ex - ez * t), yAt(Math.abs(2 * u - 1), t), lerp(ez, -ez, u) * (1 - t)];
    }));
    surface(k, look.tile, P, [sx, 1, 0], (i, j) => [-P[i]![j]![2] * sx, sv[i]!]);
  }
  // The eave's edge, all the way round (a gabled roof has none across its ends), and the soffit under it close up.
  const eaves: { pts: V3[]; out: V3 }[] = [];
  for (const sz of [1, -1]) eaves.push({ out: [0, 0, sz], pts: Array.from({ length: cols + 1 }, (_, j): V3 => [lerp(-ex, ex, j / cols), yAt(Math.abs((2 * j) / cols - 1), 0), sz * ez]) });
  if (tg > 0) for (const sx of [1, -1]) eaves.push({ out: [sx, 0, 0], pts: Array.from({ length: endCols + 1 }, (_, j): V3 => [sx * ex, yAt(Math.abs((2 * j) / endCols - 1), 0), lerp(ez, -ez, j / endCols)]) });
  const ox = form === 'gable' ? ex : ex - o.overhang, oz = ez - o.overhang;
  for (const { pts, out } of eaves) {
    const along = (q: V3) => (out[2] !== 0 ? q[0] : q[2]);
    const lowered = pts.map((q): V3 => [q[0], q[1] - o.edge, q[2]]);
    surface(k, look.edge, [lowered, pts], out, (i, j) => [along(pts[j]!), i * o.edge]);
    if (!near) continue;
    const inner = pts.map((q): V3 => [Math.max(-ox, Math.min(ox, q[0])), q[1] - o.edge * 0.4, Math.max(-oz, Math.min(oz, q[2]))]);
    surface(k, look.under, [lowered, inner], [0, -1, 0], (i, j) => [along(pts[j]!), i * o.overhang]);
  }
  const rw = o.ridgeW, rh = o.ridgeH;
  const trims = near && o.trims !== false;
  if (form === 'hipgable' || form === 'gable') {
    // Gable walls: a gabled roof's rises from the wall line under the verge, a hip-and-gable roof's stands on the hips,
    // flush with the slopes' ends so no gap opens between it and the hips.
    const verge = form === 'gable' ? (o.verge ?? 0.5) : 0.02;
    const tw = form === 'gable' ? Math.min(0.9, o.overhang / ez) : tg;
    const gT = ts.filter((t) => t >= tw - 1e-9);
    if (gT[0]! > tw + 1e-9) gT.unshift(tw);
    for (const sx of [1, -1]) {
      const xg = sx * (gx - verge);
      const under = (t: number) => yAt(Math.abs(xg) / X(t), t) - o.edge * 0.5;
      const ring: V3[] = [];
      if (form === 'gable') ring.push([xg, o.y - o.edge, ez * (1 - tw)]);
      for (const t of gT) ring.push([xg, under(t), ez * (1 - t)]);
      for (const t of [...gT].reverse().slice(1)) ring.push([xg, under(t), -ez * (1 - t)]);
      if (form === 'gable') ring.push([xg, o.y - o.edge, -ez * (1 - tw)]);
      polygon(k.b, look.gable, ring, [sx, 0, 0], (q) => look.gable.map(-q[2] * sx, q[1]));
    }
    // Rakes: the slighter ridges down the gables' edges (a gabled roof's from the eave's corner).
    if (trims) for (const sx of [1, -1]) for (const sz of [1, -1]) {
      const path = (form === 'gable' ? ts : gT).map((t): V3 => [sx * (X(t) + 0.02), yAt(1, t) + rh * 0.15, sz * ez * (1 - t)]);
      sweep(k.b, look.ridge, sz > 0 ? path : [...path].reverse(), ridgeSection(rw * 0.55, rh * 0.55), { caps: true });
    }
  }
  // Hips: from each curled corner up to the ridge or the gable's foot.
  const hipTs = ts.filter((t) => t <= tg + 1e-9);
  if (trims && hipTs.length > 1) for (const sx of [1, -1]) for (const sz of [1, -1]) {
    const path = hipTs.map((t): V3 => [sx * X(t), yAt(1, t) + rh * 0.12, sz * ez * (1 - t)]);
    sweep(k.b, look.ridge, path, ridgeSection(rw * 0.6, rh * 0.6), { caps: true });
  }
  // The main ridge and its ornaments, or a pyramid's finial.
  const ridgeX = form === 'pyramid' ? 0 : form === 'hip' ? ex - ez : gx + (form === 'gable' ? 0.15 : 0.2);
  if (ridgeX > 0.05) {
    sweep(k.b, look.ridge, [[-ridgeX, o.top - rh * 0.25, 0], [ridgeX, o.top - rh * 0.25, 0]], ridgeSection(rw, rh * 1.25), { caps: true });
    if (near && look.ends) for (const sx of [1, -1]) ridgeEnd(k, sx, ridgeX, o.top + rh * 0.6, rw, rh, look);
  } else column(k, look.end ?? look.ridge, 0, 0, rw * 0.5, rw * 0.32, o.top - 0.2, o.top + rh * 1.8, near ? 6 : 4, true);
  return { ridgeX, ridgeY: o.top + rh };
}

/** A ridge's cross-section: wider at the foot, sunk a little into the slopes it caps. */
const ridgeSection = (w: number, h: number): V2[] => [[-w / 2, -h * 0.3], [w / 2, -h * 0.3], [w * 0.36, h * 0.7], [-w * 0.36, h * 0.7]];

/** The ornament at one end (sx = +-1) of a main ridge `x` long whose top is at `y`. */
function ridgeEnd(k: Kit, sx: number, x: number, y: number, w: number, h: number, look: RoofLook) {
  const p = look.end ?? look.ridge;
  // In the ridge's frame, mirrored for the -x end: a Japanese gilt fish arches its tail up; a Korean ridge end turns up
  // in a short curl, a Chinese one hooks up higher and back in.
  // Sized with the ridge, so a small roof's ornament is small.
  const fish = look.ends === 'fish', s = w / 0.6;
  const rise = fish ? 1.3 * s : look.ends === 'hook' ? h * 2.4 : h * 1.4;
  const lean = (fish ? 0.35 : look.ends === 'hook' ? -0.25 : 0.3) * s;
  const base = (fish ? 0.6 : 0.55) * s, hw = fish ? 0.16 * s : w * 0.42;
  const P = (ax: number, ay: number, z: number): V3 => [sx * (x + ax), y - h + ay, z];
  const b0 = -base, b1 = 0.12;
  const side = (z: number): [V3, V3, V3, V3] => [P(b0, 0, z), P(b1, 0, z), P(b1 + lean, rise * 0.85, z), P(b0 * 0.6 + lean, rise, z)];
  const [a, b, c, d] = side(hw), [e, f, g, q] = side(-hw);
  face(k, p, [a, b, c, d], [0, 0, 1]);
  face(k, p, [f, e, q, g], [0, 0, -1]);
  face(k, p, [b, f, g, c], [sx, 0.2, 0]);
  face(k, p, [d, c, g, q], [0, 1, 0]);
  face(k, p, [e, a, d, q], [-sx, 0.2, 0]);
}

/**
 * A thatched roof: a rounded mound of straw over a rounded-rectangle plan, thick at the eave, closing in on a short
 * ridge. `hx` by `hz` at the eave, eave at y, crown at top.
 */
export function thatch(k: Kit, straw: Paint, under: Paint, hx: number, hz: number, y: number, top: number, o: { ridge?: number; eave?: number } = {}) {
  const ridge = o.ridge ?? Math.max(0.2, hx - hz);
  const seg = k.near ? 16 : 8;
  const ring = (s: number, yy: number, lip = 0): V3[] => Array.from({ length: seg + 1 }, (_, j) => {
    const a = (j / seg) * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a);
    const qx = Math.sign(c) * Math.pow(Math.abs(c), 2 / 3.2), qz = Math.sign(sn) * Math.pow(Math.abs(sn), 2 / 3.2);
    return [qx * (lerp(ridge, hx, s) + lip), yy, -qz * (hz * s + lip)];
  });
  const rows = k.near ? [0, 0.3, 0.55, 0.78, 1] : [0, 0.55, 1];
  const eave = o.eave ?? 0.3;
  // The mound closes in steadily while it rises fast at the eave and flattens to the crown.
  const mound = rows.map((r) => ring(1 - 0.97 * Math.pow(r, 1.1), y + (top - y) * (2 * r - r * r)));
  const lip = ring(1, y - eave, 0.08);
  const P = [lip, ...mound];
  // Round the plan for u, up the mound for v.
  const perimeter = P[1]!.reduce((n, q, j) => (j ? n + Math.hypot(q[0] - P[1]![j - 1]![0], q[2] - P[1]![j - 1]![2]) : 0), 0);
  const up = P.map((row, i) => (i ? Math.hypot(row[0]![0] - P[i - 1]![0]![0], row[0]![1] - P[i - 1]![0]![1]) : 0));
  for (let i = 1; i < up.length; i += 1) up[i]! += up[i - 1]!;
  surface(k, straw, P, [0, 1, 0], (i, j) => [(j / seg) * perimeter, up[i]!]);
  if (k.near) surface(k, under, [ring(0.86, y - eave + 0.12), lip], [0, -1, 0], (i, j) => [(j / seg) * perimeter, i * 0.6]);
  polygon(k.b, straw, mound[mound.length - 1]!.slice(0, seg), [0, 1, 0], (q) => straw.map(q[0], q[2]));
}
