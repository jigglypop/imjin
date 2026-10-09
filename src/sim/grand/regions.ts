import type { ShipKind } from '../types';
import type { BuildingKind, GrandFaction, RegionId } from './types';

export type Terrain = 'strait' | 'bay' | 'open' | 'island';

export type Lane = { to: RegionId; /** Turns to sail the lane. */ turns: 1 | 2 | 3 };

export type RegionDef = {
  id: RegionId;
  name: string;
  hanja: string;
  /** Real position, for placing the marker on the DEM. Regions outside the DEM carry `edge`. */
  lon: number;
  lat: number;
  /** Set for regions off the map: the border the marker is pinned to. */
  edge?: 'se' | 'nw';
  /** 1 to 3. Sets income, building slots and the weight of the region in a score. */
  value: 1 | 2 | 3;
  terrain: Terrain;
  /** On the Korean south coast: the regions Joseon must hold and Japan wants. */
  korea: boolean;
  /** The faction whose seat this region is, if any. Pays a capital bonus while that faction owns it. */
  capitalOf?: GrandFaction;
  blurb: string;
};

export const REGION_ORDER: readonly RegionId[] = [
  'myeongnyang',
  'yeosu',
  'noryang',
  'sacheon',
  'hansan',
  'geoje',
  'angolpo',
  'busan',
  'tsushima',
  'nagoya',
  'shandong',
  'liaodong',
];

export const REGIONS: Record<RegionId, RegionDef> = {
  myeongnyang: {
    id: 'myeongnyang',
    name: '명량·진도',
    hanja: '鳴梁',
    lon: 126.31,
    lat: 34.57,
    value: 2,
    terrain: 'strait',
    korea: true,
    blurb: '서해로 통하는 길목입니다. 울돌목의 빠른 물살이 수비 측에 유리합니다.',
  },
  yeosu: {
    id: 'yeosu',
    name: '여수',
    hanja: '麗水',
    lon: 127.74,
    lat: 34.74,
    value: 2,
    terrain: 'bay',
    korea: true,
    capitalOf: 'joseon',
    blurb: '전라좌수영이 있는 조선 수군의 본거지입니다.',
  },
  noryang: {
    id: 'noryang',
    name: '남해·노량',
    hanja: '露梁',
    lon: 127.87,
    lat: 34.94,
    value: 1,
    terrain: 'strait',
    korea: true,
    blurb: '남해도와 하동 사이의 좁은 수로입니다. 동서 항로를 쥐고 있습니다.',
  },
  sacheon: {
    id: 'sacheon',
    name: '사천·당포',
    hanja: '泗川',
    lon: 128.13,
    lat: 34.93,
    value: 1,
    terrain: 'bay',
    korea: true,
    blurb: '안쪽으로 깊은 만과 포구입니다. 함대를 모으기 좋습니다.',
  },
  hansan: {
    id: 'hansan',
    name: '한산도',
    hanja: '閑山島',
    lon: 128.48,
    lat: 34.79,
    value: 2,
    terrain: 'island',
    korea: true,
    blurb: '견내량 너머의 섬입니다. 적을 끌어들여 싸우기 좋은 지형입니다.',
  },
  geoje: {
    id: 'geoje',
    name: '거제·옥포',
    hanja: '巨濟',
    lon: 128.69,
    lat: 34.89,
    value: 2,
    terrain: 'island',
    korea: true,
    blurb: '남해안 중앙의 큰 섬입니다. 부산으로 향하는 길목입니다.',
  },
  angolpo: {
    id: 'angolpo',
    name: '안골포·가덕',
    hanja: '安骨浦',
    lon: 128.8,
    lat: 35.08,
    value: 1,
    terrain: 'bay',
    korea: true,
    blurb: '부산 서쪽의 만입니다. 일본군의 보급선이 드나듭니다.',
  },
  busan: {
    id: 'busan',
    name: '부산포',
    hanja: '釜山浦',
    lon: 129.05,
    lat: 35.1,
    value: 3,
    terrain: 'bay',
    korea: true,
    blurb: '쓰시마에서 오는 항로가 닿는 가장 큰 포구입니다. 일본군의 본진이 있습니다.',
  },
  tsushima: {
    id: 'tsushima',
    name: '쓰시마',
    hanja: '對馬',
    lon: 129.3,
    lat: 34.45,
    value: 1,
    terrain: 'island',
    korea: false,
    blurb: '일본군이 바다를 건너는 중간 기지입니다.',
  },
  nagoya: {
    id: 'nagoya',
    name: '나고야',
    hanja: '名護屋',
    lon: 129.87,
    lat: 33.53,
    edge: 'se',
    value: 3,
    terrain: 'bay',
    korea: false,
    capitalOf: 'japan',
    blurb: '히데요시의 대본영입니다. 병력과 함선이 이곳에서 출발합니다.',
  },
  shandong: {
    id: 'shandong',
    name: '산둥',
    hanja: '山東',
    lon: 120.74,
    lat: 37.81,
    edge: 'nw',
    value: 3,
    terrain: 'open',
    korea: false,
    capitalOf: 'ming',
    blurb: '명 수군의 기지입니다. 곡식과 은이 넉넉하지만 조선까지 거리가 멉니다.',
  },
  liaodong: {
    id: 'liaodong',
    name: '요동',
    hanja: '遼東',
    lon: 121.26,
    lat: 38.81,
    edge: 'nw',
    value: 2,
    terrain: 'open',
    korea: false,
    blurb: '압록강 너머에 있는 명의 북쪽 거점입니다.',
  },
};

/** The sea lanes. Every lane runs both ways; `edges` lists each once. */
const EDGES: [RegionId, RegionId, 1 | 2 | 3][] = [
  ['myeongnyang', 'yeosu', 2],
  ['yeosu', 'noryang', 1],
  ['noryang', 'sacheon', 1],
  ['noryang', 'hansan', 1],
  ['sacheon', 'hansan', 1],
  ['hansan', 'geoje', 1],
  ['geoje', 'angolpo', 1],
  ['geoje', 'busan', 1],
  ['angolpo', 'busan', 1],
  ['busan', 'tsushima', 2],
  ['tsushima', 'nagoya', 2],
  ['shandong', 'liaodong', 1],
  ['shandong', 'myeongnyang', 3],
  ['liaodong', 'myeongnyang', 3],
];

export const LANES: Record<RegionId, Lane[]> = (() => {
  const out = Object.fromEntries(REGION_ORDER.map((id) => [id, [] as Lane[]])) as Record<RegionId, Lane[]>;
  for (const [a, b, turns] of EDGES) {
    out[a].push({ to: b, turns });
    out[b].push({ to: a, turns });
  }
  return out;
})();

/** Building plots by value. */
export const slotsOf = (id: RegionId) => 2 + REGIONS[id].value;

export const KOREA_COAST: readonly RegionId[] = REGION_ORDER.filter((id) => REGIONS[id].korea);

export type StartFleet = { faction: GrandFaction; at: RegionId; name: string; ships: Partial<Record<ShipKind, number>>; commander: string };

export type StartSetup = {
  owners: Record<RegionId, GrandFaction>;
  buildings: Partial<Record<RegionId, Partial<Record<BuildingKind, number>>>>;
  fleets: StartFleet[];
  gold: Record<GrandFaction, number>;
};

export type CommanderDef = { id: string; faction: GrandFaction; name: string; title: string; portrait: string; level: number };

export const COMMANDERS: CommanderDef[] = [
  { id: 'yi', faction: 'joseon', name: '이순신', title: '전라좌수사', portrait: 'portrait_yi', level: 3 },
  { id: 'won', faction: 'joseon', name: '원균', title: '경상우수사', portrait: 'portrait_won', level: 1 },
  { id: 'eokgi', faction: 'joseon', name: '이억기', title: '전라우수사', portrait: 'portrait_eokgi', level: 2 },
  { id: 'kwon', faction: 'joseon', name: '권준', title: '순천부사', portrait: 'portrait_kwon', level: 1 },
  { id: 'wakisaka', faction: 'japan', name: '와키자카 야스하루', title: '수군 대장', portrait: 'portrait_wakisaka', level: 2 },
  { id: 'kuki', faction: 'japan', name: '구키 요시타카', title: '수군 장수', portrait: 'portrait_kuki', level: 2 },
  { id: 'kato', faction: 'japan', name: '가토 요시아키', title: '수군 장수', portrait: 'portrait_kato', level: 2 },
  { id: 'kurushima', faction: 'japan', name: '구루시마 미치후사', title: '무라카미 수군', portrait: 'portrait_kurushima', level: 1 },
  { id: 'chenlin', faction: 'ming', name: '진린', title: '수군 도독', portrait: 'portrait_chenlin', level: 2 },
  { id: 'deng', faction: 'ming', name: '등자룡', title: '수군 부총병', portrait: 'portrait_deng', level: 2 },
];

/** Joseon holds the south-west coast, Japan the landing at Busan and its bases behind, and Ming sits far to the north-west. */
export const START: StartSetup = {
  owners: {
    myeongnyang: 'joseon',
    yeosu: 'joseon',
    noryang: 'joseon',
    sacheon: 'joseon',
    hansan: 'joseon',
    geoje: 'joseon',
    angolpo: 'japan',
    busan: 'japan',
    tsushima: 'japan',
    nagoya: 'japan',
    shandong: 'ming',
    liaodong: 'ming',
  },
  buildings: {
    yeosu: { camp: 2, shipyard: 2, dock: 1 },
    hansan: { camp: 1, shipyard: 1, battery: 1 },
    geoje: { camp: 1, battery: 1 },
    myeongnyang: { battery: 1 },
    noryang: { battery: 1 },
    busan: { camp: 1, shipyard: 1, battery: 1 },
    angolpo: { battery: 1 },
    tsushima: { beacon: 1 },
    nagoya: { camp: 2, shipyard: 2, dock: 1 },
    shandong: { camp: 2, shipyard: 2, dock: 1 },
    liaodong: { camp: 1, shipyard: 1 },
  },
  fleets: [
    { faction: 'joseon', at: 'yeosu', name: '전라좌수영 본대', ships: { panokseon: 8, hyeopseon: 5 }, commander: 'yi' },
    { faction: 'joseon', at: 'hansan', name: '한산 함대', ships: { panokseon: 4, hyeopseon: 3 }, commander: 'kwon' },
    { faction: 'joseon', at: 'geoje', name: '경상우수영', ships: { panokseon: 2, hyeopseon: 2 }, commander: 'won' },
    { faction: 'japan', at: 'busan', name: '부산 함대', ships: { atakebune: 10, sekibune: 13, kobaya: 13 }, commander: 'wakisaka' },
    { faction: 'japan', at: 'busan', name: '구키 수군', ships: { atakebune: 6, sekibune: 10, kobaya: 6 }, commander: 'kuki' },
    { faction: 'japan', at: 'nagoya', name: '나고야 후속대', ships: { atakebune: 10, sekibune: 10, kobaya: 10 }, commander: 'kato' },
    { faction: 'ming', at: 'liaodong', name: '요동 수군', ships: { mingship: 6, mingsmall: 8 }, commander: 'chenlin' },
  ],
  gold: { joseon: 900, japan: 1000, ming: 1500 },
};
