/**
 * The square-rigged ships of 1588, all from one plan type (armadaPlans.ts): the English race-built galleons (Ark Royal,
 * Revenge), the high-charged Spanish galleons (San Martín), the round Baltic urca, the English pinnace and the Calais
 * fireship. A carvel hull with tumblehome, painted upper works between black wales, gun ports with their lids triced
 * up on one or two tiers, fore and aft castles stacked in storeys, a beakhead, a carved transom with stern lanterns, and
 * three or four masts: square courses and topsails on fore and main, lateens on the mizzen and bonaventure.
 */
import { buildAnchorsFor, castleTop, hullSection, sailPlanOf, sailSideZ, sailStack, sideZ, type HullPlan } from '../anchors';
import type { CastleTier, SailPlan } from '../armadaPlans';
import type { ShipKind } from '../../sim/types';
import { SHIP_SPECS } from '../../sim/catalog';
import type { Faction } from './atlas';
import {
  anchorProp,
  barrel,
  byLod,
  cannon,
  clothPatch,
  deckPlane,
  flag,
  hatch,
  lantern,
  lanternPole,
  loftHull,
  longPennant,
  mast,
  mulberry32,
  ropeCoil,
  type Ctx,
  type Lod,
} from './common';
import { box, cylinder, grid, lerp, MeshBuilder, paints, polygon, rectSection, sweep, xlate, type MeshData, type Paint, type V3 } from './parts';
import { fightingTop, lateenSail, line, shrouds, squareSail } from './rig';

/** Flags each navy flies: masthead flags by mast, the ensign at the stern, the streamer patches. */
const FLAGS: Record<'england' | 'spain', { mast: [string, string][]; command: [string, string]; ensign: [string, string]; streamer: [string, string][] }> = {
  england: {
    mast: [['flags_a', 'stgeorge'], ['flags_a', 'stgeorge'], ['flags_a', 'stgeorge'], ['flags_b', 'rose']],
    command: ['flags_a', 'royal'],
    ensign: ['flags_a', 'ensign'],
    streamer: [['flags_b', 'greenwhite'], ['flags_b', 'white'], ['flags_b', 'red']],
  },
  spain: {
    mast: [['flags_a', 'burgundy'], ['flags_a', 'burgundy'], ['flags_b', 'santiago'], ['flags_a', 'castile']],
    command: ['flags_a', 'virgin'],
    ensign: ['flags_a', 'royal'],
    streamer: [['flags_b', 'redgold'], ['flags_b', 'red'], ['flags_b', 'white']],
  },
};

const smooth = (a: number, c: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (c - a)));
  return t * t * (3 - 2 * t);
};

/**
 * How much narrower the hull is than its plan near the ends, low down: the run aft tucks in under a wide square
 * transom (the "wineglass" stern) and the bow is full at the deck but sharp at the cutwater. 1 at deck height and
 * amidships, so the deck, the upper works and the anchors (taken at deck height) are unchanged.
 */
function endShape(h: HullPlan, x: number, y: number) {
  const s = (2 * x) / h.length;
  const v = Math.min(1, Math.max(0, (y + h.draft) / (h.deck + h.draft)));
  const aft = smooth(-0.55, -1.0, s) * 0.8 * (1 - smooth(0.42, 0.88, v));
  const fore = smooth(0.5, 1.0, s) * 0.55 * (1 - smooth(0.45, 1.0, v));
  return 1 - aft - fore;
}

/** Outer half breadth of the shaped hull at (x, y), for parts laid on the hull's side. */
const hullZ = (h: HullPlan, x: number, y: number) => sideZ(h, x, Math.min(y, h.deck)) * endShape(h, x, y);

/** The hull skin lofted through the plan's sections narrowed by endShape, with its end plates. */
function loftShaped(ctx: Ctx, h: HullPlan, skin: Paint) {
  const n = byLod(ctx, 40, 16, 8);
  const step = byLod(ctx, 1, 2, 4);
  const rows: V3[][] = [];
  for (let i = 0; i < n; i += 1) {
    const t = i / (n - 1);
    const x = -h.length / 2 + h.length * (0.65 * t + 0.35 * (0.5 - 0.5 * Math.cos(t * Math.PI)));
    const sec = hullSection(h, x).filter((_, k, arr) => k % step === 0 || k === arr.length - 1).map(([z, y]): [number, number] => [z * endShape(h, x, y), y]);
    rows.push([...sec.map(([z, y]): V3 => [x, y, -z]).reverse(), ...sec.slice(1).map(([z, y]): V3 => [x, y, z])]);
  }
  grid(ctx.b, skin, rows);
  const endUv = (p: V3) => skin.map(p[2], p[1]);
  polygon(ctx.b, skin, rows[rows.length - 1]!, [1, 0, 0], endUv);
  polygon(ctx.b, skin, rows[0]!, [-1, 0, 0], endUv);
}

/** A painted band on the shaped hull's side between two heights, both beams (hullBand on the plan). */
function shapedBand(ctx: Ctx, h: HullPlan, paint: Paint, x0: number, x1: number, lo: number, hi: number, off: number) {
  const n = byLod(ctx, 30, 12, 6);
  const m = byLod(ctx, 4, 2, 1);
  for (const sgn of [-1, 1]) {
    const P: V3[][] = [];
    for (let i = 0; i <= n; i += 1) {
      const x = lerp(x0, x1, i / n);
      const row: V3[] = [];
      for (let j = 0; j <= m; j += 1) {
        const y = lerp(lo, hi, j / m);
        row.push([x, y, sgn * (hullZ(h, x, y) + off)]);
      }
      P.push(row);
    }
    grid(ctx.b, paint, P, { flip: sgn < 0 });
  }
}

/** A wale (a heavy timber along the side) on the shaped hull at height y, both beams. */
function shapedWale(ctx: Ctx, h: HullPlan, paint: Paint, x0: number, x1: number, y: number, thick: number, tall: number, off: number) {
  const n = Math.max(4, Math.round((x1 - x0) / byLod(ctx, 1.6, 3, 6)));
  for (const sgn of [-1, 1]) {
    const path: V3[] = [];
    for (let i = 0; i <= n; i += 1) {
      const x = lerp(x0, x1, i / n);
      path.push([x, y, sgn * (hullZ(h, x, y) + off)]);
    }
    sweep(ctx.b, paint, path, rectSection(thick, tall), { caps: true });
  }
}

type Walls = { out: Paint; inner: Paint; thick: number };

/**
 * One side wall of the upper works from x0 to x1 between heights lo and hi, both faces and a cap, on both beams.
 * The outer face follows the leaning side (sailSideZ).
 */
function upperWall(ctx: Ctx, plan: SailPlan, x0: number, x1: number, lo: number, hiAt: number | ((x: number) => number), w: Walls, cap = true) {
  const roof = typeof hiAt === 'number' ? () => hiAt : hiAt;
  if (x1 - x0 < 0.05) return;
  const n = Math.max(typeof hiAt === 'number' ? 1 : byLod(ctx, 6, 3, 1), Math.round((x1 - x0) / byLod(ctx, 1.4, 3, 12)));
  const zAt = (x: number, y: number) => sailSideZ(plan, x, y);
  for (const sgn of [-1, 1]) {
    const outer: V3[][] = [];
    const inner: V3[][] = [];
    const top: V3[][] = [];
    for (let i = 0; i <= n; i += 1) {
      const x = lerp(x0, x1, i / n);
      const hi = roof(x);
      outer.push([[x, lo, sgn * zAt(x, lo)], [x, hi, sgn * zAt(x, hi)]]);
      inner.push([[x, lo, sgn * (zAt(x, lo) - w.thick)], [x, hi, sgn * (zAt(x, hi) - w.thick)]]);
      top.push([[x, hi, sgn * (zAt(x, hi) - w.thick)], [x, hi, sgn * zAt(x, hi)]]);
    }
    grid(ctx.b, w.out, outer, { flip: sgn > 0, uvFn: (i, j) => w.out.map(outer[i]![j]![0], outer[i]![j]![1]) });
    if (ctx.lod < 2) grid(ctx.b, w.inner, inner, { flip: sgn < 0, uvFn: (i, j) => w.inner.map(inner[i]![j]![0], inner[i]![j]![1]) });
    if (cap && ctx.lod < 2) grid(ctx.b, w.inner, top, { flip: sgn > 0 });
  }
}

/** A wall across the ship at station x between heights lo and hi, facing `face` (+1 bow-ward, -1 stern-ward). */
function crossWall(ctx: Ctx, plan: SailPlan, paint: Paint, x: number, lo: number, hi: number, face: 1 | -1, inset = 0) {
  const zl = sailSideZ(plan, x, lo) - inset;
  const zh = sailSideZ(plan, x, hi) - inset;
  const pts: [V3, V3, V3, V3] = face > 0 ? [[x, lo, zl], [x, lo, -zl], [x, hi, -zh], [x, hi, zh]] : [[x, lo, -zl], [x, lo, zl], [x, hi, zh], [x, hi, -zh]];
  ctx.b.quadF(paint, pts, [face, 0, 0], pts.map((p) => paint.map(p[2], p[1])) as [[number, number], [number, number], [number, number], [number, number]]);
}

/** A horizontal deck (castle roof, overhang underside) between x0 and x1 at height y, inset from the sides. */
function flatDeck(ctx: Ctx, plan: SailPlan, paint: Paint, x0: number, x1: number, y: number, inset: number, down = false) {
  const n = Math.max(1, Math.round((x1 - x0) / byLod(ctx, 2, 4, 8)));
  const P: V3[][] = [];
  for (let i = 0; i <= n; i += 1) {
    const x = lerp(x0, x1, i / n);
    const z = sailSideZ(plan, x, y) - inset;
    P.push([[x, y, -z], [x, y, z]]);
  }
  grid(ctx.b, paint, P, { flip: !down, uvFn: (i, j) => paint.map(P[i]![j]![0], P[i]![j]![2]) });
}

/** A moulding strip along the outer side between x0 and x1 at height y, both beams. */
function moulding(ctx: Ctx, plan: SailPlan, paint: Paint, x0: number, x1: number, y: number, tall: number, out = 0.04) {
  if (ctx.lod > 1 || x1 - x0 < 0.2) return;
  const n = Math.max(2, Math.round((x1 - x0) / byLod(ctx, 1.6, 4, 8)));
  for (const sgn of [-1, 1]) {
    const path: V3[] = [];
    for (let i = 0; i <= n; i += 1) {
      const x = lerp(x0, x1, i / n);
      path.push([x, y, sgn * (sailSideZ(plan, x, y) + out)]);
    }
    sweep(ctx.b, paint, path, rectSection(0.1, tall), { caps: true });
  }
}

/** A painted strip (pavesses, gilt friezes) a hand proud of the upper works between two heights, both beams. */
function strip(ctx: Ctx, plan: SailPlan, paint: Paint, x0: number, x1: number, lo: number, hi: number, out = 0.03) {
  if (ctx.lod > 1 || x1 - x0 < 0.2) return;
  const n = Math.max(1, Math.round((x1 - x0) / byLod(ctx, 1.4, 3, 8)));
  for (const sgn of [-1, 1]) {
    const P: V3[][] = [];
    for (let i = 0; i <= n; i += 1) {
      const x = lerp(x0, x1, i / n);
      P.push([[x, lo, sgn * (sailSideZ(plan, x, lo) + out)], [x, hi, sgn * (sailSideZ(plan, x, hi) + out)]]);
    }
    grid(ctx.b, paint, P, { flip: sgn > 0, uvFn: (i, j) => paint.map(P[i]![j]![0], P[i]![j]![1]) });
  }
}

/** The castle storeys at one end: walls, roof decks, parapets on the part of each roof no storey stands on, end bulkheads. */
function castle(ctx: Ctx, plan: SailPlan, tiers: CastleTier[], aft: boolean, P: Record<string, Paint>, englishRail: boolean) {
  const deck = plan.hull.deck;
  const stack = sailStack(tiers, deck);
  const walls: Walls = { out: P.castle!, inner: P.inner!, thick: 0.22 };
  const rail = 0.95;
  stack.forEach((t, k) => {
    const next = stack[k + 1];
    upperWall(ctx, plan, t.x0, t.x1, t.y0, t.y1, walls, !next);
    flatDeck(ctx, plan, P.deck!, t.x0, t.x1, t.y1, 0.1);
    if (ctx.lod < 2 && (k > 0 || t.x1 > plan.hull.length / 2 || t.x0 < -plan.hull.length / 2)) flatDeck(ctx, plan, P.castle!, t.x0, t.x1, t.y0 - 0.02, 0.02, true);
    // Parapet round the open part of this roof.
    const open: [number, number] = next ? (aft ? [next.x1, t.x1] : [t.x0, next.x0]) : [t.x0, t.x1];
    // The top storey's rail sweeps up towards the ship's end, as the carved rails of the period did, instead of a flat box top.
    const end = aft ? t.x0 : t.x1;
    const sweepUp = next ? () => t.y1 + rail : (x: number) => t.y1 + rail + 0.7 * smooth(aft ? t.x1 : t.x0, end, x);
    upperWall(ctx, plan, open[0], open[1], t.y1, sweepUp, walls);
    if (k > 0 && ctx.lod === 0) {
      // Carved corbels under the storey's floor where it meets the storey below.
      const m = Math.max(2, Math.floor((t.x1 - t.x0) / 1.6));
      for (let i = 0; i <= m; i += 1) {
        const x = lerp(t.x0 + 0.3, t.x1 - 0.3, i / m);
        for (const sgn of [-1, 1]) {
          const z = sgn * sailSideZ(plan, x, t.y0);
          box(ctx.b, P.gilt!, [x - 0.1, t.y0 - 0.45, Math.min(z, z + sgn * 0.18)], [x + 0.1, t.y0 + 0.05, Math.max(z, z + sgn * 0.18)], { grain: 1 });
        }
      }
    }
    if (englishRail) strip(ctx, plan, P.pavesse!, open[0], open[1], t.y1 + 0.05, t.y1 + rail - 0.02);
    // Bulkhead facing the waist and the breastwork on its roof edge.
    const xf = aft ? t.x1 : t.x0;
    const face = aft ? 1 : -1;
    crossWall(ctx, plan, P.bulkhead!, xf, t.y0, t.y1, face, 0.02);
    crossWall(ctx, plan, P.castle!, xf, t.y1, t.y1 + rail, face, 0.05);
    if (ctx.lod < 2) crossWall(ctx, plan, P.castle!, xf - face * 0.2, t.y1, t.y1 + rail, (-face) as 1 | -1, 0.05);
    // End face over the stern or the bow.
    const xe = aft ? t.x0 : t.x1;
    crossWall(ctx, plan, P.castle!, xe, t.y0, t.y1 + (next ? 0 : rail + 0.7), (-face) as 1 | -1);
    if (!next && ctx.lod < 2) crossWall(ctx, plan, P.inner!, xe + face * 0.2, t.y1, t.y1 + rail, face as 1 | -1, 0.2);
    moulding(ctx, plan, P.gilt!, t.x0, t.x1, t.y1 - 0.05, 0.2);
    // A row of small windows (cabins, loopholes for the arquebusiers) along the upper storeys, between carved pilasters.
    if (k > 0 && ctx.lod < 2) {
      const n = Math.floor((t.x1 - t.x0 - 1.2) / 1.7);
      for (let i = 0; i < n; i += 1) {
        const x = t.x0 + 0.9 + (i + 0.5) * ((t.x1 - t.x0 - 1.8) / n);
        const y = (t.y0 + t.y1) / 2 + 0.1;
        for (const sgn of [-1, 1]) {
          const z = sgn * (sailSideZ(plan, x, y) + 0.03);
          ctx.b.quadF(P.dark!, [[x - 0.32, y - 0.4, z], [x + 0.32, y - 0.4, z], [x + 0.32, y + 0.4, z], [x - 0.32, y + 0.4, z]], [0, 0, sgn]);
          if (ctx.lod === 0) box(ctx.b, P.gilt!, [x - 0.42, y - 0.5, z - 0.06], [x + 0.42, y - 0.4, z + 0.06], { grain: 0 });
        }
      }
    }
    if (ctx.lod === 0) {
      // Doors and loopholes in the bulkhead.
      const xd = xf + face * 0.03;
      for (const z of [-1.2, 1.2]) {
        if (sailSideZ(plan, xf, t.y0) < 2.2) continue;
        ctx.b.quadF(P.dark!, [[xd, t.y0, z - 0.45], [xd, t.y0, z + 0.45], [xd, t.y0 + 1.7, z + 0.45], [xd, t.y0 + 1.7, z - 0.45]], [face, 0, 0]);
      }
    }
  });
}

/** Square ports on the hull or upper works with the lid triced up above each, and the gun run out through it. */
function gunPorts(ctx: Ctx, plan: SailPlan, anchors: ReturnType<typeof buildAnchorsFor>, P: Record<string, Paint>) {
  if (!anchors || ctx.lod > 1) return;
  const deck = plan.hull.deck;
  for (const g of anchors.gunPorts) {
    const [x, y] = g.pos;
    if (g.side === 2) {
      const xf = x - 0.13;
      ctx.b.quadF(P.dark!, [[xf, y - 0.36, g.pos[2] + 0.36], [xf, y - 0.36, g.pos[2] - 0.36], [xf, y + 0.36, g.pos[2] - 0.36], [xf, y + 0.36, g.pos[2] + 0.36]], [1, 0, 0]);
      cannon(ctx, [xf, y, g.pos[2]], [1, 0, 0], g.gun, P.timber!, P.bronze!, P.iron!);
      continue;
    }
    const sgn = g.side === 0 ? -1 : 1;
    const onRail = y > deck + castleTop(plan, x) + 0.5;
    if (onRail) {
      // A swivel gun on its iron yoke on the rail.
      if (ctx.lod > 0) continue;
      const z = g.pos[2];
      cylinder(ctx.b, P.iron!, [x, y - 0.35, z], [x, y, z], 0.05, 0.05, 5, true);
      cylinder(ctx.b, P.iron!, [x, y + 0.04, z - sgn * 0.7], [x, y + 0.04, z + sgn * 0.75], 0.07, 0.06, 6, true);
      continue;
    }
    const z = sgn * (sailSideZ(plan, x, y) + 0.025);
    const s = 0.36;
    ctx.b.quadF(P.dark!, [[x - s, y - s, z], [x + s, y - s, z], [x + s, y + s, z], [x - s, y + s, z]], [0, 0, sgn]);
    // The lid hinged at the head of the port, swung up and out.
    const zl = z + sgn * 0.5;
    const yl = y + s + 0.42;
    const lid: [V3, V3, V3, V3] = [[x - s - 0.04, y + s, z], [x + s + 0.04, y + s, z], [x + s + 0.04, yl, zl], [x - s - 0.04, yl, zl]];
    ctx.b.quadF(P.lid!, lid, [0, 0.6, sgn]);
    ctx.b.quadF(P.lid!, [lid[1], lid[0], lid[3], lid[2]], [0, -0.6, -sgn]);
    if (ctx.lod === 0) line(ctx, P.rope!, [x, yl, zl], [x, y + s + 1.2, z - sgn * 0.05], 0.03);
    cannon(ctx, [x, y, z], [0, 0, sgn], g.gun, P.timber!, P.bronze!, P.iron!);
  }
}

/** A ship's boat stowed in the waist. */
const BOAT: HullPlan = { length: 6.5, beam: 1.9, draft: 0.45, deck: 0.55, flat: 0.3, bilge: 0.4, mid: 0.2, bowF: 0.15, sternF: 0.55, rise: 0.4, risePow: 2, flare: 0.25, taper: 1.2 };

export function buildSailShip(kind: ShipKind, variant: number, lod: Lod): MeshData {
  const plan = sailPlanOf(kind, variant)!;
  const anchors = buildAnchorsFor(`${kind}#${variant}`)!;
  const faction = SHIP_SPECS[kind].faction as Faction & ('england' | 'spain');
  const b = new MeshBuilder();
  const ctx: Ctx = { b, lod, faction, P: paints(faction), rnd: mulberry32(plan.seed) };
  const Pn = ctx.P;
  const h = plan.hull;
  const L = h.length;
  const deck = h.deck;
  const old = plan.fire ? 0.72 : 1;
  const tint = (k: number): V3 => [k * old, k * old * 0.97, k * old * 0.94];
  const P: Record<string, Paint> = {
    hull: Pn('hull_plank', { tint: tint(0.95) }),
    livery: Pn(plan.livery, { tint: tint(1.3) }),
    castle: Pn(plan.castleLivery, { tint: tint(1.3) }),
    inner: Pn('deck_plank', { tint: tint(0.7) }),
    deck: Pn('deck_plank', { tint: tint(1) }),
    bulkhead: Pn('cabin_wood', { tint: tint(0.95) }),
    gilt: Pn('gilt', { tint: tint(plan.fire ? 0.6 : 1) }),
    wale: Pn('hull_plank', { tint: [0.32, 0.29, 0.27] }),
    timber: Pn('hull_plank', { tint: [0.55, 0.5, 0.46] }),
    dark: Pn('hull_plank', { tint: [0.09, 0.08, 0.07] }),
    lid: Pn(faction === 'england' ? 'ochre_paint' : 'red_paint', { tint: tint(1.05) }),
    wood: Pn('mast_wood', { tint: tint(0.95) }),
    rope: Pn('rope'),
    bronze: Pn('bronze', { tint: [1.15, 1.0, 0.85] }),
    iron: Pn('iron'),
    canvas: Pn('sail_canvas', { tint: plan.fire ? [0.78, 0.74, 0.68] : [1, 1, 1] }),
    cross: Pn('sail_cross', { rect: [0.012, 0.012, 0.988, 0.988] }),
    saint: Pn(faction === 'spain' ? 'sail_saint' : 'sail_cross', { rect: [0.012, 0.012, 0.988, 0.988] }),
  };
  if (faction === 'england') P.pavesse = Pn('pavesse');
  const english = faction === 'england' && !plan.fire;

  // --- hull: planking, painted upper strakes between black wales, deck ---
  loftShaped(ctx, h, P.hull!);
  const band0 = deck - Math.min(2.6, deck * 0.42);
  shapedBand(ctx, h, P.livery!, -L / 2 + 0.05, L / 2 - 0.1, band0, deck - 0.02, 0.035);
  const wales = deck > 3 ? [band0 - 0.1, deck - 0.75 - (deck - band0) * 0.35] : [band0 - 0.08];
  for (const y of lod < 2 ? wales : wales.slice(0, 1)) shapedWale(ctx, h, P.wale!, -L / 2 + 0.1, L / 2 - 0.2, y, 0.16, 0.26, 0.07);
  if (lod < 2 && deck > 3) shapedWale(ctx, h, P.wale!, -L / 2 + 0.4, L / 2 - 0.8, deck * 0.32, 0.14, 0.22, 0.06);
  deckPlane(ctx, h, P.deck!, -L / 2 + 0.15, L / 2 - 0.15, deck, 0.03);

  // --- upper works: waist bulwark, castles ---
  const waist0 = plan.aft.length ? plan.aft[0]!.x1 : -L / 2 + 0.3;
  const waist1 = plan.fore.length ? plan.fore[0]!.x0 : L / 2 - 0.3;
  const walls: Walls = { out: P.livery!, inner: P.inner!, thick: 0.2 };
  upperWall(ctx, plan, waist0, waist1, deck, deck + plan.rail, walls);
  if (english) strip(ctx, plan, P.pavesse!, waist0 + 0.2, waist1 - 0.2, deck + plan.rail - 0.85, deck + plan.rail - 0.02);
  else moulding(ctx, plan, P.gilt!, waist0, waist1, deck + plan.rail - 0.08, 0.16);
  moulding(ctx, plan, P.wale!, -L / 2 + 0.2, L / 2 - 0.3, deck + 0.05, 0.22, 0.05);
  castle(ctx, plan, plan.aft, true, P, english);
  castle(ctx, plan, plan.fore, false, P, english);
  gunPorts(ctx, plan, anchors, P);

  // --- stern: carved transom, gallery, rudder, lanterns ---
  const aft = sailStack(plan.aft, deck);
  const top = aft[aft.length - 1]!;
  if (aft.length && !plan.fire) {
    const t0 = aft[0]!;
    const xs = t0.x0 - 0.02;
    const zw = sailSideZ(plan, t0.x0, t0.y1) * 0.82;
    const panel = Pn('stern_panel', { rect: [0.02, 0.02, 0.98, 0.98], surf: 3, tint: [1.35, 1.3, 1.25] });
    if (lod < 2) ctx.b.quadF(panel, [[xs, t0.y0 + 0.1, zw], [xs, t0.y0 + 0.1, -zw], [xs, t0.y1 - 0.1, -zw], [xs, t0.y1 - 0.1, zw]], [-1, 0, 0], [[0, 0], [1, 0], [1, 1], [0, 1]]);
    if (aft.length > 1 && lod < 2) {
      // The stern gallery: a walk with a balustrade across the transom at the second storey.
      const t1 = aft[1]!;
      const gz = sailSideZ(plan, t1.x0, t1.y0) * 0.9;
      box(ctx.b, P.bulkhead!, [t1.x0 - 1.0, t1.y0 - 0.15, -gz], [t1.x0, t1.y0 + 0.05, gz], { grain: 2 });
      box(ctx.b, P.gilt!, [t1.x0 - 1.0, t1.y0 + 0.05, -gz], [t1.x0 - 0.88, t1.y0 + 1.0, gz], { grain: 2 });
      if (lod === 0) for (let k = 0; k <= 8; k += 1) cylinder(ctx.b, P.gilt!, [t1.x0 - 0.95, t1.y0 + 0.05, lerp(-gz, gz, k / 8)], [t1.x0 - 0.95, t1.y0 + 1.0, lerp(-gz, gz, k / 8)], 0.05, 0.05, 4, false);
      // Quarter galleries on the sides near the stern.
      for (const sgn of [-1, 1]) {
        const z = sgn * sailSideZ(plan, t0.x0 + 2, t0.y0 + 1);
        box(ctx.b, P.bulkhead!, [t0.x0 + 0.6, t0.y0 + 0.2, Math.min(z, z + sgn * 0.7)], [t0.x0 + 3.2, t0.y1 + 0.6, Math.max(z, z + sgn * 0.7)], { grain: 0 });
        box(ctx.b, P.gilt!, [t0.x0 + 0.5, t0.y1 + 0.6, Math.min(z, z + sgn * 0.85)], [t0.x0 + 3.3, t0.y1 + 0.8, Math.max(z, z + sgn * 0.85)], { grain: 0 });
      }
    }
  }
  if (lod < 2) {
    const kx = -L / 2;
    box(ctx.b, P.timber!, [kx - 0.7, -h.draft + h.rise * 0.9, -0.22], [kx - 0.02, deck - 0.4, 0.22], { grain: 1 });
  }
  for (const l of anchors.lanterns) {
    lantern(ctx, Pn('gilt', { tint: [1.5, 1.25, 0.9] }), P.iron!, l, l[2] === 0 ? 0.42 : 0.32);
    lanternPole(ctx, P.iron!, l, top.y1 + 0.9, 0.55, 0);
  }

  // --- bow: stem, beakhead with its rails and figure ---
  if (plan.beak > 0) {
    const xb = L / 2;
    const yb = deck - Math.min(1.8, deck * 0.4);
    const tip: V3 = [xb + plan.beak, yb + 0.9, 0];
    sweep(ctx.b, P.timber!, [[xb - 0.8, yb - 0.3, 0], [xb + plan.beak * 0.5, yb + 0.25, 0], tip], rectSection(0.45, 0.9), { caps: true, up: [0, 0, 1] });
    sweep(ctx.b, P.timber!, [[xb - 0.05, -h.draft + h.rise, 0], [xb + 0.35, yb * 0.3, 0], [xb + 0.35, yb - 0.2, 0]], rectSection(0.4, 0.5), { caps: true, up: [0, 0, 1] });
    if (lod < 2) {
      // The beakhead deck and its curved head rails up to the forecastle.
      box(ctx.b, P.deck!, [xb, yb + 0.4, -0.75], [xb + plan.beak * 0.72, yb + 0.55, 0.75], { grain: 0 });
      const fx = plan.fore.length ? Math.min(plan.fore[0]!.x1, xb) : xb;
      for (const sgn of [-1, 1]) {
        sweep(ctx.b, P.gilt!, [tip, [xb + plan.beak * 0.55, yb + 1.05, sgn * 0.7], [fx, deck + 0.4, sgn * sailSideZ(plan, fx, deck + 0.4)]], rectSection(0.12, 0.16), { caps: true });
        sweep(ctx.b, P.livery!, [[xb + plan.beak * 0.8, yb + 0.6, 0], [xb + plan.beak * 0.4, yb + 0.5, sgn * 0.75], [fx, deck - 0.4, sgn * sailSideZ(plan, fx, deck - 0.4)]], rectSection(0.1, 0.18), { caps: true });
      }
      // A rampant lion for England, a gilded saint's figure for Spain: both a gilt carving at the beak's tip.
      box(ctx.b, P.gilt!, [tip[0] - 0.35, tip[1] - 0.1, -0.22], [tip[0] + 0.15, tip[1] + 0.9, 0.22], { grain: 1 });
      if (lod === 0) cylinder(ctx.b, P.gilt!, [tip[0] - 0.05, tip[1] + 0.9, 0], [tip[0] + 0.1, tip[1] + 1.3, 0], 0.2, 0.12, 6, true);
    }
  }

  // --- rig ---
  const fl = FLAGS[faction];
  const sheetFoot = (x: number, sgn: number): V3 => [x, deck + castleTop(plan, x) + plan.rail, sgn * (sailSideZ(plan, x, deck + castleTop(plan, x) + plan.rail) - 0.1)];
  plan.masts.forEach((m, i) => {
    const topY = deck + m.top;
    mast(ctx, P.wood!, P.iron!, m.x, deck, m.h, m.r);
    if (m.top > 0) {
      fightingTop(ctx, P.timber!, P.castle!, m.x, topY, 0.9 + m.r * 2.2);
      if (lod < 2) box(ctx.b, P.timber!, [m.x - m.r * 1.3, topY - 1.4, -m.r * 1.3], [m.x + m.r * 1.3, topY - 0.25, m.r * 1.3], { grain: 1 });
    }
    // Lower shrouds to the ship's side, topmast shrouds to the rim of the top.
    const yFoot = (x: number) => deck + castleTop(plan, x) + plan.rail * 0.6;
    shrouds(ctx, P.rope!, m.x, (m.top || m.h * 0.7) + deck - 0.3, (sgn, dx) => {
      const x = m.x + dx;
      return [x, yFoot(x), sgn * (sailSideZ(plan, x, yFoot(x)) + 0.3)];
    }, [-2.6, -1.7, -0.8, 0.1].map((d) => d * Math.min(1, m.h / 20)), m.r, P.wale);
    if (lod === 0) {
      // Chain wales: the planks outboard that spread the shrouds.
      for (const sgn of [-1, 1]) {
        const x0 = m.x - 2.8 * Math.min(1, m.h / 20);
        const x1 = m.x + 0.4;
        const y = yFoot(m.x) - 0.25;
        const z = sgn * sailSideZ(plan, m.x, y);
        box(ctx.b, P.wale!, [x0, y - 0.08, Math.min(z, z + sgn * 0.45)], [x1, y + 0.08, Math.max(z, z + sgn * 0.45)], { grain: 0 });
      }
    }
    if (m.top > 0) shrouds(ctx, P.rope!, m.x, deck + m.h - 1.4, (sgn, dx) => [m.x + dx * 0.4, topY + 0.1, sgn * (0.8 + m.r * 2)], [-1.6, -0.6, 0.4], m.r * 0.6);
    m.yards.forEach((yd, k) => {
      const cloth = yd.cloth === 'cross' ? P.cross! : yd.cloth === 'saint' ? P.saint! : P.canvas!;
      const billow = Math.min(2.2, yd.h * 0.2);
      const [c0, c1] = squareSail(ctx, cloth, P.wood!, { x: m.x, y: deck + yd.up, w: yd.w, foot: yd.foot, h: yd.h, billow, yaw: m.yaw, phase: i * 1.7 + k * 0.6, furled: yd.furled });
      if (lod === 0 && !yd.furled) {
        // Sheets aft to the side, braces from the yard arms aft.
        if (k === 0) for (const [c, sgn] of [[c0, -1], [c1, 1]] as [V3, number][]) line(ctx, P.rope!, c, sheetFoot(Math.max(-L / 2 + 1, m.x - yd.h * 0.6), sgn));
        const aftMast = plan.masts[i + 1];
        if (aftMast) for (const sgn of [-1, 1]) line(ctx, P.rope!, [m.x + 0.5, deck + yd.up, sgn * (yd.w / 2 + 0.6)], [aftMast.x, deck + Math.min(aftMast.h * 0.6, yd.up), 0], 0.035);
      }
    });
    if (m.lateen) {
      lateenSail(ctx, P.canvas!, P.wood!, { x: m.x, y: deck + m.h * 0.72, len: m.lateen.len, fore: m.lateen.fore, tilt: m.lateen.tilt, h: m.lateen.h, phase: i * 1.3, billow: Math.min(1.6, m.lateen.h * 0.16) });
    }
    // Flags at the mast heads and the streamers.
    if (lod < 2) {
      const [sheet, name] = plan.flagship && i === 1 ? fl.command : fl.mast[i % fl.mast.length]!;
      const big = plan.flagship && i === 1 ? 1.35 : 1;
      flag(ctx, { pole: [m.x, deck + m.h, 0], poleH: 2.2, w: 3.0 * big * Math.min(1, m.h / 22), h: 2.0 * big * Math.min(1, m.h / 22), sheet, flag: name, phase: i * 0.9, wood: P.wood!, nu: byLod(ctx, 6, 2, 1), nv: byLod(ctx, 4, 2, 1), flutter: 1.1 });
      if (!plan.fire) {
        const [ss, sn] = fl.streamer[i % fl.streamer.length]!;
        longPennant(ctx, clothPatch(ctx, ss, sn), [m.x - 0.1, deck + m.h - 0.6, 0], Math.min(9, m.h * 0.42), 0.55, i * 1.1);
      }
    }
  });
  // Stays: each mast to the foot of the next mast forward, the foremast to the bowsprit.
  const bow = plan.bowsprit;
  const bsFrom: V3 = [L / 2 - 1.5, deck + 0.7, 0];
  const bsDir: V3 = [Math.cos(bow.angle), Math.sin(bow.angle), 0];
  const bsTip: V3 = [bsFrom[0] + bsDir[0] * bow.len, bsFrom[1] + bsDir[1] * bow.len, 0];
  cylinder(ctx.b, P.wood!, bsFrom, bsTip, 0.12 + bow.len * 0.012, 0.08, byLod(ctx, 7, 5, 3), true);
  if (bow.sprit && lod < 2 && plan.masts[0]?.yards[0]) {
    const at = 0.72;
    const p: V3 = [bsFrom[0] + bsDir[0] * bow.len * at, bsFrom[1] + bsDir[1] * bow.len * at, 0];
    const course = plan.masts[0].yards[0];
    squareSail(ctx, P.canvas!, P.wood!, { x: p[0] - 0.5, y: p[1] - 0.25, w: course.w * 0.55, foot: course.w * 0.6, h: course.h * 0.45, billow: 0.9, yaw: 0, phase: 2.2 });
  }
  if (lod === 0) {
    const ms = plan.masts;
    for (let i = 0; i < ms.length; i += 1) {
      const m = ms[i]!;
      const head: V3 = [m.x + 0.3, deck + (m.top || m.h * 0.7) - 0.2, 0];
      const to: V3 = i === 0 ? [bsFrom[0] + bsDir[0] * bow.len * 0.55, bsFrom[1] + bsDir[1] * bow.len * 0.55, 0] : [ms[i - 1]!.x - 0.4, deck + castleTop(plan, ms[i - 1]!.x) + 0.6, 0];
      line(ctx, P.rope!, head, to, 0.08);
      if (m.top > 0) line(ctx, P.rope!, [m.x + 0.2, deck + m.h - 0.8, 0], i === 0 ? bsTip : [ms[i - 1]!.x, deck + ms[i - 1]!.top + 0.6, 0], 0.05);
    }
  }
  // The ensign on its staff over the stern.
  if (lod < 2) {
    const ex = top.x0 + 0.3;
    flag(ctx, { pole: [ex, top.y1 + 0.5, 0], poleH: 3.0, w: 2.6, h: 1.8, sheet: fl.ensign[0], flag: fl.ensign[1], phase: 0.3, wood: P.wood!, nu: byLod(ctx, 6, 2, 1), nv: byLod(ctx, 4, 2, 1) });
  }

  // --- waist: hatches, capstan, the boat, stores; the fireship's brushwood and pitch ---
  const span = waist1 - waist0;
  const mid = (waist0 + waist1) / 2;
  if (plan.fire) {
    const rnd = ctx.rnd;
    const brush = Pn('mast_wood', { tint: [0.42, 0.36, 0.28] });
    const pitch = Pn('hull_plank', { tint: [0.2, 0.17, 0.15] });
    if (lod < 2) {
      for (let k = 0; k < byLod(ctx, 34, 22, 0); k += 1) {
        const x = lerp(waist0 + 0.6, waist1 - 0.6, rnd());
        const z = (rnd() - 0.5) * 2 * (sailSideZ(plan, x, deck) - 0.8);
        const y = deck + 0.25 + rnd() * 0.8;
        const a = rnd() * Math.PI;
        const l = 1.6 + rnd() * 1.2;
        cylinder(ctx.b, brush, [x - Math.cos(a) * l * 0.5, y, z - Math.sin(a) * l * 0.5], [x + Math.cos(a) * l * 0.5, y + 0.15, z + Math.sin(a) * l * 0.5], 0.28, 0.24, 5, true);
      }
    }
    // A low heap of brushwood that still reads at a distance.
    box(ctx.b, brush, [waist0 + 0.6, deck, -sailSideZ(plan, mid, deck) + 1.0], [waist1 - 0.6, deck + 0.7, sailSideZ(plan, mid, deck) - 1.0], { grain: 0 });
    for (let k = 0; k < 8; k += 1) barrel(ctx, pitch, P.iron!, [lerp(waist0 + 1, waist1 - 1, (k + 0.5) / 8), deck + 0.6, (k % 2 ? 1 : -1) * 1.2], 0.38, 0.85);
  } else {
    hatch(ctx, P.deck!, P.dark!, mid - span * 0.18, deck, 0, Math.min(3, span * 0.15), Math.min(2.2, h.beam * 0.22));
    hatch(ctx, P.deck!, P.dark!, mid + span * 0.22, deck, 0, Math.min(2.4, span * 0.12), Math.min(1.8, h.beam * 0.18));
    if (lod === 0) {
      const cx = waist0 + 1.4;
      cylinder(ctx.b, P.timber!, [cx, deck, 0], [cx, deck + 1.0, 0], 0.42, 0.36, 9, true);
      cylinder(ctx.b, P.timber!, [cx, deck + 0.9, 0], [cx, deck + 1.1, 0], 0.55, 0.55, 9, true);
      for (let k = 0; k < 4; k += 1) {
        const a = (k * Math.PI) / 4;
        cylinder(ctx.b, P.wood!, [cx - Math.cos(a) * 1.4, deck + 1.0, -Math.sin(a) * 1.4], [cx + Math.cos(a) * 1.4, deck + 1.0, Math.sin(a) * 1.4], 0.05, 0.05, 4, true);
      }
    }
    if (span > 14 && lod < 2) b.with(xlate(mid + span * 0.02, deck + 0.75, 0), () => loftHull({ ...ctx }, BOAT, P.timber!, P.timber!));
    for (const [fx, z] of [[0.15, 0.6], [0.85, -0.65]] as [number, number][]) barrel(ctx, P.timber!, P.iron!, [waist0 + span * fx, deck, z * (sailSideZ(plan, waist0 + span * fx, deck) - 0.6)], 0.4, 0.95);
    ropeCoil(ctx, P.rope!, [waist0 + span * 0.4, deck, sailSideZ(plan, waist0 + span * 0.4, deck) - 0.8], 0.45);
    ropeCoil(ctx, P.rope!, [waist0 + span * 0.7, deck, -sailSideZ(plan, waist0 + span * 0.7, deck) + 0.8], 0.4);
  }
  for (const sgn of [-1, 1]) {
    const ax = L / 2 - Math.min(5, L * 0.12);
    anchorProp(ctx, P.timber!, P.iron!, [ax, deck - 0.5, sgn * (hullZ(h, ax, deck - 0.5) + 0.35)]);
  }
  return b.data();
}
