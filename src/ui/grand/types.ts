// View-model types of the faction campaign screens. They are deliberately plain data so the UI kit does not depend on
// the campaign logic (src/sim/grand, src/campaign/grand.ts): the adapter in adapt.ts maps the store state onto these shapes.

export type FactionId = 'joseon' | 'japan' | 'ming';
export type Owner = FactionId | null;

/** The campaign has one treasury: grain and silver counted together as gold. */
export type Resources = { gold: number };

export type BuildingKind = 'camp' | 'shipyard' | 'battery' | 'dock' | 'granary' | 'beacon';

export interface BuildingView {
  kind: BuildingKind;
  /** 0 = not built. */
  level: number;
  maxLevel: number;
  /** Cost and turns of the next level. */
  cost: Partial<Resources>;
  turns: number;
  /** False when something blocks the build (not owned, queue busy, treasury short): `blocked` says why. */
  buildable: boolean;
  blocked?: string;
  /** Turns left on the level going up now, 0 when idle. */
  upgradeLeft: number;
}

export interface WorkView {
  /** The building kind: one work per kind goes up at a time. */
  id: BuildingKind;
  kind: BuildingKind;
  toLevel: number;
  turnsLeft: number;
  /** A work that has not had a turn of labour can be called off with the price back. */
  cancelable: boolean;
}

export type ShipClass = 'panokseon' | 'geobukseon' | 'hyeopseon' | 'atakebune' | 'sekibune' | 'kobaya' | 'mingship' | 'mingsmall';

export interface RecruitView {
  kind: ShipClass;
  name: string;
  cost: number;
  turns: number;
  /** Why the ship cannot be ordered now, if it cannot. */
  blocked?: string;
}

export interface YardItemView {
  id: string;
  kind: ShipClass;
  name: string;
  turnsLeft: number;
  total: number;
  cancelable: boolean;
}

export interface RegionView {
  id: string;
  name: string;
  hanja: string;
  lon: number;
  lat: number;
  owner: Owner;
  /** Strategic value 1..3: sets the node size and the income. */
  value: number;
  /** Gold per turn the region brings in. */
  income: number;
  buildings: BuildingView[];
  works: WorkView[];
  recruit: RecruitView[];
  yard: YardItemView[];
  /** The slipway is idle because the shipyard is gone or still going up. */
  yardIdle: boolean;
  garrison: number;
  garrisonMax: number;
  /** Turns of reduced income after a conquest. */
  unrest: number;
  /** Adjacent region ids: the sea lanes. */
  adj: string[];
  /** Turns it takes to sail each lane, by neighbour id (absent = 1). */
  laneTurns?: Record<string, number>;
  /** Node of the map edge that stands for a faraway land (Kyushu, Shandong): drawn as a portal, not a place. */
  offMap?: boolean;
  /** The player's side can see what is there; a region out of sight shows only its owner. */
  visible: boolean;
  /** Where the label sits relative to the node. */
  labelSide?: 'b' | 't' | 'l' | 'r';
  note?: string;
  /** Open building plots. */
  freeSlots: number;
}

export interface ShipView {
  id: string;
  kind: ShipClass;
  /** Hull integrity 0..1. */
  hull: number;
  /** Crew strength 0..1. */
  crew: number;
  /** Supply 0..1. */
  supply: number;
  name?: string;
}

export interface CommanderView {
  id: string;
  name: string;
  title: string;
  level: number;
  portrait: string;
}

export interface FleetView {
  id: string;
  faction: FactionId;
  name: string;
  /** Region the fleet lies in, or null on a lane. */
  at: string | null;
  /** Lane a fleet in transit sails: where it left, where it goes, turns left. */
  transit?: { from: string; to: string; left: number };
  /** The ordered route, next region first. Empty when idle. */
  route: string[];
  ships: ShipView[];
  commander?: CommanderView;
  /** Turns the fleet must still spend refitting after a fight. */
  rest: number;
  /** Gold to bring the fleet in port back to full, 0 when it needs nothing or cannot. */
  refit: number;
}

export interface TreasuryView {
  stock: Resources;
  /** Net change per turn. */
  income: Resources;
}

export interface TurnView {
  turn: number;
  maxTurns: number;
  /** Display date, e.g. "1592년 5월". */
  date: string;
  faction: FactionId;
}

export interface BattleSideView {
  faction: FactionId;
  name: string;
  ships: number;
  crew: number;
  /** Combined fighting power, any unit: only the ratio is shown. */
  power: number;
  /** Bonus lines such as "포대 +12%". */
  bonuses?: string[];
}

export interface BattlePreviewView {
  regionId: string;
  regionName: string;
  attacker: BattleSideView;
  defender: BattleSideView;
  /** Attacker victory chance 0..1 by the auto-resolve model. */
  winChance: number;
  /** Which side the player commands, or none when only allies fight. */
  you: 'attacker' | 'defender' | null;
  notes?: string[];
}

export interface FactionOption {
  id: FactionId;
  name: string;
  hanja: string;
  leader: string;
  blurb: string;
  strengths: string[];
  weakness: string;
  difficulty: 1 | 2 | 3;
  startRegions: string[];
  fleets: number;
}

/** Objective and score lines for the war status panel. */
export interface ObjectiveView {
  text: string;
  have: number;
  need: number;
  /** Turns the objective has been held / turns it must be held. */
  hold: number;
  holdNeeded: number;
}

export interface ScoreView {
  faction: FactionId;
  score: number;
  regions: number;
  ships: number;
  alive: boolean;
}

export interface LogLineView {
  turn: number;
  text: string;
  tone: 'info' | 'good' | 'bad';
}

export interface RelationView {
  other: FactionId;
  allied: boolean;
  /** Why the relation cannot change, or empty when the player can change it. */
  locked?: string;
}

export interface BattleResultView {
  regionName: string;
  /** Fought in 3D, or settled by the numbers. */
  played: boolean;
  /** True when the player's side won, null when the player took no part. */
  won: boolean | null;
  headline: string;
  outcome: string;
  sides: { role: '공격' | '수비'; faction: FactionId; ships: number; lost: number; kills: number; you: boolean }[];
  /** The player's ships after the fight, the lost ones last. */
  fleet: { name: string; kind: ShipClass; hull: number; crew: number; alive: boolean }[];
  razed: string[];
}

export interface GameOverView {
  won: boolean;
  headline: string;
  text: string;
  turn: number;
  scores: ScoreView[];
}

/** What the "continue" card shows about the save. */
export interface SaveView {
  faction: FactionId;
  turn: number;
  maxTurns: number;
  date: string;
  regions: number;
  ships: number;
  gold: number;
  difficulty: string;
  /** Meetings waiting to be fought. */
  waiting: number;
  over: boolean;
}
