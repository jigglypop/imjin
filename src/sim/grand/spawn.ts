import type { Battle } from '../battle';
import { GUN_SHOTS, SHIP_SPECS } from '../catalog';
import { BUILDINGS, SHORT_NAME, type Building, type BuildingKind as WorkKind, type Conquest } from '../conquest';
import { buildConquest, type ConquestMapId, type Seat } from '../maps';
import type { LandSampler, Ship, Squadron } from '../types';
import type { BridgeSeat, RegionBattle, RegionBattleBuilding } from './bridge';
import type { BattleOutcomeShip, BuildingKind } from './types';

/**
 * Plays a campaign meeting as a conquest battle. The two sides take the two home ports of the region's map; their ships
 * are the persistent hulls of the campaign, spawned with the hull, crew, supply and skill they carry, and the
 * defender's home port gets the works its region has. Nothing here edits the conquest builder: it is asked for a battle
 * without opening fleets, and the fleets are put in afterwards.
 */

/** The attacker sits in the first home port and the defender in the second. */
export const ATTACKER_SEAT = 0;
export const DEFENDER_SEAT = 1;

/** The conquest seats of a region battle. The fleets are empty: `spawnGrandFleets` puts the campaign's ships in. */
export function grandSeats(rb: RegionBattle): Seat[] {
  const seat = (s: BridgeSeat): Seat => ({ name: s.name, faction: s.faction, team: s.team, human: s.human, fleet: [] });
  return [seat(rb.attacker), seat(rb.defender)];
}

/** Which seat the player commands. */
export const grandYou = (rb: RegionBattle) => (rb.humanSide === 'attacker' ? ATTACKER_SEAT : DEFENDER_SEAT);

/** The conquest map of a region battle. */
export const grandMap = (rb: RegionBattle): ConquestMapId => rb.mapId;

const DEFAULT_PORTRAIT = { joseon: 'portrait_admiral', japan: 'portrait_japan', ming: 'portrait_deng' } as const;
const HP_FLOOR = 0.25;

/** The works the defender's port stands with, in the order they take the plots on the shore: yard, then guns, then the rest. */
export function standingWorks(works: RegionBattleBuilding[]): RegionBattleBuilding[] {
  const out: RegionBattleBuilding[] = [];
  for (const w of works) {
    if (w.kind === 'shipyard') out.push(w);
  }
  // A battery of level n mounts n shore batteries, as many as the plots allow.
  for (const w of works) {
    if (w.kind === 'battery') for (let i = 0; i < w.level; i += 1) out.push(w);
  }
  for (const w of works) {
    if (w.kind !== 'shipyard' && w.kind !== 'battery') out.push(w);
  }
  return out;
}

function stand(conquest: Conquest, slot: number, works: RegionBattleBuilding[]) {
  const home = conquest.homeOf(slot);
  if (!home) return;
  home.buildings.fill(null);
  // The conquest keeps its building constructor private; the gun reload timers belong to it.
  const make = (kind: WorkKind) => (conquest as unknown as { newBuilding(kind: WorkKind, done: boolean): Building }).newBuilding(kind, true);
  standingWorks(works)
    .slice(0, home.buildings.length)
    .forEach((w, i) => {
      const made = make(w.kind);
      made.hp = BUILDINGS[w.kind].hp * Math.max(HP_FLOOR, Math.min(1, w.hp));
      home.buildings[i] = made;
    });
}

function spawnSeat(b: Battle, conquest: Conquest, slot: number, seat: BridgeSeat, land: LandSampler) {
  const home = conquest.homeOf(slot);
  if (!home) return;
  const toCentre = Math.atan2(-home.z, -home.x);
  const fx = Math.cos(toCentre);
  const fz = Math.sin(toCentre);
  const cols = Math.max(3, Math.min(8, Math.ceil(Math.sqrt(seat.ships.length * 1.3))));
  const squads = new Map<string, Squadron>();
  const portrait = seat.leader?.portrait ?? DEFAULT_PORTRAIT[seat.faction];
  const commander = seat.leader ? `${seat.leader.title} ${seat.leader.name}` : `${seat.name} 수군`;
  seat.ships.forEach((u, i) => {
    const spec = SHIP_SPECS[u.kind];
    // A squadron holds six ships of one kind, the way the conquest raises them.
    const same = seat.ships.slice(0, i).filter((o) => o.kind === u.kind).length;
    const key = `${u.kind}:${Math.floor(same / 6)}`;
    let sq = squads.get(key);
    if (!sq) {
      const index = [...squads.keys()].filter((k) => k.startsWith(`${u.kind}:`)).length + 1;
      const card = `card_${u.kind === 'hyeopseon' || u.kind.startsWith('ming') ? 'panokseon' : u.kind === 'kobaya' ? 'sekibune' : u.kind}`;
      sq = b.addSquadron(seat.team, `${SHORT_NAME[u.kind]} ${index}대`, commander, portrait, card, slot);
      // A squadron of an allied navy (Ming beside Joseon) is listed with the seat that commands it.
      sq.faction = seat.faction;
      squads.set(key, sq);
    }
    const row = Math.floor(i / cols);
    const col = (i % cols) - (cols - 1) / 2;
    let x = home.spawn.x + fx * (60 - row * 62) - fz * col * 58;
    let z = home.spawn.z + fz * (60 - row * 62) + fx * col * 58;
    for (let tries = 0; tries < 30 && land(x, z) > -5; tries += 1) {
      x += fx * 25;
      z += fz * 25;
    }
    const flagship = i === 0 && !!seat.leader;
    const ship = b.addShip(u.kind, x, z, toCentre, u.name, sq, flagship, u.kind === 'panokseon' ? (flagship ? 0 : 1 + (i % 2)) : 0);
    ship.hull = spec.hull * Math.max(0.05, u.hull);
    b.setCrew(ship, spec.crew * Math.max(0.05, u.crew));
    b.applySupply(ship, u.supply);
    ship.mods = { ...u.mods };
    ship.campaignId = u.campaignId;
    ship.order = { type: 'hold' };
    sq.faction = seat.faction;
  });
}

/**
 * A conquest battle on the region's map with the campaign's ships in place, the defender's port built up and the
 * battle's options and starting funds set. `axis` turns the map about its centre for the light, like any conquest.
 */
export function buildGrandConquest(rb: RegionBattle, land: LandSampler, axis = 0) {
  const o = rb.options;
  const built = buildConquest(rb.mapId, grandSeats(rb), land, rb.seed, { tickets: o.tickets, timeLimit: o.timeLimit, cap: o.cap, maxShips: o.maxShips }, axis);
  const { battle, conquest } = built;
  conquest.players[ATTACKER_SEAT]!.funds = o.startFunds.attacker;
  conquest.players[DEFENDER_SEAT]!.funds = o.startFunds.defender;
  // The attacker comes by sea with no works; the defender's port has what its region built.
  stand(conquest, ATTACKER_SEAT, []);
  stand(conquest, DEFENDER_SEAT, rb.defenderBuildings);
  // Ships the conquest raises during the fight are numbered from one; the campaign's own hulls carry their numbers already.
  (conquest as unknown as { recruitSeq: Map<string, number> }).recruitSeq.clear();
  spawnSeat(battle, conquest, ATTACKER_SEAT, rb.attacker, land);
  spawnSeat(battle, conquest, DEFENDER_SEAT, rb.defender, land);
  battle.events.length = 0;
  return built;
}

/** What a finished battle did to the ships that came from the campaign. Reinforcements raised in the fight carry no campaign id and are not counted. */
export function shipOutcomes(ships: readonly Ship[]): BattleOutcomeShip[] {
  return ships
    .filter((s) => s.campaignId)
    .map((s) => {
      let ammo = 0;
      let max = 0;
      for (const g of s.guns) {
        ammo += g.ammo;
        max += GUN_SHOTS[s.spec.batteries[g.battery]!.gun];
      }
      return {
        campaignId: s.campaignId,
        alive: (s.alive || !!s.fled) && s.sinking === 0 && !s.struck,
        hull: Math.max(0, s.hull / s.spec.hull),
        crew: Math.max(0, s.crew / s.spec.crew),
        supply: max ? Math.min(s.supply, ammo / max) : s.supply,
        kills: s.kills,
      };
    });
}

const SOURCE_OF: Record<WorkKind, BuildingKind> = { shipyard: 'shipyard', battery: 'battery', magazine: 'granary', dock: 'dock', beacon: 'beacon' };

/** The works of the defender's port that fell in the battle, and how worn the rest are. */
export function worksAfter(rb: RegionBattle, conquest: Conquest): { razed: BuildingKind[]; damage: Partial<Record<BuildingKind, number>> } {
  const home = conquest.homeOf(DEFENDER_SEAT);
  const before = standingWorks(rb.defenderBuildings).slice(0, home?.buildings.length ?? 0);
  const left = (home?.buildings ?? []).filter((x): x is NonNullable<typeof x> => !!x);
  const razed: BuildingKind[] = [];
  const damage: Partial<Record<BuildingKind, number>> = {};
  for (const kind of Object.keys(SOURCE_OF) as WorkKind[]) {
    const had = before.filter((w) => w.kind === kind);
    const now = left.filter((x) => x.kind === kind);
    for (let i = now.length; i < had.length; i += 1) razed.push(SOURCE_OF[kind]);
    // Works the computer raised during the fight are not the campaign's to count.
    if (!had.length || now.length < had.length) continue;
    const worn = now.reduce((a, x) => a + Math.max(0, Math.max(HP_FLOOR, Math.min(1, had[0]!.hp)) - x.hp / BUILDINGS[kind].hp), 0) / now.length;
    if (worn > 0) damage[SOURCE_OF[kind]] = worn;
  }
  return { razed, damage };
}
