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
  /** The record verifying an added port, independently of the game's starting owner. */
  source?: { title: string; url: string };
};

/** Keep this order: old campaign battle seeds and saved routes use these original IDs. */
export const LEGACY_REGION_ORDER: readonly RegionId[] = [
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

export const ADDED_PORTS = ['nokdo', 'balpo', 'bangdap', 'dangpo', 'danghangpo', 'gabaeryang', 'yeongdeungpo', 'yulpo', 'jangmunpo', 'jepo', 'cheonseongpo', 'dadaepo', 'mokpo',
  'gogeumdo', 'hoeryeongpo', 'eoranpo', 'ijin', 'garipo', 'yeodo', 'waegyo', 'mijo', 'namhaeseonso', 'gyeonnaeryang', 'happo', 'jukdo', 'gijang', 'seosaengpo', 'ulsan'] as const satisfies readonly RegionId[];
export const REGION_ORDER: readonly RegionId[] = [...LEGACY_REGION_ORDER, ...ADDED_PORTS];

/** On loading an old save, a new port follows the surrounding region's present control. A parent is always listed before its child. */
export const PORT_EXPANSION_PARENT: Record<(typeof ADDED_PORTS)[number], RegionId> = {
  nokdo: 'myeongnyang', balpo: 'yeosu', bangdap: 'yeosu', dangpo: 'hansan', danghangpo: 'sacheon', gabaeryang: 'geoje',
  yeongdeungpo: 'geoje', yulpo: 'geoje', jangmunpo: 'geoje', jepo: 'angolpo', cheonseongpo: 'angolpo', dadaepo: 'busan', mokpo: 'myeongnyang',
  gogeumdo: 'nokdo', hoeryeongpo: 'nokdo', eoranpo: 'myeongnyang', ijin: 'myeongnyang', garipo: 'nokdo', yeodo: 'balpo', waegyo: 'yeosu', mijo: 'noryang',
  namhaeseonso: 'noryang', gyeonnaeryang: 'hansan', happo: 'angolpo', jukdo: 'busan', gijang: 'busan', seosaengpo: 'busan', ulsan: 'busan',
};

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
    blurb: '울돌목의 거센 물살에서 이순신이 13척으로 133척을 꺾은 곳입니다.',
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
    blurb: '1598년 이순신이 마지막 해전에서 전사한 좁은 수로입니다.',
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
    blurb: '1592년 사천 해전에서 거북선이 처음 싸운 바다입니다.',
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
    blurb: '1592년 학익진으로 일본 함대를 무찌른 한산도 대첩의 바다입니다.',
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
    blurb: '1592년 조선 수군이 옥포 해전에서 첫 승리를 거둔 섬입니다.',
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
    blurb: '한산도 대첩 이틀 뒤 일본 함대를 깨뜨린 포구입니다.',
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
    blurb: '쓰시마 항로가 닿는 일본군의 본진입니다.',
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
    blurb: '일본이 바다를 건너는 중간 기지입니다.',
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
    blurb: '히데요시의 대본영, 침공군이 떠나는 곳입니다.',
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
    blurb: '명 수군의 기지입니다. 은이 넉넉하지만 조선까지 멉니다.',
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
  nokdo: {
    id: 'nokdo', name: '녹도진', hanja: '鹿島鎭', lon: 127.14, lat: 34.53, value: 1, terrain: 'bay', korea: true,
    blurb: '녹도만호 정운의 수군진, 좌수영 서쪽 바닷길을 지킵니다.',
    source: { title: '국립문화유산연구원: 녹도진성', url: 'https://portal.nrich.go.kr/kor/archeologyUsrView.do?idx=6671&menuIdx=799' },
  },
  balpo: {
    id: 'balpo', name: '발포진', hanja: '鉢浦鎭', lon: 127.50, lat: 34.48, value: 1, terrain: 'bay', korea: true,
    blurb: '이순신이 만호로 근무한 고흥의 수군진입니다.',
    source: { title: '한국학중앙연구원: 고흥 발포 만호성', url: 'https://encykorea.aks.ac.kr/Article/E0004076' },
  },
  bangdap: {
    id: 'bangdap', name: '방답진', hanja: '防踏鎭', lon: 127.73, lat: 34.63, value: 1, terrain: 'island', korea: true,
    blurb: '굴강에 전선을 숨겨 둔 전라좌수영의 전초 기지입니다.',
    source: { title: '국가유산 해설문: 돌산군관청·방답진', url: 'https://dh.aks.ac.kr/~heritage/wiki/index.php/%EB%8F%8C%EC%82%B0%EA%B5%B0%EA%B4%80%EC%B2%AD' },
  },
  dangpo: {
    id: 'dangpo', name: '당포', hanja: '唐浦', lon: 128.39, lat: 34.78, value: 1, terrain: 'bay', korea: true,
    blurb: '1592년 당포 해전에서 일본 함대를 깨뜨린 해안입니다.',
    source: { title: '국가유산포털: 통영 당포성', url: 'https://www.heritage.go.kr/heri/cul/culSelectDetail.do?VdkVgwKey=23%2C00630000%2C38&pageNo=5_1_1_0' },
  },
  danghangpo: {
    id: 'danghangpo', name: '당항포', hanja: '唐項浦', lon: 128.39, lat: 35.05, value: 1, terrain: 'bay', korea: true,
    blurb: '조선 수군이 두 차례 이긴 고성의 좁고 깊은 만입니다.',
    source: { title: '한국관광공사: 당항포 대첩지', url: 'https://access.visitkorea.or.kr/opentour/detail.do?cotId=d4540eb1-7b9f-4dd9-86b9-7ac0ad62eb6e' },
  },
  gabaeryang: {
    id: 'gabaeryang', name: '오아포·가배량', hanja: '吾兒浦·加背梁', lon: 128.58, lat: 34.81, value: 1, terrain: 'bay', korea: true,
    blurb: '경상우수영과 통제영이 자리했던 거제의 옛 포구입니다.',
    source: { title: '거제시: 가배량진성·오아포', url: 'https://www.geoje.go.kr/user/smarttour/view.geoje?basicSid=171&menuCd=DOM_000008503001000000' },
  },
  yeongdeungpo: {
    id: 'yeongdeungpo', name: '영등포', hanja: '永登浦', lon: 128.70, lat: 35.03, value: 1, terrain: 'island', korea: true,
    blurb: '진해만과 거제 북쪽 바다를 잇는 영등진의 포구입니다.',
    source: { title: '국가유산포털: 거제 구영등성', url: 'https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=2333802050000&pageNo=1_1_1_1' },
  },
  yulpo: {
    id: 'yulpo', name: '율포', hanja: '栗浦', lon: 128.69, lat: 34.97, value: 1, terrain: 'bay', korea: true,
    blurb: '1592년 율포 해전이 벌어진 거제 북쪽의 수군진입니다.',
    source: { title: '국가유산포털: 거제 구율포성', url: 'https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=2333802060000' },
  },
  jangmunpo: {
    id: 'jangmunpo', name: '장문포', hanja: '長門浦', lon: 128.68, lat: 35.01, value: 1, terrain: 'bay', korea: true,
    blurb: '1594년 조선 수군이 왜성을 공격한 거제 장목만의 포구입니다.',
    source: { title: '거제시: 장문포 왜성·난중일기', url: 'https://www.geoje.go.kr/user/smarttour/view.geoje?basicSid=199&menuCd=' },
  },
  jepo: {
    id: 'jepo', name: '제포', hanja: '薺浦', lon: 128.75, lat: 35.11, value: 1, terrain: 'bay', korea: true,
    blurb: '일본 배가 드나들던 삼포의 하나, 웅천의 포구입니다.',
    source: { title: '조선왕조실록: 제포·부산포 선박 왕래', url: 'https://sillok.history.go.kr/id/wka_11608025_002' },
  },
  cheonseongpo: {
    id: 'cheonseongpo', name: '천성진', hanja: '天城鎭', lon: 128.82, lat: 35.03, value: 1, terrain: 'island', korea: true,
    blurb: '진해만 동쪽 입구를 지키던 가덕도의 수군진입니다.',
    source: { title: '부산박물관: 천성진성 발굴조사', url: 'https://museum.busan.go.kr/busan/reserchexp01/1577256?curPage=&srchBeginDt=&srchEndDt=&srchKey=&srchText=' },
  },
  dadaepo: {
    id: 'dadaepo', name: '다대포', hanja: '多大浦', lon: 128.97, lat: 35.06, value: 1, terrain: 'bay', korea: true,
    blurb: '부산포로 드는 남쪽 바닷길을 지키던 수군진입니다.',
    source: { title: '부산교통공사: 다대포 수군진', url: 'https://www2.humetro.busan.kr/homepage/default/stationinfo/page/list01.do?S_LINE=&S_STATION=&menu_no=1001010201' },
  },
  mokpo: {
    id: 'mokpo', name: '목포진', hanja: '木浦鎭', lon: 126.38, lat: 34.79, value: 1, terrain: 'strait', korea: true,
    blurb: '영산강 하구를 지키던 수군진입니다.',
    source: { title: '조선왕조실록: 목포 병선 배치·만호 파견', url: 'https://sillok.history.go.kr/id/kda_12104015_002' },
  },
  gogeumdo: {
    id: 'gogeumdo', name: '고금도', hanja: '古今島', lon: 126.85, lat: 34.40, value: 1, terrain: 'island', korea: true,
    blurb: '1598년 이순신이 본영을 두고 진린의 명 수군과 합류한 섬입니다.',
    source: { title: '한국학중앙연구원: 묘당도 이충무공 유적', url: 'https://encykorea.aks.ac.kr/Article/E0018851' },
  },
  hoeryeongpo: {
    id: 'hoeryeongpo', name: '회령포', hanja: '會寧浦', lon: 126.94, lat: 34.48, value: 1, terrain: 'bay', korea: true,
    blurb: '1597년 다시 통제사가 된 이순신이 남은 전선을 넘겨받은 포구입니다.',
    source: { title: '위키백과: 회진항', url: 'https://ko.wikipedia.org/wiki/%ED%9A%8C%EC%A7%84%ED%95%AD' },
  },
  eoranpo: {
    id: 'eoranpo', name: '어란포', hanja: '於蘭浦', lon: 126.47, lat: 34.35, value: 1, terrain: 'bay', korea: true,
    blurb: '1597년 벽파진으로 가던 이순신이 일본 전선을 물리친 포구입니다.',
    source: { title: '한국학중앙연구원: 명량대첩', url: 'https://encykorea.aks.ac.kr/Article/E0018250' },
  },
  ijin: {
    id: 'ijin', name: '이진', hanja: '梨津', lon: 126.62, lat: 34.40, value: 1, terrain: 'bay', korea: true,
    blurb: '정유재란 때 일본군에 맞서 싸웠다고 전하는 해남의 수군진입니다.',
    source: { title: '한국학중앙연구원: 해남군', url: 'https://encykorea.aks.ac.kr/Article/E0062451' },
  },
  garipo: {
    id: 'garipo', name: '가리포진', hanja: '加里浦鎭', lon: 126.76, lat: 34.32, value: 1, terrain: 'island', korea: true,
    blurb: '가리포 첨사가 이순신 휘하에서 여러 해전에 나선 완도의 수군진입니다.',
    source: { title: '한국학중앙연구원: 완도군', url: 'https://encykorea.aks.ac.kr/Article/E0038961' },
  },
  yeodo: {
    id: 'yeodo', name: '여도진', hanja: '呂島鎭', lon: 127.47, lat: 34.66, value: 1, terrain: 'bay', korea: true,
    blurb: '여도 권관이 옥포 해전에서 좌척후장을 맡은 수군진입니다.',
    source: { title: '한국학중앙연구원: 고흥 여도진 성지', url: 'https://encykorea.aks.ac.kr/Article/E0004080' },
  },
  waegyo: {
    id: 'waegyo', name: '순천 왜교', hanja: '順天倭橋', lon: 127.58, lat: 34.91, value: 1, terrain: 'bay', korea: true,
    blurb: '1598년 조선·명 수군이 공격했으나 함락하지 못한 순천 왜성의 포구입니다.',
    source: { title: '한국학중앙연구원: 순천왜성', url: 'https://encykorea.aks.ac.kr/Article/E0032256' },
  },
  mijo: {
    id: 'mijo', name: '미조항진', hanja: '彌助項鎭', lon: 128.03, lat: 34.71, value: 1, terrain: 'island', korea: true,
    blurb: '명량 해전에서 미조항 첨사가 중군장을 맡은 남해도의 수군진입니다.',
    source: { title: '한국학중앙연구원: 남해군', url: 'https://encykorea.aks.ac.kr/Article/E0012272' },
  },
  namhaeseonso: {
    id: 'namhaeseonso', name: '선소포', hanja: '船所浦', lon: 127.91, lat: 34.85, value: 1, terrain: 'bay', korea: true,
    blurb: '1597년 겨울 일본군이 성을 쌓고 주둔한 남해의 포구입니다.',
    source: { title: '위키백과: 남해 선소왜성', url: 'https://ko.wikipedia.org/wiki/%EB%82%A8%ED%95%B4_%EC%84%A0%EC%86%8C%EC%99%9C%EC%84%B1' },
  },
  gyeonnaeryang: {
    id: 'gyeonnaeryang', name: '견내량', hanja: '見乃梁', lon: 128.47, lat: 34.88, value: 1, terrain: 'strait', korea: true,
    blurb: '1592년 일본 전선 70여 척을 한산도 앞바다로 끌어낸 해협입니다.',
    source: { title: '한국학중앙연구원: 한산도대첩', url: 'https://encykorea.aks.ac.kr/Article/E0061676' },
  },
  happo: {
    id: 'happo', name: '합포', hanja: '合浦', lon: 128.58, lat: 35.21, value: 1, terrain: 'bay', korea: true,
    blurb: '1592년 합포 해전에서 일본 전선 5척을 불태운 마산만의 포구입니다.',
    source: { title: '한국학중앙연구원: 합포해전', url: 'https://encykorea.aks.ac.kr/Article/E0062376' },
  },
  jukdo: {
    id: 'jukdo', name: '김해 죽도', hanja: '金海竹島', lon: 128.90, lat: 35.20, value: 1, terrain: 'bay', korea: true,
    blurb: '1592년 구로다 나가마사의 제3군이 상륙한 낙동강 하구의 섬입니다.',
    source: { title: '한국학중앙연구원: 김해성전투', url: 'https://encykorea.aks.ac.kr/Article/E0010983' },
  },
  gijang: {
    id: 'gijang', name: '기장 죽성', hanja: '機張竹城', lon: 129.24, lat: 35.24, value: 1, terrain: 'bay', korea: true,
    blurb: '일본군이 서생포와 부산을 잇는 보급 거점으로 삼은 포구입니다.',
    source: { title: '한국학중앙연구원: 기장 죽성리성', url: 'https://encykorea.aks.ac.kr/Article/E0008407' },
  },
  seosaengpo: {
    id: 'seosaengpo', name: '서생포', hanja: '西生浦', lon: 129.33, lat: 35.39, value: 1, terrain: 'bay', korea: true,
    blurb: '가토 기요마사가 주둔하고 사명대사가 강화 회담을 한 포구입니다.',
    source: { title: '위키백과: 서생포 만호진성', url: 'https://ko.wikipedia.org/wiki/%EC%84%9C%EC%83%9D%ED%8F%AC_%EB%A7%8C%ED%98%B8%EC%A7%84%EC%84%B1' },
  },
  ulsan: {
    id: 'ulsan', name: '울산 도산', hanja: '蔚山島山', lon: 129.36, lat: 35.55, value: 1, terrain: 'bay', korea: true,
    blurb: '조선·명 연합군이 두 차례 포위하고도 함락하지 못한 울산 왜성의 포구입니다.',
    source: { title: '한국학중앙연구원: 울산왜성', url: 'https://encykorea.aks.ac.kr/Article/E0040485' },
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
  // Added coastal stages leave every existing saved direct sailing order usable.
  ['myeongnyang', 'nokdo', 1], ['nokdo', 'balpo', 1], ['balpo', 'bangdap', 1], ['bangdap', 'yeosu', 1],
  ['nokdo', 'yeosu', 2], ['balpo', 'yeosu', 1], ['bangdap', 'noryang', 1],
  ['noryang', 'dangpo', 1], ['sacheon', 'dangpo', 1], ['dangpo', 'hansan', 1], ['dangpo', 'gabaeryang', 1], ['gabaeryang', 'geoje', 1], ['gabaeryang', 'hansan', 1],
  ['sacheon', 'danghangpo', 1], ['danghangpo', 'yulpo', 1], ['danghangpo', 'jepo', 1],
  ['geoje', 'yulpo', 1], ['yulpo', 'jangmunpo', 1], ['jangmunpo', 'yeongdeungpo', 1], ['yeongdeungpo', 'geoje', 1],
  ['jangmunpo', 'angolpo', 1], ['yeongdeungpo', 'jepo', 1], ['jepo', 'angolpo', 1],
  ['yeongdeungpo', 'cheonseongpo', 1], ['angolpo', 'cheonseongpo', 1], ['cheonseongpo', 'dadaepo', 1], ['dadaepo', 'busan', 1],
  ['mokpo', 'myeongnyang', 1], ['mokpo', 'nokdo', 2], ['mokpo', 'shandong', 3],
  // The Wando islands and the south Haenam coast, between Myeongnyang and Nokdo.
  ['eoranpo', 'myeongnyang', 1], ['eoranpo', 'ijin', 1], ['ijin', 'myeongnyang', 1], ['ijin', 'garipo', 1], ['garipo', 'gogeumdo', 1],
  ['gogeumdo', 'hoeryeongpo', 1], ['gogeumdo', 'nokdo', 1], ['hoeryeongpo', 'nokdo', 1],
  // The Goheung peninsula, Suncheon bay and Namhae island.
  ['yeodo', 'balpo', 1], ['yeodo', 'bangdap', 1], ['yeodo', 'waegyo', 1], ['waegyo', 'yeosu', 1], ['waegyo', 'noryang', 1],
  ['mijo', 'yeosu', 1], ['mijo', 'dangpo', 1], ['mijo', 'namhaeseonso', 1], ['namhaeseonso', 'noryang', 1], ['namhaeseonso', 'sacheon', 1],
  // The Gyeongsang coast: the strait east of Hansan, the head of Masan Bay and the Busan side ports.
  ['gyeonnaeryang', 'hansan', 1], ['gyeonnaeryang', 'dangpo', 1], ['gyeonnaeryang', 'yulpo', 1],
  ['happo', 'jepo', 1], ['happo', 'angolpo', 1], ['happo', 'yulpo', 1],
  ['jukdo', 'angolpo', 1], ['jukdo', 'dadaepo', 1], ['jukdo', 'busan', 1],
  ['gijang', 'busan', 1], ['gijang', 'seosaengpo', 1], ['seosaengpo', 'ulsan', 1], ['ulsan', 'busan', 2],
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

/** `joins` is the turn a commander takes up his post under the growth rules; absent for those of the opening fleets. */
export type CommanderDef = { id: string; faction: GrandFaction; name: string; title: string; portrait: string; level: number; joins?: number };

/**
 * The navies' named commanders. Those without `joins` lead the opening fleets; under the growth rules the others join in
 * the season they first held a naval command in the war (see dateOf in economy.ts: the invasion of 1597 is turn 20).
 */
export const COMMANDERS: CommanderDef[] = [
  { id: 'yi', faction: 'joseon', name: '이순신', title: '전라좌수사', portrait: 'portrait_yi', level: 3 },
  { id: 'won', faction: 'joseon', name: '원균', title: '경상우수사', portrait: 'portrait_won', level: 1 },
  { id: 'eokgi', faction: 'joseon', name: '이억기', title: '전라우수사', portrait: 'portrait_eokgi', level: 2 },
  { id: 'kwon', faction: 'joseon', name: '권준', title: '순천부사', portrait: 'portrait_kwon', level: 1 },
  { id: 'eo', faction: 'joseon', name: '어영담', title: '광양현감', portrait: 'portrait_eo', level: 2, joins: 1 },
  { id: 'jeongun', faction: 'joseon', name: '정운', title: '녹도만호', portrait: 'portrait_jeongun', level: 1, joins: 1 },
  { id: 'kimwan', faction: 'joseon', name: '김완', title: '사도첨사', portrait: 'portrait_kimwan', level: 1, joins: 1 },
  { id: 'nadaeyong', faction: 'joseon', name: '나대용', title: '군관', portrait: 'portrait_nadaeyong', level: 1, joins: 1 },
  { id: 'songhuirip', faction: 'joseon', name: '송희립', title: '군관', portrait: 'portrait_songhuirip', level: 1, joins: 1 },
  { id: 'iyeongnam', faction: 'joseon', name: '이영남', title: '율포만호', portrait: 'portrait_iyeongnam', level: 1, joins: 2 },
  { id: 'baeseol', faction: 'joseon', name: '배설', title: '경상우수사', portrait: 'portrait_baeseol', level: 2, joins: 20 },
  { id: 'anwi', faction: 'joseon', name: '안위', title: '거제현령', portrait: 'portrait_anwi', level: 1, joins: 21 },
  { id: 'iwan', faction: 'joseon', name: '이완', title: '군관', portrait: 'portrait_iwan', level: 1, joins: 22 },
  { id: 'wakisaka', faction: 'japan', name: '와키자카 야스하루', title: '수군 대장', portrait: 'portrait_wakisaka', level: 2 },
  { id: 'kuki', faction: 'japan', name: '구키 요시타카', title: '수군 장수', portrait: 'portrait_kuki', level: 2 },
  { id: 'kato', faction: 'japan', name: '가토 요시아키', title: '수군 장수', portrait: 'portrait_kato', level: 2 },
  { id: 'kurushima', faction: 'japan', name: '구루시마 미치후사', title: '무라카미 수군', portrait: 'portrait_kurushima', level: 1 },
  { id: 'todo', faction: 'japan', name: '도도 다카토라', title: '수군 장수', portrait: 'portrait_todo', level: 1, joins: 1 },
  { id: 'michiyuki', faction: 'japan', name: '구루시마 미치유키', title: '무라카미 수군', portrait: 'portrait_michiyuki', level: 1, joins: 1 },
  { id: 'konishi', faction: 'japan', name: '고니시 유키나가', title: '선봉 대장', portrait: 'portrait_konishi', level: 2, joins: 20 },
  { id: 'shimazu', faction: 'japan', name: '시마즈 요시히로', title: '사쓰마 영주', portrait: 'portrait_shimazu', level: 2, joins: 20 },
  { id: 'tachibana', faction: 'japan', name: '다치바나 무네시게', title: '야나가와 영주', portrait: 'portrait_tachibana', level: 2, joins: 26 },
  { id: 'chenlin', faction: 'ming', name: '진린', title: '수군 도독', portrait: 'portrait_chenlin', level: 2 },
  { id: 'deng', faction: 'ming', name: '등자룡', title: '수군 부총병', portrait: 'portrait_deng', level: 2 },
];

/** Strategic starting positions, not simultaneous historical ownership of every port. */
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
    nokdo: 'joseon', balpo: 'joseon', bangdap: 'joseon', dangpo: 'joseon', gabaeryang: 'joseon', mokpo: 'joseon',
    danghangpo: 'japan', yeongdeungpo: 'japan', yulpo: 'japan', jangmunpo: 'japan', jepo: 'japan', cheonseongpo: 'japan', dadaepo: 'japan',
    gogeumdo: 'joseon', hoeryeongpo: 'joseon', eoranpo: 'joseon', ijin: 'joseon', garipo: 'joseon', yeodo: 'joseon', waegyo: 'joseon', mijo: 'joseon', namhaeseonso: 'joseon', gyeonnaeryang: 'joseon',
    happo: 'japan', jukdo: 'japan', gijang: 'japan', seosaengpo: 'japan', ulsan: 'japan',
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
    nokdo: { shipyard: 1 }, balpo: { battery: 1 }, bangdap: { camp: 1 }, gabaeryang: { dock: 1 }, mokpo: { beacon: 1 },
    yeongdeungpo: { shipyard: 1 }, dadaepo: { battery: 1 }, cheonseongpo: { camp: 1 }, jepo: { dock: 1 },
    garipo: { camp: 1 }, yeodo: { battery: 1 }, waegyo: { dock: 1 }, happo: { battery: 1 }, jukdo: { camp: 1 }, gijang: { dock: 1 },
  },
  fleets: [
    { faction: 'joseon', at: 'yeosu', name: '전라좌수영 본대', ships: { panokseon: 8, hyeopseon: 5 }, commander: 'yi' },
    { faction: 'joseon', at: 'hansan', name: '한산 함대', ships: { panokseon: 4, hyeopseon: 3 }, commander: 'kwon' },
    { faction: 'joseon', at: 'geoje', name: '경상우수영', ships: { panokseon: 2, hyeopseon: 2 }, commander: 'won' },
    { faction: 'japan', at: 'busan', name: '부산 함대', ships: { atakebune: 10, sekibune: 13, kobaya: 13 }, commander: 'wakisaka' },
    { faction: 'japan', at: 'busan', name: '구키 함대', ships: { atakebune: 6, sekibune: 10, kobaya: 6 }, commander: 'kuki' },
    { faction: 'japan', at: 'nagoya', name: '나고야 후속 함대', ships: { atakebune: 10, sekibune: 10, kobaya: 10 }, commander: 'kato' },
    { faction: 'ming', at: 'liaodong', name: '요동 함대', ships: { mingship: 6, mingsmall: 8 }, commander: 'chenlin' },
  ],
  gold: { joseon: 900, japan: 1000, ming: 1500 },
};
