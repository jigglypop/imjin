import { dateOf, levelOf } from './economy';
import { CANDIDATE_TRAITS, DOCTRINE, FIGURES, FIGURE_BY_ID, GENERIC_PORTRAITS, NAME_PARTS, OFFICERS, RANKS, SKILLS, SKILL_BY_ID, TRAIT_BY_ID, type Branch, type FigureDef } from './officerData';
import { fleetBonus, hireCut, lieutenantSlots, officerById, officerReady, ownBonus, postOf } from './officerEffects';
import { REGIONS } from './regions';
import { forkRng, next, type Rng } from './rng';
import { LEVEL_XP, grantXp } from './roster';
import type { BattleGrade } from './report';
import type { Commander, Fleet, Grand, GrandFaction, MsgParams, OfficerCandidate, OfficerInfo, OfficerOffer, RegionId, Result } from './types';
import { GRAND_FACTIONS, fail, ok } from './types';
import { allied, fleetById, mintId, note, ownedBy } from './world';

/**
 * The officers of the faction campaign, Total War style: every navy has a roster of named historical figures who come
 * into the war at their dates, recruits offered at its camps (등용), men put forward by its officers (천거) and veterans
 * raised from the ranks (발탁). An officer commands a fleet or serves under its commander as a lieutenant (부관), earns
 * experience in battle, rises through his navy's ranks, spends a skill point per level on a three-branch tree and gains
 * traits, good and bad, from how he fights. A heavy defeat may wound, capture or kill him.
 *
 * Every roll comes from a generator forked from the campaign seed, the turn and the officer, never from the campaign's
 * own generator, so the officers do not shift any other roll and the same war always unfolds the same way.
 */

// --- Small helpers -----------------------------------------------------------------------------------------------

/** A stable number for a string id, to fork a generator per officer or ship. */
function hashOf(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

const fork = (g: Grand, ...tags: number[]): Rng => forkRng(g.seed, g.turn, 0x0ff1ce, ...tags);
const pick = <T>(r: Rng, list: readonly T[]): T => list[Math.floor(next(r) * list.length)]!;

/** Months since the start of 1592 at the turn now. The one place the officers read the calendar. */
const monthNow = (g: Grand) => {
  const d = dateOf(g.turn);
  return d.year * 12 + d.month;
};
const isDue = (g: Grand, year: number, month: number) => year * 12 + month <= monthNow(g);

export const rankOf = (c: Commander): string => RANKS[c.faction][Math.max(0, Math.min(RANKS[c.faction].length, c.level) - 1)]![0];
export const rankHanja = (c: Commander): string => RANKS[c.faction][Math.max(0, Math.min(RANKS[c.faction].length, c.level) - 1)]![1];

/** Unspent skill points: one per level, less the nodes taken. */
export const pointsOf = (c: Commander) => Math.max(0, c.level - (c.officer?.skills.length ?? 0));

const living = (g: Grand, f: GrandFaction) => g.factions[f].commanders.filter((c) => c.alive);

/** Where a navy's free officers gather: its port with the biggest camp, else its first port. */
export function homePort(g: Grand, f: GrandFaction): RegionId | null {
  const own = ownedBy(g, f);
  let best: RegionId | null = null;
  for (const id of own) if (!best || levelOf(g.regions[id], 'camp') > levelOf(g.regions[best], 'camp') || (levelOf(g.regions[id], 'camp') === levelOf(g.regions[best], 'camp') && REGIONS[id].capitalOf === f && REGIONS[best].capitalOf !== f)) best = id;
  return best;
}

const blankRecord = (): OfficerInfo['record'] => ({ battles: 0, won: 0, heroic: 0, sieges: 0, idle: 0 });

function historicalOfficer(fig: FigureDef, at: RegionId | null): Commander {
  return {
    id: fig.id,
    faction: fig.faction,
    name: fig.name,
    title: fig.title,
    portrait: fig.portrait,
    level: fig.level,
    xp: LEVEL_XP[fig.level - 1] ?? 0,
    alive: true,
    officer: { stats: [...fig.stats], traits: [...fig.traits], skills: [], at, wounded: 0, captive: 0, record: blankRecord(), origin: 'history' },
  };
}

/** A generated name, Korean and romanised (officerData.ts NAME_PARTS). */
function makeName(f: GrandFaction, r: Rng): [string, string] {
  const p = NAME_PARTS[f];
  const famKo = p.family[0].split(' ');
  const famEn = p.family[1].split(' ');
  const givKo = p.given[0].split(' ');
  const givEn = p.given[1].split(' ');
  const i = Math.floor(next(r) * famKo.length);
  if (p.syllables) {
    const a = Math.floor(next(r) * givKo.length);
    let b = Math.floor(next(r) * givKo.length);
    if (b === a) b = (b + 1) % givKo.length;
    const en = `${givEn[a]![0]!.toUpperCase()}${givEn[a]!.slice(1)}-${givEn[b]}`;
    return [`${famKo[i]}${givKo[a]}${givKo[b]}`, `${famEn[i]} ${en}`];
  }
  const j = Math.floor(next(r) * givKo.length);
  return [f === 'japan' ? `${famKo[i]} ${givKo[j]}` : `${famKo[i]}${givKo[j]}`, `${famEn[i]} ${givEn[j]}`];
}

function rollTraits(r: Rng, n: number, keep: string[] = []): string[] {
  const out = [...keep];
  for (let k = 0; k < n; k += 1) {
    const pool = CANDIDATE_TRAITS.filter(([id]) => !out.includes(id));
    const total = pool.reduce((s, [, w]) => s + w, 0);
    let at = next(r) * total;
    for (const [id, w] of pool) {
      at -= w;
      if (at <= 0) {
        out.push(id);
        break;
      }
    }
  }
  return out;
}

/** A new officer who is not one of the named figures: a recruit, a recommended man or a veteran from the ranks. */
function generatedOfficer(g: Grand, f: GrandFaction, r: Rng, level: number, origin: OfficerInfo['origin'], bio: { text: string; params?: MsgParams }, traits: string[], at: RegionId | null): Commander {
  const taken = new Set(g.factions[f].commanders.map((c) => c.name));
  let name = makeName(f, r);
  for (let tries = 0; tries < 4 && taken.has(name[0]); tries += 1) name = makeName(f, r);
  const stat = () => Math.min(9, 3 + Math.floor(next(r) * 4) + (level - 1));
  return {
    id: mintId(g, 'o'),
    faction: f,
    name: name[0],
    title: '',
    portrait: pick(r, GENERIC_PORTRAITS[f]),
    level,
    xp: LEVEL_XP[level - 1] ?? 0,
    alive: true,
    officer: { stats: [stat(), stat(), stat()], traits, skills: [], at, wounded: 0, captive: 0, record: blankRecord(), origin, nameEn: name[1], bio },
  };
}

/** What a man costs to hire: by level and by his good and bad traits, less what the navy's recruiters save it. */
export function hireCost(g: Grand, c: Commander): number {
  const traits = c.officer?.traits ?? [];
  const good = traits.filter((id) => TRAIT_BY_ID.get(id)?.good).length;
  const bad = traits.length - good;
  const raw = OFFICERS.hireBase + OFFICERS.hirePerLevel * (c.level - 1) + OFFICERS.hirePerTrait * good - 20 * bad + (c.officer?.origin === 'history' ? 80 : 0);
  return Math.max(40, Math.round((raw * (1 - hireCut(g, c.faction))) / 10) * 10);
}

/** The wait of a named recruit: he stays at the camp until he is hired. */
export const STAYS = 99;

const candidateOf = (g: Grand, c: Commander, at: RegionId, left: number, share = 1): OfficerCandidate => ({ id: mintId(g, 'c'), officer: c, cost: Math.round((hireCost(g, c) * share) / 10) * 10, at, left });

// --- Posts: commander, lieutenant, the pool ----------------------------------------------------------------------

/** Takes an officer off every fleet and leaves him waiting at `at`. */
function unpost(g: Grand, c: Commander, at: RegionId | null) {
  for (const fl of g.fleets) {
    if (fl.faction !== c.faction) continue;
    if (fl.commanderId === c.id) fl.commanderId = null;
    if (fl.lieutenants?.includes(c.id)) fl.lieutenants = fl.lieutenants.filter((id) => id !== c.id);
  }
  if (c.officer) c.officer.at = at;
}

const portOfFleet = (fl: Fleet) => fl.at ?? fl.from ?? null;

/** Lieutenants beyond their commander's seats, or under no commander at all, go ashore at the fleet's port. */
export function fitLieutenants(g: Grand, fl: Fleet) {
  if (!fl.lieutenants?.length) return;
  const cmd = officerById(g, fl.faction, fl.commanderId);
  const seats = cmd && officerReady(cmd) ? lieutenantSlots(cmd) : 0;
  const keep = fl.lieutenants.filter((id) => id !== fl.commanderId && officerById(g, fl.faction, id)?.alive).slice(0, seats);
  for (const id of fl.lieutenants) {
    if (keep.includes(id)) continue;
    const c = officerById(g, fl.faction, id);
    if (c?.officer) c.officer.at = portOfFleet(fl);
  }
  fl.lieutenants = keep;
}

/**
 * Before an officer takes a fleet: he leaves any lieutenant's seat, and the commander he replaces goes ashore at that
 * port. Returns why he cannot take it, if he cannot.
 */
export function beforeCommand(g: Grand, fl: Fleet, commanderId: string | null): string | null {
  if (commanderId) {
    const c = officerById(g, fl.faction, commanderId);
    if (c?.officer?.wounded) return '부상으로 지휘할 수 없습니다';
    if (c?.officer?.captive) return '적에게 사로잡혀 있습니다';
    for (const other of g.fleets) if (other.lieutenants?.includes(commanderId)) other.lieutenants = other.lieutenants.filter((id) => id !== commanderId);
  }
  const prev = officerById(g, fl.faction, fl.commanderId);
  if (prev?.officer && prev.id !== commanderId) prev.officer.at = portOfFleet(fl);
  return null;
}

/** Two fleets become one: the lieutenants of both serve the survivor's commander as far as his seats go, and a second commander goes ashore. */
export function mergeOfficers(g: Grand, keep: Fleet, gone: Fleet) {
  const other = officerById(g, gone.faction, gone.commanderId);
  if (other?.officer && other.id !== keep.commanderId) other.officer.at = portOfFleet(keep);
  keep.lieutenants = [...(keep.lieutenants ?? []), ...(gone.lieutenants ?? [])];
  fitLieutenants(g, keep);
}

// --- Setting up and migrating ------------------------------------------------------------------------------------

/**
 * Gives a campaign its officers: officer records for the commanders it already has, the named figures present at the
 * start and an empty board of recruits and cards. A save made before the officers gets the same here when it loads;
 * figures whose dates have passed come in at the next turn. Does nothing to a campaign that has them.
 */
export function ensureOfficers(g: Grand): void {
  if (g.officers) return;
  g.officers = { arrived: [], candidates: { joseon: [], japan: [], ming: [] }, offers: [] };
  for (const f of GRAND_FACTIONS) {
    const st = g.factions[f];
    const home = homePort(g, f);
    for (const c of st.commanders) {
      const fig = FIGURE_BY_ID.get(c.id);
      c.officer ??= { stats: fig ? [...fig.stats] : [5, 5, 5], traits: fig ? [...fig.traits] : [], skills: [], at: null, wounded: 0, captive: 0, record: blankRecord(), origin: fig ? 'history' : 'hired' };
      if (!postOf(g, c)) c.officer.at = home;
      if (fig) g.officers.arrived.push(fig.id);
    }
    if (!st.alive) continue;
    for (const fig of FIGURES) {
      if (fig.faction !== f || fig.arrive.kind !== 'start' || st.commanders.some((c) => c.id === fig.id)) continue;
      st.commanders.push(historicalOfficer(fig, home));
      g.officers.arrived.push(fig.id);
    }
  }
}

// --- The turn ----------------------------------------------------------------------------------------------------

/** The court's question about Yi Sun-sin (유성룡의 천거), dealt to Joseon at the start of the war. */
const TRUST_CARD = { id: 'ryu_yi', faction: 'joseon' as GrandFaction, who: 'yi', year: 1592, month: 4, xp: 150, gold: 150 };

/** How the computer answers a card: it trusts its officers and hires a recommended man when it can spare the silver. */
function aiAccepts(g: Grand, f: GrandFaction, o: OfficerOffer): boolean {
  if (o.kind === 'trust') return true;
  const cost = o.candidate?.cost ?? 0;
  return g.factions[f].gold >= cost + 300 && living(g, f).length < OFFICERS.maxOfficers;
}

/** A card goes to the player as a waiting card; a computer navy answers it at once. */
function deal(g: Grand, f: GrandFaction, o: OfficerOffer) {
  if (f === g.player) {
    g.officers!.offers.push(o);
    return;
  }
  settleOffer(g, f, o, aiAccepts(g, f, o));
}

function settleOffer(g: Grand, f: GrandFaction, o: OfficerOffer, accept: boolean) {
  const st = g.factions[f];
  if (o.kind === 'trust') {
    const c = officerById(g, f, o.who);
    if (accept && c?.alive) {
      if (c.officer && !c.officer.traits.includes('trusted') && c.officer.traits.length < OFFICERS.maxTraits) c.officer.traits.push('trusted');
      grantXp(g, f, c, TRUST_CARD.xp, f !== g.player);
    } else if (!accept) st.gold += TRUST_CARD.gold;
    return;
  }
  const cand = o.candidate;
  if (!cand) return;
  if (accept && st.gold >= cand.cost && living(g, f).length < OFFICERS.maxOfficers) {
    st.gold -= cand.cost;
    if (cand.officer.officer) cand.officer.officer.at = cand.at;
    st.commanders.push(cand.officer);
    if (f === g.player) note(g, '{name|이/가} 우리 수군에 들어왔습니다', { name: cand.officer.name }, 'good');
    return;
  }
  // A named man declined is not lost: he waits at the camp as a recruit, at the full price.
  if (cand.officer.officer?.origin === 'history') g.officers!.candidates[f].push({ ...cand, cost: hireCost(g, cand.officer), left: STAYS });
}

/** The figures whose dates have come: into the pool, among the recruits, or put forward by the officer who knew them. */
function arrivals(g: Grand, f: GrandFaction) {
  const board = g.officers!;
  const home = homePort(g, f);
  if (!home) return;
  for (const fig of FIGURES) {
    if (fig.faction !== f || board.arrived.includes(fig.id)) continue;
    const a = fig.arrive;
    if (a.kind !== 'start' && !isDue(g, a.year, a.month)) continue;
    board.arrived.push(fig.id);
    const man = historicalOfficer(fig, home);
    if (a.kind === 'pool' || a.kind === 'start') {
      g.factions[f].commanders.push(man);
      if (f === g.player) note(g, '{name|이/가} 우리 수군에 합류했습니다', { name: fig.name }, 'good');
      continue;
    }
    if (a.kind === 'recommend') {
      const by = officerById(g, f, a.by);
      if (by?.alive) {
        deal(g, f, { id: mintId(g, 'r'), kind: 'recommend', by: by.id, who: fig.id, candidate: candidateOf(g, man, home, STAYS, OFFICERS.recommendShare) });
        continue;
      }
    }
    board.candidates[f].push(candidateOf(g, man, home, STAYS));
    if (f === g.player) note(g, '{name|이/가} {place}에서 등용을 기다립니다', { name: fig.name, place: REGIONS[home].name }, 'info');
  }
  if (f === TRUST_CARD.faction && !board.arrived.includes(TRUST_CARD.id) && isDue(g, TRUST_CARD.year, TRUST_CARD.month)) {
    board.arrived.push(TRUST_CARD.id);
    if (officerById(g, f, TRUST_CARD.who)?.alive) deal(g, f, { id: mintId(g, 'r'), kind: 'trust', by: null, who: TRUST_CARD.who });
  }
}

/** Ports with a camp, where recruits come forward. */
const campPorts = (g: Grand, f: GrandFaction) => ownedBy(g, f).filter((id) => levelOf(g.regions[id], 'camp') >= 1);

/** The camps' recruits: the generated ones wait a while and go, and every few turns new men come forward. */
function refreshRecruits(g: Grand, f: GrandFaction, fi: number) {
  const board = g.officers!;
  const list = board.candidates[f];
  for (const cand of list) if (cand.left < STAYS) cand.left -= 1;
  board.candidates[f] = list.filter((c) => c.left > 0 && (g.regions[c.at].owner === f || c.officer.officer?.origin === 'history'));
  // A named recruit whose camp was lost moves to the navy's home.
  const home = homePort(g, f);
  for (const cand of board.candidates[f]) if (g.regions[cand.at].owner !== f && home) cand.at = home;
  if ((g.turn - 1) % OFFICERS.recruitEvery !== 0) return;
  const camps = campPorts(g, f);
  if (!camps.length) return;
  const r = fork(g, fi, 0x5ec);
  const fresh = board.candidates[f].filter((c) => c.officer.officer?.origin !== 'history').length;
  for (let k = fresh; k < OFFICERS.recruitCount; k += 1) {
    const level = 1 + (next(r) < 0.35 ? 1 : 0) + (next(r) < 0.1 ? 1 : 0);
    const at = pick(r, camps);
    const traits = rollTraits(r, next(r) < 0.5 ? 1 : 2);
    const man = generatedOfficer(g, f, r, level, 'hired', { text: '{place}의 군영에서 뜻을 품고 찾아온 군관입니다.', params: { place: REGIONS[at].name } }, traits, at);
    board.candidates[f].push(candidateOf(g, man, at, OFFICERS.recruitStay));
  }
}

/** An officer with a recommending skill or trait may put a man forward this turn (천거). */
function recommendations(g: Grand, f: GrandFaction, fi: number) {
  const ready = living(g, f).filter((c) => c.officer && officerReady(c));
  const weight = ready.reduce((s, c) => s + ownBonus(c).recommend, 0);
  if (weight <= 0 || ready.length >= OFFICERS.maxOfficers) return;
  const r = fork(g, fi, 0x2ec);
  if (next(r) >= OFFICERS.recommendChance * Math.min(3, weight)) return;
  const by = [...ready].sort((a, b) => ownBonus(b).recommend - ownBonus(a).recommend || b.level - a.level || (a.id < b.id ? -1 : 1))[0]!;
  const at = homePort(g, f);
  if (!at) return;
  const good = CANDIDATE_TRAITS.filter(([id]) => TRAIT_BY_ID.get(id)?.good).map(([id]) => id);
  const man = generatedOfficer(g, f, r, 1 + (next(r) < 0.5 ? 1 : 0), 'hired', { text: '{by}의 천거로 들어온 인재입니다.', params: { by: by.name } }, rollTraits(r, next(r) < 0.4 ? 1 : 0, [pick(r, good)]), at);
  deal(g, f, { id: mintId(g, 'r'), kind: 'recommend', by: by.id, who: man.id, candidate: candidateOf(g, man, at, OFFICERS.recruitStay, OFFICERS.recommendShare) });
}

function addTrait(g: Grand, c: Commander, id: string) {
  const o = c.officer;
  if (!o || o.traits.includes(id) || o.traits.length >= OFFICERS.maxTraits) return;
  o.traits.push(id);
  if (c.faction === g.player) note(g, '{name|이/가} \'{trait}\' 특성을 얻었습니다', { name: c.name, trait: TRAIT_BY_ID.get(id)!.name }, TRAIT_BY_ID.get(id)!.good ? 'good' : 'bad');
}

function dropTrait(c: Commander, id: string) {
  if (c.officer) c.officer.traits = c.officer.traits.filter((t) => t !== id);
}

/** Countdowns, the pool's whereabouts and what a long blockade or a long idle spell does to a man. */
function upkeepOfficers(g: Grand, f: GrandFaction) {
  const home = homePort(g, f);
  for (const fl of g.fleets) if (fl.faction === f) fitLieutenants(g, fl);
  for (const c of g.factions[f].commanders) {
    const o = c.officer;
    if (!o || !c.alive) continue;
    if (o.wounded > 0) {
      o.wounded -= 1;
      if (!o.wounded && f === g.player) note(g, '{name|이/가} 상처를 털고 일어났습니다', { name: c.name }, 'good');
    }
    if (o.captive > 0) {
      o.captive -= 1;
      if (!o.captive) {
        o.at = home;
        if (f === g.player) note(g, '{name|이/가} 포로 교환으로 돌아왔습니다', { name: c.name }, 'good');
      }
    }
    const post = postOf(g, c);
    if (!post && !o.captive && (!o.at || !g.regions[o.at].owner || !allied(g, f, g.regions[o.at].owner!))) o.at = home;
    const r = fork(g, hashOf(c.id), 0x1d1);
    if (post?.fleet.besieging) {
      o.record.sieges += 1;
      if (o.record.sieges === OFFICERS.siegeTurns && next(r) < 0.3) addTrait(g, c, 'cautious');
    }
    const idle = post && post.fleet.at && !post.fleet.route.length && g.factions[f].idle > 0;
    o.record.idle = idle ? o.record.idle + 1 : 0;
    if (o.record.idle >= OFFICERS.idleTurns && next(r) < OFFICERS.viceChance) addTrait(g, c, g.factions[f].gold > 2000 ? 'greedy' : 'drunkard');
  }
}

/**
 * The officers' part of a new turn: wounds heal and captives come home, figures arrive at their dates, the camps' recruits
 * change and officers may put men forward. Cards the player left unanswered last turn are declined.
 */
export function officersTurn(g: Grand): void {
  ensureOfficers(g);
  const board = g.officers!;
  const left = board.offers;
  board.offers = [];
  for (const o of left) if (g.player) settleOffer(g, g.player, o, false);
  GRAND_FACTIONS.forEach((f, fi) => {
    if (!g.factions[f].alive) return;
    upkeepOfficers(g, f);
    arrivals(g, f);
    refreshRecruits(g, f, fi);
    recommendations(g, f, fi);
  });
}

// --- Battle ------------------------------------------------------------------------------------------------------

export type BattleOfficers = {
  /** Ships each fleet brought into the fight, by fleet id. */
  sizes: Map<string, number>;
  kills: Map<string, number>;
  winners: Fleet[];
  /** How the winning side won (report.ts). */
  grade: BattleGrade;
};

/**
 * What a fight does to the officers of the fleets in it, called before the empty fleets are dropped: experience for
 * the commanders and their lieutenants, the traits a win or a rout gives, and for the men of a beaten fleet the risk of
 * wounds, capture and death. Officers of a fleet that was destroyed go ashore.
 */
export function officersAfterBattle(g: Grand, fleets: Fleet[], b: BattleOfficers): void {
  ensureOfficers(g);
  for (const fl of fleets) {
    const won = b.winners.includes(fl);
    const start = b.sizes.get(fl.id) ?? fl.ships.length;
    const lost = 1 - fl.ships.length / Math.max(1, start);
    const gone = fl.ships.length === 0;
    const bonus = fleetBonus(g, fl);
    const cmd = officerById(g, fl.faction, fl.commanderId);
    const men = [...(cmd && officerReady(cmd) ? [cmd] : []), ...(fl.lieutenants ?? []).flatMap((id) => officerById(g, fl.faction, id) ?? []).filter(officerReady)];
    const xp = (OFFICERS.xpBattle + (b.kills.get(fl.id) ?? 0) * OFFICERS.xpPerKill + (won ? OFFICERS.xpWin : 0)) * (1 + bonus.xp);
    const ashore = fl.at && g.regions[fl.at].owner && allied(g, fl.faction, g.regions[fl.at].owner!) ? fl.at : fl.from && g.regions[fl.from].owner && allied(g, fl.faction, g.regions[fl.from].owner!) ? fl.from : homePort(g, fl.faction);
    for (const c of men) {
      const o = c.officer!;
      const lead = c === cmd;
      grantXp(g, fl.faction, c, Math.round(xp * (lead ? 1 : OFFICERS.lieutenantXp)), fl.faction !== g.player);
      o.record.battles += 1;
      if (won) o.record.won += 1;
      if (won && b.grade === 'heroic') o.record.heroic += 1;
      const r = fork(g, hashOf(c.id), 0xba7, hashOf(fl.id));
      const roll = next(r);
      if (won) {
        if (b.grade === 'heroic') {
          if (roll < (o.record.heroic >= 2 ? 0.6 : 0.3)) addTrait(g, c, 'great');
          else if (roll > 0.8) addTrait(g, c, 'loyal');
        } else if (b.grade === 'decisive') {
          if (roll < 0.15) addTrait(g, c, o.stats[1] >= o.stats[0] ? 'fierce' : 'wise');
          if (next(r) < 0.5) {
            dropTrait(c, 'defeated');
            dropTrait(c, 'coward');
          }
        } else if (b.grade === 'pyrrhic' && roll < 0.2) addTrait(g, c, 'reckless');
      } else if (lost >= 0.6) {
        if (o.traits.includes('defeated')) {
          if (roll < 0.25) addTrait(g, c, 'coward');
        } else if (roll < 0.3) addTrait(g, c, 'defeated');
      }
      if (o.record.battles >= OFFICERS.veteranBattles) addTrait(g, c, 'veteran');
      // The fate of a man whose fleet was beaten: the chances halve for a lieutenant, who does not stand on the flagship.
      if (won || (!gone && lost < OFFICERS.heavyLoss)) continue;
      const share = lead ? 1 : 0.5;
      const fate = next(r);
      const death = (gone ? OFFICERS.lostDeath : OFFICERS.deathChance) * share;
      const capture = (gone ? OFFICERS.lostCapture : OFFICERS.captureChance) * share;
      const params = { name: c.name };
      const mine = fl.faction === g.player;
      if (fate < death) {
        c.alive = false;
        unpost(g, c, null);
        note(g, '{name|이/가} 전사했습니다', params, mine ? 'bad' : 'info');
      } else if (fate < death + capture) {
        o.captive = OFFICERS.captiveTurns;
        unpost(g, c, null);
        note(g, '{name|이/가} 대장선과 함께 사로잡혔습니다', params, mine ? 'bad' : 'info');
      } else if (fate < death + capture + OFFICERS.woundChance * share) {
        o.wounded = OFFICERS.woundTurns;
        unpost(g, c, ashore);
        if (next(r) < 0.4) addTrait(g, c, 'scarred');
        if (mine) note(g, '{name|이/가} 크게 다쳐 지휘에서 물러났습니다', params, 'bad');
      }
    }
    if (gone) for (const c of men) if (c.alive && c.officer && !c.officer.captive) unpost(g, c, ashore);
    fitLieutenants(g, fl);
  }
}

// --- Orders ------------------------------------------------------------------------------------------------------

const noOrders = (g: Grand): Result | null => (g.phase !== 'orders' ? fail('지금은 명령을 내릴 수 없습니다') : null);

/** Why an officer cannot take a skill now, or null. */
export function skillProblem(c: Commander, skillId: string): string | null {
  const s = SKILL_BY_ID.get(skillId);
  if (!s || !c.officer) return '해당 기술이 없습니다';
  if (c.officer.skills.includes(skillId)) return '이미 익힌 기술입니다';
  if (!c.alive) return '해당 지휘관이 없습니다';
  if (c.level < s.tier) return '{n}레벨이 되어야 익힐 수 있습니다';
  if (s.tier > 1 && !c.officer.skills.some((id) => SKILL_BY_ID.get(id)?.branch === s.branch && SKILL_BY_ID.get(id)?.tier === s.tier - 1)) return '앞 단계 기술을 먼저 익혀야 합니다';
  if (pointsOf(c) <= 0) return '남은 기술 점수가 없습니다';
  return null;
}

export function orderSkill(g: Grand, f: GrandFaction, officerId: string, skillId: string): Result {
  const c = officerById(g, f, officerId);
  if (!c) return fail('해당 지휘관이 없습니다');
  const why = skillProblem(c, skillId);
  if (why) return fail(why, { n: SKILL_BY_ID.get(skillId)?.tier ?? 1 });
  c.officer!.skills.push(skillId);
  return ok('{name|이/가} \'{skill}\' 기술을 익혔습니다', { name: c.name, skill: SKILL_BY_ID.get(skillId)!.name });
}

export function orderHire(g: Grand, f: GrandFaction, candidateId: string): Result {
  const bad = noOrders(g);
  if (bad) return bad;
  ensureOfficers(g);
  const list = g.officers!.candidates[f];
  const cand = list.find((c) => c.id === candidateId);
  if (!cand) return fail('등용할 수 있는 인물이 아닙니다');
  if (living(g, f).length >= OFFICERS.maxOfficers) return fail('군관은 최대 {n}명입니다', { n: OFFICERS.maxOfficers });
  const st = g.factions[f];
  if (st.gold < cand.cost) return fail('은이 부족합니다 ({gold}냥 필요)', { gold: cand.cost });
  st.gold -= cand.cost;
  if (cand.officer.officer) cand.officer.officer.at = cand.at;
  st.commanders.push(cand.officer);
  g.officers!.candidates[f] = list.filter((c) => c !== cand);
  return ok('{name|을/를} 등용했습니다', { name: cand.officer.name });
}

/** The player answers a card (천거): accept hires the man (or trusts the officer), decline lets him go to the camp. */
export function answerOffer(g: Grand, offerId: string, accept: boolean): Result {
  const bad = noOrders(g);
  if (bad) return bad;
  const board = g.officers;
  const o = board?.offers.find((x) => x.id === offerId);
  if (!board || !o || !g.player) return fail('해당 천거가 없습니다');
  if (accept && o.candidate && g.factions[g.player].gold < o.candidate.cost) return fail('은이 부족합니다 ({gold}냥 필요)', { gold: o.candidate.cost });
  board.offers = board.offers.filter((x) => x !== o);
  settleOffer(g, g.player, o, accept);
  return ok();
}

/** A lieutenant takes a seat under the fleet's commander, or goes ashore at its port. */
export function orderLieutenant(g: Grand, fleetId: string, officerId: string, on: boolean): Result {
  const bad = noOrders(g);
  if (bad) return bad;
  const fl = fleetById(g, fleetId);
  if (!fl) return fail('해당 함대가 없습니다');
  const c = officerById(g, fl.faction, officerId);
  if (!c || !c.alive) return fail('해당 지휘관이 없습니다');
  if (!on) {
    if (!fl.lieutenants?.includes(officerId)) return fail('이 함대의 부관이 아닙니다');
    unpost(g, c, portOfFleet(fl));
    return ok();
  }
  if (!fl.at) return fail('항해 중에는 부관을 둘 수 없습니다');
  if (!officerReady(c)) return fail(c.officer?.captive ? '적에게 사로잡혀 있습니다' : '부상으로 지휘할 수 없습니다');
  const cmd = officerById(g, fl.faction, fl.commanderId);
  if (!cmd || !officerReady(cmd)) return fail('지휘관이 있어야 부관을 둘 수 있습니다');
  if (fl.commanderId === officerId) return fail('이 함대의 지휘관입니다');
  const post = postOf(g, c);
  if (post?.role === 'commander') return fail('다른 함대를 지휘하고 있습니다');
  if (post && post.fleet.at !== fl.at) return fail('지휘관이 다른 포구에 있습니다');
  if (fl.lieutenants?.includes(officerId)) return fail('이미 이 함대의 부관입니다');
  if ((fl.lieutenants?.length ?? 0) >= lieutenantSlots(cmd)) return fail('부관 자리가 모두 찼습니다');
  unpost(g, c, null);
  fl.lieutenants = [...(fl.lieutenants ?? []), officerId];
  return ok();
}

/** Ships of a navy whose captains have earned a commission (발탁): in port, with enough kills. Most kills first. */
export function promotable(g: Grand, f: GrandFaction): { fleet: Fleet; shipId: string; kills: number }[] {
  const out: { fleet: Fleet; shipId: string; kills: number }[] = [];
  for (const fl of g.fleets) {
    if (fl.faction !== f || !fl.at) continue;
    for (const u of fl.ships) if (u.kills >= OFFICERS.promoteKills) out.push({ fleet: fl, shipId: u.id, kills: u.kills });
  }
  return out.sort((a, b) => b.kills - a.kills || (a.shipId < b.shipId ? -1 : 1));
}

/** Raises a veteran ship's captain to an officer: he takes half the ship's tally of kills with him. */
export function orderPromote(g: Grand, fleetId: string, shipId: string): Result {
  const bad = noOrders(g);
  if (bad) return bad;
  ensureOfficers(g);
  const fl = fleetById(g, fleetId);
  const u = fl?.ships.find((s) => s.id === shipId);
  if (!fl || !u) return fail('해당 함선이 없습니다');
  if (!fl.at) return fail('포구에 있는 함선만 발탁할 수 있습니다');
  if (u.kills < OFFICERS.promoteKills) return fail('격침 {n}척 이상인 함선의 군관만 발탁할 수 있습니다', { n: OFFICERS.promoteKills });
  const f = fl.faction;
  if (living(g, f).length >= OFFICERS.maxOfficers) return fail('군관은 최대 {n}명입니다', { n: OFFICERS.maxOfficers });
  const st = g.factions[f];
  if (st.gold < OFFICERS.promoteCost) return fail('은이 부족합니다 ({gold}냥 필요)', { gold: OFFICERS.promoteCost });
  st.gold -= OFFICERS.promoteCost;
  const r = fork(g, hashOf(u.id), 0x9b);
  const level = 1 + Math.min(2, Math.floor((u.kills - OFFICERS.promoteKills) / 3));
  const traits = u.kills >= 6 ? ['veteran'] : rollTraits(r, next(r) < 0.5 ? 1 : 0);
  const man = generatedOfficer(g, f, r, level, 'ranks', { text: '{ship}에서 공을 세워 병사 가운데 발탁되었습니다.', params: { ship: u.name } }, traits, fl.at);
  st.commanders.push(man);
  u.kills = Math.floor(u.kills / 2);
  return ok('{name|을/를} 발탁했습니다', { name: man.name });
}

// --- The computer navies -----------------------------------------------------------------------------------------

/** The node a navy's doctrine takes next for an officer: its favoured branches and picks, leaning on the man's best stat. */
function doctrinePick(c: Commander): string | null {
  const d = DOCTRINE[c.faction];
  let best: { id: string; score: number } | null = null;
  for (const s of SKILLS) {
    if (skillProblem(c, s.id)) continue;
    const stat = c.officer!.stats[(['lead', 'war', 'admin'] as Branch[]).indexOf(s.branch)]!;
    const score = (3 - d.order.indexOf(s.branch)) * 2 + (d.prefer.includes(s.id) ? 2 : 0) + stat * 0.3 - s.tier * 0.1;
    if (!best || score > best.score) best = { id: s.id, score };
  }
  return best?.id ?? null;
}

/**
 * The computer's use of its officers: points spent by doctrine, a recruit hired or a veteran raised when the navy is
 * short of free officers and has silver to spare, and the free officers seated as lieutenants of the strongest fleets.
 * Runs after the commanders are assigned; it never touches the campaign's generator.
 */
export function planOfficers(g: Grand, f: GrandFaction): void {
  ensureOfficers(g);
  if (((globalThis as any).process?.env?.OFFX ?? '').includes('ai')) return; // TEMPX
  const st = g.factions[f];
  for (const c of st.commanders) {
    if (!c.alive || !c.officer) continue;
    if (((globalThis as any).process?.env?.OFFX ?? '').includes('skill')) continue; // TEMPX
    for (let id = doctrinePick(c); id; id = doctrinePick(c)) c.officer.skills.push(id);
  }
  const free = () => st.commanders.filter((c) => c.officer && officerReady(c) && !postOf(g, c));
  // Silver goes to officers only when a real fleet has nobody to lead it, or when the treasury is overflowing.
  const leaderless = g.fleets.filter((fl) => fl.faction === f && fl.ships.length >= OFFICERS.aiFleetShips && !officerById(g, f, fl.commanderId)).length;
  const want = (leaderless > free().length ? 800 : st.gold >= 3500 ? 3000 : Infinity);
  if (!((globalThis as any).process?.env?.OFFX ?? '').includes('hire') && g.phase === 'orders' && want < Infinity && living(g, f).length < OFFICERS.maxOfficers) { // TEMPX
    const cand = [...g.officers!.candidates[f]].sort((a, b) => b.officer.level - a.officer.level || a.cost - b.cost)[0];
    if (cand && st.gold >= cand.cost + want) orderHire(g, f, cand.id);
    else {
      const vet = promotable(g, f)[0];
      if (vet && st.gold >= OFFICERS.promoteCost + want) orderPromote(g, vet.fleet.id, vet.shipId);
    }
  }
  const byStrength = g.fleets.filter((fl) => fl.faction === f && fl.at && fl.commanderId && fl.ships.length >= OFFICERS.aiFleetShips).sort((a, b) => b.ships.length - a.ships.length || (a.id < b.id ? -1 : 1));
  const pool = free().sort((a, b) => b.level - a.level || (a.id < b.id ? -1 : 1));
  for (const fl of ((globalThis as any).process?.env?.OFFX ?? '').includes('seat') ? [] : byStrength) { // TEMPX
    const cmd = officerById(g, f, fl.commanderId);
    if (!cmd || !officerReady(cmd)) continue;
    while ((fl.lieutenants?.length ?? 0) < lieutenantSlots(cmd) && pool.length) {
      const c = pool.shift()!;
      if (!orderLieutenant(g, fl.id, c.id, true).ok) break;
    }
  }
}

/** Every officer of a navy who still serves, for the interface: commanders first, then by level. */
export function rosterOf(g: Grand, f: GrandFaction): Commander[] {
  return [...g.factions[f].commanders].filter((c) => c.alive).sort((a, b) => Number(!!postOf(g, b)) - Number(!!postOf(g, a)) || b.level - a.level || b.xp - a.xp);
}
