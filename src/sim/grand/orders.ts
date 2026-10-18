import { SHIP_SPECS } from '../catalog';
import type { ShipKind } from '../types';
import { BUILDING_DEFS, BUILDING_ORDER, TUNING, navyName, buildingCost, buildingWorkTotal, buildingOf, freeSlots, kindsOf, levelOf, queueSlots, shipDef, yardPrice, recruitRefund, GATES } from './economy';
import type { BuildingKind, Fleet, Grand, GrandFaction, RegionId, Result, ShipUnit, Stance } from './types';
import { MAX_LEVEL, fail, ok, pairKey } from './types';
import { allied, atWar, fleetById, findRoute, mintId, note, passable } from './world';
import { laneKm, marchDistances, marchRoute, marching, transitShare, turnsFor } from './march';

/**
 * Everything a commander can order, for the player and the computer alike. An order that is allowed takes effect now:
 * gold is paid when a work or a ship is ordered, and a fleet's route is set at once. Turns only tick in endTurn.
 */

const noOrders = (g: Grand): Result | null => (g.phase !== 'orders' ? fail('지금은 명령을 내릴 수 없습니다') : null);

/**
 * Sends a fleet to `dest`. Under the march rules a fleet at sea may be sent on or turned back, and `siege` makes a fleet
 * bound for a hostile port blockade it on arrival instead of storming it.
 */
export function orderMove(g: Grand, fleetId: string, dest: RegionId, siege = false): Result {
  const bad = noOrders(g);
  if (bad) return bad;
  const fl = fleetById(g, fleetId);
  if (!fl) return fail('해당 함대가 없습니다');
  if (marching(g)) return marchOrder(g, fl, dest, siege);
  if (fl.transit) return fail('항해 중인 함대는 항로를 바꿀 수 없습니다');
  if (fl.rest > 0) return fail('전투 후 정비 중입니다');
  if (!fl.at) return fail('함대가 항해 중입니다');
  if (fl.at === dest) {
    fl.route = [];
    return ok('제자리에 머뭅니다');
  }
  const route = findRoute(g, fl.faction, fl.at, dest);
  if (!route) return fail('그곳으로 가는 안전한 항로가 없습니다');
  fl.route = route.path;
  return ok('{turns}턴', { turns: route.turns });
}

function marchOrder(g: Grand, fl: Fleet, dest: RegionId, siege: boolean): Result {
  if (fl.rest > 0) return fail('전투 후 정비 중입니다');
  if (fl.at === dest) {
    fl.route = [];
    return ok('제자리에 머뭅니다');
  }
  const route = marchRoute(g, fl, dest);
  if (!route) return fail('그곳으로 가는 안전한 항로가 없습니다');
  const hostile = !passable(g, fl.faction, dest);
  if (hostile && fl.stance === 'march') return fail('강행군 중에는 공격할 수 없습니다');
  fl.route = route.path;
  fl.besieging = hostile && siege;
  fl.assault = false;
  return ok('{turns}턴', { turns: route.turns });
}

/**
 * Sends a fleet after a hostile fleet (march rules): into the port where it lies, or along the lane it is sailing so the
 * way runs through it and the two meet where they close.
 */
export function orderIntercept(g: Grand, fleetId: string, targetId: string): Result {
  const bad = noOrders(g);
  if (bad) return bad;
  const fl = fleetById(g, fleetId);
  const target = fleetById(g, targetId);
  if (!fl || !target) return fail('해당 함대가 없습니다');
  if (!marching(g)) return fail('이 캠페인에서는 쓸 수 없는 명령입니다');
  if (!atWar(g, fl.faction, target.faction)) return fail('적 함대가 아닙니다');
  if (fl.rest > 0) return fail('전투 후 정비 중입니다');
  if (fl.stance === 'march') return fail('강행군 중에는 공격할 수 없습니다');
  if (target.at) return marchOrder(g, fl, target.at, false);
  const t = target.transit;
  if (!t) return fail('해당 함대가 없습니다');
  const km = laneKm(g, t.from, t.to);
  const theirs = transitShare(g, t) * km;
  let path: RegionId[];
  let distance: number;
  const mine = fl.transit;
  if (mine && ((mine.from === t.from && mine.to === t.to) || (mine.from === t.to && mine.to === t.from))) {
    // Already on its lane: head for the end that lies beyond it.
    const ours = mine.from === t.from ? transitShare(g, mine) * km : km - transitShare(g, mine) * km;
    path = [theirs >= ours ? t.to : t.from];
    distance = Math.abs(theirs - ours);
  } else {
    const { dist } = marchDistances(g, fl);
    const [near, far] = (dist.get(t.from) ?? Infinity) <= (dist.get(t.to) ?? Infinity) ? [t.from, t.to] : [t.to, t.from];
    const toNear = marchRoute(g, fl, near);
    if (!toNear || !passable(g, fl.faction, near)) return fail('그곳으로 가는 안전한 항로가 없습니다');
    path = [...toNear.path, far];
    distance = toNear.km + (near === t.from ? theirs : km - theirs);
  }
  fl.route = path;
  fl.besieging = false;
  fl.assault = false;
  return ok('{turns}턴', { turns: turnsFor(g, fl, distance) });
}

/** The fleet's stance for this turn (march rules): the forced march sails half again as far but cannot attack. */
export function orderStance(g: Grand, fleetId: string, stance: Stance): Result {
  const bad = noOrders(g);
  if (bad) return bad;
  const fl = fleetById(g, fleetId);
  if (!fl) return fail('해당 함대가 없습니다');
  if (!marching(g)) return fail('이 캠페인에서는 쓸 수 없는 명령입니다');
  if (stance === 'march') {
    const dest = fl.route[fl.route.length - 1];
    if (fl.at && !passable(g, fl.faction, fl.at)) return fail('적의 포구 앞에서는 강행군할 수 없습니다');
    if (dest && !passable(g, fl.faction, dest)) return fail('강행군 중에는 공격할 수 없습니다');
  }
  if (stance === 'normal') delete fl.stance;
  else fl.stance = stance;
  return ok();
}

/** A fleet blockading a port storms it when the turn ends (or, with `on` false, keeps up the blockade). */
export function orderAssault(g: Grand, fleetId: string, on = true): Result {
  const bad = noOrders(g);
  if (bad) return bad;
  const fl = fleetById(g, fleetId);
  if (!fl || !fl.at || !fl.besieging || passable(g, fl.faction, fl.at)) return fail('봉쇄 중인 함대가 아닙니다');
  if (on) fl.assault = true;
  else delete fl.assault;
  return ok();
}

export function orderStop(g: Grand, fleetId: string): Result {
  const bad = noOrders(g);
  if (bad) return bad;
  const fl = fleetById(g, fleetId);
  if (!fl) return fail('해당 함대가 없습니다');
  fl.route = [];
  return ok();
}

/** Requirements for raising a work to `level`: a camp must stand first for the better ones. */
export function buildRequirement(g: Grand, id: RegionId, kind: BuildingKind, level: number): string | null {
  const r = g.regions[id];
  const camp = levelOf(r, 'camp');
  if (kind !== 'camp' && level >= 3 && camp < 2) return '군영 2단계가 필요합니다';
  if ((kind === 'shipyard' || kind === 'battery' || kind === 'dock') && level >= 2 && camp < 1) return '군영이 필요합니다';
  return null;
}

export function orderBuild(g: Grand, id: RegionId, kind: BuildingKind): Result {
  const bad = noOrders(g);
  if (bad) return bad;
  const r = g.regions[id];
  const owner = r.owner;
  if (!owner) return fail('주인이 없는 포구입니다');
  const have = buildingOf(r, kind);
  if (have && have.upgradeLeft > 0) return fail('이미 공사 중입니다');
  const level = (have?.level ?? 0) + 1;
  if (level > MAX_LEVEL) return fail('이미 최고 단계입니다');
  if (!have && freeSlots(id, r) <= 0) return fail('빈 부지가 없습니다');
  const need = buildRequirement(g, id, kind, level);
  if (need) return fail(need);
  const cost = buildingCost(kind, level);
  const f = g.factions[owner];
  if (f.gold < cost.gold) return fail('은이 부족합니다 ({gold}냥 필요)', { gold: cost.gold });
  f.gold -= cost.gold;
  if (have) have.upgradeTotal = have.upgradeLeft = cost.turns;
  else r.buildings.push({ kind, level: 0, upgradeLeft: cost.turns, upgradeTotal: cost.turns, hp: 1 });
  return ok('{work} {level}단계 · {turns}턴', { work: BUILDING_DEFS[kind].label, level, turns: cost.turns });
}

/** A work that has not yet had a turn of labor can be called off with the whole price refunded. */
export function cancelBuild(g: Grand, id: RegionId, kind: BuildingKind): Result {
  const bad = noOrders(g);
  if (bad) return bad;
  const r = g.regions[id];
  const b = buildingOf(r, kind);
  if (!b || !r.owner || b.upgradeLeft <= 0) return fail('취소할 공사가 없습니다');
  const cost = buildingCost(kind, b.level + 1);
  if (b.upgradeLeft !== buildingWorkTotal(b)) return fail('이미 시작된 공사입니다');
  g.factions[r.owner].gold += cost.gold;
  if (b.level === 0) r.buildings.splice(r.buildings.indexOf(b), 1);
  else b.upgradeTotal = b.upgradeLeft = 0;
  return ok();
}

/** The reasons a better shipyard is needed, one per level, so each reads as a whole sentence in either language. */
const YARD_NEEDED: Record<number, string> = { 2: '선소 2단계가 필요합니다', 3: '선소 3단계가 필요합니다' };

/** Why a navy cannot yet build a ship here, or null. */
export function recruitProblem(g: Grand, id: RegionId, kind: ShipKind): string | null {
  const r = g.regions[id];
  const owner = r.owner;
  if (!owner) return '주인이 없는 포구입니다';
  if (SHIP_SPECS[kind].faction !== owner) return '이 진영의 함선이 아닙니다';
  const yard = levelOf(r, 'shipyard');
  if (yard < 1) return '선소가 없습니다';
  const gate = GATES[kind];
  if (gate) {
    if (yard < gate.yard) return YARD_NEEDED[gate.yard] ?? '선소 단계가 부족합니다';
    if (gate.unlock && !g.factions[owner].unlocked.includes(kind)) return '아직 설계되지 않았습니다';
  }
  return null;
}

export function orderRecruit(g: Grand, id: RegionId, kind: ShipKind): Result {
  const bad = noOrders(g);
  if (bad) return bad;
  const problem = recruitProblem(g, id, kind);
  if (problem) return fail(problem);
  const r = g.regions[id];
  const owner = r.owner!;
  if (r.queue.length >= queueSlots(r)) return fail('건조 칸이 모두 찼습니다');
  const price = yardPrice(kind, levelOf(r, 'shipyard'));
  if (g.factions[owner].gold < price) return fail('은이 부족합니다 ({gold}냥 필요)', { gold: price });
  g.factions[owner].gold -= price;
  const turns = shipDef(kind).turns;
  r.queue.push({ id: mintId(g, 'q'), kind, left: turns, total: turns, paidGold: price });
  return ok('{ship} · {turns}턴', { ship: SHIP_SPECS[kind].label, turns });
}

export function cancelRecruit(g: Grand, id: RegionId, itemId: string): Result {
  const bad = noOrders(g);
  if (bad) return bad;
  const r = g.regions[id];
  const item = r.queue.find((q) => q.id === itemId);
  if (!item || !r.owner) return fail('해당 주문이 없습니다');
  if (item.left !== item.total) return fail('이미 건조가 시작되었습니다');
  g.factions[r.owner].gold += recruitRefund(g, item, levelOf(r, 'shipyard'));
  r.queue.splice(r.queue.indexOf(item), 1);
  return ok();
}

export function orderMerge(g: Grand, keepId: string, otherId: string): Result {
  const bad = noOrders(g);
  if (bad) return bad;
  const a = fleetById(g, keepId);
  const b = fleetById(g, otherId);
  if (!a || !b || a === b) return fail('합칠 수 없습니다');
  if (a.faction !== b.faction || !a.at || a.at !== b.at) return fail('같은 포구의 함대끼리만 합칠 수 있습니다');
  if (a.ships.length + b.ships.length > TUNING.fleetCap) return fail('한 함대는 최대 {n}척입니다', { n: TUNING.fleetCap });
  a.ships.push(...b.ships);
  a.rest = Math.max(a.rest, b.rest);
  // March rules: merged blockaders keep up the blockade (and an order to storm), and the stance is kept only if both share it.
  if (b.besieging) a.besieging = true;
  if (b.assault) a.assault = true;
  if (a.stance !== b.stance) delete a.stance;
  if (!a.commanderId) a.commanderId = b.commanderId;
  g.fleets.splice(g.fleets.indexOf(b), 1);
  a.route = [];
  return ok();
}

export function orderSplit(g: Grand, fleetId: string, shipIds: string[]): Result {
  const bad = noOrders(g);
  if (bad) return bad;
  const fl = fleetById(g, fleetId);
  if (!fl || !fl.at) return fail('나눌 수 없습니다');
  const take = fl.ships.filter((s) => shipIds.includes(s.id));
  if (!take.length) return fail('나눌 함선을 먼저 선택해야 합니다');
  if (take.length >= fl.ships.length) return fail('함선을 전부 나눌 수는 없습니다');
  fl.ships = fl.ships.filter((s) => !shipIds.includes(s.id));
  const next: Fleet = { id: mintId(g, 'f'), faction: fl.faction, name: `${fl.name} 분견 함대`, commanderId: null, ships: take, at: fl.at, transit: null, route: [], from: fl.from, rest: fl.rest }; // i18n-ignore: detachment name; the UI translates the pattern
  // A detachment of a blockading fleet keeps up the blockade (and its order to storm) instead of turning it into an assault.
  if (fl.besieging) next.besieging = true;
  if (fl.assault) next.assault = true;
  if (fl.stance) next.stance = fl.stance;
  g.fleets.push(next);
  return ok(next.id);
}

/** A commander the court has stripped of command (flag set by an event, cleared when he is restored). */
export function commanderSuspended(g: Grand, commanderId: string): boolean {
  return g.events.flags.includes(`suspended:${commanderId}`);
}

export function orderCommander(g: Grand, fleetId: string, commanderId: string | null): Result {
  const bad = noOrders(g);
  if (bad) return bad;
  const fl = fleetById(g, fleetId);
  if (!fl) return fail('해당 함대가 없습니다');
  if (commanderId) {
    const c = g.factions[fl.faction].commanders.find((x) => x.id === commanderId);
    if (!c || !c.alive) return fail('해당 지휘관이 없습니다');
    if (commanderSuspended(g, commanderId)) return fail('조정의 명으로 지휘권을 잃었습니다');
    // A leader changes ship only in port, and only from a fleet in the same port (or from none).
    if (!fl.at) return fail('항해 중에는 지휘관을 임명할 수 없습니다');
    const from = g.fleets.find((x) => x.commanderId === commanderId);
    if (from && from.id !== fl.id && from.at !== fl.at) return fail('지휘관이 다른 포구에 있습니다');
    for (const other of g.fleets) if (other.commanderId === commanderId) other.commanderId = null;
  }
  fl.commanderId = commanderId;
  return ok();
}

/** Pays to bring a fleet in port back to full hull and crew at once. */
export function refitCost(fl: Fleet): number {
  let gold = 0;
  for (const u of fl.ships) gold += shipDef(u.kind).gold * ((1 - u.hull) * 0.28 + (1 - u.crew) * 0.12);
  return Math.round(gold);
}

export function orderRefit(g: Grand, fleetId: string): Result {
  const bad = noOrders(g);
  if (bad) return bad;
  const fl = fleetById(g, fleetId);
  if (!fl || !fl.at) return fail('해당 함대가 없습니다');
  const r = g.regions[fl.at];
  if (!r.owner || !allied(g, fl.faction, r.owner)) return fail('아군 포구에서만 정비할 수 있습니다');
  if (levelOf(r, 'camp') < 1 && levelOf(r, 'dock') < 1) return fail('군영이나 수리소가 필요합니다');
  const cost = refitCost(fl);
  if (cost <= 0) return fail('손상된 곳이 없습니다');
  const f = g.factions[fl.faction];
  if (f.gold < cost) return fail('은이 부족합니다 ({gold}냥 필요)', { gold: cost });
  f.gold -= cost;
  for (const u of fl.ships) {
    u.hull = 1;
    u.crew = 1;
    u.supply = 1;
  }
  return ok();
}

export function orderDisband(g: Grand, fleetId: string, shipId: string): Result {
  const bad = noOrders(g);
  if (bad) return bad;
  const fl = fleetById(g, fleetId);
  const idx = fl ? fl.ships.findIndex((s) => s.id === shipId) : -1;
  if (!fl || idx < 0) return fail('해당 함선이 없습니다');
  const [u] = fl.ships.splice(idx, 1) as [ShipUnit];
  g.factions[fl.faction].gold += Math.round(shipDef(u.kind).gold * 0.2);
  if (!fl.ships.length) g.fleets.splice(g.fleets.indexOf(fl), 1);
  return ok();
}

/** Breaking an alliance puts the two navies at war from the next resolution. */
export function orderDeclareWar(g: Grand, a: GrandFaction, b: GrandFaction): Result {
  const bad = noOrders(g);
  if (bad) return bad;
  if (a === b || atWar(g, a, b)) return fail('이미 적대 관계입니다');
  g.relations[pairKey(a, b)] = 'war';
  note(g, '{a|이/가} {b|과/와}의 동맹을 파기했습니다', { a: navyName(a), b: navyName(b) }, 'bad');
  return ok();
}

export function orderAlliance(g: Grand, a: GrandFaction, b: GrandFaction): Result {
  const bad = noOrders(g);
  if (bad) return bad;
  if (a === b || allied(g, a, b)) return fail('이미 동맹 관계입니다');
  // The invaders accept no treaty: only the two defenders of Joseon may ally.
  if (a === 'japan' || b === 'japan') return fail('일본은 동맹을 맺지 않습니다');
  // 1805: Britain stood alone against Napoleon's France and its Spanish ally; no peace or alliance came before 1808.
  if ((a === 'britain' || b === 'britain') && (a === 'france' || b === 'france' || a === 'spain1805' || b === 'spain1805')) return fail('영국은 프랑스·에스파냐와 동맹을 맺지 않습니다');
  g.relations[pairKey(a, b)] = 'allied';
  note(g, '{a|과/와} {b|이/가} 동맹을 맺었습니다', { a: navyName(a), b: navyName(b) }, 'good');
  return ok();
}

/** Ships the owner of a port may order built there right now, with prices. */
export function recruitMenu(g: Grand, id: RegionId): { kind: ShipKind; gold: number; turns: number; problem: string | null }[] {
  const owner = g.regions[id].owner;
  if (!owner) return [];
  const yard = Math.max(1, levelOf(g.regions[id], 'shipyard'));
  return kindsOf(owner).map((kind) => ({ kind, gold: yardPrice(kind, yard), turns: shipDef(kind).turns, problem: recruitProblem(g, id, kind) }));
}

export type BuildOption = { kind: BuildingKind; level: number; next: number; gold: number; turns: number; building: boolean; problem: string | null };

/** The works a port can start or raise now, for the build panel: next level, price, turns and what stops it. */
export function buildMenu(g: Grand, id: RegionId): BuildOption[] {
  const r = g.regions[id];
  if (!r.owner) return [];
  return BUILDING_ORDER.map((kind) => {
    const have = buildingOf(r, kind);
    const next = (have?.level ?? 0) + 1;
    const cost = buildingCost(kind, Math.min(next, MAX_LEVEL));
    let problem: string | null = null;
    if (have && have.upgradeLeft > 0) problem = '공사 중';
    else if (next > MAX_LEVEL) problem = '최고 단계';
    else if (!have && freeSlots(id, r) <= 0) problem = '빈 부지가 없습니다';
    else problem = buildRequirement(g, id, kind, next);
    if (!problem && g.factions[r.owner!].gold < cost.gold) problem = '은이 부족합니다';
    return { kind, level: have?.level ?? 0, next, gold: cost.gold, turns: cost.turns, building: !!have && have.upgradeLeft > 0, problem };
  });
}
