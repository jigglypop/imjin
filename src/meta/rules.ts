import type { ShipMods } from '../sim/types';
import { BRANCH_SKILLS, MASTERY_ID, TREES, type Effect, type SkillDef } from '../sim/grand/growthData';
import { GEAR, GENERALS, SLOTS, basicGear, gearById, gearFor, generalById, type GearDef, type Slot } from './catalog';

/**
 * The rules of an account's growth: what a battle earns, how a general rises and learns, and what gear costs and fits.
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
/** The fastest the game runs a battle: the largest speed in Engine's SPEEDS, which is also the approach's fast-forward. */
export const MAX_SIM_SPEED = 128;

export type GeneralState = { xp: number; skills: string[]; armor?: string; weapon?: string };
export type Profile = {
  v: typeof PROFILE_VERSION;
  coins: number;
  /** Bought armor and weapons, sorted. A faction's basic piece of each slot is everyone's and never listed. */
  owned: string[];
  generals: Record<string, GeneralState>;
  stats: { battles: number; wins: number; sunk: number; lost: number };
  /** One-time bonuses already paid, e.g. `win:history:hansan:joseon`. */
  firsts: string[];
  /** The day `earned` counts for (yyyy-mm-dd in Korean time) and the capped coins earned on it. */
  day: string;
  earned: number;
};

export const newProfile = (): Profile => ({ v: PROFILE_VERSION, coins: 0, owned: [], generals: {}, stats: { battles: 0, wins: 0, sunk: 0, lost: 0 }, firsts: [], day: '', earned: 0 });

const count = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);
const strings = (a: unknown) => (Array.isArray(a) ? a.filter((s): s is string => typeof s === 'string') : []);

/** A stored profile made safe to use: unknown generals, gear and skills dropped, counts clamped to whole numbers. */
export function normalizeProfile(raw: unknown): Profile {
  const p = newProfile();
  if (!raw || typeof raw !== 'object') return p;
  const r = raw as Record<string, unknown>;
  p.coins = count(r.coins);
  p.owned = [...new Set(strings(r.owned).filter((id) => gearById(id) && gearById(id)!.tier !== 'basic'))].sort();
  const gens = r.generals && typeof r.generals === 'object' ? (r.generals as Record<string, unknown>) : {};
  for (const g of GENERALS) {
    const s = gens[g.id] as Record<string, unknown> | undefined;
    if (!s || typeof s !== 'object') continue;
    const known = new Set(skillsFor(g.id).map((k) => k.id));
    const state: GeneralState = { xp: count(s.xp), skills: [...new Set(strings(s.skills).filter((k) => known.has(k)))] };
    for (const slot of SLOTS) {
      const id = s[slot];
      if (typeof id === 'string' && gearFor(g, slot).some((x) => x.id === id && x.tier !== 'basic')) state[slot] = id;
    }
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
    if (levelOf(g.xp) < MASTERY_LEVEL) return `${MASTERY_LEVEL}레벨에 익힐 수 있습니다`; // i18n-ignore: the one number the English entry spells out
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

// --- Gear -------------------------------------------------------------------------------------------------------

export class RuleError extends Error {}

export const owns = (p: Profile, id: string) => gearById(id)?.tier === 'basic' || p.owned.includes(id);

export function buyProblem(p: Profile, id: string): string | null {
  const piece = gearById(id);
  if (!piece || piece.tier === 'basic') return '살 수 없는 장비입니다';
  if (owns(p, id)) return '이미 가진 장비입니다';
  if (p.coins < piece.price) return '엽전이 모자랍니다';
  return null;
}

export function buy(p: Profile, id: string): { profile: Profile; item: GearDef } {
  const problem = buyProblem(p, id);
  if (problem) throw new RuleError(problem);
  const item = gearById(id)!;
  return { profile: { ...p, coins: p.coins - item.price, owned: [...p.owned, id].sort() }, item };
}

/** Why a general cannot carry a piece in a slot (null takes his own basic piece back), or null. */
export function equipProblem(p: Profile, generalId: string, slot: Slot, id: string | null): string | null {
  const g = generalById(generalId);
  if (!g) return '없는 장수입니다';
  if (!SLOTS.includes(slot)) return '없는 자리입니다';
  if (id === null) return null;
  const piece = gearById(id);
  if (!piece) return '없는 장비입니다';
  if (piece.slot !== slot) return '맞지 않는 자리입니다';
  if (piece.faction !== g.faction) return '다른 나라의 장비입니다';
  if (piece.general && piece.general !== g.id) return '다른 장수의 전용 장비입니다';
  if (!owns(p, id)) return '아직 가지지 않은 장비입니다';
  return null;
}

export function equip(p: Profile, generalId: string, slot: Slot, id: string | null): Profile {
  const problem = equipProblem(p, generalId, slot, id);
  if (problem) throw new RuleError(problem);
  const state: GeneralState = { ...generalState(p, generalId) };
  delete state[slot];
  if (id && gearById(id)!.tier !== 'basic') state[slot] = id;
  return { ...p, generals: { ...p.generals, [generalId]: state } };
}

/** What a general carries in a slot: what he put on, or his faction's basic piece. */
export function wornGear(p: Profile, generalId: string, slot: Slot): GearDef | undefined {
  const g = generalById(generalId);
  if (!g) return undefined;
  const id = generalState(p, generalId)[slot];
  return (id && gearById(id)) || basicGear(g.faction, slot);
}
export const wornArmor = (p: Profile, generalId: string) => wornGear(p, generalId, 'armor');
export const wornWeapon = (p: Profile, generalId: string) => wornGear(p, generalId, 'weapon');

// --- What a general brings to his ships -------------------------------------------------------------------------

export const NEUTRAL_MODS: ShipMods = { reload: 1, accuracy: 1, speed: 1, turn: 1, fire: 1, melee: 1, defense: 1, morale: 1 };
const MOD_KEYS = Object.keys(NEUTRAL_MODS) as (keyof ShipMods)[];

function multiply(m: ShipMods, e: Effect | Partial<ShipMods>) {
  for (const k of MOD_KEYS) if (e[k] !== undefined) m[k] *= e[k]!;
}

/**
 * The factors a general gives the ships of his squadron: his trait, the steps he learned, his armor and his weapon. Only the
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
  for (const slot of SLOTS) {
    const piece = wornGear(p, generalId, slot);
    if (piece) multiply(m, piece.effect);
  }
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

/** Every piece a shop could show: the ones a general can buy, one slot's and one faction's if asked for, signatures included. */
export const shopGear = (slot?: Slot, faction?: string): GearDef[] => GEAR.filter((x) => x.tier !== 'basic' && (!slot || x.slot === slot) && (!faction || x.faction === faction));
