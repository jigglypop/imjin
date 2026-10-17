import type { Faction, ShipKind } from '../types';
import type { Rng } from './rng';

/**
 * The navies a campaign theatre can field (theatre.ts). The 1592 war in the Korean theatre plays the first three;
 * GRAND_FACTIONS stays their list, and code that runs a campaign asks `factionsOf(g)` for the navies of its theatre.
 */
export type GrandFaction = Extract<Faction, 'joseon' | 'japan' | 'ming' | 'england' | 'spain'>;
export const GRAND_FACTIONS: readonly GrandFaction[] = ['joseon', 'japan', 'ming'];

/** A campaign's world: its map, regions, lanes and navies (theatre.ts). Absent in a save means the Korean theatre of 1592. */
export type TheatreId = 'imjin' | 'armada';

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
  | 'liaodong'
  | 'nokdo'
  | 'balpo'
  | 'bangdap'
  | 'dangpo'
  | 'danghangpo'
  | 'gabaeryang'
  | 'yeongdeungpo'
  | 'yulpo'
  | 'jangmunpo'
  | 'jepo'
  | 'cheonseongpo'
  | 'dadaepo'
  | 'mokpo'
  | 'gogeumdo'
  | 'hoeryeongpo'
  | 'eoranpo'
  | 'ijin'
  | 'garipo'
  | 'yeodo'
  | 'waegyo'
  | 'mijo'
  | 'namhaeseonso'
  | 'gyeonnaeryang'
  | 'happo'
  | 'jukdo'
  | 'gijang'
  | 'seosaengpo'
  | 'ulsan'
  // The Armada theatre (regionsArmada.ts).
  | 'london' | 'harwich' | 'downs' | 'dover' | 'portsmouth' | 'wight' | 'portland' | 'plymouth' | 'lizard' | 'scilly'
  | 'kinsale' | 'blasket' | 'forth' | 'orkney' | 'flushing' | 'calais' | 'gravelines' | 'dunkirk' | 'sluys' | 'ushant'
  | 'corunna' | 'santander' | 'lisbon';

export type BuildingKind = 'camp' | 'shipyard' | 'battery' | 'dock' | 'granary' | 'beacon';
export const BUILDING_KINDS: readonly BuildingKind[] = ['camp', 'shipyard', 'battery', 'dock', 'granary', 'beacon'];
export const MAX_LEVEL = 3;

/** A work in a region. `level` is what stands now; while `upgradeLeft` counts down the next level is going up. */
export type GBuilding = { kind: BuildingKind; level: number; upgradeLeft: number; hp: number; upgradeTotal?: number };

/** One hull of the persistent fleet. hull, crew and supply are fractions of the ship's full value, like campaign.ts. */
export type ShipUnit = { id: string; kind: ShipKind; name: string; hull: number; crew: number; supply: number; kills: number };

/** `skills` are the ids taken from the commander's skill tree (growth.ts); absent in saves made before the growth rules. */
export type Commander = { id: string; faction: GrandFaction; name: string; title: string; portrait: string; level: number; xp: number; alive: boolean; skills?: string[] };

/** A navy's research (growth.ts): the techs it has, and the one on the way with the turns it still needs and what was paid. */
export type TechState = { done: string[]; doing: { id: string; left: number; paid: number } | null };

/**
 * A fleet between two ports. Under the lane rules `left` counts the turns still to sail. Under the march rules
 * (`Grand.march`) the fleet can stop anywhere at sea: `sailed` is the distance in km already covered from `from`
 * toward `to`, and `left` is kept as the turns the rest would take at the fleet's pace, for display.
 */
export type Transit = { from: RegionId; to: RegionId; left: number; sailed?: number };

/** How a fleet sails this turn under the march rules: `march` is the forced march, farther but unable to start a fight. */
export type Stance = 'normal' | 'march';

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
  /** March rules: the stance for the coming turn (absent means normal). Reset when the turn closes. */
  stance?: Stance;
  /** March rules: at the hostile port it sails for (or lies at) the fleet blockades instead of storming (the port's `siege`). */
  besieging?: boolean;
  /** March rules: a blockading fleet ordered to storm the port when the turn ends. */
  assault?: boolean;
};

export type QueueItem = { id: string; kind: ShipKind; left: number; total: number; paidGold?: number };

export type RegionState = {
  /** Fresh campaigns fund free guards by combat power; old saves retain their count-based guard rules. */
  garrisonRule?: 'equal-power-v1' | 'equal-power-v2';
  /** Unspent guard reinforcement power, carried between turns. */
  garrisonReserve?: number;
  owner: GrandFaction | null;
  buildings: GBuilding[];
  garrison: ShipUnit[];
  queue: QueueItem[];
  /** Turns of reduced income left after a conquest. */
  unrest: number;
  /**
   * March rules: a blockade by `by`'s fleets lying off the port. The port earns nothing and builds nothing; after
   * `hold` turns its garrison gives up. `turns` counts the turns it has lasted.
   */
  siege?: { by: GrandFaction; turns: number; hold: number };
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
  /** The navy's tech tree under the growth rules (`Grand.growth`). */
  tech?: TechState;
};

export type Relation = 'allied' | 'war';
export type PairKey = 'japan:joseon' | 'japan:ming' | 'joseon:ming' | 'england:spain';

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
  /**
   * March rules: a meeting out at sea on the lane between `from` and `to`, `t` of the way along. `regionId` is then the
   * nearer port, whose waters the battle is fought in; no garrison, battery or port changes hands.
   */
  sea?: { from: RegionId; to: RegionId; t: number };
  /** March rules: fleets that were not in the meeting but lay close enough to join it (either side). */
  reinforcements?: string[];
  /** March rules: the defending port is under blockade by the attacker. */
  siege?: boolean;
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

/** Values that fill the `{name}` placeholders of a message template (the UI's t() reads them). */
export type MsgParams = Record<string, string | number>;

/**
 * `text` is a Korean template and `params` fills it, so the interface renders the line in the language it is set to
 * now (a saved campaign shows its log in English after a switch). A save from before the templates holds finished
 * Korean in `text` and no params; rendering that is a plain lookup.
 * `tag` marks the news the interface also answers with a sound or a mention: a finished work or a launched ship, a historical event.
 */
export type LogEntry = { turn: number; text: string; params?: MsgParams; tone: 'info' | 'good' | 'bad'; tag?: 'built' | 'event' };

export type TurnStat = {
  turn: number;
  gold: Record<GrandFaction, number>;
  regions: Record<GrandFaction, number>;
  ships: Record<GrandFaction, number>;
  strength: Record<GrandFaction, number>;
  income: Record<GrandFaction, number>;
  /** Fights this turn, settled by the player or automatically. */
  battles: number;
  /** What the treasury took in and paid out when the turn closed (old saves lack them). */
  earned?: Record<GrandFaction, number>;
  upkeep?: Record<GrandFaction, number>;
};

/** A pause on income from a historical event: the faction's income is multiplied by `mult` for `left` more turns. */
export type IncomeMod = { faction: GrandFaction; mult: number; left: number };

/** The scripted events (events.ts): which have happened and what each player chose, the one waiting for the player, and their lasting effects. */
export type EventState = {
  /** Event id to the index of the choice taken; -1 while it waits for the player, -2 when it did not concern anyone. */
  done: Record<string, number>;
  pending: string | null;
  flags: string[];
  mods: IncomeMod[];
};

export type Victory = { faction: GrandFaction; kind: 'objective' | 'score' | 'elimination'; turn: number };

export type Grand = {
  version: 1;
  /** The campaign's world (theatre.ts). Absent: the Korean theatre of 1592, so its saves stay as they were. */
  theatre?: Exclude<TheatreId, 'imjin'>;
  /** Absent in saves made before the nonhistorical catalog was split from historical battles. */
  balanceProfile?: 'competitive-v1';
  /** New competitive campaigns compare territorial growth; absent saves retain their original objectives. */
  victoryRules?: { kind: 'growth-v1'; initialControl: Record<GrandFaction, number>; target: number };
  /** Direct overseas expeditions in a three-way campaign; absent saves retain the original lane graph. */
  strategicLinks?: 'three-way-v1';
  /** Campaigns begun after the forces were doubled (`TUNING.forceScale`); absent saves keep their fleets, guards and allowance. */
  forces?: 'wide-v1';
  /**
   * The march rules (Total War-like): fleets have a distance they can sail each turn and may cross several ports or
   * stop at sea, hostile fleets meet where their ways cross, nearby fleets reinforce a fight, ports can be blockaded.
   * Absent saves keep the lane rules, one lane a turn.
   */
  march?: 'tw-v1';
  /**
   * The growth rules: named commanders join the navies on their historical turns and take skills as they rise, and each
   * navy researches a tech tree with silver and turns (growth.ts). Absent saves are migrated on load (migrateGrandGrowth).
   */
  growth?: 'v1';
  /** Fresh human-led allied campaigns shrink only their original computer ally. Absent old saves keep their rules. */
  allySupport?: { version: 'player-ally-v1'; faction: 'joseon' | 'ming'; reinforcementCarry: Partial<Record<ShipKind, number>> };
  seed: number;
  rng: Rng;
  /** The player's "자동 건설": works and upgrades are ordered for the player's ports when a turn ends. Absent in older saves, which means off. */
  autoWorks?: boolean;
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
  events: EventState;
};

/** The answer to an order. `note` and `reason` are Korean templates; `params` fills their placeholders. */
export type Result = { ok: true; note?: string; params?: MsgParams } | { ok: false; reason: string; params?: MsgParams };
export const ok = (note?: string, params?: MsgParams): Result => (params ? { ok: true, note, params } : { ok: true, note });
export const fail = (reason: string, params?: MsgParams): Extract<Result, { ok: false }> => (params ? { ok: false, reason, params } : { ok: false, reason });

export const pairKey = (a: GrandFaction, b: GrandFaction): PairKey => (a < b ? `${a}:${b}` : `${b}:${a}`) as PairKey;
