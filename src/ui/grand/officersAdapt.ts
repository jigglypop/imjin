import { t } from '../../i18n';
import { EN } from '../../i18n/en';
import { BATTLE_ABILITY, BONUS_LABEL, BRANCHES, BRANCH_INFO, FIGURE_BY_ID, OFFICERS, SKILLS, TRAIT_BY_ID, type AbilityIcon, type Bonus, type BonusKey, type Branch } from '../../sim/grand/officerData';
import { lieutenantSlots, lieutenantsOf, officerById, officerReady, ownBonus, postOf } from '../../sim/grand/officerEffects';
import { STAYS, pointsOf, promotable, rankHanja, rankOf, rosterOf, skillProblem } from '../../sim/grand/officers';
import { REGIONS } from '../../sim/grand/regions';
import { LEVEL_XP } from '../../sim/grand/roster';
import type { Commander, Fleet, Grand, GrandFaction, OfficerCandidate } from '../../sim/grand/types';
import { tName, tt } from './text';

/**
 * View models of the officers (sim/grand/officers.ts) for the characters panel, the character sheet, the fleet
 * panel's lieutenant seats and the recommendation cards. Every string is in the current language.
 */

export type EffectLine = { key: BonusKey; text: string; good: boolean };
export type TraitView = { id: string; name: string; hanja: string; desc: string; good: boolean; effects: EffectLine[] };
export type AbilityView = { name: string; hanja: string; line: string; icon: AbilityIcon; effects: EffectLine[]; ships?: string; battle?: { name: string; desc: string } };
export type PostView = { kind: 'commander' | 'lieutenant' | 'pool' | 'wounded' | 'captive'; text: string };

export type OfficerView = {
  id: string;
  faction: GrandFaction;
  name: string;
  hanja?: string;
  rank: string;
  rankHanja: string;
  title?: string;
  level: number;
  maxLevel: number;
  /** Share of the way to the next level, 0..1 (1 at the top). */
  progress: number;
  xp: number;
  next: number | null;
  portrait: string;
  stats: [number, number, number];
  traits: TraitView[];
  points: number;
  post: PostView;
  bio: string;
  ability?: AbilityView;
  named: boolean;
  ready: boolean;
  /** Everything he adds to a fleet he commands, summed. */
  effects: EffectLine[];
  seats: number;
};

export type SkillNodeView = { id: string; branch: Branch; tier: number; name: string; hanja: string; desc: string; effects: EffectLine[]; state: 'taken' | 'open' | 'locked'; reason?: string };
export type BranchView = { id: Branch; name: string; hanja: string; desc: string; nodes: SkillNodeView[] };
export type CandidateView = { id: string; officer: OfficerView; cost: number; place: string; left: number | null };
export type OfferView = { id: string; kind: 'recommend' | 'trust'; by?: OfficerView; officer: OfficerView; cost?: number };
export type PromoteView = { fleetId: string; fleet: string; shipId: string; ship: string; kills: number; place: string; level: number };
export type SeatsView = { seats: number; lieutenants: OfficerView[]; free: OfficerView[]; hasCommander: boolean };

const pct = (v: number) => `${v > 0 ? '+' : '−'}${Math.round(Math.abs(v) * 100)}%`;

/** A bonus as short lines in the current language: "포격 +3%", "부관 자리 +1". */
export function effectLines(b: Bonus | Record<BonusKey, number>): EffectLine[] {
  const out: EffectLine[] = [];
  for (const [k, v] of Object.entries(b) as [BonusKey, number][]) {
    if (!v || Math.abs(v) < 1e-6) continue;
    const whole = k === 'slots' || k === 'recommend';
    out.push({ key: k, text: t('{label} {value}', { label: t(BONUS_LABEL[k]), value: whole ? `${v > 0 ? '+' : '−'}${Math.abs(Math.round(v))}` : pct(v) }), good: v > 0 });
  }
  return out;
}

/** The generated officers' romanised names, so their names in the log and the panels read in English too. */
export function learnOfficerNames(g: Grand) {
  for (const f of ['joseon', 'japan', 'ming'] as const) {
    for (const c of g.factions[f].commanders) if (c.officer?.nameEn) EN[c.name] = c.officer.nameEn;
    for (const cand of g.officers?.candidates[f] ?? []) if (cand.officer.officer?.nameEn) EN[cand.officer.name] = cand.officer.officer.nameEn;
  }
  for (const o of g.officers?.offers ?? []) if (o.candidate?.officer.officer?.nameEn) EN[o.candidate.officer.name] = o.candidate.officer.officer.nameEn;
}

function traitView(id: string): TraitView | null {
  const d = TRAIT_BY_ID.get(id);
  return d ? { id, name: t(d.name), hanja: d.hanja, desc: t(d.desc), good: d.good, effects: effectLines(d.bonus) } : null;
}

function postView(g: Grand, c: Commander): PostView {
  const o = c.officer;
  if (o?.captive) return { kind: 'captive', text: t('포로 · {turns}턴 뒤 귀환', { turns: o.captive }) };
  if (o?.wounded) return { kind: 'wounded', text: t('부상 · {turns}턴 회복', { turns: o.wounded }) };
  const post = postOf(g, c);
  if (post) return { kind: post.role, text: post.role === 'commander' ? t('{fleet} 지휘', { fleet: tName(post.fleet.name) }) : t('{fleet} 부관', { fleet: tName(post.fleet.name) }) };
  return { kind: 'pool', text: o?.at ? t('{place}에서 대기', { place: t(REGIONS[o.at].name) }) : t('대기') };
}

export function officerView(g: Grand, c: Commander): OfficerView {
  const fig = c.officer?.origin === 'history' ? FIGURE_BY_ID.get(c.id) : undefined;
  const top = c.level >= LEVEL_XP.length;
  const from = LEVEL_XP[c.level - 1] ?? 0;
  const to = top ? null : LEVEL_XP[c.level]!;
  const a = fig?.ability;
  const bio = fig ? t(fig.bio) : c.officer?.bio ? tt(c.officer.bio.text, c.officer.bio.params) : '';
  return {
    id: c.id,
    faction: c.faction,
    name: t(c.name),
    hanja: fig?.hanja,
    rank: t(rankOf(c)),
    rankHanja: rankHanja(c),
    title: c.title ? t(c.title) : undefined,
    level: c.level,
    maxLevel: LEVEL_XP.length,
    progress: to === null ? 1 : Math.max(0, Math.min(1, (c.xp - from) / (to - from))),
    xp: c.xp,
    next: to,
    portrait: c.portrait,
    stats: c.officer?.stats ?? [5, 5, 5],
    traits: (c.officer?.traits ?? []).flatMap((id) => traitView(id) ?? []),
    points: pointsOf(c),
    post: postView(g, c),
    bio,
    ability: a ? {
      name: t(a.name),
      hanja: a.hanja,
      line: t(a.line),
      icon: a.icon,
      effects: effectLines(a.bonus),
      ships: a.ships ? t('{kinds} 건조비 −{n}% (머무는 포구)', { kinds: a.ships.kinds.map((k) => t(SHIP_LABEL[k] ?? k)).join(' · '), n: Math.round(a.ships.cut * 100) }) : undefined,
      battle: a.battle ? { name: t(BATTLE_ABILITY[a.battle].name), desc: t(BATTLE_ABILITY[a.battle].desc) } : undefined,
    } : undefined,
    named: !!fig,
    ready: officerReady(c),
    effects: effectLines(ownBonus(c)),
    seats: lieutenantSlots(c),
  };
}

const SHIP_LABEL: Record<string, string> = { geobukseon: '거북선', panokseon: '판옥선', daeantaek: '대안택선', atakebune: '아타케부네' };

export function rosterViews(g: Grand, f: GrandFaction): OfficerView[] {
  return rosterOf(g, f).map((c) => officerView(g, c));
}

/** The three branches of an officer's tree, each node taken, open (a point can go there now) or locked with the reason. */
export function skillTree(g: Grand, f: GrandFaction, id: string): BranchView[] {
  const c = officerById(g, f, id);
  return BRANCHES.map((b) => ({
    id: b,
    name: t(BRANCH_INFO[b].name),
    hanja: BRANCH_INFO[b].hanja,
    desc: t(BRANCH_INFO[b].desc),
    nodes: SKILLS.filter((s) => s.branch === b).map((s) => {
      const taken = !!c?.officer?.skills.includes(s.id);
      const why = c && !taken ? skillProblem(c, s.id) : null;
      return { id: s.id, branch: b, tier: s.tier, name: t(s.name), hanja: s.hanja, desc: t(s.desc), effects: effectLines(s.bonus), state: taken ? 'taken' : why ? 'locked' : 'open', reason: why ? t(why, { n: s.tier }) : undefined };
    }),
  }));
}

const candidateView = (g: Grand, cand: OfficerCandidate): CandidateView => ({ id: cand.id, officer: officerView(g, cand.officer), cost: cand.cost, place: t(REGIONS[cand.at].name), left: cand.left >= STAYS ? null : cand.left });

export const candidateViews = (g: Grand, f: GrandFaction): CandidateView[] => (g.officers?.candidates[f] ?? []).map((c) => candidateView(g, c));

/** The card waiting for the player, the first of them. */
export function offerView(g: Grand): OfferView | null {
  const o = g.officers?.offers[0];
  if (!o || !g.player) return null;
  const by = officerById(g, g.player, o.by);
  if (o.kind === 'trust') {
    const who = officerById(g, g.player, o.who);
    return who ? { id: o.id, kind: 'trust', officer: officerView(g, who) } : null;
  }
  if (!o.candidate) return null;
  return { id: o.id, kind: 'recommend', by: by ? officerView(g, by) : undefined, officer: officerView(g, o.candidate.officer), cost: o.candidate.cost };
}

export function promoteViews(g: Grand, f: GrandFaction): PromoteView[] {
  return promotable(g, f).map((p) => {
    const u = p.fleet.ships.find((s) => s.id === p.shipId)!;
    return { fleetId: p.fleet.id, fleet: tName(p.fleet.name), shipId: p.shipId, ship: tName(u.name), kills: p.kills, place: p.fleet.at ? t(REGIONS[p.fleet.at].name) : '', level: 1 + Math.min(2, Math.floor((p.kills - OFFICERS.promoteKills) / 3)) };
  });
}

/** A fleet's lieutenant seats: who sits in them, and the free officers who could take one. */
export function seatsView(g: Grand, fl: Fleet): SeatsView {
  const cmd = officerById(g, fl.faction, fl.commanderId);
  const lts = lieutenantsOf(g, fl);
  const free = g.factions[fl.faction].commanders.filter((c) => c.alive && officerReady(c) && c.id !== fl.commanderId && !lts.includes(c) && (() => {
    const post = postOf(g, c);
    return !post || (post.role === 'lieutenant' && post.fleet.at === fl.at);
  })());
  return { seats: cmd && officerReady(cmd) ? lieutenantSlots(cmd) : 0, lieutenants: lts.map((c) => officerView(g, c)), free: free.sort((a, b) => b.level - a.level).map((c) => officerView(g, c)), hasCommander: !!cmd && officerReady(cmd) };
}

/** Points waiting and cards waiting, for the top bar's badge. */
export function officerBadge(g: Grand): number {
  if (!g.player || !g.officers) return 0;
  const pts = g.factions[g.player].commanders.filter((c) => c.alive && pointsOf(c) > 0).length;
  return pts + g.officers.offers.length;
}
