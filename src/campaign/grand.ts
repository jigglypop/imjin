import { create } from 'zustand';
import { chooseEvent } from '../sim/grand/events';
import { buildReplay, isEmpty, type TurnReplay } from '../sim/grand/replay';
import type { ResolveResult } from '../sim/grand/autoresolve';
import { t } from '../i18n';
import { tName } from '../ui/grand/text';
import { applyBattleResult, describeBattle, type BridgeSeat, type RegionBattle } from '../sim/grand/bridge';
import { summarizeBattle, type BattleSummary } from '../sim/grand/report';
import { cancelBuild, cancelRecruit, orderAlliance, orderAssault, orderBuild, orderCommander, orderDeclareWar, orderDisband, orderIntercept, orderMerge, orderMove, orderRecruit, orderRefit, orderSplit, orderStance, orderStop } from '../sim/grand/orders';
import { factionsOf, orderOf } from '../sim/grand/theatre';
import { theatreOfAddress } from '../ui/grand/theatreChoice';
import { autoResolveContact, besiegeContact, endTurn, newGrand, withdrawContact, type TurnReport } from '../sim/grand/turn';
import type { BattleOutcome, BuildingKind, Fleet, Grand, GrandFaction, RegionId, Result, Stance, TheatreId } from '../sim/grand/types';
import { fail, ok } from '../sim/grand/types';
import { fleetById } from '../sim/grand/world';
import { migrateGrandBalance } from '../sim/grand/economy';
import { orderDispatch, orderMobilize } from '../sim/grand/dispatch';
import { migrateGrandRegions } from '../sim/grand/migration';
import { cancelResearch, learnSkill, migrateGrandGrowth, orderResearch } from '../sim/grand/growth';
import type { ShipKind } from '../sim/types';

/**
 * The faction campaign ("캠페인"), kept apart from the linear 1592 campaign in campaign.ts. The game itself is the
 * pure state in sim/grand; this store holds the one save, writes it after every change and hands the UI the commands.
 * The state is a plain object that is cloned before each command, so a command that fails leaves the save untouched.
 */

/** Each theatre keeps its own save: the 1592 war under its original key, another theatre's beside it. */
const STORAGE_KEY = 'imjin.grand.v1';
const storageKey = (theatre: TheatreId) => (theatre === 'imjin' ? STORAGE_KEY : `imjin.grand.${theatre}.v1`);
const theatreOfSave = (g: Grand): TheatreId => g.theatre ?? 'imjin';

function valid(g: unknown, theatre: TheatreId): g is Grand {
  const c = g as Grand | null;
  if (!c || c.version !== 1 || typeof c.seed !== 'number' || !c.rng || !Array.isArray(c.fleets) || !Array.isArray(c.pending)) return false;
  if (theatreOfSave(c) !== theatre) return false;
  if (!orderOf(c).every((id) => c.regions?.[id])) return false;
  return factionsOf(c).every((f) => c.factions?.[f]);
}

function load(theatre: TheatreId): Grand | null {
  try {
    const raw = localStorage.getItem(storageKey(theatre));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    migrateGrandRegions(parsed);
    if (!valid(parsed, theatre)) return null;
    // A war saved before the historical events existed goes on without the cards it never dealt.
    parsed.events ??= { done: {}, pending: null, flags: [], mods: [] };
    migrateGrandBalance(parsed);
    // A war saved before the commanders' skills and the tech trees goes on under them (growth.ts).
    migrateGrandGrowth(parsed);
    return parsed;
  } catch {
    return null;
  }
}

function save(g: Grand | null, theatre: TheatreId = g ? theatreOfSave(g) : useGrand.getState().theatre) {
  try {
    if (g) localStorage.setItem(storageKey(theatre), JSON.stringify(g));
    else localStorage.removeItem(storageKey(theatre));
  } catch {
    // storage unavailable (private window, full quota); the campaign stays in memory
  }
}

type GrandState = {
  /** The theatre whose war the store holds (each has its own save). */
  theatre: TheatreId;
  grand: Grand | null;
  /** The meeting settled last, until the player has read it. Not saved. */
  lastBattle: BattleSummary | null;
  /** The turn whose news the player has not read yet (the turn that just ended). Not saved. */
  reported: number | null;
  /** The campaign as it stood before the turn that just closed, and what that turn did, for the map to play back. Not saved. */
  replay: { before: Grand; moves: TurnReplay } | null;
  /** Fleets sent with "merge on arrival", each with the port it sails for. Not saved: a reload forgets the wish, never a fleet. */
  arrivalMerge: Record<string, RegionId>;
};

const firstTheatre = theatreOfAddress();
export const useGrand = create<GrandState>(() => ({ theatre: firstTheatre, grand: load(firstTheatre), lastBattle: null, reported: null, replay: null, arrivalMerge: {} }));

/** Shows the war of `theatre`: its save, or none to start. Nothing changes when it is already on show. */
export function showGrandTheatre(theatre: TheatreId) {
  if (useGrand.getState().theatre === theatre) return;
  useGrand.setState({ theatre, grand: load(theatre), lastBattle: null, reported: null, replay: null, arrivalMerge: {} });
}

export const dismissBattle = () => useGrand.setState({ lastBattle: null });
export const dismissReport = () => useGrand.setState({ reported: null });
export const dismissReplay = () => useGrand.setState({ replay: null });

const GUIDE_KEY = 'imjin.grand.guide.v1';

/** Whether the first-turn guide has been shown through or dismissed. */
export function guideSeen(): boolean {
  try {
    return localStorage.getItem(GUIDE_KEY) === '1';
  } catch {
    return false;
  }
}

export function markGuideSeen() {
  try {
    localStorage.setItem(GUIDE_KEY, '1');
  } catch {
    // storage unavailable; the guide shows again next time
  }
}

/** Whether a save exists, for the "continue" button. */
export const hasGrandSave = () => useGrand.getState().grand !== null;

/** Runs a change on a copy of the campaign and keeps it only when the change succeeded. */
function commit(change: (g: Grand) => Result): Result {
  const current = useGrand.getState().grand;
  if (!current) return { ok: false, reason: '진행 중인 캠페인이 없습니다' };
  const next = structuredClone(current);
  const result = change(next);
  if (result.ok) {
    useGrand.setState({ grand: next });
    save(next);
  }
  return result;
}

/** Starts a fresh campaign as the chosen navy, replacing any save. */
export function startGrand(player: GrandFaction, difficulty: Grand['difficulty'] = 'normal', seed = Math.floor(Math.random() * 2147483647), theatre: TheatreId = useGrand.getState().theatre): Grand {
  const g = newGrand(player, seed, difficulty, 0, theatre);
  // A new war builds its camps and works by itself; the top bar's switch turns that off (saves made earlier stay as they were).
  g.autoWorks = true;
  useGrand.setState({ grand: g, lastBattle: null, reported: null, replay: null, arrivalMerge: {} });
  save(g);
  return g;
}

export function abandonGrand() {
  useGrand.setState({ grand: null, lastBattle: null, reported: null, replay: null, arrivalMerge: {} });
  save(null);
}

const notYours = { ok: false, reason: '우리 진영의 것이 아닙니다' } as const;
const ownFleet = (g: Grand, id: string) => g.fleets.find((f) => f.id === id)?.faction === g.player;
const ownRegion = (g: Grand, id: RegionId) => g.regions[id]?.owner === g.player;
/** Runs an order only when its target belongs to the player's own navy. */
const guarded = (own: (g: Grand) => boolean, change: (g: Grand) => Result) => commit((g) => (own(g) ? change(g) : notYours));

/** Orders for the faction the player commands. Each returns whether it was accepted, and why not. */
export const grandOrders = {
  dispatch: (fleetIds: string[], portIds: RegionId[], dest: RegionId) => commit((g) => g.player ? orderDispatch(g, fleetIds, portIds, dest, g.player) : notYours),
  mobilize: (region: RegionId) => guarded((g) => ownRegion(g, region), (g) => orderMobilize(g, region, g.player!)),
  move: (fleetId: string, dest: RegionId, siege = false) => guarded((g) => ownFleet(g, fleetId), (g) => orderMove(g, fleetId, dest, siege)),
  /** March rules: chase a hostile fleet into its port or along its lane. */
  intercept: (fleetId: string, targetId: string) => guarded((g) => ownFleet(g, fleetId), (g) => orderIntercept(g, fleetId, targetId)),
  /** March rules: this turn's stance, normal or the forced march. */
  stance: (fleetId: string, stance: Stance) => guarded((g) => ownFleet(g, fleetId), (g) => orderStance(g, fleetId, stance)),
  /** March rules: a blockading fleet storms the port when the turn ends, or keeps up the blockade. */
  assault: (fleetId: string, on: boolean) => guarded((g) => ownFleet(g, fleetId), (g) => orderAssault(g, fleetId, on)),
  stop: (fleetId: string) => guarded((g) => ownFleet(g, fleetId), (g) => orderStop(g, fleetId)),
  build: (region: RegionId, kind: BuildingKind) => guarded((g) => ownRegion(g, region), (g) => orderBuild(g, region, kind)),
  cancelBuild: (region: RegionId, kind: BuildingKind) => guarded((g) => ownRegion(g, region), (g) => cancelBuild(g, region, kind)),
  recruit: (region: RegionId, kind: ShipKind) => guarded((g) => ownRegion(g, region), (g) => orderRecruit(g, region, kind)),
  cancelRecruit: (region: RegionId, itemId: string) => guarded((g) => ownRegion(g, region), (g) => cancelRecruit(g, region, itemId)),
  merge: (keepId: string, otherId: string) => guarded((g) => ownFleet(g, keepId) && ownFleet(g, otherId), (g) => orderMerge(g, keepId, otherId)),
  split: (fleetId: string, shipIds: string[]) => guarded((g) => ownFleet(g, fleetId), (g) => orderSplit(g, fleetId, shipIds)),
  commander: (fleetId: string, commanderId: string | null) => guarded((g) => ownFleet(g, fleetId), (g) => orderCommander(g, fleetId, commanderId)),
  refit: (fleetId: string) => guarded((g) => ownFleet(g, fleetId), (g) => orderRefit(g, fleetId)),
  disband: (fleetId: string, shipId: string) => guarded((g) => ownFleet(g, fleetId), (g) => orderDisband(g, fleetId, shipId)),
  declareWar: (a: GrandFaction, b: GrandFaction) => guarded((g) => a === g.player, (g) => orderDeclareWar(g, a, b)),
  alliance: (a: GrandFaction, b: GrandFaction) => guarded((g) => a === g.player, (g) => orderAlliance(g, a, b)),
  /** Switches the player's automatic building on or off; saved with the war. */
  autoWorks: (on: boolean) => commit((g) => { g.autoWorks = on; return ok(); }),
  /** Growth rules: one of the player's commanders spends a point on a skill of his tree. */
  learn: (commanderId: string, skillId: string) => commit((g) => (g.player ? learnSkill(g, g.player, commanderId, skillId) : notYours)),
  /** Growth rules: the navy starts a research, or stops the one on the way and gets its silver back. */
  research: (techId: string) => commit((g) => (g.player ? orderResearch(g, g.player, techId) : notYours)),
  cancelResearch: () => commit((g) => (g.player ? cancelResearch(g, g.player) : notYours)),
};

/** A fleet that can join another now: docked in a port and done refitting (a merge hands the larger rest to the survivor). */
const mergeable = (f: Fleet) => !!f.at && !f.transit && f.rest === 0;

/**
 * Merges every group of two or more mergeable fleets that lie in the same port, each into its largest fleet. Returns how
 * many fleets were absorbed, and the reason the sim gave when a merge stopped (the size cap).
 */
function mergeGroups(g: Grand, fleets: readonly Fleet[]): { merged: number; blocked?: Extract<Result, { ok: false }> } {
  const byPort = new Map<string, Fleet[]>();
  for (const f of fleets) if (mergeable(f)) byPort.set(f.at!, [...(byPort.get(f.at!) ?? []), f]);
  let merged = 0;
  let blocked: Extract<Result, { ok: false }> | undefined;
  for (const group of byPort.values()) {
    const [keep, ...rest] = [...group].sort((a, b) => b.ships.length - a.ships.length);
    for (const other of rest) {
      const res = orderMerge(g, keep.id, other.id);
      if (res.ok) merged += 1;
      else blocked = res;
    }
  }
  return { merged, blocked };
}

/** "모두 합류": the given own fleets that share a port become one fleet per port. */
export const mergeFleets = (fleetIds: readonly string[]): Result =>
  commit((g) => {
    const fleets = [...new Set(fleetIds)].map((id) => fleetById(g, id));
    if (fleets.some((f) => !f || f.faction !== g.player)) return notYours;
    const { merged, blocked } = mergeGroups(g, fleets as Fleet[]);
    if (merged) return ok('함대 {n}개를 합쳤습니다', { n: merged });
    return blocked ?? fail('같은 포구에 정비를 마친 함대가 둘 이상 필요합니다');
  });

/**
 * Sends the selected fleets and garrisons to one region. With `mergeOnArrival` the fleets are remembered so that
 * mergeArrived joins them once they lie together in that port; the saved campaign is not involved.
 */
export function dispatchForces(fleetIds: string[], portIds: RegionId[], dest: RegionId, mergeOnArrival: boolean): Result {
  const known = new Set(useGrand.getState().grand?.fleets.map((f) => f.id));
  const res = grandOrders.dispatch(fleetIds, portIds, dest);
  if (!res.ok) return res;
  // A garrison that sails becomes a new fleet; its id exists only now.
  const sailed = useGrand.getState().grand?.fleets.filter((f) => !known.has(f.id)).map((f) => f.id) ?? [];
  useGrand.setState((s) => {
    const marks = { ...s.arrivalMerge };
    for (const id of [...fleetIds, ...sailed]) {
      if (mergeOnArrival) marks[id] = dest;
      else delete marks[id];
    }
    return { arrivalMerge: marks };
  });
  return res;
}

/**
 * Joins the fleets sent with "merge on arrival" that now lie together in their destination. A mark stays while a fleet of
 * its group is still sailing or refitting, and goes once the group is gathered or gone. Returns the number absorbed.
 */
export function mergeArrived(): number {
  const { grand: current, arrivalMerge } = useGrand.getState();
  if (!current || current.phase !== 'orders' || !Object.keys(arrivalMerge).length) return 0;
  const next = structuredClone(current);
  const marks = { ...arrivalMerge };
  let merged = 0;
  const here = (f: Fleet, dest: string) => f.at === dest && !f.transit && !f.route.length;
  for (const dest of new Set(Object.values(marks))) {
    const ids = Object.keys(marks).filter((id) => marks[id] === dest);
    merged += mergeGroups(next, ids.flatMap((id) => fleetById(next, id) ?? []).filter((f) => here(f, dest))).merged;
    const left = ids.flatMap((id) => fleetById(next, id) ?? []);
    // Everyone of the group is in port and refitted (or gone): the wish is spent.
    if (left.every((f) => here(f, dest) && f.rest === 0)) for (const id of ids) delete marks[id];
  }
  if (merged) {
    useGrand.setState({ grand: next, arrivalMerge: marks });
    save(next);
  } else if (Object.keys(marks).length !== Object.keys(arrivalMerge).length) useGrand.setState({ arrivalMerge: marks });
  return merged;
}

/**
 * Ends the player's turn. The computer navies move, fleets sail, and every meeting that involves another navy is
 * settled. The returned report lists the player's meetings still waiting; the UI offers each one as a battle to
 * play (prepareGrandBattle) or to auto-resolve (autoResolveGrand).
 */
export function endGrandTurn(): TurnReport | null {
  const current = useGrand.getState().grand;
  // A card of the war's history has to be answered before the turn can close.
  if (!current || current.phase !== 'orders' || current.events.pending) return null;
  const next = structuredClone(current);
  const report = endTurn(next);
  const moves = buildReplay(current, next, report.contacts, current.player ?? factionsOf(current)[0]!, report.routes);
  useGrand.setState({ grand: next, reported: current.turn, replay: isEmpty(moves) ? null : { before: current, moves } });
  save(next);
  return report;
}

/** The player's answer to the historical event that waits (0 or 1). */
export const chooseGrandEvent = (index: number): Result => commit((g) => chooseEvent(g, index));

/** March rules: a waiting assault on a port becomes a blockade of it instead. */
export const besiegeGrand = (contactId: string): Result => commit((g) => (g.player ? besiegeContact(g, contactId, g.player) : notYours));

/** March rules: the player's fleets in a waiting fight withdraw from it before it is fought. */
export const withdrawGrand = (contactId: string): Result => commit((g) => (g.player ? withdrawContact(g, contactId, g.player) : notYours));

/** Settles a waiting meeting by arithmetic. */
export function autoResolveGrand(contactId: string): ResolveResult | null {
  const current = useGrand.getState().grand;
  if (!current) return null;
  const next = structuredClone(current);
  const result = autoResolveContact(next, contactId);
  if (!result) return null;
  useGrand.setState({ grand: next, lastBattle: summarizeBattle(current, contactId, result.outcome, false) });
  save(next);
  return result;
}

/** The ship names and the officer a battle shows, in the language set when the battle starts. */
function localSeat(seat: BridgeSeat): BridgeSeat {
  const named = (list: BridgeSeat['ships']) => list.map((ship) => ({ ...ship, name: tName(ship.name) }));
  return { ...seat, ships: named(seat.ships), reserve: named(seat.reserve), leader: seat.leader && { ...seat.leader, name: t(seat.leader.name), title: t(seat.leader.title) } };
}

/** The description the Engine plays a waiting meeting from. Does not change the campaign. */
export function prepareGrandBattle(contactId: string): RegionBattle | null {
  const current = useGrand.getState().grand;
  const battle = current ? describeBattle(current, contactId) : null;
  return battle && { ...battle, attacker: localSeat(battle.attacker), defender: localSeat(battle.defender) };
}

/** Takes the outcome of a played battle into the campaign. False when the meeting was already settled. */
export function finishGrandBattle(battle: RegionBattle, outcome: BattleOutcome): boolean {
  const current = useGrand.getState().grand;
  if (!current) return false;
  const next = structuredClone(current);
  const lastBattle = summarizeBattle(current, battle.contactId, outcome, true);
  const applied = applyBattleResult(next, battle, outcome);
  if (!applied) return false;
  useGrand.setState({ grand: next, lastBattle });
  save(next);
  return true;
}
