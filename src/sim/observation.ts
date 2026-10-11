import type { Battle } from './battle';
import type { BattleEvent, Ship, Team } from './types';
import type { Conquest } from './conquest';
import { isShipVisible, pointVisible, shipPositionVisible } from './visibility';

/** A remote snapshot's presence is authoritative; a local battle queries its live lookouts. */
export function shipObserved(b: Battle, team: Team, s: Ship): boolean {
  return s.team === team || (s.observed === undefined ? isShipVisible(b, team, s.id) : s.observed);
}

export function eventObserved(e: BattleEvent, b: Battle, c: Conquest | null, team: Team): boolean {
  if (b.profile === 'historical') return true;
  if (e.type === 'removed') { const s = b.get(e.ship); return !!s && shipPositionVisible(b, team, s); }
  const seen = (id: number) => { const s = b.get(id); return !!s && shipObserved(b, team, s); };
  if ('ship' in e) return seen(e.ship);
  if ('a' in e && 'b' in e) return seen(e.a) || seen(e.b);
  if (e.type === 'captured') return true;
  if ('point' in e) { const p = c?.points[e.point]; return !!p && (c!.players[p.owner]?.team === team || pointVisible(b, team, p.x, p.z)); }
  if ('x' in e && 'z' in e) return pointVisible(b, team, e.x, e.z);
  return false;
}
