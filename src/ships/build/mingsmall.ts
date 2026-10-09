/**
 * Mingsmall (沙船, shachuan): the small Ming sand-boat. A flat-bottomed lacquered hull with a painted bow eye, a
 * low bulwark with one folangji port a side, a cabin under a glazed roof aft, two battened junk sails and five oars.
 */
import { anchorsFor, MINGSMALL_PLAN, sideZ } from '../anchors';
import { box, hipRoof, MeshBuilder, paints, rectSection, sweep, xlate, type MeshData, type V3 } from './parts';
import { barrel, byLod, cannon, clothPatch, deckPlane, flag, hullBand, lantern, loftHull, longPennant, mast, mulberry32, oar, oarPortFrame, ropeCoil, sideTimber, wallRun, type Ctx, type Lod } from './common';
import { hullPatch, junkSail, railRect } from './ming';

export function buildMingsmall(lod: Lod): MeshData {
  const plan = MINGSMALL_PLAN;
  const anchors = anchorsFor('mingsmall#0')!;
  const b = new MeshBuilder();
  const ctx: Ctx = { b, lod, faction: 'ming', P: paints('ming'), rnd: mulberry32(8120) };
  const { P } = ctx;
  const h = plan.hull;
  const L = h.length;
  const deck = h.deck;
  const hullP = P('hull_plank', { tint: [0.9, 0.84, 0.8] });
  const red = P('red_lacquer');
  const gilt = P('gilt');
  const wood = P('mast_wood', { tint: [0.9, 0.85, 0.8] });
  const timber = P('hull_plank', { tint: [0.5, 0.45, 0.42] });
  const dark = P('hull_plank', { tint: [0.13, 0.11, 0.1] });
  const bronze = P('bronze', { tint: [1.2, 1.0, 0.8] });
  const iron = P('iron');
  const rope = P('rope');
  const top = (x: number) => deck + plan.parapet + 0.4 * Math.pow(Math.abs((2 * x) / L), 2.4);
  const outer = (x: number) => sideZ(h, x, deck) + 0.04;

  loftHull(ctx, h, hullP, hullP);
  hullBand(ctx, h, red, -L / 2 + 0.05, L / 2 - 0.05, 0.28, deck - 0.02, 0.05);
  if (lod < 2) hullBand(ctx, h, gilt, -L / 2 + 0.4, L / 2 - 0.4, deck - 0.5, deck - 0.1, 0.08);
  deckPlane(ctx, h, P('deck_plank'), -L / 2 + 0.3, L / 2 - 0.3, deck, 0.04);
  if (lod === 0) sideTimber(ctx, h, timber, -L / 2 + 0.5, L / 2 - 0.5, 0.35, 0.12, 0.22, 0.06);
  if (lod < 2) hullPatch(ctx, h, P('eye', { rect: [0.03, 0.1, 0.97, 0.9] }), L / 2 - 3.5, L / 2 - 1.7, 0.35, 1.45, 0.1);

  // oars
  for (const op of anchors.oarPorts) {
    const side = op.side === 0 ? -1 : 1;
    oarPortFrame(ctx, [op.pos[0], deck + 0.38, op.pos[2]], side, dark);
    oar(ctx, [op.pos[0], deck + 0.4, op.pos[2]], side, 0.42, wood, hullP, 1.8, 4.3);
  }

  // bulwark: oar notches and the gun port
  const oarXs = anchors.oarPorts.filter((p) => p.side === 0).map((p) => p.pos[0]);
  const ports = (side: number) => [
    ...oarXs.map((x) => ({ x, w: 0.46, y0: deck + 0.12, y1: deck + 0.62 })),
    ...anchors.gunPorts.filter((g) => g.side === side).map((g) => ({ x: g.pos[0], w: 0.8, y0: deck + 0.28, y1: deck + 0.82 })),
  ].sort((a, c) => a.x - c.x);
  for (const side of [-1, 1] as const) {
    wallRun(ctx, side, -L / 2 + 0.3, L / 2 - 0.3, deck, top, outer, 0.2, ports(side === -1 ? 0 : 1), red, timber);
    const n = byLod(ctx, 18, 8, 4);
    const path: V3[] = [];
    for (let i = 0; i <= n; i += 1) {
      const x = -L / 2 + 0.3 + ((L - 0.6) * i) / n;
      path.push([x, top(x) + 0.06, side * (outer(x) - 0.1)]);
    }
    sweep(b, gilt, path, rectSection(0.34, 0.12));
    if (lod < 2) {
      for (const g of anchors.gunPorts.filter((q) => q.side === (side === -1 ? 0 : 1))) {
        const z = side * (outer(g.pos[0]) + 0.02);
        for (const dx of [-0.46, 0.46]) box(b, gilt, [g.pos[0] + dx - 0.06, deck + 0.2, z - 0.12], [g.pos[0] + dx + 0.06, deck + 0.92, z + 0.12], { grain: 1 });
        box(b, gilt, [g.pos[0] - 0.52, deck + 0.82, z - 0.12], [g.pos[0] + 0.52, deck + 0.94, z + 0.12], { grain: 0 });
        cannon(ctx, [g.pos[0], g.pos[1] - 0.1, z], [0, 0, side], g.gun, timber, bronze, iron);
      }
    }
  }
  {
    const xb = L / 2;
    const zb = sideZ(h, xb, deck);
    box(b, red, [xb - 0.25, deck, -zb], [xb, top(xb), zb], { grain: 1 });
    box(b, timber, [-L / 2 - 0.55, -1.4, -0.2], [-L / 2 - 0.05, 0.9, 0.2], { grain: 1 });
    if (lod < 2) {
      const x = xb + 0.015;
      b.quadF(P('panel_gold', { rect: [0.02, 0.02, 0.98, 0.98], surf: 3 }), [[x, deck + 0.1, -0.7], [x, deck + 0.1, 0.7], [x, deck + 0.1 + 1.3, 0.7], [x, deck + 0.1 + 1.3, -0.7]], [1, 0, 0], [[0, 0], [1, 0], [1, 1], [0, 1]]);
    }
  }

  // cabin aft with a glazed hip roof and a rail on the roof deck
  const c = plan.cabin;
  box(b, P('cabin_wood', { tint: [1.05, 1.0, 0.95] }), [c.x - c.hx, deck, -c.hz], [c.x + c.hx, deck + c.h, c.hz], { grain: 0 });
  if (lod < 2) {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(b, red, [c.x + sx * c.hx - 0.13, deck, sz * c.hz - 0.13], [c.x + sx * c.hx + 0.13, deck + c.h, sz * c.hz + 0.13], { grain: 1 });
    const xf = c.x + c.hx + 0.015;
    b.quadF(P('blue_paint'), [[xf, deck, -0.5], [xf, deck, 0.5], [xf, deck + 1.25, 0.5], [xf, deck + 1.25, -0.5]], [1, 0, 0], [[0, 0], [1, 0], [1, 1], [0, 1]]);
    box(b, gilt, [c.x - c.hx - 0.1, deck + c.h - 0.3, -c.hz - 0.1], [c.x + c.hx + 0.1, deck + c.h, c.hz + 0.1], { grain: 0 });
  }
  b.with(xlate(c.x, 0, 0), () => {
    hipRoof(b, P('roof_glazed', { surf: 3 }), red, gilt, { hx: c.hx + 0.9, hz: c.hz + 0.9, ridge: Math.max(0.3, c.hx - c.hz), y: deck + c.h + 0.02, rise: 1.15, lift: 0.45, concave: 1.7, nSlope: byLod(ctx, 4, 2, 1), nEave: byLod(ctx, 10, 5, 2), fascia: 0.28 });
  });
  flag(ctx, { pole: [c.x, deck + c.h + 1.15, 0], poleH: 2.0, w: 1.9, h: 1.5, sheet: 'flags_a', flag: 'ming', phase: 0.3, wood: timber, nu: byLod(ctx, 6, 2, 1), nv: byLod(ctx, 4, 2, 1), flutter: 1.1 });
  railRect(ctx, red, timber, -L / 2 + 1.1, deck, 0.9, 1.5, 0);

  // masts and junk sails
  plan.masts.forEach((m, i) => {
    mast(ctx, wood, bronze, m.x, deck, m.h, m.r);
    if (lod < 2) box(b, timber, [m.x - 0.4, deck, -0.4], [m.x + 0.4, deck + 0.3, 0.4], { grain: 0 });
    junkSail(ctx, P('sail_junk'), wood, rope, { x: m.x, yTop: deck + m.h - 0.9, w: m.sailW, h: m.sailH, billow: 0.7, yaw: m.yaw, phase: i * 2.1, battens: i === 0 ? 7 : 5 });
    if (lod < 2) longPennant(ctx, i ? clothPatch(ctx, 'flags_b', 'yellow') : clothPatch(ctx, 'flags_a', 'red'), [m.x - 0.08, deck + m.h - 0.05, 0], i ? 3.2 : 4.4, 0.6, i);
  });

  // fittings
  [[-1.4, 1.5], [3.0, -1.4]].forEach(([x, z]) => barrel(ctx, P('hull_plank', { tint: [0.8, 0.62, 0.5] }), iron, [x!, deck, z!], 0.34, 0.7));
  ropeCoil(ctx, rope, [5.8, deck, 1.0], 0.38);
  for (const l of anchors.lanterns) lantern(ctx, P('red_lacquer', { tint: [1.35, 0.95, 0.75] }), gilt, l, 0.2);
  return b.data();
}
