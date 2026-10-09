/**
 * Panokseon (板屋船): lofted flat-bottomed hull, two decks (rowers below the main deck), a bulwark of planks with
 * gun ports and painted shield boards, the stern command pavilion (jangdae) with a tiled hip roof, masts with
 * battened sails, banners. Three genuinely different variants share the parts but not the silhouette.
 */
import { anchorsFor, PANOK_PLANS, sideZ, type PanokPlan } from '../anchors';
import {
  box,
  cylinder,
  hipRoof,
  MeshBuilder,
  paints,
  rectSection,
  spike,
  sweep,
  lerp3,
  type MeshData,
  type V3,
  xlate,
  lathe,
  type V2,
  polygon,
} from './parts';
import {
  anchorProp,
  barrel,
  blockRow,
  clothPatch,
  byLod,
  cannon,
  deckPlane,
  flag,
  furledSail,
  hatch,
  lantern,
  loftHull,
  longPennant,
  mast,
  mulberry32,
  oar,
  oarPortFrame,
  post,
  ropeCoil,
  sail,
  sideTimber,
  wallRun,
  windlass,
  type Ctx,
  type Lod,
} from './common';

const HULL_TINT: V3[] = [
  [0.82, 0.74, 0.66],
  [0.62, 0.62, 0.66],
  [0.9, 0.8, 0.68],
];
const WALL_TINT: V3[] = [
  [1.0, 0.95, 0.88],
  [0.9, 0.92, 0.95],
  [1.1, 1.0, 0.9],
];
const FLAG_CYCLE: [string, string][] = [
  ['flags_b', 'blue'],
  ['flags_a', 'red'],
  ['flags_b', 'white'],
  ['flags_b', 'yellow'],
  ['flags_b', 'black'],
];

export function buildPanokseon(variant: number, lod: Lod): MeshData {
  const plan = PANOK_PLANS[variant] ?? PANOK_PLANS[0]!;
  const anchors = anchorsFor(`panokseon#${PANOK_PLANS[variant] ? variant : 0}`)!;
  const b = new MeshBuilder();
  const ctx: Ctx = { b, lod, faction: 'joseon', P: paints('joseon'), rnd: mulberry32(7100 + variant) };
  const h = plan.hull;
  const L = h.length;
  const deck = h.deck;
  const { P } = ctx;
  const hullPaint = P('hull_plank');
  const timber = P('dark_timber');
  const red = P('red_lacquer');
  const dark = P('dark_timber', { tint: [0.16, 0.15, 0.14] });
  const rope = P('rope');
  const sheer = (x: number) => plan.sheer * Math.pow(Math.abs((2 * x) / L), 2.2);
  const outer = (x: number) => sideZ(h, x, deck) + 0.04;
  const top = (x: number) => deck + plan.parapet + sheer(x);
  const tintV = HULL_TINT[variant] ?? HULL_TINT[0]!;
  const wallTint = WALL_TINT[variant] ?? WALL_TINT[0]!;

  // --- hull, decks, wales ---
  loftHull(ctx, h, hullPaint, hullPaint, { tint: tintV });
  deckPlane(ctx, h, P('deck_plank'), -L / 2 + 0.35, L / 2 - 0.35, deck, 0.04);
  if (lod === 0) deckPlane(ctx, h, P('deck_plank', { tint: [0.7, 0.68, 0.64] }), -L / 2 + 3, L / 2 - 3, deck - 1.9, 0.5);
  const wales: [number, number, number][] = lod === 0 ? [[0.35, 0.16, 0.34], [1.35, 0.14, 0.26], [deck - 0.06, 0.2, 0.3]] : lod === 1 ? [[deck - 0.06, 0.2, 0.3]] : [];
  for (const [y, t, tall] of wales) sideTimber(ctx, h, y === deck - 0.06 ? red : timber.tinted(tintV), -L / 2 + 0.6, L / 2 - 0.6, y, t, tall, 0.07);

  // --- oars and their ports ---
  for (const op of anchors.oarPorts) {
    const side = op.side === 0 ? -1 : 1;
    oarPortFrame(ctx, op.pos, side, dark);
    oar(ctx, op.pos, side, 0.5, P('pine_mast', { tint: [0.9, 0.85, 0.8] }), P('hull_plank'));
  }

  // --- bulwark: plank walls with gun ports ---
  const ports = (side: number) =>
    anchors.gunPorts
      .filter((g) => g.side === side)
      .map((g) => ({ x: g.pos[0], w: 0.85, y0: deck + 0.5, y1: deck + 1.2 }));
  const shields = [P('shield_cloud', { rect: [0.02, 0.02, 0.98, 0.98] }), P('shield_tiger', { rect: [0.02, 0.02, 0.98, 0.98] })];
  for (const side of [-1, 1] as const) {
    wallRun(ctx, side, -L / 2 + 0.3, L / 2 - 0.3, deck, top, outer, 0.26, ports(side === -1 ? 0 : 1), timber.tinted(wallTint), timber.tinted([0.8, 0.78, 0.74]));
    // coping rail along the top
    const n = byLod(ctx, 22, 9, 5);
    const path: V3[] = [];
    for (let i = 0; i <= n; i += 1) {
      const x = -L / 2 + 0.3 + ((L - 0.6) * i) / n;
      path.push([x, top(x) + 0.08, side * (outer(x) - 0.12)]);
    }
    sweep(b, red, path, rectSection(0.44, 0.18));
  }
  // bow and stern walls
  for (const sgn of [-1, 1]) {
    const xe = (sgn * L) / 2;
    const zE = sideZ(h, xe, deck);
    const t = top(xe);
    box(b, timber.tinted(wallTint), [sgn > 0 ? xe - 0.3 : xe, deck, -zE], [sgn > 0 ? xe : xe + 0.3, t, zE], { grain: 1 });
  }
  // painted shield boards and port frames
  const portXs = [0, 1].map((side) => anchors.gunPorts.filter((g) => g.side === side).map((g) => g.pos[0]));
  const gap = portXs[0]!.length > 1 ? portXs[0]![1]! - portXs[0]![0]! : 4.4;
  const boardXs = [portXs[0]![0]! - gap / 2, ...portXs[0]!.slice(0, -1).map((x, i) => (x + portXs[0]![i + 1]!) / 2), portXs[0]![portXs[0]!.length - 1]! + gap / 2];
  if (lod < 2) {
    for (const side of [-1, 1] as const) {
      boardXs.forEach((x, i) => {
        const z = side * (outer(x) + 0.015);
        const wb = 1.7;
        const y0 = deck + 0.28;
        const y1 = y0 + plan.parapet - 0.55;
        const sh = variant === 1 ? shields[1]! : variant === 2 ? shields[0]! : shields[(i + (side > 0 ? 1 : 0)) % 2]!;
        b.quadF(red, [[x - wb / 2 - 0.08, y0 - 0.06, z], [x + wb / 2 + 0.08, y0 - 0.06, z], [x + wb / 2 + 0.08, y1 + 0.06, z], [x - wb / 2 - 0.08, y1 + 0.06, z]], [0, 0, side], [[0, 0], [1, 0], [1, 1], [0, 1]]);
        b.quadF(sh, [[x - wb / 2, y0, z + side * 0.012], [x + wb / 2, y0, z + side * 0.012], [x + wb / 2, y1, z + side * 0.012], [x - wb / 2, y1, z + side * 0.012]], [0, 0, side], [[0, 0], [1, 0], [1, 1], [0, 1]]);
        for (const dx of [-1.2, 1.2]) {
          const xs = x + dx;
          b.quadF(dark, [[xs - 0.07, deck + 0.5, z + side * 0.01], [xs + 0.07, deck + 0.5, z + side * 0.01], [xs + 0.07, deck + plan.parapet - 0.4, z + side * 0.01], [xs - 0.07, deck + plan.parapet - 0.4, z + side * 0.01]], [0, 0, side]);
        }
      });
    }
  }
  if (lod < 2) {
    for (const g of anchors.gunPorts) {
      const side = g.side === 0 ? -1 : 1;
      const z = side * (outer(g.pos[0]) + 0.02);
      for (const dx of [-0.55, 0.55]) box(b, red, [g.pos[0] + dx - 0.09, deck + 0.3, z - 0.17], [g.pos[0] + dx + 0.09, deck + 1.45, z + 0.17], { grain: 1 });
      box(b, red, [g.pos[0] - 0.64, deck + 1.2, z - 0.17], [g.pos[0] + 0.64, deck + 1.4, z + 0.17], { grain: 0 });
      cannon(ctx, [g.pos[0], g.pos[1], side * (outer(g.pos[0]) + 0.02)], [0, 0, side], g.gun, timber, P('bronze', { tint: [1.25, 0.95, 0.7] }), P('iron_hex', { surf: 2 }));
    }
  }
  // bow board with a painted face, rudder, stem posts
  if (lod < 2) {
    const xb = L / 2 + 0.03;
    const face = shields[variant === 1 ? 0 : 1]!;
    b.quadF(face, [[xb, 1.0, -1.7], [xb, 1.0, 1.7], [xb, 3.5, 1.7], [xb, 3.5, -1.7]], [1, 0, 0], [[0, 0], [1, 0], [1, 1], [0, 1]]);
    box(b, timber.tinted(tintV), [-L / 2 - 0.55, -2.2, -0.2], [-L / 2 - 0.05, 1.3, 0.2], { grain: 1 });
    box(b, timber, [-L / 2 - 0.5, 1.3, -0.14], [-L / 2 - 0.25, deck + 1.0, 0.14], { grain: 1 });
  }

  // --- stern command pavilion ---
  pavilion(ctx, plan, variant);
  if (plan.look) lookout(ctx, plan, variant);

  // --- masts and sails ---
  plan.masts.forEach((m, i) => {
    mast(ctx, P('pine_mast', { tint: [0.9, 0.85, 0.8] }), timber, m.x, deck, m.h, m.r);
    if (lod < 2) box(b, timber, [m.x - 0.55, deck, -0.55], [m.x + 0.55, deck + 0.4, 0.55], { grain: 0 });
    const yTop = deck + m.h - 1.3;
    const so = { x: m.x, yTop, w: m.sailW, h: m.sailH, billow: m.set ? 0.85 : 0, battens: 8, phase: i * 1.7 };
    if (m.set) sail(ctx, P('sail_hemp', { tint: [0.92, 0.86, 0.76] }), P('pine_mast', { tint: [0.9, 0.85, 0.8] }), rope, so);
    else furledSail(ctx, P('sail_hemp', { tint: [0.92, 0.86, 0.76] }), P('pine_mast', { tint: [0.9, 0.85, 0.8] }), rope, so);
    if (lod === 0) {
      // shrouds from the masthead to the bulwark, with rope rungs between each pair
      for (const sgn of [-1, 1]) {
        const head: V3 = [m.x, deck + m.h * 0.82, sgn * 0.1];
        const foot = (dx: number): V3 => [m.x + dx, deck + plan.parapet + 0.2, sgn * (outer(m.x + dx) - 0.2)];
        for (const dx of [-1.4, 0, 1.4]) sweep(b, rope, [head, foot(dx)], rectSection(0.05, 0.05), { caps: true });
        for (let k = 1; k <= 7; k += 1) {
          const t = k / 8;
          sweep(b, rope, [lerp3(head, foot(-1.4), t), lerp3(head, foot(1.4), t)], rectSection(0.035, 0.035), { caps: true });
        }
      }
    }
    if (lod < 2) {
      const fl =variant === 0 ? ['flags_b', 'yellow'] : variant === 1 ? ['flags_a', 'jang'] : ['flags_a', 'tiger'];
      if (i === 0) flag(ctx, { pole: [m.x, deck + m.h + 0.4, 0], poleH: 1.0, w: variant === 0 ? 1.5 : 1.7, h: variant === 0 ? 1.4 : 1.6, sheet: fl[0]!, flag: fl[1]!, phase: 2.1, wood: timber });
      else if (i === 1) longPennant(ctx, fl[0] === 'flags_a' ? clothPatch(ctx, 'flags_a', 'red') : clothPatch(ctx, 'flags_b', 'blue'), [m.x - 0.1, deck + m.h - 0.1, 0], 7.5, 0.8, 0.6);
    }
  });

  // --- banners along the bulwark ---
  if (lod < 2) {
    let k = 0;
    for (const side of [-1, 1] as const) {
      boardXs.forEach((x, i) => {
        if (lod === 1 && i % 2) return;
        const [sheet, name] = FLAG_CYCLE[(k + side + 2) % 5]!;
        k += 1;
        flag(ctx, { pole: [x, top(x) + 0.1, side * (outer(x) - 0.12)], poleH: 1.7, w: 1.05, h: 0.8, sheet, flag: name, phase: k * 0.9, wood: timber, nu: byLod(ctx, 4, 1, 1), nv: byLod(ctx, 3, 1, 1) });
      });
    }
  }

  // --- deck furniture ---
  const jar = P('hull_plank', { tint: [0.8, 0.72, 0.62] });
  [[-1.0, 3.5], [0.4, -3.8], [-12.5, 4.4], [8.5, -3.6]].forEach(([x, z]) => barrel(ctx, jar, P('iron_hex', { surf: 2 }), [x!, deck, z!], 0.42, 0.85));
  ropeCoil(ctx, rope, [6.0, deck, 3.2], 0.5);
  ropeCoil(ctx, rope, [-2.5, deck, -3.6], 0.45);
  hatch(ctx, P('deck_plank'), dark, 0.5, deck, 0, 2.4, 1.6);
  hatch(ctx, P('deck_plank'), dark, 8.6, deck, 0.2, 1.8, 1.4);
  windlass(ctx, timber, P('iron_hex', { surf: 2 }), 7.0, deck, 2.0);
  for (const side of [-1, 1]) anchorProp(ctx, timber, P('iron_hex', { surf: 2 }), [14.2, deck - 0.1, side * (outer(14.2) + 0.45)]);
  for (const l of anchors.lanterns) lantern(ctx, P('red_lacquer', { tint: [1.3, 0.9, 0.7] }), timber, l);
  // bracket dentils under the coping and projecting deck-beam ends
  blockRow(ctx, h, red, -16.5, 16.5, 0.95, (x) => top(x) - 0.34, [0.24, 0.26, 0.32], 0.1);
  blockRow(ctx, h, timber, -17, 17, 2.3, deck - 0.42, [0.34, 0.3, 0.7], 0.2);
  return b.data();
}

function pavilion(ctx: Ctx, plan: PanokPlan, variant: number) {
  const { b, lod, P } = ctx;
  const pv = plan.pavilion;
  const deck = plan.hull.deck;
  const floorY = deck + pv.floorUp;
  const x0 = pv.x;
  const timber = P('dark_timber');
  const red = P('red_lacquer');
  const dan = P('dancheong');
  const giwa = P('giwa');
  const hx = pv.hx;
  const hz = pv.hz;
  const yTop = floorY + pv.postH;
  // floor and beams
  box(b, P('deck_plank'), [x0 - hx, floorY - 0.26, -hz], [x0 + hx, floorY, hz], { grain: 0 });
  if (lod < 2) {
    for (const fx of [-0.7, 0, 0.7]) box(b, timber, [x0 + fx * hx - 0.17, floorY - 0.6, -hz - 0.1], [x0 + fx * hx + 0.17, floorY - 0.26, hz + 0.1], { grain: 2 });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) post(ctx, timber, x0 + sx * hx * 0.82, deck, floorY - 0.26, sz * hz * 0.82, 0.38);
    if (lod === 0) {
      for (const sz of [-1, 1]) post(ctx, timber, x0, deck, floorY - 0.26, sz * hz * 0.82, 0.34);
      // stair on the bow side
      const steps = 7;
      for (let k = 0; k < steps; k += 1) {
        const y = floorY - ((k + 1) * pv.floorUp) / steps;
        box(b, P('deck_plank'), [x0 + hx + k * 0.45, y - 0.06, hz * 0.1], [x0 + hx + (k + 1) * 0.45, y, hz * 0.1 + 1.1], { grain: 2 });
      }
      for (const z of [hz * 0.1 - 0.06, hz * 0.1 + 1.1]) sweep(b, timber, [[x0 + hx, floorY + 0.7, z], [x0 + hx + steps * 0.45, deck + 0.7, z]], rectSection(0.1, 0.1), { caps: true });
    }
  }
  // railing at the floor edge
  const railY = floorY + 0.95;
  if (lod < 2) {
    const edge: V3[] = [
      [x0 + hx, railY, hz * 0.1 - 0.15],
      [x0 + hx, railY, -hz],
      [x0 - hx, railY, -hz],
      [x0 - hx, railY, hz],
      [x0 + hx, railY, hz],
      [x0 + hx, railY, hz * 0.1 + 1.25],
    ];
    sweep(b, red, edge.slice(0, 5), rectSection(0.12, 0.12), { caps: true });
    for (const pt of [edge[0]!, edge[1]!, edge[2]!, edge[3]!, edge[4]!]) post(ctx, red, pt[0], floorY, railY + 0.12, pt[2], 0.17);
    if (lod === 0) {
      const bal = (xa: number, za: number, xb: number, zb: number) => {
        const n = Math.max(1, Math.round(Math.hypot(xb - xa, zb - za) / 0.6));
        for (let i = 1; i < n; i += 1) post(ctx, timber, xa + ((xb - xa) * i) / n, floorY, railY - 0.1, za + ((zb - za) * i) / n, 0.06);
      };
      bal(x0 + hx, -hz, x0 - hx, -hz);
      bal(x0 - hx, -hz, x0 - hx, hz);
      bal(x0 - hx, hz, x0 + hx, hz);
      bal(x0 + hx, -hz, x0 + hx, hz * 0.1 - 0.15);
    }
  }
  // pillars, tie beams, brackets
  const px = hx * 0.78;
  const pz = hz * 0.78;
  const tier3 = pv.tiers === 3;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) post(ctx, tier3 ? timber : red, x0 + sx * px, floorY, yTop, sz * pz, tier3 ? 0.3 : 0.42);
  if (lod < 2) {
    for (const sz of [-1, 1]) box(b, tier3 ? timber : dan, [x0 - px - 0.3, yTop - 0.55, sz * pz - 0.2], [x0 + px + 0.3, yTop - 0.1, sz * pz + 0.2], { grain: 0 });
    for (const sx of [-1, 1]) box(b, tier3 ? timber : dan, [x0 + sx * px - 0.2, yTop - 0.55, -pz - 0.3], [x0 + sx * px + 0.2, yTop - 0.1, pz + 0.3], { grain: 2 });
    for (const sz of [-1, 1]) box(b, red, [x0 - px, floorY + 1.05, sz * pz - 0.1], [x0 + px, floorY + 1.25, sz * pz + 0.1], { grain: 0 });
    if (variant === 1) {
      // enclosed lower storey: plank walls on three sides with a lattice band
      const wallPaint = timber.tinted([0.9, 0.85, 0.8]);
      for (const sz of [-1, 1]) box(b, wallPaint, [x0 - px, floorY, sz * pz - 0.07], [x0 + px, floorY + 1.1, sz * pz + 0.07], { grain: 0 });
      box(b, wallPaint, [x0 - px - 0.07, floorY, -pz], [x0 - px + 0.07, floorY + 1.1, pz], { grain: 2 });
    }
  }
  if (lod === 0 && !tier3) {
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const cx = x0 + sx * px;
        const cz = sz * pz;
        box(b, dan, [cx - 0.42, yTop - 0.1, cz - 0.42], [cx + 0.42, yTop + 0.18, cz + 0.42]);
        box(b, dan, [cx - 0.3, yTop + 0.18, cz - 0.3], [cx + 0.3, yTop + 0.38, cz + 0.3]);
      }
    }
  }
  // drum
  if (lod === 0 && variant !== 2) {
    b.with(xlate(x0 + hx - 0.9, floorY, -hz + 0.9), () => {
      const prof: V2[] = [[0.5, 0.45], [0.58, 0.8], [0.58, 1.1], [0.5, 1.45]];
      lathe(b, red, prof, 12);
      polygon(b, P('sail_hemp'), Array.from({ length: 12 }, (_, i): V3 => [Math.cos((i / 12) * 6.283) * 0.5, 1.45, Math.sin((i / 12) * 6.283) * 0.5]), [0, 1, 0], (p) => P('sail_hemp').map(p[0], p[2]));
      for (const sx of [-1, 1]) box(b, timber, [sx * 0.5 - 0.06, 0, -0.35], [sx * 0.5 + 0.06, 0.8, 0.35], { grain: 1 });
    });
  }
  // roof
  const eaveHx = px + 1.5;
  const eaveHz = pz + 1.5;
  const ridge = Math.max(0.35, eaveHx - eaveHz - 0.3);
  const nS = byLod(ctx, 6, 3, 1);
  const nE = byLod(ctx, 12, 6, 2);
  const roofTile = tier3 ? P('sail_hemp', { tint: [0.9, 0.82, 0.7] }) : giwa;
  const trim = tier3 ? red : dan;
  const cap = tier3 ? timber : P('dark_timber', { tint: [0.45, 0.45, 0.47] });
  b.with(xlate(x0, 0, 0), () => {
    hipRoof(b, roofTile, trim, cap, { hx: eaveHx, hz: eaveHz, ridge: tier3 ? 0.5 : ridge, y: yTop + 0.05, rise: pv.roofRise, lift: tier3 ? 0.25 : 0.55, concave: tier3 ? 1.2 : 1.7, nSlope: nS, nEave: nE, fascia: tier3 ? 0.22 : 0.34 });
  });
  const roofTop = yTop + 0.05 + pv.roofRise;
  const R = tier3 ? 0.5 : ridge;
  if (lod < 2 && !tier3) {
    for (const sx of [-1, 1]) spike(b, P('bronze', { tint: [1.2, 1.1, 0.7] }), [x0 + sx * (R + 0.3), roofTop + 0.15, 0], [sx * 0.35, 1, 0], 0.17, 0.7, 5);
  }
  // upper storey of the two-tier pavilion
  let flagBase = roofTop;
  if (pv.tiers === 2) {
    const uy = roofTop - 0.25;
    const ux = hx * 0.45;
    const uz = hz * 0.4;
    box(b, dan, [x0 - ux - 0.3, uy, -uz - 0.3], [x0 + ux + 0.3, uy + 0.3, uz + 0.3], { grain: 0 });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) post(ctx, red, x0 + sx * ux, uy + 0.3, uy + 2.1, sz * uz, 0.3);
    const uh = ux + 0.95;
    const uw = uz + 0.95;
    b.with(xlate(x0, 0, 0), () => hipRoof(b, giwa, dan, cap, { hx: uh, hz: uw, ridge: Math.max(0.3, uh - uw - 0.2), y: uy + 2.15, rise: 1.15, lift: 0.4, concave: 1.6, nSlope: nS, nEave: nE, fascia: 0.28 }));
    flagBase = uy + 2.15 + 1.15;
  }
  // command banner
  const f = variant === 0 ? { w: 4.5, h: 3.7, name: 'su' } : variant === 1 ? { w: 3.4, h: 3.0, name: 'jang' } : { w: 3.8, h: 3.2, name: 'tiger' };
  flag(ctx, { pole: [x0 + (tier3 ? 0 : 0.3), flagBase - 0.1, 0], poleH: f.h + 1.2, w: f.w, h: f.h, sheet: 'flags_a', flag: f.name, phase: 0.3, wood: timber, nu: byLod(ctx, 10, 3, 1), nv: byLod(ctx, 7, 3, 1), flutter: 1.2 });
}

function lookout(ctx: Ctx, plan: PanokPlan, variant: number) {
  const { b, lod, P } = ctx;
  const deck = plan.hull.deck;
  const x0 = plan.hull.length / 2 - 4.2;
  const fy = deck + 2.3;
  const timber = P('dark_timber');
  const red = P('red_lacquer');
  const hw = 1.6;
  box(b, P('deck_plank'), [x0 - hw, fy - 0.22, -hw], [x0 + hw, fy, hw], { grain: 0 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) post(ctx, timber, x0 + sx * (hw - 0.2), deck, fy, sz * (hw - 0.2), 0.3);
  if (lod < 2) {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) post(ctx, red, x0 + sx * (hw - 0.15), fy, fy + 1.0, sz * (hw - 0.15), 0.14);
    const rail: V3[] = [[x0 + hw - 0.15, fy + 0.95, -hw + 0.15], [x0 - hw + 0.15, fy + 0.95, -hw + 0.15], [x0 - hw + 0.15, fy + 0.95, hw - 0.15], [x0 + hw - 0.15, fy + 0.95, hw - 0.15], [x0 + hw - 0.15, fy + 0.95, -hw + 0.15]];
    sweep(ctx.b, red, rail, rectSection(0.1, 0.1), { caps: true });
    cylinder(b, P('pine_mast'), [x0, fy, 0], [x0, fy + 3.2, 0], 0.13, 0.1, 6, true);
    void variant;
  }
}
