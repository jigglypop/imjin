import { create } from 'zustand';
import { chooseEvent } from '../sim/grand/events';
import { buildReplay, isEmpty, type TurnReplay } from '../sim/grand/replay';
import type { ResolveResult } from '../sim/grand/autoresolve';
import { applyBattleResult, describeBattle, type RegionBattle } from '../sim/grand/bridge';
import { summarizeBattle, type BattleSummary } from '../sim/grand/report';
import { cancelBuild, cancelRecruit, orderAlliance, orderBuild, orderCommander, orderDeclareWar, orderDisband, orderMerge, orderMove, orderRecruit, orderRefit, orderSplit, orderStop } from '../sim/grand/orders';
import { REGION_ORDER } from '../sim/grand/regions';
import { autoResolveContact, endTurn, newGrand, type TurnReport } from '../sim/grand/turn';
import type { BattleOutcome, BuildingKind, Grand, GrandFaction, RegionId, Result } from '../sim/grand/types';
import { GRAND_FACTIONS } from '../sim/grand/types';
import type { ShipKind } from '../sim/types';

/**
 * The faction campaign ("진영 전역"), kept apart from the linear 1592 campaign in campaign.ts. The game itself is the
 * pure state in sim/grand; this store holds the one save, writes it after every change and hands the UI the commands.
 * The state is a plain object that is cloned before each command, so a command that fails leaves the save untouched.
 */

const STORAGE_KEY = 'imjin.grand.v1';

function valid(g: unknown): g is Grand {
  const c = g as Grand | null;
  if (!c || c.version !== 1 || typeof c.seed !== 'number' || !c.rng || !Array.isArray(c.fleets) || !Array.isArray(c.pending)) return false;
  if (!REGION_ORDER.every((id) => c.regions?.[id])) return false;
  return GRAND_FACTIONS.every((f) => c.factions?.[f]);
}

function load(): Grand | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!valid(parsed)) return null;
    // A war saved before the historical events existed goes on without the cards it never dealt.
    parsed.events ??= { done: {}, pending: null, flags: [], mods: [] };
    return parsed;
  } catch {
    return null;
  }
}

function save(g: Grand | null) {
  try {
    if (g) localStorage.setItem(STORAGE_KEY, JSON.stringify(g));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // storage unavailable (private window, full quota); the campaign stays in memory
  }
}

type GrandState = {
  grand: Grand | null;
  /** The meeting settled last, until the player has read it. Not saved. */
  lastBattle: BattleSummary | null;
  /** The turn whose news the player has not read yet (the turn that just ended). Not saved. */
  reported: number | null;
  /** The campaign as it stood before the turn that just closed, and what that turn did, for the map to play back. Not saved. */
  replay: { before: Grand; moves: TurnReplay } | null;
};

export const useGrand = create<GrandState>(() => ({ grand: load(), lastBattle: null, reported: null, replay: null }));

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
  if (!current) return { ok: false, reason: '진행 중인 전역이 없습니다' };
  const next = structuredClone(current);
  const result = change(next);
  if (result.ok) {
    useGrand.setState({ grand: next });
    save(next);
  }
  return result;
}

/** Starts a fresh campaign as the chosen navy, replacing any save. */
export function startGrand(player: GrandFaction, difficulty: Grand['difficulty'] = 'normal', seed = Math.floor(Math.random() * 2147483647)): Grand {
  const g = newGrand(player, seed, difficulty);
  useGrand.setState({ grand: g, lastBattle: null, reported: null, replay: null });
  save(g);
  return g;
}

export function abandonGrand() {
  useGrand.setState({ grand: null, lastBattle: null, reported: null, replay: null });
  save(null);
}

const notYours = { ok: false, reason: '우리 진영의 것이 아닙니다' } as const;
const ownFleet = (g: Grand, id: string) => g.fleets.find((f) => f.id === id)?.faction === g.player;
const ownRegion = (g: Grand, id: RegionId) => g.regions[id]?.owner === g.player;
/** Runs an order only when its target belongs to the player's own navy. */
const guarded = (own: (g: Grand) => boolean, change: (g: Grand) => Result) => commit((g) => (own(g) ? change(g) : notYours));

/** Orders for the faction the player commands. Each returns whether it was accepted, and why not. */
export const grandOrders = {
  move: (fleetId: string, dest: RegionId) => guarded((g) => ownFleet(g, fleetId), (g) => orderMove(g, fleetId, dest)),
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
};

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
  const moves = buildReplay(current, next, report.contacts, current.player ?? 'joseon');
  useGrand.setState({ grand: next, reported: current.turn, replay: isEmpty(moves) ? null : { before: current, moves } });
  save(next);
  return report;
}

/** The player's answer to the historical event that waits (0 or 1). */
export const chooseGrandEvent = (index: number): Result => commit((g) => chooseEvent(g, index));

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

/** The description the Engine plays a waiting meeting from. Does not change the campaign. */
export function prepareGrandBattle(contactId: string): RegionBattle | null {
  const current = useGrand.getState().grand;
  return current ? describeBattle(current, contactId) : null;
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
