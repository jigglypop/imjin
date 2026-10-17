import { shipSpec, type BalanceProfile, COMPETITIVE_PROFILE } from './competitive';
import type { ShipKind } from './types';

/**
 * Cross-chapter fleet points. A ship of any chapter costs this many points in a mixed skirmish, a lane match's waves and
 * the chapter campaigns' musters, so a fleet of galleons and a fleet of panokseon of equal points are an even fight.
 *
 * The 1592 kinds keep their competitive price (the ranked balance was settled on it); every other chapter's kinds are
 * fitted against them by scripts/balance-cross.mjs: equal-points fleets of each kind fought against the 1592 anchors on
 * open water, both seats, several seeds, and the price nudged until each pairing wins near half its fights. The model is
 * described in docs/balance-cross.md. Changing a number here changes no 1592 battle: the historical battles and ranked
 * conquest read their own catalog prices.
 */
const FITTED: Partial<Record<ShipKind, number>> = {
  racegalleon: 900,
  pinnace: 220,
  fireship: 180,
  spgalleon: 1050,
  galleass: 900,
  urca: 380,
};

/** The chapters' common size classes: 1 light craft, 2 medium or support, 3 main warship, 4 great ship or first-rate. */
export type Tier = 1 | 2 | 3 | 4;
const TIER_FLOOR: [number, Tier][] = [[900, 4], [450, 3], [200, 2], [0, 1]];

export function shipPoints(kind: ShipKind, profile: BalanceProfile = COMPETITIVE_PROFILE): number {
  return FITTED[kind] ?? shipSpec(kind, profile).cost;
}

export function shipTier(kind: ShipKind): Tier {
  const spec = shipSpec(kind);
  if (spec.tier) return spec.tier;
  const p = shipPoints(kind);
  return TIER_FLOOR.find(([floor]) => p >= floor)![1];
}

export const fleetPoints = (fleet: readonly ShipKind[]) => fleet.reduce((a, k) => a + shipPoints(k), 0);

/** As many of these kinds as fit in the budget, bought round-robin; a mix keeps its proportions. */
export function fleetFor(kinds: readonly ShipKind[], budget: number): ShipKind[] {
  const out: ShipKind[] = [];
  let left = budget;
  for (let guard = 0; guard < 200; guard += 1) {
    const kind = kinds[guard % kinds.length]!;
    const p = shipPoints(kind);
    if (p > left) break;
    out.push(kind);
    left -= p;
  }
  return out;
}

/** For scripts/balance-cross.mjs --fit only: try other fitted prices in this process. */
export function overridePoints(prices: Partial<Record<ShipKind, number>>) {
  Object.assign(FITTED, prices);
}
