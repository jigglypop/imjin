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
  compose,
  scaleXf,
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
  const hexIron = P('iron_hex', { size: 1.9, tint: [1.3, 1.3, 1.35] });
  const strap = P('iron_hex', { surf: 2, tint: [1.0, 0.95, 0.9] });
  const top = (x: number) => hullTop(h, x);

  // --- hull: tarred planks below, red lacquered topsides above ---
  loftHull(ctx, h, P('hull_plank', { tint: [0.62, 0.58, 0.55] }), P('red_lacquer'));
  hullBand(ctx, h, red, -L / 2 + 0.05, L / 2 - 0.05, 0.45, (x) => top(x) - 0.02, 0.09);
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
      for (let x = xs0 + 1.5; x < xs1 - 0.8; x += 2.8) spike(b, iron, [x, roofY(x, t * eaveW(x)), t * eaveW(x)], [0, 1, 0], 0.15, 0.85, 3);
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

/** How much bigger than the first design the dragon is: the figurehead of the biggest ship of the fleet. */
const HEAD_SCALE = 1.22;

/**
 * Dragon head: neck rising from the roof, skull, open jaws with fangs, swept horns, spines, whiskers. Dark bronze and
 * blackened iron with red lacquer left in the recesses; the throat and eyes glow. Designed in its own space (mouth
 * centre at x = 0, y = 3.9) and then scaled and moved so the lips land at the bow.
 */
function dragonHead(ctx: Ctx, baseX: number, mouthY: number, bowX: number) {
  const { b, lod, P } = ctx;
  const k = HEAD_SCALE;
  const skin = P('dragon_scale', { surf: 2, tint: [3.0, 2.6, 2.2] });
  const bronze = P('dragon_scale', { surf: 2, tint: [3.2, 2.5, 1.5] });
  const lacquer = P('red_lacquer', { tint: [1.5, 1.0, 0.9] });
  const throat = P('red_lacquer', { surf: 5, tint: [0.9, 0.18, 0.04] });
  const tongue = P('red_lacquer', { surf: 5, tint: [0.4, 0.07, 0.03] });
  const eye = P('red_lacquer', { surf: 5, tint: [0.8, 0.22, 0.03] });
  const fang = P('iron_hex', { surf: 2, tint: [1.7, 1.55, 1.4] });
  const seg = byLod(ctx, 12, 8, 5);
  const S = (p: [number, number, number], a: number, c: number): TubeStation => ({ p, a, b: c });
  b.with(compose(xlate(baseX, mouthY - 3.9 * k, 0), scaleXf(k)), () => {
    // neck: from the roof end, arching forward and down to the head
    tube(b, skin, [S([-1.6, 5.6, 0], 1.05, 1.05), S([-0.4, 5.9, 0], 1.0, 1.0), S([0.9, 5.7, 0], 0.95, 0.95), S([2.0, 5.2, 0], 0.92, 0.95)], seg, { up: [0, 1, 0] });
    // skull and upper jaw, the snout turning up a little at the end
    tube(b, skin, [S([2.0, 5.15, 0], 0.98, 1.0), S([3.0, 5.15, 0], 1.02, 0.98), S([4.0, 4.95, 0], 0.86, 0.72), S([5.0, 4.85, 0], 0.66, 0.5), S([5.8, 4.84, 0], 0.55, 0.42), S([6.05, 4.84, 0], 0.46, 0.34), S([6.2, 4.82, 0], 0.3, 0.22), S([6.28, 4.8, 0], 0.06, 0.05)], seg);
    // lower jaw, dropped wide open
    tube(b, skin, [S([2.6, 3.25, 0], 0.88, 0.42), S([3.8, 2.95, 0], 0.7, 0.34), S([5.0, 2.8, 0], 0.55, 0.28), S([5.6, 2.9, 0], 0.4, 0.22), S([5.85, 2.97, 0], 0.3, 0.17), S([5.95, 3.0, 0], 0.05, 0.04)], seg);
    // the glowing throat, and a tongue lolling out over the lower jaw
    box(b, throat, [2.55, 2.9, -0.8], [2.75, 4.6, 0.8], { grain: 1 });
    box(b, tongue, [2.75, 3.3, -0.32], [5.4, 3.42, 0.32], { grain: 0 });
    // fangs: big canines at the front, smaller teeth behind
    if (lod === 0) {
      for (let i = 0; i < 7; i += 1) {
        const x = 3.2 + i * 0.5;
        const front = i >= 5;
        for (const z of [-0.5, 0.5]) {
          spike(b, fang, [x, 4.35, z * (1 - i * 0.06)], [0.05, -1, 0], front ? 0.13 : 0.1, front ? 1.0 : 0.5, 4);
          if (i < 6) spike(b, fang, [x + 0.2, 3.3, z * (1 - i * 0.06) * 0.8], [-0.05, 1, 0], front ? 0.12 : 0.09, front ? 0.85 : 0.42, 4);
        }
      }
    } else if (lod === 1) {
      for (const z of [-0.45, 0.45]) {
        spike(b, fang, [5.6, 4.35, z], [0.05, -1, 0], 0.12, 0.95, 4);
        spike(b, fang, [5.2, 3.1, z * 0.8], [-0.05, 1, 0], 0.1, 0.8, 4);
      }
    }
    for (const z of [-1, 1]) {
      if (lod === 0) {
        // eyes: small, burning, set deep under a heavy slanted brow
        b.with(xlate(3.7, 5.35, z * 0.88), () => {
          const prof: V2[] = [];
          for (let i = 0; i <= 6; i += 1) {
            const a = (i / 6) * Math.PI;
            prof.push([Math.sin(a) * 0.17, -Math.cos(a) * 0.17]);
          }
          lathe(b, eye, prof, 8);
        });
        tube(b, skin, [S([4.1, 5.6, z * 0.3], 0.2, 0.17), S([3.5, 5.78, z * 0.7], 0.24, 0.2), S([2.9, 5.7, z * 1.0], 0.2, 0.17)], 6, { capEnd: true });
        // nostril: flared and dark
        box(b, P('dark_timber', { tint: [0.1, 0.1, 0.1] }), [5.45, 5.0, z * 0.22 - 0.09], [5.8, 5.12, z * 0.22 + 0.09]);
      }
      // horns: two pairs swept back and up, the lower pair shorter and cruel
      tube(b, bronze, [S([3.0, 5.9, z * 0.55], 0.3, 0.3), S([2.1, 6.75, z * 0.8], 0.26, 0.26), S([1.0, 7.35, z * 1.0], 0.18, 0.18), S([0.0, 7.5, z * 1.1], 0.06, 0.06)], byLod(ctx, 7, 5, 4), { capEnd: true });
      if (lod < 2) tube(b, bronze, [S([3.4, 5.4, z * 0.95], 0.2, 0.2), S([2.7, 5.6, z * 1.5], 0.16, 0.16), S([2.0, 5.5, z * 2.0], 0.07, 0.07)], byLod(ctx, 6, 4, 3), { capEnd: true });
    }
    // a horn on the nose
    if (lod < 2) spike(b, bronze, [5.5, 5.1, 0], [0.3, 1, 0], 0.17, 0.75, 5);
    // mane and spines down the neck, sharp and tall
    if (lod < 2) {
      for (let i = 0; i < 7; i += 1) {
        const t = i / 6;
        spike(b, bronze, [-1.3 + t * 3.2, 6.45 - t * 0.5, 0], [-0.55, 1, 0], 0.22, 1.25 - t * 0.35, 5);
      }
    }
    // frill of fins fanning out behind the skull, red lacquer at the edge, and cheek fins
    if (lod < 2) {
      const n = byLod(ctx, 9, 5, 3);
      for (let i = 0; i < n; i += 1) {
        const a = -1.35 + (2.7 * i) / (n - 1);
        spike(b, i % 2 ? lacquer : bronze, [2.0, 5.2 + Math.cos(a) * 0.5, Math.sin(a) * 0.9], [-0.55, Math.cos(a) * 0.7, Math.sin(a) * 1.0], 0.2, 1.45, 4);
      }
      if (lod === 0) {
        for (const z of [-1, 1]) {
          for (const i of [0, 1, 2]) spike(b, lacquer, [3.9 - i * 0.55, 4.3 - i * 0.25, z * (0.72 - i * 0.04)], [-0.4, -0.25 - i * 0.12, z * 1.0], 0.14, 0.95 - i * 0.2, 4);
          // beard tufts under the lower jaw
          for (const [x, y] of [[5.6, 2.75], [4.6, 2.65], [3.6, 2.8]] as [number, number][]) spike(b, bronze, [x, y, z * 0.14], [0.1, -1, z * 0.12], 0.1, 0.75, 4);
        }
      }
    }
    // whiskers: long dark-red cloth streamers trailing from the snout
    if (lod < 2) {
      for (const z of [-1, 1]) {
        pennant(b, clothPatch(ctx, 'flags_a', 'red').tinted([0.6, 0.45, 0.45]), [5.2, 4.4, z * 0.55], [-1, -0.2, z * 0.5], [0, -1, 0], 4.6, 0.3, 0.04, byLod(ctx, 8, 3, 1), { flutter: 1.4, phase: z });
      }
    }
  });
  // the bow gun, muzzle at the lips
  if (lod < 2) cannon(ctx, [bowX - 1.0, mouthY, 0], [1, 0, 0], 'hyeonja', P('dark_timber'), P('bronze', { tint: [1.25, 0.95, 0.7] }), P('iron_hex', { surf: 2 }));
}
