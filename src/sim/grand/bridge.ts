import type { ShipKind, ShipMods, Team } from '../types';
import { teamOf } from '../types';
import { TUNING, buildingOf, levelOf, shipGold } from './economy';
import { REGION_ORDER, REGIONS, type Terrain } from './regions';
import { mix32 } from './rng';
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
 *  - play it on `mapId` with `options` (about 500 tickets, 12 minutes, at most `maxShips` per side);
 *  - build `defenderBuildings` in the defender's home port before the first second;
 *  - when it ends, call `outcomeOfBattle` with the winning team, one entry per ship that has a campaignId (the shape
 *    of Engine.finishCampaignBattle's per-ship outcome) and the works razed, then `applyBattleResult`.
 */

/** Ships a side brings into a 3D battle. The rest wait outside as a reserve and are untouched by it. */
export const BATTLE_SHIP_CAP = 30;

/** Works a conquest port can be given before the first second, by conquest kind. */
export type PrebuiltKind = 'shipyard' | 'battery' | 'magazine' | 'dock' | 'beacon';

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
  /** Ships beyond the battle's cap: they do not fight and are not changed by the result. */
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
  // The Japanese fight on the deck: a boarding bonus for the sword.
  const boarding = u.kind === 'atakebune' || u.kind === 'sekibune' || u.kind === 'kobaya' ? 1.15 : 1;
  return { reload: 1 + skill, accuracy: 1 + skill * 0.8, speed: 1, turn: 1, fire: 1, melee: (1 + skill) * boarding, defense: 1 + skill * 0.7 };
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
    mods: modsFor(g, fl, u),
    worth: shipGold(u.kind) * (0.35 + 0.65 * u.hull),
  };
}

/** Splits a side into the strongest hulls that fight and a reserve that waits outside the port. */
function seatShips(g: Grand, fleets: Fleet[], local: ShipUnit[] = []): { ships: BridgeShip[]; reserve: BridgeShip[]; worth: number } {
  const all = [...fleets.flatMap((fl) => fl.ships.map((u) => toBridge(g, fl, u))), ...local.map((u) => toBridge(g, undefined, u))];
  all.sort((a, b) => b.worth - a.worth);
  const plain = (list: Worth[]): BridgeShip[] => list.map(({ worth: _w, ...ship }) => ship);
  return { ships: plain(all.slice(0, BATTLE_SHIP_CAP)), reserve: plain(all.slice(BATTLE_SHIP_CAP)), worth: all.slice(0, BATTLE_SHIP_CAP).reduce((a, s) => a + s.worth, 0) };
}

/** The conquest building each campaign work becomes when it stands in the defender's port. */
const WORKS: Partial<Record<BuildingKind, PrebuiltKind>> = { shipyard: 'shipyard', battery: 'battery', dock: 'dock', beacon: 'beacon', granary: 'magazine' };

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
  const atk = seatShips(g, forces.attackers);
  const dfn = seatShips(g, forces.defenders, region.owner === c.defender ? region.garrison : []);
  const works: RegionBattleBuilding[] = [];
  if (region.owner === c.defender) {
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
      startFunds: { attacker: 200, defender: levelOf(region, 'shipyard') > 0 ? 700 : 300 },
      cap: Math.max(3000, Math.round(Math.max(atk.worth, dfn.worth) * 2.2)),
      maxShips: BATTLE_SHIP_CAP,
    },
    battery: levelOf(region, 'battery'),
    batteryHp: buildingOf(region, 'battery')?.hp ?? 0,
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
