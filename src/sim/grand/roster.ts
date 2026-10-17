import type { ShipKind } from '../types';
import type { Commander, Fleet, Grand, GrandFaction, RegionId, ShipUnit } from './types';
import { mintId, note } from './world';

/** Making ships, fleets and commander experience: what the turn, the starting setup and the historical events share. */

export const LEVEL_XP = [0, 120, 320, 600, 1000, 1500];

export const SHIP_PREFIX: Record<ShipKind, string> = {
  panokseon: '판옥선',
  geobukseon: '거북선',
  hyeopseon: '협선',
  atakebune: '아타케부네',
  sekibune: '세키부네',
  kobaya: '고바야',
  mingship: '명 대형선',
  mingsmall: '명 소형선',
  sahuseon: '사후선',
  pojakseon: '포작선',
  daeantaek: '대안택선',
  sogantaek: '소안택선',
  daegwanseon: '대관선',
  byeongnyangseon: '병량선',
  gwangseon: '명 광선',
  haechangseon: '명 해창선',
  hoseon: '명 호선',
  racegalleon: '갤리온',
  pinnace: '핀네이스',
  fireship: '화공선',
  spgalleon: '에스파냐 갤리온',
  galleass: '갈레아스',
  urca: '우르카',
  reale: '라 레알',
  galea: '갤리선',
  vgalleass: '베네치아 갈레아스',
  sultana: '술타나',
  kadirga: '카드르가',
  kalyata: '칼리야타',
};

export function spawnShip(g: Grand, kind: ShipKind, hull = 1, crew = 1): ShipUnit {
  const id = mintId(g, 's');
  return { id, kind, name: `${SHIP_PREFIX[kind]} ${id.slice(1)}호`, hull, crew, supply: 1, kills: 0 }; // i18n-ignore: numbered ship; the UI translates the pattern
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
    note(g, '{name}의 레벨이 {level|으로/로} 올랐습니다', { name: cmd.name, level: String(cmd.level) }, faction === g.player ? 'good' : 'info');
  }
}
