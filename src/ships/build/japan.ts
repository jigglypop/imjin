/**
 * Parts shared by the Japanese ships: nobori banners, shachihoko, maku curtains, tategaki shield boards and the
 * plaster-and-timber walls of the fortress tiers.
 */
import { flagRect } from './atlas';
import { byLod, type Ctx } from './common';
import { box, cloth, compose, cylinder, rotY, spike, sweep, rectSection, tube, xlate, type Paint, type TubeStation, type V3 } from './parts';

/** Tall narrow banner on a pole with a crossbar: the pole is at z, the banner hangs toward +z. */
export function nobori(ctx: Ctx, base: V3, poleH: number, w: number, h: number, key: string, phase: number, wood: Paint) {
  const [sheet, name] = key.split('/') as [string, string];
  const [x, y, z] = base;
  const seg = byLod(ctx, 6, 5, 4);
  cylinder(ctx.b, wood, [x, y, z], [x, y + poleH, z], 0.075, 0.055, seg, true);
  if (ctx.lod > 1) return;
  const top = y + poleH;
  const sgn = z >= 0 ? -1 : 1;
  const fr = flagRect(ctx.faction, sheet, name);
  const paint = ctx.P(sheet, { rect: fr.rect });
  // The banner hangs from a crossbar and a loop at its pole edge; it extends toward the centre line.
  cylinder(ctx.b, wood, [x, top - 0.12, z], [x, top - 0.12, z + sgn * (w + 0.05)], 0.04, 0.04, 4, true);
  cloth(ctx.b, paint, [x + 0.01, top - 0.16, z], [0, 0, sgn * w], [0, -h, 0], { nu: byLod(ctx, 3, 2, 1), nv: byLod(ctx, 9, 4, 1), flutter: 1.0, wave: 0.05 * w, phase });
  if (ctx.lod === 0) {
    cylinder(ctx.b, wood, [x, top, z], [x, top + 0.3, z], 0.07, 0.0, 5, false);
    cylinder(ctx.b, wood, [x, top - h - 0.14, z], [x, top - h - 0.14, z + sgn * (w + 0.05)], 0.035, 0.035, 4, true);
  }
}

/** Golden fish-tiger on a roof ridge end: head and mouth near the roof, body arching up, tail curling outward. */
export function shachihoko(ctx: Ctx, gold: Paint, base: V3, facing: 1 | -1, scale: number) {
  if (ctx.lod > 1) return;
  const b = ctx.b;
  const s = scale;
  const st = (x: number, y: number, a: number, c: number): TubeStation => ({ p: [x * s, y * s, 0], a: a * s, b: c * s });
  b.with(compose(xlate(base[0], base[1], base[2]), rotY(facing > 0 ? 0 : Math.PI)), () => {
    tube(b, gold, [st(0.34, 0.02, 0.2, 0.27), st(0.3, 0.25, 0.25, 0.3), st(0.06, 0.55, 0.23, 0.27), st(-0.2, 0.95, 0.19, 0.22), st(-0.24, 1.35, 0.14, 0.16), st(0.0, 1.7, 0.09, 0.09), st(0.34, 1.84, 0.045, 0.045)], byLod(ctx, 8, 5, 4), { up: [0, 0, 1], capStart: true, capEnd: true });
    if (ctx.lod > 0) return;
    // dorsal spines, side fins, brow and chin
    for (const [x, y, nx] of [[-0.3, 0.8, -1], [-0.36, 1.1, -1], [-0.36, 1.4, -1], [-0.2, 1.65, -0.8]] as [number, number, number][]) spike(b, gold, [x * s, y * s, 0], [nx, 0.5, 0], 0.07 * s, 0.34 * s, 4);
    for (const z of [-1, 1]) {
      spike(b, gold, [0.0, 0.7 * s, z * 0.2 * s], [0.2, 0.2, z], 0.1 * s, 0.4 * s, 4);
      spike(b, gold, [0.42 * s, 0.2 * s, z * 0.12 * s], [1, 0.6, z * 0.5], 0.05 * s, 0.28 * s, 3);
    }
    spike(b, gold, [0.3 * s, 0.4 * s, 0], [0.4, 1, 0], 0.07 * s, 0.3 * s, 4);
    box(b, gold, [0.34 * s, -0.12 * s, -0.17 * s], [0.62 * s, 0.0, 0.17 * s]);
    // ridge tile it stands on
    box(b, gold, [-0.35 * s, -0.2 * s, -0.22 * s], [0.4 * s, 0.0, 0.22 * s]);
  });
}

/** Indigo curtains with the crest, hung along an eave: one panel per bay. */
export function makuRun(ctx: Ctx, maku: Paint, x0: number, x1: number, z: number, yTop: number, h: number, n: number, phase: number, wood: Paint) {
  if (ctx.lod > 1) return;
  const bay = (x1 - x0) / n;
  // The cloth runs from its top-right corner leftward so its print faces outward.
  for (let i = 0; i < n; i += 1) {
    const xa = x0 + bay * i;
    cloth(ctx.b, maku, [xa + bay - 0.07, yTop, z], [-(bay - 0.14), 0, 0], [0, -h, 0], {
      nu: byLod(ctx, 3, 1, 1),
      nv: byLod(ctx, 4, 1, 1),
      flutter: 0.45,
      hang: true,
      phase: phase + i * 1.3,
    });
  }
  if (ctx.lod === 0) sweep(ctx.b, wood, [[x0, yTop + 0.03, z], [x1, yTop + 0.03, z]], rectSection(0.12, 0.12), { caps: true });
}

/**
 * Plaster-and-timber wall box of a fortress tier: a black lacquered base, plaster above with black frames every
 * `bay` metres and real dark loopholes at the middle of each bay.
 */
export function plasterTier(ctx: Ctx, o: { cx: number; hx: number; hz: number; y0: number; y1: number; base: number; bay: number; loop: [number, number]; window?: boolean }, paints: { plaster: Paint; lacquer: Paint; frame: Paint; dark: Paint }) {
  const { b } = ctx;
  const { cx, hx, hz, y0, y1 } = o;
  const yb = y0 + o.base;
  // core walls
  box(b, paints.lacquer, [cx - hx, y0, -hz], [cx + hx, yb, hz], { grain: 0 });
  box(b, paints.plaster, [cx - hx + 0.02, yb, -hz + 0.02], [cx + hx - 0.02, y1, hz - 0.02], { grain: 0 });
  if (ctx.lod > 1) return;
  // timber frame: sill, lintel and posts proud of the plaster
  const t = 0.14;
  for (const s of [-1, 1] as const) {
    box(b, paints.frame, [cx - hx - t, yb - 0.08, s * hz - t], [cx + hx + t, yb + 0.1, s * hz + t], { grain: 0 });
    box(b, paints.frame, [cx - hx - t, y1 - 0.18, s * hz - t], [cx + hx + t, y1, s * hz + t], { grain: 0 });
  }
  for (const s of [-1, 1] as const) box(b, paints.frame, [s * hx + cx - t, yb - 0.08, -hz - t], [s * hx + cx + t, y1, hz + t], { grain: 1 });
  if (ctx.lod > 0) return;
  const nx = Math.max(1, Math.round((2 * hx) / o.bay));
  const nz = Math.max(1, Math.round((2 * hz) / o.bay));
  for (const s of [-1, 1] as const) {
    for (let i = 1; i < nx; i += 1) {
      const x = cx - hx + (2 * hx * i) / nx;
      box(b, paints.frame, [x - 0.1, yb, s * hz - 0.1], [x + 0.1, y1, s * hz + 0.1], { grain: 1 });
    }
    for (let i = 0; i < nx; i += 1) {
      const x = cx - hx + (2 * hx * (i + 0.5)) / nx;
      const z = s * (hz + 0.025);
      const y = (yb + y1) / 2 + 0.05;
      if (o.window) {
        b.quadF(paints.dark, [[x - 0.4, y - 0.22, z], [x + 0.4, y - 0.22, z], [x + 0.4, y + 0.3, z], [x - 0.4, y + 0.3, z]], [0, 0, s]);
        box(b, paints.frame, [x - 0.5, y + 0.3, z - 0.06], [x + 0.5, y + 0.4, z + 0.06], { grain: 0 });
        box(b, paints.frame, [x - 0.5, y - 0.32, z - 0.06], [x + 0.5, y - 0.22, z + 0.06], { grain: 0 });
        for (const dx of [-0.2, 0, 0.2]) box(b, paints.frame, [x + dx - 0.015, y - 0.22, z - 0.03], [x + dx + 0.015, y + 0.3, z + 0.03], { grain: 1 });
      } else {
        b.quadF(paints.dark, [[x - o.loop[0] / 2, y - o.loop[1] / 2, z], [x + o.loop[0] / 2, y - o.loop[1] / 2, z], [x + o.loop[0] / 2, y + o.loop[1] / 2, z], [x - o.loop[0] / 2, y + o.loop[1] / 2, z]], [0, 0, s]);
      }
    }
  }
  for (const s of [-1, 1] as const) {
    for (let i = 1; i < nz; i += 1) {
      const z = -hz + (2 * hz * i) / nz;
      box(b, paints.frame, [cx + s * hx - 0.1, yb, z - 0.1], [cx + s * hx + 0.1, y1, z + 0.1], { grain: 1 });
    }
    for (let i = 0; i < nz; i += 1) {
      const z = -hz + (2 * hz * (i + 0.5)) / nz;
      const x = cx + s * (hx + 0.025);
      const y = (yb + y1) / 2 + 0.05;
      b.quadF(paints.dark, [[x, y - o.loop[1] / 2, z - o.loop[0] / 2], [x, y - o.loop[1] / 2, z + o.loop[0] / 2], [x, y + o.loop[1] / 2, z + o.loop[0] / 2], [x, y + o.loop[1] / 2, z - o.loop[0] / 2]], [s, 0, 0]);
    }
  }
}
