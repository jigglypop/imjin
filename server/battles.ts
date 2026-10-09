// What a room can fight and how the server builds it. A conquest battle comes from buildConquest; a historical
// scenario is built the way the client builds it (unturned map, the scenario's own land and current), with one human
// leading each side.
import type { Battle } from '../src/sim/battle';
import { applyBalance } from '../src/sim/balance';
import type { Conquest } from '../src/sim/conquest';
import { CurrentField } from '../src/sim/current';
import { autoFleet, buildConquest, CONQUEST_MAPS, type ConquestMapId, type Seat } from '../src/sim/maps';
import { buildScenario, SCENARIOS, type ScenarioId } from '../src/sim/scenarios';
import type { Faction, LandSampler } from '../src/sim/types';
import type { BattleChoice, RoomSeat } from '../src/net/protocol';

/** An enemy this close (metres) ends the skipped approach. Same number as Engine.CONTACT_RANGE. */
const CONTACT_RANGE = 400;

export const DEFAULT_CHOICE: BattleChoice = { kind: 'conquest', map: 'hallyeo', size: 2 };

/** Whatever arrived over the wire, as a choice the server can run. */
export function sanitizeChoice(raw: unknown): BattleChoice {
  const c = raw as { kind?: string; id?: string; map?: string; size?: number } | null | undefined;
  if (c?.kind === 'scenario' && c.id && c.id in SCENARIOS) return { kind: 'scenario', id: c.id as ScenarioId };
  if (c?.kind === 'conquest' && c.map && c.map in CONQUEST_MAPS) {
    const map = c.map as ConquestMapId;
    return { kind: 'conquest', map, size: c.size === 4 && CONQUEST_MAPS[map].seats >= 4 ? 4 : 2 };
  }
  return DEFAULT_CHOICE;
}

/** Players are matched when they ask for the same battle. */
export const choiceKey = (c: BattleChoice) => (c.kind === 'scenario' ? `scenario:${c.id}` : `conquest:${c.map}`);

export const terrainOf = (c: BattleChoice) => (c.kind === 'scenario' ? SCENARIOS[c.id].terrain : CONQUEST_MAPS[c.map].terrain);

export function titleOf(c: BattleChoice) {
  return c.kind === 'scenario' ? SCENARIOS[c.id].title : CONQUEST_MAPS[c.map].title;
}

const seat = (name: string, faction: Faction, team: RoomSeat['team']): RoomSeat => ({ name, player: '', faction, team, human: true, client: null, ready: false, away: false, rematch: false });

/** The seats of a new room. Seat 0 is the western (Joseon) side and seat 1 the eastern one. */
export function openSeats(c: BattleChoice): RoomSeat[] {
  const seats = [seat('서군', 'joseon', 'joseon'), seat('동군', 'japan', 'japan')];
  if (c.kind === 'conquest' && c.size === 4) seats.push(seat('서군 우익', 'ming', 'joseon'), seat('동군 우익', 'japan', 'japan'));
  return seats;
}

export type Built = { battle: Battle; conquest: Conquest | null; seats: Seat[] };

/** `human` says which seats are played by a person; the others are the computer's. In a duel the seat index is the owner. */
export function buildBattle(choice: BattleChoice, land: LandSampler, seats: Pick<RoomSeat, 'faction' | 'team'>[], names: string[], human: boolean[], seed: number): Built {
  if (choice.kind === 'conquest') {
    const list: Seat[] = seats.map((s, i) => ({ name: names[i]!, faction: s.faction, team: s.team, human: human[i]!, fleet: autoFleet(s.faction) }));
    const built = buildConquest(choice.map, list, land, seed);
    return { battle: built.battle, conquest: built.conquest, seats: list };
  }
  const info = SCENARIOS[choice.id];
  const battle = buildScenario(choice.id, 0, seed, land);
  // The corrections in balance.ts make a side fair against the computer; two people get the written scenario.
  applyBalance(battle, choice.id, 'joseon');
  battle.humans = new Set(human.flatMap((h, i) => (h ? [i] : [])));
  battle.land = land;
  battle.flow = info.current ? new CurrentField(info.current, land, 0) : null;
  battle.center = { x: info.view.tx, z: info.view.tz };
  battle.arenaRadius = 5200;
  const list: Seat[] = seats.map((s, i) => ({ name: names[i]!, faction: s.faction, team: s.team, human: human[i]!, fleet: [] }));
  return { battle, conquest: null, seats: list };
}

/** The same rule as Engine.inContact: a shot in the air, a grapple, an enemy within range, or one side gone. */
export function inContact(b: Battle) {
  if (b.projectiles.length > 0) return true;
  let contact = false;
  for (const team of ['joseon', 'japan'] as const) {
    const own = b.activeOf(team);
    if (own.length === 0) return true;
    for (const s of own) {
      if (s.grappledWith) return true;
      b.near(s.x, s.z, CONTACT_RANGE, (o) => {
        if (o.team !== s.team && b.isActive(o)) contact = true;
      });
      if (contact) return true;
    }
  }
  return false;
}
