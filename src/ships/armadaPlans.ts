/**
 * Construction plans of the 1588 ships (the Armada chapter): pure data like the rest of anchors.ts, which turns them
 * into anchors. Ship space as there: +X bow, +Y up, Z across, origin amidships on the waterline, metres.
 *
 * Sources for the shapes: the Ark Royal woodcut of 1587 and the Matthew Baker "Fragments of Ancient English
 * Shipwrightry" (c. 1586) for the race-built galleons (long sharp hull, low castles, four masts with a bonaventure
 * mizzen); the Armada tapestries' engravings (John Pine 1739) and Spanish galleon draughts for the high-charged
 * Spanish galleons; the Girona wreck and Neapolitan galleass drawings for the galleass; Bruegel's and Dutch prints of
 * hulks for the urca.
 */
import type { HullPlan } from './anchors';

/** One square sail on its yard: yard height above the deck, width at the yard and at the foot, depth, cloth. */
export type SquareYard = { up: number; w: number; foot: number; h: number; cloth: 'cross' | 'saint' | 'plain'; furled?: boolean };
/** A lateen sail: the yard's length, the fraction of it ahead of the mast, its tilt (radians from level) and the sail's depth. */
export type Lateen = { len: number; fore: number; tilt: number; h: number };

export type RigMast = {
  x: number;
  /** Height of the mast head above the weather deck. */
  h: number;
  r: number;
  /** Height of the fighting top above the weather deck (0: none). */
  top: number;
  yards: SquareYard[];
  lateen?: Lateen;
  /** Braced round this much (radians about the mast). */
  yaw: number;
};

/** One deck level of a castle: along-ship extent and storey height. */
export type CastleTier = { x0: number; x1: number; h: number };

/** A gun tier: guns per side are dealt out to the tiers in order, at these stations; castle: y is above the castle top there. */
export type GunTier = { y: number; xs: number[]; castle?: boolean };

export type SailPlan = {
  hull: HullPlan;
  /** Waist bulwark above the weather deck. */
  rail: number;
  /** Inward lean of the upper works per metre of height (tumblehome). */
  tumble: number;
  fore: CastleTier[];
  aft: CastleTier[];
  /** Beakhead length past the stem (0: none). */
  beak: number;
  masts: RigMast[];
  bowsprit: { len: number; angle: number; sprit: boolean };
  tiers: GunTier[];
  /** Bow chasers (side 2): their height above the deck and spread across the bow. */
  chase: { up: number; z: number };
  /** Upper works paint: atlas cell. */
  livery: string;
  /** Second livery for the castles. */
  castleLivery: string;
  flagship: boolean;
  /** Fireship: no guns, an old patched merchant hull heaped with brushwood and pitch barrels. */
  fire?: boolean;
  seed: number;
};

const ARK_HULL: HullPlan = { length: 42, beam: 10.5, draft: 3.2, deck: 5.2, flat: 0.28, bilge: 2.4, mid: 0.16, bowF: 0.44, sternF: 0.72, rise: 1.5, risePow: 2.4, flare: -0.7, taper: 1.5 };

/** English race-built galleons: Ark Royal (Howard's flagship, four masts) and a Revenge-type (Drake's, three). */
export const RACE_PLANS: SailPlan[] = [
  {
    hull: ARK_HULL,
    rail: 1.25,
    tumble: 0.12,
    fore: [{ x0: 12.2, x1: 21.4, h: 2.2 }],
    aft: [
      { x0: -21.2, x1: -6.5, h: 2.3 },
      { x0: -21.6, x1: -13.5, h: 2.1 },
    ],
    beak: 5,
    masts: [
      { x: 14.2, h: 23.5, r: 0.38, top: 13.6, yaw: 0.1, yards: [{ up: 12.6, w: 12.4, foot: 13.2, h: 7.6, cloth: 'cross' }, { up: 20.2, w: 7.0, foot: 10.6, h: 6.2, cloth: 'cross' }] },
      { x: 1.6, h: 28.6, r: 0.46, top: 16.6, yaw: 0.1, yards: [{ up: 15.4, w: 15.6, foot: 16.6, h: 9.6, cloth: 'cross' }, { up: 24.4, w: 9.0, foot: 13.0, h: 7.6, cloth: 'cross' }, { up: 28.0, w: 5.2, foot: 7.6, h: 3.4, cloth: 'plain' }] },
      { x: -11.0, h: 18.5, r: 0.3, top: 11.4, yaw: 0, yards: [], lateen: { len: 15, fore: 0.42, tilt: 0.55, h: 8.6 } },
      { x: -17.6, h: 14.6, r: 0.24, top: 0, yaw: 0, yards: [], lateen: { len: 10.5, fore: 0.42, tilt: 0.55, h: 5.8 } },
    ],
    bowsprit: { len: 14, angle: 0.42, sprit: true },
    tiers: [
      { y: 3.85, xs: [-10, -5, 0, 5, 10] },
      { y: 6.05, xs: [-17.5, -9.5, 7.5] },
    ],
    chase: { up: 1.0, z: 1.1 },
    livery: 'tudor_paint',
    castleLivery: 'tudor_paint',
    flagship: true,
    seed: 15881,
  },
  {
    hull: { ...ARK_HULL, flare: -0.6, bowF: 0.42, bilge: 2.2, rise: 1.7 },
    rail: 1.2,
    tumble: 0.11,
    fore: [{ x0: 13.2, x1: 21.3, h: 2.0 }],
    aft: [
      { x0: -21.2, x1: -7.5, h: 2.2 },
      { x0: -21.5, x1: -15.0, h: 2.0 },
    ],
    beak: 4.4,
    masts: [
      { x: 13.6, h: 23.0, r: 0.37, top: 13.2, yaw: -0.12, yards: [{ up: 12.4, w: 12.0, foot: 12.8, h: 7.4, cloth: 'cross' }, { up: 19.8, w: 6.8, foot: 10.2, h: 6.0, cloth: 'plain' }] },
      { x: 0.8, h: 28.2, r: 0.45, top: 16.2, yaw: -0.12, yards: [{ up: 15.2, w: 15.2, foot: 16.2, h: 9.4, cloth: 'cross' }, { up: 24.0, w: 8.8, foot: 12.6, h: 7.4, cloth: 'plain' }] },
      { x: -12.4, h: 18.0, r: 0.3, top: 11.0, yaw: 0, yards: [], lateen: { len: 15, fore: 0.42, tilt: 0.55, h: 8.4 } },
    ],
    bowsprit: { len: 13, angle: 0.4, sprit: true },
    tiers: [
      { y: 3.85, xs: [-10, -5, 0, 5, 10] },
      { y: 6.0, xs: [-17.5, -10.5, 7.5] },
    ],
    chase: { up: 0.95, z: 1.1 },
    livery: 'ochre_paint',
    castleLivery: 'tudor_paint',
    flagship: false,
    seed: 15882,
  },
];

const SPAIN_HULL: HullPlan = { length: 46, beam: 12.4, draft: 3.6, deck: 5.6, flat: 0.32, bilge: 2.8, mid: 0.2, bowF: 0.46, sternF: 0.8, rise: 1.6, risePow: 2.3, flare: -0.9, taper: 1.4 };

/** Spanish galleons: San Martín (Medina Sidonia's flagship) and a galleon of the Portuguese squadron. */
export const SPAIN_PLANS: SailPlan[] = [
  {
    hull: SPAIN_HULL,
    rail: 1.35,
    tumble: 0.14,
    fore: [
      { x0: 12.6, x1: 23.6, h: 2.6 },
      { x0: 15.2, x1: 24.6, h: 2.4 },
    ],
    aft: [
      { x0: -23.2, x1: -5.0, h: 2.7 },
      { x0: -23.6, x1: -11.5, h: 2.5 },
      { x0: -24.0, x1: -16.5, h: 2.3 },
    ],
    beak: 5.8,
    masts: [
      { x: 15.6, h: 22.0, r: 0.4, top: 13.0, yaw: 0.14, yards: [{ up: 12.0, w: 13.4, foot: 14.2, h: 7.4, cloth: 'cross' }, { up: 19.0, w: 7.2, foot: 11.0, h: 5.8, cloth: 'cross' }] },
      { x: 2.0, h: 30.0, r: 0.5, top: 17.4, yaw: 0.14, yards: [{ up: 16.2, w: 17.6, foot: 18.6, h: 10.2, cloth: 'saint' }, { up: 25.6, w: 9.6, foot: 14.4, h: 8.0, cloth: 'cross' }] },
      { x: -12.6, h: 19.0, r: 0.32, top: 11.8, yaw: 0, yards: [], lateen: { len: 16, fore: 0.42, tilt: 0.55, h: 9.0 } },
      { x: -19.6, h: 14.6, r: 0.25, top: 0, yaw: 0, yards: [], lateen: { len: 11, fore: 0.42, tilt: 0.55, h: 6.0 } },
    ],
    bowsprit: { len: 15, angle: 0.44, sprit: true },
    tiers: [
      { y: 4.15, xs: [-10, -3.5, 3.5, 10] },
      { y: 6.5, xs: [-3, 3.5, 10] },
      { y: 0.85, xs: [-20, -9, 18], castle: true },
    ],
    chase: { up: 1.0, z: 1.2 },
    livery: 'red_paint',
    castleLivery: 'red_paint',
    flagship: true,
    seed: 15883,
  },
  {
    hull: { ...SPAIN_HULL, flare: -0.8, bowF: 0.44, rise: 1.8 },
    rail: 1.3,
    tumble: 0.13,
    fore: [
      { x0: 13.2, x1: 23.5, h: 2.5 },
      { x0: 16.0, x1: 24.3, h: 2.3 },
    ],
    aft: [
      { x0: -23.2, x1: -6.0, h: 2.6 },
      { x0: -23.6, x1: -13.0, h: 2.4 },
      { x0: -24.0, x1: -18.0, h: 2.2 },
    ],
    beak: 5.4,
    masts: [
      { x: 15.2, h: 21.4, r: 0.4, top: 12.6, yaw: -0.16, yards: [{ up: 11.6, w: 13.0, foot: 13.8, h: 7.2, cloth: 'cross' }, { up: 18.6, w: 7.0, foot: 10.6, h: 5.6, cloth: 'plain' }] },
      { x: 1.4, h: 29.2, r: 0.5, top: 17.0, yaw: -0.16, yards: [{ up: 15.8, w: 17.0, foot: 18.0, h: 10.0, cloth: 'cross' }, { up: 25.0, w: 9.4, foot: 14.0, h: 7.8, cloth: 'plain' }] },
      { x: -13.4, h: 18.6, r: 0.32, top: 11.4, yaw: 0, yards: [], lateen: { len: 16, fore: 0.42, tilt: 0.55, h: 8.8 } },
    ],
    bowsprit: { len: 14, angle: 0.44, sprit: true },
    tiers: [
      { y: 4.15, xs: [-10, -3.5, 3.5, 10] },
      { y: 6.45, xs: [-2.5, 3.5, 10] },
      { y: 0.85, xs: [-19, -9, 18], castle: true },
    ],
    chase: { up: 1.0, z: 1.2 },
    livery: 'black_paint',
    castleLivery: 'red_paint',
    flagship: false,
    seed: 15884,
  },
];

/** The urca: a round-bellied Baltic hulk with a high rounded stern, slow and lightly armed. */
export const URCA_PLAN: SailPlan = {
  hull: { length: 32, beam: 10, draft: 3.0, deck: 4.4, flat: 0.48, bilge: 3.2, mid: 0.32, bowF: 0.5, sternF: 0.62, rise: 1.0, risePow: 2.0, flare: -1.3, taper: 1.2 },
  rail: 1.2,
  tumble: 0.16,
  fore: [{ x0: 10.2, x1: 16.2, h: 2.0 }],
  aft: [
    { x0: -16.2, x1: -6.0, h: 2.4 },
    { x0: -16.4, x1: -11.0, h: 2.1 },
  ],
  beak: 2.2,
  masts: [
    { x: 10.6, h: 16.5, r: 0.34, top: 10.6, yaw: 0.1, yards: [{ up: 10.0, w: 11.0, foot: 11.8, h: 6.4, cloth: 'plain' }, { up: 15.4, w: 5.6, foot: 8.6, h: 4.4, cloth: 'plain' }] },
    { x: -0.4, h: 21.5, r: 0.42, top: 13.4, yaw: 0.1, yards: [{ up: 12.6, w: 13.6, foot: 14.6, h: 8.2, cloth: 'cross' }, { up: 19.8, w: 7.0, foot: 10.8, h: 5.6, cloth: 'plain' }] },
    { x: -9.8, h: 13.4, r: 0.26, top: 0, yaw: 0, yards: [], lateen: { len: 11, fore: 0.42, tilt: 0.55, h: 6.2 } },
  ],
  bowsprit: { len: 9, angle: 0.5, sprit: true },
  tiers: [
    { y: 5.25, xs: [-3, 5] },
    { y: 0.85, xs: [-12, 12], castle: true },
  ],
  chase: { up: 1.0, z: 1.0 },
  livery: 'black_paint',
  castleLivery: 'red_paint',
  flagship: false,
  seed: 15885,
};

/** The English pinnace: a small, fast two-masted ship with a little lateen mizzen. */
export const PINNACE_PLAN: SailPlan = {
  hull: { length: 20, beam: 5.4, draft: 1.5, deck: 2.2, flat: 0.3, bilge: 1.1, mid: 0.2, bowF: 0.38, sternF: 0.66, rise: 0.8, risePow: 2.3, flare: -0.25, taper: 1.2 },
  rail: 0.9,
  tumble: 0.08,
  fore: [{ x0: 7.0, x1: 10.2, h: 1.0 }],
  aft: [{ x0: -10.1, x1: -4.2, h: 1.6 }],
  beak: 1.8,
  masts: [
    { x: 5.0, h: 11.6, r: 0.2, top: 7.6, yaw: 0.16, yards: [{ up: 7.0, w: 6.4, foot: 6.9, h: 4.2, cloth: 'cross' }, { up: 11.0, w: 3.6, foot: 5.4, h: 3.2, cloth: 'plain' }] },
    { x: -1.2, h: 14.2, r: 0.24, top: 9.0, yaw: 0.16, yards: [{ up: 8.4, w: 7.6, foot: 8.2, h: 5.2, cloth: 'cross' }, { up: 13.4, w: 4.4, foot: 6.6, h: 3.8, cloth: 'plain' }] },
    { x: -7.6, h: 8.2, r: 0.14, top: 0, yaw: 0, yards: [], lateen: { len: 6.4, fore: 0.42, tilt: 0.55, h: 3.6 } },
  ],
  bowsprit: { len: 6, angle: 0.45, sprit: false },
  tiers: [
    { y: 2.8, xs: [-2.4, 2.6] },
    { y: 0.7, xs: [-7.4], castle: true },
  ],
  chase: { up: 0.6, z: 0.6 },
  livery: 'ochre_paint',
  castleLivery: 'tudor_paint',
  flagship: false,
  seed: 15886,
};

/** The Calais fireships: old merchant hulls stripped of their guns, heaped with brushwood, pitch and powder. */
export const FIRESHIP_PLAN: SailPlan = {
  hull: { length: 22, beam: 6, draft: 1.7, deck: 2.5, flat: 0.36, bilge: 1.4, mid: 0.26, bowF: 0.45, sternF: 0.7, rise: 0.8, risePow: 2.2, flare: -0.4, taper: 1.1 },
  rail: 0.95,
  tumble: 0.1,
  fore: [{ x0: 7.6, x1: 11.2, h: 1.2 }],
  aft: [{ x0: -11.1, x1: -5.0, h: 1.8 }],
  beak: 1.4,
  masts: [
    { x: 5.2, h: 11.4, r: 0.22, top: 0, yaw: -0.2, yards: [{ up: 10.6, w: 7.0, foot: 7.6, h: 5.4, cloth: 'plain' }] },
    { x: -1.4, h: 13.6, r: 0.26, top: 8.8, yaw: -0.2, yards: [{ up: 8.2, w: 8.2, foot: 8.8, h: 5.6, cloth: 'plain' }, { up: 12.8, w: 4.4, foot: 6.6, h: 3.6, cloth: 'plain', furled: true }] },
  ],
  bowsprit: { len: 5.5, angle: 0.5, sprit: false },
  tiers: [],
  chase: { up: 0.6, z: 0.6 },
  livery: 'ochre_paint',
  castleLivery: 'ochre_paint',
  flagship: false,
  fire: true,
  seed: 15887,
};

/** The Neapolitan galleass: a galley hull with a ship's guns, 30 oars a side, a round-fronted gun castle and three lateens. */
export type GalleassPlan = {
  hull: HullPlan;
  /** Outrigger (telaro) that carries the oar thole pins: half breadth, height above the deck, extent. */
  outrigger: { z: number; up: number; x0: number; x1: number };
  oars: { n: number; x0: number; x1: number };
  /** Bow castle (with the three heavy guns firing ahead) and stern castle under its awning. */
  bow: { x0: number; x1: number; h: number };
  stern: { x0: number; x1: number; h: number };
  spur: number;
  masts: { x: number; h: number; r: number; lateen: Lateen }[];
  /** Side guns: stations along the ship and height above the deck, dealt out in battery order. */
  side: { x: number; up: number }[];
  chase: { up: number; zs: number[] };
};

export const GALLEASS_PLAN: GalleassPlan = {
  hull: { length: 50, beam: 7.8, draft: 1.8, deck: 2.8, flat: 0.42, bilge: 1.2, mid: 0.3, bowF: 0.22, sternF: 0.5, rise: 1.0, risePow: 2.2, flare: 0.25, taper: 1.3 },
  outrigger: { z: 4.5, up: 0.55, x0: -17.5, x1: 15.0 },
  oars: { n: 30, x0: -16.5, x1: 14.0 },
  bow: { x0: 15.6, x1: 25.4, h: 2.5 },
  stern: { x0: -25.2, x1: -18.0, h: 2.2 },
  spur: 5.5,
  masts: [
    { x: 16.8, h: 17, r: 0.32, lateen: { len: 18, fore: 0.45, tilt: 0.5, h: 10 } },
    { x: 2.0, h: 22, r: 0.42, lateen: { len: 25, fore: 0.45, tilt: 0.5, h: 13.5 } },
    { x: -14.0, h: 14, r: 0.28, lateen: { len: 15, fore: 0.45, tilt: 0.5, h: 8 } },
  ],
  side: [
    { x: 21.5, up: 1.1 },
    { x: 18.2, up: 1.1 },
    { x: -20.0, up: 1.0 },
    { x: -22.8, up: 1.0 },
    { x: 6.0, up: 1.2 },
    { x: -6.0, up: 1.2 },
  ],
  chase: { up: 1.15, zs: [-1.7, 0, 1.7] },
};
