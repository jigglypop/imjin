import type { WeaponDef } from '../../meta/catalog';
import { ARMADA_COMMANDERS } from '../../sim/grand/regionsArmada';
import { LEPANTO_COMMANDERS } from '../../sim/grand/regionsLepanto';
import { TRAFALGAR_COMMANDERS } from '../../sim/grand/regionsTrafalgar';
import type { CommanderDef } from '../../sim/grand/regions';

/**
 * The commanders of the other chapters on /generals: shown as their figure in their own dress with their era's sword,
 * without the 1592 account progression (armor, loot, talents belong to the Imjin roster). A figure appears once its
 * `<id>__<armor>` file is in public/models/generals/index.json; until then the screen shows the portrait.
 */
export type ChapterNavy = 'england' | 'spain' | 'holyleague' | 'ottoman' | 'britain' | 'france' | 'spain1805';

/** Swords of the other chapters (public/models/generals/parts/weapon_<id>.glb, scripts/weapons-cast.mjs). */
export const CHAPTER_WEAPONS: Record<string, WeaponDef> = {
  rapier: { id: 'rapier', faction: 'joseon', kind: 'sword', name: '레이피어', hanja: '', line: '휘감긴 손잡이의 길고 곧은 양날검' },
  kilij: { id: 'kilij', faction: 'joseon', kind: 'sword', name: '킬리지', hanja: '', line: '끝이 넓어지는 깊게 휜 오스만 군도' },
  naval_sword: { id: 'naval_sword', faction: 'joseon', kind: 'sword', name: '해군 장교검', hanja: '', line: '사자 머리 손잡이의 1805년식 영국 해군검' },
  sabre_fr: { id: 'sabre_fr', faction: 'joseon', kind: 'sword', name: '해군 사브르', hanja: '', line: '닻 문양 손잡이의 프랑스 해군 장교 사브르' },
  espada: { id: 'espada', faction: 'joseon', kind: 'sword', name: '해군 에스파다', hanja: '', line: '조개 모양 코등이의 에스파냐 해군 장교검' },
};

const NAVY_SWORD: Record<ChapterNavy, string> = { england: 'rapier', spain: 'rapier', holyleague: 'rapier', ottoman: 'kilij', britain: 'naval_sword', france: 'sabre_fr', spain1805: 'espada' };

/** Battle-only commanders (no campaign post) who still have a figure. */
const EXTRA: CommanderDef[] = [
  { id: 'jervis', faction: 'britain', name: '존 저비스', title: '지중해 함대 사령관 · 해군 대장', portrait: 'portrait_jervis', level: 3 },
  { id: 'brueys', faction: 'france', name: '프랑수아폴 브뤼에스', title: '프랑스 동방 원정 함대 사령관', portrait: 'portrait_brueys', level: 2 },
  { id: 'cordoba', faction: 'spain1805', name: '호세 데 코르도바', title: '에스파냐 함대 사령관', portrait: 'portrait_cordoba', level: 2 },
] as CommanderDef[];

export const CHAPTER_COMMANDERS: CommanderDef[] = [...ARMADA_COMMANDERS, ...LEPANTO_COMMANDERS, ...TRAFALGAR_COMMANDERS, ...EXTRA];

export const CHAPTER_NAVIES: { id: ChapterNavy; label: string }[] = [
  { id: 'england', label: '잉글랜드' },
  { id: 'spain', label: '에스파냐' },
  { id: 'holyleague', label: '신성동맹' },
  { id: 'ottoman', label: '오스만' },
  { id: 'britain', label: '영국' },
  { id: 'france', label: '프랑스' },
  { id: 'spain1805', label: '에스파냐 1805' },
];

export const chapterRoster = (navy: ChapterNavy) => CHAPTER_COMMANDERS.filter((c) => c.faction === navy);
export const chapterSword = (navy: ChapterNavy): WeaponDef => CHAPTER_WEAPONS[NAVY_SWORD[navy]]!;
export const isChapterNavy = (id: string): id is ChapterNavy => CHAPTER_NAVIES.some((n) => n.id === id);
