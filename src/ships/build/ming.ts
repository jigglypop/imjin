/**
 * Parts shared by the Ming ships: battened junk sails set at an angle to the keel, painted bow eyes that follow the
 * hull side, and the railing that edges a raised deck.
 */
import { hullTop, sideZ, type HullPlan } from '../anchors';
import { byLod, type Ctx } from './common';
import { box, compose, cylinder, grid, lerp, rectSection, rotY, sweep, xlate, type Paint, type V3 } from './parts';

export type JunkSail = { x: number; yTop: number; w: number; h: number; billow: number; yaw: number; phase: number; battens: number };

/** Flat-bottomed junk sail on a mast: full-width bamboo battens, a heavy upper yard, turned by `yaw` about the mast. */
export function junkSail(ctx: Ctx, cloth: Paint, wood: Paint, rope: Paint, o: JunkSail) {
  const { b } = ctx;
  const nu = byLod(ctx, 8, 4, 1);
  const nv = byLod(ctx, 10, 5, 1);
  b.with(compose(xlate(o.x, 0, 0), rotY(o.yaw)), () => {
    const x = 0.5;
    // The outline swells a little in the middle (the roach) and the cloth bellies out toward the bow.
    const P: V3[][] = [];
    for (let i = 0; i <= nu; i += 1) {
      const row: V3[] = [];
      for (let j = 0; j <= nv; j += 1) {
        const tu = i / nu;
        const tv = j / nv;
        const w = o.w * (1 + 0.07 * Math.sin(Math.PI * tv));
        const bulge = o.billow * Math.sin(Math.PI * tu) * Math.sin(Math.PI * Math.min(1, tv * 1.15));
        row.push([x + bulge, o.yTop - o.h * tv, lerp(-w / 2, w / 2, tu)]);
      }
      P.push(row);
    }
    const sway = (i: number) => 0.55 * (i / nu);
    grid(b, cloth, P, { sway, phase: o.phase });
    grid(b, cloth, P, { flip: true, sway, phase: o.phase });
    cylinder(b, wood, [x - 0.06, o.yTop + 0.1, -o.w / 2 - 0.7], [x - 0.06, o.yTop + 0.1, o.w / 2 + 0.7], 0.13, 0.13, byLod(ctx, 7, 5, 3), true);
    if (ctx.lod > 1) return;
    const seg = byLod(ctx, 5, 4, 4);
    for (let k = 1; k <= o.battens; k += 1) {
      const tv = k / (o.battens + 1);
      const path: V3[] = [];
      const w = o.w * (1 + 0.07 * Math.sin(Math.PI * tv));
      for (let i = 0; i <= 6; i += 1) {
        const tu = i / 6;
        const bulge = o.billow * Math.sin(Math.PI * tu) * Math.sin(Math.PI * Math.min(1, tv * 1.15));
        path.push([x + bulge + 0.05, o.yTop - o.h * tv, lerp(-w / 2 - 0.3, w / 2 + 0.3, tu)]);
      }
      sweep(b, wood, path, rectSection(0.08, 0.1), { up: [1, 0, 0] });
    }
    cylinder(b, wood, [x + 0.04, o.yTop - o.h, -o.w / 2 - 0.2], [x + 0.04, o.yTop - o.h, o.w / 2 + 0.2], 0.1, 0.1, seg, true);
    if (ctx.lod === 0) {
      // the sheet: a bridle of lines from the batten ends to one block aft
      for (const sgn of [-1, 1]) {
        for (let k = 1; k <= o.battens; k += 2) {
          const tv = k / (o.battens + 1);
          sweep(b, rope, [[x + 0.1, o.yTop - o.h * tv, sgn * (o.w / 2 + 0.3)], [x - 1.2, o.yTop - o.h - 1.6, sgn * (o.w / 2 + 1.2)]], rectSection(0.035, 0.035));
        }
      }
    }
  });
}

/** Painted patch following the hull side between two stations and heights, on both sides (the eye pairs). */
export function hullPatch(ctx: Ctx, plan: HullPlan, paint: Paint, x0: number, x1: number, y0: number, y1: number, off = 0.04) {
  const nx = byLod(ctx, 5, 3, 2);
  const ny = byLod(ctx, 4, 2, 1);
  for (const sgn of [-1, 1]) {
    const P: V3[][] = [];
    for (let i = 0; i <= nx; i += 1) {
      const x = lerp(x0, x1, i / nx);
      const row: V3[] = [];
      for (let j = 0; j <= ny; j += 1) {
        const y = lerp(y0, y1, j / ny);
        row.push([x, y, sgn * (sideZ(plan, x, Math.min(y, hullTop(plan, x))) + off)]);
      }
      P.push(row);
    }
    grid(ctx.b, paint, P, { flip: sgn < 0, uvFn: (i, j) => paint.map(sgn > 0 ? i / nx : 1 - i / nx, j / ny) });
  }
}

/** Rail of posts and a top bar around a rectangle (raised decks); a gap can be left in the +x side for a stair. */
export function railRect(ctx: Ctx, red: Paint, post: Paint, cx: number, y: number, hx: number, hz: number, gap = 0) {
  if (ctx.lod > 1) return;
  const { b } = ctx;
  const bar = (path: V3[]) => sweep(b, red, path, rectSection(0.14, 0.14), { caps: true });
  const topY = y + 0.95;
  bar([[cx + hx, topY, -gap], [cx + hx, topY, -hz], [cx - hx, topY, -hz], [cx - hx, topY, hz], [cx + hx, topY, hz], [cx + hx, topY, gap]]);
  const posts: V3[] = [[cx + hx, 0, -hz], [cx - hx, 0, -hz], [cx - hx, 0, hz], [cx + hx, 0, hz]].map((p) => [p[0]!, y, p[2]!]);
  for (const p of posts) box(b, red, [p[0] - 0.1, y, p[2] - 0.1], [p[0] + 0.1, topY + 0.1, p[2] + 0.1], { grain: 1 });
  if (ctx.lod === 0) {
    const step = 0.7;
    const rail = (xa: number, za: number, xb: number, zb: number) => {
      const n = Math.max(1, Math.round(Math.hypot(xb - xa, zb - za) / step));
      for (let i = 1; i < n; i += 1) box(b, post, [lerp(xa, xb, i / n) - 0.035, y, lerp(za, zb, i / n) - 0.035], [lerp(xa, xb, i / n) + 0.035, topY - 0.1, lerp(za, zb, i / n) + 0.035], { grain: 1 });
    };
    rail(cx - hx, -hz, cx + hx, -hz);
    rail(cx - hx, hz, cx + hx, hz);
    rail(cx - hx, -hz, cx - hx, hz);
  }
}
