import type { ShipKind, ShipMods, Team } from '../types';
import { teamOf } from '../types';
import { TUNING, buildingOf, levelOf, shipGold } from './economy';
import { REGION_ORDER, REGIONS, type Terrain } from './regions';
import { mix32 } from './rng';
import { MARCH } from './march';
import { applyContactOutcome, commanderLevel, contactForces, settlePending } from './turn';
import type { BattleOutcome, BattleOutcomeShip, BuildingKind, Contact, Fleet, Grand, GrandFaction, RegionId, ShipUnit } from './types';

/**
 * The seam between the strategic map and the 3D battle. `describeBattle` turns a waiting contact into a typed
 * description the Engine integration reads to build a conquest battle; `applyBattleResult` takes what the battle
 * reports back. Nothing here touches maps.ts or conquest.ts; the battle's coast is in coast.ts.
 *
 * What the Engine integration has to do with a RegionBattle:
 *  - seat the two sides from `attacker` / `defender`. Each ship carries its `campaignId`, hull, crew, supply and
 *    `mods`, applied the way scenarios.ts spawnFleet does for the historical campaign;
 *  - play it on `mapId` with `options` (about 500 tickets and 12 minutes, with every participating ship);
 *  - build `defenderBuildings` in the defender's home port before the first second;
 *  - when it ends, call `outcomeOfBattle` with the winning team, one entry per ship that has a campaignId (the shape
 *    of Engine.finishCampaignBattle's per-ship outcome) and the works razed, then `applyBattleResult`.
 */

/** Ordinary campaign battles bring every participating ship into the 3D battle. */
export const BATTLE_SHIP_CAP = Infinity;

/** Works a conquest port can be given before the first second, by conquest kind. */
export type PrebuiltKind = 'shipyard' | 'battery' | 'magazine' | 'dock' | 'beacon' | 'camp';

export type RegionBattleBuilding = {
  kind: PrebuiltKind;
  /** The campaign work's level: batteries mount more guns and yards launch more ships as it grows. */
  level: number;
  /** Condition left from earlier fights, 0..1. */
  hp: number;
  source: BuildingKind;
};

/** One ship of the persistent fleet, as the battle should spawn it. */
export type BridgeShip = {
  campaignId: string;
  kind: ShipKind;
  name: string;
  hull: number;
  crew: number;
  supply: number;
  kills: number;
  fleetId: string | null;
  /** Preserve each allied fleet's commander portrait inside a shared battle seat. */
  leader?: BridgeSeat['leader'];
  /** Skill of the commander and the ship's veterancy, in the shape Ship.mods takes. */
  mods: ShipMods;
};

export type BridgeSeat = {
  name: string;
  faction: GrandFaction;
  team: Team;
  human: boolean;
  /** Ships that fight, strongest first. */
  ships: BridgeShip[];
  /** Legacy reserve field: uncapped campaign meetings leave this empty. */
  reserve: BridgeShip[];
  leader: { name: string; title: string; portrait: string; level: number } | null;
};

export type RegionBattle = {
  id: string;
  /** The waiting contact this battle settles; pass it back through applyBattleResult. */
  contactId: string;
  turn: number;
  regionId: RegionId;
  regionName: string;
  /** The region's own battle map (`REGION_MAPS` in coast.ts): its coast, capture points and spawn waters. */
  mapId: RegionId;
  terrain: Terrain;
  humanSide: 'attacker' | 'defender';
  seed: number;
  attacker: BridgeSeat;
  defender: BridgeSeat;
  defenderBuildings: RegionBattleBuilding[];
  options: { tickets: number; timeLimit: number; startFunds: { attacker: number; defender: number }; cap: number; maxShips: number };
  /** Level of the port's battery, for the battery's gun count, and how worn it is. */
  battery: number;
  batteryHp: number;
};

type Worth = BridgeShip & { worth: number };

function modsFor(g: Grand, fl: Fleet | undefined, u: ShipUnit): ShipMods {
  const level = fl ? commanderLevel(g, fl) : 1;
  const vet = Math.min(1, u.kills / 12);
  const skill = 0.03 * (level - 1) + 0.04 * vet;
  // A crew caught on a forced march is tired: slower at the guns and in the boarding.
  const tired = fl?.stance === 'march' ? MARCH.tired : 1;
  // The competitive ship already carries its navy's boarding rules; only experience belongs to this bridge.
  // A seasoned commander and a crew that has won before hold their nerve longer; a tired one less so.
  return { reload: (1 + skill) * tired, accuracy: 1 + skill * 0.8, speed: 1, turn: 1, fire: 1, melee: (1 + skill) * tired, defense: 1 + skill * 0.7, morale: (1 + skill) * tired };
}

function toBridge(g: Grand, fl: Fleet | undefined, u: ShipUnit): Worth {
  return {
    campaignId: u.id,
    kind: u.kind,
    name: u.name,
    hull: u.hull,
    crew: u.crew,
    supply: u.supply,
    kills: u.kills,
    fleetId: fl?.id ?? null,
    leader: fl ? leaderOf(g, [fl]) : null,
    mods: modsFor(g, fl, u),
    worth: shipGold(u.kind) * (0.35 + 0.65 * u.hull),
  };
}

/** Every ship fights; strongest hulls lead the initial formation. */
function seatShips(g: Grand, fleets: Fleet[], local: ShipUnit[] = []): { ships: BridgeShip[]; reserve: BridgeShip[]; worth: number } {
  const all = [...fleets.flatMap((fl) => fl.ships.map((u) => toBridge(g, fl, u))), ...local.map((u) => toBridge(g, undefined, u))];
  all.sort((a, b) => b.worth - a.worth);
  const plain = (list: Worth[]): BridgeShip[] => list.map(({ worth: _w, ...ship }) => ship);
  return { ships: plain(all), reserve: [], worth: all.reduce((a, s) => a + s.worth, 0) };
}

/** The conquest building each campaign work becomes when it stands in the defender's port. */
const WORKS: Partial<Record<BuildingKind, PrebuiltKind>> = { camp: 'camp', shipyard: 'shipyard', battery: 'battery', dock: 'dock', beacon: 'beacon', granary: 'magazine' };

function leaderOf(g: Grand, fleets: Fleet[]): BridgeSeat['leader'] {
  const best = [...fleets].sort((a, b) => commanderLevel(g, b) - commanderLevel(g, a))[0];
  const cmd = best?.commanderId ? g.factions[best.faction].commanders.find((c) => c.id === best.commanderId) : undefined;
  return cmd?.alive ? { name: cmd.name, title: cmd.title, portrait: cmd.portrait, level: cmd.level } : null;
}

/**
 * A battle has two teams: the Joseon side (with Ming) and the Japanese side. A fight between Joseon and Ming (a broken
 * alliance) puts the attacker on the side it does not naturally belong to.
 */
export function teamsFor(attacker: GrandFaction, defender: GrandFaction): { attacker: Team; defender: Team } {
  const a = teamOf(attacker);
  const d = teamOf(defender);
  if (a !== d) return { attacker: a, defender: d };
  return { attacker: a === 'joseon' ? 'japan' : 'joseon', defender: d };
}

export function describeBattle(g: Grand, contactId: string): RegionBattle | null {
  const c = g.pending.find((p) => p.id === contactId);
  return c ? describeContact(g, c) : null;
}

export function describeContact(g: Grand, c: Contact): RegionBattle {
  const forces = contactForces(g, c);
  const region = g.regions[c.regionId];
  const def = REGIONS[c.regionId];
  const teams = teamsFor(c.attacker, c.defender);
  // A meeting out at sea is fought in the waters of the nearer port, without its guard boats, guns or works.
  const home = !c.sea && region.owner === c.defender;
  const atk = seatShips(g, forces.attackers);
  const dfn = seatShips(g, forces.defenders, home ? region.garrison : []);
  const works: RegionBattleBuilding[] = [];
  if (home) {
    for (const b of region.buildings) {
      const kind = WORKS[b.kind];
      if (kind && b.level > 0) works.push({ kind, level: b.level, hp: b.hp, source: b.kind });
    }
  }
  const humanAttacker = g.player !== null && (c.attacker === g.player || forces.attackers.some((f) => f.faction === g.player));
  const anyHuman = g.player !== null;
  return {
    id: `${g.seed}:${c.id}`,
    contactId: c.id,
    turn: g.turn,
    regionId: c.regionId,
    regionName: def.name,
    mapId: c.regionId,
    terrain: def.terrain,
    humanSide: humanAttacker ? 'attacker' : 'defender',
    seed: mix32(g.seed ^ mix32(g.turn * 131 + REGION_ORDER.indexOf(c.regionId))) || 1592,
    attacker: { name: TUNING.faction[c.attacker].label, faction: c.attacker, team: teams.attacker, human: humanAttacker, ships: atk.ships, reserve: atk.reserve, leader: leaderOf(g, forces.attackers) },
    defender: { name: TUNING.faction[c.defender].label, faction: c.defender, team: teams.defender, human: anyHuman && !humanAttacker, ships: dfn.ships, reserve: dfn.reserve, leader: leaderOf(g, forces.defenders) },
    defenderBuildings: works,
    options: {
      tickets: 500,
      timeLimit: 12 * 60,
      // Reinforcements during the fight come from the yard; a port without one fights with what it has.
      startFunds: { attacker: 200, defender: home && levelOf(region, 'shipyard') > 0 ? 700 : 300 },
      cap: Infinity,
      maxShips: BATTLE_SHIP_CAP,
    },
    battery: home ? levelOf(region, 'battery') : 0,
    batteryHp: home ? buildingOf(region, 'battery')?.hp ?? 0 : 0,
  };
}

/** The winning side of a finished battle, from the team that won. A time out nobody won goes to the defender: the attacker came to take the port. */
export function winnerOfBattle(rb: RegionBattle, winnerTeam: Team | null): 'attacker' | 'defender' {
  return winnerTeam !== null && winnerTeam === rb.attacker.team ? 'attacker' : 'defender';
}

/**
 * Builds the outcome the campaign needs from what the Engine knows after a battle: the winning team, one entry per
 * ship that carried a campaignId, and the works that were razed.
 */
export function outcomeOfBattle(rb: RegionBattle, winnerTeam: Team | null, ships: BattleOutcomeShip[], razed: BuildingKind[] = []): BattleOutcome {
  return { winner: winnerOfBattle(rb, winnerTeam), ships, razed };
}

/** Applies a played battle to the campaign. Returns false when the contact is no longer waiting (a stale or doubled report). */
export function applyBattleResult(g: Grand, rb: RegionBattle, outcome: BattleOutcome): boolean {
  const c = g.pending.find((p) => p.id === rb.contactId);
  if (!c || g.turn !== rb.turn) return false;
  applyContactOutcome(g, c, outcome);
  settlePending(g);
  return true;
}
