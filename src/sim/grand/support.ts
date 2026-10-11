import type { ShipKind } from '../types';
import type { Grand, GrandFaction } from './types';

/** A human commands the full navy; its original computer ally provides a smaller supporting force. */
export const ALLY_SUPPORT = { startingFleet: 0.6, income: 0.65, reinforcements: 0.6 } as const;

export function newAllySupport(player: GrandFaction | null): Grand['allySupport'] {
  const faction = player === 'joseon' ? 'ming' : player === 'ming' ? 'joseon' : null;
  return faction ? { version: 'player-ally-v1', faction, reinforcementCarry: {} } : undefined;
}

/** The saved rule only affects the selected human's original ally while that alliance still stands. */
export function supportAlly(g: Grand, faction: GrandFaction): boolean {
  const rule = g.allySupport;
  const expected = g.player === 'joseon' ? 'ming' : g.player === 'ming' ? 'joseon' : null;
  return rule?.version === 'player-ally-v1' && rule.faction === expected && faction === expected && g.relations['joseon:ming'] === 'allied';
}

export const allyIncomeMultiplier = (g: Grand, faction: GrandFaction) => supportAlly(g, faction) ? ALLY_SUPPORT.income : 1;

/** Only called on the fresh, not-yet-spawned opening roster; no saved or living ships are ever removed. */
export function scaleAllyOpening(g: Grand, fleets: { faction: GrandFaction; ships: Partial<Record<ShipKind, number>> }[]): void {
  const faction = g.allySupport?.faction;
  if (!faction || !supportAlly(g, faction)) return;
  const own = fleets.filter((f) => f.faction === faction);
  const kinds = new Set(own.flatMap((f) => Object.keys(f.ships) as ShipKind[]));
  for (const kind of kinds) {
    const pieces = own.map((fleet, index) => ({ fleet, index, amount: (fleet.ships[kind] ?? 0) * ALLY_SUPPORT.startingFleet }));
    let left = Math.round(pieces.reduce((sum, p) => sum + p.amount, 0));
    for (const p of pieces) { p.fleet.ships[kind] = Math.floor(p.amount); left -= p.fleet.ships[kind]!; }
    pieces.sort((a, b) => (b.amount % 1) - (a.amount % 1) || a.index - b.index);
    for (const p of pieces) if (left-- > 0) p.fleet.ships[kind] = (p.fleet.ships[kind] ?? 0) + 1;
  }
}

/** Fractional free hulls carry between scheduled and event reinforcements, including after save/load. */
export function supportReinforcements(g: Grand, faction: GrandFaction, ships: Partial<Record<ShipKind, number>>): Partial<Record<ShipKind, number>> {
  if (!supportAlly(g, faction)) return ships;
  const carry = g.allySupport!.reinforcementCarry;
  const scaled: Partial<Record<ShipKind, number>> = {};
  for (const [kind, n] of Object.entries(ships) as [ShipKind, number][]) {
    const amount = n * ALLY_SUPPORT.reinforcements + (carry[kind] ?? 0);
    const count = Math.floor(amount + 1e-9);
    carry[kind] = Math.max(0, amount - count);
    if (count > 0) scaled[kind] = count;
  }
  return scaled;
}
