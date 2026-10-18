import type { Faction, ShipKind } from '../sim/types';
import { ROSTER } from '../sim/conquest';
import { autoFleet } from '../sim/maps';
import { shipPoints } from '../sim/points';
import { GENERALS, generalById, type GeneralFaction } from './catalog';
import { MAX_SHIPS_PER_KIND, RuleError, type Profile } from './rules';

/**
 * The account's own navy (함대 육성): the one nation it serves, the admirals it has taken into service, and the hulls it
 * owns. Pure rules shared by the server (server/meta.ts, which owns every profile) and the page, like rules.ts.
 *
 * - A nation is chosen once on first entry. It may be changed ONE more time: the hulls of the old navy are sold back for
 *   half their price, its admirals stay on the profile (levels, talents and gear kept) but leave service, and the new
 *   navy's famous admirals and its starting fleet join. After that the choice is final.
 * - Choosing grants the navy's famous admirals and a starting fleet that fills a full conquest muster (autoFleet), so a
 *   new account can play at once. Other admirals of the navy are recruited for coins; hulls are bought for coins.
 * - The owned fleet caps the opening muster of a single-player conquest played with the account's own navy (musterCap).
 *   Historical battles keep their written fleets, and online/ranked matches keep their equal budgets.
 */

export type NationDef = {
  id: GeneralFaction;
  /** The chapter whose pick screen offers this navy (routes.ts CHAPTER_IDS). */
  chapter: 'imjin' | 'armada' | 'lepanto' | 'trafalgar';
  name: string;
  hanja: string;
  /** One line for the pick card. */
  line: string;
};

/** Every chapter's navy an account can serve. */
export const NATIONS: readonly NationDef[] = [
  { id: 'joseon', chapter: 'imjin', name: '조선 수군', hanja: '朝鮮水軍', line: '판옥선과 거북선, 천·지자총통의 화력으로 바다를 지킵니다' },
  { id: 'japan', chapter: 'imjin', name: '일본 수군', hanja: '日本水軍', line: '아타케부네와 세키부네, 조총과 도선 돌격으로 밀어붙입니다' },
  { id: 'ming', chapter: 'imjin', name: '명 수군', hanja: '明水軍', line: '광선과 불랑기포의 원거리 화력으로 조선을 돕습니다' },
  { id: 'england', chapter: 'armada', name: '잉글랜드 해군', hanja: '1588', line: '빠른 경주형 갤리온과 긴 사거리 컬버린으로 거리를 두고 싸웁니다' },
  { id: 'spain', chapter: 'armada', name: '에스파냐 무적함대', hanja: '1588', line: '높은 선루의 갤리온과 갈레아스, 많은 병사로 도선을 노립니다' },
  { id: 'holyleague', chapter: 'lepanto', name: '신성동맹 함대', hanja: '1571', line: '베네치아 갈레아스의 포화와 갤리선 전열로 맞섭니다' },
  { id: 'ottoman', chapter: 'lepanto', name: '오스만 함대', hanja: '1571', line: '빠른 갤리선과 갈리오트, 예니체리의 활로 몰아칩니다' },
  { id: 'britain', chapter: 'trafalgar', name: '영국 해군', hanja: '1805', line: '74문 전열함과 빠른 장전으로 적 전열을 끊습니다' },
  { id: 'france', chapter: 'trafalgar', name: '프랑스 해군', hanja: '1805', line: '무거운 80문함과 저격병, 도선 훈련으로 버팁니다' },
  { id: 'spain1805', chapter: 'trafalgar', name: '에스파냐 해군 1805', hanja: '1805', line: '산티시마 트리니다드와 36파운드 포의 전열함으로 싸웁니다' },
];
export const CHAPTER_LABEL: Record<NationDef['chapter'], string> = { imjin: '임진왜란 1592', armada: '아르마다 1588', lepanto: '레판토 1571', trafalgar: '트라팔가르 1805' };
export const nationById = (id: string | null | undefined): NationDef | undefined => NATIONS.find((n) => n.id === id);

/** Coins to take a non-famous admiral into service; the famous join with the nation. */
export const RECRUIT_PRICE = 1500;
/** Times the nation can be changed after the first choice. */
export const NATION_CHANGES = 1;
/** Share of a hull's price paid back when a nation change sells the old fleet. */
export const SELLBACK = 0.5;

/** The hulls a navy can own: the expanded conquest roster. */
export const shipKindsOf = (nation: string): readonly ShipKind[] => (ROSTER as Record<string, readonly ShipKind[]>)[nation] ?? [];
/** Coins for one hull: its fleet points. */
export const shipPrice = (kind: ShipKind) => shipPoints(kind);

/** The fleet a navy starts with: one full default conquest muster. */
export function startingFleet(nation: GeneralFaction): Partial<Record<ShipKind, number>> {
  const out: Partial<Record<ShipKind, number>> = {};
  for (const k of autoFleet(nation as Faction)) out[k] = (out[k] ?? 0) + 1;
  return out;
}

export const famousOf = (nation: string) => GENERALS.filter((g) => g.faction === nation && g.famous).map((g) => g.id);
export const admiralsOf = (nation: string) => GENERALS.filter((g) => g.faction === nation).map((g) => g.id);
/** The admirals serving the account's navy now. */
export const serving = (p: Profile): string[] => (p.nation ? admiralsOf(p.nation).filter((id) => p.recruited.includes(id)) : []);
export const fleetSize = (p: Profile) => Object.values(p.ships).reduce((a, n) => a + (n ?? 0), 0);
export const fleetValue = (p: Profile) => (Object.entries(p.ships) as [ShipKind, number][]).reduce((a, [k, n]) => a + shipPrice(k) * n, 0);

export function nationProblem(p: Profile, nation: string): string | null {
  const def = nationById(nation);
  if (!def) return '고를 수 없는 나라입니다';
  if (p.nation === def.id) return '이미 섬기는 나라입니다';
  if (p.nation && p.nationChanges >= NATION_CHANGES) return '나라는 한 번만 바꿀 수 있습니다';
  return null;
}

/** Chooses (or changes, once) the account's navy. */
export function chooseNation(p: Profile, nation: string): Profile {
  const problem = nationProblem(p, nation);
  if (problem) throw new RuleError(problem);
  const id = nationById(nation)!.id;
  const refund = p.nation ? Math.floor(fleetValue(p) * SELLBACK) : 0;
  const generals = { ...p.generals };
  for (const g of famousOf(id)) generals[g] ??= { xp: 0, talents: {} };
  return {
    ...p,
    coins: p.coins + refund,
    nation: id,
    nationChanges: p.nation ? p.nationChanges + 1 : 0,
    recruited: [...new Set([...p.recruited, ...famousOf(id)])].sort(),
    ships: startingFleet(id),
    generals,
  };
}

export function recruitProblem(p: Profile, generalId: string): string | null {
  const g = generalById(generalId);
  if (!g) return '없는 제독입니다';
  if (!p.nation) return '먼저 나라를 고르세요';
  if (g.faction !== p.nation) return '다른 나라의 제독입니다';
  if (p.recruited.includes(generalId)) return '이미 맞이한 제독입니다';
  if (p.coins < RECRUIT_PRICE) return '엽전이 모자랍니다';
  return null;
}

/** Takes one of the navy's admirals into service for RECRUIT_PRICE; experience he already had stays his. */
export function recruit(p: Profile, generalId: string): Profile {
  const problem = recruitProblem(p, generalId);
  if (problem) throw new RuleError(problem);
  return { ...p, coins: p.coins - RECRUIT_PRICE, recruited: [...p.recruited, generalId].sort(), generals: { ...p.generals, [generalId]: p.generals[generalId] ?? { xp: 0, talents: {} } } };
}

export function buyShipProblem(p: Profile, kind: string, count = 1): string | null {
  if (!p.nation) return '먼저 나라를 고르세요';
  if (!shipKindsOf(p.nation).includes(kind as ShipKind)) return '이 나라가 지을 수 없는 배입니다';
  if (!Number.isInteger(count) || count < 1 || count > 10) return '한 번에 1~10척을 지을 수 있습니다';
  if ((p.ships[kind as ShipKind] ?? 0) + count > MAX_SHIPS_PER_KIND) return `한 종류는 ${MAX_SHIPS_PER_KIND}척까지 가질 수 있습니다`;
  if (p.coins < shipPrice(kind as ShipKind) * count) return '엽전이 모자랍니다';
  return null;
}

/** Builds `count` hulls of a kind of the navy's roster. */
export function buyShip(p: Profile, kind: string, count = 1): Profile {
  const problem = buyShipProblem(p, kind, count);
  if (problem) throw new RuleError(problem);
  const k = kind as ShipKind;
  return { ...p, coins: p.coins - shipPrice(k) * count, ships: { ...p.ships, [k]: (p.ships[k] ?? 0) + count } };
}

/**
 * How many hulls of a kind a single-player conquest muster may field: what the account owns when it plays its own
 * navy, otherwise no limit (null). Applied by the conquest setup screen; the budget still applies on top.
 */
export function musterCap(p: Profile, faction: string, kind: ShipKind): number | null {
  if (!p.nation || p.nation !== faction) return null;
  return p.ships[kind] ?? 0;
}
