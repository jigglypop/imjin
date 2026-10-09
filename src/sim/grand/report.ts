import type { ShipKind } from '../types';
import { REGIONS } from './regions';
import { contactForces } from './turn';
import type { BattleOutcome, BuildingKind, Grand, GrandFaction, RegionId, ShipUnit } from './types';

/** One side's account of a fight, for the report the player reads after it. */
export type SideSummary = {
  faction: GrandFaction;
  ships: number;
  lost: number;
  kills: number;
};

export type ShipLine = { name: string; kind: ShipKind; hull: number; crew: number; alive: boolean };

/** What a settled meeting looked like, whether it was played in 3D or settled by the numbers. */
export type BattleSummary = {
  contactId: string;
  turn: number;
  regionId: RegionId;
  regionName: string;
  played: boolean;
  attacker: SideSummary;
  defender: SideSummary;
  winner: 'attacker' | 'defender';
  /** The side the player commanded, or null when the player was not in the fight. */
  humanSide: 'attacker' | 'defender' | null;
  captured: boolean;
  /** Ships of the player's side after the fight (of the attacker when the player took no part), the lost ones last. */
  fleet: ShipLine[];
  razed: BuildingKind[];
};

/** Describes a meeting from the campaign as it stood before the outcome was applied. */
export function summarizeBattle(before: Grand, contactId: string, outcome: BattleOutcome, played: boolean): BattleSummary | null {
  const c = before.pending.find((p) => p.id === contactId);
  if (!c) return null;
  const { attackers, defenders } = contactForces(before, c);
  const region = before.regions[c.regionId];
  // Only the ships the fight reported on took part: a 3D battle leaves the reserve beyond its cap outside.
  const reported = new Set(outcome.ships.map((o) => o.campaignId));
  const sides = new Map<string, { side: 'attacker' | 'defender'; unit: ShipUnit }>();
  for (const f of attackers) for (const unit of f.ships) if (reported.has(unit.id)) sides.set(unit.id, { side: 'attacker', unit });
  for (const unit of [...defenders.flatMap((f) => f.ships), ...(region.owner === c.defender ? region.garrison : [])]) if (reported.has(unit.id)) sides.set(unit.id, { side: 'defender', unit });
  const a: SideSummary = { faction: c.attacker, ships: 0, lost: 0, kills: 0 };
  const d: SideSummary = { faction: c.defender, ships: 0, lost: 0, kills: 0 };
  const summaryOf = (side: 'attacker' | 'defender') => (side === 'attacker' ? a : d);
  for (const { side } of sides.values()) summaryOf(side).ships += 1;
  const byId = new Map(outcome.ships.map((o) => [o.campaignId, o]));
  for (const o of outcome.ships) {
    const entry = sides.get(o.campaignId);
    if (!entry) continue;
    const s = summaryOf(entry.side);
    s.kills += o.kills;
    if (!o.alive) s.lost += 1;
  }
  const player = before.player;
  const humanSide = player === null ? null : c.attacker === player || attackers.some((f) => f.faction === player) ? 'attacker' : c.defender === player || defenders.some((f) => f.faction === player) ? 'defender' : null;
  const fleet: ShipLine[] = [...sides.values()]
    .filter((e) => e.side === (humanSide ?? 'attacker'))
    .map(({ unit }) => {
      const o = byId.get(unit.id);
      return { name: unit.name, kind: unit.kind, hull: o ? o.hull : unit.hull, crew: o ? o.crew : unit.crew, alive: o ? o.alive : true };
    })
    .sort((x, y) => Number(y.alive) - Number(x.alive) || y.hull - x.hull);
  return {
    contactId,
    turn: before.turn,
    regionId: c.regionId,
    regionName: REGIONS[c.regionId].name,
    played,
    attacker: a,
    defender: d,
    winner: outcome.winner,
    humanSide,
    captured: outcome.winner === 'attacker',
    fleet,
    razed: outcome.razed,
  };
}
