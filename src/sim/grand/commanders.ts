import type { ShipMods } from '../types';
import type { Commander, Fleet, Grand, GrandFaction, RegionId } from './types';

/**
 * One signature ability per campaign commander (장수 특수능력). The table is keyed by the commander's id, so a save made
 * before abilities existed gets them without a migration. Every effect is read through the functions below, by the
 * player's fleets and the computer's alike, and none of them rolls a die: an ability only scales numbers that the turn,
 * the economy and the battles already have. The leader's level keeps its own bonus; an ability comes on top of it.
 */

/** What an ability does to the war between battles. Multipliers are 1 and deltas 0 when absent. */
export type CampaignEffects = {
  /** Turns added to a work built or raised in the port where his fleet lies (negative to shorten it; a work takes at least one). */
  buildTurns?: number;
  /** Multiplier on the silver those works cost. */
  buildCost?: number;
  /** Turns added to (or taken from) his fleet's rest after a battle. */
  rest?: number;
  /** Multiplier on the hull and crew his fleet recovers each turn in a friendly port. */
  repair?: number;
  /** Multiplier on the crew and shot his fleet recovers each turn in a friendly port. */
  resupply?: number;
  /** Multiplier on the silver of the ports his fleet captures, for as long as his navy holds them. */
  plunder?: number;
  /** Ships of the wave's first kind added to each scheduled reinforcement of his navy while he leads a fleet. */
  reinforce?: number;
};

/** What an ability does in a battle, 3D or settled by the numbers. Multipliers are 1 when absent. */
export type BattleEffects = {
  /** Reload speed of the guns. */
  gunnery?: number;
  /** Reload speed of the guns during the first minute after the battle's first blow. */
  opening?: number;
  /** Strength in a boarding fight. */
  boarding?: number;
  /** Damage of a ram. */
  ram?: number;
  /** How fast a fire aboard grows and how much it burns. */
  burn?: number;
  /** Range of the guns. */
  range?: number;
  /** Shot carried into the battle. */
  ammo?: number;
  /** The fleet is laid out in this formation before the first second. */
  formation?: 'crane';
};

export type Ability = {
  /** Korean name, two to four syllables. */
  name: string;
  /** One Korean line that states the effect in numbers. */
  text: string;
  campaign: CampaignEffects;
  battle: BattleEffects;
};

export const ABILITIES: Record<string, Ability> = {
  yi: { name: '학익진', text: '전투를 학익진으로 펼친 채 시작하고 함포 장전 +8%', campaign: {}, battle: { formation: 'crane', gunnery: 1.08 } },
  won: { name: '돌격전', text: '백병전 +25%, 대신 아군 포구에서 선체·승조원 회복 -25%', campaign: { repair: 0.75 }, battle: { boarding: 1.25 } },
  eokgi: { name: '보급', text: '아군 포구에서 승조원·탄약 회복 +50%, 전투 후 정비 1턴 단축', campaign: { resupply: 1.5, rest: -1 }, battle: {} },
  kwon: { name: '축성', text: '머무는 포구의 시설 공사비 -20%, 공사 기간 1턴 단축(최소 1턴)', campaign: { buildCost: 0.8, buildTurns: -1 }, battle: {} },
  wakisaka: { name: '선봉', text: '첫 교전 뒤 1분 동안 함포 장전 +15%', campaign: {}, battle: { opening: 1.15 } },
  kuki: { name: '철갑', text: '함선에 붙은 불이 번지는 속도와 화재 피해 -50%', campaign: {}, battle: { burn: 0.5 } },
  kato: { name: '약탈', text: '그의 함대가 점령한 포구의 은 수입 +30%', campaign: { plunder: 1.3 }, battle: {} },
  kurushima: { name: '해적 전법', text: '충각 피해 +20%', campaign: {}, battle: { ram: 1.2 } },
  chenlin: { name: '대군', text: '그가 함대를 이끄는 동안 명 원군마다 명 대형선 2척 추가', campaign: { reinforce: 2 }, battle: {} },
  deng: { name: '화포', text: '함포 사거리 +8%, 탄약 +20%', campaign: {}, battle: { range: 1.08, ammo: 1.2 } },
};

export const abilityOf = (commanderId: string | null | undefined): Ability | undefined => (commanderId ? ABILITIES[commanderId] : undefined);

/** The commander who leads the fleet now: an officer who has fallen gives nothing. */
export function fleetCommander(g: Grand, fl: Fleet): Commander | undefined {
  const c = fl.commanderId ? g.factions[fl.faction].commanders.find((x) => x.id === fl.commanderId) : undefined;
  return c?.alive ? c : undefined;
}

export const fleetAbility = (g: Grand, fl: Fleet): Ability | undefined => abilityOf(fleetCommander(g, fl)?.id);

type Multiplier = 'buildCost' | 'repair' | 'resupply' | 'plunder';

/** A multiplier of the fleet's commander, 1 without one. */
export function campaignMultiplier(g: Grand, fl: Fleet, effect: Multiplier): number {
  return fleetAbility(g, fl)?.campaign[effect] ?? 1;
}

/** Turns the fleet's commander adds to its rest after a battle (negative when he shortens it). */
export const restDelta = (g: Grand, fl: Fleet): number => fleetAbility(g, fl)?.campaign.rest ?? 0;

/**
 * What the faction's commanders who lie in a port do to its works: the cheapest price and the shortest time among them.
 * Several fleets in one port do not stack: the best builder there runs the works.
 */
export function portBuilder(g: Grand, id: RegionId, faction: GrandFaction): { buildCost: number; buildTurns: number } {
  let buildCost = 1;
  let buildTurns = 0;
  for (const fl of g.fleets) {
    if (fl.faction !== faction || fl.at !== id) continue;
    const a = fleetAbility(g, fl)?.campaign;
    buildCost = Math.min(buildCost, a?.buildCost ?? 1);
    buildTurns = Math.min(buildTurns, a?.buildTurns ?? 0);
  }
  return { buildCost, buildTurns };
}

/** Ships each scheduled reinforcement of the navy gains from the commanders who lead its fleets now. */
export function reinforceExtra(g: Grand, faction: GrandFaction): number {
  return g.fleets.reduce((n, fl) => n + (fl.faction === faction ? fleetAbility(g, fl)?.campaign.reinforce ?? 0 : 0), 0);
}

/** The id of the commander whose ability marks the ports these fleets take (the first one that has `plunder`). */
export function plunderer(g: Grand, fleets: readonly Fleet[]): string | undefined {
  return fleets.map((fl) => fleetCommander(g, fl)?.id).find((id) => (abilityOf(id)?.campaign.plunder ?? 1) !== 1);
}

/** Extra ship modifiers of the commander's ability, in the shape Ship.mods takes; multiplied into the level and veterancy ones. */
export function battleMods(commanderId: string | null | undefined): Partial<ShipMods> {
  const b = abilityOf(commanderId)?.battle;
  if (!b) return {};
  const out: Partial<ShipMods> = {};
  if (b.gunnery) out.reload = b.gunnery;
  if (b.boarding) out.melee = b.boarding;
  if (b.opening) out.opening = b.opening;
  if (b.ram) out.ram = b.ram;
  if (b.burn) out.burn = b.burn;
  if (b.range) out.range = b.range;
  if (b.ammo) out.ammo = b.ammo;
  return out;
}

/**
 * The same battle effects in the auto-resolve's terms, which has rounds instead of seconds: `gun` scales a ship's
 * output in the gun rounds, `opening` only in the first, `melee` in the boarding rounds, and `guard` the gun damage it
 * takes. Range and shot count for half and a quarter of their gain (a longer reach is only part of a gun round), a ram
 * for half of its (it is one blow in a melee), and halved fires spare about an eighth of the gun damage.
 */
export type ResolveEdge = { gun: number; opening: number; melee: number; guard: number };

export function resolveEdge(commanderId: string | null | undefined): ResolveEdge | undefined {
  const b = abilityOf(commanderId)?.battle;
  if (!b) return undefined;
  const gun = (b.gunnery ?? 1) * (1 + ((b.range ?? 1) - 1) * 0.5) * (1 + ((b.ammo ?? 1) - 1) * 0.25);
  const melee = (b.boarding ?? 1) * (1 + ((b.ram ?? 1) - 1) * 0.5);
  const edge = { gun, opening: b.opening ?? 1, melee, guard: 1 - (1 - (b.burn ?? 1)) * 0.12 };
  return edge.gun === 1 && edge.opening === 1 && edge.melee === 1 && edge.guard === 1 ? undefined : edge;
}

/** The edge of every ship of these fleets whose commander has one, by ship id. */
export function fleetEdges(g: Grand, fleets: readonly Fleet[]): Record<string, ResolveEdge> {
  const out: Record<string, ResolveEdge> = {};
  for (const fl of fleets) {
    const edge = resolveEdge(fleetCommander(g, fl)?.id);
    if (edge) for (const u of fl.ships) out[u.id] = edge;
  }
  return out;
}
