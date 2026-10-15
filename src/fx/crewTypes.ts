import type { Quaternion } from 'three/webgpu';
import type { Faction } from '../sim/types';
import { equipment } from '../game/quality';
import type { DeckLayout, DeckPlan } from '../ships/decks';
import type { ClipName, CrewKey } from './crewModels';
import type { Figure } from './Boarding';

/** Who stands at each station, by navy: rowers, gunners, shooters, deck fighters, the captain and the drummer. */
export const CAST: Record<Faction, [CrewKey, CrewKey, CrewKey, CrewKey, CrewKey, CrewKey]> = {
  joseon: ['rower', 'rower', 'joseon_soldier', 'joseon_marine', 'joseon_officer', 'rower'],
  japan: ['rower', 'rower', 'japan_ashigaru', 'japan_samurai', 'japan_officer', 'rower'],
  ming: ['rower', 'rower', 'ming_soldier', 'ming_soldier', 'ming_officer', 'rower'],
};

/** Hand props the crew models carry (scripts/bake-crew.mjs); a figure shows one and the rest fold away. */
export const W = { spear: 1, bow: 2, gun: 3, sword: 4, sticks: 5, bucket: 6, flag: 7, hook: 8, none: 9, rammer: 10, aimed: 11 } as const;
/** Weapon each station carries. */
export const ARMS: Record<Faction, number[]> = {
  joseon: [0, 0, W.bow, W.spear, W.sword, W.sticks],
  japan: [0, 0, W.gun, W.sword, W.sword, W.sticks],
  ming: [0, 0, W.bow, W.spear, W.sword, W.sticks],
};
/** What the shooters pick up for a melee: every shooter model carries a spear, the fighters their own weapon. */
export const HAND_ARMS: Record<Faction, number[]> = {
  joseon: [0, 0, W.spear, W.spear, W.sword, W.spear],
  japan: [0, 0, W.spear, W.sword, W.sword, W.spear],
  ming: [0, 0, W.spear, W.spear, W.sword, W.spear],
};
/** A weapon id no model carries: every weapon folds away, which is how a surrendering man drops his arms. */
export const NO_WEAPON = W.none;

export const OAR = 0;
export const GUN = 1;
export const SHOT = 2;
export const MELEE = 3;
export const OFFICER = 4;
export const DRUM = 5;
export const ROLES = 6;

export type Deck = 0 | 1 | 2;
/** A place on deck; `up` lifts it onto a firing step built against a wall too high to shoot over. */
export type Station = { x: number; z: number; yaw: number; deck: Deck; up: number };

/** A crew member standing at a station. Boarding figures are lent out of here and come back when the fight ends. */
export type Member = {
  station: number;
  seed: number;
  clip: ClipName;
  t0: number;
  /** Battle time of death, which may lie a moment ahead so the man flinches first. -1 while alive. */
  dying: number;
  /** When the man was struck down; the flinch plays from here. */
  hurt: number;
  /** Where the body goes: 0 falls where it stands, otherwise the sign of the side it is thrown over. */
  fling: number;
  /** Gone from the deck (thrown overboard or lent to a boarding party): not drawn at the station. */
  gone: boolean;
  /** Out on an enemy deck as a boarding figure. */
  away: boolean;
  /** The enemy boarder this man is fighting. */
  duel: Figure | null;
  /** Volley: battle time the shot goes off (-1 none), when the order came, and the local yaw to aim along. */
  fireAt: number;
  fireOrder: number;
  fireYaw: number;
  fireArms: number;
  /** The shot of the current order has gone off. */
  fired: boolean;
  /** Battle time of the last shot, for the reload that follows. */
  lastFire: number;
  /**
   * A short piece of business that overrides what the ship's state would have the man do: a grapnel thrown, a flag
   * signal, a man knocked off his feet. Plays act from actT0 until actUntil, holding actWeapon, facing actYaw (NaN: as
   * he stands).
   */
  act: ClipName | null;
  actT0: number;
  actUntil: number;
  actRate: number;
  actWeapon: number;
  actYaw: number;
};

/** A man who fell on deck and lies there, in the ship's own frame; the clip holds its last frame. */
export type Corpse = { x: number; z: number; y: number; yaw: number; key: CrewKey; clip: ClipName; t: number };

export type Roster = {
  key: string;
  plan: DeckPlan;
  main: number;
  stations: Station[][];
  members: Member[][];
  /** Figures drawn for a full crew, by station. */
  figures: DeckPlan['figures'];
  /** Where men can stand and cross on this model's deck. */
  layout: DeckLayout;
  /** Scale that keeps a man readable at this distance from the camera. */
  grow: number;
  /** Ship length, metres. */
  len: number;
  q: Quaternion;
  /** Frame number this roster was last on screen. */
  live: number;
  dist: number;
  lod: number;
  showMain: boolean;
  showLow: boolean;
  showCommand: boolean;
  /** 0..1: how far the crew has moved to the side where the enemy ship lies. */
  engage: number;
  contactN: number;
  /** Along-ship position and side (+1 or -1) of each boarding link on this ship. */
  cx: number[];
  cs: number[];
  /** An enemy is boarding this ship, or it has struck: its last men are kept in view. */
  defending: boolean;
  boarded: boolean;
  hold: boolean;
  /** The dead left lying on this deck, oldest first. */
  corpses: Corpse[];
  /** Ship's gun for each gun station, as an index into ship.guns (-1 none). */
  gunOf: number[];
};

/** The dead left on one deck at most, by tier: older bodies are cleared as new ones fall. */
export const CORPSES = { high: 14, medium: 8, low: 4 }[equipment.tier];

/** Leaves a body on a deck, clearing the oldest when the deck holds its share. */
export function layBody(r: Roster, x: number, z: number, y: number, yaw: number, key: CrewKey, clip: ClipName, t: number) {
  const list = r.corpses;
  const c = list.length >= CORPSES ? list.shift()! : ({} as Corpse);
  c.x = x;
  c.z = z;
  c.y = y;
  c.yaw = yaw;
  c.key = key;
  c.clip = clip;
  c.t = t;
  list.push(c);
}

/** One of the two ways a man falls dead, the same each time for the same man. */
export const deathClip = (seed: number): ClipName => (frac(seed * 5.37) < 0.5 ? 'die' : 'die2');

/** Distance beyond which men are drawn larger than life so they still read from the battle camera, by tier. */
const GROW_FROM = { high: 110, medium: 95, low: 80 }[equipment.tier];
const GROW_MAX = 2.2;

/** A gentle floor on the size of a man on screen: true to scale up close, up to GROW_MAX times that far away. */
export const figureScale = (dist: number) => (dist <= GROW_FROM ? 1 : Math.min(GROW_MAX, dist / GROW_FROM));

/** Distance within which a ship's crew is drawn, and with it the crew's own flashes and smoke, by tier. */
export const CREW_RANGE = { high: 540, medium: 440, low: 320 }[equipment.tier];

export const rnd = (a: number, b: number) => a + Math.random() * (b - a);
export const frac = (v: number) => v - Math.floor(v);

export function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

/** Faces a figure (modelled facing +z) along a local direction. */
export const yawTo = (dx: number, dz: number) => Math.atan2(dx, dz);

/** Turns from one angle toward another by the short way. */
export function lerpAngle(a: number, b: number, t: number) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  else if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export const smooth = (t: number) => {
  const k = t < 0 ? 0 : t > 1 ? 1 : t;
  return k * k * (3 - 2 * k);
};
