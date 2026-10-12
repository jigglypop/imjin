import type { ShipKind } from '../types';
import { shipDef } from './economy';
import { REGIONS } from './regions';
import { contactForces } from './turn';
import type { BattleOutcome, BuildingKind, Grand, GrandFaction, RegionId, ShipUnit } from './types';

export type BattleGrade = 'heroic' | 'decisive' | 'clear' | 'close' | 'pyrrhic';

/** The Korean words for each grade, as the log and the report show them (translated where they are drawn). */
export const GRADE_TEXT: Record<BattleGrade, string> = { heroic: '영웅적인 승리', decisive: '대승', clear: '승리', close: '신승', pyrrhic: '상처뿐인 승리' };

/**
 * How a fight was won, the way a campaign map tells it: a win against heavy odds is heroic, a rout that cost the
 * winner little is decisive, a win that cost the winner half its worth is pyrrhic. Worth is fighting strength, at
 * the start and lost in the fight, of the winning and the losing side.
 */
export function battleGrade(winnerStart: number, winnerLost: number, loserStart: number, loserLost: number): BattleGrade {
  const paid = winnerLost / Math.max(1, winnerStart);
  const dealt = loserLost / Math.max(1, loserStart);
  if (paid >= 0.5) return 'pyrrhic';
  if (winnerStart < loserStart * 0.6) return 'heroic';
  if (dealt >= 0.6 && paid <= 0.25) return 'decisive';
  if (paid >= 0.3 || dealt < 0.25) return 'close';
  return 'clear';
}

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
  /** How the win went (march rules; absent in the lane rules' wars). */
  grade?: BattleGrade;
  /** A meeting out at sea, off `regionName`, rather than a fight for the port. */
  atSea?: boolean;
};

/** Describes a meeting from the campaign as it stood before the outcome was applied. */
export function summarizeBattle(before: Grand, contactId: string, outcome: BattleOutcome, played: boolean): BattleSummary | null {
  const c = before.pending.find((p) => p.id === contactId);
  if (!c) return null;
  const { attackers, defenders } = contactForces(before, c);
  const region = before.regions[c.regionId];
  const home = !c.sea && region.owner === c.defender;
  // Only the ships the fight reported on took part: a 3D battle leaves the reserve beyond its cap outside.
  const reported = new Set(outcome.ships.map((o) => o.campaignId));
  const sides = new Map<string, { side: 'attacker' | 'defender'; unit: ShipUnit }>();
  for (const f of attackers) for (const unit of f.ships) if (reported.has(unit.id)) sides.set(unit.id, { side: 'attacker', unit });
  for (const unit of [...defenders.flatMap((f) => f.ships), ...(home ? region.garrison : [])]) if (reported.has(unit.id)) sides.set(unit.id, { side: 'defender', unit });
  const a: SideSummary = { faction: c.attacker, ships: 0, lost: 0, kills: 0 };
  const d: SideSummary = { faction: c.defender, ships: 0, lost: 0, kills: 0 };
  const summaryOf = (side: 'attacker' | 'defender') => (side === 'attacker' ? a : d);
  for (const { side } of sides.values()) summaryOf(side).ships += 1;
  const byId = new Map(outcome.ships.map((o) => [o.campaignId, o]));
  // Fighting worth at the start and lost, per side, for the grade of the win.
  const worth = { attacker: [0, 0], defender: [0, 0] };
  for (const o of outcome.ships) {
    const entry = sides.get(o.campaignId);
    if (!entry) continue;
    const s = summaryOf(entry.side);
    s.kills += o.kills;
    if (!o.alive) s.lost += 1;
    const strength = shipDef(entry.unit.kind).strength;
    worth[entry.side][0]! += strength * entry.unit.hull;
    worth[entry.side][1]! += strength * Math.max(0, entry.unit.hull - (o.alive ? o.hull : 0));
  }
  const [win, lose] = outcome.winner === 'attacker' ? [worth.attacker, worth.defender] : [worth.defender, worth.attacker];
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
    captured: outcome.winner === 'attacker' && !c.sea,
    fleet,
    razed: outcome.razed,
    ...(before.march ? { grade: battleGrade(win[0]!, win[1]!, lose[0]!, lose[1]!) } : {}),
    ...(c.sea ? { atSea: true } : {}),
  };
}
