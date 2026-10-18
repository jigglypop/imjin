import { hashSeed, rng, rollEffect, rollPieces, type ArmorRoll, type PrimaryStat } from './affixes';
import { WEAPONS, type MetaEffect, type MetaFaction } from './catalog';
import { ERA_BASES } from './lootEras';

/**
 * Loot (전리품): swords, spears, bows, armor pieces, command trinkets, war manuals and seals that battles drop. Pure and
 * deterministic like rules.ts: a drop is decided by the profile's salt (the account id on the server) and its drop
 * counter, an item's stats by the salt, its uid and how often it was reforged, so the server's word can be checked by
 * anyone holding the salt and nobody can send a roll of their own. Design: docs/design-growth.md.
 */
export type GearSlot = 'weapon' | 'armor' | 'trinket' | 'book' | 'seal';
export const GEAR_SLOTS: readonly GearSlot[] = ['weapon', 'armor', 'trinket', 'book', 'seal'];
export const SLOT_LABEL: Record<GearSlot, string> = { weapon: '무기', armor: '방구', trinket: '지휘구', book: '병서', seal: '인장' };

export type Rarity = 'common' | 'fine' | 'rare' | 'epic' | 'legendary';
export const RARITIES: readonly Rarity[] = ['common', 'fine', 'rare', 'epic', 'legendary'];
export const RARITY_LABEL: Record<Rarity, string> = { common: '일반', fine: '고급', rare: '희귀', epic: '영웅', legendary: '전설' };
/** Out of 1000 drops, before luck. */
const RARITY_WEIGHT: Record<Rarity, number> = { common: 560, fine: 280, rare: 120, epic: 34, legendary: 6 };
export const RARITY_ROLL: Record<Rarity, { points: [number, number]; affixes: [number, number] }> = {
  common: { points: [1, 3], affixes: [0, 0] },
  fine: { points: [2, 5], affixes: [0, 1] },
  rare: { points: [4, 7], affixes: [1, 1] },
  epic: { points: [6, 9], affixes: [1, 2] },
  legendary: { points: [8, 12], affixes: [2, 3] },
};
/** Coins a piece gives when salvaged, and costs to reforge. */
export const SALVAGE: Record<Rarity, number> = { common: 20, fine: 60, rare: 180, epic: 500, legendary: 1500 };
export const REFORGE: Record<Rarity, number> = { common: 60, fine: 150, rare: 400, epic: 1000, legendary: 2500 };
/** No factor of one piece goes past this. */
export const ITEM_FACTOR_CAP = 1.1;

/** The war a piece belongs to; a navy's war (ERA_OF) decides what it can carry and what its battles drop. */
export type Era = 'imjin' | 'armada' | 'lepanto' | 'trafalgar';
export const ERA_OF: Record<string, Era> = { joseon: 'imjin', japan: 'imjin', ming: 'imjin', england: 'armada', spain: 'armada', holyleague: 'lepanto', ottoman: 'lepanto', britain: 'trafalgar', france: 'trafalgar', spain1805: 'trafalgar' };

export type ItemBase = {
  id: string;
  slot: GearSlot;
  name: string;
  hanja: string;
  line: string;
  /** Weapons belong to a navy and are the figure's weapon (catalog WEAPONS id) when worn; everything else is anyone's. */
  faction?: MetaFaction;
  weapon?: string;
  eras: readonly Era[];
  /** Only these navies (a culture's own pieces); absent: every navy of the era. */
  factions?: readonly string[];
  /** A chapter sword model the figure holds when this is worn (lootEras.ts). */
  model?: string;
  /** Primary stats this kind of piece leans to. */
  bias: readonly PrimaryStat[];
};

const KIND_BIAS = { sword: ['str', 'dex'], spear: ['str', 'vit'], bow: ['int', 'dex'] } as const;

export const ITEM_BASES: readonly ItemBase[] = [
  ...WEAPONS.map((w): ItemBase => ({ id: `w_${w.id}`, slot: 'weapon', name: w.name, hanja: w.hanja, line: w.line, faction: w.faction, weapon: w.id, eras: ['imjin'], bias: KIND_BIAS[w.kind] })),
  { id: 'a_cheomju', slot: 'armor', name: '첨주', hanja: '簷冑', line: '챙이 달린 쇠 투구', eras: ['imjin'], bias: ['vit'] },
  { id: 'a_gyeoncheol', slot: 'armor', name: '견철', hanja: '肩鐵', line: '어깨를 덮는 쇠 미늘', eras: ['imjin'], bias: ['vit', 'str'] },
  { id: 'a_hwan', slot: 'armor', name: '호완', hanja: '護腕', line: '활 쏘는 팔을 감싸는 토시', eras: ['imjin'], bias: ['dex', 'int'] },
  { id: 'a_gapsang', slot: 'armor', name: '갑상', hanja: '甲裳', line: '허리 아래를 지키는 미늘 치마', eras: ['imjin'], bias: ['vit', 'dex'] },
  { id: 't_deungchae', slot: 'trinket', name: '등채', hanja: '藤策', line: '장수가 군을 지휘하던 등나무 채찍', eras: ['imjin'], bias: ['int', 'str'] },
  { id: 't_jihwibong', slot: 'trinket', name: '지휘봉', hanja: '指揮棒', line: '붉은 술을 단 지휘봉', eras: ['imjin'], bias: ['int'] },
  { id: 't_gunseon', slot: 'trinket', name: '군선', hanja: '軍扇', line: '진형을 가리키는 쇠살 부채', eras: ['imjin'], bias: ['int', 'dex'] },
  { id: 't_nagak', slot: 'trinket', name: '나각', hanja: '螺角', line: '소라 껍데기로 만든 신호 나팔', eras: ['imjin'], bias: ['int', 'vit'] },
  { id: 't_sinjeon', slot: 'trinket', name: '신전', hanja: '信箭', line: '군령을 전하는 화살', eras: ['imjin'], bias: ['dex'] },
  { id: 'b_sonja', slot: 'book', name: '손자병법', hanja: '孫子兵法', line: '싸우지 않고 이기는 법', eras: ['imjin'], bias: ['int'] },
  { id: 'b_ojak', slot: 'book', name: '오자', hanja: '吳子', line: '군을 다스리는 엄한 법도', eras: ['imjin'], bias: ['int', 'vit'] },
  { id: 'b_gihyo', slot: 'book', name: '기효신서', hanja: '紀效新書', line: '척계광이 왜구와 싸우며 쓴 병서', eras: ['imjin'], bias: ['int', 'str'] },
  { id: 'b_yukdo', slot: 'book', name: '육도삼략', hanja: '六韜三略', line: '태공망의 여섯 가지 병법', eras: ['imjin'], bias: ['int', 'dex'] },
  { id: 'b_byeonghak', slot: 'book', name: '병학지남', hanja: '兵學指南', line: '조선 수군의 조련 교범', eras: ['imjin'], bias: ['int', 'vit'] },
  { id: 's_byeongbu', slot: 'seal', name: '병부', hanja: '兵符', line: '군사를 일으키는 둘로 쪼갠 패', eras: ['imjin'], bias: ['vit', 'int'] },
  { id: 's_janggunin', slot: 'seal', name: '장군인', hanja: '將軍印', line: '거북 손잡이 장군의 도장', eras: ['imjin'], bias: ['str', 'vit'] },
  { id: 's_mapae', slot: 'seal', name: '마패', hanja: '馬牌', line: '역마를 부리는 구리 패', eras: ['imjin'], bias: ['dex'] },
  { id: 's_gyoseo', slot: 'seal', name: '교서 어보', hanja: '敎書御寶', line: '임금의 교서에 찍힌 인장', eras: ['imjin'], bias: ['int', 'str'] },
  ...ERA_BASES,
];

export const itemBase = (id: string) => ITEM_BASES.find((b) => b.id === id);

/** Whether a navy's generals can carry a kind of piece: its war, and its culture when it has one. */
export const baseFits = (b: ItemBase, faction: string) => !!ERA_OF[faction] && b.eras.includes(ERA_OF[faction]!) && (!b.faction || b.faction === faction) && (!b.factions || b.factions.includes(faction));

/** One owned piece. `seed` is always derivable (itemSeed) and recomputed on load; `src` says where it dropped. */
export type Item = { uid: string; base: string; rarity: Rarity; rerolls: number; seed: number; src: string };

export const itemSeed = (salt: string, uid: string, rerolls = 0) => hashSeed(`${salt}:item:${uid}:${rerolls}`);

export function rollItem(item: Pick<Item, 'base' | 'rarity' | 'seed'>): ArmorRoll {
  return rollPieces(rng(item.seed), RARITY_ROLL[item.rarity], itemBase(item.base)?.bias);
}

export const itemEffect = (item: Pick<Item, 'base' | 'rarity' | 'seed'>): MetaEffect => rollEffect(rollItem(item), ITEM_FACTOR_CAP);

// --- Drops ------------------------------------------------------------------------------------------------------

/** Drops kept per day from battles the server cannot watch; the inventory holds at most INVENTORY_CAP pieces. */
export const DAILY_DROPS = 15;
export const INVENTORY_CAP = 80;

export type DropInput = { result: 'win' | 'loss' | 'draw'; stars: number; sunk: number; firstWin: boolean; side: string };


/**
 * What the `counter`-th reward of a profile drops. A victory always drops one piece, maybe two; a draw or a defeat
 * sometimes one; a first victory adds a piece of at least 희귀. Stars and ships sunk tilt the rarity upward.
 * Pieces only drop for the side's own war and culture (a Lepanto galley drops a kilij or a firman, never a 환도).
 */
export function rollDrops(salt: string, counter: number, d: DropInput): Omit<Item, 'seed'>[] {
  const r = rng(hashSeed(`${salt}:drop:${counter}`));
  let count = d.result === 'win' ? (r() < 0.35 ? 2 : 1) : r() < (d.result === 'draw' ? 0.5 : 0.2) ? 1 : 0;
  const luck = 1 + 0.15 * Math.max(0, Math.min(3, d.stars)) + 0.01 * Math.max(0, Math.min(30, d.sunk));
  const bases = ITEM_BASES.filter((b) => baseFits(b, d.side));
  if (!bases.length) return [];
  const out: Omit<Item, 'seed'>[] = [];
  const pick = (floor: Rarity) => {
    let rarity: Rarity = 'common';
    const w = RARITIES.map((x, i) => (i === 0 ? RARITY_WEIGHT[x] : RARITY_WEIGHT[x] * luck));
    let roll = r() * w.reduce((s, x) => s + x, 0);
    for (let i = 0; i < RARITIES.length; i++) if ((roll -= w[i]!) < 0) { rarity = RARITIES[i]!; break; }
    if (RARITIES.indexOf(rarity) < RARITIES.indexOf(floor)) rarity = floor;
    const base = bases[Math.floor(r() * bases.length)]!;
    out.push({ uid: `${counter.toString(36)}-${out.length}`, base: base.id, rarity, rerolls: 0, src: `${d.result}` });
  };
  while (count-- > 0) pick('common');
  if (d.firstWin) pick('rare');
  return out;
}
