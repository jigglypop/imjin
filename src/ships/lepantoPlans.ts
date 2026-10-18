/**
 * Construction plans of the oared warships of 1571 (the Lepanto chapter), on the galleass plan type: a long low hull,
 * the outrigger (telaro/apostis) carrying the thole pins, a bow platform (the rambade, Ottoman "baş") with the centre-line
 * gun and its flanking pieces firing ahead over the spur, a stern poop under its awning, and lateen masts. Ship space as
 * in anchors.ts: +X bow, +Y up, Z across, origin amidships on the waterline, metres.
 *
 * Sources: J. F. Guilmartin, Gunpowder and Galleys (1974, rev. 2003), app. on galley dimensions (a Venetian galea
 * sottile c. 41-42 m by 5-5.5 m on the hull, 24-26 benches a side alla sensile, one centre-line cannon of 30-50 lb and
 * two to four smaller pieces forward); A. Konstam, Lepanto 1571 (Osprey 2003) for the lanterna flagships (La Real, the
 * Sultana) of 30 or more benches; U. Bellabarba / the Barcelona Museu Marítim replica of La Real (60 m, 30 benches);
 * İ. Bostan, Kadırga ve Kalyata (2005) and Katip Çelebi's Tuhfat al-Kibar for the Ottoman kadırga (25 benches),
 * baştarda (flagship) and kalyata (galiot, 19-24 benches, one mast).
 */
import type { GalleassPlan } from './armadaPlans';

const hull = (length: number, beam: number, deck: number) => ({
  length,
  beam,
  draft: 1.3 + length * 0.006,
  deck,
  flat: 0.45,
  bilge: 1.0,
  mid: 0.32,
  bowF: 0.2,
  sternF: 0.45,
  rise: 0.8,
  risePow: 2.2,
  flare: 0.22,
  taper: 1.3,
});

/** A galley plan from its length, hull beam, benches a side and masts; the bow and stern works scale with the hull. */
function galley(o: { length: number; beam: number; benches: number; masts: GalleassPlan['masts']; bowH?: number; sternH?: number; chase: number[] }): GalleassPlan {
  const L = o.length;
  const half = L / 2;
  return {
    hull: hull(L, o.beam, 1.6 + L * 0.012),
    outrigger: { z: o.beam / 2 + 1.4, up: 0.45, x0: -half + 0.18 * L, x1: half - 0.2 * L },
    oars: { n: o.benches, x0: -half + 0.2 * L, x1: half - 0.22 * L },
    bow: { x0: half - 0.18 * L, x1: half - 0.02 * L, h: o.bowH ?? 1.3 },
    stern: { x0: -half + 0.01 * L, x1: -half + 0.15 * L, h: o.sternH ?? 1.7 },
    spur: 0.1 * L,
    masts: o.masts,
    side: [
      { x: half - 0.06 * L, up: 0.9 },
      { x: half - 0.12 * L, up: 0.9 },
      { x: -half + 0.06 * L, up: 0.9 },
    ],
    chase: { up: (o.bowH ?? 1.3) * 0.6, zs: o.chase },
  };
}

const lateen = (len: number, h: number) => ({ len, fore: 0.45, tilt: 0.52, h });

export const GALLEY_PLANS = {
  /** La Real, Don Juan's lanterna: 30 benches a side, three lateens, the great carved poop. */
  reale: galley({ length: 58, beam: 7.0, benches: 30, bowH: 1.6, sternH: 2.4, chase: [-1.6, -0.8, 0, 0.8, 1.6], masts: [{ x: 18, h: 16, r: 0.3, lateen: lateen(17, 9.5) }, { x: 3, h: 23, r: 0.42, lateen: lateen(26, 14) }] }),
  /** The Venetian galea sottile of the line: 25 benches a side alla sensile, main and fore lateens. */
  galea: galley({ length: 42, beam: 5.4, benches: 25, chase: [-1.1, 0, 1.1], masts: [{ x: 12.5, h: 12, r: 0.24, lateen: lateen(12, 7) }, { x: 2, h: 18, r: 0.34, lateen: lateen(20, 11) }] }),
  /** Müezzinzade Ali Pasha's Sultana (baştarda): 31 benches, the great poop under its green awning. */
  sultana: galley({ length: 56, beam: 6.8, benches: 31, bowH: 1.5, sternH: 2.3, chase: [-1.5, -0.75, 0, 0.75, 1.5], masts: [{ x: 17, h: 15, r: 0.3, lateen: lateen(16, 9) }, { x: 3, h: 22, r: 0.42, lateen: lateen(25, 13.5) }] }),
  /** The Ottoman kadırga: 25 benches, lighter forward battery than a Venetian galley. */
  kadirga: galley({ length: 41, beam: 5.2, benches: 25, chase: [-0.9, 0, 0.9], masts: [{ x: 12, h: 12, r: 0.24, lateen: lateen(12, 7) }, { x: 2, h: 18, r: 0.34, lateen: lateen(20, 11) }] }),
  /** The kalyata (galiot) of the corsairs: 19-20 benches, one mast, fast. */
  kalyata: galley({ length: 30, beam: 4.2, benches: 19, bowH: 1.0, sternH: 1.3, chase: [0], masts: [{ x: 2, h: 14, r: 0.26, lateen: lateen(16, 8.5) }] }),
} satisfies Record<string, GalleassPlan>;

export type GalleyKind = keyof typeof GALLEY_PLANS;
export const isGalleyKind = (k: string): k is GalleyKind => k in GALLEY_PLANS;
