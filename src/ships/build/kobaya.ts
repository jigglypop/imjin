/**
 * Kobaya (小早): the small, fast Japanese boat. An open hull with a steeply rising bow, a low wall of crested shield
 * boards, four oars a side and two nobori on tall poles.
 */
import { anchorsFor, hullTop, KOBAYA_PLAN, sideZ } from '../anchors';
import { box, cylinder, MeshBuilder, paints, rectSection, sweep, type MeshData, type V3 } from './parts';
import { deckPlane, innerLiner, lantern, lanternPole, loftHull, mulberry32, oar, post, sideTimber, wallRun, type Ctx, type Lod } from './common';
import { nobori } from './japan';

export function buildKobaya(lod: Lod): MeshData {
  const plan = KOBAYA_PLAN;
  const anchors = anchorsFor('kobaya#0')!;
  const b = new MeshBuilder();
  const ctx: Ctx = { b, lod, faction: 'japan', P: paints('japan'), rnd: mulberry32(910) };
  const { P } = ctx;
  const h = plan.hull;
  const L = h.length;
  const deck = h.deck;
  const lacquer = P('black_lacquer');
  const plank = P('hull_plank', { tint: [0.78, 0.7, 0.62] });
  const wood = P('hull_plank', { tint: [0.9, 0.82, 0.72] });
  const dark = P('black_lacquer', { tint: [0.16, 0.16, 0.16] });
  const iron = P('iron', { tint: [0.85, 0.8, 0.78] });
  const floorY = 0.45;
  const tops = (x: number) => hullTop(h, x);

  loftHull(ctx, h, plank, plank);
  innerLiner(ctx, h, P('deck_plank', { tint: [0.78, 0.74, 0.68] }), 0.1, floorY);
  deckPlane(ctx, h, P('deck_plank'), -L / 2 + 0.6, L / 2 - 0.9, floorY, 0.2);
  sideTimber(ctx, h, lacquer, -L / 2 + 0.2, L / 2 - 0.2, 0, 0.26, 0.14, 0.0, (x) => tops(x) - 0.02);
  if (lod === 0) sideTimber(ctx, h, plank, -L / 2 + 0.4, L / 2 - 0.4, 0.45, 0.1, 0.2, 0.04);

  // low wall of shield boards with a notch for every oar
  const oarXs = anchors.oarPorts.filter((p) => p.side === 0).map((p) => p.pos[0]);
  const topFn = (x: number) => tops(x) + 0.7;
  const outer = (x: number) => sideZ(h, x, tops(x)) + 0.02;
  const crest = P('shield_crest', { rect: [0.02, 0.02, 0.98, 0.98] });
  if (lod < 2) {
    for (const side of [-1, 1] as const) {
      wallRun(ctx, side, -4.4, 5.4, deck, topFn, outer, 0.1, oarXs.map((x) => ({ x, w: 0.34, y0: deck + 0.1, y1: deck + 0.42 })), lacquer, dark);
      if (lod === 0) {
        oarXs.slice(0, -1).forEach((x, i) => {
          const xc = (x + oarXs[i + 1]!) / 2;
          const z = side * (outer(xc) + 0.012);
          b.quadF(crest, [[xc - 0.42, deck + 0.12, z], [xc + 0.42, deck + 0.12, z], [xc + 0.42, deck + 0.64, z], [xc - 0.42, deck + 0.64, z]], [0, 0, side], [[0, 0], [1, 0], [1, 1], [0, 1]]);
        });
        const n = 10;
        const path: V3[] = [];
        for (let i = 0; i <= n; i += 1) {
          const x = -4.4 + (9.8 * i) / n;
          path.push([x, topFn(x) + 0.05, side * (outer(x) - 0.05)]);
        }
        sweep(b, iron, path, rectSection(0.2, 0.1));
      }
    }
  }
  // stem, stern post and a crested board on the bow
  if (lod < 2) {
    const xb = L / 2;
    sweep(b, lacquer, [[xb - 0.5, tops(xb - 0.5), 0], [xb + 0.15, tops(xb) + 0.1, 0], [xb + 0.3, tops(xb) + 0.55, 0]], rectSection(0.16, 0.2), { caps: true });
    b.quadF(crest, [[xb - 0.02, tops(xb) - 0.7, -0.35], [xb - 0.02, tops(xb) - 0.7, 0.35], [xb - 0.02, tops(xb) - 0.05, 0.35], [xb - 0.02, tops(xb) - 0.05, -0.35]], [1, 0, 0], [[0, 0], [1, 0], [1, 1], [0, 1]]);
    box(b, plank, [-L / 2 - 0.35, -0.8, -0.1], [-L / 2 - 0.02, 0.7, 0.1], { grain: 1 });
    cylinder(b, wood, [-L / 2 - 0.2, 0.7, 0], [-L / 2 + 0.7, deck + 0.6, 0], 0.05, 0.05, 5, true);
  }
  // thwarts
  if (lod < 2) {
    for (const x of oarXs) {
      const z = sideZ(h, x, floorY + 0.6) - 0.15;
      box(b, P('deck_plank'), [x - 0.16, floorY + 0.42, -z], [x + 0.16, floorY + 0.52, z], { grain: 2 });
    }
  }
  // oars on tholes
  for (const op of anchors.oarPorts) {
    const side = op.side === 0 ? -1 : 1;
    if (lod < 2) post(ctx, wood, op.pos[0] + 0.0, deck - 0.1, deck + 0.35, side * (sideZ(h, op.pos[0], deck) + 0.04), 0.07);
    oar(ctx, [op.pos[0], deck + 0.28, op.pos[2]], side, 0.4, wood, plank, 1.4, 3.1);
  }
  // nobori poles stepped into the floor
  for (const f of anchors.flagMounts) {
    if (f.kind !== 'nobori') continue;
    nobori(ctx, [f.pos[0], floorY, f.pos[2]], f.size[1] + 2.1, f.size[0], f.size[1], f.id.slice(7), f.pos[0] * 0.8, wood);
    if (lod < 2) box(b, plank, [f.pos[0] - 0.22, floorY, -0.22], [f.pos[0] + 0.22, floorY + 0.3, 0.22], { grain: 1 });
  }
  for (const l of anchors.lanterns) {
    lantern(ctx, P('sail_cloth', { tint: [1.35, 1.2, 0.95] }), lacquer, l, 0.2);
    lanternPole(ctx, lacquer, l, deck - 0.1, 0, 0.4);
  }
  return b.data();
}
