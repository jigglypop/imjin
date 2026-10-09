import type { ShipKind } from '../types';
import { josa } from './josa';
import type { Commander, Fleet, Grand, GrandFaction, RegionId, ShipUnit } from './types';
import { mintId, note } from './world';

/** Making ships, fleets and commander experience: what the turn, the starting setup and the historical events share. */

export const LEVEL_XP = [0, 120, 320, 600, 1000, 1500];

export const SHIP_PREFIX: Record<ShipKind, string> = {
  panokseon: '판옥선',
  geobukseon: '거북선',
  hyeopseon: '협선',
  atakebune: '아타케',
  sekibune: '세키부네',
  kobaya: '고바야',
  mingship: '명 복선',
  mingsmall: '명 사선',
};

export function spawnShip(g: Grand, kind: ShipKind, hull = 1, crew = 1): ShipUnit {
  const id = mintId(g, 's');
  return { id, kind, name: `${SHIP_PREFIX[kind]} ${id.slice(1)}호`, hull, crew, supply: 1, kills: 0 };
}

export function spawnFleet(g: Grand, faction: GrandFaction, at: RegionId, name: string, ships: Partial<Record<ShipKind, number>>, commanderId: string | null): Fleet {
  const list: ShipUnit[] = [];
  for (const [kind, n] of Object.entries(ships) as [ShipKind, number][]) for (let i = 0; i < n; i += 1) list.push(spawnShip(g, kind));
  const fleet: Fleet = { id: mintId(g, 'f'), faction, name, commanderId, ships: list, at, transit: null, route: [], from: at, rest: 0 };
  g.fleets.push(fleet);
  return fleet;
}

/** Adds experience to a commander and promotes him as far as it carries him. */
export function grantXp(g: Grand, faction: GrandFaction, cmd: Commander, xp: number): void {
  cmd.xp += xp;
  while (cmd.level < LEVEL_XP.length && cmd.xp >= LEVEL_XP[cmd.level]!) {
    cmd.level += 1;
    note(g, `${cmd.name}의 레벨이 ${josa(String(cmd.level), '으로/로')} 올랐습니다`, faction === g.player ? 'good' : 'info');
  }
}
