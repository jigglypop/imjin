/**
 * Construction plans of the ships of 1805 (the Trafalgar chapter) on the square-rig plan type of 1588: flush-decked
 * ships of the line with a low forecastle, quarterdeck and poop instead of castles, two to four tiers of gun ports in
 * painted bands, three masts of courses, topsails and topgallants with the spanker on the mizzen. Ship space as in
 * anchors.ts: +X bow, +Y up, Z across, origin amidships on the waterline, metres.
 *
 * Sources: HMS Victory's lines and dimensions (National Maritime Museum draughts; P. Goodwin, The Ships of Trafalgar,
 * 2005): gun deck 56.7 m, beam 15.8 m, three gun decks, the "Nelson chequer" (ochre bands along each tier of ports, black
 * lids); Goodwin and R. Gardiner (ed.), The Line of Battle (1992) for the 74 and the 80-gun ships; J. Harbron, Trafalgar
 * and the Spanish Navy (1988) for the Santísima Trinidad (cut down to four decks of 136 guns in 1795, 61 m) and the
 * Spanish red bands; B. Lavery, The Ship of the Line (1983) for rigs and heights.
 */
import type { HullPlan } from './anchors';
import type { SailPlan, SquareYard } from './armadaPlans';

const yards = (lo: number, w: number, h: number): SquareYard[] => [
  { up: lo, w, foot: w * 1.06, h, cloth: 'saint' },
  { up: lo + h + 1.2, w: w * 0.78, foot: w * 0.98, h: h * 1.05, cloth: 'cross' },
  { up: lo + h * 2.2 + 2.2, w: w * 0.54, foot: w * 0.76, h: h * 0.6, cloth: 'plain' },
];

/** A ship of the line: length, beam, the weather deck's height and the gun tiers (heights above the waterline). */
function line(o: { length: number; beam: number; deck: number; tiers: number[]; ports: number; mast: number; seed: number; flagship?: boolean; band: string; upper: string; poop?: boolean }): SailPlan {
  const L = o.length;
  const half = L / 2;
  const hull: HullPlan = { length: L, beam: o.beam, draft: o.beam * 0.42, deck: o.deck, flat: 0.3, bilge: o.beam * 0.2, mid: 0.3, bowF: 0.52, sternF: 0.78, rise: 1.0, risePow: 2.5, flare: -0.09 * o.beam, taper: 1.4 };
  const xs = Array.from({ length: o.ports }, (_, i) => -half + 0.14 * L + (i * (0.72 * L)) / (o.ports - 1));
  const m = o.mast;
  return {
    hull,
    rail: 1.3,
    tumble: 0.05,
    fore: [{ x0: half - 0.22 * L, x1: half - 0.03 * L, h: 2.0 }],
    aft: o.poop === false ? [{ x0: -half + 0.01 * L, x1: -0.04 * L, h: 2.2 }] : [{ x0: -half + 0.01 * L, x1: -0.04 * L, h: 2.2 }, { x0: -half - 0.005 * L, x1: -half + 0.2 * L, h: 2.1 }],
    beak: 0.07 * L,
    masts: [
      { x: half - 0.16 * L, h: m * 0.88, r: 0.5, top: m * 0.42, yaw: 0.12, yards: yards(m * 0.32, o.beam * 1.55, m * 0.18) },
      { x: 0.02 * L, h: m, r: 0.6, top: m * 0.46, yaw: 0.12, yards: yards(m * 0.36, o.beam * 1.75, m * 0.2) },
      { x: -half + 0.28 * L, h: m * 0.74, r: 0.42, top: m * 0.36, yaw: 0.1, yards: yards(m * 0.4, o.beam * 1.1, m * 0.13).slice(1), lateen: { len: o.beam * 1.2, fore: 0.1, tilt: 0.75, h: m * 0.22 } },
    ],
    bowsprit: { len: 0.32 * L, angle: 0.3, sprit: true },
    tiers: [...o.tiers.map((y) => ({ y, xs })), { y: 0.9, xs: [-half + 0.12 * L, -0.15 * L, half - 0.12 * L], castle: true }],
    chase: { up: 1.0, z: 1.4 },
    livery: o.band,
    castleLivery: o.upper,
    flagship: o.flagship ?? false,
    seed: o.seed,
    bands: o.tiers.map((y) => [y - 0.55, y + 0.55]),
  };
}

export const SHIPS_1805: Record<string, SailPlan[]> = {
  /** HMS Victory (Nelson) and the Royal Sovereign (Collingwood): first-rates of 100 guns on three decks. */
  firstrate: [line({ length: 57, beam: 15.8, deck: 9.4, tiers: [2.6, 5.0, 7.4], ports: 14, mast: 50, seed: 1805, flagship: true, band: 'red_paint', upper: 'black_paint' })],
  /** The British 74: two gun decks, the line's workhorse (Bellerophon, Mars, Colossus). */
  gb74: [line({ length: 51, beam: 14.2, deck: 7.6, tiers: [2.5, 5.0], ports: 14, mast: 45, seed: 1806, band: 'red_paint', upper: 'black_paint' })],
  /** A British frigate of 36 guns (Euryalus, Naiad), Blackwood's repeating ship: one gun deck. */
  gbfrigate: [line({ length: 44, beam: 11.6, deck: 5.2, tiers: [3.2], ports: 13, mast: 38, seed: 1807, band: 'red_paint', upper: 'black_paint', poop: false })],
  /** The Bucentaure (Villeneuve), French 80: two gun decks, longer than a 74. */
  fr80: [line({ length: 56, beam: 15.0, deck: 8.0, tiers: [2.6, 5.2], ports: 15, mast: 48, seed: 1808, flagship: true, band: 'red_paint', upper: 'black_paint' })],
  /** The French 74 (Redoutable, Lucas): two gun decks. */
  fr74: [line({ length: 52, beam: 14.4, deck: 7.6, tiers: [2.5, 5.0], ports: 14, mast: 45, seed: 1809, band: 'red_paint', upper: 'black_paint' })],
  /** Nuestra Señora de la Santísima Trinidad: the only four-decker, 136 guns (Harbron). */
  trinidad: [line({ length: 61, beam: 16.6, deck: 11.8, tiers: [2.6, 5.0, 7.4, 9.8], ports: 15, mast: 54, seed: 1810, flagship: true, band: 'red_paint', upper: 'black_paint' })],
  /** The Spanish 74 (San Juan Nepomuceno, Churruca). */
  es74: [line({ length: 52, beam: 14.6, deck: 7.6, tiers: [2.5, 5.0], ports: 14, mast: 45, seed: 1811, band: 'red_paint', upper: 'black_paint' })],
};
