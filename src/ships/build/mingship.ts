/**
 * Mingship (福船, fuchuan): the Ming war junk. A broad lacquered hull with painted bow eyes, a bulwark with folangji
 * and hudun ports, a two-storey stern castle under a green glazed roof, three masts with battened junk sails set at
 * an angle, and red and yellow banners.
 */
import { anchorsFor, MING_PLAN, sideZ } from '../anchors';
import { box, hipRoof, MeshBuilder, paints, rectSection, spike, sweep, xlate, type MeshData, type V3 } from './parts';
import {
  anchorProp,
  barrel,
  byLod,
  cannon,
  clothPatch,
  deckPlane,
  flag,
  hatch,
  hullBand,
  lantern,
  loftHull,
  longPennant,
  mast,
  mulberry32,
  oar,
  oarPortFrame,
  ropeCoil,
  sideTimber,
  wallRun,
  windlass,
  type Ctx,
  type Lod,
} from './common';
import { hullPatch, junkSail, railRect } from './ming';

const BANNERS: [string, string][] = [
  ['flags_a', 'ming'],
  ['flags_b', 'yellow'],
  ['flags_a', 'red'],
  ['flags_a', 'dragon'],
];

export function buildMingship(lod: Lod): MeshData {
  const plan = MING_PLAN;
  const anchors = anchorsFor('mingship#0')!;
  const b = new MeshBuilder();
  const ctx: Ctx = { b, lod, faction: 'ming', P: paints('ming'), rnd: mulberry32(8800) };
  const { P } = ctx;
  const h = plan.hull;
  const L = h.length;
  const deck = h.deck;
  const hullP = P('hull_plank', { tint: [0.88, 0.82, 0.78] });
  const red = P('red_lacquer');
  const gilt = P('gilt');
  const wood = P('mast_wood', { tint: [0.9, 0.85, 0.8] });
  const timber = P('hull_plank', { tint: [0.5, 0.45, 0.42] });
  const dark = P('hull_plank', { tint: [0.13, 0.11, 0.1] });
  const bronze = P('bronze', { tint: [1.2, 1.0, 0.8] });
  const iron = P('iron');
  const rope = P('rope');
  const sheer = (x: number) => (x < 0 ? 0.95 : 0.5) * Math.pow(Math.abs((2 * x) / L), 2.4);
  const outer = (x: number) => sideZ(h, x, deck) + 0.04;
  const top = (x: number) => deck + plan.parapet + sheer(x);

  // --- hull: planks, red topsides with a gilt frieze, bow eyes ---
  loftHull(ctx, h, hullP, hullP);
  hullBand(ctx, h, red, -L / 2 + 0.05, L / 2 - 0.05, 0.5, deck - 0.02, 0.05);
  if (lod < 2) hullBand(ctx, h, gilt, -L / 2 + 0.6, L / 2 - 0.6, deck - 0.75, deck - 0.12, 0.08);
  deckPlane(ctx, h, P('deck_plank'), -L / 2 + 0.35, L / 2 - 0.35, deck, 0.04);
  if (lod === 0) deckPlane(ctx, h, P('deck_plank', { tint: [0.7, 0.66, 0.62] }), -L / 2 + 3, L / 2 - 3, deck - 1.4, 0.5);
  const wales: [number, number, number][] = lod === 0 ? [[0.3, 0.16, 0.3], [1.25, 0.14, 0.24]] : [];
  for (const [y, t, tall] of wales) sideTimber(ctx, h, timber, -L / 2 + 0.6, L / 2 - 0.6, y, t, tall, 0.07);
  if (lod < 2) hullPatch(ctx, h, P('eye', { rect: [0.03, 0.1, 0.97, 0.9] }), L / 2 - 6.6, L / 2 - 3.6, 0.55, 2.6, 0.11);

  // --- oars ---
  for (const op of anchors.oarPorts) {
    const side = op.side === 0 ? -1 : 1;
    oarPortFrame(ctx, op.pos, side, dark);
    oar(ctx, op.pos, side, 0.45, wood, hullP, 2.4, 6.0);
  }

  // --- bulwark with gun ports ---
  const ports = (side: number) => anchors.gunPorts.filter((g) => g.side === side).map((g) => ({ x: g.pos[0], w: 0.9, y0: deck + 0.45, y1: deck + 1.2 }));
  for (const side of [-1, 1] as const) {
    wallRun(ctx, side, -L / 2 + 0.3, L / 2 - 0.3, deck, top, outer, 0.26, ports(side === -1 ? 0 : 1), red, timber);
    const n = byLod(ctx, 24, 10, 5);
    const coping: V3[] = [];
    const frieze: V3[] = [];
    for (let i = 0; i <= n; i += 1) {
      const x = -L / 2 + 0.3 + ((L - 0.6) * i) / n;
      coping.push([x, top(x) + 0.07, side * (outer(x) - 0.12)]);
      frieze.push([x, top(x) - 0.42, side * (outer(x) + 0.015)]);
    }
    sweep(b, gilt, coping, rectSection(0.44, 0.15));
    if (lod < 2) sweep(b, gilt, frieze, rectSection(0.04, 0.26), { up: [0, 0, 1] });
    if (lod < 2) {
      for (const g of anchors.gunPorts.filter((q) => q.side === (side === -1 ? 0 : 1))) {
        const z = side * (outer(g.pos[0]) + 0.02);
        for (const dx of [-0.55, 0.55]) box(b, gilt, [g.pos[0] + dx - 0.07, deck + 0.35, z - 0.14], [g.pos[0] + dx + 0.07, deck + 1.3, z + 0.14], { grain: 1 });
        box(b, gilt, [g.pos[0] - 0.62, deck + 1.18, z - 0.14], [g.pos[0] + 0.62, deck + 1.34, z + 0.14], { grain: 0 });
        cannon(ctx, [g.pos[0], g.pos[1], z], [0, 0, side], g.gun, timber, bronze, iron);
      }
    }
  }
  // banner poles along the bulwark
  if (lod < 2) {
    let k = 0;
    for (const side of [-1, 1] as const) {
      for (const x of [-8, -2.4, 4, 9.5, 14.5]) {
        if (lod === 1 && k % 2) {
          k += 1;
          continue;
        }
        const [sheet, name] = BANNERS[(k + (side > 0 ? 1 : 0)) % BANNERS.length]!;
        k += 1;
        flag(ctx, { pole: [x, top(x) + 0.1, side * (outer(x) - 0.12)], poleH: 2.1, w: 1.5, h: 1.2, sheet, flag: name, phase: k * 0.8, wood: timber, nu: byLod(ctx, 4, 1, 1), nv: byLod(ctx, 3, 1, 1) });
      }
    }
  }
  // bow and stern walls, a dragon panel on the bow
  {
    const xb = L / 2;
    const zb = sideZ(h, xb, deck);
    box(b, red, [xb - 0.3, deck, -zb], [xb, top(xb), zb], { grain: 1 });
    if (lod < 2) {
      const x = xb + 0.015;
      b.quadF(P('panel_gold', { rect: [0.02, 0.02, 0.98, 0.98], surf: 3 }), [[x, deck + 0.15, -1.4], [x, deck + 0.15, 1.4], [x, deck + 0.15 + 2.5, 1.4], [x, deck + 0.15 + 2.5, -1.4]], [1, 0, 0], [[0, 0], [1, 0], [1, 1], [0, 1]]);
      box(b, gilt, [xb - 0.1, deck + 0.05, -1.55], [xb + 0.03, deck + 0.15, 1.55], { grain: 2 });
      box(b, gilt, [xb - 0.1, deck + 2.65, -1.55], [xb + 0.03, deck + 2.75, 1.55], { grain: 2 });
    }
  }
  // rudder and stern timbers
  if (lod < 2) {
    box(b, timber, [-L / 2 - 0.7, -2.6, -0.28], [-L / 2 - 0.05, 1.8, 0.28], { grain: 1 });
    box(b, red, [-L / 2 - 0.5, 1.8, -0.2], [-L / 2 - 0.25, deck - 0.1, 0.2], { grain: 1 });
  }

  // --- stern castle ---
  const c = plan.castle;
  const y1 = deck + c.h1;
  const cab = P('cabin_wood', { tint: [1.05, 1.0, 0.95] });
  box(b, cab, [c.x - c.hx, deck, -c.hz], [c.x + c.hx, y1, c.hz], { grain: 0 });
  if (lod < 2) {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(b, red, [c.x + sx * c.hx - 0.17, deck, sz * c.hz - 0.17], [c.x + sx * c.hx + 0.17, y1, sz * c.hz + 0.17], { grain: 1 });
    for (const sz of [-1, 1]) {
      box(b, red, [c.x - c.hx, y1 - 0.4, sz * c.hz - 0.1], [c.x + c.hx, y1 - 0.05, sz * c.hz + 0.1], { grain: 0 });
      box(b, red, [c.x - c.hx, deck + 0.7, sz * c.hz - 0.08], [c.x + c.hx, deck + 0.85, sz * c.hz + 0.08], { grain: 0 });
    }
    // doors on the bow face and the dragon panel on the stern face
    const xf = c.x + c.hx + 0.015;
    for (const z of [-1.5, 1.5]) {
      b.quadF(P('blue_paint'), [[xf, deck, z - 0.65], [xf, deck, z + 0.65], [xf, deck + 1.95, z + 0.65], [xf, deck + 1.95, z - 0.65]], [1, 0, 0], [[0, 0], [1, 0], [1, 1], [0, 1]]);
      box(b, gilt, [xf - 0.05, deck + 1.95, z - 0.75], [xf + 0.07, deck + 2.12, z + 0.75], { grain: 2 });
    }
    const xs = c.x - c.hx - 0.015;
    b.quadF(P('panel_gold', { rect: [0.02, 0.02, 0.98, 0.98], surf: 3 }), [[xs, deck + 0.2, -1.5], [xs, deck + 0.2, 1.5], [xs, deck + 2.6, 1.5], [xs, deck + 2.6, -1.5]], [-1, 0, 0], [[0, 0], [1, 0], [1, 1], [0, 1]]);
  }
  // poop deck slab, rails, stair
  box(b, red, [c.x - c.hx - 0.1, y1, -c.hz - 0.35], [c.x + c.hx + 0.5, y1 + 0.28, c.hz + 0.35], { grain: 0 });
  if (lod < 2) box(b, gilt, [c.x - c.hx - 0.1, y1 - 0.12, -c.hz - 0.4], [c.x + c.hx + 0.55, y1, c.hz + 0.4], { grain: 0 });
  railRect(ctx, red, timber, c.x + 0.2, y1 + 0.28, c.hx + 0.3, c.hz + 0.25, 0.9);
  if (lod === 0) {
    const steps = 8;
    for (let k = 0; k < steps; k += 1) {
      const y = y1 - ((k + 1) * c.h1) / steps;
      box(b, P('deck_plank'), [c.x + c.hx + 0.5 + k * 0.4, y - 0.05, -0.8], [c.x + c.hx + 0.5 + (k + 1) * 0.4, y + 0.0, 0.8], { grain: 2 });
    }
  }
  // upper pavilion
  const y2 = y1 + 0.28;
  const px = c.x - 0.4;
  const phx = 3.2;
  const phz = 2.6;
  box(b, cab, [px - phx, y2, -phz], [px + phx, y2 + c.h2, phz], { grain: 0 });
  if (lod < 2) {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(b, red, [px + sx * phx - 0.16, y2, sz * phz - 0.16], [px + sx * phx + 0.16, y2 + c.h2, sz * phz + 0.16], { grain: 1 });
    for (const sz of [-1, 1]) box(b, gilt, [px - phx - 0.1, y2 + c.h2 - 0.4, sz * phz - 0.12], [px + phx + 0.1, y2 + c.h2, sz * phz + 0.12], { grain: 0 });
    for (const sx of [-1, 1]) box(b, gilt, [px + sx * phx - 0.12, y2 + c.h2 - 0.4, -phz - 0.1], [px + sx * phx + 0.12, y2 + c.h2, phz + 0.1], { grain: 2 });
    const xf = px + phx + 0.015;
    b.quadF(P('blue_paint'), [[xf, y2, -0.7], [xf, y2, 0.7], [xf, y2 + 1.7, 0.7], [xf, y2 + 1.7, -0.7]], [1, 0, 0], [[0, 0], [1, 0], [1, 1], [0, 1]]);
  }
  const roofY = y2 + c.h2 + 0.05;
  b.with(xlate(px, 0, 0), () => {
    hipRoof(b, P('roof_glazed', { surf: 3 }), red, gilt, { hx: phx + 1.3, hz: phz + 1.3, ridge: phx - phz + 0.2, y: roofY, rise: 1.7, lift: 0.7, concave: 1.8, nSlope: byLod(ctx, 6, 3, 1), nEave: byLod(ctx, 12, 6, 2), fascia: 0.38 });
  });
  if (lod < 2) for (const sx of [-1, 1]) spike(b, gilt, [px + sx * (phx - phz + 0.45), roofY + 1.85, 0], [sx * 0.4, 1, 0], 0.17, 0.7, 5);
  const staffX = px + 0.2;
  flag(ctx, { pole: [staffX, roofY + 1.7, 0], poleH: 3.6, w: 3.6, h: 3.0, sheet: 'flags_a', flag: 'commander', phase: 0.4, wood: timber, nu: byLod(ctx, 10, 3, 1), nv: byLod(ctx, 7, 3, 1), flutter: 1.2 });
  if (lod < 2) {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const [sheet, name] = BANNERS[(sx + sz + 4) % BANNERS.length]!;
      flag(ctx, { pole: [c.x + 0.2 + sx * (c.hx + 0.3), y2, sz * (c.hz + 0.25)], poleH: 2.4, w: 1.7, h: 1.4, sheet, flag: name, phase: sx + sz, wood: timber, nu: byLod(ctx, 5, 1, 1), nv: byLod(ctx, 4, 1, 1) });
    }
  }

  // --- masts and junk sails ---
  plan.masts.forEach((m, i) => {
    mast(ctx, wood, bronze, m.x, deck, m.h, m.r);
    if (lod < 2) box(b, timber, [m.x - 0.65, deck, -0.65], [m.x + 0.65, deck + 0.45, 0.65], { grain: 0 });
    junkSail(ctx, P('sail_junk'), wood, rope, { x: m.x, yTop: deck + m.h - 1.2, w: m.sailW, h: m.sailH, billow: 1.1, yaw: m.yaw, phase: i * 1.9, battens: i === 0 ? 10 : 8 });
    if (lod < 2) {
      const patch = i === 1 ? clothPatch(ctx, 'flags_b', 'yellow') : clothPatch(ctx, 'flags_a', 'red');
      longPennant(ctx, patch, [m.x - 0.1, deck + m.h - 0.05, 0], i === 0 ? 8.5 : i === 1 ? 6.5 : 5, 0.9, i * 0.9);
    }
  });
  if (lod === 0) {
    const mm = plan.masts[0]!;
    // stays from the mainmast to the bow and the castle
    const tip: V3 = [mm.x, deck + mm.h * 0.9, 0];
    sweep(b, rope, [tip, [L / 2 - 1.2, deck + plan.parapet + 1.2, 0]], rectSection(0.06, 0.06), { caps: true });
    sweep(b, rope, [tip, [c.x + c.hx + 0.5, y1 + 1.3, 0]], rectSection(0.06, 0.06), { caps: true });
    for (const m of plan.masts) {
      for (const sgn of [-1, 1]) {
        const head: V3 = [m.x, deck + m.h * 0.8, sgn * 0.1];
        for (const dx of [-1.2, 0.2, 1.6]) sweep(b, rope, [head, [m.x + dx, deck + plan.parapet + 0.2, sgn * (outer(m.x + dx) - 0.2)]], rectSection(0.05, 0.05), { caps: true });
      }
    }
  }

  // --- deck furniture ---
  const jar = P('hull_plank', { tint: [0.8, 0.62, 0.5] });
  [[-2.0, 3.6], [-6.5, -3.9], [8.0, -3.7], [13.0, 3.0]].forEach(([x, z]) => barrel(ctx, jar, iron, [x!, deck, z!], 0.45, 0.9));
  ropeCoil(ctx, rope, [7.0, deck, 3.5], 0.5);
  ropeCoil(ctx, rope, [-1.5, deck, -3.3], 0.45);
  hatch(ctx, P('deck_plank'), dark, 0.2, deck, 0.2, 2.4, 1.8);
  hatch(ctx, P('deck_plank'), dark, 7.0, deck, -0.6, 1.8, 1.4);
  windlass(ctx, timber, iron, 14.6, deck, 1.8);
  for (const side of [-1, 1]) anchorProp(ctx, timber, iron, [8.0, deck - 0.1, side * (outer(8.0) + 0.45)]);
  for (const l of anchors.lanterns) lantern(ctx, P('red_lacquer', { tint: [1.35, 0.95, 0.75] }), gilt, l);
  return b.data();
}
