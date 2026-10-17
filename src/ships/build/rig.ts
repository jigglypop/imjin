/**
 * European rig of 1588: square sails on yards, lateen sails on long slanted yards, fighting tops, the bowsprit and
 * spritsail, and the standing rigging (shrouds with ratlines, stays). Shared by the galleons, the urca, the pinnace and
 * the galleass. Sails are cloth (sway and tear in ShipRenderer like every sail); yards and spars are wood.
 */
import { byLod, type Ctx } from './common';
import { compose, cylinder, grid, lerp, rectSection, rotY, sweep, xlate, type Paint, type V3 } from './parts';

/** Turn local (x, z) about the mast at mx by yaw: the same rotation as rotY. */
const yawPt = (mx: number, yaw: number, p: V3): V3 => {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return [mx + c * p[0] + s * p[2], p[1], -s * p[0] + c * p[2]];
};

export type SquareSailOpts = { x: number; y: number; w: number; foot: number; h: number; billow: number; yaw: number; phase: number; furled?: boolean };

/**
 * A square sail bent to its yard at height y on the mast at x, hanging forward of the mast and bellied forward by the
 * wind. Returns the clews (lower corners) in ship space for the sheets.
 */
export function squareSail(ctx: Ctx, cloth: Paint, wood: Paint, o: SquareSailOpts): [V3, V3] {
  const { b } = ctx;
  const yardR = 0.05 + o.w * 0.009;
  const xs = 0.5 + yardR;
  b.with(compose(xlate(o.x, 0, 0), rotY(o.yaw)), () => {
    cylinder(b, wood, [xs - 0.1, o.y + 0.05, -o.w / 2 - 0.8], [xs - 0.1, o.y + 0.05, 0], yardR * 0.55, yardR, byLod(ctx, 7, 5, 3), true);
    cylinder(b, wood, [xs - 0.1, o.y + 0.05, 0], [xs - 0.1, o.y + 0.05, o.w / 2 + 0.8], yardR, yardR * 0.55, byLod(ctx, 7, 5, 3), true);
    if (o.furled) {
      cylinder(b, cloth, [xs, o.y - 0.3, -o.w / 2], [xs, o.y - 0.3, o.w / 2], 0.36, 0.36, byLod(ctx, 8, 5, 3), true, 3);
      return;
    }
    const nu = byLod(ctx, 12, 5, 1);
    const nv = byLod(ctx, 10, 5, 1);
    for (const layer of [1, -1]) {
      const P: V3[][] = [];
      for (let i = 0; i <= nu; i += 1) {
        const row: V3[] = [];
        for (let j = 0; j <= nv; j += 1) {
          const tu = i / nu;
          const tv = j / nv;
          const w = lerp(o.w, o.foot, tv);
          // The foot is cut with a shallow upward curve (the roach) and the cloth bellies most just below the middle.
          const roach = 0.06 * o.h * Math.sin(Math.PI * tu) * Math.pow(tv, 4);
          const bulge = o.billow * Math.sin(Math.PI * tu) * Math.sin(Math.PI * Math.min(1, 0.15 + tv * 0.8));
          row.push([xs + bulge + layer * 0.012, o.y - o.h * tv + roach, lerp(-w / 2, w / 2, tu)]);
        }
        P.push(row);
      }
      grid(b, cloth, P, {
        flip: layer < 0,
        sway: (_i, j) => 0.45 * (j / nv),
        phase: o.phase,
        uvFn: (i, j) => (cloth.rect ? cloth.map(layer > 0 ? 1 - i / nu : i / nu, 1 - j / nv) : cloth.map(P[i]![j]![2], P[i]![j]![1])),
      });
    }
  });
  const clew = (sgn: number) => yawPt(o.x, o.yaw, [xs + o.billow * 0.3, o.y - o.h, (sgn * o.foot) / 2]);
  return [clew(-1), clew(1)];
}

export type LateenOpts = { x: number; y: number; len: number; fore: number; tilt: number; h: number; phase: number; billow: number };

/** A lateen sail: a long yard slung slantwise across the mast at height y and a triangular sail under it, set to port. */
export function lateenSail(ctx: Ctx, cloth: Paint, wood: Paint, o: LateenOpts) {
  const { b } = ctx;
  const z0 = -0.5;
  const c = Math.cos(o.tilt);
  const s = Math.sin(o.tilt);
  const A: V3 = [o.x + o.len * o.fore * c, o.y - o.len * o.fore * s, z0];
  const B: V3 = [o.x - o.len * (1 - o.fore) * c, o.y + o.len * (1 - o.fore) * s, z0];
  const C: V3 = [o.x - o.len * (1 - o.fore) * 0.78, o.y - o.h * 0.55, z0];
  const r = 0.05 + o.len * 0.007;
  const ext = (p: V3, q: V3, k: number): V3 => [p[0] + (p[0] - q[0]) * k, p[1] + (p[1] - q[1]) * k, p[2]];
  cylinder(b, wood, ext(A, B, 0.04), [o.x, o.y, z0 + 0.1], r * 0.6, r, byLod(ctx, 7, 5, 3), true);
  cylinder(b, wood, [o.x, o.y, z0 + 0.1], ext(B, A, 0.03), r, r * 0.45, byLod(ctx, 7, 5, 3), true);
  const nu = byLod(ctx, 12, 5, 1);
  const nv = byLod(ctx, 8, 4, 1);
  for (const layer of [1, -1]) {
    const P: V3[][] = [];
    for (let i = 0; i <= nu; i += 1) {
      const t = i / nu;
      const top: V3 = [lerp(A[0], B[0], t), lerp(A[1], B[1], t) - 0.12, z0];
      const foot: V3 = [lerp(A[0], C[0], t), lerp(A[1], C[1], t), z0];
      const row: V3[] = [];
      for (let j = 0; j <= nv; j += 1) {
        const v = j / nv;
        const bulge = -o.billow * Math.sin(Math.PI * t) * Math.sin(Math.PI * Math.min(1, 0.2 + v * 0.75)) * (0.3 + 0.7 * t);
        row.push([lerp(top[0], foot[0], v), lerp(top[1], foot[1], v), z0 + bulge + layer * 0.012]);
      }
      P.push(row);
    }
    grid(b, cloth, P, { flip: layer > 0, sway: (_i, j) => 0.4 * (j / nv), phase: o.phase, uvFn: (i, j) => cloth.map(P[i]![j]![0], P[i]![j]![1]) });
  }
  return { tack: A, peak: B, clew: C };
}

/** A fighting top: a round platform with a low rail on the mast at height y. */
export function fightingTop(ctx: Ctx, wood: Paint, rail: Paint, x: number, y: number, r: number) {
  if (ctx.lod > 1) return;
  const seg = byLod(ctx, 12, 8, 6);
  cylinder(ctx.b, wood, [x, y - 0.25, 0], [x, y, 0], r * 0.8, r, seg, true);
  if (ctx.lod < 2) cylinder(ctx.b, rail, [x, y, 0], [x, y + 0.75, 0], r, r * 1.04, seg, false);
  if (ctx.lod === 0) cylinder(ctx.b, rail, [x, y + 0.75, 0], [x, y + 0.75, 0], r * 1.04, r * 0.9, seg, true);
}

/** Shrouds from below a top down to the ship's side on both beams, with ratlines across them at the near LOD. */
export function shrouds(ctx: Ctx, rope: Paint, x: number, yTop: number, foot: (sgn: number, dx: number) => V3, dxs: number[], mastR: number, deadeye?: Paint) {
  if (ctx.lod > 1) return;
  const use = ctx.lod === 0 ? dxs : [dxs[0]!, dxs[dxs.length - 1]!];
  const th = ctx.lod === 0 ? 0.05 : 0.07;
  for (const sgn of [-1, 1]) {
    const lines = use.map((dx) => ({ head: [x + dx * 0.08, yTop, sgn * (mastR + 0.12)] as V3, foot: foot(sgn, dx) }));
    for (const l of lines) {
      sweep(ctx.b, rope, [l.head, l.foot], rectSection(th, th), { caps: false });
      // The deadeye the shroud is set up with, on the chain wale.
      if (ctx.lod === 0 && deadeye) cylinder(ctx.b, deadeye, [l.foot[0], l.foot[1] - 0.05, l.foot[2] - sgn * 0.06], [l.foot[0], l.foot[1] - 0.05, l.foot[2] + sgn * 0.06], 0.15, 0.15, 8, true);
    }
    if (ctx.lod === 0 && lines.length > 1) {
      const first = lines[0]!;
      const last = lines[lines.length - 1]!;
      const span = first.head[1] - Math.max(first.foot[1], last.foot[1]);
      const n = Math.floor(span / 0.8);
      for (let k = 1; k < n; k += 1) {
        const t = 1 - k / n;
        const path = lines.map((l): V3 => [lerp(l.foot[0], l.head[0], t), lerp(l.foot[1], l.head[1], t), lerp(l.foot[2], l.head[2], t)]);
        sweep(ctx.b, rope, path, rectSection(0.03, 0.03));
      }
    }
  }
}

/** One straight rope between two points (stays, braces, sheets). */
export function line(ctx: Ctx, rope: Paint, a: V3, c: V3, th = 0.05) {
  if (ctx.lod > 0) return;
  sweep(ctx.b, rope, [a, c], rectSection(th, th), { caps: false });
}
