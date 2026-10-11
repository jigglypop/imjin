import type { Battle } from '../src/sim/battle';
import type { Conquest } from '../src/sim/conquest';
import type { BattleEvent, Team } from '../src/sim/types';
import { isShipVisible, pointVisible, shipPositionVisible, visibleShips } from '../src/sim/visibility';
import type { ShipMeta } from '../src/net/protocol';

export function observedMetadata(b: Battle, team: Team, known: Map<number, string>, all = false): ShipMeta[] {
  const result: ShipMeta[] = [];
  for (const s of observedShips(b, team)) {
    const meta: ShipMeta = { id: s.id, kind: s.spec.kind, name: s.name, squadron: s.squadronId, flagship: s.flagship, variant: s.variant, owner: s.owner, team: s.team };
    const signature = JSON.stringify(meta);
    if (!all && known.get(s.id) === signature) continue;
    known.set(s.id, signature); result.push(meta);
  }
  return result;
}

export function observedShips(b: Battle, team: Team) {
  const seen = visibleShips(b, team);
  return b.ships.filter((s) => seen.has(s.id));
}

export function observedState(c: Conquest, b: Battle, team: Team) {
  const state = c.state();
  if (b.profile === 'historical') return state;
  state.points.forEach((p, i) => {
    const real = c.points[i]!;
    if (c.players[p.owner]?.team === team || pointVisible(b, team, real.x, real.z)) return;
    p.buildings = real.buildings.map(() => null); p.queue = []; p.rally = null;
  });
  state.players.forEach((p, i) => { if (c.players[i]?.team !== team) { p.funds = 0; p.income = 0; } });
  return state;
}

/** Hidden volleys, hulls and shore construction never enter another team's wire stream. */
export function observedEvent(e: BattleEvent, b: Battle, c: Conquest | null, team: Team): boolean {
  if (b.profile === 'historical') return true;
  if (e.type === 'removed') { const s = b.get(e.ship); return !!s && shipPositionVisible(b, team, s); }
  if ('ship' in e) return isShipVisible(b, team, e.ship);
  if ('a' in e && 'b' in e) return isShipVisible(b, team, e.a) || isShipVisible(b, team, e.b);
  if (e.type === 'captured') return true; // Capture ownership and ticket progress are public objectives.
  if ('point' in e) {
    const p = c?.points[e.point];
    return !!p && (c!.players[p.owner]?.team === team || pointVisible(b, team, p.x, p.z));
  }
  if ('x' in e && 'z' in e) return pointVisible(b, team, e.x, e.z);
  return false;
}
