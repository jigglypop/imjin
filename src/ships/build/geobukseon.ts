/**
 * Geobukseon (turtle ship): dark-stained hull with gun ports all round, an arched roof of dark hexagonal iron
 * plates studded with spikes, a dragon head at the bow that can belch smoke (anchors.smokeStack), a stern tail,
 * oars under the eaves and one raised mast. Larger than the panokseon on purpose.
 */
import { anchorsFor, GEOBUK_PLAN, geobukRoofSpan, geobukRoofY, hullTop, sideZ } from '../anchors';
import {
  box,
  cylinder,
  grid,
  lathe,
  lerp,
  MeshBuilder,
  paints,
  pennant,
  polygon,
  rectSection,
  spike,
  sweep,
  tube,
  xlate,
  rotX,
  type MeshData,
  type V2,
  type V3,
  type TubeStation,
} from './parts';
import { barrel, byLod, cannon, clothPatch, flag, furledSail, hullBand, lantern, lanternPole, loftHull, mast, mulberry32, oar, oarPortFrame, ropeCoil, sideTimber, type Ctx, type Lod } from './common';

export function buildGeobukseon(lod: Lod): MeshData {
  const plan = GEOBUK_PLAN;
  const anchors = anchorsFor('geobukseon#0')!;
  const b = new MeshBuilder();
  const ctx: Ctx = { b, lod, faction: 'joseon', P: paints('joseon'), rnd: mulberry32(4242) };
  const { P } = ctx;
  const h = plan.hull;
  const L = h.length;
  const stain = P('stained_wood');
  const timber = P('dark_timber');
  const dark = P('dark_timber', { tint: [0.14, 0.13, 0.12] });
  const hexIron = P('iron_hex', { size: 1.9, tint: [1.3, 1.3, 1.35] });
  const strap = P('iron_hex', { surf: 2, tint: [1.0, 0.95, 0.9] });
  const top = (x: number) => hullTop(h, x);

  // --- hull: tarred planks below, dark-stained topsides above ---
  loftHull(ctx, h, P('hull_plank', { tint: [0.62, 0.58, 0.55] }), P('stained_wood'));
  hullBand(ctx, h, stain, -L / 2 + 0.05, L / 2 - 0.05, 0.45, (x) => top(x) - 0.02, 0.09);
  if (lod < 2) {
    hullBand(ctx, h, P('dancheong'), -L / 2 + 0.6, L / 2 - 2.0, (x) => top(x) - 0.62, (x) => top(x) - 0.08, 0.12);
  }
  if (lod === 0) {
    sideTimber(ctx, h, strap, -L / 2 + 0.6, L / 2 - 1.6, 0.45, 0.14, 0.3, 0.07);
    sideTimber(ctx, h, timber, -L / 2 + 0.6, L / 2 - 1.6, 2.15, 0.12, 0.22, 0.06);
    // vertical ribs between the guns
    for (let x = -L / 2 + 3; x < L / 2 - 4; x += 3.45) {
      for (const sgn of [-1, 1]) {
        box(b, timber, [x - 0.1, 0.5, sgn * (sideZ(h, x, 2.5) + 0.04) - 0.09], [x + 0.1, top(x) - 0.65, sgn * (sideZ(h, x, 2.5) + 0.04) + 0.09], { grain: 1 });
        // iron straps and bolts where each rib meets the wales
        for (const y of [0.75, 2.15, top(x) - 0.85]) {
          const zz = sgn * (sideZ(h, x, y) + 0.1);
          box(b, strap, [x - 0.22, y - 0.12, zz - 0.06], [x + 0.22, y + 0.12, zz + 0.06], { grain: 0 });
          cylinder(b, strap, [x, y, zz + sgn * 0.05], [x, y, zz + sgn * 0.12], 0.07, 0.05, 5, true);
        }
      }
    }
  }

  // --- gun ports all round, oars below ---
  for (const g of anchors.gunPorts) {
    if (g.side === 2) continue;
    const side = g.side === 0 ? -1 : 1;
    const x = g.pos[0];
    const zo = side * (sideZ(h, x, g.pos[1]) + 0.05);
    if (lod < 2) {
      b.quadF(dark, [[x - 0.45, g.pos[1] - 0.45, zo], [x + 0.45, g.pos[1] - 0.45, zo], [x + 0.45, g.pos[1] + 0.45, zo], [x - 0.45, g.pos[1] + 0.45, zo]], [0, 0, side]);
    }
    if (lod === 0) {
      for (const dx of [-0.55, 0.55]) box(b, strap, [x + dx - 0.07, g.pos[1] - 0.62, zo - 0.1], [x + dx + 0.07, g.pos[1] + 0.62, zo + 0.1], { grain: 1 });
      box(b, strap, [x - 0.62, g.pos[1] + 0.45, zo - 0.1], [x + 0.62, g.pos[1] + 0.62, zo + 0.1], { grain: 0 });
      box(b, strap, [x - 0.62, g.pos[1] - 0.62, zo - 0.1], [x + 0.62, g.pos[1] - 0.45, zo + 0.1], { grain: 0 });
      // rivet heads along the iron frame
      for (const [dx, dy] of [[-0.55, -0.5], [-0.55, 0], [-0.55, 0.5], [0.55, -0.5], [0.55, 0], [0.55, 0.5], [-0.25, 0.54], [0.25, 0.54], [-0.25, -0.54], [0.25, -0.54]] as [number, number][]) {
        cylinder(b, strap, [x + dx, g.pos[1] + dy, zo + side * 0.1], [x + dx, g.pos[1] + dy, zo + side * 0.18], 0.06, 0.04, 5, true);
      }
      // hinged lid propped open above the port
      b.with(xlate(x, g.pos[1] + 0.62, zo), () => {
        b.with(rotX(-0.9 * side), () => box(b, stain, [-0.62, -0.035, Math.min(0, side * 0.9)], [0.62, 0.035, Math.max(0, side * 0.9)]));
      });
    }
    if (lod < 2) cannon(ctx, [x, g.pos[1], zo], [0, 0, side], g.gun, timber, P('bronze', { tint: [1.25, 0.95, 0.7] }), P('iron_hex', { surf: 2 }));
  }
  // extra ports at the quarters and across the stern: the ship answers from every side
  for (const [x, side] of [-L / 2 + 3.5, L / 2 - 6.2].flatMap((px) => [[px, -1] as const, [px, 1] as const])) {
    const y = 3.0;
    const zo = side * (sideZ(h, x, y) + 0.05);
    if (lod < 2) b.quadF(dark, [[x - 0.4, y - 0.4, zo], [x + 0.4, y - 0.4, zo], [x + 0.4, y + 0.4, zo], [x - 0.4, y + 0.4, zo]], [0, 0, side]);
    if (lod < 2) cannon(ctx, [x, y, zo], [0, 0, side], 'hwangja', timber, P('bronze', { tint: [1.25, 0.95, 0.7] }), P('iron_hex', { surf: 2 }));
  }
  for (const z of [-1.7, 0, 1.7]) {
    const x = -L / 2 - 0.02;
    if (lod < 2) b.quadF(dark, [[x, 2.6, z - 0.4], [x, 2.6, z + 0.4], [x, 3.4, z + 0.4], [x, 3.4, z - 0.4]], [-1, 0, 0]);
    if (lod < 2) cannon(ctx, [x, 3.0, z], [-1, 0, 0], 'hwangja', timber, P('bronze', { tint: [1.25, 0.95, 0.7] }), P('iron_hex', { surf: 2 }));
  }
  for (const op of anchors.oarPorts) {
    const side = op.side === 0 ? -1 : 1;
    oarPortFrame(ctx, op.pos, side, dark);
    oar(ctx, op.pos, side, 0.55, P('pine_mast', { tint: [0.9, 0.85, 0.8] }), P('hull_plank'), 2.2, 5.2);
  }

  // --- the iron roof: the shell covers the whole deck, bow to stern; the dragon's neck comes out from under its front ---
  const [xs0, xs1] = geobukRoofSpan(plan);
  const span = xs1 - xs0;
  const nx = byLod(ctx, 30, 14, 7);
  const nz = byLod(ctx, 20, 10, 6);
  const eaveW = (x: number) => sideZ(h, x, top(x)) + plan.overhang;
  const roofY = (x: number, z: number) => geobukRoofY(plan, x, z);
  /** Clear of the dragon's neck where it runs under the front of the roof. */
  const clearOfNeck = (x: number, z: number) => x < plan.head.baseX - 1.2 || Math.abs(z) > 1.25;
  const rows: V3[][] = [];
  for (let i = 0; i <= nx; i += 1) {
    const x = lerp(xs0, xs1, i / nx);
    const w = eaveW(x);
    const row: V3[] = [];
    for (let j = 0; j <= nz; j += 1) {
      const z = lerp(-w, w, j / nz);
      row.push([x, roofY(x, z), z]);
    }
    rows.push(row);
  }
  grid(b, hexIron, rows, { flip: true, uvFn: (i, j) => hexIron.map(((i / nx) * span) * 1, (j / nz) * 2 * eaveW(xs0 + span * 0.5) * 1.15) });
  // eave beam, overhang underside and end plates
  const eave: V3[][] = [];
  for (let i = 0; i <= nx; i += 1) {
    const x = lerp(xs0, xs1, i / nx);
    eave.push([[x, top(x) - 0.12, -eaveW(x)], [x, top(x) - 0.12, eaveW(x)]]);
  }
  grid(b, dark, eave); // soffit
  for (const sgn of [-1, 1]) {
    const path: V3[] = [];
    for (let i = 0; i <= byLod(ctx, 20, 8, 4); i += 1) {
      const x = lerp(xs0, xs1, i / byLod(ctx, 20, 8, 4));
      path.push([x, top(x) + 0.02, sgn * (eaveW(x) - 0.04)]);
    }
    sweep(b, timber, path, rectSection(0.32, 0.3));
  }
  // the end plates face the low sun head-on, so they are darker than the roof to read as the same iron
  const endIron = P('iron_hex', { size: 1.9, tint: [0.7, 0.7, 0.74] });
  for (const [x, facing] of [[xs0, -1], [xs1, 1]] as [number, number][]) {
    const w = eaveW(x);
    const ring: V3[] = [];
    for (let j = 0; j <= 8; j += 1) {
      const z = lerp(-w, w, j / 8);
      ring.push([x, roofY(x, z), z]);
    }
    polygon(b, endIron, [[x, top(x) - 0.1, -w], ...ring, [x, top(x) - 0.1, w]], [facing, 0, 0], (p) => endIron.map(p[2], p[1]));
  }
  // raised ribs across the plating and a spine beam along the ridge
  if (lod < 2) {
    const ribStep = byLod(ctx, 2.8, 5.6, 99);
    for (let x = xs0 + 2.2; x < plan.head.baseX - 0.6; x += ribStep) {
      const w = eaveW(x);
      const path: V3[] = [];
      const n = byLod(ctx, 22, 8, 4);
      for (let j = 0; j <= n; j += 1) {
        const z = lerp(-w, w, j / n);
        path.push([x, roofY(x, z) + 0.05, z]);
      }
      sweep(b, dark, path, rectSection(0.2, 0.17), { up: [1, 0, 0] });
    }
    if (lod === 0) {
      // lengthwise plate seams between the spike rows
      for (const t of [-0.85, -0.6, -0.3, 0.3, 0.6, 0.85]) {
        const seam: V3[] = [];
        for (let i = 0; i <= 28; i += 1) {
          const x = lerp(xs0 + 0.8, xs1 - 0.6, i / 28);
          seam.push([x, roofY(x, t * eaveW(x)) + 0.035, t * eaveW(x)]);
        }
        sweep(b, dark, seam, rectSection(0.1, 0.07));
      }
    }
    const spine: V3[] = [];
    for (let i = 0; i <= byLod(ctx, 30, 10, 4); i += 1) {
      const x = lerp(xs0 + 0.5, plan.head.baseX - 1.0, i / byLod(ctx, 30, 10, 4));
      spine.push([x, roofY(x, 0) + 0.06, 0]);
    }
    sweep(b, timber, spine, rectSection(0.34, 0.2));
  }
  // spikes: rows along the roof, pointing out of the shell
  if (lod === 1) {
    const iron = P('iron_hex', { surf: 2, tint: [0.75, 0.75, 0.8] });
    for (const t of [-0.8, -0.4, 0.4, 0.8]) {
      for (let x = xs0 + 1.5; x < xs1 - 0.8; x += 2.8) if (clearOfNeck(x, t * eaveW(x))) spike(b, iron, [x, roofY(x, t * eaveW(x)), t * eaveW(x)], [0, 1, 0], 0.15, 0.85, 3);
    }
  }
  if (lod === 0) {
    const iron = P('iron_hex', { surf: 2, tint: [0.75, 0.75, 0.8] });
    const rowsT = [-0.93, -0.74, -0.55, -0.37, -0.18, 0, 0.18, 0.37, 0.55, 0.74, 0.93];
    for (const t of rowsT) {
      for (let x = xs0 + 1.3; x < xs1 - 0.8; x += 1.4) {
        const z = t * eaveW(x);
        if (!clearOfNeck(x, z)) continue;
        const y = roofY(x, z);
        const dz = (roofY(x, z + 0.1) - roofY(x, z - 0.1)) / 0.2;
        const dx = (roofY(x + 0.1, z) - roofY(x - 0.1, z)) / 0.2;
        spike(b, iron, [x, y - 0.02, z], [-dx, 1, -dz], 0.12, 0.9, 4);
      }
    }
  }
  // bracket dentils under the eave and a fringe of small spikes along its edge
  if (lod === 0) {
    const iron = P('iron_hex', { surf: 2, tint: [0.7, 0.7, 0.75] });
    for (let x = xs0 + 0.4; x < xs1 - 0.3; x += 0.85) {
      for (const sgn of [-1, 1]) {
        const w = eaveW(x);
        box(b, timber, [x - 0.14, top(x) - 0.55, sgn * (w - 0.38) - 0.16], [x + 0.14, top(x) - 0.12, sgn * (w - 0.38) + 0.16], { grain: 1 });
        spike(b, iron, [x + 0.42, top(x) + 0.28, sgn * (w - 0.1)], [0, 1, sgn * 0.8], 0.08, 0.5, 4);
      }
    }
  }
  // roof ridge hatch frame
  if (lod < 2) {
    for (const sx of [-5.5, 6.0]) box(b, timber, [sx - 1.0, roofY(sx, 0) - 0.05, -0.7], [sx + 1.0, roofY(sx, 0) + 0.18, 0.7], { grain: 0 });
  }

  // a heavy cap timber across the bow, between the front of the roof and the bow planking
  {
    const w = sideZ(h, L / 2 - 0.2, top(L / 2)) + 0.12;
    box(b, timber, [xs1 - 0.1, top(L / 2) - 0.12, -w], [L / 2 + 0.1, top(L / 2) + 0.16, w], { grain: 0 });
  }

  // --- dragon head ---
  dragonHead(ctx, plan.head);

  // --- stern: tail and rudder ---
  if (lod < 2) {
    const sx = -L / 2;
    const tail: TubeStation[] = [
      { p: [sx + 0.9, 3.4, 0], a: 0.5, b: 0.5 },
      { p: [sx - 0.1, 4.0, 0], a: 0.4, b: 0.4 },
      { p: [sx - 0.5, 4.9, 0], a: 0.26, b: 0.26 },
      { p: [sx - 0.3, 5.6, 0], a: 0.1, b: 0.1 },
    ];
    tube(b, P('dragon_scale', { tint: [0.9, 0.8, 0.6] }), tail, byLod(ctx, 8, 6, 5), { capStart: false, capEnd: true });
    box(b, timber, [sx - 0.55, -2.2, -0.2], [sx - 0.05, 1.3, 0.2], { grain: 1 });
  }

  // --- the one raised mast, a lowered one, flags ---
  const roofAt = (x: number) => roofY(x, 0);
  const m1 = -4.5;
  mast(ctx, P('pine_mast', { tint: [0.9, 0.85, 0.8] }), timber, m1, roofAt(m1), 9.15 - roofAt(m1), 0.22);
  if (lod < 2) {
    furledSail(ctx, P('sail_hemp'), P('pine_mast', { tint: [0.9, 0.85, 0.8] }), P('rope'), { x: m1, yTop: 8.95, w: 3.4, h: 3, billow: 0, battens: 0, phase: 0 });
    flag(ctx, { pole: [m1, 9.1, 0], poleH: 1.0, w: 1.6, h: 1.3, sheet: 'flags_a', flag: 'tiger', phase: 1.1, wood: timber });
  }
  if (lod < 2) {
    // second mast lowered along the roof
    cylinder(b, P('pine_mast', { tint: [0.9, 0.85, 0.8] }), [8.8, roofAt(8.8) + 0.3, 0.9], [2.4, roofAt(2.4) + 0.3, 0.9], 0.2, 0.15, 7, true);
    for (const x of [8.2, 4.5]) box(b, timber, [x - 0.2, roofAt(x) + 0.0, 0.55], [x + 0.2, roofAt(x) + 0.3, 1.25]);
    if (lod === 0) {
      pennant(b, clothPatch(ctx, 'flags_a', 'red'), [m1 - 0.1, 8.7, 0], [-1, -0.05, 0], [0, -1, 0], 4.5, 0.55, 0.06, 8, { flutter: 1.2, phase: 0.8 });
      barrel(ctx, P('hull_plank', { tint: [0.8, 0.7, 0.6] }), P('iron_hex', { surf: 2 }), [-9.5, roofAt(-9.5) + 0.02, 1.8], 0.38, 0.8);
      ropeCoil(ctx, P('rope'), [3.0, roofAt(3.0) + 0.05, -1.4], 0.55);
    }
  }
  // lanterns on poles standing in the roof's spikes, one over the stern and one before the ridge hatch
  const lampPaint = P('sail_hemp', { tint: [1.35, 1.15, 0.85] });
  anchors.lanterns.forEach((l, i) => {
    lantern(ctx, lampPaint, timber, l);
    lanternPole(ctx, timber, l, roofAt(l[0]) - 0.1, i ? 0.5 : -0.5, 0);
  });
  void xlate;
  void lathe;
  return b.data();
}

/**
 * Dragon head, carved in dark wood and sheathed in old bronze. The neck starts under the front of the roof at `base`
 * and rises forward past the bow; the head looks ahead with its jaws open around the bow gun, so the smoke and the shot
 * come out of the mouth. One pair of horns swept back, a short mane, heavy brows over glowing eyes, two pairs of fangs.
 * Built in metres around the neck base (x forward, y up).
 */
function dragonHead(ctx: Ctx, head: { baseX: number; baseY: number; mouthX: number; mouthY: number }) {
  const { b, lod, P } = ctx;
  const skin = P('dragon_scale', { surf: 2, tint: [3.3, 2.6, 1.85] });
  const bronze = P('bronze', { tint: [0.85, 0.72, 0.55] });
  const mouthIn = P('dark_timber', { tint: [0.16, 0.11, 0.09] });
  const throat = P('stained_wood', { surf: 5, tint: [0.03, 0.012, 0.008] });
  const eye = P('stained_wood', { surf: 5, tint: [0.05, 0.02, 0.007] });
  const fang = P('iron_hex', { surf: 2, tint: [1.7, 1.6, 1.45] });
  const seg = byLod(ctx, 14, 9, 6);
  const S = (p: V3, a: number, c: number): TubeStation => ({ p, a, b: c });
  const bx = head.baseX;
  const by = head.baseY;
  b.with(xlate(bx, by, 0), () => {
    // neck: out from under the roof, rising forward
    tube(b, skin, [S([-1.2, -0.25, 0], 0.9, 0.9), S([0.4, 0.15, 0], 0.86, 0.86), S([1.6, 0.6, 0], 0.8, 0.82), S([2.6, 1.0, 0], 0.77, 0.8)], seg);
    // skull and upper jaw: a broad brow tapering to a blunt snout that lifts a little at the tip
    tube(
      b,
      skin,
      [S([2.5, 1.0, 0], 0.8, 0.86), S([3.2, 1.15, 0], 0.84, 0.82), S([3.9, 1.12, 0], 0.72, 0.62), S([4.6, 1.0, 0], 0.56, 0.46), S([5.2, 0.95, 0], 0.46, 0.36), S([5.55, 0.97, 0], 0.38, 0.3), S([5.72, 0.98, 0], 0.22, 0.18), S([5.78, 0.98, 0], 0.04, 0.04)],
      seg,
    );
    // lower jaw, open
    tube(b, skin, [S([2.9, 0.35, 0], 0.66, 0.34), S([3.7, 0.08, 0], 0.56, 0.27), S([4.5, -0.14, 0], 0.44, 0.22), S([5.05, -0.24, 0], 0.34, 0.17), S([5.3, -0.24, 0], 0.22, 0.12), S([5.38, -0.23, 0], 0.04, 0.04)], seg);
    // inside of the mouth: dark cheeks closing the corners, the throat glowing at the back
    box(b, mouthIn, [2.9, 0.2, -0.5], [4.2, 0.78, -0.44]);
    box(b, mouthIn, [2.9, 0.2, 0.44], [4.2, 0.78, 0.5]);
    box(b, throat, [2.95, 0.22, -0.46], [3.1, 0.92, 0.46], { grain: 1 });
    for (const z of [-1, 1]) {
      // fangs: one long pair above, one shorter pair below, and a few small teeth behind them up close
      spike(b, fang, [5.15, 0.62, z * 0.27], [0.08, -1, 0], 0.075, 0.42, 4);
      spike(b, fang, [4.9, 0.02, z * 0.24], [0.05, 1, 0], 0.065, 0.32, 4);
      if (lod === 0) {
        for (const x of [4.0, 4.35, 4.7]) spike(b, fang, [x, 0.6 + (4.7 - x) * 0.12, z * (0.42 - (x - 4.0) * 0.12)], [0, -1, 0], 0.045, 0.16, 4);
      }
      // eyes deep under heavy brows
      if (lod < 2) {
        b.with(xlate(3.6, 1.5, z * 0.63), () => {
          const prof: V2[] = [];
          for (let i = 0; i <= 6; i += 1) {
            const a = (i / 6) * Math.PI;
            prof.push([Math.sin(a) * 0.16, -Math.cos(a) * 0.16]);
          }
          lathe(b, eye, prof, 8);
        });
        tube(b, skin, [S([4.05, 1.62, z * 0.3], 0.17, 0.14), S([3.6, 1.8, z * 0.62], 0.18, 0.15), S([3.05, 1.74, z * 0.8], 0.14, 0.12)], 6, { capStart: true, capEnd: true });
        // nostrils on top of the snout
        box(b, mouthIn, [5.35, 1.2, z * 0.17 - 0.07], [5.6, 1.27, z * 0.17 + 0.07]);
      }
      // one pair of horns, swept back along the neck
      tube(b, bronze, [S([3.05, 1.72, z * 0.42], 0.17, 0.17), S([2.4, 2.22, z * 0.55], 0.14, 0.14), S([1.7, 2.5, z * 0.62], 0.09, 0.09), S([1.1, 2.56, z * 0.66], 0.03, 0.03)], byLod(ctx, 7, 5, 4), { capEnd: true });
      // whiskers: thin bronze tendrils curling back from the snout
      if (lod === 0) {
        tube(b, bronze, [S([5.15, 0.8, z * 0.42], 0.05, 0.05), S([4.6, 0.64, z * 0.82], 0.045, 0.045), S([3.85, 0.7, z * 1.08], 0.035, 0.035), S([3.25, 0.92, z * 1.12], 0.015, 0.015)], 5, { capEnd: true });
      }
    }
    // a short carved mane down the back of the neck
    if (lod < 2) {
      for (let i = 0; i < 5; i += 1) {
        const x = 0.4 + i * 0.5;
        const y = 0.15 + (x - 0.4) * 0.38 + 0.84;
        spike(b, bronze, [x, y - 0.06, 0], [-0.7, 1, 0], 0.12, 0.62 - i * 0.05, 4);
      }
    }
    // the bow gun's muzzle in the mouth
    if (lod < 2) {
      const mx = head.mouthX - bx;
      const my = head.mouthY - by;
      cylinder(b, bronze, [mx - 1.4, my, 0], [mx - 0.12, my, 0], 0.2, 0.19, 8, false);
      cylinder(b, bronze, [mx - 0.12, my, 0], [mx, my, 0], 0.25, 0.25, 8, true);
    }
  });
}
