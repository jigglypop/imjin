/**
 * Atakebune (安宅船): the Japanese fortress ship. A black-lacquered, nearly flat-bottomed hull under a tategaki wall of
 * crested shield boards with ozutsu ports, a three-tier plaster-and-timber castle with kawara skirts, an irimoya
 * roof crowned by gold shachihoko, maku curtains with the crest, nobori banners and one straw sail on the foremast.
 */
import { anchorsFor, ATAKE_PLANS, ATAKE_TURRET, atakeLevels, sideZ } from '../anchors';
import { box, cylinder, hipRoof, MeshBuilder, paints, rectSection, spike, sweep, xlate, type MeshData, type V3 } from './parts';
import {
  anchorProp,
  barrel,
  byLod,
  cannon,
  clothPatch,
  deckPlane,
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
  sail,
  sideTimber,
  wallRun,
  windlass,
  type Ctx,
  type Lod,
} from './common';
import { makuRun, nobori, plasterTier, shachihoko } from './japan';
import { irimoyaRoof, skirtRoof } from './roofs';

export function buildAtakebune(variant: number, lod: Lod): MeshData {
  const plan = ATAKE_PLANS[variant] ?? ATAKE_PLANS[0]!;
  const anchors = anchorsFor(`atakebune#${ATAKE_PLANS[variant] ? variant : 0}`)!;
  const b = new MeshBuilder();
  const ctx: Ctx = { b, lod, faction: 'japan', P: paints('japan'), rnd: mulberry32(5150 + variant) };
  const { P } = ctx;
  const h = plan.hull;
  const L = h.length;
  const deck = h.deck;
  const lacquer = P('black_lacquer');
  const plank = P('hull_plank', { tint: [0.66, 0.6, 0.55] });
  const dark = P('black_lacquer', { tint: [0.16, 0.16, 0.16] });
  const iron = P('iron', { tint: [0.85, 0.8, 0.78] });
  const gold = P('gold', { tint: [0.95, 0.85, 0.65] });
  const kawara = P('kawara');
  const plaster = P('plaster', { tint: [0.92, 0.9, 0.86] });
  const rope = P('rope');
  const wood = P('hull_plank', { tint: [0.85, 0.78, 0.7] });
  const sheer = (x: number) => plan.sheer * Math.pow(Math.abs((2 * x) / L), 2.2);
  const outer = (x: number) => sideZ(h, x, deck) + 0.04;
  const top = (x: number) => deck + plan.parapet + sheer(x);

  // --- hull: planks below, a black lacquered band above, an iron-plated bow ---
  loftHull(ctx, h, plank, plank);
  hullBand(ctx, h, lacquer, -L / 2 + 0.05, L / 2 - 0.05, 1.45, deck - 0.02, 0.05);
  if (lod < 2) hullBand(ctx, h, iron, 8.5, L / 2 - 0.05, 0.2, 1.45, 0.07);
  deckPlane(ctx, h, P('deck_plank'), -L / 2 + 0.35, L / 2 - 0.35, deck, 0.04);
  if (lod === 0) deckPlane(ctx, h, P('deck_plank', { tint: [0.7, 0.66, 0.6] }), -L / 2 + 3, L / 2 - 3, deck - 2.2, 0.5);
  const wales: [number, number, number][] = lod === 0 ? [[0.45, 0.16, 0.32], [1.45, 0.14, 0.26]] : [];
  for (const [y, t, tall] of wales) sideTimber(ctx, h, plank, -L / 2 + 0.6, L / 2 - 0.6, y, t, tall, 0.07);
  if (lod < 2) sideTimber(ctx, h, iron, -L / 2 + 0.6, L / 2 - 0.6, deck - 0.05, 0.2, 0.26, 0.08);

  // --- oars ---
  for (const op of anchors.oarPorts) {
    const side = op.side === 0 ? -1 : 1;
    oarPortFrame(ctx, op.pos, side, dark);
    oar(ctx, op.pos, side, 0.5, wood, plank, 2.6, 6.2);
  }

  // --- tategaki wall with ozutsu ports ---
  const portXs = anchors.gunPorts.filter((g) => g.side === 0).map((g) => g.pos[0]);
  const ports = (side: number) => anchors.gunPorts.filter((g) => g.side === side).map((g) => ({ x: g.pos[0], w: 0.95, y0: deck + 0.5, y1: deck + 1.3 }));
  const crest = P('shield_crest', { rect: [0.02, 0.02, 0.98, 0.98] });
  for (const side of [-1, 1] as const) {
    wallRun(ctx, side, -L / 2 + 0.3, L / 2 - 0.3, deck, top, outer, 0.26, ports(side === -1 ? 0 : 1), lacquer, plank);
    const n = byLod(ctx, 24, 10, 5);
    const path: V3[] = [];
    for (let i = 0; i <= n; i += 1) {
      const x = -L / 2 + 0.3 + ((L - 0.6) * i) / n;
      path.push([x, top(x) + 0.08, side * (outer(x) - 0.12)]);
    }
    sweep(b, iron, path, rectSection(0.42, 0.16));
    if (lod < 2) {
      for (let x = -17.4; x <= 17.5; x += 2.9) {
        if (portXs.some((px) => Math.abs(px - x) < 1.55)) continue;
        const z = side * (outer(x) + 0.015);
        const y0 = deck + 0.22;
        const y1 = deck + plan.parapet - 0.28 + sheer(x) * 0.5;
        b.quadF(crest, [[x - 0.7, y0, z], [x + 0.7, y0, z], [x + 0.7, y1, z], [x - 0.7, y1, z]], [0, 0, side], [[0, 0], [1, 0], [1, 1], [0, 1]]);
      }
      for (const g of anchors.gunPorts.filter((q) => q.side === (side === -1 ? 0 : 1))) {
        const z = side * (outer(g.pos[0]) + 0.02);
        for (const dx of [-0.55, 0.55]) box(b, iron, [g.pos[0] + dx - 0.08, deck + 0.32, z - 0.15], [g.pos[0] + dx + 0.08, deck + 1.42, z + 0.15], { grain: 1 });
        box(b, iron, [g.pos[0] - 0.62, deck + 1.28, z - 0.15], [g.pos[0] + 0.62, deck + 1.44, z + 0.15], { grain: 0 });
        cannon(ctx, [g.pos[0], g.pos[1], z], [0, 0, side], 'ozutsu', wood, P('iron', { tint: [0.7, 0.62, 0.55] }), iron);
      }
    }
  }
  for (const sgn of [-1, 1]) {
    const xe = (sgn * L) / 2;
    const zE = sideZ(h, xe, deck);
    const t = top(xe);
    box(b, lacquer, [sgn > 0 ? xe - 0.3 : xe, deck, -zE], [sgn > 0 ? xe : xe + 0.3, t, zE], { grain: 1 });
    if (lod < 2) {
      const x = xe + sgn * 0.015;
      const w = Math.min(zE * 0.8, 1.6);
      b.quadF(crest, [[x, deck + 0.2, -w], [x, deck + 0.2, w], [x, t - 0.15, w], [x, t - 0.15, -w]], [sgn, 0, 0], [[0, 0], [1, 0], [1, 1], [0, 1]]);
    }
  }
  // rudder and stem
  if (lod < 2) {
    box(b, plank, [-L / 2 - 0.65, -2.4, -0.25], [-L / 2 - 0.05, 1.5, 0.25], { grain: 1 });
    box(b, lacquer, [-L / 2 - 0.55, 1.5, -0.18], [-L / 2 - 0.3, deck + 1.2, 0.18], { grain: 1 });
  }

  // --- the castle ---
  const lv = atakeLevels(plan);
  const frame = lacquer;
  lv.forEach((t, i) => {
    plasterTier(ctx, { cx: plan.cx, hx: t.hx, hz: t.hz, y0: t.y0, y1: t.y1, base: i === 0 ? 0.75 : 0.5, bay: i === 0 ? 2.6 : 2.3, loop: [0.24, 0.24], window: i > 0 }, { plaster, lacquer, frame, dark });
    if (!t.last) {
      const next = lv[i + 1]!;
      skirtRoof(ctx, { tile: kawara, trim: lacquer, cap: lacquer }, { cx: plan.cx, hx: t.hx + 1.1, hz: t.hz + 1.1, ihx: next.hx + 0.05, ihz: next.hz + 0.05, y: t.y1 - 0.05, rise: plan.skirt, lift: 0.5, concave: 1.7, fascia: 0.36 });
    } else {
      const roof = irimoyaRoof(ctx, { tile: kawara, trim: lacquer, cap: lacquer }, plaster, { cx: plan.cx, hx: t.hx + 1.2, hz: t.hz + 1.2, wx: t.hx - 0.8, wz: t.hz - 0.7, y: t.y1 - 0.05, skirt: 0.8, hafu: 0.7, gable: 1.5, lift: 0.5 });
      for (const sx of [-1, 1] as const) shachihoko(ctx, gold, [plan.cx + sx * roof.ridgeX, roof.ridgeY + 0.25, 0], sx, 0.95);
      // staff for the command banner
      const staff: V3 = [plan.cx, roof.ridgeY + 0.3, 0];
      cylinder(b, wood, staff, [staff[0], staff[1] + 2.4, 0], 0.06, 0.04, byLod(ctx, 5, 4, 3), true);
      if (lod < 2) longPennant(ctx, clothPatch(ctx, 'nobori_a', 'red'), [staff[0] - 0.05, staff[1] + 2.35, 0], 6.5, 0.9, 0.3);
    }
  });
  // the second atakebune carries a small turret on the foredeck as well
  if (variant === 1) {
    const u = ATAKE_TURRET;
    plasterTier(ctx, { cx: u.x, hx: u.hx, hz: u.hz, y0: deck, y1: deck + u.h, base: 0.6, bay: 2.4, loop: [0.24, 0.24], window: false }, { plaster, lacquer, frame, dark });
    b.with(xlate(u.x, 0, 0), () => hipRoof(b, kawara, lacquer, lacquer, { hx: u.hx + 1.0, hz: u.hz + 1.0, ridge: 0.4, y: deck + u.h - 0.05, rise: 1.5, lift: 0.45, concave: 1.7, nSlope: byLod(ctx, 5, 3, 1), nEave: byLod(ctx, 12, 6, 2), fascia: 0.34 }));
    if (lod < 2) spike(b, gold, [u.x, deck + u.h + 1.5, 0], [0, 1, 0], 0.1, 1.2, 5);
  }
  // maku curtains hang under the eaves of the lowest tier
  const t0 = lv[0]!;
  for (const side of [-1, 1] as const) makuRun(ctx, P('maku', { rect: [0.01, 0.01, 0.99, 0.99] }), plan.cx - t0.hx + 0.5, plan.cx + t0.hx - 0.5, side * (t0.hz + 0.2), t0.y1 - 0.12, 1.5, 4, side, frame);

  // --- mast and straw sail ---
  const m = plan.mast;
  mast(ctx, wood, iron, m.x, deck, m.h, m.r);
  if (lod < 2) box(b, plank, [m.x - 0.6, deck, -0.6], [m.x + 0.6, deck + 0.45, 0.6], { grain: 0 });
  sail(ctx, P('matting', { tint: [1.0, 0.92, 0.78] }), wood, rope, { x: m.x, yTop: deck + m.h - 1.3, w: m.sailW, h: m.sailH, billow: 0.8, battens: 7, phase: 0.5 });
  if (lod < 2) longPennant(ctx, clothPatch(ctx, 'nobori_b', 'black'), [m.x - 0.1, deck + m.h - 0.1, 0], 4.6, 0.55, 1.1);
  if (lod === 0) {
    // forestay and backstay ropes from the masthead to the bulwark
    for (const sgn of [-1, 1]) {
      const head: V3 = [m.x, deck + m.h * 0.85, sgn * 0.1];
      for (const dx of [-1.8, 0, 1.8]) sweep(b, rope, [head, [m.x + dx, deck + plan.parapet + 0.2, sgn * (outer(m.x + dx) - 0.2)]], rectSection(0.05, 0.05), { caps: true });
    }
  }

  // --- banners ---
  for (const f of anchors.flagMounts) {
    if (f.kind !== 'nobori') continue;
    nobori(ctx, f.pos, f.size[1] + 0.9, f.size[0], f.size[1], f.id.slice(7), f.pos[0] * 0.7 + f.pos[2], wood);
  }

  // --- deck furniture ---
  const jar = P('hull_plank', { tint: [0.75, 0.65, 0.55] });
  [[-14.6, 3.7], [-16.3, -3.3], [-12.4, -4.3], [13.0, 4.0]].forEach(([x, z]) => barrel(ctx, jar, iron, [x!, deck, z!], 0.42, 0.85));
  ropeCoil(ctx, rope, [-15.0, deck, -1.2], 0.5);
  ropeCoil(ctx, rope, [12.6, deck, -3.6], 0.45);
  hatch(ctx, P('deck_plank'), dark, -14.2, deck, 0.6, 2.2, 1.5);
  hatch(ctx, P('deck_plank'), dark, 13.4, deck, -0.4, 1.8, 1.4);
  if (variant === 0) windlass(ctx, wood, iron, 16.2, deck, 1.5);
  for (const side of [-1, 1]) anchorProp(ctx, wood, iron, [13.6, deck - 0.1, side * (outer(13.6) + 0.45)]);
  for (const l of anchors.lanterns) lantern(ctx, P('sail_cloth', { tint: [1.35, 1.2, 0.95] }), lacquer, l);
  return b.data();
}
