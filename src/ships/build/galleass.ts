/**
 * The Neapolitan galleass of 1588 (Girona, San Lorenzo): a long, low galley hull with thirty oars a side worked from
 * benches on the open deck, the oars pivoting on an outrigger frame (the telaro) outboard of the hull; a high,
 * round-fronted castle at the bow carrying the heavy guns that fire ahead over the iron-shod spur, a stern castle under
 * its striped awning, and three lateen masts.
 */
import { buildAnchorsFor, galleassCastleZ, sideZ } from '../anchors';
import { GALLEASS_PLAN as PLAN } from '../armadaPlans';
import {
  anchorProp,
  barrel,
  byLod,
  cannon,
  clothPatch,
  deckPlane,
  flag,
  hullBand,
  lantern,
  lanternPole,
  loftHull,
  longPennant,
  mast,
  mulberry32,
  ropeCoil,
  sideTimber,
  type Ctx,
  type Lod,
} from './common';
import { box, cylinder, grid, lerp, MeshBuilder, paints, rectSection, sweep, type MeshData, type Paint, type V3 } from './parts';
import { lateenSail, line, shrouds } from './rig';

/** A wall round the bow castle (or a straight wall) from x0 to x1: zAt gives its half breadth; both faces and the cap. */
function ringWall(ctx: Ctx, x0: number, x1: number, lo: number, hi: number, zAt: (x: number) => number, out: Paint, inner: Paint, thick: number, front: boolean) {
  const n = Math.max(2, Math.round((x1 - x0) / byLod(ctx, 0.45, 2, 4)));
  for (const sgn of [-1, 1]) {
    const O: V3[][] = [];
    const I: V3[][] = [];
    const T: V3[][] = [];
    for (let i = 0; i <= n; i += 1) {
      const x = lerp(x0, x1, i / n);
      const z = zAt(x);
      O.push([[x, lo, sgn * z], [x, hi, sgn * z]]);
      I.push([[x, lo, sgn * (z - thick)], [x, hi, sgn * (z - thick)]]);
      T.push([[x, hi, sgn * (z - thick)], [x, hi, sgn * z]]);
    }
    grid(ctx.b, out, O, { flip: sgn > 0, uvFn: (i, j) => out.map(O[i]![j]![0], O[i]![j]![1]) });
    if (ctx.lod < 2) {
      grid(ctx.b, inner, I, { flip: sgn < 0, uvFn: (i, j) => inner.map(I[i]![j]![0], I[i]![j]![1]) });
      grid(ctx.b, inner, T, { flip: sgn > 0 });
    }
  }
  if (front) {
    const z = zAt(x1);
    const pts: [V3, V3, V3, V3] = [[x1, lo, z], [x1, lo, -z], [x1, hi, -z], [x1, hi, z]];
    ctx.b.quadF(out, pts, [1, 0, 0], pts.map((p) => out.map(p[2], p[1])) as [[number, number], [number, number], [number, number], [number, number]]);
  }
}

export function buildGalleass(lod: Lod): MeshData {
  const plan = PLAN;
  const anchors = buildAnchorsFor('galleass#0')!;
  const b = new MeshBuilder();
  const ctx: Ctx = { b, lod, faction: 'spain', P: paints('spain'), rnd: mulberry32(15888) };
  const Pn = ctx.P;
  const h = plan.hull;
  const L = h.length;
  const deck = h.deck;
  const o = plan.outrigger;
  const hull = Pn('hull_plank', { tint: [0.92, 0.9, 0.88] });
  const red = Pn('red_paint');
  const black = Pn('black_paint');
  const gilt = Pn('gilt');
  const deckP = Pn('deck_plank');
  const inner = Pn('deck_plank', { tint: [0.7, 0.68, 0.66] });
  const timber = Pn('hull_plank', { tint: [0.55, 0.5, 0.46] });
  const wale = Pn('hull_plank', { tint: [0.3, 0.27, 0.25] });
  const dark = Pn('hull_plank', { tint: [0.09, 0.08, 0.07] });
  const wood = Pn('mast_wood');
  const rope = Pn('rope');
  const iron = Pn('iron');
  const bronze = Pn('bronze', { tint: [1.15, 1.0, 0.85] });
  const canvas = Pn('sail_canvas');

  // --- hull ---
  loftHull(ctx, h, hull, hull);
  hullBand(ctx, h, red, -L / 2 + 0.2, L / 2 - 0.3, deck - 0.9, deck - 0.02, 0.035);
  sideTimber(ctx, h, wale, -L / 2 + 0.4, L / 2 - 0.6, deck - 0.95, 0.15, 0.22, 0.06);
  deckPlane(ctx, h, deckP, -L / 2 + 0.15, L / 2 - 0.15, deck, 0.03);

  // --- the outrigger (telaro) the oars work on, with its rail of painted planks ---
  const yo = deck + o.up;
  for (const sgn of [-1, 1]) {
    box(b, black, [o.x0, yo - 0.25, sgn > 0 ? o.z - 0.2 : -o.z], [o.x1, yo, sgn > 0 ? o.z : -o.z + 0.2], { grain: 0 });
    if (lod < 2) {
      // Fairing boards from the hull out to the frame, and the low bulwark of the rowing deck on it.
      const P: V3[][] = [];
      const n = byLod(ctx, 16, 6, 2);
      for (let i = 0; i <= n; i += 1) {
        const x = lerp(o.x0, o.x1, i / n);
        P.push([[x, deck - 0.5, sgn * (sideZ(h, x, deck - 0.5) + 0.02)], [x, yo - 0.25, sgn * o.z]]);
      }
      grid(b, red, P, { flip: sgn > 0, uvFn: (i, j) => red.map(P[i]![j]![0], P[i]![j]![1]) });
      box(b, red, [o.x0, yo, sgn > 0 ? o.z - 0.12 : -o.z], [o.x1, yo + 0.55, sgn > 0 ? o.z : -o.z + 0.12], { grain: 0 });
      box(b, gilt, [o.x0, yo + 0.55, sgn > 0 ? o.z - 0.16 : -o.z - 0.04], [o.x1, yo + 0.65, sgn > 0 ? o.z + 0.04 : -o.z + 0.16], { grain: 0 });
      // Ends of the frame closing on the hull.
      for (const x of [o.x0, o.x1]) box(b, black, [x - 0.15, deck - 0.3, sgn > 0 ? sideZ(h, x, deck) : -o.z], [x + 0.15, yo + 0.55, sgn > 0 ? o.z : -sideZ(h, x, deck)], { grain: 2 });
    }
  }
  // --- oars and benches ---
  if (lod < 2) {
    let i0 = 0;
    for (const op of anchors.oarPorts) {
      const sgn = op.side === 0 ? -1 : 1;
      const d: V3 = [-0.12, -Math.sin(0.32), sgn * Math.cos(0.32)];
      const len = 11.5;
      const inb = 3.2;
      const p = op.pos;
      cylinder(b, wood, [p[0] - d[0] * inb, p[1] - d[1] * inb, p[2] - d[2] * inb], [p[0] + d[0] * (len - inb - 1.8), p[1] + d[1] * (len - inb - 1.8), p[2] + d[2] * (len - inb - 1.8)], 0.08, 0.06, byLod(ctx, 8, 4, 3), true);
      const bs: V3 = [p[0] + d[0] * (len - inb - 1.9), p[1] + d[1] * (len - inb - 1.9), p[2] + d[2] * (len - inb - 1.9)];
      const be: V3 = [p[0] + d[0] * (len - inb), p[1] + d[1] * (len - inb), p[2] + d[2] * (len - inb)];
      sweep(b, wood, [bs, be], rectSection(0.05, 0.28), { caps: true, up: [1, 0, 0] });
      // The thole post the oar works against, on the outrigger.
      if (lod === 0) box(b, timber, [p[0] - 0.07, p[1] - 0.05, p[2] - 0.07], [p[0] + 0.07, p[1] + 0.5, p[2] + 0.07], { grain: 1 });
      // Painted shields (the pavesade) hung on the rail between the oars.
      if (lod === 0) box(b, i0 % 2 ? red : gilt, [p[0] + 0.2, p[1] + 0.05, p[2] - 0.05], [p[0] + 0.62, p[1] + 0.55, p[2] + 0.05], { grain: 1 });
      i0 += 1;
      if (lod === 0) box(b, timber, [p[0] - 0.25, deck, sgn > 0 ? 0.6 : -(o.z - 0.6)], [p[0] + 0.25, deck + 0.5, sgn > 0 ? o.z - 0.6 : -0.6], { grain: 2 });
    }
  }
  // The corsia: the gangway down the middle between the benches.
  box(b, timber, [o.x0, deck, -0.55], [plan.bow.x0, deck + 0.7, 0.55], { grain: 0 });

  // --- bow castle with the guns firing ahead, and the spur ---
  const bc = plan.bow;
  const byTop = deck + bc.h;
  const zc = (x: number) => galleassCastleZ(plan, x);
  ringWall(ctx, bc.x0, bc.x1, deck - 0.6, byTop, zc, red, inner, 0.25, true);
  ringWall(ctx, bc.x0, bc.x1, byTop, byTop + 1.0, (x) => zc(x) - 0.05, black, inner, 0.2, true);
  {
    const n = byLod(ctx, 8, 4, 2);
    const P: V3[][] = [];
    for (let i = 0; i <= n; i += 1) {
      const x = lerp(bc.x0, bc.x1, i / n);
      P.push([[x, byTop, -zc(x) + 0.1], [x, byTop, zc(x) - 0.1]]);
    }
    grid(b, deckP, P, { flip: true, uvFn: (i, j) => deckP.map(P[i]![j]![0], P[i]![j]![2]) });
    const bz = zc(bc.x0);
    const back: [V3, V3, V3, V3] = [[bc.x0, deck, -bz], [bc.x0, deck, bz], [bc.x0, byTop, bz], [bc.x0, byTop, -bz]];
    b.quadF(Pn('cabin_wood'), back, [-1, 0, 0], back.map((p) => [p[2] / 2, p[1] / 2]) as [[number, number], [number, number], [number, number], [number, number]]);
  }
  if (lod < 2) {
    for (const y of [deck + 0.2, byTop - 0.08]) {
      for (const sgn of [-1, 1]) {
        const path: V3[] = [];
        for (let i = 0; i <= 8; i += 1) {
          const x = lerp(bc.x0, bc.x1, i / 8);
          path.push([x, y, sgn * (zc(x) + 0.04)]);
        }
        sweep(b, gilt, path, rectSection(0.1, 0.18), { caps: true });
      }
    }
  }
  // Spur: an iron-shod beak at the waterline line of the deck.
  const spurY = deck - 0.6;
  sweep(b, timber, [[L / 2 - 1.5, spurY - 0.6, 0], [L / 2 + plan.spur * 0.5, spurY, 0], [L / 2 + plan.spur, spurY + 0.5, 0]], rectSection(0.5, 0.75), { caps: true, up: [0, 0, 1] });
  if (lod < 2) cylinder(b, iron, [L / 2 + plan.spur - 0.6, spurY + 0.35, 0], [L / 2 + plan.spur + 0.5, spurY + 0.6, 0], 0.26, 0.04, 6, true);

  // --- stern castle and awning ---
  const sc = plan.stern;
  const syTop = deck + sc.h;
  const sz = (x: number) => Math.max(1.0, sideZ(h, Math.max(-L / 2, x), deck) - 0.1 * (x < -L / 2 + 2 ? 1 : 0));
  ringWall(ctx, sc.x0, sc.x1, deck, syTop, sz, red, inner, 0.22, false);
  {
    const z0 = sz(sc.x0);
    const z1 = sz(sc.x1);
    b.quadF(Pn('stern_panel', { rect: [0.02, 0.02, 0.98, 0.98], surf: 3 }), [[sc.x0, deck, z0], [sc.x0, deck, -z0], [sc.x0, syTop, -z0], [sc.x0, syTop, z0]], [-1, 0, 0], [[0, 0], [1, 0], [1, 1], [0, 1]]);
    b.quadF(Pn('cabin_wood'), [[sc.x1, deck, -z1], [sc.x1, deck, z1], [sc.x1, syTop, z1], [sc.x1, syTop, -z1]], [1, 0, 0], [[0, 0], [z1, 0], [z1, sc.h / 2], [0, sc.h / 2]]);
    box(b, deckP, [sc.x0, syTop - 0.05, -z0], [sc.x1, syTop + 0.05, z0], { grain: 0 });
    // The awning: hoops over the poop with a red-and-gold cloth.
    const aw = Pn('flags_b', { rect: [0.02, 0.52, 0.48, 0.98] });
    const n = byLod(ctx, 8, 4, 2);
    const P: V3[][] = [];
    const ax0 = sc.x0 + 0.2;
    const ax1 = sc.x1 + 1.5;
    for (let i = 0; i <= n; i += 1) {
      const row: V3[] = [];
      for (let j = 0; j <= byLod(ctx, 6, 4, 2); j += 1) {
        const a = Math.PI * (j / byLod(ctx, 6, 4, 2));
        const x = lerp(ax0, ax1, i / n);
        const r = Math.min(z0, sz(x)) - 0.1;
        row.push([x, syTop + 0.9 + Math.sin(a) * 1.6, -Math.cos(a) * r]);
      }
      P.push(row);
    }
    grid(b, aw, P, { flip: false });
    grid(b, aw, P, { flip: true });
    if (lod < 2) for (const x of [ax0, (ax0 + ax1) / 2, ax1]) for (const sgn of [-1, 1]) cylinder(b, gilt, [x, syTop, sgn * (sz(x) - 0.15)], [x, syTop + 0.95, sgn * (sz(x) - 0.12)], 0.06, 0.06, 4, true);
  }
  if (lod < 2) box(b, timber, [-L / 2 - 0.6, -h.draft + h.rise * 0.9, -0.2], [-L / 2 - 0.02, deck - 0.2, 0.2], { grain: 1 });
  for (const l of anchors.lanterns) {
    lantern(ctx, Pn('gilt', { tint: [1.5, 1.25, 0.9] }), iron, l, 0.45);
    lanternPole(ctx, iron, l, syTop + 1.6, 0.55, 0);
  }

  // --- guns ---
  if (lod < 2) {
    for (const g of anchors.gunPorts) {
      const [x, y, z] = g.pos;
      if (g.side === 2) {
        const xf = bc.x1 + 0.02;
        b.quadF(dark, [[xf, y - 0.42, z + 0.42], [xf, y - 0.42, z - 0.42], [xf, y + 0.42, z - 0.42], [xf, y + 0.42, z + 0.42]], [1, 0, 0]);
        cannon(ctx, [xf, y, z], [1, 0, 0], g.gun, timber, bronze, iron);
        continue;
      }
      const sgn = g.side === 0 ? -1 : 1;
      const inCastle = x >= bc.x0 || x <= sc.x1;
      if (inCastle) {
        const zz = sgn * ((x >= bc.x0 ? zc(x) : sz(x)) + 0.02);
        b.quadF(dark, [[x - 0.36, y - 0.36, zz], [x + 0.36, y - 0.36, zz], [x + 0.36, y + 0.36, zz], [x - 0.36, y + 0.36, zz]], [0, 0, sgn]);
        cannon(ctx, [x, y, zz], [0, 0, sgn], g.gun, timber, bronze, iron);
      } else if (lod === 0) {
        cylinder(b, iron, [x, yo + 0.65, z], [x, y, z], 0.05, 0.05, 5, true);
        cylinder(b, iron, [x, y + 0.04, z - sgn * 0.7], [x, y + 0.04, z + sgn * 0.75], 0.07, 0.06, 6, true);
      }
    }
  }

  // --- masts and lateens ---
  plan.masts.forEach((m, i) => {
    mast(ctx, wood, iron, m.x, deck, m.h, m.r);
    shrouds(ctx, rope, m.x, deck + m.h * 0.8, (sgn, dx) => [m.x + dx, yo + 0.6, sgn * (o.z - 0.05)], [-1.8, -0.6, 0.6], m.r);
    lateenSail(ctx, canvas, wood, { x: m.x, y: deck + m.h * 0.86, len: m.lateen.len, fore: m.lateen.fore, tilt: m.lateen.tilt, h: m.lateen.h, phase: i * 1.4, billow: Math.min(2, m.lateen.h * 0.15) });
    if (lod < 2) {
      const [sheet, name] = i === 1 ? ['flags_a', 'royal'] : i === 0 ? ['flags_a', 'burgundy'] : ['flags_b', 'santiago'];
      flag(ctx, { pole: [m.x, deck + m.h, 0], poleH: 2.0, w: 2.6, h: 1.8, sheet, flag: name, phase: i, wood, nu: byLod(ctx, 6, 2, 1), nv: byLod(ctx, 4, 2, 1) });
      longPennant(ctx, clothPatch(ctx, 'flags_b', i % 2 ? 'red' : 'redgold'), [m.x - 0.1, deck + m.h - 0.5, 0], 7, 0.5, i);
    }
  });
  if (lod === 0) for (let i = 1; i < plan.masts.length; i += 1) line(ctx, rope, [plan.masts[i]!.x, deck + plan.masts[i]!.h * 0.8, 0], [plan.masts[i - 1]!.x, deck + 0.8, 0], 0.07);
  if (lod === 0) line(ctx, rope, [plan.masts[0]!.x + 0.2, deck + plan.masts[0]!.h * 0.8, 0], [L / 2 + plan.spur * 0.6, spurY + 0.4, 0], 0.07);
  if (lod < 2) flag(ctx, { pole: [sc.x0 + 0.2, syTop + 2.2, 0], poleH: 2.6, w: 2.6, h: 1.8, sheet: 'flags_a', flag: 'castile', phase: 0.2, wood, nu: byLod(ctx, 6, 2, 1), nv: byLod(ctx, 4, 2, 1) });

  // --- stores ---
  barrel(ctx, timber, iron, [bc.x0 - 1.2, deck, 1.2], 0.4, 0.95);
  barrel(ctx, timber, iron, [sc.x1 + 2.2, deck, -1.4], 0.4, 0.95);
  ropeCoil(ctx, rope, [bc.x0 - 2.4, deck, -1.3], 0.45);
  for (const sgn of [-1, 1]) anchorProp(ctx, timber, iron, [bc.x0 + 1.5, deck - 0.4, sgn * (o.z + 0.3)]);
  return b.data();
}
