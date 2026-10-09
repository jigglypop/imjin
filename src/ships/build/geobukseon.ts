/**
 * Geobukseon (turtle ship): red-lacquered hull with gun ports all round, an arched roof of dark hexagonal iron
 * plates studded with spikes, a dragon head at the bow that can belch smoke (anchors.smokeStack), a stern tail,
 * oars under the eaves and one raised mast. Larger than the panokseon on purpose.
 */
import { anchorsFor, GEOBUK_PLAN, hullTop, sideZ } from '../anchors';
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
  smoothstep,
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
import { barrel, byLod, cannon, clothPatch, flag, furledSail, hullBand, loftHull, mast, mulberry32, oar, oarPortFrame, ropeCoil, sideTimber, type Ctx, type Lod } from './common';

export function buildGeobukseon(lod: Lod): MeshData {
  const plan = GEOBUK_PLAN;
  const anchors = anchorsFor('geobukseon#0')!;
  const b = new MeshBuilder();
  const ctx: Ctx = { b, lod, faction: 'joseon', P: paints('joseon'), rnd: mulberry32(4242) };
  const { P } = ctx;
  const h = plan.hull;
  const L = h.length;
  const red = P('red_lacquer');
  const timber = P('dark_timber');
  const dark = P('dark_timber', { tint: [0.14, 0.13, 0.12] });
  const hexIron = P('iron_hex', { size: 1.9, tint: [1.5, 1.5, 1.6] });
  const top = (x: number) => hullTop(h, x);

  // --- hull: tarred planks below, red lacquered topsides above ---
  loftHull(ctx, h, P('hull_plank', { tint: [0.62, 0.58, 0.55] }), P('red_lacquer'));
  hullBand(ctx, h, red, -L / 2 + 0.05, L / 2 - 0.05, 0.45, (x) => top(x) - 0.02, 0.09);
  if (lod < 2) {
    hullBand(ctx, h, P('dancheong'), -L / 2 + 0.6, L / 2 - 2.0, (x) => top(x) - 0.62, (x) => top(x) - 0.08, 0.12);
  }
  if (lod === 0) {
    sideTimber(ctx, h, timber, -L / 2 + 0.6, L / 2 - 1.6, 0.45, 0.14, 0.3, 0.07);
    sideTimber(ctx, h, timber, -L / 2 + 0.6, L / 2 - 1.6, 2.15, 0.12, 0.22, 0.06);
    // vertical ribs between the guns
    for (let x = -L / 2 + 3; x < L / 2 - 4; x += 3.45) {
      for (const sgn of [-1, 1]) box(b, timber, [x - 0.1, 0.5, sgn * (sideZ(h, x, 2.5) + 0.04) - 0.09], [x + 0.1, top(x) - 0.65, sgn * (sideZ(h, x, 2.5) + 0.04) + 0.09], { grain: 1 });
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
      for (const dx of [-0.55, 0.55]) box(b, timber, [x + dx - 0.07, g.pos[1] - 0.62, zo - 0.1], [x + dx + 0.07, g.pos[1] + 0.62, zo + 0.1], { grain: 1 });
      box(b, timber, [x - 0.62, g.pos[1] + 0.45, zo - 0.1], [x + 0.62, g.pos[1] + 0.62, zo + 0.1], { grain: 0 });
      box(b, timber, [x - 0.62, g.pos[1] - 0.62, zo - 0.1], [x + 0.62, g.pos[1] - 0.45, zo + 0.1], { grain: 0 });
      // hinged lid propped open above the port
      b.with(xlate(x, g.pos[1] + 0.62, zo), () => {
        b.with(rotX(-0.9 * side), () => box(b, red, [-0.62, -0.035, Math.min(0, side * 0.9)], [0.62, 0.035, Math.max(0, side * 0.9)]));
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

  // --- the iron roof ---
  const xs0 = -L / 2 + 0.6;
  const xs1 = L / 2 - 5.4;
  const span = xs1 - xs0;
  const nx = byLod(ctx, 26, 12, 6);
  const nz = byLod(ctx, 20, 10, 6);
  const eaveW = (x: number) => sideZ(h, x, top(x)) + plan.overhang;
  const H = plan.roofTop - h.deck;
  const roofY = (x: number, z: number) => {
    const u = ((x - xs0) / span) * 2 - 1;
    const g = 1 - 0.78 * smoothstep(0.3, 1, Math.abs(u));
    const t = Math.min(1, Math.abs(z) / eaveW(x));
    return top(x) + H * g * (1 - Math.pow(t, 2.5));
  };
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
  for (const [x, facing] of [[xs0, -1], [xs1, 1]] as [number, number][]) {
    const w = eaveW(x);
    const ring: V3[] = [];
    for (let j = 0; j <= 8; j += 1) {
      const z = lerp(-w, w, j / 8);
      ring.push([x, roofY(x, z), z]);
    }
    polygon(b, hexIron, [[x, top(x) - 0.1, -w], ...ring, [x, top(x) - 0.1, w]], [facing, 0, 0], (p) => hexIron.map(p[2], p[1]));
  }
  // raised ribs across the plating and a spine beam along the ridge
  if (lod < 2) {
    const ribStep = byLod(ctx, 2.8, 5.6, 99);
    for (let x = xs0 + 2.2; x < xs1 - 1.2; x += ribStep) {
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
      const x = lerp(xs0 + 0.5, xs1 - 0.4, i / byLod(ctx, 30, 10, 4));
      spine.push([x, roofY(x, 0) + 0.06, 0]);
    }
    sweep(b, timber, spine, rectSection(0.34, 0.2));
  }
  // spikes: rows along the roof, pointing out of the shell
  if (lod === 1) {
    const iron = P('iron_hex', { surf: 2, tint: [0.75, 0.75, 0.8] });
    for (const t of [-0.8, -0.4, 0.4, 0.8]) {
      for (let x = xs0 + 1.5; x < xs1 - 0.8; x += 2.8) spike(b, iron, [x, roofY(x, t * eaveW(x)), t * eaveW(x)], [0, 1, 0], 0.17, 0.55, 3);
    }
  }
  if (lod === 0) {
    const iron = P('iron_hex', { surf: 2, tint: [0.75, 0.75, 0.8] });
    const rowsT = [-0.93, -0.74, -0.55, -0.37, -0.18, 0, 0.18, 0.37, 0.55, 0.74, 0.93];
    for (const t of rowsT) {
      for (let x = xs0 + 1.3; x < xs1 - 0.8; x += 1.4) {
        const z = t * eaveW(x);
        const y = roofY(x, z);
        const dz = (roofY(x, z + 0.1) - roofY(x, z - 0.1)) / 0.2;
        const dx = (roofY(x + 0.1, z) - roofY(x - 0.1, z)) / 0.2;
        spike(b, iron, [x, y - 0.02, z], [-dx, 1, -dz], 0.15, 0.55, 4);
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
        spike(b, iron, [x + 0.42, top(x) + 0.28, sgn * (w - 0.1)], [0, 1, sgn * 0.8], 0.09, 0.34, 4);
      }
    }
  }
  // roof ridge hatch frame
  if (lod < 2) {
    for (const sx of [-5.5, 6.0]) box(b, timber, [sx - 1.0, roofY(sx, 0) - 0.05, -0.7], [sx + 1.0, roofY(sx, 0) + 0.18, 0.7], { grain: 0 });
  }

  // --- dragon head ---
  dragonHead(ctx, plan.head.baseX, plan.head.mouthY, L / 2);

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
  void xlate;
  void lathe;
  return b.data();
}

/** Dragon head: neck rising from the roof, skull, open jaws with teeth, horns, whiskers, mane. Mouth at x = bowX. */
function dragonHead(ctx: Ctx, baseX: number, mouthY: number, bowX: number) {
  const { b, lod, P } = ctx;
  const scale = P('dragon_scale');
  const gold = P('dragon_scale', { tint: [2.0, 1.55, 0.55] });
  const redD = P('red_lacquer', { tint: [1, 0.9, 0.9] });
  const seg = byLod(ctx, 12, 8, 5);
  const x0 = baseX;
  const dy = mouthY - 3.9; // head height relative to the design values below
  const S = (p: [number, number, number], a: number, c: number): TubeStation => ({ p: [x0 + p[0], p[1] + dy, p[2]], a, b: c });
  // neck: from the roof end, arching forward and down to the head
  tube(b, scale, [S([-1.6, 5.6, 0], 1.05, 1.05), S([-0.4, 5.9, 0], 1.0, 1.0), S([0.9, 5.7, 0], 0.95, 0.95), S([2.0, 5.2, 0], 0.92, 0.95)], seg, { up: [0, 1, 0] });
  // skull and upper jaw
  tube(b, scale, [S([2.0, 5.15, 0], 0.98, 1.0), S([3.0, 5.15, 0], 1.02, 0.98), S([4.0, 4.95, 0], 0.86, 0.72), S([5.0, 4.8, 0], 0.66, 0.5), S([5.8, 4.74, 0], 0.55, 0.42), S([6.05, 4.7, 0], 0.46, 0.34), S([6.2, 4.66, 0], 0.3, 0.22), S([6.28, 4.64, 0], 0.06, 0.05)], seg);
  // lower jaw, opened
  tube(b, scale, [S([2.6, 3.35, 0], 0.88, 0.42), S([3.8, 3.15, 0], 0.7, 0.34), S([5.0, 3.1, 0], 0.55, 0.28), S([5.9, 3.25, 0], 0.42, 0.22), S([6.1, 3.32, 0], 0.34, 0.18), S([6.25, 3.36, 0], 0.05, 0.04)], seg);
  // throat and tongue
  box(b, redD.tinted([0.5, 0.15, 0.12]), [x0 + 2.55, 3.3 + dy, -0.7], [x0 + 2.7, 4.5 + dy, 0.7], { grain: 1 });
  box(b, redD.tinted([1.2, 0.35, 0.3]), [x0 + 2.7, 3.55 + dy, -0.3], [x0 + 5.3, 3.65 + dy, 0.3], { grain: 0 });
  if (lod === 0) {
    // teeth
    const tooth = P('sail_hemp', { tint: [1.0, 0.95, 0.8] });
    for (let k = 0; k < 6; k += 1) {
      const x = x0 + 3.3 + k * 0.55;
      for (const z of [-0.5, 0.5]) {
        spike(b, tooth, [x, 4.3 + dy, z * (1 - k * 0.07)], [0, -1, 0], 0.09, 0.42, 4);
        if (k < 5) spike(b, tooth, [x + 0.2, 3.5 + dy, z * (1 - k * 0.07) * 0.8], [0, 1, 0], 0.08, 0.34, 4);
      }
    }
    // eyes: bulging gold balls with a dark pupil
    for (const z of [-1, 1]) {
      b.with(xlate(x0 + 3.55, 5.45 + dy, z * 0.86), () => {
        const prof: V2[] = [];
        for (let i = 0; i <= 6; i += 1) {
          const a = (i / 6) * Math.PI;
          prof.push([Math.sin(a) * 0.3, -Math.cos(a) * 0.3]);
        }
        lathe(b, P('dragon_scale', { tint: [2.2, 1.9, 0.5] }), prof, 8);
      });
      b.with(xlate(x0 + 3.8, 5.45 + dy, z * 0.9), () => {
        const prof: V2[] = [];
        for (let i = 0; i <= 5; i += 1) {
          const a = (i / 5) * Math.PI;
          prof.push([Math.sin(a) * 0.13, -Math.cos(a) * 0.13]);
        }
        lathe(b, P('dark_timber', { tint: [0.1, 0.1, 0.1] }), prof, 6);
      });
      // brow ridge
      box(b, scale.tinted([1.1, 0.5, 0.4]), [x0 + 3.0, 5.42 + dy, Math.min(z * 0.3, z * 0.8)], [x0 + 3.9, 5.62 + dy, Math.max(z * 0.3, z * 0.8)], { grain: 0 });
      // nostril bulge
      box(b, P('dark_timber', { tint: [0.1, 0.1, 0.1] }), [x0 + 5.5, 4.92 + dy, z * 0.2 - 0.07], [x0 + 5.75, 5.0 + dy, z * 0.2 + 0.07]);
    }
  }
  // horns: swept back and up, gold
  for (const z of [-1, 1]) {
    tube(b, gold, [S([3.0, 5.9, z * 0.55], 0.26, 0.26), S([2.2, 6.6, z * 0.75], 0.22, 0.22), S([1.2, 7.1, z * 0.95], 0.15, 0.15), S([0.4, 7.2, z * 1.05], 0.06, 0.06)], byLod(ctx, 7, 5, 4), { capEnd: true });
  }
  // mane: spikes down the back of the neck
  if (lod < 2) {
    for (let k = 0; k < 5; k += 1) {
      const t = k / 4;
      spike(b, gold, [x0 - 1.2 + t * 2.6, 6.4 - t * 0.4 + dy, 0], [-0.5, 1, 0], 0.22, 0.85, 5);
    }
  }
  // frill of fins fanning out behind the skull, and cheek fins
  if (lod < 2) {
    const n = byLod(ctx, 9, 5, 3);
    for (let k = 0; k < n; k += 1) {
      const a = -1.35 + (2.7 * k) / (n - 1);
      spike(b, gold, [x0 + 2.0, 5.2 + dy + Math.cos(a) * 0.5, Math.sin(a) * 0.9], [-0.55, Math.cos(a) * 0.7, Math.sin(a) * 1.0], 0.2, 1.25, 4);
    }
    if (lod === 0) {
      for (const z of [-1, 1]) {
        for (const k of [0, 1]) spike(b, redD, [x0 + 3.9 - k * 0.5, 4.3 + dy - k * 0.2, z * (0.72 - k * 0.04)], [-0.4, -0.2 - k * 0.15, z * 1.0], 0.13, 0.8 - k * 0.2, 4);
        // chin tuft under the lower jaw
        spike(b, gold, [x0 + 5.6, 3.0 + dy, z * 0.12], [0.1, -1, z * 0.1], 0.1, 0.7, 4);
      }
    }
  }
  // whiskers: long cloth streamers trailing from the snout
  if (lod < 2) {
    for (const z of [-1, 1]) {
      pennant(b, clothPatch(ctx, 'flags_a', 'red'), [x0 + 5.2, 4.3 + dy, z * 0.55], [-1, -0.2, z * 0.5], [0, -1, 0], 4.2, 0.28, 0.04, byLod(ctx, 8, 3, 1), { flutter: 1.4, phase: z });
    }
  }
  // the bow gun, muzzle at the lips
  if (lod < 2) cannon(ctx, [bowX - 1.0, mouthY, 0], [1, 0, 0], 'hyeonja', P('dark_timber'), P('bronze', { tint: [1.25, 0.95, 0.7] }), P('iron_hex', { surf: 2 }));
}
