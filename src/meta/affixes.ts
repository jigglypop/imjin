import type { ShipMods } from '../sim/types';
import type { ArmorDef, ArmorTier, MetaEffect } from './catalog';

/**
 * Rolled armor (ARPG-style loot): every owned piece carries a seed, and the seed alone decides its four primary stats
 * (힘·민첩·지능·활력) and its 0-3 special abilities. Pure and deterministic like rules.ts, with its own small seeded
 * RNG (no Math.random), so the same seed rolls the same piece on the client and on a server that wants to verify it.
 *
 * Only the final factors (armorEffect) leave this file; they multiply ShipMods exactly like the old fixed effects did.
 *
 * Primary stats map onto the battle's ship factors, per point:
 *   힘 str  -> melee +0.4%, reload +0.3%       (boarding troops and gun crews hauling shot)
 *   민첩 dex -> speed +0.3%, turn   +0.4%       (oars and helm)
 *   지능 int -> accuracy +0.4%, morale +0.2%    (gunnery orders and formation command)
 *   활력 vit -> defense +0.5%                  (the hull and crew hold)
 */
export type PrimaryStat = 'str' | 'dex' | 'int' | 'vit';
export const PRIMARY_STATS: readonly PrimaryStat[] = ['str', 'dex', 'int', 'vit'];
export const STAT_LABEL: Record<PrimaryStat, string> = { str: '힘', dex: '민첩', int: '지능', vit: '활력' };
export const STAT_PER_POINT: Record<PrimaryStat, Partial<ShipMods>> = {
  str: { melee: 0.004, reload: 0.003 },
  dex: { speed: 0.003, turn: 0.004 },
  int: { accuracy: 0.004, morale: 0.002 },
  vit: { defense: 0.005 },
};

export type AffixRarity = 'common' | 'rare' | 'epic';
export const AFFIX_WEIGHT: Record<AffixRarity, number> = { common: 6, rare: 3, epic: 1 };
export const AFFIX_RARITY_LABEL: Record<AffixRarity, string> = { common: '일반', rare: '희귀', epic: '영웅' };

/** A special ability: each listed factor rolls a bonus between lo and hi (as fractions, 0.03 = +3%). */
export type AffixDef = { id: string; rarity: AffixRarity; label: string; text: string; ranges: Partial<Record<keyof ShipMods, [number, number]>> };

export const AFFIXES: readonly AffixDef[] = [
  { id: 'firecraft', rarity: 'rare', label: '화공 강화', text: '불화살과 화전의 불길이 더 잘 붙습니다', ranges: { fire: [0.03, 0.06] } },
  { id: 'charge', rarity: 'common', label: '돌격', text: '등선 백병전에 강해집니다', ranges: { melee: [0.03, 0.05] } },
  { id: 'bulwark', rarity: 'common', label: '철벽', text: '선체와 병사가 피해를 덜 받습니다', ranges: { defense: [0.02, 0.04] } },
  { id: 'aura', rarity: 'rare', label: '지휘 오라', text: '전대의 사기가 쉽게 꺾이지 않습니다', ranges: { morale: [0.03, 0.06] } },
  { id: 'tides', rarity: 'common', label: '물길 읽기', text: '물길을 읽어 더 빨리 나아갑니다', ranges: { speed: [0.02, 0.03] } },
  { id: 'helm', rarity: 'common', label: '노련한 조타', text: '배를 더 빨리 돌립니다', ranges: { turn: [0.03, 0.05] } },
  { id: 'rapid', rarity: 'rare', label: '속사', text: '포를 더 빨리 다시 쟁입니다', ranges: { reload: [0.02, 0.04] } },
  { id: 'marksman', rarity: 'rare', label: '명사수', text: '포와 활이 더 잘 맞습니다', ranges: { accuracy: [0.02, 0.04] } },
  { id: 'unbroken', rarity: 'epic', label: '불굴', text: '버티는 힘과 사기가 함께 오릅니다', ranges: { defense: [0.02, 0.03], morale: [0.03, 0.04] } },
  { id: 'volley', rarity: 'epic', label: '일제 사격', text: '장전과 명중이 함께 오릅니다', ranges: { reload: [0.02, 0.03], accuracy: [0.02, 0.03] } },
];
export const affixById = (id: string) => AFFIXES.find((a) => a.id === id);

/** Per tier: the total primary points [min, max] and the number of special abilities [min, max]. */
export const TIER_ROLL: Record<ArmorTier, { points: [number, number]; affixes: [number, number] }> = {
  basic: { points: [0, 0], affixes: [0, 0] },
  common: { points: [2, 4], affixes: [0, 1] },
  fine: { points: [4, 7], affixes: [0, 2] },
  masterwork: { points: [6, 10], affixes: [1, 2] },
  legendary: { points: [9, 13], affixes: [1, 3] },
  signature: { points: [10, 14], affixes: [2, 3] },
};
/** No single factor of one armor goes past this, however lucky the roll. */
export const ARMOR_FACTOR_CAP = 1.12;

/** Coins to reroll a piece: a quarter of its price. */
export const rerollCost = (a: ArmorDef) => Math.round(a.price / 4);

// --- Seeded RNG ------------------------------------------------------------------------------------------------

/** FNV-1a of a string, as an unsigned 32-bit seed. */
export function hashSeed(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: a uniform float in [0, 1) per call. Shared by the loot rolls (loot.ts). */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The seed a piece gets when acquired (or migrated): from the profile's salt, the armor and its reroll count. */
export const armorSeed = (salt: string, armorId: string, rerolls = 0) => hashSeed(`${salt}:${armorId}:${rerolls}`);

// --- Rolls -----------------------------------------------------------------------------------------------------

export type RolledAffix = { id: string; values: Partial<ShipMods> };
export type ArmorRoll = { stats: Record<PrimaryStat, number>; affixes: RolledAffix[] };

const int = (r: () => number, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
const round4 = (x: number) => Math.round(x * 10000) / 10000;

/** What a seed rolls on an armor. The same (armor, seed) always gives the same roll. */
export function rollArmor(a: ArmorDef, seed: number): ArmorRoll {
  return rollPieces(rng(seed), TIER_ROLL[a.tier]);
}

/**
 * Primary points and abilities from a running RNG. `bias` makes some primary stats likelier (loot.ts: a bow leans to
 * 지능, a shield piece to 활력); without it every stat is equally likely, exactly as armor has always rolled.
 */
export function rollPieces(r: () => number, spec: { points: [number, number]; affixes: [number, number] }, bias?: readonly PrimaryStat[]): ArmorRoll {
  const stats: Record<PrimaryStat, number> = { str: 0, dex: 0, int: 0, vit: 0 };
  const points = int(r, ...spec.points);
  const weights = PRIMARY_STATS.map((k) => (bias?.includes(k) ? 3 : 1));
  const wsum = weights.reduce((s, w) => s + w, 0);
  for (let i = 0; i < points; i++) {
    if (!bias) { stats[PRIMARY_STATS[Math.floor(r() * 4)]!] += 1; continue; }
    let pick = r() * wsum, k = 0;
    while (k < 3 && (pick -= weights[k]!) >= 0) k++;
    stats[PRIMARY_STATS[k]!] += 1;
  }
  const n = int(r, ...spec.affixes);
  const pool = [...AFFIXES];
  const affixes: RolledAffix[] = [];
  for (let i = 0; i < n && pool.length; i++) {
    const total = pool.reduce((s, x) => s + AFFIX_WEIGHT[x.rarity], 0);
    let pick = r() * total;
    let k = 0;
    while (k < pool.length - 1 && (pick -= AFFIX_WEIGHT[pool[k]!.rarity]) >= 0) k++;
    const def = pool.splice(k, 1)[0]!;
    const values: Partial<ShipMods> = {};
    for (const [key, [lo, hi]] of Object.entries(def.ranges) as [keyof ShipMods, [number, number]][]) values[key] = round4(lo + r() * (hi - lo));
    affixes.push({ id: def.id, values });
  }
  return { stats, affixes };
}

/** The ship factors a roll gives, each capped at ARMOR_FACTOR_CAP (or the given cap). */
export function rollEffect(roll: ArmorRoll, cap = ARMOR_FACTOR_CAP): MetaEffect {
  const add: Partial<Record<keyof ShipMods, number>> = {};
  const bump = (k: keyof ShipMods, v: number) => { add[k] = (add[k] ?? 0) + v; };
  for (const s of PRIMARY_STATS) for (const [k, v] of Object.entries(STAT_PER_POINT[s]) as [keyof ShipMods, number][]) bump(k, v * roll.stats[s]);
  for (const af of roll.affixes) for (const [k, v] of Object.entries(af.values) as [keyof ShipMods, number][]) bump(k, v);
  const out: MetaEffect = {};
  for (const [k, v] of Object.entries(add) as [keyof ShipMods, number][]) if (v > 0) out[k] = Math.min(cap, round4(1 + v));
  return out;
}

const AFFIX_SCORE: Record<AffixRarity, number> = { common: 2, rare: 3, epic: 4 };

/** A roll's quality in [0, 1] against the best its tier could give (for the rarity colour). */
export function rollQuality(a: ArmorDef, roll: ArmorRoll): number {
  const spec = TIER_ROLL[a.tier];
  const max = spec.points[1] + spec.affixes[1] * 4;
  if (!max) return 0;
  const pts = PRIMARY_STATS.reduce((s, k) => s + roll.stats[k], 0);
  const af = roll.affixes.reduce((s, x) => s + AFFIX_SCORE[affixById(x.id)?.rarity ?? 'common'], 0);
  return Math.min(1, (pts + af) / max);
}
