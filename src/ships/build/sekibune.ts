/**
 * Sekibune (関船): the Japanese medium warship. A slim hull with a rising bow, a tategaki wall of black shield boards
 * with gun slits and oar notches, a small plaster cabin under an irimoya roof aft, nobori banners, seven oars a side
 * and a single sail.
 */
import { anchorsFor, hullTop, SEKI_PLANS, sideZ } from '../anchors';
import { box, hipRoof, MeshBuilder, paints, rectSection, spike, sweep, xlate, type MeshData, type V3 } from './parts';
import { anchorProp, barrel, byLod, clothPatch, deckPlane, hullBand, lantern, loftHull, longPennant, mast, mulberry32, oar, oarPortFrame, ropeCoil, sail, sideTimber, wallRun, type Ctx, type Lod } from './common';
import { nobori, plasterTier, shachihoko } from './japan';
import { irimoyaRoof } from './roofs';

export function buildSekibune(variant: number, lod: Lod): MeshData {
  const plan = SEKI_PLANS[variant] ?? SEKI_PLANS[0]!;
  const anchors = anchorsFor(`sekibune#${SEKI_PLANS[variant] ? variant : 0}`)!;
  const b = new MeshBuilder();
  const ctx: Ctx = { b, lod, faction: 'japan', P: paints('japan'), rnd: mulberry32(6200 + variant) };
  const { P } = ctx;
  const h = plan.hull;
  const L = h.length;
  const deck = h.deck;
  const lacquer = P('black_lacquer');
  const plank = P('hull_plank', { tint: [0.72, 0.64, 0.58] });
  const wood = P('hull_plank', { tint: [0.9, 0.82, 0.72] });
  const dark = P('black_lacquer', { tint: [0.16, 0.16, 0.16] });
  const iron = P('iron', { tint: [0.85, 0.8, 0.78] });
  const gold = P('gold', { tint: [0.95, 0.85, 0.65] });
  const rope = P('rope');
  const top = (x: number) => hullTop(h, x) + plan.parapet + plan.sheer * Math.pow(Math.abs((2 * x) / L), 2.2);
  const outer = (x: number) => sideZ(h, x, hullTop(h, x)) + 0.03;

  // --- hull ---
  loftHull(ctx, h, plank, plank);
  // the second sekibune is left in plain weathered timber below its wall
  if (variant === 0) hullBand(ctx, h, lacquer, -L / 2 + 0.05, L / 2 - 0.05, 0.85, (x) => hullTop(h, x) - 0.02, 0.04);
  deckPlane(ctx, h, P('deck_plank'), -L / 2 + 0.35, L / 2 - 0.35, deck, 0.04);
  if (lod < 2) {
    deckPlane(ctx, h, P('deck_plank', { tint: [0.85, 0.8, 0.74] }), 7.5, L / 2 - 0.5, deck + 0.5, 0.1);
    box(b, wood, [7.4, deck, -2.0], [7.55, deck + 0.5, 2.0], { grain: 1 });
  }
  if (lod === 0) sideTimber(ctx, h, plank, -L / 2 + 0.6, L / 2 - 0.6, 0.55, 0.14, 0.26, 0.05);

  // --- oars ---
  for (const op of anchors.oarPorts) {
    const side = op.side === 0 ? -1 : 1;
    oarPortFrame(ctx, [op.pos[0], deck + 0.4, op.pos[2]], side, dark);
    oar(ctx, [op.pos[0], deck + 0.42, op.pos[2]], side, 0.4, wood, plank, 1.8, 4.4);
  }

  // --- tategaki wall: oar notches and gun slits ---
  const oarXs = anchors.oarPorts.filter((p) => p.side === 0).map((p) => p.pos[0]);
  const ports = [
    ...oarXs.map((x) => ({ x, w: 0.5, y0: deck + 0.12, y1: deck + 0.72 })),
    ...oarXs.slice(0, -1).map((x, i) => ({ x: (x + oarXs[i + 1]!) / 2, w: 0.2, y0: deck + 0.82, y1: deck + 1.12 })),
  ].sort((a, c) => a.x - c.x);
  const crest = P('shield_crest', { rect: [0.02, 0.02, 0.98, 0.98] });
  for (const side of [-1, 1] as const) {
    wallRun(ctx, side, -L / 2 + 0.3, L / 2 - 0.3, deck, top, outer, 0.18, ports, lacquer, plank);
    const n = byLod(ctx, 20, 9, 5);
    const path: V3[] = [];
    for (let i = 0; i <= n; i += 1) {
      const x = -L / 2 + 0.3 + ((L - 0.6) * i) / n;
      path.push([x, top(x) + 0.07, side * (outer(x) - 0.09)]);
    }
    sweep(b, iron, path, rectSection(0.3, 0.14));
    if (lod < 2) {
      oarXs.slice(0, -1).forEach((x, i) => {
        if (i % 2) return;
        const xc = x + (oarXs[i + 1]! - x) * 0.25;
        const z = side * (outer(xc) + 0.012);
        b.quadF(crest, [[xc - 0.5, deck + 0.2, z], [xc + 0.5, deck + 0.2, z], [xc + 0.5, deck + 0.2 + 0.9, z], [xc - 0.5, deck + 0.2 + 0.9, z]], [0, 0, side], [[0, 0], [1, 0], [1, 1], [0, 1]]);
      });
    }
  }
  for (const sgn of [-1, 1]) {
    const xe = (sgn * L) / 2;
    const zE = sideZ(h, xe, h.deck);
    const t = top(xe);
    box(b, lacquer, [sgn > 0 ? xe - 0.2 : xe, deck, -zE], [sgn > 0 ? xe : xe + 0.2, t, zE], { grain: 1 });
  }
  if (lod < 2) {
    box(b, plank, [-L / 2 - 0.5, -1.3, -0.15], [-L / 2 - 0.05, 0.9, 0.15], { grain: 1 });
    // bow beak
    const xb = L / 2;
    sweep(b, lacquer, [[xb - 0.3, hullTop(h, xb) - 0.2, 0], [xb + 0.45, hullTop(h, xb) + 0.15, 0], [xb + 0.55, hullTop(h, xb) + 0.55, 0]], rectSection(0.24, 0.3), { caps: true });
  }

  // --- cabin aft ---
  const c = plan.cabin;
  plasterTier(ctx, { cx: c.x, hx: c.hx, hz: c.hz, y0: deck, y1: deck + c.h, base: 0.4, bay: 1.8, loop: [0.2, 0.2], window: true }, { plaster: P('plaster'), lacquer, frame: lacquer, dark });
  if (variant === 0) {
    const roof = irimoyaRoof(ctx, { tile: P('kawara'), trim: lacquer, cap: lacquer }, P('plaster'), { cx: c.x, hx: c.hx + 0.9, hz: c.hz + 0.9, wx: c.hx - 0.5, wz: c.hz - 0.45, y: deck + c.h - 0.04, skirt: 0.55, hafu: 0.4, gable: 0.95, lift: 0.35 });
    for (const sx of [-1, 1] as const) shachihoko(ctx, gold, [c.x + sx * roof.ridgeX, roof.ridgeY + 0.15, 0], sx, 0.5);
  } else {
    b.with(xlate(c.x, 0, 0), () => hipRoof(b, P('shingle', { tint: [0.7, 0.66, 0.62] }), lacquer, lacquer, { hx: c.hx + 0.8, hz: c.hz + 0.8, ridge: 0.5, y: deck + c.h - 0.04, rise: 1.0, lift: 0.3, concave: 1.5, nSlope: byLod(ctx, 4, 2, 1), nEave: byLod(ctx, 10, 5, 2), fascia: 0.26 }));
    if (lod < 2) spike(b, gold, [c.x, deck + c.h + 1.0, 0], [0, 1, 0], 0.07, 0.8, 5);
  }

  // --- mast, sail, banners ---
  const m = plan.mast;
  mast(ctx, wood, iron, m.x, deck, m.h, m.r);
  if (lod < 2) box(b, plank, [m.x - 0.4, deck, -0.4], [m.x + 0.4, deck + 0.35, 0.4], { grain: 0 });
  sail(ctx, variant === 0 ? P('sail_cloth', { tint: [1.0, 0.95, 0.85] }) : P('matting', { tint: [0.95, 0.85, 0.7] }), wood, rope, { x: m.x, yTop: deck + m.h - 1.0, w: m.sailW, h: m.sailH, billow: 0.55, battens: 6, phase: 0.9 });
  if (lod < 2) longPennant(ctx, clothPatch(ctx, 'nobori_a', 'red'), [m.x - 0.05, deck + m.h - 0.1, 0], 3.4, 0.5, 0.7);
  for (const f of anchors.flagMounts) if (f.kind === 'nobori') nobori(ctx, f.pos, f.size[1] + 0.8, f.size[0], f.size[1], f.id.slice(7), f.pos[0] + f.pos[2], wood);

  // --- fittings ---
  [[-8.6, 1.3], [-8.4, -1.2]].forEach(([x, z]) => barrel(ctx, P('hull_plank', { tint: [0.75, 0.65, 0.55] }), iron, [x!, deck, z!], 0.34, 0.7));
  ropeCoil(ctx, rope, [8.6, deck + 0.5, 0.6], 0.4);
  for (const side of [-1, 1]) anchorProp(ctx, wood, iron, [8.6, deck + 0.1, side * (outer(8.6) + 0.35)]);
  for (const l of anchors.lanterns) lantern(ctx, P('sail_cloth', { tint: [1.35, 1.2, 0.95] }), lacquer, l, 0.2);
  return b.data();
}
