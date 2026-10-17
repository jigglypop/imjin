import { shipSpec, type BalanceProfile, COMPETITIVE_PROFILE } from './competitive';
import type { ShipKind } from './types';

/**
 * Cross-chapter fleet points. A ship of any chapter costs this many points in a mixed skirmish, a lane match's waves and
 * the chapter campaigns' musters, so a fleet of galleons and a fleet of panokseon of equal points are an even fight.
 *
 * A ship's points are its competitive price (src/sim/competitive.ts): the 1592 kinds keep the price the ranked balance
 * was settled on, and every later chapter's kinds are priced against them in AI conquest matches
 * (scripts/balance-competitive.mjs) and open-water duels (scripts/balance-cross.mjs). The model is in
 * docs/balance-cross.md. FITTED overrides a price for the duel harness's --fit runs only.
 */
const FITTED: Partial<Record<ShipKind, number>> = {};

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
