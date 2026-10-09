import { GUN_SPECS, SHIP_SPECS } from '../catalog';
import type { ShipKind, ShipSpec } from '../types';
import { REGIONS, slotsOf } from './regions';
import type { BuildingKind, GBuilding, Grand, GrandFaction, RegionId, RegionState, ShipUnit } from './types';
import { MAX_LEVEL } from './types';

/**
 * Every number that turns the battle catalog into campaign money and time lives in TUNING. The ship stats themselves
 * (price, build seconds, hull, crew, guns) are read from SHIP_SPECS, so when the battle workstream retunes a ship
 * the campaign follows; this object is the only place the campaign adds its own opinion.
 */
export const TUNING = {
  /** Campaign gold per point of catalog price. */
  goldPerCost: 0.45,
  /** Seconds of catalog build time per campaign turn on the slipway. */
  shipSecondsPerTurn: 18,
  /** Campaign gold per point of a conquest building's price, and seconds of its build time per turn. */
  buildingGoldScale: 0.5,
  buildingSecondsPerTurn: 15,
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
  repair: { hull: 0.06, hullCamp: 0.05, hullDock: 0.1, crew: 0.08, crewCamp: 0.06, crewDock: 0.08, supply: 0.25 },
  /** Per turn in enemy or neutral water, or on a long lane. */
  attrition: { supply: 0.1, crew: 0.03 },
  /** Cheap local boats that guard a region for free, and how fast they come back. */
  garrison: { base: 2, perValue: 1.5, perCamp: 2, regen: 1 },
  /** Points in the end-of-war score. */
  score: { region: 10, strength: 1 / 250, gold: 1 / 500, credit: 1 / 250, captureCredit: 600 },
  /** Soft cap on ships in a fleet (merge limit); regions may hold any number. */
  fleetCap: 24,
  /** Turns a fleet that fought stays in port before it can sail again. */
  restAfterBattle: 2,
  /** Turns at the start in which the computer navies do not attack. */
  openingPeace: 1,
  /** Free squadrons that arrive on a schedule: the war's reinforcements. */
  reinforce: {
    joseon: { first: 8, every: 8, at: 'yeosu', ships: { hyeopseon: 4 } },
    japan: { first: 6, every: 6, at: 'nagoya', ships: { atakebune: 3, sekibune: 4, kobaya: 4 } },
    ming: { first: 8, every: 10, at: 'liaodong', ships: { mingship: 3, mingsmall: 4 } },
  } as Record<GrandFaction, { first: number; every: number; at: RegionId; ships: Partial<Record<ShipKind, number>> }>,
  /** Opening fleet size by navy, as a multiple of the table in regions.ts. The computer's fleets gather into one body since small groups no longer swap ports, which favoured the invaders; the Japanese start smaller to keep the three navies level. */
  startFleet: { joseon: 1, japan: 0.8, ming: 1 } as Record<GrandFaction, number>,
  /** Turn the first turtle ship can be built. */
  geobukseonTurn: 3,
  faction: {
    joseon: { income: 1.2, cost: 1, power: 1, label: '조선' },
    // Cheap hulls in numbers, strong boarders. The catalog measures a Japanese ship at about nine tenths of a Joseon one per price point.
    japan: { income: 1, cost: 0.85, power: 0.94, label: '일본' },
    ming: { income: 1.2, cost: 1, power: 1.05, label: '명' },
  } as Record<GrandFaction, { income: number; cost: number; power: number; label: string }>,
};

/** A turn is a season: three months. The war is counted from April 1592 (turn 1) and ends at this turn if nobody has won. */
export const MONTHS_PER_TURN = 3;
export const MAX_TURNS = 36;

export type BuildingDef = { kind: BuildingKind; label: string; hanja: string; baseGold: number; baseTurns: number; desc: string };

// Prices and times of shipyard, battery, dock and beacon follow the conquest mode's works (cost 450/500/350/300, 40/45/35/25 s).
const conquestWork = (cost: number, seconds: number) => ({ baseGold: Math.round(cost * TUNING.buildingGoldScale), baseTurns: Math.max(1, Math.ceil(seconds / TUNING.buildingSecondsPerTurn)) });

export const BUILDING_DEFS: Record<BuildingKind, BuildingDef> = {
  camp: { kind: 'camp', label: '군영', hanja: '軍營', baseGold: 400, baseTurns: 2, desc: '병영. 유지비 면제 · 수리 · 진영 수비대 · 큰 포구를 짓는 바탕' },
  shipyard: { kind: 'shipyard', label: '선소', hanja: '船所', ...conquestWork(450, 40), desc: '전선을 건조한다. 등급이 오르면 한 번에 짓는 배와 싼 값이 늘어난다' },
  battery: { kind: 'battery', label: '포대', hanja: '砲臺', ...conquestWork(500, 45), desc: '적이 쳐들어오면 먼저 포격한다. 전투에도 지어진 채 나타난다' },
  dock: { kind: 'dock', label: '수리소', hanja: '修理所', ...conquestWork(350, 35), desc: '머문 배의 선체와 병력을 빨리 회복' },
  granary: { kind: 'granary', label: '창고', hanja: '倉庫', baseGold: 300, baseTurns: 2, desc: '곡식과 물자를 쌓는다. 수입 +25% (등급마다)' },
  beacon: { kind: 'beacon', label: '봉수대', hanja: '烽燧臺', ...conquestWork(300, 25), desc: '두 칸 앞까지 적 함대를 알아본다 · 수입 +5%' },
};

export const BUILDING_ORDER: readonly BuildingKind[] = ['camp', 'shipyard', 'battery', 'dock', 'granary', 'beacon'];

/** Price and turns of raising a building to `level`. */
export function buildingCost(kind: BuildingKind, level: number) {
  const def = BUILDING_DEFS[kind];
  const mul = TUNING.levelCost[Math.min(level, MAX_LEVEL) - 1] ?? 1;
  return { gold: Math.round(def.baseGold * mul), turns: def.baseTurns + (level >= 3 ? 1 : 0) };
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
  /** Fighting worth, in catalog price points scaled by how well that navy fights per point. */
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
  const spec = SHIP_SPECS[kind];
  const f = TUNING.faction[spec.faction];
  return {
    kind,
    faction: spec.faction,
    label: spec.label,
    gold: Math.max(10, Math.round(spec.cost * TUNING.goldPerCost * f.cost)),
    turns: Math.max(1, Math.ceil(spec.build / TUNING.shipSecondsPerTurn)),
    strength: spec.cost * f.power,
    ranged: rangedShare(spec),
    boardResist: spec.boardable ? 1 / Math.sqrt(Math.max(0.5, spec.deckDefense)) : 0.25,
  };
}

/** Ships a navy can build, cheapest first. */
export const kindsOf = (faction: GrandFaction): ShipKind[] =>
  (Object.keys(SHIP_SPECS) as ShipKind[]).filter((k) => SHIP_SPECS[k].faction === faction).sort((a, b) => SHIP_SPECS[a].cost - SHIP_SPECS[b].cost);

/** Ships that need a better shipyard and an unlock. */
export const GATES: Partial<Record<ShipKind, { yard: number; unlock: boolean }>> = {
  geobukseon: { yard: 2, unlock: true },
  mingship: { yard: 1, unlock: false },
};

/** The local boat each navy leaves to guard a port. */
export const GARRISON_KIND: Record<GrandFaction, ShipKind> = { joseon: 'hyeopseon', japan: 'kobaya', ming: 'mingsmall' };

export const shipGold = (kind: ShipKind) => shipDef(kind).gold;

/** Price at a shipyard of the given level (1..3). */
export const yardPrice = (kind: ShipKind, yardLevel: number) => Math.round(shipGold(kind) * (TUNING.yardDiscount[Math.max(1, yardLevel) - 1] ?? 1));

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
  if (!r.owner) return 0;
  const def = REGIONS[id];
  let gold = TUNING.income[def.value];
  gold *= 1 + TUNING.granaryBonus * levelOf(r, 'granary') + TUNING.beaconBonus * levelOf(r, 'beacon');
  gold *= TUNING.faction[r.owner].income * difficultyIncome(g, r.owner);
  if (r.unrest > 0) gold *= TUNING.unrestIncome;
  if (def.capitalOf === r.owner) gold += TUNING.capitalBonus;
  return Math.round(gold);
}

export function factionIncome(g: Grand, f: GrandFaction): number {
  let sum = 0;
  for (const id of Object.keys(g.regions) as RegionId[]) if (g.regions[id].owner === f) sum += regionIncome(g, id);
  // Lasting effects of the historical events (aid, war weariness).
  for (const m of g.events?.mods ?? []) if (m.faction === f) sum *= m.mult;
  return Math.round(sum);
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
  return free;
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

export const garrisonCap = (id: RegionId, r: RegionState) => Math.floor(TUNING.garrison.base + TUNING.garrison.perValue * REGIONS[id].value + TUNING.garrison.perCamp * levelOf(r, 'camp'));

/** Ships built at once, by shipyard level. */
export const queueSlots = (r: RegionState) => levelOf(r, 'shipyard');

/** Shore guns' worth in a fight, per battery level. A battery fires at everything that enters the port. */
export const batteryStrength = (r: RegionState): number => {
  const b = buildingOf(r, 'battery');
  if (!b || b.level <= 0) return 0;
  return b.level * 420 * (0.4 + 0.6 * b.hp);
};

/** Year and month (1..12) at the start of a turn. */
export const dateOf = (turn: number): { year: number; month: number } => {
  const since = 3 + (turn - 1) * MONTHS_PER_TURN;
  return { year: 1592 + Math.floor(since / 12), month: (since % 12) + 1 };
};

export const dateLabel = (turn: number): string => {
  const { year, month } = dateOf(turn);
  return `${year}년 ${month}월`;
};
