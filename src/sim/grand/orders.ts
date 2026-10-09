import { SHIP_SPECS } from '../catalog';
import type { ShipKind } from '../types';
import { BUILDING_DEFS, BUILDING_ORDER, TUNING, navyName, buildingCost, buildingOf, freeSlots, kindsOf, levelOf, queueSlots, shipDef, yardPrice, GATES } from './economy';
import type { BuildingKind, Fleet, Grand, GrandFaction, RegionId, Result, ShipUnit } from './types';
import { MAX_LEVEL, fail, ok, pairKey } from './types';
import { allied, atWar, fleetById, findRoute, mintId, note } from './world';
import { josa } from './josa';

/**
 * Everything a commander can order, for the player and the computer alike. An order that is allowed takes effect now:
 * gold is paid when a work or a ship is ordered, and a fleet's route is set at once. Turns only tick in endTurn.
 */

const noOrders = (g: Grand): Result | null => (g.phase !== 'orders' ? fail('지금은 명령을 내릴 수 없습니다') : null);

export function orderMove(g: Grand, fleetId: string, dest: RegionId): Result {
  const bad = noOrders(g);
  if (bad) return bad;
  const fl = fleetById(g, fleetId);
  if (!fl) return fail('해당 함대가 없습니다');
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
  return ok(`${route.turns}턴`);
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
  if (f.gold < cost.gold) return fail(`은이 부족합니다 (${cost.gold}냥 필요)`);
  f.gold -= cost.gold;
  if (have) have.upgradeLeft = cost.turns;
  else r.buildings.push({ kind, level: 0, upgradeLeft: cost.turns, hp: 1 });
  return ok(`${BUILDING_DEFS[kind].label} ${level}단계 · ${cost.turns}턴`);
}

/** A work that has not yet had a turn of labor can be called off with the whole price refunded. */
export function cancelBuild(g: Grand, id: RegionId, kind: BuildingKind): Result {
  const bad = noOrders(g);
  if (bad) return bad;
  const r = g.regions[id];
  const b = buildingOf(r, kind);
  if (!b || !r.owner || b.upgradeLeft <= 0) return fail('취소할 공사가 없습니다');
  const cost = buildingCost(kind, b.level + 1);
  if (b.upgradeLeft !== cost.turns) return fail('이미 시작된 공사입니다');
  g.factions[r.owner].gold += cost.gold;
  if (b.level === 0) r.buildings.splice(r.buildings.indexOf(b), 1);
  else b.upgradeLeft = 0;
  return ok();
}

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
    if (yard < gate.yard) return `선소 ${gate.yard}단계가 필요합니다`;
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
  if (g.factions[owner].gold < price) return fail(`은이 부족합니다 (${price}냥 필요)`);
  g.factions[owner].gold -= price;
  const turns = shipDef(kind).turns;
  r.queue.push({ id: mintId(g, 'q'), kind, left: turns, total: turns });
  return ok(`${SHIP_SPECS[kind].label} · ${turns}턴`);
}

export function cancelRecruit(g: Grand, id: RegionId, itemId: string): Result {
  const bad = noOrders(g);
  if (bad) return bad;
  const r = g.regions[id];
  const item = r.queue.find((q) => q.id === itemId);
  if (!item || !r.owner) return fail('해당 주문이 없습니다');
  if (item.left !== item.total) return fail('이미 건조가 시작되었습니다');
  g.factions[r.owner].gold += yardPrice(item.kind, levelOf(r, 'shipyard'));
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
  if (a.ships.length + b.ships.length > TUNING.fleetCap) return fail(`한 함대는 최대 ${TUNING.fleetCap}척입니다`);
  a.ships.push(...b.ships);
  a.rest = Math.max(a.rest, b.rest);
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
  if (!take.length) return fail('나눌 함선을 선택하세요');
  if (take.length >= fl.ships.length) return fail('함선을 전부 나눌 수는 없습니다');
  fl.ships = fl.ships.filter((s) => !shipIds.includes(s.id));
  const next: Fleet = { id: mintId(g, 'f'), faction: fl.faction, name: `${fl.name} 분견대`, commanderId: null, ships: take, at: fl.at, transit: null, route: [], from: fl.from, rest: fl.rest };
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
  if (f.gold < cost) return fail(`은이 부족합니다 (${cost}냥 필요)`);
  f.gold -= cost;
  for (const u of fl.ships) {
    u.hull = 1;
    u.crew = 1;
    u.supply = 1;
  }
  return ok(`${cost}`);
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
  note(g, `${josa(navyName(a), '이/가')} ${josa(navyName(b), '과/와')}의 동맹을 파기했습니다`, 'bad');
  return ok();
}

export function orderAlliance(g: Grand, a: GrandFaction, b: GrandFaction): Result {
  const bad = noOrders(g);
  if (bad) return bad;
  if (a === b || allied(g, a, b)) return fail('이미 동맹 관계입니다');
  // The invaders accept no treaty: only the two defenders of Joseon may ally.
  if (a === 'japan' || b === 'japan') return fail('일본은 동맹을 맺지 않습니다');
  g.relations[pairKey(a, b)] = 'allied';
  note(g, `${josa(navyName(a), '과/와')} ${josa(navyName(b), '이/가')} 동맹을 맺었습니다`, 'good');
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
