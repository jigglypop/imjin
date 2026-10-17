import { GUN_SPECS, SHIP_SPECS } from '../catalog';
import { COMPETITIVE_FACTIONS, combatStats, shipSpec } from '../competitive';
import type { ShipKind, ShipSpec } from '../types';
import { REGIONS, slotsOf } from './regions';
import type { BuildingKind, GBuilding, Grand, GrandFaction, QueueItem, RegionId, RegionState, ShipUnit } from './types';
import { MAX_LEVEL } from './types';
import { allyIncomeMultiplier } from './support';
import { techIncome } from './growthData';
import { theatreOf } from './theatre';

/**
 * Every number that turns the battle catalog into campaign money and time lives in TUNING. The ship stats themselves
 * (price, build seconds, hull, crew, guns) are read from the competitive profile, so when it retunes a ship
 * the campaign follows; this object is the only place the campaign adds its own opinion.
 */
export const TUNING = {
  /** Campaign gold per point of catalog price. */
  goldPerCost: 0.45,
  /** Seconds of catalog build time per campaign turn on the slipway (was 36: a panokseon took 2 turns, a turtle ship 3). */
  shipSecondsPerTurn: 64,
  /** Campaign gold per point of a conquest building's price, and seconds of its build time per turn. */
  buildingGoldScale: 0.5,
  buildingSecondsPerTurn: 50,
  /** Gold per turn by region value. */
  income: { 1: 90, 2: 150, 3: 230 } as Record<1 | 2 | 3, number>,
  capitalBonus: 60,
  granaryBonus: 0.25,
  beaconBonus: 0.05,
  unrestIncome: 0.5,
  unrestTurns: 2,
  /** Share of a fleet's gold value paid each turn above the free allowance. */
  upkeepRate: 0.03,
  upkeepFree: 600,
  upkeepFreePerCamp: 500,
  /** Cost of the n-th level of a building, as a multiple of its base price. */
  levelCost: [1, 1.6, 2.2],
  /** Shipyard level to share of the ship price paid. */
  yardDiscount: [1, 0.9, 0.8],
  repair: { hull: 0.1, hullCamp: 0.08, hullDock: 0.17, crew: 0.13, crewCamp: 0.1, crewDock: 0.13, supply: 0.25 },
  /** Per turn in enemy or neutral water, or on a long lane. */
  attrition: { supply: 0.1, crew: 0.03 },
  /** Cheap local boats that guard a region for free, and how fast they come back. */
  garrison: { base: 2, perValue: 1.5, perCamp: 2, regen: 1 },
  /** How many times the old free forces a new campaign fields: opening fleets, port garrisons and scheduled reinforcements (`Grand.forces`). */
  forceScale: 2,
  /** Parallel slipways are (shipyard level + 1) times this. */
  yardSlotScale: 2,
  /** Points in the end-of-war score. */
  score: { region: 10, strength: 1 / 250, gold: 1 / 500, credit: 1 / 250, captureCredit: 600 },
  /** Soft cap on ships in a fleet (merge limit); regions may hold any number. */
  fleetCap: Infinity,
  /** Turns a fleet that fought stays in port before it can sail again. */
  restAfterBattle: 1,
  /** Turns at the start in which the computer navies do not attack. */
  openingPeace: 1,
  /** Free squadrons that arrive on a schedule: the war's reinforcements. */
  reinforce: {
    joseon: { first: 8, every: 8, at: 'yeosu', ships: { panokseon: 1, hyeopseon: 2 } },
    japan: { first: 8, every: 8, at: 'nagoya', ships: { atakebune: 1, sekibune: 3, kobaya: 2 } },
    ming: { first: 8, every: 8, at: 'liaodong', ships: { mingship: 1, mingsmall: 2 } },
    // The Armada theatre: the queen's ships fitted out in the Thames, the king's new galleons from Lisbon.
    england: { first: 6, every: 6, at: 'london', ships: { racegalleon: 1, pinnace: 2 } },
    spain: { first: 6, every: 6, at: 'lisbon', ships: { spgalleon: 2, urca: 2 } },
    // The Lepanto theatre: Venice's Arsenal and the Sultan's yard on the Golden Horn.
    holyleague: { first: 6, every: 6, at: 'venice', ships: { galea: 3 } },
    ottoman: { first: 6, every: 6, at: 'istanbul', ships: { kadirga: 3, kalyata: 1 } },
  } as Record<GrandFaction, { first: number; every: number; at: RegionId; ships: Partial<Record<ShipKind, number>> }>,
  /** Allied campaign train/development cohorts account for unequal opening holdings and expedition travel. */
  startFleet: { joseon: 0.98, japan: 0.74, ming: 1.95, england: 1, spain: 1, holyleague: 1, ottoman: 1 } as Record<GrandFaction, number>,
  /** Ships a navy can build only once their design is ready (GATES `unlock`): the turn, and the news it brings. */
  unlocks: [
    { faction: 'joseon', kind: 'geobukseon', turn: 3, note: '나대용이 거북선을 완성했습니다. 선소 2단계에서 건조할 수 있습니다.' },
    { faction: 'japan', kind: 'daeantaek', turn: 3, note: '구키 요시타카가 누각 대장선 대안택선을 완성했습니다. 선소 3단계에서 건조할 수 있습니다.' },
    { faction: 'ming', kind: 'gwangseon', turn: 6, note: '광둥의 철력목 전선 광선의 설계가 전해졌습니다. 선소 3단계에서 건조할 수 있습니다.' },
  ] as { faction: GrandFaction; kind: ShipKind; turn: number; note: string }[],
  /**
   * Under the march rules (`Grand.march`) a fight draws in the fleets lying near it, which favours the navy with the most
   * hulls in the densest anchorages (Japan round Busan), and winter slows the long crossing from China: these replace
   * `faction.*.income` there (tuned on 300 computer wars, scripts/balance-grand.mjs).
   */
  marchIncome: { joseon: 1.1, japan: 1.0, ming: 2.7, england: 1.25, spain: 1.6, holyleague: 1.4, ottoman: 1.4 } as Record<GrandFaction, number>,
  faction: {
    // Fast-production development cohorts retain each navy's distinct expedition and opening holdings.
    // Joseon opens with twenty-two ports and their standing garrisons to Japan's sixteen, so its income per port is the lowest.
    joseon: { ...COMPETITIVE_FACTIONS.joseon, income: 0.7, label: '조선' },
    // Japan has fewer ports to pay for its cheap hulls than before the coast had forty regions, so it earns more from each.
    japan: { ...COMPETITIVE_FACTIONS.japan, income: 1.18, label: '일본' },
    // Ming's bases finance the longer expedition.
    ming: { ...COMPETITIVE_FACTIONS.ming, income: 2.3, label: '명' },
    // England holds more ports; Spain fewer, paid for with the silver of the Indies. The auto-resolve weighs hull and
    // soldiers and cannot see the race-built ships' reach and weather gauge, so England's ships count for more and cost
    // less here: 16 computer wars split 9 to 7 (TUNING overrides in a headless run of newGrand(null, seed, .., 'armada')).
    england: { ...COMPETITIVE_FACTIONS.england, income: 1.25, cost: 0.75, power: 1.5, label: '잉글랜드' },
    spain: { ...COMPETITIVE_FACTIONS.spain, income: 1.6, label: '에스파냐' },
    // The League's galleys outgun the Ottomans' bow to bow and carry more arquebusiers, which the auto-resolve's hull and
    // soldier count cannot see, and the Ottomans open with more hulls: its ships count for more, 16 computer wars split 9 to 7
    // (Ottoman to League) in a headless run of newGrand(null, seed, .., 'lepanto').
    holyleague: { ...COMPETITIVE_FACTIONS.holyleague, income: 1.4, power: 1.3, label: '신성동맹' },
    ottoman: { ...COMPETITIVE_FACTIONS.ottoman, income: 1.4, label: '오스만' },
  } as Record<GrandFaction, { income: number; cost: number; power: number; label: string }>,
};

/** A navy as the campaign names it in its log and panels: 조선 수군, 일본 수군, 명 수군. */
export const navyName = (f: GrandFaction) => `${TUNING.faction[f].label} 수군`; // i18n-ignore: a name built from data; shown through t()

/** A turn is a season: three months. The war is counted from April 1592 (turn 1) and ends at this turn if nobody has won. */
export const MONTHS_PER_TURN = 3;
export const MAX_TURNS = 36;

export type BuildingDef = { kind: BuildingKind; label: string; baseGold: number; baseTurns: number };

// Prices and times of shipyard, battery, dock and beacon follow the conquest mode's works (cost 450/500/350/300, 40/45/35/25 s).
const conquestWork = (cost: number, seconds: number) => ({ baseGold: Math.round(cost * TUNING.buildingGoldScale), baseTurns: Math.max(1, Math.ceil(seconds / TUNING.buildingSecondsPerTurn)) });

export const BUILDING_DEFS: Record<BuildingKind, BuildingDef> = {
  camp: { kind: 'camp', label: '군영', baseGold: 400, baseTurns: 1 },
  shipyard: { kind: 'shipyard', label: '선소', ...conquestWork(450, 40) },
  battery: { kind: 'battery', label: '포대', ...conquestWork(500, 45) },
  dock: { kind: 'dock', label: '수리소', ...conquestWork(350, 35) },
  granary: { kind: 'granary', label: '창고', baseGold: 300, baseTurns: 1 },
  beacon: { kind: 'beacon', label: '봉수대', ...conquestWork(300, 25) },
};

export const BUILDING_ORDER: readonly BuildingKind[] = ['camp', 'shipyard', 'battery', 'dock', 'granary', 'beacon'];

/** Price and turns of raising a building to `level`. */
export function buildingCost(kind: BuildingKind, level: number) {
  const def = BUILDING_DEFS[kind];
  const mul = TUNING.levelCost[Math.min(level, MAX_LEVEL) - 1] ?? 1;
  // The third level takes a turn longer, except the camp: every other work waits on it, so it is not made a bottleneck.
  return { gold: Math.round(def.baseGold * mul), turns: def.baseTurns + (level >= 3 && kind !== 'camp' ? 1 : 0) };
}

/** Saved construction keeps its ordered duration, including pristine cancellation for pre-logistics saves. */
export function buildingWorkTotal(b: GBuilding): number {
  if (b.upgradeTotal !== undefined) return b.upgradeTotal;
  const seconds: Partial<Record<BuildingKind, number>> = { shipyard: 40, battery: 45, dock: 35, beacon: 25 };
  const base = seconds[b.kind] === undefined ? 2 : Math.ceil(seconds[b.kind]! / 15);
  return base + (b.level + 1 >= 3 ? 1 : 0);
}

export const buildingOf = (r: RegionState, kind: BuildingKind): GBuilding | undefined => r.buildings.find((b) => b.kind === kind);
/** Completed level of a building, 0 when absent or still on the first foundation. */
export const levelOf = (r: RegionState, kind: BuildingKind) => buildingOf(r, kind)?.level ?? 0;
export const freeSlots = (id: RegionId, r: RegionState) => slotsOf(id) - r.buildings.length;

// --- Ships ---------------------------------------------------------------------------------------------------

export type ShipDef = {
  kind: ShipKind;
  faction: GrandFaction;
  label: string;
  /** Campaign price at a plain shipyard. */
  gold: number;
  /** Turns on the slipway. */
  turns: number;
  /** Fighting worth derived from hull, weapons and crew, independent of its purchase price. */
  strength: number;
  /** Share of that worth spent in the gun phase of a fight; the rest is melee. */
  ranged: number;
  /** Damage multiplier taken in a boarding fight. */
  boardResist: number;
};

/** What a ship spends its fighting on. Gun damage per broadside against the deck crew and rifles, so the shares follow the catalog. */
export function rangedShare(spec: ShipSpec): number {
  let guns = 0;
  for (const b of spec.batteries) if (b.side !== 1) guns += b.count * (GUN_SPECS[b.gun].damage + 0.45 * GUN_SPECS[b.gun].crewDamage);
  const shooters = spec.soldiers * spec.musketPower * 0.55;
  const ranged = guns + shooters;
  const melee = (spec.soldiers + spec.crew * 0.06) * spec.melee * 1.1;
  return Math.max(0.2, Math.min(0.88, ranged / (ranged + melee)));
}

export function shipDef(kind: ShipKind): ShipDef {
  const spec = shipSpec(kind);
  const combat = combatStats(kind);
  const f = TUNING.faction[spec.faction as GrandFaction];
  return {
    kind,
    faction: spec.faction as GrandFaction,
    label: spec.label,
    gold: Math.max(10, Math.round(spec.cost * TUNING.goldPerCost * f.cost)),
    turns: Math.max(1, Math.ceil(spec.build / TUNING.shipSecondsPerTurn)),
    strength: combat.value * f.power,
    ranged: Math.max(0.2, Math.min(0.88, combat.ranged / (combat.ranged + combat.melee))),
    boardResist: spec.boardable ? 1 / Math.sqrt(Math.max(0.5, spec.deckDefense)) : 0.25,
  };
}

/** Ships a navy can build, cheapest first. */
export const kindsOf = (faction: GrandFaction): ShipKind[] =>
  (Object.keys(SHIP_SPECS) as ShipKind[]).filter((k) => shipSpec(k).faction === faction).sort((a, b) => shipSpec(a).cost - shipSpec(b).cost);

/** Ships that need a better shipyard and an unlock. */
export const GATES: Partial<Record<ShipKind, { yard: number; unlock: boolean }>> = {
  geobukseon: { yard: 2, unlock: true },
  daeantaek: { yard: 3, unlock: true },
  sogantaek: { yard: 2, unlock: false },
  gwangseon: { yard: 3, unlock: true },
  mingship: { yard: 1, unlock: false },
  haechangseon: { yard: 1, unlock: false },
  racegalleon: { yard: 1, unlock: false },
  spgalleon: { yard: 1, unlock: false },
  galleass: { yard: 2, unlock: true },
  // The Lepanto theatre: the lantern galleys need the larger yards; Venice's galleasses wait for their conversion.
  reale: { yard: 3, unlock: false },
  sultana: { yard: 3, unlock: false },
  vgalleass: { yard: 2, unlock: true },
};

/** The local boat each navy leaves to guard a port. */
export const GARRISON_KIND: Record<GrandFaction, ShipKind> = { joseon: 'hyeopseon', japan: 'kobaya', ming: 'mingsmall', england: 'pinnace', spain: 'urca', holyleague: 'galea', ottoman: 'kalyata' };

export const shipGold = (kind: ShipKind) => shipDef(kind).gold;

/** Price at a shipyard of the given level (1..3). */
export const yardPrice = (kind: ShipKind, yardLevel: number) => Math.round(shipGold(kind) * (TUNING.yardDiscount[Math.max(1, yardLevel) - 1] ?? 1));

/** Refund the amount actually paid; pre-profile saves used the original catalog and Japanese yard discount. */
export function recruitRefund(g: Grand, item: QueueItem, yardLevel: number): number {
  if (item.paidGold !== undefined) return item.paidGold;
  if (g.balanceProfile === 'competitive-v1') return yardPrice(item.kind, yardLevel);
  const spec = SHIP_SPECS[item.kind];
  const oldGold = Math.round(spec.cost * 0.45 * (spec.faction === 'japan' ? 0.85 : 1));
  return Math.round(oldGold * ([1, 0.9, 0.8][Math.max(1, yardLevel) - 1] ?? 1));
}

/** Adopt the new rules without creating or erasing gold already committed to a saved build queue. */
export function migrateGrandBalance(g: Grand): void {
  for (const r of Object.values(g.regions)) for (const item of r.queue) item.paidGold ??= recruitRefund(g, item, levelOf(r, 'shipyard'));
  g.balanceProfile = 'competitive-v1';
}

/** A ship's present fighting worth: strength scaled by hull and crew like the computer strategist's power(). */
export function unitStrength(u: ShipUnit): number {
  return shipDef(u.kind).strength * (0.35 + 0.65 * u.hull) * (0.4 + 0.6 * u.crew);
}

export const listStrength = (ships: readonly ShipUnit[]) => ships.reduce((a, u) => a + unitStrength(u), 0);

// --- Region economy ---------------------------------------------------------------------------------------------

export function difficultyIncome(g: Grand, f: GrandFaction): number {
  if (g.player === null || f === g.player) return 1;
  return g.difficulty === 'easy' ? 0.9 : g.difficulty === 'hard' ? 1.15 : 1;
}

export function regionIncome(g: Grand, id: RegionId): number {
  const r = g.regions[id];
  // A blockaded port trades nothing (march rules).
  if (!r.owner || r.siege) return 0;
  const def = REGIONS[id];
  let gold = TUNING.income[def.value];
  gold *= 1 + TUNING.granaryBonus * levelOf(r, 'granary') + TUNING.beaconBonus * levelOf(r, 'beacon');
  gold *= (g.march ? TUNING.marchIncome[r.owner] : TUNING.faction[r.owner].income) * difficultyIncome(g, r.owner);
  if (r.unrest > 0) gold *= TUNING.unrestIncome;
  if (def.capitalOf === r.owner) gold += TUNING.capitalBonus;
  return Math.round(gold);
}

export function factionIncome(g: Grand, f: GrandFaction): number {
  let sum = 0;
  for (const id of Object.keys(g.regions) as RegionId[]) if (g.regions[id].owner === f) sum += regionIncome(g, id);
  // Lasting effects of the historical events (aid, war weariness).
  for (const m of g.events?.mods ?? []) if (m.faction === f) sum *= m.mult;
  if (g.growth === 'v1') sum *= techIncome(g.factions[f].tech?.done, f);
  return Math.round(sum * allyIncomeMultiplier(g, f));
}

/** Gold value of every ship the faction has afloat or on the slipways (garrisons are free). */
export function fleetGoldValue(g: Grand, f: GrandFaction): number {
  let v = 0;
  for (const fl of g.fleets) if (fl.faction === f) for (const u of fl.ships) v += shipGold(u.kind);
  return v;
}

export function upkeepFree(g: Grand, f: GrandFaction): number {
  let free = TUNING.upkeepFree;
  for (const id of Object.keys(g.regions) as RegionId[]) if (g.regions[id].owner === f) free += TUNING.upkeepFreePerCamp * levelOf(g.regions[id], 'camp');
  // Bigger navies are paid for like the old ones: the allowance grows with them.
  return g.forces === 'wide-v1' ? free * TUNING.forceScale : free;
}

export function factionUpkeep(g: Grand, f: GrandFaction): number {
  return Math.round(Math.max(0, fleetGoldValue(g, f) - upkeepFree(g, f)) * TUNING.upkeepRate);
}

export function netIncome(g: Grand, f: GrandFaction): number {
  return factionIncome(g, f) - factionUpkeep(g, f);
}

/** Per turn recovery of a fleet resting in an owned region. */
export function repairRates(r: RegionState): { hull: number; crew: number; supply: number } {
  const t = TUNING.repair;
  return {
    hull: t.hull + t.hullCamp * levelOf(r, 'camp') + t.hullDock * levelOf(r, 'dock'),
    crew: t.crew + t.crewCamp * levelOf(r, 'camp') + t.crewDock * levelOf(r, 'dock'),
    supply: t.supply,
  };
}

/** A port marked 'equal-power-v2' keeps `forceScale` times the guard of the original rule, which stays for saved ports. */
export const guardScale = (r: RegionState) => (r.garrisonRule === 'equal-power-v2' ? TUNING.forceScale : 1);
export const garrisonPowerBudget = (id: RegionId, r: RegionState) => Math.floor(guardScale(r) * (TUNING.garrison.base + TUNING.garrison.perValue * REGIONS[id].value + TUNING.garrison.perCamp * levelOf(r, 'camp'))) * shipDef(GARRISON_KIND.joseon).strength;
export const garrisonCap = (id: RegionId, r: RegionState) => r.garrisonRule && r.owner
  ? Math.max(1, Math.round(garrisonPowerBudget(id, r) / shipDef(GARRISON_KIND[r.owner]).strength))
  : Math.floor(TUNING.garrison.base + TUNING.garrison.perValue * REGIONS[id].value + TUNING.garrison.perCamp * levelOf(r, 'camp'));

/** Ships built at once, by shipyard level: 4, 6 and 8 (was 2, 3 and 4). */
export const queueSlots = (r: RegionState) => levelOf(r, 'shipyard') > 0 ? (levelOf(r, 'shipyard') + 1) * TUNING.yardSlotScale : 0;

/** Shore guns' worth in a fight, per battery level. A battery fires at everything that enters the port. */
export const batteryStrength = (r: RegionState): number => {
  const b = buildingOf(r, 'battery');
  if (!b || b.level <= 0) return 0;
  return b.level * 420 * (0.4 + 0.6 * b.hp);
};

/** Year and month (1..12) at the start of a turn, in the campaign's theatre (the 1592 war when none is given). */
export const dateOf = (turn: number, g?: Pick<Grand, 'theatre'> | null): { year: number; month: number } => {
  const t = theatreOf(g);
  const since = t.since + (turn - 1) * MONTHS_PER_TURN;
  return { year: t.year + Math.floor(since / 12), month: (since % 12) + 1 };
};

export const dateLabel = (turn: number, g?: Pick<Grand, 'theatre'> | null): string => {
  const { year, month } = dateOf(turn, g);
  return `${year}년 ${month}월`; // i18n-ignore: every 'year년 month월' has an English entry
};
