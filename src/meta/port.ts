import type { ShipKind } from '../sim/types';
import { RANKED_ROSTER } from '../sim/conquest';
import { shipPoints } from '../sim/points';
import { ARSENAL_DISCOUNT, BUILDINGS, buildingLevel, FORTRESS_BONUS, type BuildingId } from './portDefs';
import { RuleError, type Profile } from './rules';

/**
 * The account's home port (본진): three buildings raised with coins. Pure rules shared by the server and the page.
 * - 조선소 (shipyard) unlocks hulls: the ranked roster at level 1, the navy's other hulls up to the ranked flagship's
 *   price at 2, the larger ones at 3.
 * - 병기창 (arsenal) takes ARSENAL_DISCOUNT off every hull per level.
 * - 요새 (fortress) adds FORTRESS_BONUS to a battle's coins per level (rules.ts rewardFor).
 */

/** The shipyard level a navy needs to build a kind. */
export function shipyardNeeded(nation: string, kind: ShipKind): number {
  const ranked = (RANKED_ROSTER as Record<string, readonly ShipKind[]>)[nation] ?? [];
  if (ranked.includes(kind)) return 1;
  const top = Math.max(0, ...ranked.map((k) => shipPoints(k)));
  return shipPoints(kind) <= top ? 2 : 3;
}

export const shipUnlocked = (p: Profile, kind: ShipKind) => !!p.nation && buildingLevel(p.port, 'shipyard') >= shipyardNeeded(p.nation, kind);

/** Coins for one hull at this port: its fleet points less the arsenal's discount. */
export const shipCost = (p: Profile, kind: ShipKind) => Math.round(shipPoints(kind) * (1 - ARSENAL_DISCOUNT * buildingLevel(p.port, 'arsenal')));

/** The share a battle's coins are raised by. */
export const rewardScale = (p: Pick<Profile, 'port'>) => 1 + FORTRESS_BONUS * buildingLevel(p.port, 'fortress');

/** Coins to raise a building one level, or null at its top. */
export function upgradeCost(p: Profile, id: BuildingId): number | null {
  const b = BUILDINGS[id];
  const next = buildingLevel(p.port, id) + 1;
  return next > b.max ? null : b.cost[next]!;
}

export function upgradeProblem(p: Profile, id: string): string | null {
  const b = BUILDINGS[id as BuildingId];
  if (!b || !Object.hasOwn(BUILDINGS, id)) return '없는 건물입니다';
  if (!p.nation) return '먼저 나라를 고르세요';
  const cost = upgradeCost(p, b.id);
  if (cost === null) return '이미 가장 높은 레벨입니다';
  const next = buildingLevel(p.port, b.id) + 1;
  if (b.needs) {
    const need = Math.max(1, next - b.needs.offset);
    if (buildingLevel(p.port, b.needs.id) < need) return `${BUILDINGS[b.needs.id].name} ${need}레벨이 필요합니다`;
  }
  if (p.coins < cost) return '엽전이 모자랍니다';
  return null;
}

/** Raises a building one level. */
export function upgrade(p: Profile, id: string): Profile {
  const problem = upgradeProblem(p, id);
  if (problem) throw new RuleError(problem);
  const b = BUILDINGS[id as BuildingId];
  return { ...p, coins: p.coins - upgradeCost(p, b.id)!, port: { ...p.port, [b.id]: buildingLevel(p.port, b.id) + 1 } };
}
