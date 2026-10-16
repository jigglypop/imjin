import { t } from '../../i18n';
import { dateLabel } from '../../sim/grand/economy';
import { researchProblem, skillPoints, skillProblem, techOf } from '../../sim/grand/growth';
import { BRANCH_LABEL, BRANCH_SKILLS, MASTERY_ID, MASTERY_LEVEL, TREES, techById, techsOf } from '../../sim/grand/growthData';
import { commanderSuspended } from '../../sim/grand/orders';
import { COMMANDERS, REGIONS } from '../../sim/grand/regions';
import { LEVEL_XP } from '../../sim/grand/roster';
import type { Commander, Grand, GrandFaction } from '../../sim/grand/types';
import { tName } from './text';
import type { AssignTargetView, CommanderCardView, SkillNodeView, TechNodeView, TechTreeView } from './types';

/** The growth rules' screens (Commanders.tsx, TechTree.tsx) read the campaign through these, like adapt.ts for the rest. */

const placeOf = (g: Grand, fleetId: string) => {
  const fl = g.fleets.find((f) => f.id === fleetId);
  return fl?.at ? t(REGIONS[fl.at].name) : t('항해 중');
};

function node(c: Commander, id: string, label: string, text: string, tier: number): SkillNodeView {
  if (c.skills?.includes(id)) return { id, label: t(label), text: t(text), tier, state: 'have' };
  const problem = skillProblem(c, id);
  return problem ? { id, label: t(label), text: t(text), tier, state: 'locked', reason: t(problem, { level: MASTERY_LEVEL }) } : { id, label: t(label), text: t(text), tier, state: 'open' };
}

/** Fleets of the navy the commander could take over now: in port, and in his own port when he already leads one. */
function targetsFor(g: Grand, c: Commander): AssignTargetView[] {
  if (!c.alive || commanderSuspended(g, c.id) || g.phase !== 'orders') return [];
  const holder = g.fleets.find((f) => f.commanderId === c.id);
  return g.fleets
    .filter((f) => f.faction === c.faction && f.at && f.id !== holder?.id && (!holder || holder.at === f.at))
    .sort((a, b) => b.ships.length - a.ships.length)
    .map((f) => {
      const lead = f.commanderId ? g.factions[f.faction].commanders.find((x) => x.id === f.commanderId) : undefined;
      return { fleetId: f.id, name: tName(f.name), place: t(REGIONS[f.at!].name), ships: f.ships.length, leader: lead ? t(lead.name) : undefined };
    });
}

function cardOf(g: Grand, c: Commander, coming?: number): CommanderCardView {
  const tree = TREES[c.id];
  const holder = g.fleets.find((f) => f.commanderId === c.id);
  const top = LEVEL_XP.length;
  const branches = (tree?.branches ?? []).map((b) => ({ id: b, label: t(BRANCH_LABEL[b]), nodes: BRANCH_SKILLS[b].map((s) => node(c, s.id, s.label, s.text, s.tier)) }));
  const status: CommanderCardView['status'] = coming !== undefined ? 'coming' : commanderSuspended(g, c.id) ? 'suspended' : holder ? 'leading' : 'free';
  return {
    id: c.id,
    name: t(c.name),
    hanja: tree?.hanja ?? '',
    title: t(c.title),
    portrait: c.portrait,
    level: c.level,
    maxLevel: top,
    xp: c.xp,
    xpFrom: LEVEL_XP[c.level - 1] ?? 0,
    xpTo: LEVEL_XP[Math.min(c.level, top - 1)] ?? c.xp,
    points: coming !== undefined ? 0 : skillPoints(c),
    trait: { label: t(tree?.trait.label ?? ''), text: t(tree?.trait.text ?? '') },
    branches,
    mastery: node(c, MASTERY_ID, tree?.mastery.label ?? '', tree?.mastery.text ?? '', MASTERY_LEVEL),
    status,
    fleet: holder ? { id: holder.id, name: tName(holder.name), place: placeOf(g, holder.id) } : undefined,
    joins: coming !== undefined ? t(dateLabel(coming)) : undefined,
    targets: coming !== undefined ? [] : targetsFor(g, c),
  };
}

/** The navy's living commanders, then the ones still to join (shown locked with the date they come). */
export function commanderCards(g: Grand, f: GrandFaction): CommanderCardView[] {
  const st = g.factions[f];
  const now = st.commanders.filter((c) => c.alive).map((c) => cardOf(g, c));
  const later = COMMANDERS.filter((d) => d.faction === f && !st.commanders.some((c) => c.id === d.id) && (d.joins ?? 1) > g.turn).map((d) =>
    cardOf(g, { id: d.id, faction: d.faction, name: d.name, title: d.title, portrait: d.portrait, level: d.level, xp: LEVEL_XP[d.level - 1] ?? 0, alive: true, skills: [] }, d.joins),
  );
  return [...now, ...later];
}

/** Unspent skill points of the navy's commanders, for the badge on the top bar. */
export const pointsWaiting = (g: Grand, f: GrandFaction) => g.factions[f].commanders.reduce((n, c) => n + (c.alive ? skillPoints(c) : 0), 0);

export function techTree(g: Grand, f: GrandFaction): TechTreeView {
  const st = techOf(g, f);
  const list = techsOf(f);
  // The column is how many techs stand before it; rows fill each column in the table's order, a follow-up beside its first prerequisite.
  const col = new Map<string, number>();
  const depth = (id: string): number => {
    if (col.has(id)) return col.get(id)!;
    const t0 = techById(f, id)!;
    const d = t0.needs.length ? 1 + Math.max(...t0.needs.map(depth)) : 0;
    col.set(id, d);
    return d;
  };
  for (const x of list) depth(x.id);
  const row = new Map<string, number>();
  const used = new Map<number, Set<number>>();
  const take = (c: number, want: number) => {
    const set = used.get(c) ?? new Set<number>();
    used.set(c, set);
    let r = want;
    while (set.has(r)) r += 1;
    set.add(r);
    return r;
  };
  for (const x of [...list].sort((a, b) => col.get(a.id)! - col.get(b.id)!)) {
    const parent = x.needs[0] ? row.get(x.needs[0]) ?? 0 : 0;
    row.set(x.id, take(col.get(x.id)!, x.needs.length ? parent : (used.get(0)?.size ?? 0)));
  }
  const nodes: TechNodeView[] = list.map((x) => {
    const done = st.done.includes(x.id);
    const doing = st.doing?.id === x.id;
    const problem = done || doing ? null : researchProblem(g, f, x.id);
    const missing = x.needs.find((n) => !st.done.includes(n));
    return {
      id: x.id,
      label: t(x.label),
      text: t(x.text),
      gold: x.gold,
      turns: x.turns,
      state: done ? 'done' : doing ? 'doing' : problem && (missing || problem === '다른 연구가 진행 중입니다') ? 'locked' : 'open',
      left: doing ? st.doing!.left : undefined,
      reason: problem ? t(problem, { tech: t(techById(f, missing ?? '')?.label ?? ''), gold: x.gold }) : undefined,
      needs: [...x.needs],
      col: col.get(x.id)!,
      row: row.get(x.id)!,
    };
  });
  const doingDef = st.doing ? techById(f, st.doing.id) : undefined;
  return {
    faction: f,
    nodes,
    cols: Math.max(...nodes.map((n) => n.col)) + 1,
    rows: Math.max(...nodes.map((n) => n.row)) + 1,
    doing: st.doing && doingDef ? { label: t(doingDef.label), left: st.doing.left, total: doingDef.turns } : undefined,
  };
}
