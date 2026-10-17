import { t } from '../../i18n';
import { shipSpec } from '../../sim/competitive';
import type { ShipKind } from '../../sim/types';
import { buildingWorkTotal, buildingOf, dateLabel, garrisonCap, levelOf, netIncome, queueSlots, regionIncome } from '../../sim/grand/economy';
import { buildMenu, recruitMenu, refitCost } from '../../sim/grand/orders';
import { REGIONS, type RegionDef } from '../../sim/grand/regions';
import { factionsOf, orderOf, THEATRES } from '../../sim/grand/theatre';
import { mapTheatreId } from './theatreChoice';
import { GRADE_TEXT, type BattleSummary } from '../../sim/grand/report';
import { pendingCard, describeEffect } from '../../sim/grand/events';
import type { TurnReplay } from '../../sim/grand/replay';
import { MAX_TURNS, OBJECTIVE_HOLD, besiegeProblem, contactForces, objectiveProgress, objectiveText, oddsOfContact, previewContact, scoreOf } from '../../sim/grand/turn';
import { MARCH, fleetReach, marchDistances, marchRoute, marchStops, marching, transitShare, turnsFor, winterTurn } from '../../sim/grand/march';
import type { Fleet, Grand, GrandFaction, RegionId } from '../../sim/grand/types';
import { MAX_LEVEL } from '../../sim/grand/types';
import { allied, findRoute, fleetById, fleetObserved, lanesOf, ownedBy, passable, shipCount, visibleRegions } from '../../sim/grand/world';
import type {
  BattlePreviewView,
  BattleResultView,
  GameOverView,
  SaveView,
  BuildingView,
  CommanderView,
  EventView,
  FactionOption,
  FactionId,
  FleetView,
  LogLineView,
  MarchFleetView,
  MarchRouteView,
  ObjectiveView,
  RegionView,
  RelationView,
  ReplayView,
  ScoreView,
  SpotView,
  TreasuryView,
  TurnReportView,
  TurnView,
} from './types';
import { SHIP_NAME, buildingName } from './shared';
import { logText, tName, tt, turnsText } from './text';

/**
 * Maps the campaign state onto the plain view models the UI kit draws. Nothing here changes the campaign; every
 * number shown is read from it. Text comes out in the language set now, so the screen builds these views again when
 * the language changes.
 */

/** The three regions off the south coast are drawn on the edge of the map image, near the sea lane they use. */
const PIN: Partial<Record<RegionId, { lon: number; lat: number }>> = {
  nagoya: { lon: 130.05, lat: 33.55 },
  shandong: { lon: 125.12, lat: 34.5 },
  liaodong: { lon: 125.2, lat: 35.38 },
  // The Iberian ports of the Armada theatre lie south of its map: pinned on the Bay of Biscay at its southern edge.
  lisbon: { lon: -9.9, lat: 47.95 },
  corunna: { lon: -7.9, lat: 47.95 },
  santander: { lon: -5.7, lat: 47.85 },
  // The Lepanto theatre's ports off its map: Famagusta at the eastern edge, Tripoli and Alexandria at the southern.
  famagusta: { lon: 29.75, lat: 35.6 },
  tripoli: { lon: 13.6, lat: 34.75 },
  alexandria: { lon: 28.3, lat: 34.75 },
  // The Trafalgar theatre's Caribbean islands, 5,000 km to the west: pinned on the Atlantic at its western edge, Barbados
  // to the south-east of Martinique as it lies.
  martinique: { lon: -10.9, lat: 38.3 },
  barbados: { lon: -10.2, lat: 37.5 },
};

const LABEL: Partial<Record<RegionId, RegionView['labelSide']>> = {
  myeongnyang: 'l',
  yeosu: 'b',
  noryang: 'l',
  sacheon: 't',
  hansan: 'b',
  geoje: 'r',
  angolpo: 't',
  busan: 'r',
  tsushima: 'r',
  nagoya: 'l',
  shandong: 'b',
  liaodong: 't',
};

const TERRAIN_NOTE: Record<RegionDef['terrain'], string> = {
  strait: '좁은 해협입니다. 큰 배가 방향을 바꾸기 어려워 수비하는 쪽이 유리합니다.',
  bay: '만과 포구입니다. 항구에 접근하려면 포대의 사정권을 지나야 합니다.',
  island: '섬 사이의 물길입니다. 섬 그늘에 숨어 기습하기 좋습니다.',
  open: '트인 바다입니다. 속도와 화력이 승부를 가릅니다.',
};

const player = (g: Grand): GrandFaction => g.player ?? factionsOf(g)[0]!;

export function regionViews(g: Grand): RegionView[] {
  const me = player(g);
  const seen = visibleRegions(g, me);
  return orderOf(g).map((id) => {
    const def = REGIONS[id];
    const r = g.regions[id];
    const own = r.owner === me;
    const visible = own || seen.has(id);
    const pin = PIN[id];
    const menu = r.owner ? buildMenu(g, id) : [];
    const gold = r.owner ? g.factions[r.owner].gold : 0;
    const buildings: BuildingView[] = menu
      .filter((m) => own || m.level > 0)
      .map((m) => ({
        kind: m.kind,
        level: m.level,
        maxLevel: MAX_LEVEL,
        cost: { gold: m.gold },
        turns: m.turns,
        buildable: !m.problem,
        blocked: m.problem ? t(m.problem) : undefined,
        upgradeLeft: buildingOf(r, m.kind)?.upgradeLeft ?? 0,
      }));
    const works = r.buildings
      .filter((b) => b.upgradeLeft > 0)
      .map((b) => ({ id: b.kind, kind: b.kind, toLevel: b.level + 1, turnsLeft: b.upgradeLeft, cancelable: b.upgradeLeft === buildingWorkTotal(b) }));
    const full = r.queue.length >= queueSlots(r);
    const recruit = own
      ? recruitMenu(g, id).map((m) => ({
          kind: m.kind,
          name: t(SHIP_NAME[m.kind]),
          cost: m.gold,
          turns: m.turns,
          blocked: m.problem ? t(m.problem) : full ? t('건조 칸이 모두 찼습니다') : gold < m.gold ? t('은이 부족합니다') : undefined,
        }))
      : [];
    const yard = r.queue.map((q) => ({ id: q.id, kind: q.kind, name: t(SHIP_NAME[q.kind]), turnsLeft: q.left, total: q.total, cancelable: q.left === q.total }));
    return {
      id,
      name: t(def.name),
      hanja: def.hanja,
      lon: pin?.lon ?? def.lon,
      lat: pin?.lat ?? def.lat,
      owner: r.owner,
      value: def.value,
      income: visible ? regionIncome(g, id) : 0,
      buildings: visible ? buildings : [],
      works: visible ? works : [],
      recruit,
      yard: own ? yard : [],
      yardIdle: yard.length > 0 && levelOf(r, 'shipyard') < 1,
      garrison: visible ? r.garrison.length : 0,
      garrisonCrew: visible ? r.garrison.reduce((n, s) => n + Math.round(shipSpec(s.kind).crew * s.crew), 0) : 0,
      garrisonMax: garrisonCap(id, r),
      unrest: r.unrest,
      adj: lanesOf(g, id).map((l) => l.to),
      // Under the march rules a lane takes as long as the fleet's sailing makes it, so the map labels no lane with turns.
      laneTurns: marching(g) ? undefined : Object.fromEntries(lanesOf(g, id).map((l) => [l.to, l.turns])),
      offMap: !!def.edge,
      seat: !!def.capitalOf,
      korea: def.korea,
      visible,
      labelSide: LABEL[id],
      note: t(def.blurb),
      freeSlots: Math.max(0, 2 + def.value - r.buildings.length),
      // A blockade shows wherever the player can see the port, and always to the navy keeping it up.
      siege: r.siege && (visible || r.siege.by === me) ? { by: r.siege.by, turns: r.siege.turns, hold: r.siege.hold } : undefined,
    };
  });
}

const commanderView = (g: Grand, faction: GrandFaction, id: string | null): CommanderView | undefined => {
  const c = id ? g.factions[faction].commanders.find((x) => x.id === id) : undefined;
  return c && c.alive ? { id: c.id, name: t(c.name), title: t(c.title), level: c.level, portrait: c.portrait } : undefined;
};

/** What the march rules add to a fleet: its distance per turn in either stance, its stance, its blockade and where its orders end. */
function marchView(g: Grand, fl: Fleet): MarchFleetView | undefined {
  if (!marching(g)) return undefined;
  const normal = fleetReach(g, { ...fl, stance: 'normal' });
  const dest = fl.route[fl.route.length - 1] ?? (fl.besieging && fl.at ? fl.at : undefined);
  const s = fl.besieging && fl.at ? g.regions[fl.at].siege : undefined;
  // The same reasons orderStance gives, so the button is off instead of answering with a refusal.
  const blocked = fl.at && !passable(g, fl.faction, fl.at) ? '적의 포구 앞에서는 강행군할 수 없습니다' : dest && !passable(g, fl.faction, dest) ? '강행군 중에는 공격할 수 없습니다' : undefined;
  return {
    reach: { normal: Math.round(normal), forced: Math.round(normal * MARCH.forced) },
    stance: fl.stance ?? 'normal',
    winter: winterTurn(g.turn),
    besieging: !!fl.besieging,
    assault: !!fl.assault,
    siege: s ? { turns: s.turns, hold: s.hold } : undefined,
    dest: dest ? { id: dest, hostile: !passable(g, fl.faction, dest) } : undefined,
    marchBlocked: blocked && fl.stance !== 'march' ? t(blocked) : undefined,
  };
}

function fleetView(g: Grand, fl: Fleet): FleetView {
  const r = fl.at ? g.regions[fl.at] : null;
  const refitable = !!r && !!r.owner && allied(g, fl.faction, r.owner) && (levelOf(r, 'camp') > 0 || levelOf(r, 'dock') > 0);
  return {
    id: fl.id,
    faction: fl.faction,
    name: tName(fl.name),
    at: fl.at,
    transit: fl.transit ? { from: fl.transit.from, to: fl.transit.to, left: fl.transit.left, progress: marching(g) ? transitShare(g, fl.transit) : undefined } : undefined,
    route: [...fl.route],
    ships: fl.ships.map((s) => ({ id: s.id, kind: s.kind, hull: s.hull, crew: s.crew, supply: s.supply, name: tName(s.name) })),
    crewCount: fl.ships.reduce((n, s) => n + Math.round(shipSpec(s.kind).crew * s.crew), 0),
    commander: commanderView(g, fl.faction, fl.commanderId),
    rest: fl.rest,
    refit: refitable ? refitCost(fl) : 0,
    march: marchView(g, fl),
  };
}

/** Fleets the player can see: its own and its friends', and the enemy's wherever the player's ports and beacons reach. */
export function fleetViews(g: Grand): FleetView[] {
  const me = player(g);
  const seen = visibleRegions(g, me);
  return g.fleets
    .filter((fl) => fleetObserved(g, me, fl, seen))
    .map((fl) => fleetView(g, fl));
}

export function turnView(g: Grand): TurnView {
  return { turn: g.turn, maxTurns: MAX_TURNS, date: t(dateLabel(g.turn, g)), faction: player(g), winter: marching(g) && winterTurn(g.turn) };
}

export function treasuryView(g: Grand): TreasuryView {
  const me = player(g);
  return { stock: { gold: Math.round(g.factions[me].gold) }, income: { gold: netIncome(g, me) } };
}

/** The officers the player may put in command of a fleet: those alive whose present fleet lies in the same port. */
export function officersFor(g: Grand, fleetId: string): { officer: CommanderView; leads?: string }[] {
  const fl = fleetById(g, fleetId);
  if (!fl) return [];
  return g.factions[fl.faction].commanders
    .filter((c) => c.alive)
    .flatMap((c) => {
      const holder = g.fleets.find((f) => f.commanderId === c.id);
      if (holder && holder.id !== fl.id && holder.at !== fl.at) return [];
      return [{ officer: { id: c.id, name: t(c.name), title: t(c.title), level: c.level, portrait: c.portrait }, leads: holder && holder.id !== fl.id ? tName(holder.name) : undefined }];
    });
}

/** Where the fleet's ordered route leads, in place names with the turns it takes. */
export function routeText(g: Grand, fl: Fleet): string | undefined {
  if (marching(g)) return marchRouteText(g, fl);
  if (!fl.at || !fl.route.length) return undefined;
  let at: RegionId = fl.at;
  let turns = 0;
  for (const next of fl.route) {
    turns += lanesOf(g, at).find((l) => l.to === next)?.turns ?? 1;
    at = next;
  }
  const dest = g.regions[at];
  const hostile = dest.owner !== null && !allied(g, fl.faction, dest.owner);
  const route = fl.route.map((id) => t(REGIONS[id].name)).join(' → ');
  return hostile ? t('{route} · {turns} · 공격', { route, turns: turnsText(turns) }) : t('{route} · {turns}', { route, turns: turnsText(turns) });
}

/** March rules: the route in place names, the turns it takes at the fleet's sailing, and whether it ends in an attack or a blockade. */
function marchRouteText(g: Grand, fl: Fleet): string | undefined {
  if (!fl.route.length || (!fl.at && !fl.transit)) return undefined;
  const turns = turnsText(Math.max(1, marchStops(g, fl, fl.route).length));
  const route = fl.route.map((id) => t(REGIONS[id].name)).join(' → ');
  if (passable(g, fl.faction, fl.route[fl.route.length - 1]!)) return t('{route} · {turns}', { route, turns });
  return fl.besieging ? t('{route} · {turns} · 봉쇄', { route, turns }) : t('{route} · {turns} · 공격', { route, turns });
}

/**
 * Regions a fleet can be ordered to: every one with a safe route, hostile ports included as the last stop. Under the
 * march rules a fleet at sea may be sent on too, and a fleet on a forced march cannot make for a hostile port.
 */
export function moveTargets(g: Grand, fl: Fleet): RegionId[] {
  if (marching(g)) {
    if (fl.rest > 0 || (!fl.at && !fl.transit)) return [];
    const { dist } = marchDistances(g, fl);
    return orderOf(g).filter((id) => id !== fl.at && dist.has(id) && (fl.stance !== 'march' || passable(g, fl.faction, id)));
  }
  if (!fl.at || fl.transit || fl.rest > 0) return [];
  return orderOf(g).filter((id) => id !== fl.at && findRoute(g, fl.faction, fl.at!, id));
}

/** March rules: the turns the fleet needs to reach each port it can be sent to, for the map's coloured range. */
export function reachTurns(g: Grand, fl: Fleet): Record<string, number> {
  const { dist } = marchDistances(g, fl);
  return Object.fromEntries(moveTargets(g, fl).map((id) => [id, turnsFor(g, fl, dist.get(id)!)]));
}

/** Where a fleet lies now, as a spot on the map. */
function spotOf(g: Grand, fl: Fleet): SpotView | null {
  if (fl.at) return { at: fl.at };
  return fl.transit ? { at: fl.transit.from, to: fl.transit.to, t: transitShare(g, fl.transit) } : null;
}

/**
 * The way along `path` cut at the end of each turn (march rules), for the map's movement line: every leg starts where
 * the turn before ended, runs through the ports it calls at, and ends in port or at sea where `marchStops` has it.
 */
function routeLegs(g: Grand, fl: Fleet, path: readonly RegionId[]): SpotView[][] {
  let from = spotOf(g, fl);
  if (!from) return [];
  const legs: SpotView[][] = [];
  let i = 0;
  for (const stop of marchStops(g, fl, path)) {
    const leg: SpotView[] = [from];
    if ('at' in stop) {
      const end = path.indexOf(stop.at, i);
      for (; i <= end; i += 1) leg.push({ at: path[i]! });
    } else {
      const end = path.indexOf(stop.to, i);
      for (; i < end; i += 1) leg.push({ at: path[i]! });
      leg.push({ at: stop.from, to: stop.to, t: stop.t });
    }
    legs.push(leg);
    from = leg[leg.length - 1]!;
  }
  return legs;
}

/** March rules: how the fleet would sail to `dest`, turn by turn; `siege` when it is to blockade a hostile port there. */
export function marchRouteView(g: Grand, fl: Fleet, dest: RegionId, siege = false): MarchRouteView | null {
  const route = marchRoute(g, fl, dest);
  if (!route || !route.path.length) return null;
  const hostile = !passable(g, fl.faction, dest);
  const legs = routeLegs(g, fl, route.path);
  return { dest, turns: legs.length || route.turns, km: Math.round(route.km), hostile, siege: hostile && siege, legs };
}

/** March rules: the route the fleet has been ordered to sail, turn by turn, or null when it has no orders. */
export function plannedRoute(g: Grand, fl: Fleet): MarchRouteView | null {
  const dest = fl.route[fl.route.length - 1];
  if (!marching(g) || !dest) return null;
  const legs = routeLegs(g, fl, fl.route);
  const hostile = !passable(g, fl.faction, dest);
  return { dest, turns: legs.length, km: Math.round(marchRoute(g, fl, dest)?.km ?? 0), hostile, siege: hostile && !!fl.besieging, legs };
}

export function previewView(g: Grand, contactId: string): BattlePreviewView | null {
  const p = previewContact(g, contactId);
  if (!p) return null;
  const c = p.contact;
  const f = contactForces(g, c);
  const me = player(g);
  const region = g.regions[c.regionId];
  const crewOf = (ships: { kind: ShipKind; crew: number }[]) => Math.round(ships.reduce((a, s) => a + shipSpec(s.kind).crew * s.crew, 0));
  const leaderOf = (fleets: Fleet[]) => fleets.map((fl) => commanderView(g, fl.faction, fl.commanderId)).filter((x): x is CommanderView => !!x).sort((a, b) => b.level - a.level)[0];
  const youAttack = c.attacker === me || f.attackers.some((fl) => fl.faction === me);
  const youDefend = c.defender === me || f.defenders.some((fl) => fl.faction === me);
  const names = (fleets: Fleet[], fallback: string) => (fleets.length ? fleets.map((fl) => tName(fl.name)).join(' + ') : fallback);
  // Out at sea the port's works take no part.
  const camp = c.sea ? 0 : levelOf(region, 'camp');
  const defenderBonus = [
    ...(p.battery ? [t('포대 {n}단계', { n: p.battery })] : []),
    ...(camp ? [t('군영 {n}단계', { n: camp })] : []),
  ];
  const notes = [t(TERRAIN_NOTE[REGIONS[c.regionId].terrain])];
  if (c.siege) notes.push(t('봉쇄된 포구를 구하러 온 함대가 봉쇄 함대와 싸웁니다.'));
  const joined = new Set(c.reinforcements ?? []);
  const helpers = (ids: string[]) => ids.filter((id) => joined.has(id)).flatMap((id) => fleetById(g, id) ?? []).map((fl) => tName(fl.name));
  const mineIn = [...c.attackerFleets, ...c.defenderFleets].some((id) => fleetById(g, id)?.faction === me);
  // A fight for a port can become a blockade while no enemy fleet lies in the port, and only by the navy that attacks.
  // The same test the order makes, so the button shows only when the blockade would be accepted and would hold.
  const besiegeable = besiegeProblem(g, c, me) === null;
  if (marching(g) && mineIn) notes.push(c.sea ? t('퇴각하면 보급을 일부 잃고 물러납니다.') : t('퇴각하면 보급을 일부 잃고 물러납니다. 지킬 병력이 남지 않은 포구는 적에게 넘어갑니다.'));
  return {
    regionId: c.regionId,
    regionName: t(REGIONS[c.regionId].name),
    attacker: { faction: c.attacker, leader: leaderOf(f.attackers), name: names(f.attackers, t('공격 함대')), ships: p.attackerShips, crew: crewOf(f.attacker.ships), power: Math.round(p.attacker), bonuses: [] },
    defender: { faction: c.defender, leader: leaderOf(f.defenders), name: names(f.defenders, t('{place} 수비대', { place: t(REGIONS[c.regionId].name) })), ships: p.defenderShips, crew: crewOf(f.defender.ships), power: Math.round(p.defender), bonuses: defenderBonus },
    winChance: oddsOfContact(g, contactId) ?? 0.5,
    you: youAttack ? 'attacker' : youDefend ? 'defender' : null,
    notes,
    sea: !!c.sea,
    relief: !!c.siege,
    reinforcements: { attacker: helpers(c.attackerFleets), defender: helpers(c.defenderFleets) },
    canBesiege: marching(g) && besiegeable,
    canWithdraw: marching(g) && mineIn,
  };
}

export function objectiveView(g: Grand): ObjectiveView {
  const me = player(g);
  const p = objectiveProgress(g, me);
  return { text: t(objectiveText(me, g)), have: p.have, need: p.need, hold: g.factions[me].objectiveHold, holdNeeded: OBJECTIVE_HOLD };
}

export function scoreViews(g: Grand): ScoreView[] {
  const me = player(g), seen = visibleRegions(g, me);
  return factionsOf(g).map((f) => {
    const known = g.phase === 'over' || allied(g, me, f);
    return { faction: f, score: known ? scoreOf(g, f) : null, observedOnly: !known, regions: ownedBy(g, f).length,
      ships: known ? shipCount(g, f) : g.fleets.filter((fl) => fl.faction === f && fleetObserved(g, me, fl, seen)).reduce((n, fl) => n + fl.ships.length, 0), alive: g.factions[f].alive };
  });
}

export function logLines(g: Grand, turn?: number, limit = 14): LogLineView[] {
  const lines = turn === undefined ? g.log : g.log.filter((l) => l.turn === turn);
  return lines.slice(-limit).map((l) => ({ turn: l.turn, text: logText(l), tone: l.tone, tag: l.tag }));
}

export function relationViews(g: Grand): RelationView[] {
  const me = player(g);
  return factionsOf(g)
    .filter((f) => f !== me)
    .map((other) => {
      const isAllied = allied(g, me, other);
      // The invaders accept no treaty, and a navy that has fallen has no one left to treat with.
      const locked = me === 'japan' || other === 'japan' ? t('일본은 동맹을 맺지 않습니다.') : !g.factions[other].alive ? t('이미 패망한 진영입니다.') : undefined;
      return { other: other as FactionId, allied: isAllied, locked };
    });
}

/** Korean source text of the three pick cards; factionOptions() turns it into the current language. */
const OPTION_TEXT: Record<GrandFaction, { name: string; leaders: string[]; blurb: string; strengths: string[]; weakness: string; difficulty: 1 | 2 | 3 }> = {
  joseon: {
    name: '조선',
    leaders: ['이순신', '원균'],
    blurb: '화포와 판옥선으로 바다를 지키는 수비형 진영입니다. 여수 선소에서 거북선을 건조할 수 있습니다.',
    strengths: ['함포 화력', '거북선', '수입 +20%'],
    weakness: '함선 수 열세',
    difficulty: 2,
  },
  japan: {
    name: '일본',
    leaders: ['와키자카', '구키'],
    blurb: '많은 함선과 적선에 올라타는 백병전으로 밀어붙이는 공세형 진영입니다. 부산에서 시작해 값싼 함선을 늘려 가며 포구를 차지합니다.',
    strengths: ['백병전', '많은 함선', '낮은 건조비'],
    weakness: '해상 화력 열세',
    difficulty: 2,
  },
  ming: {
    name: '명',
    leaders: ['진린', '등자룡'],
    blurb: '서해 건너에서 원군으로 참전하는 진영입니다. 은이 넉넉하지만 조선 해역까지 3턴이 걸립니다.',
    strengths: ['풍부한 은', '수입 +20%', '명 대형선'],
    weakness: '먼 출전 거리',
    difficulty: 3,
  },
  england: {
    name: '잉글랜드',
    leaders: ['하워드', '드레이크'],
    blurb: '빠른 레이스 빌트 갤리온과 긴 사거리의 컬버린으로 해협을 지키는 진영입니다. 플리머스와 다운스에서 시작해 무적함대를 막고 플랑드르의 항구를 노립니다.',
    strengths: ['원거리 포격', '빠른 함선', '많은 포구'],
    weakness: '도선전에 약함',
    difficulty: 2,
  },
  spain: {
    name: '에스파냐',
    leaders: ['메디나 시도니아', '레칼데'],
    blurb: '거대한 갤리온과 병사들로 바다를 건너 잉글랜드를 침공하는 진영입니다. 라코루냐의 무적함대와 됭케르크의 파르마군이 런던을 노립니다.',
    strengths: ['강한 도선전', '큰 함대', '인디아스의 은'],
    weakness: '느린 장전, 먼 본국',
    difficulty: 2,
  },
  holyleague: {
    name: '신성동맹',
    leaders: ['돈 후안', '베니에르'],
    blurb: '베네치아, 에스파냐, 교황령이 맺은 동맹의 함대입니다. 메시나에 모인 갤리선과 베네치아의 갈레아스로 오스만 함대를 찾아 이오니아해로 나갑니다.',
    strengths: ['이물 대포 화력', '갈레아스', '화승총병'],
    weakness: '흩어진 포구, 늦은 집결',
    difficulty: 2,
  },
  ottoman: {
    name: '오스만',
    leaders: ['알리 파샤', '울루치 알리'],
    blurb: '많은 갤리선과 갈리오트로 지중해 동쪽을 쥔 술탄의 함대입니다. 레판토와 모돈에서 시작해 베네치아의 섬들과 키프로스를 노립니다.',
    strengths: ['많은 함선', '빠른 갤리선', '활과 도선전'],
    weakness: '약한 이물 화력',
    difficulty: 2,
  },
  britain: {
    name: '영국',
    leaders: ['넬슨', '콘월리스'],
    blurb: '브레스트와 툴롱, 페롤과 카디스를 봉쇄하며 바다를 지키는 진영입니다. 빠른 포격과 숙련된 수병으로 연합 함대가 모이기 전에 하나씩 잡아야 합니다.',
    strengths: ['빠른 포격', '숙련된 수병', '여러 바다의 기지'],
    weakness: '두 적을 동시에 상대',
    difficulty: 2,
  },
  france: {
    name: '프랑스',
    leaders: ['빌뇌브', '강톰'],
    blurb: '나폴레옹의 함대입니다. 브레스트와 툴롱, 로슈포르의 함대를 봉쇄에서 빼내 에스파냐 함대와 합쳐 해협을 쥐고, 불로뉴의 대육군을 영국으로 건너보내야 합니다.',
    strengths: ['큰 함선', '도선 돌격', '에스파냐와 동맹'],
    weakness: '봉쇄된 항구, 경험 없는 수병',
    difficulty: 3,
  },
  spain1805: {
    name: '에스파냐',
    leaders: ['그라비나', '알라바'],
    blurb: '카디스와 페롤, 카르타헤나의 함대로 프랑스와 손잡은 진영입니다. 크고 튼튼한 전열함과 산티시마 트리니다드로 지브롤터 해협을 쥐고 있습니다.',
    strengths: ['튼튼한 선체', '4층 갑판의 거함', '프랑스와 동맹'],
    weakness: '수병 부족',
    difficulty: 3,
  },
};

/** The pick cards of a theatre's navies (the page's own theatre by default). */
export const factionOptions = (theatre = mapTheatreId()): FactionOption[] =>
  THEATRES[theatre].factions.map((id) => {
    const o = OPTION_TEXT[id];
    const start = THEATRES[theatre].start;
    return {
      id,
      name: t(o.name),
      leader: o.leaders.map((n) => t(n)).join(' · '),
      blurb: t(o.blurb),
      strengths: o.strengths.map((x) => t(x)),
      weakness: t(o.weakness),
      difficulty: o.difficulty,
      startRegions: THEATRES[theatre].order.filter((r) => start.owners[r] === id).map((r) => t(REGIONS[r].name)),
      fleets: start.fleets.filter((f) => f.faction === id).length,
    };
  });

const NAVY: Record<GrandFaction, string> = { joseon: '조선 수군', japan: '일본 수군', ming: '명 수군', england: '잉글랜드 수군', spain: '에스파냐 수군', holyleague: '신성동맹 함대', ottoman: '오스만 함대', britain: '영국 해군', france: '프랑스 해군', spain1805: '에스파냐 해군' };

export function resultView(s: BattleSummary): BattleResultView {
  const winnerSide = s.winner === 'attacker' ? s.attacker : s.defender;
  const won = s.humanSide === null ? null : s.humanSide === s.winner;
  const you = (side: 'attacker' | 'defender') => s.humanSide === side;
  const place = t(s.regionName);
  const loser = s.winner === 'attacker' ? s.defender : s.attacker;
  const winnerNavy = t(NAVY[winnerSide.faction]);
  // The march rules grade a win as the log tells it (대승, 신승 ...); a loss stays a loss.
  const win = s.grade ? t(GRADE_TEXT[s.grade]) : t('승리');
  return {
    regionName: s.atSea ? t('{place} 앞바다', { place }) : place,
    played: s.played,
    won,
    headline: won === null ? t('교전 종료') : won ? win : t('패배'),
    outcome: s.atSea
      ? t('{winner|이/가} {place} 앞바다에서 {loser|을/를} 물리쳤습니다. 패한 함대는 물러났습니다.', { winner: winnerNavy, place, loser: t(NAVY[loser.faction]) })
      : s.captured
        ? t('{winner|이/가} {place|을/를} 차지했습니다. {loser|은/는} 후퇴했습니다.', { winner: winnerNavy, place, loser: t(NAVY[loser.faction]) })
        : t('{winner|이/가} {place|을/를} 지켜 냈습니다. 공격 함대는 후퇴했습니다.', { winner: winnerNavy, place }),
    sides: [
      { role: '공격', faction: s.attacker.faction, ships: s.attacker.ships, lost: s.attacker.lost, kills: s.attacker.kills, you: you('attacker') },
      { role: '수비', faction: s.defender.faction, ships: s.defender.ships, lost: s.defender.lost, kills: s.defender.kills, you: you('defender') },
    ],
    fleet: s.fleet.map((x) => ({ name: tName(x.name), kind: x.kind, hull: x.hull, crew: x.crew, alive: x.alive })),
    razed: s.razed.map((k) => buildingName(k)),
  };
}

export function overView(g: Grand): GameOverView | null {
  const v = g.victory;
  if (!v) return null;
  const me = player(g);
  const won = v.faction === me || allied(g, me, v.faction);
  const navy = t(NAVY[v.faction]);
  const mine = t(NAVY[me]);
  const fallen = !g.factions[me].alive;
  const mineWon = v.faction === me;
  const kind = v.kind;
  const text = fallen
    ? t('{navy|은/는} 모든 포구를 잃고 패망했습니다.', { navy: mine })
    : won && !mineWon
      ? kind === 'objective'
        ? t('{me|과/와} {navy|이/가} 함께 목표를 달성하고 유지했습니다.', { me: mine, navy })
        : kind === 'score'
          ? t('{me|과/와} {navy|이/가} 함께 마지막 턴에 가장 높은 점수를 얻었습니다.', { me: mine, navy })
          : t('{me|과/와} {navy|이/가} 함께 맞서던 모든 진영을 물리쳤습니다.', { me: mine, navy })
      : kind === 'objective'
        ? t('{navy|이/가} 목표를 달성하고 유지했습니다.', { navy })
        : kind === 'score'
          ? t('{navy|이/가} 마지막 턴에 가장 높은 점수를 얻었습니다.', { navy })
          : t('{navy|은/는} 맞서던 모든 진영을 물리쳤습니다.', { navy });
  return {
    won,
    headline: won ? t('캠페인 승리') : t('캠페인 패배'),
    text,
    turn: v.turn,
    scores: scoreViews(g),
  };
}

export function saveView(g: Grand): SaveView {
  const me = player(g);
  return {
    faction: me,
    turn: g.turn,
    maxTurns: MAX_TURNS,
    date: t(dateLabel(g.turn, g)),
    regions: ownedBy(g, me).length,
    ships: shipCount(g, me),
    gold: Math.round(g.factions[me].gold),
    difficulty: g.difficulty === 'easy' ? t('쉬움') : g.difficulty === 'hard' ? t('어려움') : t('보통'),
    waiting: g.pending.length,
    over: g.phase === 'over',
  };
}

export function replayView(r: TurnReplay): ReplayView {
  return {
    moves: r.moves.map((m) => ({ id: m.fleetId, faction: m.faction, name: m.name, ships: m.ships, path: m.path, lost: m.lost })),
    clashes: r.clashes,
    changes: r.changes,
  };
}

/** The card of the war's history that waits for the player. */
export function eventView(g: Grand): EventView | null {
  const shown = pendingCard(g);
  if (!shown) return null;
  return {
    id: shown.event.id,
    date: t(dateLabel(g.turn, g)),
    title: t(shown.card.title),
    text: t(shown.card.text),
    portrait: shown.card.portrait,
    choices: shown.card.choices.map((c) => ({ label: t(c.label), hint: describeEffect(c.effect).map((m) => tt(m.text, m.params)).join(' · ') })),
  };
}

/** The turn that closed as numbers: where the treasury, the ports and the fleet stand now against the turn before. */
export function turnReportView(g: Grand, turn: number): TurnReportView {
  const me = player(g);
  const row = g.stats.find((s) => s.turn === turn);
  const prev = g.stats.find((s) => s.turn === turn - 1) ?? g.stats[0];
  const earned = row?.earned?.[me] ?? 0;
  const upkeep = row?.upkeep?.[me] ?? 0;
  const before = prev?.gold[me] ?? 0;
  const closed = row?.gold[me] ?? Math.round(g.factions[me].gold);
  const now = Math.round(g.factions[me].gold);
  return {
    date: `${t(dateLabel(turn, g))} → ${t(dateLabel(turn + 1, g))}`,
    gold: {
      now,
      before,
      earned,
      upkeep,
      // What the player's own orders cost in the turn: works and ships paid when they were given.
      spent: Math.max(0, before + earned - upkeep - closed),
      // Treasury changes the turn's historical event made after the books were closed.
      events: now - closed,
    },
    regions: { now: ownedBy(g, me).length, before: prev?.regions[me] ?? ownedBy(g, me).length },
    ships: { now: shipCount(g, me), before: prev?.ships[me] ?? shipCount(g, me) },
    battles: row?.battles ?? 0,
    // The card of the history that opened the next turn belongs to this news too.
    news: g.log.filter((l) => l.turn === turn || (l.turn === turn + 1 && l.tag === 'event')).slice(-30).map((l) => ({ turn: l.turn, text: logText(l), tone: l.tone, tag: l.tag })),
  };
}
