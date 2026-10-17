import { GUN_SPECS, NO_MODS, SHIP_SPECS } from './catalog';
import type { Faction, GunSpec, GunType, ShipKind, ShipMods, ShipSpec } from './types';

/** Historical scenarios retain the original catalog, including their explicit handicaps. */
export type BalanceProfile = 'historical' | 'competitive-v1';
export const COMPETITIVE_PROFILE: BalanceProfile = 'competitive-v1';
export const COMPETITIVE_TRAITS: Record<Faction, string> = {
  joseon: '견고한 화포·도선 방어 · 비싸고 느린 주력함',
  japan: '값싼 기동·도선 · 약한 원거리 화력',
  ming: '장거리·정확한 집중 사격 · 근접·추격에 취약',
  england: '빠른 갤리온·긴 사거리 컬버린 · 도선전에 약함',
  spain: '높은 선루·병사 많은 도선전 · 느린 장전',
  holyleague: '이물 대포와 화승총병 · 갈레아스의 화력',
  ottoman: '빠른 갤리선과 활 · 많은 병사의 도선전',
  britain: '빠른 장전의 현측 포격 · 캐로네이드의 근거리 화력',
  france: '무거운 36리브르 포 · 저격병과 도선 훈련',
  spain1805: '거대한 다층 전열함 · 느린 장전과 기동',
};

type UnitBalance = { spec: Partial<ShipSpec>; mods?: Partial<ShipMods>; range?: number; damage?: number };

/**
 * Equal-resource skirmish rules. Prices pay for distinct jobs, not interchangeable ships:
 * Joseon holds a gun line and repels boarding, Japan surrounds it with fast boarding craft,
 * and Ming concentrates accurate long-range fire but loses a close fight or a chase.
 * Dimensions and gun mounts remain the historical catalog's, so every rendered mount still matches.
 */
export const COMPETITIVE_UNITS: Record<ShipKind, UnitBalance> = {
  panokseon: { spec: { hull: 170, crew: 165, armor: 0.28, deckDefense: 2.1, maxSpeed: 5, cost: 700, build: 54 }, mods: { reload: 1, accuracy: 1.05 } },
  geobukseon: { spec: { hull: 195, armor: 0.5, deckDefense: 3.3, maxSpeed: 5.4, ramPower: 2.9, cost: 1050, build: 78 } },
  hyeopseon: { spec: { hull: 38, crew: 28, maxSpeed: 7, cost: 150, build: 18 }, mods: { reload: 1.1 } },
  atakebune: { spec: { hull: 205, crew: 235, maxSpeed: 6.2, accel: 0.5, turnRate: 0.15, armor: 0.16, melee: 1.15, deckDefense: 1.15, cost: 470, build: 36 }, mods: { reload: 1.1, accuracy: 0.95, melee: 1.1 }, damage: 1.8 },
  sekibune: { spec: { hull: 80, crew: 78, maxSpeed: 7.5, melee: 1.2, deckDefense: 0.95, cost: 190, build: 21 }, mods: { reload: 1.1, accuracy: 0.95, melee: 1.1 } },
  kobaya: { spec: { hull: 32, crew: 30, maxSpeed: 8.1, melee: 1.15, cost: 85, build: 14 }, mods: { reload: 1.1, accuracy: 0.95, melee: 1.1 } },
  mingship: { spec: { hull: 170, crew: 185, armor: 0.1, maxSpeed: 4.6, turnRate: 0.12, deckDefense: 1.55, cost: 680, build: 53 }, mods: { reload: 0.8, accuracy: 1.15 }, range: 1.35, damage: 0.85 },
  mingsmall: { spec: { hull: 60, crew: 54, armor: 0.04, maxSpeed: 6.1, deckDefense: 1.1, cost: 255, build: 28 }, mods: { reload: 0.9, accuracy: 1.1 }, range: 1.25, damage: 0.9 },
  // The kinds below are offered only under the expanded rules (casual conquest and the campaign); ranked keeps the eight above.
  // Unarmed craft are priced for their service (sight, a tender's supply), not for a combat value they do not have.
  sahuseon: { spec: { cost: 45, build: 8 } },
  pojakseon: { spec: { cost: 35, build: 6 }, mods: { reload: 1.1 } },
  sogantaek: { spec: { maxSpeed: 5.9, accel: 0.48, turnRate: 0.17, armor: 0.13, melee: 1.12, cost: 290, build: 26 }, mods: { reload: 1.1, accuracy: 0.95, melee: 1.1 }, damage: 1.8 },
  daeantaek: { spec: { hull: 270, crew: 280, maxSpeed: 4.8, armor: 0.2, melee: 1.12, cost: 680, build: 50 }, mods: { reload: 1.1, accuracy: 0.95, melee: 1.1 }, damage: 1.8 },
  daegwanseon: { spec: { maxSpeed: 8, cost: 230, build: 24 }, mods: { reload: 1.1, accuracy: 0.95, melee: 1.1 } },
  byeongnyangseon: { spec: { cost: 150, build: 16 } },
  gwangseon: { spec: { armor: 0.24, maxSpeed: 4.2, turnRate: 0.11, cost: 950, build: 80 }, mods: { reload: 0.8, accuracy: 1.15 }, range: 1.35, damage: 0.85 },
  haechangseon: { spec: { armor: 0.07, maxSpeed: 5.2, cost: 420, build: 40 }, mods: { reload: 0.85, accuracy: 1.12 }, range: 1.3, damage: 0.88 },
  hoseon: { spec: { hull: 42, crew: 38, cost: 185, build: 20 }, mods: { reload: 0.9, accuracy: 1.1 }, range: 1.25, damage: 0.9 },
  // The Armada chapter: catalog ships at prices fitted against the 1592 navies in AI conquest matches
  // (scripts/balance-competitive.mjs --match=england:joseon,...; docs/balance-cross.md). Ranked keeps the 1592 eight.
  racegalleon: { spec: { cost: 1160, build: 64 } },
  pinnace: { spec: { cost: 240, build: 22 } },
  fireship: { spec: { cost: 180, build: 16 } },
  spgalleon: { spec: { cost: 700, build: 60 } },
  galleass: { spec: { cost: 620, build: 56 } },
  urca: { spec: { cost: 260, build: 30 } },
  // The Lepanto chapter keeps its catalog prices until scripts/balance-competitive.mjs fits them (docs/balance-cross.md).
  reale: { spec: { cost: 900, build: 70 } },
  galea: { spec: { cost: 650, build: 40 } },
  vgalleass: { spec: { cost: 1200, build: 72 } },
  sultana: { spec: { cost: 860, build: 68 } },
  kadirga: { spec: { cost: 470, build: 38 } },
  kalyata: { spec: { cost: 260, build: 24 } },
  // The Trafalgar chapter's prices among its own navies, fitted with scripts/balance-competitive.mjs over 16 seeds
  // (docs/balance-cross.md): the British 74's faster gunnery is paid for against the French and Spanish 74s. Against an
  // earlier era's navy they are multiplied by CROSS_ERA_PRICE below. The flagships, offered only under the expanded
  // rules, keep their proportion to their 74s.
  firstrate: { spec: { cost: 1250, build: 90 } },
  gb74: { spec: { cost: 910, build: 74 } },
  gbfrigate: { spec: { cost: 320, build: 40 } },
  fr80: { spec: { cost: 1000, build: 84 } },
  fr74: { spec: { cost: 750, build: 74 } },
  trinidad: { spec: { cost: 1150, build: 96 } },
  es74: { spec: { cost: 750, build: 74 } },
};

/**
 * Mixed-era budgets. A navy of a later era pays several times a 1592 price for a ship, so a room's muster budget, start
 * funds, fleet cap and income grow by the largest factor of the navies present: the dearer navy still fields a squadron
 * and the 1592 navy buys proportionally more. 1592, 1588 and 1571 navies keep factor 1, so their rooms are unchanged.
 */
export const ERA_BUDGET_SCALE: Partial<Record<Faction, number>> = { britain: 4, france: 4, spain1805: 4 };
export const eraBudgetScale = (factions: Iterable<Faction>) => {
  let k = 1;
  for (const f of factions) k = Math.max(k, ERA_BUDGET_SCALE[f] ?? 1);
  return k;
};

/**
 * Cross-era prices. One price per ship cannot serve both kinds of room: a ship of the line priced fairly against the
 * other 1805 navies is far too cheap against 1592's ships, and priced against 1592 it loses every 1805 duel. So the
 * prices above are the 1805 navies' among themselves, and in a mixed-era room (a later era's navy against an earlier
 * one) each later navy's ships cost this factor more, for buying, the fleet cap and the tickets a loss bleeds. Both
 * sides still spend the same budget. Fitted with scripts/balance-competitive.mjs (docs/balance-cross.md).
 */
export const CROSS_ERA_PRICE: Partial<Record<Faction, number>> = { britain: 4, france: 3.7, spain1805: 3.6 };
const ERA_KINDS: Partial<Record<Faction, ShipKind[]>> = { britain: ['firstrate', 'gb74', 'gbfrigate'], france: ['fr80', 'fr74'], spain1805: ['trinidad', 'es74'] };

/** The price factors of a room's ships, or nothing when every navy in it is of one era (1805 alone, or none of 1805). */
export function eraPrices(factions: Iterable<Faction>): Partial<Record<ShipKind, number>> | undefined {
  const list = [...factions];
  const later = list.filter((f) => (ERA_BUDGET_SCALE[f] ?? 1) > 1);
  if (!later.length || later.length === list.length) return undefined;
  const out: Partial<Record<ShipKind, number>> = {};
  for (const f of later) for (const k of ERA_KINDS[f] ?? []) out[k] = CROSS_ERA_PRICE[f] ?? 1;
  return out;
}

/** One navy's price factor in a room of these navies (1 unless it is a later era's navy in a mixed-era room). */
export const eraPriceScale = (faction: Faction, factions: Iterable<Faction>) => {
  const kind = ERA_KINDS[faction]?.[0];
  return (kind && eraPrices(factions)?.[kind]) || 1;
};

/** The three treasuries earn the same base income; cheap boarding ships are not discounted a second time. */
export const COMPETITIVE_FACTIONS: Record<Faction, { income: number; cost: number; power: number }> = {
  joseon: { income: 1, cost: 1, power: 1.01 },
  japan: { income: 1, cost: 1, power: 0.93 },
  ming: { income: 1, cost: 1, power: 1.005 },
  england: { income: 1, cost: 1, power: 1 },
  spain: { income: 1, cost: 1, power: 1 },
  holyleague: { income: 1, cost: 1, power: 1 },
  ottoman: { income: 1, cost: 1, power: 1 },
  britain: { income: 1, cost: 1, power: 1 },
  france: { income: 1, cost: 1, power: 1 },
  spain1805: { income: 1, cost: 1, power: 1 },
};

const specs = Object.fromEntries(Object.entries(SHIP_SPECS).map(([kind, spec]) => [kind, { ...spec, ...COMPETITIVE_UNITS[kind as ShipKind].spec }])) as Record<ShipKind, ShipSpec>;
const guns = Object.fromEntries((Object.keys(SHIP_SPECS) as ShipKind[]).map((kind) => {
  const unit = COMPETITIVE_UNITS[kind];
  return [kind, Object.fromEntries(Object.entries(GUN_SPECS).map(([type, base]) => [type, { ...base, range: base.range * (unit.range ?? 1), damage: base.damage * (unit.damage ?? 1), crewDamage: base.crewDamage * (unit.damage ?? 1) }]))];
})) as Record<ShipKind, Record<GunType, GunSpec>>;

export const shipSpec = (kind: ShipKind, profile: BalanceProfile = COMPETITIVE_PROFILE): ShipSpec => profile === 'historical' ? SHIP_SPECS[kind] : specs[kind];
export const shipMods = (kind: ShipKind, profile: BalanceProfile = COMPETITIVE_PROFILE): ShipMods => ({ ...NO_MODS, ...(profile === 'historical' ? {} : COMPETITIVE_UNITS[kind].mods) });

/** Gun types are shared by several navies; an upgrade belongs to the ship, never to the global gun catalog. */
export function shipGunSpec(kind: ShipKind, gun: GunType, profile: BalanceProfile = COMPETITIVE_PROFILE): GunSpec {
  const base = GUN_SPECS[gun];
  if (profile === 'historical') return base;
  return guns[kind][gun];
}

/** Automatic travel speed ends before the first effective broadside, including a long-range competitive navy. */
export function engagementRange(profile: BalanceProfile, kinds: Iterable<ShipKind>): number {
  if (profile === 'historical') return 400;
  let range = 400;
  for (const kind of kinds) for (const battery of shipSpec(kind, profile).batteries) range = Math.max(range, shipGunSpec(kind, battery.gun, profile).range);
  return range;
}

/** Combat appraisal is independent of price, shared by tactical AI and campaign auto-resolve. */
export const COMPETITIVE_APPRAISAL = { protection: 0.55, reach: 1.35 };
const appraisals = new Map<string, { ranged: number; melee: number; value: number }>();
export function combatStats(kind: ShipKind, profile: BalanceProfile = COMPETITIVE_PROFILE) {
  const key = profile + ':' + kind;
  const cached = appraisals.get(key);
  if (cached) return cached;
  const spec = shipSpec(kind, profile);
  const mods = shipMods(kind, profile);
  let ranged = 0;
  for (const b of spec.batteries) {
    const gun = shipGunSpec(kind, b.gun, profile);
    ranged += b.count * (gun.damage + gun.crewDamage * 0.45) / gun.stages.reduce((a, n) => a + n, 0) * mods.reload * mods.accuracy;
  }
  ranged += spec.crew * spec.crewPlan[2] * spec.musketPower * 0.018 * mods.reload * mods.accuracy;
  const melee = spec.crew * (spec.crewPlan[3] + spec.crewPlan[2] * 0.6 + spec.crewPlan[1] * 0.4 + spec.crewPlan[0] * 0.15) * spec.melee * mods.melee * 0.04;
  // Static protection partly contributes to the appraisal; damage resistance still belongs to each combat path.
  const protection = spec.boardable ? Math.sqrt(spec.deckDefense) / (1 - spec.armor) : 1.45 / (1 - spec.armor);
  const durability = spec.hull * (1 + (protection - 1) * COMPETITIVE_APPRAISAL.protection);
  // Extra reach values the volleys fired during the approach. It adds to ranged appraisal, never to real-time damage.
  const reach = profile === 'historical' ? 1 : 1 + ((COMPETITIVE_UNITS[kind].range ?? 1) - 1) * COMPETITIVE_APPRAISAL.reach;
  const stats = { ranged, melee, value: durability * 1.3 + ranged * 100 * reach + melee * 35 * Math.sqrt(spec.maxSpeed / 5) };
  appraisals.set(key, stats);
  return stats;
}
export const combatValue = (kind: ShipKind, profile: BalanceProfile = COMPETITIVE_PROFILE) => combatStats(kind, profile).value;
