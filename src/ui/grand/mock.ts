import type {
  BuildingKind,
  BuildingView,
  FactionOption,
  FleetView,
  Owner,
  QueueItemView,
  RegionView,
  Resources,
  ShipClass,
  ShipView,
  TreasuryView,
} from './types';

// Mock campaign for the demo screen (?granddemo=1) and for layout checks. Not game data.

const KINDS: BuildingKind[] = ['barracks', 'shipyard', 'battery', 'repair', 'storehouse', 'beacon'];
const BASE_COST: Record<BuildingKind, Partial<Resources>> = {
  barracks: { gold: 120, food: 60 },
  shipyard: { gold: 200, wood: 150 },
  battery: { gold: 160, powder: 60 },
  repair: { gold: 100, wood: 80 },
  storehouse: { gold: 90, wood: 60 },
  beacon: { gold: 50, wood: 30 },
};

export function buildingAt(kind: BuildingKind, level: number, stock: Resources, owned: boolean, queued: boolean): BuildingView {
  const maxLevel = kind === 'beacon' ? 2 : 3;
  const cost: Partial<Resources> = {};
  for (const [k, v] of Object.entries(BASE_COST[kind]) as [keyof Resources, number][]) cost[k] = v * (level + 1);
  const short = (Object.entries(cost) as [keyof Resources, number][]).find(([k, v]) => stock[k] < v);
  const blocked = !owned
    ? '아군 영토에서만 건설합니다'
    : queued
      ? '이미 건설 중입니다'
      : short
        ? `${{ gold: '금', wood: '목재', powder: '화약', food: '군량' }[short[0]]}이 부족합니다`
        : undefined;
  return { kind, level, maxLevel, cost, turns: 2 + level, buildable: !blocked, blocked };
}

interface Seed {
  id: string;
  name: string;
  hanja: string;
  lon: number;
  lat: number;
  owner: Owner;
  value: number;
  income: Partial<Resources>;
  garrison: number;
  garrisonMax: number;
  adj: string[];
  levels?: Partial<Record<BuildingKind, number>>;
  offMap?: boolean;
  labelSide?: RegionView['labelSide'];
  note?: string;
}

const SEEDS: Seed[] = [
  {
    id: 'yeosu',
    name: '여수',
    hanja: '麗水',
    lon: 127.74,
    lat: 34.74,
    owner: 'joseon',
    value: 5,
    income: { gold: 18, wood: 6, powder: 4, food: 10 },
    garrison: 420,
    garrisonMax: 600,
    adj: ['suncheon', 'namhae', 'goheung', 'hansan'],
    levels: { barracks: 2, shipyard: 3, battery: 1, repair: 1, storehouse: 2 },
    note: '전라좌수영. 이순신의 본영으로, 조선 수군의 선소가 모여 있습니다.',
  },
  {
    id: 'suncheon',
    name: '순천',
    hanja: '順天',
    lon: 127.49,
    lat: 34.95,
    owner: 'joseon',
    value: 3,
    income: { gold: 9, food: 12 },
    garrison: 180,
    garrisonMax: 300,
    adj: ['yeosu', 'goheung'],
    levels: { barracks: 1, storehouse: 1 },
    labelSide: 'l',
  },
  {
    id: 'namhae',
    name: '남해',
    hanja: '南海',
    lon: 127.89,
    lat: 34.84,
    owner: 'joseon',
    value: 3,
    income: { gold: 7, wood: 8 },
    garrison: 160,
    garrisonMax: 260,
    adj: ['yeosu', 'sacheon', 'hansan'],
    levels: { beacon: 1, battery: 1 },
    labelSide: 't',
  },
  {
    id: 'sacheon',
    name: '사천',
    hanja: '泗川',
    lon: 128.07,
    lat: 34.95,
    owner: 'joseon',
    value: 3,
    income: { gold: 8, food: 9 },
    garrison: 140,
    garrisonMax: 240,
    adj: ['namhae', 'hansan'],
    levels: { barracks: 1 },
    labelSide: 't',
  },
  {
    id: 'hansan',
    name: '한산도',
    hanja: '閑山島',
    lon: 128.48,
    lat: 34.79,
    owner: 'joseon',
    value: 4,
    income: { gold: 6, wood: 10 },
    garrison: 210,
    garrisonMax: 320,
    adj: ['namhae', 'sacheon', 'yeosu', 'okpo'],
    levels: { shipyard: 1, beacon: 2, battery: 2 },
    labelSide: 'b',
    note: '견내량 너머의 섬. 학익진을 펼치기 좋은 넓은 바다가 앞에 있습니다.',
  },
  {
    id: 'okpo',
    name: '옥포',
    hanja: '玉浦',
    lon: 128.69,
    lat: 34.89,
    owner: 'japan',
    value: 3,
    income: { gold: 7, food: 6 },
    garrison: 260,
    garrisonMax: 300,
    adj: ['hansan', 'ungcheon', 'gadeok'],
    levels: { battery: 1, repair: 1 },
    labelSide: 'b',
  },
  {
    id: 'gadeok',
    name: '가덕도',
    hanja: '加德島',
    lon: 128.82,
    lat: 35.0,
    owner: null,
    value: 2,
    income: { wood: 5 },
    garrison: 40,
    garrisonMax: 120,
    adj: ['okpo', 'ungcheon', 'busan'],
    levels: { beacon: 1 },
    labelSide: 'b',
  },
  {
    id: 'ungcheon',
    name: '웅천',
    hanja: '熊川',
    lon: 128.74,
    lat: 35.13,
    owner: 'japan',
    value: 3,
    income: { gold: 8, food: 8 },
    garrison: 340,
    garrisonMax: 400,
    adj: ['okpo', 'gadeok', 'gimhae', 'busan'],
    levels: { barracks: 2, battery: 1 },
    labelSide: 'l',
  },
  {
    id: 'gimhae',
    name: '김해',
    hanja: '金海',
    lon: 128.88,
    lat: 35.26,
    owner: 'japan',
    value: 3,
    income: { gold: 10, food: 14 },
    garrison: 300,
    garrisonMax: 380,
    adj: ['ungcheon', 'busan'],
    levels: { barracks: 1, storehouse: 2 },
    labelSide: 't',
  },
  {
    id: 'busan',
    name: '부산포',
    hanja: '釜山浦',
    lon: 129.06,
    lat: 35.1,
    owner: 'japan',
    value: 5,
    income: { gold: 20, wood: 6, powder: 5, food: 12 },
    garrison: 520,
    garrisonMax: 700,
    adj: ['ungcheon', 'gimhae', 'gadeok', 'tsushima'],
    levels: { barracks: 3, shipyard: 2, battery: 2, repair: 1, storehouse: 2, beacon: 1 },
    labelSide: 'r',
    note: '일본군 상륙 거점. 대마도에서 보급선이 닿는 곳입니다.',
  },
  {
    id: 'goheung',
    name: '고흥',
    hanja: '高興',
    lon: 127.34,
    lat: 34.56,
    owner: 'joseon',
    value: 2,
    income: { gold: 4, food: 7 },
    garrison: 90,
    garrisonMax: 180,
    adj: ['yeosu', 'suncheon', 'jangheung'],
    levels: { beacon: 1 },
    labelSide: 'b',
  },
  {
    id: 'jangheung',
    name: '장흥',
    hanja: '長興',
    lon: 126.92,
    lat: 34.64,
    owner: 'joseon',
    value: 3,
    income: { gold: 6, food: 10 },
    garrison: 130,
    garrisonMax: 220,
    adj: ['goheung', 'haenam'],
    levels: { storehouse: 1 },
    labelSide: 't',
  },
  {
    id: 'haenam',
    name: '해남',
    hanja: '海南',
    lon: 126.6,
    lat: 34.57,
    owner: 'joseon',
    value: 3,
    income: { gold: 6, food: 11 },
    garrison: 120,
    garrisonMax: 220,
    adj: ['jangheung', 'jindo', 'mokpo'],
    levels: { barracks: 1 },
    labelSide: 'b',
  },
  {
    id: 'jindo',
    name: '울돌목',
    hanja: '鳴梁',
    lon: 126.31,
    lat: 34.47,
    owner: 'joseon',
    value: 4,
    income: { gold: 5, wood: 6 },
    garrison: 110,
    garrisonMax: 240,
    adj: ['haenam', 'mokpo', 'jeju', 'shandong'],
    levels: { battery: 1, beacon: 1 },
    labelSide: 'b',
    note: '물살이 거센 좁은 해협. 소수 함대로 대군을 막기 좋은 자리입니다.',
  },
  {
    id: 'mokpo',
    name: '목포',
    hanja: '木浦',
    lon: 126.38,
    lat: 34.79,
    owner: 'joseon',
    value: 4,
    income: { gold: 12, wood: 8, food: 8 },
    garrison: 200,
    garrisonMax: 320,
    adj: ['haenam', 'jindo', 'yeonggwang', 'shandong'],
    levels: { shipyard: 1, storehouse: 1 },
    labelSide: 'r',
  },
  {
    id: 'yeonggwang',
    name: '영광',
    hanja: '靈光',
    lon: 126.45,
    lat: 35.27,
    owner: 'joseon',
    value: 2,
    income: { gold: 5, food: 9 },
    garrison: 80,
    garrisonMax: 160,
    adj: ['mokpo', 'liaodong'],
    labelSide: 'r',
  },
  {
    id: 'jeju',
    name: '제주',
    hanja: '濟州',
    lon: 126.53,
    lat: 33.5,
    owner: 'joseon',
    value: 3,
    income: { wood: 6, food: 5 },
    garrison: 100,
    garrisonMax: 200,
    adj: ['jindo'],
    labelSide: 't',
    levels: { beacon: 1 },
  },
  {
    id: 'tsushima',
    name: '대마도',
    hanja: '對馬',
    lon: 129.3,
    lat: 34.2,
    owner: 'japan',
    value: 4,
    income: { gold: 8, wood: 4, food: 6 },
    garrison: 280,
    garrisonMax: 360,
    adj: ['busan', 'iki'],
    levels: { beacon: 2, battery: 1 },
    labelSide: 'l',
  },
  {
    id: 'iki',
    name: '이키',
    hanja: '壹岐',
    lon: 129.7,
    lat: 33.76,
    owner: 'japan',
    value: 3,
    income: { gold: 6, food: 7 },
    garrison: 200,
    garrisonMax: 280,
    adj: ['tsushima', 'nagoya'],
    levels: { beacon: 1 },
    labelSide: 't',
  },
  {
    id: 'nagoya',
    name: '나고야',
    hanja: '名護屋',
    lon: 129.87,
    lat: 33.53,
    owner: 'japan',
    value: 5,
    income: { gold: 16, wood: 8, powder: 6, food: 14 },
    garrison: 640,
    garrisonMax: 800,
    adj: ['iki', 'honshu'],
    levels: { barracks: 3, shipyard: 3, battery: 1, storehouse: 3 },
    labelSide: 'l',
    note: '히데요시의 출병 본영. 조선 침공의 병력과 군량이 여기서 모입니다.',
  },
  {
    id: 'honshu',
    name: '일본 본토',
    hanja: '日本',
    lon: 130.17,
    lat: 33.4,
    owner: 'japan',
    value: 5,
    income: { gold: 30, food: 30 },
    garrison: 0,
    garrisonMax: 0,
    adj: ['nagoya'],
    offMap: true,
    labelSide: 't',
    note: '규슈와 그 너머. 증원과 보급이 이 항로로 들어옵니다.',
  },
  {
    id: 'liaodong',
    name: '요동',
    hanja: '遼東',
    lon: 125.22,
    lat: 35.45,
    owner: 'ming',
    value: 5,
    income: { gold: 24, food: 24 },
    garrison: 0,
    garrisonMax: 0,
    adj: ['yeonggwang', 'shandong'],
    offMap: true,
    labelSide: 'r',
    note: '명의 육군이 압록강을 건너 내려오는 길목입니다.',
  },
  {
    id: 'shandong',
    name: '산둥',
    hanja: '山東',
    lon: 125.1,
    lat: 34.6,
    owner: 'ming',
    value: 5,
    income: { gold: 22, wood: 10 },
    garrison: 0,
    garrisonMax: 0,
    adj: ['mokpo', 'jindo', 'liaodong'],
    offMap: true,
    labelSide: 'r',
    note: '덩저우 수군이 서해를 건너 지원하는 항구입니다.',
  },
];

export const START_STOCK: Resources = { gold: 1240, wood: 860, powder: 310, food: 2150 };

export function makeRegions(): RegionView[] {
  return SEEDS.map((s) => ({
    id: s.id,
    name: s.name,
    hanja: s.hanja,
    lon: s.lon,
    lat: s.lat,
    owner: s.owner,
    value: s.value,
    income: s.income,
    buildings: KINDS.map((k) => buildingAt(k, s.levels?.[k] ?? 0, START_STOCK, s.owner === 'joseon', false)),
    queue: s.id === 'yeosu' ? [{ id: 'q1', kind: 'battery', toLevel: 2, turnsLeft: 2 }] : [],
    garrison: s.garrison,
    garrisonMax: s.garrisonMax,
    adj: s.adj,
    offMap: s.offMap,
    labelSide: s.labelSide,
    note: s.note,
  }));
}

export function refreshBuildings(r: RegionView, stock: Resources, me: Owner): RegionView {
  const queued = new Set(r.queue.map((q) => q.kind));
  return { ...r, buildings: r.buildings.map((b) => buildingAt(b.kind, b.level, stock, r.owner === me, queued.has(b.kind))) };
}

export function queueItem(kind: BuildingKind, toLevel: number, turns: number): QueueItemView {
  return { id: `q${Math.random().toString(36).slice(2, 7)}`, kind, toLevel, turnsLeft: turns };
}

function ships(prefix: string, spec: [ShipClass, number][], wear = 0): ShipView[] {
  const out: ShipView[] = [];
  let n = 0;
  for (const [kind, count] of spec) {
    for (let i = 0; i < count; i += 1) {
      n += 1;
      const damaged = (n * 37) % 7 < 2 ? wear : 0;
      out.push({
        id: `${prefix}${n}`,
        kind,
        hull: Math.max(0.2, 1 - damaged - ((n * 13) % 5) * 0.03),
        crew: Math.max(0.25, 1 - damaged * 0.8 - ((n * 11) % 4) * 0.04),
      });
    }
  }
  return out;
}

export const START_FLEETS: FleetView[] = [
  {
    id: 'f-left',
    faction: 'joseon',
    name: '전라좌수영 함대',
    at: 'hansan',
    moveTo: 'okpo',
    ships: [
      ...ships('l', [['panokseon', 4]], 0.35),
      { id: 'l-turtle', kind: 'geobukseon', hull: 0.94, crew: 0.9, name: '이순신의 거북선' },
      ...ships('lh', [['hyeopseon', 2]]),
    ],
  },
  { id: 'f-gyeong', faction: 'joseon', name: '경상우수영 함대', at: 'hansan', ships: ships('g', [['panokseon', 3]], 0.5) },
  { id: 'f-right', faction: 'joseon', name: '전라우수영 함대', at: 'mokpo', ships: ships('r', [['panokseon', 3]], 0.2) },
  {
    id: 'f-guard',
    faction: 'joseon',
    name: '남해 방비대',
    at: 'namhae',
    ships: ships('n', [
      ['hyeopseon', 2],
      ['panokseon', 1],
    ]),
  },
  {
    id: 'f-kuki',
    faction: 'japan',
    name: '구키 함대',
    at: 'okpo',
    ships: ships(
      'k',
      [
        ['atakebune', 2],
        ['sekibune', 5],
        ['kobaya', 2],
      ],
      0.3,
    ),
  },
  {
    id: 'f-wakisaka',
    faction: 'japan',
    name: '와키자카 함대',
    at: 'busan',
    moveTo: 'ungcheon',
    ships: ships('w', [
      ['atakebune', 1],
      ['sekibune', 5],
      ['kobaya', 2],
    ]),
  },
  {
    id: 'f-reserve',
    faction: 'japan',
    name: '나고야 예비대',
    at: 'nagoya',
    ships: ships('p', [
      ['atakebune', 3],
      ['sekibune', 6],
      ['kobaya', 3],
    ]),
  },
  {
    id: 'f-ming',
    faction: 'ming',
    name: '요동 수군',
    at: 'liaodong',
    ships: ships('m', [
      ['mingship', 4],
      ['mingsmall', 2],
    ]),
  },
];

export const START_TREASURY: TreasuryView = {
  stock: START_STOCK,
  income: { gold: 64, wood: 22, powder: 12, food: 38 },
};

export const FACTION_OPTIONS: FactionOption[] = [
  {
    id: 'joseon',
    name: '조선',
    hanja: '朝',
    leader: '이순신 · 원균',
    blurb: '화포와 판옥선으로 바다를 지키는 수성의 진영. 육지는 밀리지만 해전에서는 압도할 수 있습니다.',
    strengths: ['함포 사거리', '거북선', '지형 이점'],
    weakness: '병력 부족',
    difficulty: 2,
    startRegions: ['여수', '남해', '한산도', '목포', '울돌목'],
    fleets: 4,
  },
  {
    id: 'japan',
    name: '일본',
    hanja: '日',
    leader: '와키자카 · 구키',
    blurb: '대군과 등선육박 전술의 공세 진영. 상륙지를 늘려 보급을 이어 가면 육상 거점을 빠르게 삼킵니다.',
    strengths: ['등선 백병전', '대규모 병력', '풍부한 군량'],
    weakness: '해상 화력 열세',
    difficulty: 2,
    startRegions: ['부산포', '웅천', '김해', '대마도', '나고야'],
    fleets: 3,
  },
  {
    id: 'ming',
    name: '명',
    hanja: '明',
    leader: '진린 · 등자룡',
    blurb: '늦게 합류하는 원군 진영. 서해 항로의 거점과 두터운 자금으로 전세가 기운 쪽에 힘을 보탭니다.',
    strengths: ['풍부한 자금', '서해 항로', '증원군'],
    weakness: '늦은 참전',
    difficulty: 3,
    startRegions: ['요동', '산둥'],
    fleets: 1,
  },
];
