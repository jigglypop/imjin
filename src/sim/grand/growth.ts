import type { Temper } from '../maneuvers';
import type { ShipKind, ShipMods } from '../types';
import { navyName } from './economy';
import { BRANCH_SKILLS, MASTERY_ID, MASTERY_LEVEL, TREES, techById, techsOf, type Effect, type SkillDef, type TechDef } from './growthData';
import { COMMANDERS } from './regions';
import { LEVEL_XP } from './roster';
import type { Commander, Fleet, Grand, GrandFaction, Result, TechState } from './types';
import { GRAND_FACTIONS, fail, ok } from './types';
import { note } from './world';

/**
 * The growth rules (`Grand.growth`): named commanders who join their navy on the turn history gives them a command, rise
 * by fighting, and spend a skill point per level in a small tree of their own (two or three branches and a mastery),
 * on top of a signature trait; and a tech tree each navy researches with silver and turns.
 *
 * Everything reaches the fight through the numbers it already has: the ship modifiers (ShipMods) of the 3D battle,
 * which the auto-resolve reads as gun, boarding and guard factors, the distance a fleet sails in a turn under the march
 * rules, and the commander's temper, which the maneuver rules and the computer's tacticians read.
 */

export const growing = (g: Grand) => g.growth === 'v1';

const NEUTRAL: ShipMods = { reload: 1, accuracy: 1, speed: 1, turn: 1, fire: 1, melee: 1, defense: 1, morale: 1 };
const MOD_KEYS = Object.keys(NEUTRAL) as (keyof ShipMods)[];

/** The sum of a set of effects: modifiers multiply, distance adds, a later temper overrides an earlier one. */
export type Bonus = { mods: ShipMods; march: number; xp: number; temper?: Temper };

const emptyBonus = (): Bonus => ({ mods: { ...NEUTRAL }, march: 0, xp: 1 });

function add(b: Bonus, e: Effect) {
  for (const k of MOD_KEYS) if (e[k] !== undefined) b.mods[k] *= e[k]!;
  if (e.march) b.march += e.march;
  if (e.xp) b.xp *= e.xp;
  if (e.temper) b.temper = e.temper;
}

// --- Commanders --------------------------------------------------------------------------------------------------

/** The skills a commander's tree offers: his branches, three steps each, and his mastery. */
export function skillsOf(commanderId: string): SkillDef[] {
  const tree = TREES[commanderId];
  if (!tree) return [];
  const out = tree.branches.flatMap((b) => [...BRANCH_SKILLS[b]]);
  out.push({ id: MASTERY_ID, branch: 'mastery', tier: MASTERY_LEVEL, label: tree.mastery.label, text: tree.mastery.text, effect: tree.mastery.effect });
  return out;
}

/** Points a commander has to spend: one for each level above the first, less what he has spent. */
export const skillPoints = (c: Commander) => Math.max(0, c.level - 1 - (c.skills?.length ?? 0));

/** The reason a step is closed only for want of a point: the screen draws it as the next step, not as locked. */
export const NO_POINTS = '남은 재능 점수가 없습니다';

/** Why a commander cannot take a skill now, or null when he can. A Korean template like an order's reason. */
export function skillProblem(c: Commander, skillId: string): string | null {
  const skill = skillsOf(c.id).find((s) => s.id === skillId);
  if (!skill) return '이 장수가 배울 수 없는 재능입니다';
  const have = c.skills ?? [];
  if (have.includes(skillId)) return '이미 익혔습니다';
  if (!c.alive) return '전사한 장수입니다';
  // What the tree asks for comes before the points, so a locked step says what it is waiting for.
  if (skill.branch === 'mastery') {
    if (c.level < MASTERY_LEVEL) return '{level}레벨에 익힐 수 있습니다';
  } else {
    const before = BRANCH_SKILLS[skill.branch][skill.tier - 2];
    if (before && !have.includes(before.id)) return '앞 단계를 먼저 익혀야 합니다';
  }
  if (skillPoints(c) <= 0) return NO_POINTS;
  return null;
}

export function learnSkill(g: Grand, faction: GrandFaction, commanderId: string, skillId: string): Result {
  const c = g.factions[faction].commanders.find((x) => x.id === commanderId);
  if (!c) return fail('없는 장수입니다');
  const problem = skillProblem(c, skillId);
  if (problem) return fail(problem, { level: MASTERY_LEVEL });
  (c.skills ??= []).push(skillId);
  const skill = skillsOf(c.id).find((s) => s.id === skillId)!;
  return ok('{name|이/가} {skill|을/를} 익혔습니다', { name: c.name, skill: skill.label });
}

/** What a commander brings to his ships: his trait and the skills he has taken. */
export function commanderBonus(c: Commander | undefined): Bonus {
  const b = emptyBonus();
  if (!c?.alive) return b;
  const tree = TREES[c.id];
  if (tree) add(b, tree.trait.effect);
  for (const id of c.skills ?? []) {
    const skill = skillsOf(c.id).find((s) => s.id === id);
    if (skill) add(b, skill.effect);
  }
  return b;
}

/** The computer's way through a tree: his mastery as soon as he may, else the lowest step he can, his first branch first. */
export function autoSkills(g: Grand, f: GrandFaction) {
  for (const c of g.factions[f].commanders) {
    while (skillPoints(c) > 0) {
      const options = skillsOf(c.id).filter((s) => !skillProblem(c, s.id));
      if (!options.length) break;
      const tree = TREES[c.id]!;
      options.sort((a, b) => (a.branch === 'mastery' ? -1 : 0) - (b.branch === 'mastery' ? -1 : 0) || a.tier - b.tier || tree.branches.indexOf(a.branch as never) - tree.branches.indexOf(b.branch as never));
      (c.skills ??= []).push(options[0]!.id);
    }
  }
}

const newCommander = (def: (typeof COMMANDERS)[number]): Commander => ({ id: def.id, faction: def.faction, name: def.name, title: def.title, portrait: def.portrait, level: def.level, xp: LEVEL_XP[def.level - 1] ?? 0, alive: true, skills: [] });

/** Commanders whose turn has come take up their posts. Run when a turn begins; a living navy only. */
export function joinCommanders(g: Grand, quiet = false) {
  for (const def of COMMANDERS) {
    const st = g.factions[def.faction];
    if (!st.alive || (def.joins ?? 1) > g.turn || st.commanders.some((c) => c.id === def.id)) continue;
    st.commanders.push(newCommander(def));
    if (!quiet && def.joins !== undefined && g.turn > 1) note(g, '{name}({title}) 장군이 수군에 합류했습니다', { name: def.name, title: def.title }, def.faction === g.player ? 'good' : 'info');
  }
}

// --- Techs -------------------------------------------------------------------------------------------------------

export const techOf = (g: Grand, f: GrandFaction): TechState => (g.factions[f].tech ??= { done: [], doing: null });

/** Why the navy cannot start this research now, or null. */
export function researchProblem(g: Grand, f: GrandFaction, id: string): string | null {
  const t = techById(f, id);
  if (!t) return '없는 기술입니다';
  const st = techOf(g, f);
  if (st.done.includes(id)) return '이미 연구했습니다';
  if (st.doing) return '다른 연구가 진행 중입니다';
  const missing = t.needs.find((n) => !st.done.includes(n));
  if (missing) return '{tech|을/를} 먼저 연구해야 합니다';
  if (g.factions[f].gold < t.gold) return '은이 부족합니다 ({gold}냥 필요)';
  return null;
}

export function orderResearch(g: Grand, f: GrandFaction, id: string): Result {
  if (!growing(g)) return fail('이 캠페인에는 기술 연구가 없습니다');
  const problem = researchProblem(g, f, id);
  const t = techById(f, id);
  if (problem || !t) return fail(problem ?? '없는 기술입니다', { tech: techById(f, t?.needs.find((n) => !techOf(g, f).done.includes(n)) ?? '')?.label ?? '', gold: t?.gold ?? 0 });
  g.factions[f].gold -= t.gold;
  techOf(g, f).doing = { id, left: t.turns, paid: t.gold };
  return ok('{tech} 연구를 시작했습니다 ({turns}턴)', { tech: t.label, turns: t.turns });
}

/** Stops the research on the way and gives back what it cost. */
export function cancelResearch(g: Grand, f: GrandFaction): Result {
  const st = techOf(g, f);
  if (!st.doing) return fail('진행 중인 연구가 없습니다');
  g.factions[f].gold += st.doing.paid;
  st.doing = null;
  return ok('연구를 취소했습니다');
}

function finishTech(g: Grand, f: GrandFaction, t: TechDef) {
  const st = techOf(g, f);
  if (!st.done.includes(t.id)) st.done.push(t.id);
  if (t.unlock && !g.factions[f].unlocked.includes(t.unlock)) g.factions[f].unlocked.push(t.unlock);
  note(g, '{navy|이/가} {tech} 연구를 마쳤습니다', { navy: navyName(f), tech: t.label }, f === g.player ? 'good' : 'info');
}

/** The research of every navy goes on by a turn. Run when a turn closes. */
export function advanceResearch(g: Grand) {
  for (const f of GRAND_FACTIONS) {
    const st = g.factions[f].tech;
    if (!st?.doing || !g.factions[f].alive) continue;
    st.doing.left -= 1;
    if (st.doing.left > 0) continue;
    const t = techById(f, st.doing.id);
    st.doing = null;
    if (t) finishTech(g, f, t);
  }
}

/**
 * The order the computer researches in: Joseon and Ming the hulls they are waiting for first, Japan its volleys before
 * the larger atakebune (its many cheap hulls gain more from the guns of all of them; scripts/balance-grand.mjs).
 */
const AI_ORDER: Record<GrandFaction, readonly string[]> = {
  joseon: ['panokseon', 'turtle', 'chongtong', 'powder', 'drill'],
  japan: ['volley', 'atake', 'boarding', 'pirates', 'drill'],
  ming: ['frankish', 'greatships', 'grain', 'drill'],
};

/** The computer starts the next research it can afford while keeping `reserve` in the treasury. */
export function aiResearch(g: Grand, f: GrandFaction, reserve: number) {
  if (!growing(g) || techOf(g, f).doing) return;
  for (const id of AI_ORDER[f]) {
    const t = techById(f, id);
    if (!t || techOf(g, f).done.includes(id)) continue;
    if (t.needs.some((n) => !techOf(g, f).done.includes(n))) continue;
    if (g.factions[f].gold - t.gold >= reserve) orderResearch(g, f, id);
    return;
  }
}

/** What the navy's finished research does for a ship of this kind. */
export function techBonus(g: Grand, f: GrandFaction, kind?: ShipKind): Bonus {
  const b = emptyBonus();
  for (const id of g.factions[f].tech?.done ?? []) {
    const t = techById(f, id);
    if (t?.effect && (!t.kinds || (kind && t.kinds.includes(kind)))) add(b, t.effect);
  }
  return b;
}

// --- What the battle reads ---------------------------------------------------------------------------------------

const commanderOfFleet = (g: Grand, fl: Fleet | undefined) => (fl?.commanderId ? g.factions[fl.faction].commanders.find((c) => c.id === fl.commanderId) : undefined);

/** The modifiers the growth rules give a ship: its navy's research and its fleet's commander. Neutral without the rules. */
export function growthMods(g: Grand, faction: GrandFaction, kind: ShipKind, fl: Fleet | undefined): ShipMods {
  if (!growing(g)) return { ...NEUTRAL };
  const tech = techBonus(g, faction, kind).mods;
  const cmd = commanderBonus(commanderOfFleet(g, fl)).mods;
  const out = { ...NEUTRAL };
  for (const k of MOD_KEYS) out[k] = tech[k] * cmd[k];
  return out;
}

/** The commander's temper for the maneuver rules, when his trait gives him one. */
export const fleetTemper = (g: Grand, fl: Fleet | undefined): Temper | undefined => (growing(g) ? commanderBonus(commanderOfFleet(g, fl)).temper : undefined);

/** Extra share of a turn's sailing distance from the fleet commander's seamanship. */
export const fleetMarch = (g: Grand, fl: Fleet): number => (growing(g) ? commanderBonus(commanderOfFleet(g, fl)).march : 0);

/** The factor on the experience a fight gives the fleet's commander. */
export const fleetXp = (g: Grand, fl: Fleet): number => (growing(g) ? commanderBonus(commanderOfFleet(g, fl)).xp * techBonus(g, fl.faction).xp : 1);

/**
 * The auto-resolve's reading of a ship's modifiers: guns from loading, aim and fire, the boarding from melee, the guard
 * against boarders from defence, and nerve from morale. Damped, because the auto-resolve has no manoeuvre to make up for them.
 */
export function resolveEdge(m: ShipMods): { gun: number; melee: number; guard: number; nerve: number } {
  return {
    gun: Math.pow(m.reload * m.accuracy, 0.7) * (1 + 0.2 * (m.fire - 1)),
    melee: Math.pow(m.melee, 0.8),
    guard: Math.pow(m.defense, 0.6),
    nerve: Math.pow(m.morale, 0.4),
  };
}

// --- Old saves ---------------------------------------------------------------------------------------------------

/**
 * Brings a save made before the growth rules under them: every commander gets an empty skill list (his levels become
 * points to spend), each navy a tech tree in which the ships it already builds count as researched, and the commanders
 * whose turn has passed join. Returns whether anything changed.
 */
export function migrateGrandGrowth(g: Grand): boolean {
  if (g.growth === 'v1') return false;
  g.growth = 'v1';
  for (const f of GRAND_FACTIONS) {
    const st = g.factions[f];
    for (const c of st.commanders) c.skills ??= [];
    const tech = techOf(g, f);
    for (const t of techsOf(f)) if (t.unlock && st.unlocked.includes(t.unlock) && !tech.done.includes(t.id)) tech.done.push(t.id);
    // A tech whose prerequisite was skipped by the old timed unlock still counts as standing on it.
    for (const t of techsOf(f)) if (tech.done.includes(t.id)) for (const n of t.needs) if (!tech.done.includes(n)) tech.done.push(n);
  }
  // Joining on load is not news of this turn.
  joinCommanders(g, true);
  return true;
}
