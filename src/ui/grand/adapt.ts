import { SHIP_SPECS } from '../../sim/catalog';
import { buildingCost, buildingOf, dateLabel, garrisonCap, levelOf, netIncome, queueSlots, regionIncome } from '../../sim/grand/economy';
import { buildMenu, recruitMenu, refitCost } from '../../sim/grand/orders';
import { LANES, REGIONS, REGION_ORDER, START, type RegionDef } from '../../sim/grand/regions';
import type { BattleSummary } from '../../sim/grand/report';
import { pendingCard, describeEffect } from '../../sim/grand/events';
import type { TurnReplay } from '../../sim/grand/replay';
import { MAX_TURNS, OBJECTIVE_HOLD, contactForces, objectiveProgress, objectiveText, oddsOfContact, previewContact, scoreOf } from '../../sim/grand/turn';
import type { Fleet, Grand, GrandFaction, RegionId } from '../../sim/grand/types';
import { MAX_LEVEL } from '../../sim/grand/types';
import { allied, findRoute, fleetById, ownedBy, shipCount, visibleRegions } from '../../sim/grand/world';
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
  ObjectiveView,
  RegionView,
  RelationView,
  ReplayView,
  ScoreView,
  TreasuryView,
  TurnReportView,
  TurnView,
} from './types';
import { josa } from '../../sim/grand/josa';

/**
 * Maps the campaign state onto the plain view models the UI kit draws. Nothing here changes the campaign; every
 * number shown is read from it.
 */

/** The three regions off the south coast are drawn on the edge of the map image, near the sea lane they use. */
const PIN: Partial<Record<RegionId, { lon: number; lat: number }>> = {
  nagoya: { lon: 130.05, lat: 33.55 },
  shandong: { lon: 125.12, lat: 34.5 },
  liaodong: { lon: 125.2, lat: 35.38 },
};

const LABEL: Record<RegionId, RegionView['labelSide']> = {
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

const player = (g: Grand): GrandFaction => g.player ?? 'joseon';

export function regionViews(g: Grand): RegionView[] {
  const me = player(g);
  const seen = visibleRegions(g, me);
  return REGION_ORDER.map((id) => {
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
        blocked: m.problem ?? undefined,
        upgradeLeft: buildingOf(r, m.kind)?.upgradeLeft ?? 0,
      }));
    const works = r.buildings
      .filter((b) => b.upgradeLeft > 0)
      .map((b) => ({ id: b.kind, kind: b.kind, toLevel: b.level + 1, turnsLeft: b.upgradeLeft, cancelable: b.upgradeLeft === buildingCost(b.kind, b.level + 1).turns }));
    const full = r.queue.length >= queueSlots(r);
    const recruit = own
      ? recruitMenu(g, id).map((m) => ({
          kind: m.kind,
          name: SHIP_SPECS[m.kind].label,
          cost: m.gold,
          turns: m.turns,
          blocked: m.problem ?? (full ? '건조 칸이 모두 찼습니다' : gold < m.gold ? '은이 부족합니다' : undefined),
        }))
      : [];
    const yard = r.queue.map((q) => ({ id: q.id, kind: q.kind, name: SHIP_SPECS[q.kind].label, turnsLeft: q.left, total: q.total, cancelable: q.left === q.total }));
    return {
      id,
      name: def.name,
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
      garrison: r.garrison.length,
      garrisonMax: garrisonCap(id, r),
      unrest: r.unrest,
      adj: LANES[id].map((l) => l.to),
      laneTurns: Object.fromEntries(LANES[id].map((l) => [l.to, l.turns])),
      offMap: !!def.edge,
      seat: !!def.capitalOf,
      visible,
      labelSide: LABEL[id],
      note: def.blurb,
      freeSlots: Math.max(0, 2 + def.value - r.buildings.length),
    };
  });
}

const commanderView = (g: Grand, faction: GrandFaction, id: string | null): CommanderView | undefined => {
  const c = id ? g.factions[faction].commanders.find((x) => x.id === id) : undefined;
  return c && c.alive ? { id: c.id, name: c.name, title: c.title, level: c.level, portrait: c.portrait } : undefined;
};

function fleetView(g: Grand, fl: Fleet): FleetView {
  const r = fl.at ? g.regions[fl.at] : null;
  const refitable = !!r && !!r.owner && allied(g, fl.faction, r.owner) && (levelOf(r, 'camp') > 0 || levelOf(r, 'dock') > 0);
  return {
    id: fl.id,
    faction: fl.faction,
    name: fl.name,
    at: fl.at,
    transit: fl.transit ? { from: fl.transit.from, to: fl.transit.to, left: fl.transit.left } : undefined,
    route: [...fl.route],
    ships: fl.ships.map((s) => ({ id: s.id, kind: s.kind, hull: s.hull, crew: s.crew, supply: s.supply, name: s.name })),
    commander: commanderView(g, fl.faction, fl.commanderId),
    rest: fl.rest,
    refit: refitable ? refitCost(fl) : 0,
  };
}

/** Fleets the player can see: its own and its friends', and the enemy's wherever the player's ports and beacons reach. */
export function fleetViews(g: Grand): FleetView[] {
  const me = player(g);
  const seen = visibleRegions(g, me);
  return g.fleets
    .filter((fl) => allied(g, me, fl.faction) || (fl.at ? seen.has(fl.at) : fl.transit ? seen.has(fl.transit.from) || seen.has(fl.transit.to) : false))
    .map((fl) => fleetView(g, fl));
}

export function turnView(g: Grand): TurnView {
  return { turn: g.turn, maxTurns: MAX_TURNS, date: dateLabel(g.turn), faction: player(g) };
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
      return [{ officer: { id: c.id, name: c.name, title: c.title, level: c.level, portrait: c.portrait }, leads: holder && holder.id !== fl.id ? holder.name : undefined }];
    });
}

/** Where the fleet's ordered route leads, in place names with the turns it takes. */
export function routeText(g: Grand, fl: Fleet): string | undefined {
  if (!fl.at || !fl.route.length) return undefined;
  let at: RegionId = fl.at;
  let turns = 0;
  for (const next of fl.route) {
    turns += LANES[at].find((l) => l.to === next)?.turns ?? 1;
    at = next;
  }
  const dest = g.regions[at];
  const hostile = dest.owner !== null && !allied(g, fl.faction, dest.owner);
  return `${fl.route.map((id) => REGIONS[id].name).join(' → ')} · ${turns}턴${hostile ? ' · 공격' : ''}`;
}

/** Regions a docked fleet can be ordered to: every one with a safe route, hostile ports included as the last stop. */
export function moveTargets(g: Grand, fl: Fleet): RegionId[] {
  if (!fl.at || fl.transit || fl.rest > 0) return [];
  return REGION_ORDER.filter((id) => id !== fl.at && findRoute(g, fl.faction, fl.at!, id));
}

export function previewView(g: Grand, contactId: string): BattlePreviewView | null {
  const p = previewContact(g, contactId);
  if (!p) return null;
  const c = p.contact;
  const f = contactForces(g, c);
  const me = player(g);
  const region = g.regions[c.regionId];
  const crewOf = (ships: { kind: keyof typeof SHIP_SPECS; crew: number }[]) => Math.round(ships.reduce((a, s) => a + SHIP_SPECS[s.kind].crew * s.crew, 0));
  const leaderOf = (fleets: Fleet[]) => fleets.map((fl) => commanderView(g, fl.faction, fl.commanderId)).filter((x): x is CommanderView => !!x).sort((a, b) => b.level - a.level)[0];
  const youAttack = c.attacker === me || f.attackers.some((fl) => fl.faction === me);
  const youDefend = c.defender === me || f.defenders.some((fl) => fl.faction === me);
  const names = (fleets: Fleet[], fallback: string) => (fleets.length ? fleets.map((fl) => fl.name).join(' + ') : fallback);
  const camp = levelOf(region, 'camp');
  const defenderBonus = [
    ...(p.battery ? [`포대 ${p.battery}단계`] : []),
    ...(camp ? [`군영 ${camp}단계`] : []),
  ];
  const notes = [TERRAIN_NOTE[REGIONS[c.regionId].terrain]];
  if (p.attackerShips > 30 || p.defenderShips > 30) notes.push('직접 지휘하는 전투에는 한쪽에서 가장 강한 함선 30척까지 참전합니다.');
  return {
    regionId: c.regionId,
    regionName: REGIONS[c.regionId].name,
    attacker: { faction: c.attacker, leader: leaderOf(f.attackers), name: names(f.attackers, '공격 함대'), ships: p.attackerShips, crew: crewOf(f.attacker.ships), power: Math.round(p.attacker), bonuses: [] },
    defender: { faction: c.defender, leader: leaderOf(f.defenders), name: names(f.defenders, `${REGIONS[c.regionId].name} 수비대`), ships: p.defenderShips, crew: crewOf(f.defender.ships), power: Math.round(p.defender), bonuses: defenderBonus },
    winChance: oddsOfContact(g, contactId) ?? 0.5,
    you: youAttack ? 'attacker' : youDefend ? 'defender' : null,
    notes,
  };
}

export function objectiveView(g: Grand): ObjectiveView {
  const me = player(g);
  const p = objectiveProgress(g, me);
  return { text: objectiveText(me), have: p.have, need: p.need, hold: g.factions[me].objectiveHold, holdNeeded: OBJECTIVE_HOLD };
}

export function scoreViews(g: Grand): ScoreView[] {
  return (['joseon', 'japan', 'ming'] as GrandFaction[]).map((f) => ({ faction: f, score: scoreOf(g, f), regions: ownedBy(g, f).length, ships: shipCount(g, f), alive: g.factions[f].alive }));
}

export function logLines(g: Grand, turn?: number, limit = 14): LogLineView[] {
  const lines = turn === undefined ? g.log : g.log.filter((l) => l.turn === turn);
  return lines.slice(-limit).map((l) => ({ turn: l.turn, text: l.text, tone: l.tone, tag: l.tag }));
}

export function relationViews(g: Grand): RelationView[] {
  const me = player(g);
  return (['joseon', 'japan', 'ming'] as GrandFaction[])
    .filter((f) => f !== me)
    .map((other) => {
      const isAllied = allied(g, me, other);
      // The invaders accept no treaty, and a navy that has fallen has no one left to treat with.
      const locked = me === 'japan' || other === 'japan' ? '일본은 동맹을 맺지 않습니다.' : !g.factions[other].alive ? '이미 패망한 진영입니다.' : undefined;
      return { other: other as FactionId, allied: isAllied, locked };
    });
}

const OPTION_TEXT: Record<GrandFaction, Omit<FactionOption, 'id' | 'startRegions' | 'fleets'>> = {
  joseon: {
    name: '조선',
    leader: '이순신 · 원균',
    blurb: '화포와 판옥선으로 바다를 지키는 수비형 진영입니다. 여수 선소에서 거북선을 건조할 수 있습니다.',
    strengths: ['함포 화력', '거북선', '수입 +20%'],
    weakness: '함선 수 열세',
    difficulty: 2,
  },
  japan: {
    name: '일본',
    leader: '와키자카 · 구키',
    blurb: '많은 함선과 등선 백병전으로 밀어붙이는 공세형 진영입니다. 부산에서 시작해 값싼 함선을 늘려 가며 포구를 차지합니다.',
    strengths: ['등선 백병전', '많은 함선', '낮은 건조비'],
    weakness: '해상 화력 열세',
    difficulty: 2,
  },
  ming: {
    name: '명',
    leader: '진린 · 등자룡',
    blurb: '서해 건너에서 원군으로 참전하는 진영입니다. 은이 넉넉하지만 조선 해역까지 3턴이 걸립니다.',
    strengths: ['풍부한 은', '수입 +20%', '명 복선'],
    weakness: '먼 출전 거리',
    difficulty: 3,
  },
};

export const FACTION_OPTIONS: FactionOption[] = (['joseon', 'japan', 'ming'] as GrandFaction[]).map((id) => ({
  id,
  ...OPTION_TEXT[id],
  startRegions: REGION_ORDER.filter((r) => START.owners[r] === id).map((r) => REGIONS[r].name),
  fleets: START.fleets.filter((f) => f.faction === id).length,
}));

const NAVY: Record<GrandFaction, string> = { joseon: '조선 수군', japan: '일본 수군', ming: '명 수군' };

export function resultView(s: BattleSummary): BattleResultView {
  const winnerSide = s.winner === 'attacker' ? s.attacker : s.defender;
  const won = s.humanSide === null ? null : s.humanSide === s.winner;
  const you = (side: 'attacker' | 'defender') => s.humanSide === side;
  const place = s.regionName;
  const loser = s.winner === 'attacker' ? s.defender : s.attacker;
  return {
    regionName: place,
    played: s.played,
    won,
    headline: won === null ? '교전 종료' : won ? '승리' : '패배',
    outcome: s.captured ? `${josa(NAVY[winnerSide.faction], '이/가')} ${josa(place, '을/를')} 차지했습니다. ${josa(NAVY[loser.faction], '은/는')} 후퇴했습니다.` : `${josa(NAVY[winnerSide.faction], '이/가')} ${josa(place, '을/를')} 지켜 냈습니다. 공격 함대는 후퇴했습니다.`,
    sides: [
      { role: '공격', faction: s.attacker.faction, ships: s.attacker.ships, lost: s.attacker.lost, kills: s.attacker.kills, you: you('attacker') },
      { role: '수비', faction: s.defender.faction, ships: s.defender.ships, lost: s.defender.lost, kills: s.defender.kills, you: you('defender') },
    ],
    fleet: s.fleet.map((x) => ({ name: x.name, kind: x.kind, hull: x.hull, crew: x.crew, alive: x.alive })),
    razed: s.razed.map((k) => ({ camp: '군영', shipyard: '선소', battery: '포대', dock: '수리소', granary: '창고', beacon: '봉수대' })[k]),
  };
}

export function overView(g: Grand): GameOverView | null {
  const v = g.victory;
  if (!v) return null;
  const me = player(g);
  const won = v.faction === me || allied(g, me, v.faction);
  const name = NAVY[v.faction];
  const how = v.kind === 'objective' ? '목표를 달성하고 유지했습니다' : v.kind === 'score' ? '마지막 턴에 가장 높은 점수를 얻었습니다' : '맞서던 진영이 모두 패망했습니다';
  const fallen = !g.factions[me].alive;
  return {
    won,
    headline: won ? '전역 승리' : '전역 패배',
    text: fallen
      ? `${josa(NAVY[me], '은/는')} 모든 포구를 잃고 패망했습니다.`
      : v.faction === me
        ? `${josa(name, '이/가')} ${how}.`
        : won
          ? `${josa(NAVY[me], '과/와')} ${josa(name, '이/가')} 함께 ${how}.`
          : `${josa(name, '이/가')} ${how}.`,
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
    date: dateLabel(g.turn),
    regions: ownedBy(g, me).length,
    ships: shipCount(g, me),
    gold: Math.round(g.factions[me].gold),
    difficulty: g.difficulty === 'easy' ? '쉬움' : g.difficulty === 'hard' ? '어려움' : '보통',
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
    date: dateLabel(g.turn),
    title: shown.card.title,
    text: shown.card.text,
    portrait: shown.card.portrait,
    choices: shown.card.choices.map((c) => ({ label: c.label, hint: describeEffect(c.effect) })),
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
    date: `${dateLabel(turn)} → ${dateLabel(turn + 1)}`,
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
    news: g.log.filter((l) => l.turn === turn || (l.turn === turn + 1 && l.tag === 'event')).slice(-30).map((l) => ({ turn: l.turn, text: l.text, tone: l.tone, tag: l.tag })),
  };
}
