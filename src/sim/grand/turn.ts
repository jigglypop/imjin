import { planAi } from './ai';
import { autoResolve, previewStrength, type Force, type ResolveResult } from './autoresolve';
import {
  BUILDING_DEFS,
  GARRISON_KIND,
  MAX_TURNS,
  TUNING,
  buildingOf,
  factionIncome,
  factionUpkeep,
  garrisonCap,
  repairRates,
  shipDef,
  levelOf,
  navyName,
} from './economy';
import { COMMANDERS, KOREA_COAST, LANES, REGION_ORDER, REGIONS, START } from './regions';
import { makeRng, next } from './rng';
import type { BattleOutcome, BuildingKind, Contact, Fleet, Grand, GrandFaction, RegionId, ShipUnit } from './types';
import { GRAND_FACTIONS } from './types';
import { allied, atWar, fleetById, fleetStrength, mintId, note, ownedBy, passable, shipCount } from './world';
import { josa } from './josa';
import { LEVEL_XP, SHIP_PREFIX, grantXp, spawnFleet, spawnShip } from './roster';
import { fireEvents } from './events';

export { MAX_TURNS, LEVEL_XP, spawnShip };

/**
 * A new campaign. `spread` perturbs each navy's opening fleet by up to that share, from the seed: 0 for a real game,
 * a few hundredths when the balance scripts want to know how stable an outcome is.
 */
export function newGrand(player: GrandFaction | null, seed = 1592, difficulty: Grand['difficulty'] = 'normal', spread = 0): Grand {
  const g: Grand = {
    version: 1,
    seed,
    rng: makeRng(seed),
    player,
    difficulty,
    turn: 1,
    phase: 'orders',
    regions: {} as Grand['regions'],
    fleets: [],
    factions: {} as Grand['factions'],
    relations: { 'japan:joseon': 'war', 'japan:ming': 'war', 'joseon:ming': 'allied' },
    pending: [],
    fought: 0,
    credit: { joseon: 0, japan: 0, ming: 0 },
    nextId: 0,
    log: [],
    stats: [],
    victory: null,
    events: { done: {}, pending: null, flags: [], mods: [] },
  };
  for (const id of REGION_ORDER) {
    const owner = START.owners[id];
    g.regions[id] = { owner, buildings: [], garrison: [], queue: [], unrest: 0 };
    for (const [kind, level] of Object.entries(START.buildings[id] ?? {}) as [BuildingKind, number][]) g.regions[id].buildings.push({ kind, level, upgradeLeft: 0, hp: 1 });
    const cap = garrisonCap(id, g.regions[id]);
    for (let i = 0; i < cap; i += 1) g.regions[id].garrison.push(spawnShip(g, GARRISON_KIND[owner]));
  }
  for (const f of GRAND_FACTIONS) {
    g.factions[f] = {
      faction: f,
      gold: START.gold[f],
      alive: true,
      commanders: COMMANDERS.filter((c) => c.faction === f).map((c) => ({ ...c, xp: LEVEL_XP[c.level - 1] ?? 0, alive: true })),
      unlocked: [],
      objectiveHold: 0,
      idle: 0,
    };
  }
  const scale = Object.fromEntries(GRAND_FACTIONS.map((f) => [f, TUNING.startFleet[f] * (1 + spread * (2 * next(g.rng) - 1))])) as Record<GrandFaction, number>;
  for (const s of START.fleets) {
    const ships = Object.fromEntries(Object.entries(s.ships).map(([k, n]) => [k, Math.round(n * scale[s.faction])]));
    spawnFleet(g, s.faction, s.at, s.name, ships, s.commander);
  }
  note(g, '조선, 일본, 명 세 진영이 남해의 물길을 두고 맞섭니다.');
  recordStats(g, 0, 0);
  fireEvents(g);
  return g;
}

// --- Fights -----------------------------------------------------------------------------------------------------

const commanderOf = (g: Grand, fl: Fleet) => (fl.commanderId ? g.factions[fl.faction].commanders.find((c) => c.id === fl.commanderId) : undefined);
export const commanderLevel = (g: Grand, fl: Fleet) => {
  const c = commanderOf(g, fl);
  return c?.alive ? c.level : 1;
};

export function contactForces(g: Grand, c: Contact): { attacker: Force; defender: Force; attackers: Fleet[]; defenders: Fleet[] } {
  const attackers = c.attackerFleets.flatMap((id) => fleetById(g, id) ?? []);
  const defenders = c.defenderFleets.flatMap((id) => fleetById(g, id) ?? []);
  const region = g.regions[c.regionId];
  const garrison = region.owner === c.defender ? region.garrison : [];
  return {
    attacker: { ships: attackers.flatMap((f) => f.ships), leader: Math.max(1, ...attackers.map((f) => commanderLevel(g, f))) },
    defender: { ships: [...defenders.flatMap((f) => f.ships), ...garrison], leader: Math.max(1, ...defenders.map((f) => commanderLevel(g, f))), region: region.owner === c.defender ? region : undefined },
    attackers,
    defenders,
  };
}

function sail(fl: Fleet, from: RegionId, to: RegionId) {
  const turns = LANES[from].find((l) => l.to === to)?.turns ?? 1;
  fl.route = [];
  if (turns <= 1) {
    fl.at = to;
    fl.transit = null;
  } else {
    // The turn of the fight counts as the first turn at sea, like a departure, so the voyage is as long as the lane.
    fl.at = null;
    fl.transit = { from, to, left: turns - 1 };
  }
}

/** A beaten fleet falls back to the port it came from, or to the nearest friendly one; with nowhere to go it is lost. */
function retreat(g: Grand, fl: Fleet, from: RegionId) {
  const safe = (id: RegionId) => id !== from && passable(g, fl.faction, id) && !g.fleets.some((o) => o.at === id && atWar(g, o.faction, fl.faction));
  const lanes = LANES[from].filter((l) => safe(l.to));
  const home = fl.from && lanes.find((l) => l.to === fl.from);
  const mine = (id: RegionId) => (g.regions[id].owner === fl.faction ? 0 : 1);
  const choice = home ?? [...lanes].sort((a, b) => a.turns - b.turns || mine(a.to) - mine(b.to))[0];
  if (!choice) {
    note(g, `${josa(fl.name, '이/가')} 퇴로를 잃고 전멸했습니다`, fl.faction === g.player ? 'bad' : 'info');
    g.fleets.splice(g.fleets.indexOf(fl), 1);
    return;
  }
  for (const u of fl.ships) u.supply = Math.max(0.2, u.supply * 0.7);
  sail(fl, from, choice.to);
}

/** The region changes hands. Its works are damaged, its queue is lost and its people are restless. */
export function captureRegion(g: Grand, id: RegionId, taker: GrandFaction) {
  const r = g.regions[id];
  const prev = r.owner;
  // An ally that drives the enemy out of a port hands it back to the navy it was taken from.
  const rightful = START.owners[id];
  const liberated = rightful !== taker && g.factions[rightful].alive && allied(g, taker, rightful);
  const by = liberated ? rightful : taker;
  g.credit[taker] += REGIONS[id].value * TUNING.score.captureCredit;
  r.owner = by;
  r.garrison = [];
  r.queue = [];
  r.unrest = liberated ? 1 : TUNING.unrestTurns;
  r.buildings = r.buildings
    .filter((b) => b.kind !== 'battery')
    .map((b) => ({ ...b, level: b.level - 1, upgradeLeft: 0, hp: 1 }))
    .filter((b) => b.level > 0);
  const label = navyName(by);
  const tone = by === g.player ? 'good' : prev === g.player ? 'bad' : 'info';
  note(g, liberated ? `${josa(navyName(taker), '이/가')} ${josa(REGIONS[id].name, '을/를')} 되찾아 ${label}에 돌려주었습니다` : `${josa(label, '이/가')} ${josa(REGIONS[id].name, '을/를')} 차지했습니다`, tone);
}

function dropEmpty(g: Grand) {
  g.fleets = g.fleets.filter((f) => f.ships.length > 0);
}

function giveXp(g: Grand, fl: Fleet, kills: number, won: boolean) {
  const cmd = commanderOf(g, fl);
  if (!cmd || !cmd.alive) return;
  grantXp(g, fl.faction, cmd, 25 + kills * 8 + (won ? 50 : 0));
}

/** The one way a battle, played or auto-resolved, changes the campaign. */
export function applyContactOutcome(g: Grand, c: Contact, outcome: BattleOutcome): void {
  const { attackers, defenders } = contactForces(g, c);
  const region = g.regions[c.regionId];
  for (const f of [c.attacker, c.defender, ...attackers.map((x) => x.faction), ...defenders.map((x) => x.faction)]) g.factions[f].idle = -1;
  const byId = new Map(outcome.ships.map((s) => [s.campaignId, s]));
  const kills = new Map<string, number>();
  let lostA = 0;
  let lostD = 0;
  // Strength each side lost, which is the other side's credit toward a score.
  const worn = { a: 0, d: 0 };
  const settle = (list: ShipUnit[], side: 'a' | 'd', fleetId: string | null) =>
    list.filter((u) => {
      const o = byId.get(u.id);
      if (!o) return true;
      u.kills += o.kills;
      if (fleetId) kills.set(fleetId, (kills.get(fleetId) ?? 0) + o.kills);
      worn[side] += shipDef(u.kind).strength * (u.hull - (o.alive ? o.hull : 0));
      if (!o.alive) {
        if (side === 'a') lostA += 1;
        else lostD += 1;
        return false;
      }
      u.hull = o.hull;
      u.crew = o.crew;
      u.supply = o.supply;
      return true;
    });
  for (const f of attackers) f.ships = settle(f.ships, 'a', f.id);
  for (const f of defenders) f.ships = settle(f.ships, 'd', f.id);
  if (region.owner === c.defender) region.garrison = settle(region.garrison, 'd', null);
  const attackerWon = outcome.winner === 'attacker';
  const credit = (to: GrandFaction[], amount: number) => {
    for (const f of to) g.credit[f] += amount / to.length;
  };
  credit([...new Set([c.defender, ...defenders.map((x) => x.faction)])], worn.a);
  credit([...new Set([c.attacker, ...attackers.map((x) => x.faction)])], worn.d);
  for (const f of [...attackers, ...defenders]) giveXp(g, f, kills.get(f.id) ?? 0, (attackerWon ? attackers : defenders).includes(f));
  // The works take the damage the fight did to them.
  for (const kind of outcome.razed) downgrade(region, kind);
  for (const [kind, loss] of Object.entries(outcome.damage ?? {}) as [BuildingKind, number][]) {
    const b = buildingOf(region, kind);
    if (!b || loss <= 0) continue;
    b.hp -= loss;
    if (b.hp <= 0.15) downgrade(region, kind);
  }
  dropEmpty(g);
  g.pending = g.pending.filter((p) => p.id !== c.id);
  const aLabel = TUNING.faction[c.attacker].label;
  const dLabel = TUNING.faction[c.defender].label;
  const mine = g.player === c.attacker || g.player === c.defender;
  const winner = attackerWon ? c.attacker : c.defender;
  note(g, `${REGIONS[c.regionId].name} 해전에서 ${josa(navyName(winner), '이/가')} 승리했습니다 (손실: ${aLabel} ${lostA}척, ${dLabel} ${lostD}척)`, !mine ? 'info' : winner === g.player ? 'good' : 'bad');
  // The turn closes right after the fight and takes one off, so the rest is counted from the next turn.
  for (const f of [...attackers, ...defenders]) f.rest = TUNING.restAfterBattle + 1;
  if (attackerWon) {
    for (const f of defenders) if (g.fleets.includes(f)) retreat(g, f, c.regionId);
    for (const f of attackers) if (g.fleets.includes(f)) f.route = [];
    captureRegion(g, c.regionId, c.attacker);
  } else {
    for (const f of attackers) if (g.fleets.includes(f)) retreat(g, f, c.regionId);
  }
}

function downgrade(region: Grand['regions'][RegionId], kind: BuildingKind) {
  const b = buildingOf(region, kind);
  if (!b) return;
  b.level -= 1;
  b.hp = 1;
  b.upgradeLeft = 0;
  if (b.level <= 0) region.buildings.splice(region.buildings.indexOf(b), 1);
}

/** What the player is shown before choosing between fighting and auto-resolving. */
export function previewContact(g: Grand, contactId: string) {
  const c = g.pending.find((p) => p.id === contactId);
  if (!c) return null;
  const f = contactForces(g, c);
  const odds = previewStrength(f.attacker.ships, f.defender.ships, f.defender.region);
  return { contact: c, attacker: odds.attacker, defender: odds.defender, ratio: odds.ratio, attackerShips: f.attacker.ships.length, defenderShips: f.defender.ships.length, battery: f.defender.region ? levelOf(f.defender.region, 'battery') : 0 };
}

/** How often the attacker wins when the numbers settle the meeting, over differently seeded luck. For the preview's odds. */
export function oddsOfContact(g: Grand, contactId: string, samples = 40): number | null {
  const c = g.pending.find((p) => p.id === contactId);
  if (!c) return null;
  const f = contactForces(g, c);
  let wins = 0;
  for (let i = 0; i < samples; i += 1) {
    const r = autoResolve({ attacker: f.attacker, defender: f.defender, seed: g.seed + 7919 * (i + 1), tags: [g.turn, REGION_ORDER.indexOf(c.regionId)] });
    if (r.outcome.winner === 'attacker') wins += 1;
  }
  return wins / samples;
}

/** Settles a contact without playing it. The same game state always gives the same result. */
export function autoResolveContact(g: Grand, contactId: string): ResolveResult | null {
  const c = g.pending.find((p) => p.id === contactId);
  if (!c) return null;
  const result = resolveContact(g, c);
  applyContactOutcome(g, c, result.outcome);
  settlePending(g);
  return result;
}

export function resolveContact(g: Grand, c: Contact): ResolveResult {
  const f = contactForces(g, c);
  return autoResolve({ attacker: f.attacker, defender: f.defender, seed: g.seed, tags: [g.turn, REGION_ORDER.indexOf(c.regionId)] });
}

/** After the last waiting battle is decided, the turn goes on. */
export function settlePending(g: Grand) {
  if (g.phase === 'battles' && g.pending.length === 0) advanceTurn(g);
}

// --- Movement and contact ---------------------------------------------------------------------------------------

function moveFleets(g: Grand) {
  // Two hostile fleets sailing opposite ways along one lane meet at sea: the one that was already in port is held there
  // and the other arrives to fight it, so fleets cannot slip past each other.
  for (const a of g.fleets) {
    const to = a.route[0];
    if (!to || !a.at || a.transit || a.rest > 0) continue;
    for (const b of g.fleets) {
      if (b.at === to && b.route[0] === a.at && !b.transit && b.rest <= 0 && atWar(g, a.faction, b.faction) && LANES[a.at].find((l) => l.to === to)?.turns === 1) b.route = [];
    }
  }
  for (const fl of [...g.fleets]) {
    if (fl.transit) {
      fl.transit.left -= 1;
      if (fl.transit.left <= 0) {
        fl.at = fl.transit.to;
        fl.transit = null;
      }
      continue;
    }
    const to = fl.route[0];
    if (!to || !fl.at || fl.rest > 0) continue;
    const last = fl.route.length === 1;
    // A port that fell to the enemy on the way ends the voyage short of it.
    if (!last && !passable(g, fl.faction, to)) {
      fl.route = [];
      continue;
    }
    const lane = LANES[fl.at].find((l) => l.to === to);
    if (!lane) {
      fl.route = [];
      continue;
    }
    const from = fl.at;
    fl.route.shift();
    if (lane.turns <= 1) fl.at = to;
    else {
      fl.at = null;
      fl.transit = { from, to, left: lane.turns - 1 };
    }
  }
}

function findContacts(g: Grand): Contact[] {
  const out: Contact[] = [];
  for (const id of REGION_ORDER) {
    const here = g.fleets.filter((f) => f.at === id);
    if (!here.length) continue;
    const r = g.regions[id];
    if (!r.owner) {
      // Open water is claimed by whoever sails in first.
      r.owner = here[0]!.faction;
      continue;
    }
    const owner = r.owner;
    const hostile = here.filter((f) => atWar(g, f.faction, owner));
    if (!hostile.length) continue;
    const power = new Map<GrandFaction, number>();
    for (const f of hostile) power.set(f.faction, (power.get(f.faction) ?? 0) + fleetStrength(f));
    const primary = [...power.entries()].sort((a, b) => b[1] - a[1] || GRAND_FACTIONS.indexOf(a[0]) - GRAND_FACTIONS.indexOf(b[0]))[0]![0];
    const attackers = hostile.filter((f) => allied(g, f.faction, primary));
    for (const f of hostile) if (!attackers.includes(f) && g.fleets.includes(f)) retreat(g, f, id);
    const defenders = here.filter((f) => allied(g, f.faction, owner));
    const hasDefence = defenders.length > 0 || r.garrison.length > 0 || levelOf(r, 'battery') > 0;
    if (!hasDefence) {
      for (const f of attackers) f.route = [];
      captureRegion(g, id, primary);
      continue;
    }
    const player = g.player !== null && [primary, owner, ...attackers.map((f) => f.faction), ...defenders.map((f) => f.faction)].includes(g.player);
    out.push({ id: `${g.turn}:${id}`, regionId: id, attacker: primary, defender: owner, attackerFleets: attackers.map((f) => f.id), defenderFleets: defenders.map((f) => f.id), player });
  }
  return out;
}

const isOver = (g: Grand) => g.phase === 'over';

/** What the closing turn did: the meetings still waiting for the player, and every meeting it brought about (for the map's replay). */
export type TurnReport = { pending: Contact[]; finished: boolean; contacts: Contact[] };

/**
 * Ends the player's turn: the computer factions give their orders, every fleet sails one lane, and the meetings that
 * result are fought. Meetings that involve the player wait in `g.pending`; when none is left the turn closes.
 */
export function endTurn(g: Grand): TurnReport {
  if (g.phase !== 'orders') return { pending: g.pending, finished: g.phase === 'over', contacts: [] };
  for (const f of GRAND_FACTIONS) if (g.factions[f].alive && f !== g.player) planAi(g, f);
  for (const fl of g.fleets) fl.from = fl.at ?? fl.transit?.from ?? null;
  moveFleets(g);
  const contacts = findContacts(g);
  const waiting: Contact[] = [];
  for (const c of contacts) {
    // A fleet may have been bounced or lost by an earlier meeting this turn.
    if (!c.attackerFleets.some((id) => fleetById(g, id))) continue;
    if (c.player) waiting.push(c);
    else applyContactOutcome(g, c, resolveContact(g, c).outcome);
  }
  g.fought = contacts.length;
  g.pending = waiting;
  if (waiting.length) {
    g.phase = 'battles';
    return { pending: waiting, finished: false, contacts };
  }
  advanceTurn(g);
  return { pending: [], finished: isOver(g), contacts };
}

// --- The turn closes --------------------------------------------------------------------------------------------

function recordStats(g: Grand, battles: number, turn = g.turn, paid?: Record<GrandFaction, { earned: number; upkeep: number }>) {
  const row = { turn, battles, gold: {}, regions: {}, ships: {}, strength: {}, income: {}, earned: {}, upkeep: {} } as unknown as Required<Grand['stats'][number]>;
  for (const f of GRAND_FACTIONS) {
    row.gold[f] = Math.round(g.factions[f].gold);
    row.regions[f] = ownedBy(g, f).length;
    row.ships[f] = shipCount(g, f);
    row.strength[f] = Math.round(g.fleets.reduce((a, fl) => a + (fl.faction === f ? fleetStrength(fl) : 0), 0));
    row.income[f] = factionIncome(g, f) - factionUpkeep(g, f);
    row.earned[f] = paid?.[f].earned ?? 0;
    row.upkeep[f] = paid?.[f].upkeep ?? 0;
  }
  g.stats.push(row);
}

function joinOrNewFleet(g: Grand, faction: GrandFaction, at: RegionId, unit: ShipUnit) {
  const open = g.fleets.filter((f) => f.faction === faction && f.at === at && f.ships.length < TUNING.fleetCap && !f.route.length);
  const host = open.sort((a, b) => b.ships.length - a.ships.length)[0];
  if (host) {
    host.ships.push(unit);
    return;
  }
  g.fleets.push({ id: mintId(g, 'f'), faction, name: `${REGIONS[at].name} 신규 함대`, commanderId: null, ships: [unit], at, transit: null, route: [], from: at, rest: 0 });
}

function runEvents(g: Grand) {
  if (g.turn === TUNING.geobukseonTurn && g.factions.joseon.alive && !g.factions.joseon.unlocked.includes('geobukseon')) {
    g.factions.joseon.unlocked.push('geobukseon');
    note(g, '나대용이 거북선을 완성했습니다. 선소 2단계에서 건조할 수 있습니다.', g.player === 'joseon' ? 'good' : 'info');
  }
  for (const f of GRAND_FACTIONS) {
    const plan = TUNING.reinforce[f];
    if (!g.factions[f].alive || g.turn < plan.first || (g.turn - plan.first) % plan.every !== 0) continue;
    if (g.regions[plan.at].owner !== f) continue;
    const fleet = spawnFleet(g, f, plan.at, f === 'japan' ? '후속 함대' : f === 'ming' ? '명 원군' : '의병 수군', plan.ships, null);
    note(g, `${navyName(f)}의 ${fleet.name} ${fleet.ships.length}척이 ${REGIONS[plan.at].name}에 도착했습니다`, f === g.player ? 'good' : 'info');
  }
}

/** What each faction must hold to win outright, and for how many turns in a row. */
export const OBJECTIVE_HOLD = 2;

export function objectiveText(f: GrandFaction): string {
  if (f === 'joseon') return '남해안 포구 8곳과 쓰시마를 모두 차지하고 반년 동안 유지합니다.';
  if (f === 'japan') return '한산도를 포함해 남해안 포구 8곳 중 6곳을 차지하고 반년 동안 유지합니다.';
  return '부산포와, 쓰시마 또는 나고야를 차지하고 반년 동안 유지합니다.';
}

export function objectiveMet(g: Grand, f: GrandFaction): boolean {
  const own = (id: RegionId) => g.regions[id].owner === f;
  const coast = KOREA_COAST.filter(own).length;
  if (f === 'joseon') return coast === KOREA_COAST.length && own('tsushima');
  if (f === 'japan') return coast >= KOREA_COAST.length - 2 && own('hansan');
  return own('busan') && (own('tsushima') || own('nagoya'));
}

/** Progress toward the objective as have/need, for the strategic map. */
export function objectiveProgress(g: Grand, f: GrandFaction): { have: number; need: number } {
  const own = (id: RegionId) => g.regions[id].owner === f;
  const coast = KOREA_COAST.filter(own).length;
  if (f === 'joseon') return { have: coast + (own('tsushima') ? 1 : 0), need: KOREA_COAST.length + 1 };
  if (f === 'japan') return { have: Math.min(coast, KOREA_COAST.length - 2), need: KOREA_COAST.length - 2 };
  return { have: (own('busan') ? 1 : 0) + (own('tsushima') || own('nagoya') ? 1 : 0), need: 2 };
}

export function scoreOf(g: Grand, f: GrandFaction): number {
  let s = 0;
  for (const id of ownedBy(g, f)) s += REGIONS[id].value * TUNING.score.region;
  for (const fl of g.fleets) if (fl.faction === f) s += fleetStrength(fl) * TUNING.score.strength;
  return Math.round(s + Math.max(0, g.factions[f].gold) * TUNING.score.gold + g.credit[f] * TUNING.score.credit);
}

function checkVictory(g: Grand) {
  for (const f of GRAND_FACTIONS) {
    const st = g.factions[f];
    if (st.alive && ownedBy(g, f).length === 0) {
      st.alive = false;
      g.fleets = g.fleets.filter((fl) => fl.faction !== f);
      note(g, `${josa(navyName(f), '은/는')} 모든 포구를 잃고 패망했습니다`, f === g.player ? 'bad' : 'info');
    }
    st.idle += 1;
    st.objectiveHold = st.alive && objectiveMet(g, f) ? st.objectiveHold + 1 : 0;
  }
  const alive = GRAND_FACTIONS.filter((f) => g.factions[f].alive);
  const best = (list: GrandFaction[]) => [...list].sort((a, b) => scoreOf(g, b) - scoreOf(g, a) || GRAND_FACTIONS.indexOf(a) - GRAND_FACTIONS.indexOf(b))[0]!;
  const done = (faction: GrandFaction, kind: 'objective' | 'score' | 'elimination') => {
    g.victory = { faction, kind, turn: g.turn };
    g.phase = 'over';
    note(g, `${josa(navyName(faction), '이/가')} 전역에서 승리했습니다`, faction === g.player ? 'good' : 'bad');
  };
  if (g.player && !g.factions[g.player].alive) return done(best(alive.length ? alive : [g.player]), 'elimination');
  const objective = alive.find((f) => g.factions[f].objectiveHold >= OBJECTIVE_HOLD);
  if (objective) return done(objective, 'objective');
  // Only friends are left: they share the victory, credited to the one with the most to show.
  if (alive.length <= 1 || alive.every((a) => alive.every((b) => allied(g, a, b)))) return done(best(alive), 'elimination');
  if (g.turn >= MAX_TURNS) done(best(alive), 'score');
}

function advanceTurn(g: Grand) {
  // Works and ships under construction.
  for (const id of REGION_ORDER) {
    const r = g.regions[id];
    for (const b of r.buildings) {
      if (b.upgradeLeft > 0) {
        b.upgradeLeft -= 1;
        if (b.upgradeLeft === 0) {
          b.level += 1;
          b.hp = 1;
          if (r.owner === g.player) note(g, `${REGIONS[id].name}의 ${BUILDING_DEFS[b.kind].label} ${b.level}단계가 완공되었습니다`, 'good', 'built');
        }
      }
    }
    if (!r.owner) continue;
    // A shipyard that is razed or still in its foundations builds nothing: the queue waits.
    for (const q of levelOf(r, 'shipyard') > 0 ? [...r.queue] : []) {
      q.left -= 1;
      if (q.left > 0) continue;
      r.queue.splice(r.queue.indexOf(q), 1);
      joinOrNewFleet(g, r.owner, id, spawnShip(g, q.kind));
      if (r.owner === g.player) note(g, `${REGIONS[id].name}에서 ${josa(SHIP_PREFIX[q.kind], '이/가')} 완성되었습니다`, 'good', 'built');
    }
    if (r.unrest > 0) r.unrest -= 1;
    else {
      for (const u of r.garrison) u.hull = Math.min(1, u.hull + 0.2);
      if (r.garrison.length < garrisonCap(id, r)) for (let i = 0; i < TUNING.garrison.regen && r.garrison.length < garrisonCap(id, r); i += 1) r.garrison.push(spawnShip(g, GARRISON_KIND[r.owner]));
    }
  }
  // Fleets rest in friendly ports and wear down in foreign water.
  for (const fl of g.fleets) {
    if (fl.rest > 0) fl.rest -= 1;
    if (!fl.at) {
      for (const u of fl.ships) u.supply = Math.max(0.15, u.supply - 0.04);
      continue;
    }
    const r = g.regions[fl.at];
    if (r.owner && allied(g, fl.faction, r.owner)) {
      const rate = repairRates(r);
      for (const u of fl.ships) {
        u.hull = Math.min(1, u.hull + rate.hull);
        u.crew = Math.min(1, u.crew + rate.crew);
        u.supply = Math.min(1, u.supply + rate.supply);
      }
    } else {
      for (const u of fl.ships) {
        u.supply = Math.max(0.15, u.supply - TUNING.attrition.supply);
        u.crew = Math.max(0.25, u.crew - TUNING.attrition.crew);
      }
    }
  }
  // Treasury.
  const paid = {} as Record<GrandFaction, { earned: number; upkeep: number }>;
  for (const f of GRAND_FACTIONS) {
    const st = g.factions[f];
    paid[f] = { earned: 0, upkeep: 0 };
    if (!st.alive) continue;
    paid[f] = { earned: factionIncome(g, f), upkeep: factionUpkeep(g, f) };
    st.gold += paid[f].earned - paid[f].upkeep;
    if (st.gold < 0) {
      st.gold = 0;
      desert(g, f);
    }
  }
  g.events.mods = g.events.mods.map((m) => ({ ...m, left: m.left - 1 })).filter((m) => m.left > 0);
  runEvents(g);
  recordStats(g, g.fought, g.turn, paid);
  checkVictory(g);
  if (g.phase !== 'over') {
    g.turn += 1;
    g.phase = 'orders';
    fireEvents(g);
  }
}

/** With the treasury empty, the weakest ships desert. */
function desert(g: Grand, f: GrandFaction) {
  const all = g.fleets.filter((fl) => fl.faction === f).flatMap((fl) => fl.ships.map((u) => ({ fl, u })));
  all.sort((a, b) => shipDef(a.u.kind).strength * a.u.hull - shipDef(b.u.kind).strength * b.u.hull);
  const n = Math.ceil(all.length * 0.08);
  for (const { fl, u } of all.slice(0, n)) fl.ships.splice(fl.ships.indexOf(u), 1);
  dropEmpty(g);
  if (n) note(g, `${navyName(f)}: 은이 부족해 함선 ${n}척이 이탈했습니다`, f === g.player ? 'bad' : 'info');
}
