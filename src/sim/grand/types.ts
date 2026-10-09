import type { Faction, ShipKind } from '../types';
import type { Rng } from './rng';

export type GrandFaction = Faction;
export const GRAND_FACTIONS: readonly GrandFaction[] = ['joseon', 'japan', 'ming'];

export type RegionId =
  | 'myeongnyang'
  | 'yeosu'
  | 'noryang'
  | 'sacheon'
  | 'hansan'
  | 'geoje'
  | 'angolpo'
  | 'busan'
  | 'tsushima'
  | 'nagoya'
  | 'shandong'
  | 'liaodong';

export type BuildingKind = 'camp' | 'shipyard' | 'battery' | 'dock' | 'granary' | 'beacon';
export const BUILDING_KINDS: readonly BuildingKind[] = ['camp', 'shipyard', 'battery', 'dock', 'granary', 'beacon'];
export const MAX_LEVEL = 3;

/** A work in a region. `level` is what stands now; while `upgradeLeft` counts down the next level is going up. */
export type GBuilding = { kind: BuildingKind; level: number; upgradeLeft: number; hp: number };

/** One hull of the persistent fleet. hull, crew and supply are fractions of the ship's full value, like campaign.ts. */
export type ShipUnit = { id: string; kind: ShipKind; name: string; hull: number; crew: number; supply: number; kills: number };

export type Commander = { id: string; faction: GrandFaction; name: string; title: string; portrait: string; level: number; xp: number; alive: boolean };

export type Transit = { from: RegionId; to: RegionId; left: number };

export type Fleet = {
  id: string;
  faction: GrandFaction;
  name: string;
  commanderId: string | null;
  ships: ShipUnit[];
  /** Where the fleet lies, or null while it is on a two turn lane. */
  at: RegionId | null;
  transit: Transit | null;
  /** The rest of the route, next region first. Empty when the fleet is idle. */
  route: RegionId[];
  /** Where the fleet started this turn, so a beaten fleet knows where to fall back. */
  from: RegionId | null;
  /** Turns the fleet must still spend refitting after a fight before it can sail. */
  rest: number;
};

export type QueueItem = { id: string; kind: ShipKind; left: number; total: number };

export type RegionState = {
  owner: GrandFaction | null;
  buildings: GBuilding[];
  garrison: ShipUnit[];
  queue: QueueItem[];
  /** Turns of reduced income left after a conquest. */
  unrest: number;
};

export type FactionState = {
  faction: GrandFaction;
  gold: number;
  alive: boolean;
  commanders: Commander[];
  /** Ship kinds this navy may build beyond the basic ones. */
  unlocked: ShipKind[];
  /** Consecutive turns the faction has held its victory objective. */
  objectiveHold: number;
  /** Turns since the faction last fought. */
  idle: number;
};

export type Relation = 'allied' | 'war';
export type PairKey = 'japan:joseon' | 'japan:ming' | 'joseon:ming';

/** A meeting of fleets in one region this turn, waiting to be fought out. */
export type Contact = {
  id: string;
  regionId: RegionId;
  attacker: GrandFaction;
  defender: GrandFaction;
  /** Fleets that moved in (or fleets of the attacker's allies). */
  attackerFleets: string[];
  /** Fleets already there, or arriving to defend. Empty when only the garrison stands. */
  defenderFleets: string[];
  /** True when a fleet of the player's faction is on either side, so the player decides how it is settled. */
  player: boolean;
};

export type BattleOutcomeShip = { campaignId: string; alive: boolean; hull: number; crew: number; supply: number; kills: number };

/** What a battle returns to the campaign. The ships have the shape of Engine.finishCampaignBattle's per-ship outcome. */
export type BattleOutcome = {
  winner: 'attacker' | 'defender';
  ships: BattleOutcomeShip[];
  /** Buildings the battle destroyed (a battery razed in the 3D fight, say). Each costs the region one level of that kind. */
  razed: BuildingKind[];
  /** Hull fraction the region's works lost in the fight, 0..1 per kind. Optional: a 3D battle reports it through `razed`. */
  damage?: Partial<Record<BuildingKind, number>>;
};

export type LogEntry = { turn: number; text: string; tone: 'info' | 'good' | 'bad' };

export type TurnStat = {
  turn: number;
  gold: Record<GrandFaction, number>;
  regions: Record<GrandFaction, number>;
  ships: Record<GrandFaction, number>;
  strength: Record<GrandFaction, number>;
  income: Record<GrandFaction, number>;
  /** Fights this turn, settled by the player or automatically. */
  battles: number;
};

export type Victory = { faction: GrandFaction; kind: 'objective' | 'score' | 'elimination'; turn: number };

export type Grand = {
  version: 1;
  seed: number;
  rng: Rng;
  /** The faction the human commands, or null when the computer plays all three (headless balance runs). */
  player: GrandFaction | null;
  difficulty: 'easy' | 'normal' | 'hard';
  turn: number;
  phase: 'orders' | 'battles' | 'over';
  regions: Record<RegionId, RegionState>;
  fleets: Fleet[];
  factions: Record<GrandFaction, FactionState>;
  relations: Record<PairKey, Relation>;
  /** Battles waiting for the player, or fought out automatically when nobody decides. */
  pending: Contact[];
  /** Fights in the turn being closed, for the statistics. */
  fought: number;
  /** Enemy strength each faction has destroyed or taken, which counts toward its score. */
  credit: Record<GrandFaction, number>;
  nextId: number;
  log: LogEntry[];
  stats: TurnStat[];
  victory: Victory | null;
};

export type Result = { ok: true; note?: string } | { ok: false; reason: string };
export const ok = (note?: string): Result => ({ ok: true, note });
export const fail = (reason: string): Result => ({ ok: false, reason });

export const pairKey = (a: GrandFaction, b: GrandFaction): PairKey => (a < b ? `${a}:${b}` : `${b}:${a}`) as PairKey;
