import type { ShipMods } from '../sim/types';
import { TREES, type Effect } from '../sim/grand/growthData';
import { armorSeed, rerollCost, rollArmor, rollEffect, type ArmorRoll } from './affixes';
import { baseFits, DAILY_DROPS, INVENTORY_CAP, REFORGE, SALVAGE, itemBase, itemEffect, itemSeed, rollDrops, RARITIES, GEAR_SLOTS, type GearSlot, type Item } from './loot';
import { KEYSTONE_LEVEL, MASTERY_LEVEL, MASTERY_SPENT, TIER_GATE, pointsAtLevel, spentAll, spentIn, talentEffect, talentsFor, type TalentNode } from './talents';
import { ARMORS, GENERALS, armorById, armorsFor, basicArmor, defaultWeapon, generalById, weaponById, type ArmorDef, type WeaponDef } from './catalog';

/**
 * The rules of an account's growth: what a battle earns, how a general rises and learns, and what armor costs and fits.
 * Pure and deterministic like src/sim (the time of day comes in as a parameter), so the server, which owns every
 * profile, and the client, which shows what a button will do before it is pressed, apply the very same rules.
 *
 * A general's talents are his own tree (talents.ts): three branches, keystones and his 비기; his gear is his armor
 * (bought, catalog.ts) and the loot he carries (loot.ts). Design: docs/design-growth.md.
 */
export const PROFILE_VERSION = 2;
export const MAX_LEVEL = 20;
export { KEYSTONE_LEVEL, MASTERY_LEVEL };
/** No factor a general gives his ships (trait, talents, armor and gear together) leaves these bounds. */
export const GENERAL_CAP = { max: 1.5, min: 0.85 };
/** Respec: free the first time, then this many coins per level. */
export const RESPEC_PER_LEVEL = 100;
/** Coins a day from battles the server cannot watch (single-player); online results are not capped. */
export const DAILY_CAP = 3000;

/**
 * `talents` is ranks by node id (talents.ts); `respecs` how often they were reset; `gear` the uid of the loot worn
 * per slot. v1 profiles had `skills` (the campaign steps): they are dropped on load and every point comes back.
 */
export type GeneralState = { xp: number; talents: Record<string, number>; respecs?: number; armor?: string; weapon?: string; gear?: Partial<Record<GearSlot, string>> };
/** One owned armor piece's roll: the seed that decides its stats and abilities, and how often it was rerolled. */
export type ArmorItem = { seed: number; rerolls: number };
export type Profile = {
  v: typeof PROFILE_VERSION;
  coins: number;
  /** Bought armor, sorted. A faction's basic armor is everyone's and never listed. */
  owned: string[];
  /** Mixed into every armor seed: the account id on the server, a random string for a local profile. */
  salt: string;
  /** The roll of each owned armor, by id (affixes.ts rollArmor). */
  rolls: Record<string, ArmorItem>;
  generals: Record<string, GeneralState>;
  stats: { battles: number; wins: number; sunk: number; lost: number };
  /** One-time bonuses already paid, e.g. `win:history:hansan:joseon`. */
  firsts: string[];
  /** The day `earned` counts for (yyyy-mm-dd in Korean time) and the capped coins earned on it. */
  day: string;
  earned: number;
  /** Loot (loot.ts), oldest first; `drops` counts every reward that rolled for loot (the drop seed), `dropped` today's pieces. */
  items: Item[];
  drops: number;
  dropped: number;
};

export const newProfile = (): Profile => ({ v: PROFILE_VERSION, coins: 0, owned: [], salt: 'local', rolls: {}, generals: {}, stats: { battles: 0, wins: 0, sunk: 0, lost: 0 }, firsts: [], day: '', earned: 0, items: [], drops: 0, dropped: 0 });

const count = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);
const strings = (a: unknown) => (Array.isArray(a) ? a.filter((s): s is string => typeof s === 'string') : []);

/**
 * Also migrates older v1 profiles: a missing weapon uses the faction's default sword, and an owned armor without a
 * roll gets one from the salt (`salt`, else the given account id) and its id, so the migration is reproducible.
 */
export function normalizeProfile(raw: unknown, accountId = 'local'): Profile {
  const p = newProfile();
  p.salt = accountId;
  if (!raw || typeof raw !== 'object') return p;
  const r = raw as Record<string, unknown>;
  p.coins = count(r.coins);
  if (typeof r.salt === 'string' && r.salt) p.salt = r.salt.slice(0, 64);
  p.owned = [...new Set(strings(r.owned).filter((id) => armorById(id) && armorById(id)!.tier !== 'basic'))].sort();
  const rolls = r.rolls && typeof r.rolls === 'object' ? (r.rolls as Record<string, unknown>) : {};
  for (const id of p.owned) {
    const it = rolls[id] as Record<string, unknown> | undefined;
    const rerolls = it && typeof it === 'object' ? count(it.rerolls) : 0;
    p.rolls[id] = { seed: armorSeed(p.salt, id, rerolls), rerolls };
  }
  const gens = r.generals && typeof r.generals === 'object' ? (r.generals as Record<string, unknown>) : {};
  for (const g of GENERALS) {
    const s = gens[g.id] as Record<string, unknown> | undefined;
    if (!s || typeof s !== 'object') continue;
    const state: GeneralState = { xp: count(s.xp), talents: cleanTalents(g.id, s.talents, count(s.xp)) };
    if (count(s.respecs)) state.respecs = count(s.respecs);
    if (typeof s.armor === 'string' && armorsFor(g).some((a) => a.id === s.armor)) state.armor = s.armor;
    if (typeof s.weapon === 'string' && weaponById(s.weapon)?.faction === g.faction) state.weapon = s.weapon;
    p.generals[g.id] = state;
  }
  const st = (r.stats && typeof r.stats === 'object' ? r.stats : {}) as Record<string, unknown>;
  p.stats = { battles: count(st.battles), wins: count(st.wins), sunk: count(st.sunk), lost: count(st.lost) };
  p.firsts = [...new Set(strings(r.firsts))].sort();
  p.day = typeof r.day === 'string' ? r.day : '';
  p.earned = count(r.earned);
  p.drops = count(r.drops);
  p.dropped = count(r.dropped);
  const seen = new Set<string>();
  for (const raw of Array.isArray(r.items) ? r.items.slice(0, INVENTORY_CAP) : []) {
    const it = raw as Record<string, unknown>;
    if (!it || typeof it.uid !== 'string' || it.uid.length > 24 || seen.has(it.uid) || typeof it.base !== 'string' || !itemBase(it.base) || !RARITIES.includes(it.rarity as never)) continue;
    seen.add(it.uid);
    const rerolls = count(it.rerolls);
    p.items.push({ uid: it.uid, base: it.base, rarity: it.rarity as Item['rarity'], rerolls, seed: itemSeed(p.salt, it.uid, rerolls), src: typeof it.src === 'string' ? it.src.slice(0, 16) : '' });
  }
  // Gear is read after the items: a piece worn twice stays with the first general, a missing or foreign one is dropped.
  const worn = new Set<string>();
  for (const g of GENERALS) {
    const s = gens[g.id] as Record<string, unknown> | undefined;
    const gear = s && typeof s.gear === 'object' && s.gear ? (s.gear as Record<string, unknown>) : null;
    if (!gear || !p.generals[g.id]) continue;
    const out: Partial<Record<GearSlot, string>> = {};
    for (const slot of GEAR_SLOTS) {
      const uid = gear[slot];
      const item = typeof uid === 'string' ? p.items.find((i) => i.uid === uid) : undefined;
      if (item && !worn.has(item.uid) && !gearProblemFor(g.id, item, slot)) { out[slot] = item.uid; worn.add(item.uid); }
    }
    if (Object.keys(out).length) p.generals[g.id]!.gear = out;
  }
  return p;
}

/** Ranks by node, kept only where the tree, its gates and the level's points allow, learned in tier order. */
function cleanTalents(id: string, raw: unknown, xp: number): Record<string, number> {
  if (!raw || typeof raw !== 'object') return {};
  const given = raw as Record<string, unknown>;
  let p: Profile = { ...newProfile(), generals: { [id]: { xp, talents: {} } } };
  const nodes = [...talentsFor(id)].sort((a, b) => a.tier - b.tier);
  for (const node of nodes) {
    const want = Math.min(node.ranks, count(given[node.id]));
    for (let i = 0; i < want; i++) {
      if (learnProblem(p, id, node.id)) break;
      p = learn(p, id, node.id);
    }
  }
  return p.generals[id]!.talents;
}

// --- Levels -----------------------------------------------------------------------------------------------------

/** Experience a general needs in all to reach `level`: 100 for the second, then 200 more, 300 more, and so on. */
export const xpFor = (level: number) => 50 * level * (level - 1);

export function levelOf(xp: number): number {
  let level = 1;
  while (level < MAX_LEVEL && xp >= xpFor(level + 1)) level += 1;
  return level;
}

/** How far a general is into his level, for the bar: `into` of `need`, or null at the top level. */
export function levelProgress(xp: number): { level: number; into: number; need: number | null } {
  const level = levelOf(xp);
  if (level >= MAX_LEVEL) return { level, into: 0, need: null };
  return { level, into: xp - xpFor(level), need: xpFor(level + 1) - xpFor(level) };
}

export const generalState = (p: Profile, id: string): GeneralState => p.generals[id] ?? { xp: 0, talents: {} };

// --- Talents ----------------------------------------------------------------------------------------------------

export const generalLevel = (p: Profile, id: string) => levelOf(generalState(p, id).xp);

export const talentPoints = (p: Profile, id: string) => pointsAtLevel(generalLevel(p, id));
export const skillPointsLeft = (p: Profile, id: string) => Math.max(0, talentPoints(p, id) - spentAll(generalState(p, id).talents));

/** The keystone a general holds, if any. */
export const keystoneOf = (p: Profile, id: string): TalentNode | undefined => talentsFor(id).find((t) => t.keystone && (generalState(p, id).talents[t.id] ?? 0) > 0);

/** Why a general cannot take the next rank of a node now, or null. What the tree asks for comes before the points. */
export function learnProblem(p: Profile, id: string, nodeId: string): string | null {
  const node = talentsFor(id).find((t) => t.id === nodeId);
  if (!node) return '이 장수가 배울 수 없는 재능입니다';
  const g = generalState(p, id);
  const have = g.talents[nodeId] ?? 0;
  if (have >= node.ranks) return node.ranks > 1 ? '이미 끝까지 익혔습니다' : '이미 익혔습니다';
  const level = levelOf(g.xp);
  if (node.branch === 'mastery') {
    if (level < MASTERY_LEVEL) return `${MASTERY_LEVEL}레벨에 익힐 수 있습니다`;
    if (spentAll(g.talents) < MASTERY_SPENT) return `재능 점수를 ${MASTERY_SPENT}점 쓴 뒤에 익힐 수 있습니다`;
  } else {
    const gate = TIER_GATE[node.tier];
    if (spentIn(g.talents, node.branch) < gate) return `이 가지에 ${gate}점을 쓰면 열립니다`;
    if (node.keystone) {
      if (level < KEYSTONE_LEVEL) return `${KEYSTONE_LEVEL}레벨에 익힐 수 있습니다`;
      const held = keystoneOf(p, id);
      if (held) return `핵심 재능은 하나만 익힐 수 있습니다 (${held.label})`;
    }
  }
  if (skillPointsLeft(p, id) <= 0) return '남은 재능 점수가 없습니다';
  return null;
}

/** One more rank of a node. */
export function learn(p: Profile, id: string, nodeId: string): Profile {
  const problem = learnProblem(p, id, nodeId);
  if (problem) throw new RuleError(problem);
  const g = generalState(p, id);
  return { ...p, generals: { ...p.generals, [id]: { ...g, talents: { ...g.talents, [nodeId]: (g.talents[nodeId] ?? 0) + 1 } } } };
}

/** Coins to reset a general's talents: nothing the first time. */
export const respecCost = (p: Profile, id: string) => ((generalState(p, id).respecs ?? 0) === 0 ? 0 : RESPEC_PER_LEVEL * generalLevel(p, id));

export function respecProblem(p: Profile, id: string): string | null {
  if (!generalById(id)) return '없는 장수입니다';
  if (spentAll(generalState(p, id).talents) === 0) return '되돌릴 재능이 없습니다';
  if (p.coins < respecCost(p, id)) return '엽전이 모자랍니다';
  return null;
}

/** Every talent back as points, for respecCost. */
export function respec(p: Profile, id: string): Profile {
  const problem = respecProblem(p, id);
  if (problem) throw new RuleError(problem);
  const g = generalState(p, id);
  return { ...p, coins: p.coins - respecCost(p, id), generals: { ...p.generals, [id]: { ...g, talents: {}, respecs: (g.respecs ?? 0) + 1 } } };
}

// --- Armor ------------------------------------------------------------------------------------------------------

export class RuleError extends Error {}

export const owns = (p: Profile, armorId: string) => armorById(armorId)?.tier === 'basic' || p.owned.includes(armorId);

export function buyProblem(p: Profile, armorId: string): string | null {
  const a = armorById(armorId);
  if (!a || a.tier === 'basic') return '살 수 없는 갑옷입니다';
  if (owns(p, armorId)) return '이미 가진 갑옷입니다';
  if (p.coins < a.price) return '엽전이 모자랍니다';
  return null;
}

export function buy(p: Profile, armorId: string): { profile: Profile; armor: ArmorDef } {
  const problem = buyProblem(p, armorId);
  if (problem) throw new RuleError(problem);
  const armor = armorById(armorId)!;
  return { profile: { ...p, coins: p.coins - armor.price, owned: [...p.owned, armorId].sort(), rolls: { ...p.rolls, [armorId]: { seed: armorSeed(p.salt, armorId), rerolls: 0 } } }, armor };
}

/** The roll of an armor a profile owns (a migrated piece without a stored roll gets its first), or null for basic or unowned armor. */
export function armorRoll(p: Profile, armorId: string): ArmorRoll | null {
  const a = armorById(armorId);
  if (!a || a.tier === 'basic' || !p.owned.includes(armorId)) return null;
  return rollArmor(a, p.rolls[armorId]?.seed ?? armorSeed(p.salt, armorId));
}

export function rerollProblem(p: Profile, armorId: string): string | null {
  const a = armorById(armorId);
  if (!a || a.tier === 'basic') return '다시 벼릴 수 없는 갑옷입니다';
  if (!p.owned.includes(armorId)) return '아직 가지지 않은 갑옷입니다';
  if (p.coins < rerollCost(a)) return '엽전이 모자랍니다';
  return null;
}

/** Reforges a piece: pays rerollCost and moves it to the next seed of its chain (salt, id, rerolls), so it stays verifiable. */
export function reroll(p: Profile, armorId: string): Profile {
  const problem = rerollProblem(p, armorId);
  if (problem) throw new RuleError(problem);
  const a = armorById(armorId)!;
  const rerolls = (p.rolls[armorId]?.rerolls ?? 0) + 1;
  return { ...p, coins: p.coins - rerollCost(a), rolls: { ...p.rolls, [armorId]: { seed: armorSeed(p.salt, armorId, rerolls), rerolls } } };
}

/** Why a general cannot put on an armor (null takes his own basic armor back), or null. */
export function equipProblem(p: Profile, generalId: string, armorId: string | null): string | null {
  const g = generalById(generalId);
  if (!g) return '없는 장수입니다';
  if (armorId === null) return null;
  const a = armorById(armorId);
  if (!a) return '없는 갑옷입니다';
  if (a.faction !== g.faction) return '다른 나라의 갑옷입니다';
  if (!owns(p, armorId)) return '아직 가지지 않은 갑옷입니다';
  return null;
}

export function equip(p: Profile, generalId: string, armorId: string | null): Profile {
  const problem = equipProblem(p, generalId, armorId);
  if (problem) throw new RuleError(problem);
  const { armor: _old, ...rest } = generalState(p, generalId);
  const state: GeneralState = armorId && armorById(armorId)!.tier !== 'basic' ? { ...rest, armor: armorId } : rest;
  return { ...p, generals: { ...p.generals, [generalId]: state } };
}

/** The armor a general wears: what he put on, or his faction's basic armor. */
export function wornArmor(p: Profile, generalId: string): ArmorDef | undefined {
  const g = generalById(generalId);
  if (!g) return undefined;
  const id = generalState(p, generalId).armor;
  const armor = id && armorById(id);
  return (armor && armor.faction === g.faction ? armor : undefined) || basicArmor(g.faction);
}

// --- Weapons ----------------------------------------------------------------------------------------------------

/** Weapons are freely available cosmetics. A null selection restores the faction's default sword. */
export function equipWeaponProblem(_p: Profile, generalId: string, weaponId: string | null): string | null {
  const g = generalById(generalId);
  if (!g) return '없는 장수입니다';
  if (weaponId === null) return null;
  const weapon = weaponById(weaponId);
  if (!weapon) return '없는 무기입니다';
  if (weapon.faction !== g.faction) return '다른 나라의 무기입니다';
  return null;
}

export function equipWeapon(p: Profile, generalId: string, weaponId: string | null): Profile {
  const problem = equipWeaponProblem(p, generalId, weaponId);
  if (problem) throw new RuleError(problem);
  const { weapon: _old, ...rest } = generalState(p, generalId);
  const state: GeneralState = weaponId ? { ...rest, weapon: weaponId } : rest;
  return { ...p, generals: { ...p.generals, [generalId]: state } };
}

/** Exactly one active weapon, with a safe same-faction fallback for old or invalid profile data. */
export function wornWeapon(p: Profile, generalId: string): WeaponDef | undefined {
  const g = generalById(generalId);
  if (!g) return undefined;
  const id = generalState(p, generalId).weapon;
  const weapon = id && weaponById(id);
  return (weapon && weapon.faction === g.faction ? weapon : undefined) || defaultWeapon(g.faction);
}

// --- What a general brings to his ships -------------------------------------------------------------------------

export const NEUTRAL_MODS: ShipMods = { reload: 1, accuracy: 1, speed: 1, turn: 1, fire: 1, melee: 1, defense: 1, morale: 1 };
const MOD_KEYS = Object.keys(NEUTRAL_MODS) as (keyof ShipMods)[];

function multiply(m: ShipMods, e: Effect | Partial<ShipMods>) {
  for (const k of MOD_KEYS) if (e[k] !== undefined) m[k] *= e[k]!;
}

/**
 * The factors a general gives the ships of his squadron: his trait, his talents (with resonance and his keystone), his
 * armor and the loot he carries, each factor kept within GENERAL_CAP. Only the ship factors count here; the campaign's
 * march, experience and temper have no meaning in a single battle. `talents` overrides his own, for a preview.
 */
export function generalMods(p: Profile, generalId: string, talents?: Record<string, number>): ShipMods {
  const m = { ...NEUTRAL_MODS };
  const tree = TREES[generalId];
  if (!tree) return m;
  multiply(m, tree.trait.effect);
  multiply(m, talentEffect(generalId, talents ?? generalState(p, generalId).talents));
  const armor = wornArmor(p, generalId);
  const roll = armor && armorRoll(p, armor.id);
  if (roll) multiply(m, rollEffect(roll));
  for (const item of gearOf(p, generalId)) multiply(m, itemEffect(item));
  for (const k of MOD_KEYS) m[k] = Math.round(Math.max(GENERAL_CAP.min, Math.min(GENERAL_CAP.max, m[k])) * 1e6) / 1e6;
  return m;
}

// --- Loot -------------------------------------------------------------------------------------------------------

/** The pieces a general carries, in slot order. */
export function gearOf(p: Profile, generalId: string): Item[] {
  const gear = generalState(p, generalId).gear ?? {};
  return GEAR_SLOTS.map((s) => gear[s]).filter((u): u is string => !!u).map((u) => p.items.find((i) => i.uid === u)).filter((i): i is Item => !!i);
}

/** The chapter sword model a general's worn loot weapon gives his figure (lootEras.ts `model`), if any. */
export function wornModel(p: Profile, generalId: string): string | undefined {
  const uid = generalState(p, generalId).gear?.weapon;
  const item = uid ? p.items.find((i) => i.uid === uid) : undefined;
  return item ? itemBase(item.base)?.model : undefined;
}

/** The general who carries a piece, if any. */
export function wearerOf(p: Profile, uid: string): string | undefined {
  return Object.entries(p.generals).find(([, g]) => g.gear && Object.values(g.gear).includes(uid))?.[0];
}

function gearProblemFor(generalId: string, item: Item, slot: GearSlot): string | null {
  const base = itemBase(item.base);
  const g = generalById(generalId);
  if (!base || !g) return '없는 물건입니다';
  if (base.slot !== slot) return '맞지 않는 자리입니다';
  if (!baseFits(base, g.faction)) return base.slot === 'weapon' ? '다른 나라의 무기입니다' : '이 장수가 쓸 수 없는 물건입니다';
  return null;
}

/** Why a general cannot carry a piece (uid null empties the slot), or null. */
export function equipItemProblem(p: Profile, generalId: string, slot: GearSlot, uid: string | null): string | null {
  if (!generalById(generalId)) return '없는 장수입니다';
  if (!GEAR_SLOTS.includes(slot)) return '없는 자리입니다';
  if (uid === null) return null;
  const item = p.items.find((i) => i.uid === uid);
  if (!item) return '가지지 않은 물건입니다';
  return gearProblemFor(generalId, item, slot);
}

const without = (g: GeneralState, uid: string): GeneralState =>
  g.gear && Object.values(g.gear).includes(uid) ? { ...g, gear: Object.fromEntries(Object.entries(g.gear).filter(([, u]) => u !== uid)) } : g;

/** Puts a piece on a general (off whoever carried it); a weapon also becomes the weapon his figure holds. */
export function equipItem(p: Profile, generalId: string, slot: GearSlot, uid: string | null): Profile {
  const problem = equipItemProblem(p, generalId, slot, uid);
  if (problem) throw new RuleError(problem);
  const generals = { ...p.generals };
  if (uid) for (const [id, g] of Object.entries(generals)) generals[id] = without(g, uid);
  const g = generals[generalId] ?? { xp: 0, talents: {} };
  const gear = { ...(g.gear ?? {}) };
  if (uid) gear[slot] = uid;
  else delete gear[slot];
  const next: GeneralState = { ...g, gear };
  const weapon = uid ? itemBase(p.items.find((i) => i.uid === uid)!.base)?.weapon : undefined;
  if (weapon) next.weapon = weapon;
  generals[generalId] = next;
  return { ...p, generals };
}

const itemOf = (p: Profile, uid: string) => {
  const item = p.items.find((i) => i.uid === uid);
  if (!item) throw new RuleError('가지지 않은 물건입니다');
  return item;
};

/** Breaks a piece down for coins (SALVAGE); a worn piece comes off first. */
export function salvage(p: Profile, uid: string): Profile {
  const item = itemOf(p, uid);
  const generals = Object.fromEntries(Object.entries(p.generals).map(([id, g]) => [id, without(g, uid)]));
  return { ...p, coins: p.coins + SALVAGE[item.rarity], items: p.items.filter((i) => i.uid !== uid), generals };
}

export function reforgeProblem(p: Profile, uid: string): string | null {
  const item = p.items.find((i) => i.uid === uid);
  if (!item) return '가지지 않은 물건입니다';
  return p.coins < REFORGE[item.rarity] ? '엽전이 모자랍니다' : null;
}

/** Rolls a piece's stats again (same base and rarity) on the next seed of its chain, for REFORGE coins. */
export function reforge(p: Profile, uid: string): Profile {
  const problem = reforgeProblem(p, uid);
  if (problem) throw new RuleError(problem);
  const item = itemOf(p, uid);
  const rerolls = item.rerolls + 1;
  return { ...p, coins: p.coins - REFORGE[item.rarity], items: p.items.map((i) => (i.uid === uid ? { ...i, rerolls, seed: itemSeed(p.salt, uid, rerolls) } : i)) };
}

// --- Rewards ----------------------------------------------------------------------------------------------------

export type BattleMode = 'history' | 'conquest' | 'online' | 'ranked';
export type BattleReport = {
  mode: BattleMode;
  /** The historical scenario or the conquest map. */
  scenario: string;
  side: string;
  result: 'win' | 'loss' | 'draw';
  stars: number;
  sunk: number;
  lost: number;
  simSeconds: number;
  /** The account's generals who led a squadron of the player's side, with the enemy ships their squadrons sank. */
  generals: { id: string; sunk: number }[];
};
/** `drops` the loot kept; `salvaged` coins for pieces a full inventory could not hold (already in `coins`). */
export type Reward = { coins: number; bonuses: { key: string; coins: number }[]; capped: boolean; xp: Record<string, number>; levels: Record<string, number>; drops: Item[]; salvaged: number };

const BASE: Record<BattleReport['result'], number> = { win: 120, draw: 50, loss: 30 };
const FIRST_WIN = 300;
const FIRST_STARS = 300;

/**
 * What a finished battle pays: coins for the result and the ships sunk, one-time bonuses for a first victory and a first
 * three stars per battle and side, and experience to each general who led. `trusted` results (played on the server)
 * are not capped; the day's other coins stop at DAILY_CAP, though the one-time bonuses always pay.
 */
export function rewardFor(p: Profile, report: BattleReport, day: string, trusted: boolean): { profile: Profile; reward: Reward } {
  const next: Profile = { ...p, stats: { ...p.stats }, generals: { ...p.generals }, firsts: [...p.firsts], items: [...p.items] };
  if (next.day !== day) { next.day = day; next.earned = 0; next.dropped = 0; }
  let coins = BASE[report.result] + 3 * Math.min(count(report.sunk), 40);
  let capped = false;
  if (!trusted) {
    const room = Math.max(0, DAILY_CAP - next.earned);
    if (coins > room) { coins = room; capped = true; }
    next.earned += coins;
  }
  const bonuses: Reward['bonuses'] = [];
  const key = `${report.mode}:${report.scenario}:${report.side}`;
  const once = (name: string, amount: number) => {
    const k = `${name}:${key}`;
    if (next.firsts.includes(k)) return;
    next.firsts.push(k);
    bonuses.push({ key: k, coins: amount });
  };
  const firstWin = report.result === 'win' && !next.firsts.includes(`win:${key}`);
  if (report.result === 'win') once('win', FIRST_WIN);
  if (report.result === 'win' && report.stars >= 3) once('stars3', FIRST_STARS);
  next.firsts.sort();
  next.coins += coins + bonuses.reduce((s, b) => s + b.coins, 0);
  next.stats.battles += 1;
  if (report.result === 'win') next.stats.wins += 1;
  next.stats.sunk += count(report.sunk);
  next.stats.lost += count(report.lost);
  const xp: Reward['xp'] = {};
  const levels: Reward['levels'] = {};
  for (const g of report.generals) {
    if (!generalById(g.id) || xp[g.id] !== undefined) continue;
    const gain = Math.round((40 + 4 * Math.min(count(g.sunk), 30)) * (report.result === 'win' ? 1.5 : 1));
    const before = generalState(next, g.id);
    next.generals[g.id] = { ...before, xp: before.xp + gain };
    xp[g.id] = gain;
    const up = levelOf(before.xp + gain) - levelOf(before.xp);
    if (up > 0) levels[g.id] = levelOf(before.xp + gain);
  }
  // Loot: rolled from the salt and the drop counter, so the server's drops can be replayed and no page picks its own.
  const drops: Item[] = [];
  let salvaged = 0;
  const rolled = rollDrops(next.salt, next.drops, { result: report.result, stars: report.stars, sunk: count(report.sunk), firstWin, side: report.side });
  next.drops += 1;
  for (const d of rolled) {
    const item: Item = { ...d, seed: itemSeed(next.salt, d.uid, 0), src: `${report.mode}:${report.scenario}`.slice(0, 16) };
    if (!trusted && next.dropped >= DAILY_DROPS) continue;
    if (!trusted) next.dropped += 1;
    if (next.items.length >= INVENTORY_CAP) { salvaged += SALVAGE[item.rarity]; continue; }
    next.items.push(item);
    drops.push(item);
  }
  next.coins += salvaged;
  return { profile: next, reward: { coins: coins + bonuses.reduce((s, b) => s + b.coins, 0) + salvaged, bonuses, capped, xp, levels, drops, salvaged } };
}

/**
 * Whether a single-player report could have happened, judged against what the server knows of the battle: no more
 * ships sunk than the enemy had or lost than the side had, generals who really led on that side, and a battle at least
 * as long as the fastest speed allows in the real time since it began. The server cannot watch these battles, so this
 * and the daily cap are what keep a forged report small.
 */
export function reportProblem(report: BattleReport, known: { ownShips: number; enemyShips: number; generals: readonly string[] }, realSeconds: number, maxSpeed: number): string | null {
  if (!['win', 'loss', 'draw'].includes(report.result)) return 'invalid result';
  if (!Number.isFinite(report.simSeconds) || report.simSeconds < 20 || report.simSeconds > 6 * 3600) return 'invalid duration';
  if (realSeconds * maxSpeed * 1.15 + 30 < report.simSeconds) return 'faster than the game runs';
  if (count(report.sunk) !== report.sunk || report.sunk > known.enemyShips) return 'invalid sunk count';
  if (count(report.lost) !== report.lost || report.lost > known.ownShips) return 'invalid lost count';
  if (!Number.isInteger(report.stars) || report.stars < 0 || report.stars > 3) return 'invalid stars';
  if (report.generals.length > 24 || report.generals.some((g) => !known.generals.includes(g.id) || count(g.sunk) !== g.sunk || g.sunk > report.sunk)) return 'invalid generals';
  return null;
}

/** Every purchasable armor a profile could show in a shop, optionally filtered to a faction. */
export const shopArmors = (faction?: string): ArmorDef[] => ARMORS.filter((a) => a.tier !== 'basic' && (!faction || a.faction === faction));
