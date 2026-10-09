import { SHIP_SPECS } from '../../sim/catalog';
import { buildingCost, buildingOf, dateLabel, garrisonCap, levelOf, netIncome, queueSlots, regionIncome } from '../../sim/grand/economy';
import { buildMenu, recruitMenu, refitCost } from '../../sim/grand/orders';
import { LANES, REGIONS, REGION_ORDER, START, type RegionDef } from '../../sim/grand/regions';
import type { BattleSummary } from '../../sim/grand/report';
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
  FactionOption,
  FactionId,
  FleetView,
  LogLineView,
  ObjectiveView,
  RegionView,
  RelationView,
  ScoreView,
  TreasuryView,
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
  strait: '좁은 물길: 큰 배가 돌아설 자리가 없고, 수비하는 쪽이 길목을 쥡니다',
  bay: '만과 포구: 항구에 닿으려면 포대의 사정권을 지나야 합니다',
  island: '섬 사이 물길: 섬 그늘에서 기습하기 좋습니다',
  open: '트인 바다: 속도와 화력이 그대로 승부를 가릅니다',
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
          blocked: m.problem ?? (full ? '선소의 건조 칸이 모두 찼다' : gold < m.gold ? '은이 모자란다' : undefined),
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
  const leader = (fleets: Fleet[]) => {
    const best = fleets.map((fl) => commanderView(g, fl.faction, fl.commanderId)).filter((x): x is CommanderView => !!x).sort((a, b) => b.level - a.level)[0];
    return best ? `${best.name} Lv.${best.level}` : null;
  };
  const youAttack = c.attacker === me || f.attackers.some((fl) => fl.faction === me);
  const youDefend = c.defender === me || f.defenders.some((fl) => fl.faction === me);
  const names = (fleets: Fleet[], fallback: string) => (fleets.length ? fleets.map((fl) => fl.name).join(' + ') : fallback);
  const camp = levelOf(region, 'camp');
  const defenderBonus = [
    ...(p.battery ? [`포대 ${p.battery}단계`] : []),
    ...(camp ? [`군영 ${camp}단계`] : []),
    ...(leader(f.defenders) ? [leader(f.defenders)!] : []),
  ];
  const notes = [TERRAIN_NOTE[REGIONS[c.regionId].terrain]];
  if (p.attackerShips > 30 || p.defenderShips > 30) notes.push('3D 전투에는 한 쪽에서 가장 강한 배 30척까지 나섭니다');
  return {
    regionId: c.regionId,
    regionName: REGIONS[c.regionId].name,
    attacker: { faction: c.attacker, name: names(f.attackers, '공격군'), ships: p.attackerShips, crew: crewOf(f.attacker.ships), power: Math.round(p.attacker), bonuses: leader(f.attackers) ? [leader(f.attackers)!] : [] },
    defender: { faction: c.defender, name: names(f.defenders, `${REGIONS[c.regionId].name} 수비대`), ships: p.defenderShips, crew: crewOf(f.defender.ships), power: Math.round(p.defender), bonuses: defenderBonus },
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
  return lines.slice(-limit).map((l) => ({ turn: l.turn, text: l.text, tone: l.tone }));
}

export function relationViews(g: Grand): RelationView[] {
  const me = player(g);
  return (['joseon', 'japan', 'ming'] as GrandFaction[])
    .filter((f) => f !== me)
    .map((other) => {
      const isAllied = allied(g, me, other);
      // The invaders accept no treaty, and a navy that has fallen has no one left to treat with.
      const locked = me === 'japan' || other === 'japan' ? '왜는 동맹을 맺지 않는다' : !g.factions[other].alive ? '이미 무너진 진영이다' : undefined;
      return { other: other as FactionId, allied: isAllied, locked };
    });
}

const OPTION_TEXT: Record<GrandFaction, Omit<FactionOption, 'id' | 'startRegions' | 'fleets'>> = {
  joseon: {
    name: '조선',
    hanja: '朝',
    leader: '이순신 · 원균',
    blurb: '화포와 판옥선으로 바다를 지키는 수성의 진영. 여수 선소에서 거북선을 지어 해전에서 앞섭니다.',
    strengths: ['함포 화력', '거북선', '수입 +20%'],
    weakness: '일본보다 배가 적음',
    difficulty: 2,
  },
  japan: {
    name: '일본',
    hanja: '日',
    leader: '와키자카 · 구키',
    blurb: '대군과 등선 백병전의 공세 진영. 부산에 이미 상륙해 있고, 싼 배를 많이 지어 포구를 차례로 삼킵니다.',
    strengths: ['등선 백병전', '많은 함선', '싼 건조비'],
    weakness: '해상 화력 열세',
    difficulty: 2,
  },
  ming: {
    name: '명',
    hanja: '明',
    leader: '진린 · 등자룡',
    blurb: '서해 멀리서 오는 원군 진영. 넉넉한 은으로 시작하지만 조선까지는 사흘 뱃길입니다.',
    strengths: ['넉넉한 은', '수입 +20%', '명 복선'],
    weakness: '전장까지 먼 뱃길',
    difficulty: 3,
  },
};

export const FACTION_OPTIONS: FactionOption[] = (['joseon', 'japan', 'ming'] as GrandFaction[]).map((id) => ({
  id,
  ...OPTION_TEXT[id],
  startRegions: REGION_ORDER.filter((r) => START.owners[r] === id).map((r) => REGIONS[r].name),
  fleets: START.fleets.filter((f) => f.faction === id).length,
}));

const LABEL_OF: Record<GrandFaction, string> = { joseon: '조선', japan: '일본', ming: '명' };

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
    headline: won === null ? '교전 종료' : won ? '승전' : '패전',
    outcome: s.captured ? `${josa(LABEL_OF[winnerSide.faction], '은/는')} ${josa(place, '을/를')} 차지했다. ${LABEL_OF[loser.faction]}의 함대는 물러났다.` : `${josa(LABEL_OF[winnerSide.faction], '은/는')} ${josa(place, '을/를')} 지켜 냈다. 공격군은 물러났다.`,
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
  const name = LABEL_OF[v.faction];
  const how = v.kind === 'objective' ? '목표를 이루고 버텨 냈다' : v.kind === 'score' ? '정해진 달이 다하고 가장 큰 공을 세웠다' : '맞서는 진영이 모두 무너졌다';
  return {
    won,
    headline: won ? '大捷' : '敗戰',
    text: v.faction === me ? `${josa(name, '은/는')} ${how}.` : won ? `우리 진영은 ${josa(name, '과/와')} 함께 ${how}.` : `${josa(name, '은/는')} ${how}.`,
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
