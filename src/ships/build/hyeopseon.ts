/**
 * Hyeopseon (挾船): the small Joseon escort and scout boat: open hull with an inner liner, thwarts, low shield-board
 * bulwark, four oars a side, one battened sail, a small gun a side and a tarp canopy aft.
 */
import { anchorsFor, HYEOP_PLAN, hullTop, sideZ } from '../anchors';
import { box, cylinder, hipRoof, MeshBuilder, paints, xlate, type MeshData } from './parts';
import { cannon, clothPatch, deckPlane, flag, innerLiner, loftHull, longPennant, mast, mulberry32, oar, oarPortFrame, post, sail, sideTimber, wallRun, type Ctx, type Lod } from './common';

export function buildHyeopseon(lod: Lod): MeshData {
  const plan = HYEOP_PLAN;
  const anchors = anchorsFor('hyeopseon#0')!;
  const b = new MeshBuilder();
  const ctx: Ctx = { b, lod, faction: 'joseon', P: paints('joseon'), rnd: mulberry32(901) };
  const { P } = ctx;
  const h = plan.hull;
  const L = h.length;
  const deck = h.deck;
  const timber = P('dark_timber');
  const stain = P('stained_wood');
  const hullPaint = P('hull_plank', { tint: [0.95, 0.9, 0.82] });
  const floorY = 0.55;
  const rope = P('rope');

  loftHull(ctx, h, hullPaint, hullPaint);
  innerLiner(ctx, h, P('deck_plank', { tint: [0.8, 0.76, 0.7] }), 0.14, floorY);
  deckPlane(ctx, h, P('deck_plank'), -L / 2 + 0.6, L / 2 - 0.9, floorY, 0.2);
  // gunwale cap closes the gap between skin and liner
  sideTimber(ctx, h, stain, -L / 2 + 0.2, L / 2 - 0.2, deck - 0.02, 0.3, 0.14, 0.0);
  if (lod === 0) sideTimber(ctx, h, timber.tinted([0.9, 0.85, 0.8]), -L / 2 + 0.4, L / 2 - 0.4, 0.5, 0.1, 0.22, 0.05);

  // low bulwark of painted shield boards with a gun port a side
  const shield = P('shield_cloud', { rect: [0.02, 0.02, 0.98, 0.98] });
  const gunX = anchors.gunPorts[0]?.pos[0] ?? 2.6;
  const topFn = (x: number) => deck + 0.62 + 0.25 * Math.pow(Math.abs((2 * x) / L), 2.5);
  const outer = (x: number) => sideZ(h, x, hullTop(h, x)) + 0.02;
  if (lod < 2) {
    for (const side of [-1, 1] as const) {
      wallRun(ctx, side, -2.2, 4.6, deck, topFn, outer, 0.12, [{ x: gunX, w: 0.5, y0: deck + 0.2, y1: deck + 0.52 }], timber, timber.tinted([0.8, 0.78, 0.74]));
      if (lod === 0) {
        for (const x of [-1.4, 0.7, 4.0]) {
          const z = side * (outer(x) + 0.012);
          b.quadF(shield, [[x - 0.5, deck + 0.05, z], [x + 0.5, deck + 0.05, z], [x + 0.5, deck + 0.6, z], [x - 0.5, deck + 0.6, z]], [0, 0, side], [[0, 0], [1, 0], [1, 1], [0, 1]]);
        }
        cannon(ctx, [gunX, deck + 0.36, side * (outer(gunX) + 0.02)], [0, 0, side], 'seungja', timber, P('bronze', { tint: [1.25, 0.95, 0.7] }), P('iron_hex', { surf: 2 }));
      }
    }
    // bow and stern boards
    box(b, timber, [L / 2 - 1.6, deck - 0.2, -0.9], [L / 2 - 1.45, deck + 0.7, 0.9], { grain: 1 });
  }
  if (lod < 2) {
    b.quadF(P('shield_tiger', { rect: [0.02, 0.02, 0.98, 0.98] }), [[L / 2 + 0.02, 0.7, -0.5], [L / 2 + 0.02, 0.7, 0.5], [L / 2 + 0.02, 1.5, 0.5], [L / 2 + 0.02, 1.5, -0.5]], [1, 0, 0], [[0, 0], [1, 0], [1, 1], [0, 1]]);
  }

  // thwarts
  if (lod < 2) {
    for (const x of plan.oars.n ? [-3.0, -1.0, 1.0, 3.0] : []) {
      const z = sideZ(h, x, floorY + 0.6) - 0.2;
      box(b, P('deck_plank'), [x - 0.18, floorY + 0.5, -z], [x + 0.18, floorY + 0.62, z], { grain: 2 });
    }
  }

  // oars
  for (const op of anchors.oarPorts) {
    const side = op.side === 0 ? -1 : 1;
    if (lod < 2) {
      post(ctx, timber, op.pos[0], deck - 0.1, deck + 0.3, side * (sideZ(h, op.pos[0], deck) + 0.04), 0.08);
      oarPortFrame(ctx, [op.pos[0], deck - 0.35, op.pos[2]], side, P('dark_timber', { tint: [0.14, 0.13, 0.12] }));
    }
    oar(ctx, [op.pos[0], deck + 0.28, op.pos[2]], side, 0.42, P('pine_mast', { tint: [0.9, 0.85, 0.8] }), hullPaint, 1.5, 3.3);
  }

  // mast and sail
  const m = plan.mast;
  mast(ctx, P('pine_mast', { tint: [0.9, 0.85, 0.8] }), timber, m.x, floorY + 0.4, m.h + deck - floorY - 0.4, m.r);
  if (lod < 2) box(b, timber, [m.x - 0.35, floorY, -0.35], [m.x + 0.35, floorY + 0.6, 0.35], { grain: 0 });
  sail(ctx, P('sail_hemp'), P('pine_mast', { tint: [0.9, 0.85, 0.8] }), rope, { x: m.x, yTop: deck + m.h - 0.4, w: m.sailW, h: m.sailH, billow: 0.45, battens: 5, phase: 0.4 });
  if (lod < 2) {
    flag(ctx, { pole: [m.x, deck + m.h + 0.4, 0], poleH: 0.6, w: 0.9, h: 0.75, sheet: 'flags_b', flag: 'blue', phase: 0.5, wood: timber });
    longPennant(ctx, clothPatch(ctx, 'flags_a', 'red'), [m.x - 0.05, deck + m.h - 0.1, 0], 3.2, 0.4, 1.0);
  }

  // canopy aft: four posts and a tarp roof
  const cx = -L / 2 + 2.3;
  if (lod < 2) {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) post(ctx, timber, cx + sx * 0.9, floorY, deck + 1.3, sz * 0.85, 0.1);
    b.with(xlate(cx, 0, 0), () => hipRoof(b, P('sail_hemp', { tint: [0.85, 0.75, 0.62] }), stain, timber, { hx: 1.4, hz: 1.3, ridge: 0.2, y: deck + 1.3, rise: 0.55, lift: 0.1, concave: 1.2, nSlope: 2, nEave: 4, fascia: 0.12 }));
  }
  // rudder
  if (lod < 2) {
    box(b, timber, [-L / 2 - 0.35, -0.9, -0.1], [-L / 2 - 0.02, 0.7, 0.1], { grain: 1 });
    cylinder(b, timber, [-L / 2 - 0.2, 0.7, 0], [-L / 2 + 0.7, deck + 0.7, 0], 0.05, 0.05, 5, true);
  }
  return b.data();
}
