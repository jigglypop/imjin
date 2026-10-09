/**
 * Roofs for the Japanese ships: the skirt roof (mokoshi) that steps between fortress tiers, the gabled upper roof
 * and the irimoya that stacks the two. Eave corners flick upward and every slope is concave, like the castle roofs
 * they imitate. All centred on x = cx in ship space; z = 0 is the centre line.
 */
import { byLod, type Ctx } from './common';
import { box, cross, grid, lerp, lerp3, polygon, rectSection, sub, sweep, type Paint, type V3 } from './parts';

export type SkirtOpts = {
  cx: number;
  /** Eave half sizes (overhang included) and the half sizes of the wall the roof leans against. */
  hx: number;
  hz: number;
  ihx: number;
  ihz: number;
  /** Eave height and rise to the wall. */
  y: number;
  rise: number;
  lift: number;
  concave: number;
  fascia: number;
};

export type RoofPaints = { tile: Paint; trim: Paint; cap: Paint };

const fascia = (ctx: Ctx, trim: Paint, eave: V3[], depth: number, out: V3, len: number) => {
  const F: V3[][] = eave.map((p) => [p, [p[0], p[1] - depth, p[2]]]);
  const mid = Math.floor(eave.length / 2);
  const fn = cross(sub(F[mid + 1]![0]!, F[mid]![0]!), sub(F[mid]![1]!, F[mid]![0]!));
  grid(ctx.b, trim, F, { flip: fn[0] * out[0] + fn[1] * out[1] + fn[2] * out[2] < 0, uvFn: (i, j) => trim.map((i / (eave.length - 1)) * len, j * depth) });
};

/** Roof between two rectangles: the lower eave and the wall of the tier above. */
export function skirtRoof(ctx: Ctx, p: RoofPaints, o: SkirtOpts) {
  const b = ctx.b;
  const nS = byLod(ctx, 5, 3, 1);
  const nE = byLod(ctx, 14, 8, 4);
  const { cx, hx, hz, ihx, ihz } = o;
  const eaveY = (c: number) => o.y + o.lift * Math.pow(c, 3);
  type Side = { e0: V3; e1: V3; i0: V3; i1: V3; out: V3 };
  const sides: Side[] = [
    { e0: [cx - hx, 0, hz], e1: [cx + hx, 0, hz], i0: [cx - ihx, 0, ihz], i1: [cx + ihx, 0, ihz], out: [0, 0, 1] },
    { e0: [cx + hx, 0, -hz], e1: [cx - hx, 0, -hz], i0: [cx + ihx, 0, -ihz], i1: [cx - ihx, 0, -ihz], out: [0, 0, -1] },
    { e0: [cx + hx, 0, hz], e1: [cx + hx, 0, -hz], i0: [cx + ihx, 0, ihz], i1: [cx + ihx, 0, -ihz], out: [1, 0, 0] },
    { e0: [cx - hx, 0, -hz], e1: [cx - hx, 0, hz], i0: [cx - ihx, 0, -ihz], i1: [cx - ihx, 0, ihz], out: [-1, 0, 0] },
  ];
  const yAt = (corner: number, t: number) => lerp(eaveY(corner), o.y + o.rise, t) + (Math.pow(t, o.concave) - t) * o.rise;
  for (const sd of sides) {
    const P: V3[][] = [];
    for (let i = 0; i <= nS; i += 1) {
      const t = i / nS;
      const row: V3[] = [];
      for (let j = 0; j <= nE; j += 1) {
        const u = j / nE;
        const q = lerp3(lerp3(sd.e0, sd.e1, u), lerp3(sd.i0, sd.i1, u), t);
        row.push([q[0], yAt(Math.abs(2 * u - 1), t), q[2]]);
      }
      P.push(row);
    }
    const half = Math.floor(nE / 2);
    const nrm = cross(sub(P[1]![half]!, P[0]![half]!), sub(P[0]![half + 1]!, P[0]![half]!));
    const edge = Math.hypot(sd.e1[0] - sd.e0[0], sd.e1[2] - sd.e0[2]);
    const run = Math.hypot(sd.i0[0] - sd.e0[0], sd.i0[2] - sd.e0[2]);
    const slope = Math.hypot(run, o.rise);
    grid(b, p.tile, P, { flip: nrm[1] < 0, uvFn: (i, j) => p.tile.map((j / nE) * edge, (i / nS) * slope) });
    if (ctx.lod < 2) {
      fascia(ctx, p.trim, P[0]!, o.fascia, sd.out, edge);
      // soffit: the dark underside seen from below
      const dark = p.trim.tinted([p.trim.tint[0] * 0.45, p.trim.tint[1] * 0.45, p.trim.tint[2] * 0.45]);
      const S: V3[][] = P[0]!.map((q, j) => {
        const u = j / nE;
        const w = lerp3(sd.i0, sd.i1, u);
        return [[lerp(q[0], w[0], 0.8), q[1] - o.fascia * 0.9, lerp(q[2], w[2], 0.8)], [q[0], q[1] - o.fascia, q[2]]];
      });
      const sn = cross(sub(S[1]![0]!, S[0]![0]!), sub(S[0]![1]!, S[0]![0]!));
      grid(b, dark, S, { flip: sn[1] > 0 });
    }
  }
  if (ctx.lod < 2) {
    // hip ridges with a cap tile each
    const corners: [V3, V3][] = [
      [[cx - ihx, 0, ihz], [cx - hx, 0, hz]],
      [[cx + ihx, 0, ihz], [cx + hx, 0, hz]],
      [[cx - ihx, 0, -ihz], [cx - hx, 0, -hz]],
      [[cx + ihx, 0, -ihz], [cx + hx, 0, -hz]],
    ];
    for (const [a, c] of corners) {
      const path: V3[] = [];
      for (let i = 0; i <= nS; i += 1) {
        const t = i / nS;
        const q = lerp3(c, a, t);
        path.push([q[0], yAt(1, t) + 0.07, q[2]]);
      }
      sweep(b, p.cap, path, rectSection(0.3, 0.18));
    }
  }
}

export type GableOpts = {
  cx: number;
  /** Half sizes of the wall the roof sits on. */
  wx: number;
  wz: number;
  over: number;
  /** Eave height and ridge height above it. */
  y: number;
  rise: number;
  lift: number;
  concave: number;
  fascia: number;
};

/** Gabled roof along x with plaster gable ends, barge boards and a ridge. Returns the ridge ends and height. */
export function gableRoof(ctx: Ctx, p: RoofPaints, plaster: Paint, o: GableOpts) {
  const b = ctx.b;
  const nS = byLod(ctx, 6, 3, 2);
  const nE = byLod(ctx, 14, 8, 3);
  const gx = o.wx + o.over;
  const gz = o.wz + o.over;
  const eaveY = (c: number) => o.y + o.lift * Math.pow(c, 3);
  const yAt = (corner: number, t: number) => lerp(eaveY(corner), o.y + o.rise, t) + (Math.pow(t, o.concave) - t) * o.rise;
  for (const s of [-1, 1] as const) {
    const P: V3[][] = [];
    for (let i = 0; i <= nS; i += 1) {
      const t = i / nS;
      const row: V3[] = [];
      for (let j = 0; j <= nE; j += 1) {
        const u = j / nE;
        row.push([o.cx + lerp(-gx, gx, u), yAt(Math.abs(2 * u - 1), t), s * gz * (1 - t)]);
      }
      P.push(row);
    }
    const half = Math.floor(nE / 2);
    const nrm = cross(sub(P[1]![half]!, P[0]![half]!), sub(P[0]![half + 1]!, P[0]![half]!));
    const slope = Math.hypot(gz, o.rise);
    grid(b, p.tile, P, { flip: nrm[1] < 0, uvFn: (i, j) => p.tile.map((j / nE) * 2 * gx, (i / nS) * slope) });
    if (ctx.lod < 2) fascia(ctx, p.trim, P[0]!, o.fascia, [0, 0, s], 2 * gx);
  }
  const ridgeY = o.y + o.rise;
  if (ctx.lod < 2) {
    sweep(b, p.cap, [[o.cx - gx - 0.2, ridgeY + 0.06, 0], [o.cx + gx + 0.2, ridgeY + 0.06, 0]], [[-0.25, -0.12], [0.25, -0.12], [0.18, 0.3], [-0.18, 0.3]]);
    // underside of the overhang
    const dark = p.trim.tinted([p.trim.tint[0] * 0.4, p.trim.tint[1] * 0.4, p.trim.tint[2] * 0.4]);
    box(b, dark, [o.cx - gx + 0.15, o.y - o.fascia - 0.04, -gz + 0.1], [o.cx + gx - 0.15, o.y - o.fascia + 0.02, gz - 0.1]);
  }
  // gable ends: plaster triangle under the barge boards
  for (const sx of [-1, 1] as const) {
    const xe = o.cx + sx * (gx - 0.08);
    const k = (gx - 0.08) / gx;
    const ring: V3[] = [];
    for (const s of [-1, 1] as const) {
      for (let i = 0; i <= nS; i += 1) {
        const t = s === -1 ? i / nS : 1 - i / nS;
        ring.push([xe, yAt(k, t) - 0.05, s * gz * (1 - t)]);
      }
    }
    polygon(b, plaster, ring, [sx, 0, 0], (q) => plaster.map(q[2], q[1]));
    if (ctx.lod < 2) {
      for (const s of [-1, 1] as const) {
        const path: V3[] = [];
        for (let i = 0; i <= nS; i += 1) {
          const t = i / nS;
          path.push([o.cx + sx * (gx + 0.02), yAt(1, t) + 0.02, s * gz * (1 - t)]);
        }
        sweep(b, p.trim, path, rectSection(0.16, 0.34), { caps: true });
      }
    }
  }
  return { ridgeY, ridgeX: gx - 0.15 };
}

export type IrimoyaOpts = {
  cx: number;
  /** Eave half sizes of the skirt, wall half sizes above it. */
  hx: number;
  hz: number;
  wx: number;
  wz: number;
  y: number;
  skirt: number;
  /** Height of the plaster wall between the skirt and the gable roof. */
  hafu: number;
  gable: number;
  lift: number;
};

/** Irimoya: a hip skirt carrying a plaster band and a gabled roof. */
export function irimoyaRoof(ctx: Ctx, p: RoofPaints, plaster: Paint, o: IrimoyaOpts) {
  skirtRoof(ctx, p, { cx: o.cx, hx: o.hx, hz: o.hz, ihx: o.wx, ihz: o.wz, y: o.y, rise: o.skirt, lift: o.lift, concave: 1.6, fascia: 0.34 });
  const y0 = o.y + o.skirt;
  box(ctx.b, plaster, [o.cx - o.wx, y0 - 0.06, -o.wz], [o.cx + o.wx, y0 + o.hafu, o.wz], { grain: 0 });
  return gableRoof(ctx, p, plaster, { cx: o.cx, wx: o.wx, wz: o.wz, over: 0.7, y: y0 + o.hafu, rise: o.gable, lift: o.lift * 0.8, concave: 1.5, fascia: 0.3 });
}
