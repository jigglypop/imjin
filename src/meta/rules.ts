import type { ShipMods } from '../sim/types';
import { BRANCH_SKILLS, MASTERY_ID, TREES, type Effect, type SkillDef } from '../sim/grand/growthData';
import { armorSeed, rerollCost, rollArmor, rollEffect, type ArmorRoll } from './affixes';
import { ARMORS, GENERALS, armorById, armorsFor, basicArmor, defaultWeapon, generalById, weaponById, type ArmorDef, type WeaponDef } from './catalog';

/**
 * The rules of an account's growth: what a battle earns, how a general rises and learns, and what armor costs and fits.
 * Pure and deterministic like src/sim (the time of day comes in as a parameter), so the server, which owns every
 * profile, and the client, which shows what a button will do before it is pressed, apply the very same rules.
 *
 * A general's tree is his campaign tree (growthData.ts): the same branches, steps, trait and mastery, but on the
 * account he keeps what he learns from battle to battle, and only his mastery waits for a higher level.
 */
export const PROFILE_VERSION = 1;
export const MAX_LEVEL = 10;
/** The level a general's mastery asks for on the account (the campaign, whose wars are short, asks for 4). */
export const MASTERY_LEVEL = 6;
/** Coins a day from battles the server cannot watch (single-player); online results are not capped. */
export const DAILY_CAP = 3000;

export type GeneralState = { xp: number; skills: string[]; armor?: string; weapon?: string };
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
};

export const newProfile = (): Profile => ({ v: PROFILE_VERSION, coins: 0, owned: [], salt: 'local', rolls: {}, generals: {}, stats: { battles: 0, wins: 0, sunk: 0, lost: 0 }, firsts: [], day: '', earned: 0 });

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
    const known = new Set(skillsFor(g.id).map((k) => k.id));
    const state: GeneralState = { xp: count(s.xp), skills: [...new Set(strings(s.skills).filter((k) => known.has(k)))] };
    if (typeof s.armor === 'string' && armorsFor(g).some((a) => a.id === s.armor)) state.armor = s.armor;
    if (typeof s.weapon === 'string' && weaponById(s.weapon)?.faction === g.faction) state.weapon = s.weapon;
    p.generals[g.id] = state;
  }
  const st = (r.stats && typeof r.stats === 'object' ? r.stats : {}) as Record<string, unknown>;
  p.stats = { battles: count(st.battles), wins: count(st.wins), sunk: count(st.sunk), lost: count(st.lost) };
  p.firsts = [...new Set(strings(r.firsts))].sort();
  p.day = typeof r.day === 'string' ? r.day : '';
  p.earned = count(r.earned);
  return p;
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

export const generalState = (p: Profile, id: string): GeneralState => p.generals[id] ?? { xp: 0, skills: [] };

// --- Skills -----------------------------------------------------------------------------------------------------

/** The steps of a general's tree: his branches, three each, then his mastery. */
export function skillsFor(id: string): SkillDef[] {
  const tree = TREES[id];
  if (!tree) return [];
  const out = tree.branches.flatMap((b) => [...BRANCH_SKILLS[b]]);
  out.push({ id: MASTERY_ID, branch: 'mastery', tier: MASTERY_LEVEL, label: tree.mastery.label, text: tree.mastery.text, effect: tree.mastery.effect });
  return out;
}

export const skillPointsLeft = (p: Profile, id: string) => {
  const g = generalState(p, id);
  return Math.max(0, levelOf(g.xp) - 1 - g.skills.length);
};

/** Why a general cannot learn a step now, or null. What the tree asks for comes before the points. */
export function learnProblem(p: Profile, id: string, skillId: string): string | null {
  const skill = skillsFor(id).find((s) => s.id === skillId);
  if (!skill) return '이 장수가 배울 수 없는 재능입니다';
  const g = generalState(p, id);
  if (g.skills.includes(skillId)) return '이미 익혔습니다';
  if (skill.branch === 'mastery') {
    if (levelOf(g.xp) < MASTERY_LEVEL) return `${MASTERY_LEVEL}레벨에 익힐 수 있습니다`;
  } else {
    const before = BRANCH_SKILLS[skill.branch][skill.tier - 2];
    if (before && !g.skills.includes(before.id)) return '앞 단계를 먼저 익혀야 합니다';
  }
  if (skillPointsLeft(p, id) <= 0) return '남은 재능 점수가 없습니다';
  return null;
}

export function learn(p: Profile, id: string, skillId: string): Profile {
  const problem = learnProblem(p, id, skillId);
  if (problem) throw new RuleError(problem);
  const g = generalState(p, id);
  return { ...p, generals: { ...p.generals, [id]: { ...g, skills: [...g.skills, skillId] } } };
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
 * The factors a general gives the ships of his squadron: his trait, the steps he learned and his armor. Only the
 * ship factors count here; the campaign's march, experience and temper have no meaning in a single battle.
 */
export function generalMods(p: Profile, generalId: string): ShipMods {
  const m = { ...NEUTRAL_MODS };
  const tree = TREES[generalId];
  if (!tree) return m;
  multiply(m, tree.trait.effect);
  const steps = skillsFor(generalId);
  for (const id of generalState(p, generalId).skills) {
    const s = steps.find((k) => k.id === id);
    if (s) multiply(m, s.effect);
  }
  const armor = wornArmor(p, generalId);
  const roll = armor && armorRoll(p, armor.id);
  if (roll) multiply(m, rollEffect(roll));
  return m;
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
export type Reward = { coins: number; bonuses: { key: string; coins: number }[]; capped: boolean; xp: Record<string, number>; levels: Record<string, number> };

const BASE: Record<BattleReport['result'], number> = { win: 120, draw: 50, loss: 30 };
const FIRST_WIN = 300;
const FIRST_STARS = 300;

/**
 * What a finished battle pays: coins for the result and the ships sunk, one-time bonuses for a first victory and a first
 * three stars per battle and side, and experience to each general who led. `trusted` results (played on the server)
 * are not capped; the day's other coins stop at DAILY_CAP, though the one-time bonuses always pay.
 */
export function rewardFor(p: Profile, report: BattleReport, day: string, trusted: boolean): { profile: Profile; reward: Reward } {
  const next: Profile = { ...p, stats: { ...p.stats }, generals: { ...p.generals }, firsts: [...p.firsts] };
  if (next.day !== day) { next.day = day; next.earned = 0; }
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
  return { profile: next, reward: { coins: coins + bonuses.reduce((s, b) => s + b.coins, 0), bonuses, capped, xp, levels } };
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
