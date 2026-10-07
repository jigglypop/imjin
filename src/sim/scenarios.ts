import { Battle } from './battle';
import type { ShipKind, Squadron, Team } from './types';
import {
  ANGOLPO_TERRAIN,
  BUSAN_TERRAIN,
  CHILCHEON_TERRAIN,
  DANGPO_TERRAIN,
  HANSAN_TERRAIN,
  MYEONGNYANG_TERRAIN,
  NORYANG_TERRAIN,
  OKPO_TERRAIN,
  SACHEON_TERRAIN,
  type TerrainSpec,
} from '../terrain/generate';
import type { SkyPresetName } from '../render/sky';
import type { SeaStateName } from '../ocean/waves';

export type ScenarioId = 'okpo' | 'sacheon' | 'dangpo' | 'hansan' | 'angolpo' | 'busan' | 'chilcheon' | 'myeongnyang' | 'noryang';

export type Commander = { name: string; title: string; figure: string; portrait: string; banner: string };

export type ScenarioInfo = {
  id: ScenarioId;
  title: string;
  hanja: string;
  date: string;
  season: string;
  place: string;
  difficulty: string;
  summary: string;
  result: string;
  forces: { joseon: string; japan: string };
  sky: SkyPresetName;
  sea: SeaStateName;
  night: boolean;
  terrain: TerrainSpec;
  joseon: Commander;
  japan: Commander;
  map: { x: number; y: number };
  arrows: { from: [number, number]; to: [number, number]; team: Team }[];
  view: { tx: number; tz: number; dir: number; dist: number; pitch: number };
};

type Place = (x: number, z: number) => { x: number; z: number };
type Spot = { x: number; z: number; h: number };
type LandFn = (x: number, z: number) => number;

const YI: Commander = { name: '이순신', title: '전라좌도 수군절도사', figure: 'fig_yi', portrait: 'portrait_yi', banner: '李' };
const YI_TONGJE: Commander = { ...YI, title: '삼도수군통제사' };

export const SCENARIOS: Record<ScenarioId, ScenarioInfo> = {
  okpo: {
    id: 'okpo',
    title: '옥포 해전',
    hanja: '玉浦海戰',
    date: '1592년 5월 7일',
    season: '임진년 늦봄',
    place: '거제 옥포만',
    difficulty: '쉬움',
    summary:
      '전쟁이 시작되고 스무날, 조선 수군의 첫 출전이다. 도도 다카토라의 왜선들이 옥포 포구에 배를 대고 마을을 약탈하고 있다. 이순신은 "가벼이 움직이지 말고 산처럼 침착하라" 이르고 포구로 돌입한다.',
    result: '왜선 26척 격파, 아군 손실 없음',
    forces: { joseon: '판옥선 28 · 협선 17', japan: '왜선 50여 척 (정박)' },
    sky: 'afternoon',
    sea: 'rough',
    night: false,
    terrain: OKPO_TERRAIN,
    joseon: YI,
    japan: { name: '도도 다카토라', title: '수군 장수', figure: 'fig_todo', portrait: 'portrait_todo', banner: '藤堂' },
    map: { x: 0.64, y: 0.6 },
    arrows: [{ from: [0.71, 0.66], to: [0.645, 0.605], team: 'joseon' }],
    view: { tx: 2900, tz: 300, dir: Math.PI, dist: 1150, pitch: 0.3 },
  },
  sacheon: {
    id: 'sacheon',
    title: '사천 해전',
    hanja: '泗川海戰',
    date: '1592년 5월 29일',
    season: '임진년 초여름',
    place: '사천 선창',
    difficulty: '보통',
    summary:
      '거북선이 처음으로 바다에 나섰다. 언덕 위 왜군의 조총이 포구를 지키니, 조선 수군은 물러나는 척하여 적선을 끌어낸다. 밀물이 차오르는 순간 거북선이 용머리로 연기를 뿜으며 돌격한다. 이 싸움에서 이순신은 왼쪽 어깨에 총탄을 맞았다.',
    result: '왜선 13척 전부 격파',
    forces: { joseon: '판옥선 25 · 거북선 1', japan: '대선 4 · 중선 9' },
    sky: 'day',
    sea: 'rough',
    night: false,
    terrain: SACHEON_TERRAIN,
    joseon: YI,
    japan: { name: '사천 주둔 왜군', title: '선창 수비대', figure: 'fig_japan', portrait: 'portrait_japan', banner: '倭' },
    map: { x: 0.5, y: 0.56 },
    arrows: [{ from: [0.52, 0.64], to: [0.5, 0.565], team: 'joseon' }],
    view: { tx: 0, tz: 900, dir: -Math.PI / 2, dist: 1050, pitch: 0.3 },
  },
  dangpo: {
    id: 'dangpo',
    title: '당포 해전',
    hanja: '唐浦海戰',
    date: '1592년 6월 2일',
    season: '임진년 여름',
    place: '통영 당포',
    difficulty: '보통',
    summary:
      '당포 선창에 왜선 21척이 정박했다. 층루를 높이 세운 대장선 위에서 구루시마 미치유키가 붉은 일산 아래 지휘한다. 거북선이 대장선을 들이받고 판옥선들이 총통을 쏘아붙이니, 적장은 화살에 맞아 쓰러진다.',
    result: '왜선 21척 전부 격파, 적장 구루시마 미치유키 전사',
    forces: { joseon: '판옥선 24 · 거북선 2', japan: '대선 9 · 중소선 12' },
    sky: 'afternoon',
    sea: 'rough',
    night: false,
    terrain: DANGPO_TERRAIN,
    joseon: YI,
    japan: { name: '구루시마 미치유키', title: '수군 장수', figure: 'fig_kurushima', portrait: 'portrait_kurushima', banner: '來島' },
    map: { x: 0.56, y: 0.63 },
    arrows: [{ from: [0.6, 0.68], to: [0.565, 0.635], team: 'joseon' }],
    view: { tx: 1200, tz: 1300, dir: -2.2, dist: 1050, pitch: 0.3 },
  },
  hansan: {
    id: 'hansan',
    title: '한산도 대첩',
    hanja: '閑山島大捷',
    date: '1592년 7월 8일',
    season: '임진년 여름',
    place: '견내량 · 한산도 앞바다',
    difficulty: '보통',
    summary:
      '견내량의 좁은 물길에 정박한 와키자카 야스하루의 함대를 넓은 바다로 끌어낸다. 판옥선 몇 척이 미끼가 되어 물러나면, 기다리던 함대가 학의 날개처럼 펼쳐 적을 감싸고 총통을 퍼붓는다.',
    result: '왜선 59척 격침·나포, 14척 도주',
    forces: { joseon: '판옥선 53 · 거북선 3', japan: '대선 36 · 중선 24 · 소선 13' },
    sky: 'afternoon',
    sea: 'rough',
    night: false,
    terrain: HANSAN_TERRAIN,
    joseon: YI,
    japan: { name: '와키자카 야스하루', title: '수군 대장', figure: 'fig_wakisaka', portrait: 'portrait_wakisaka', banner: '脇坂' },
    map: { x: 0.58, y: 0.6 },
    arrows: [
      { from: [0.66, 0.5], to: [0.6, 0.58], team: 'japan' },
      { from: [0.5, 0.66], to: [0.57, 0.61], team: 'joseon' },
    ],
    view: { tx: 300, tz: 120, dir: -0.75, dist: 1150, pitch: 0.3 },
  },
  angolpo: {
    id: 'angolpo',
    title: '안골포 해전',
    hanja: '安骨浦海戰',
    date: '1592년 7월 10일',
    season: '임진년 여름',
    place: '진해 안골포',
    difficulty: '어려움',
    summary:
      '한산도의 패보를 들은 구키 요시타카와 가토 요시아키는 좁고 얕은 안골포 깊숙이 배를 숨기고 나오지 않는다. 판옥선은 포구에 들어갈 수 없으니, 여러 척이 번갈아 드나들며 총통을 쏘아 정박한 적선을 하나씩 깨뜨린다.',
    result: '왜선 20여 척 격파, 남은 적은 밤에 도주',
    forces: { joseon: '판옥선 52 · 거북선 2', japan: '대선 21 · 중선 15 · 소선 6' },
    sky: 'overcast',
    sea: 'rough',
    night: false,
    terrain: ANGOLPO_TERRAIN,
    joseon: YI,
    japan: { name: '구키 요시타카', title: '수군 대장', figure: 'fig_kuki', portrait: 'portrait_kuki', banner: '九鬼' },
    map: { x: 0.67, y: 0.5 },
    arrows: [{ from: [0.63, 0.58], to: [0.665, 0.505], team: 'joseon' }],
    view: { tx: 200, tz: 900, dir: -Math.PI / 2, dist: 1150, pitch: 0.3 },
  },
  busan: {
    id: 'busan',
    title: '부산포 해전',
    hanja: '釜山浦海戰',
    date: '1592년 9월 1일',
    season: '임진년 가을',
    place: '부산포',
    difficulty: '어려움',
    summary:
      '왜군의 본거지 부산포에 470여 척이 정박해 있다. 장사진으로 포구에 돌입한 조선 수군은 해안의 조총 사격을 받으며 정박한 적선을 차례로 불태운다. 선봉장 정운이 이 싸움에서 전사했다.',
    result: '왜선 100여 척 격파',
    forces: { joseon: '판옥선 71 · 거북선 3 · 협선 92', japan: '정박선 470여 척' },
    sky: 'day',
    sea: 'rough',
    night: false,
    terrain: BUSAN_TERRAIN,
    joseon: YI,
    japan: { name: '부산 왜군', title: '주둔 수군', figure: 'fig_japan', portrait: 'portrait_japan', banner: '倭' },
    map: { x: 0.77, y: 0.47 },
    arrows: [{ from: [0.66, 0.6], to: [0.76, 0.48], team: 'joseon' }],
    view: { tx: -4200, tz: 3200, dir: -0.77, dist: 1000, pitch: 0.3 },
  },
  chilcheon: {
    id: 'chilcheon',
    title: '칠천량 해전',
    hanja: '漆川梁海戰',
    date: '1597년 7월 16일',
    season: '정유년 여름 · 새벽',
    place: '거제 칠천량',
    difficulty: '극악',
    summary:
      '이순신이 투옥된 뒤 통제사가 된 원균은 칠천량에 함대를 정박한다. 새벽 어둠 속에 불을 끈 왜선 수백 척이 사방에서 다가온다. 역사 속 조선 수군은 이 밤에 무너졌다. 등불을 끄고 포위를 뚫어 한 척이라도 더 살려내라.',
    result: '조선 수군 궤멸, 배설의 판옥선 12척만 탈출',
    forces: { joseon: '판옥선 134 · 거북선 3', japan: '왜선 500여 척 (야습)' },
    sky: 'night',
    sea: 'rough',
    night: true,
    terrain: CHILCHEON_TERRAIN,
    joseon: { name: '원균', title: '삼도수군통제사', figure: 'fig_won', portrait: 'portrait_won', banner: '元' },
    japan: { name: '도도 다카토라', title: '수군 대장', figure: 'fig_todo', portrait: 'portrait_todo', banner: '藤堂' },
    map: { x: 0.62, y: 0.56 },
    arrows: [
      { from: [0.66, 0.48], to: [0.625, 0.55], team: 'japan' },
      { from: [0.6, 0.64], to: [0.618, 0.57], team: 'japan' },
    ],
    view: { tx: 650, tz: 1500, dir: -Math.PI / 2, dist: 950, pitch: 0.3 },
  },
  myeongnyang: {
    id: 'myeongnyang',
    title: '명량 해전',
    hanja: '鳴梁海戰',
    date: '1597년 9월 16일',
    season: '정유년 가을',
    place: '울돌목',
    difficulty: '매우 어려움',
    summary:
      '칠천량에서 수군이 무너지고 남은 배는 열세 척. 울돌목의 거센 물살 앞에서 대장선이 홀로 133척을 막아선다. 물길이 뒤집히는 순간이 승부를 가른다. "신에게는 아직 열두 척의 배가 남아 있사옵니다."',
    result: '왜선 31척 격파, 적 퇴각',
    forces: { joseon: '판옥선 13', japan: '왜선 133척' },
    sky: 'overcast',
    sea: 'rough',
    night: false,
    terrain: MYEONGNYANG_TERRAIN,
    joseon: YI_TONGJE,
    japan: { name: '도도 다카토라', title: '수군 대장', figure: 'fig_todo', portrait: 'portrait_todo', banner: '藤堂' },
    map: { x: 0.33, y: 0.64 },
    arrows: [{ from: [0.42, 0.62], to: [0.34, 0.64], team: 'japan' }],
    view: { tx: -1500, tz: 0, dir: 0, dist: 900, pitch: 0.24 },
  },
  noryang: {
    id: 'noryang',
    title: '노량 해전',
    hanja: '露梁海戰',
    date: '1598년 11월 19일',
    season: '무술년 겨울 · 새벽',
    place: '노량 해협 · 관음포',
    difficulty: '매우 어려움',
    summary:
      '전쟁의 마지막 밤. 순천에 갇힌 고니시를 구하려 시마즈 요시히로의 함대 500척이 노량 해협으로 밀려든다. 조선 수군과 진린의 명 수군이 해협 끝에서 기다린다. 횃불과 불화살이 어둠을 가르고, 새벽녘 이순신은 "싸움이 급하니 나의 죽음을 알리지 말라" 하였다.',
    result: '왜선 200여 척 격파, 이순신 전사',
    forces: { joseon: '판옥선 60 · 명 전선 63', japan: '왜선 500여 척' },
    sky: 'night',
    sea: 'rough',
    night: true,
    terrain: NORYANG_TERRAIN,
    joseon: YI_TONGJE,
    japan: { name: '시마즈 요시히로', title: '사쓰마 번주', figure: 'fig_shimazu', portrait: 'portrait_shimazu', banner: '島津' },
    map: { x: 0.44, y: 0.61 },
    arrows: [
      { from: [0.5, 0.6], to: [0.45, 0.61], team: 'japan' },
      { from: [0.4, 0.63], to: [0.435, 0.615], team: 'joseon' },
    ],
    view: { tx: -1700, tz: 0, dir: 0, dist: 1000, pitch: 0.27 },
  },
};

export const SCENARIO_ORDER: ScenarioId[] = ['okpo', 'sacheon', 'dangpo', 'hansan', 'angolpo', 'busan', 'chilcheon', 'myeongnyang', 'noryang'];

const PORTRAITS: [string, string][] = [
  ['이순신', 'portrait_yi'],
  ['원균', 'portrait_won'],
  ['이억기', 'portrait_eokgi'],
  ['정운', 'portrait_jeongun'],
  ['어영담', 'portrait_eo'],
  ['권준', 'portrait_kwon'],
  ['안위', 'portrait_anwi'],
  ['진린', 'portrait_chenlin'],
  ['등자룡', 'portrait_deng'],
  ['와키자카', 'portrait_wakisaka'],
  ['도도', 'portrait_todo'],
  ['구키', 'portrait_kuki'],
  ['가토', 'portrait_kato'],
  ['구루시마', 'portrait_kurushima'],
  ['시마즈', 'portrait_shimazu'],
  ['고니시', 'portrait_konishi'],
];

function portraitFor(team: Team, commander: string) {
  for (const [name, portrait] of PORTRAITS) if (commander.includes(name)) return portrait;
  return team === 'japan' ? 'portrait_japan' : 'portrait_admiral';
}

function cardFor(kind: ShipKind) {
  return `card_${kind === 'hyeopseon' ? 'panokseon' : kind === 'kobaya' ? 'sekibune' : kind.startsWith('ming') ? 'panokseon' : kind}`;
}

function grid(cx: number, cz: number, heading: number, count: number, cols: number, spacingX: number, spacingZ: number, jitter: number, rand: () => number) {
  const out: Spot[] = [];
  const c = Math.cos(heading);
  const s = Math.sin(heading);
  const rows = Math.ceil(count / cols);
  for (let i = 0; i < count; i += 1) {
    const row = Math.floor(i / cols);
    const col = i % cols;
    const along = (row - (rows - 1) / 2) * -spacingX + (rand() - 0.5) * jitter;
    const across = (col - (cols - 1) / 2) * spacingZ + (row % 2) * spacingZ * 0.5 + (rand() - 0.5) * jitter;
    out.push({ x: cx + c * along - s * across, z: cz + s * along + c * across, h: heading + (rand() - 0.5) * 0.15 });
  }
  return out;
}

function arc(cx: number, cz: number, radius: number, center: number, span: number, count: number) {
  return Array.from({ length: count }, (_, i) => {
    const a = center + (count === 1 ? 0 : (i / (count - 1) - 0.5) * span);
    return { x: cx + Math.cos(a) * radius, z: cz + Math.sin(a) * radius, h: a + Math.PI / 2 };
  });
}

export function buildScenario(id: ScenarioId, axis: number, seed = 1592, land: LandFn = () => -50) {
  const b = new Battle(seed);
  const ca = Math.cos(axis);
  const sa = Math.sin(axis);
  const place: Place = (x, z) => ({ x: x * ca - z * sa, z: x * sa + z * ca });
  const rand = () => b.random();
  const taken: { x: number; z: number; r: number }[] = [];
  const free = (x: number, z: number, r: number) => {
    if (land(x, z) > -4) return false;
    for (const t of taken) if ((t.x - x) ** 2 + (t.z - z) ** 2 < (t.r + r) ** 2) return false;
    return true;
  };
  const settle = (p: Spot, r: number): Spot => {
    if (free(p.x, p.z, r)) return p;
    for (let ring = 1; ring < 40; ring += 1) {
      const rad = ring * r * 0.8;
      for (let k = 0; k < 10; k += 1) {
        const a = (k / 10) * Math.PI * 2 + ring;
        const x = p.x + Math.cos(a) * rad;
        const z = p.z + Math.sin(a) * rad;
        if (free(x, z, r)) return { x, z, h: p.h };
      }
    }
    return p;
  };
  const squad = (team: Team, name: string, cmd: string, kind: ShipKind) => b.addSquadron(team, name, cmd, portraitFor(team, cmd), cardFor(kind));
  const ship = (sq: Squadron, kind: ShipKind, p: Spot, name: string, flagship = false, variant = 0) => {
    const r = kind === 'panokseon' || kind === 'atakebune' || kind === 'mingship' ? 22 : kind === 'sekibune' || kind === 'geobukseon' || kind === 'mingsmall' ? 15 : 9;
    const spot = settle(p, r);
    taken.push({ x: spot.x, z: spot.z, r });
    const w = place(spot.x, spot.z);
    return b.addShip(kind, w.x, w.z, spot.h + axis, name, sq, flagship, variant);
  };
  const panoVariant = (i: number, flag: boolean) => (flag ? 0 : 1 + (i % 2));
  const line = (sq: Squadron, kind: ShipKind, spots: Spot[], prefix: string, flagIndex = -1) =>
    spots.map((p, i) => ship(sq, kind, p, i === flagIndex ? `${prefix} 대장선` : `${prefix} ${i + 1}호`, i === flagIndex, kind === 'panokseon' ? panoVariant(i, i === flagIndex) : 0));
  const slotAll = (sq: Squadron) => {
    for (const sid of sq.shipIds) {
      const s = b.get(sid)!;
      b.setOrder([sid], { type: 'slot', x: s.x, z: s.z, face: s.heading });
    }
  };
  const anchorage = (sq: Squadron, count: number, cx: number, cz: number, rx: number, rz: number, kindOf: (i: number) => ShipKind, facing: number) => {
    for (let i = 0; i < count; i += 1) {
      let p: Spot = { x: cx, z: cz, h: facing };
      for (let tries = 0; tries < 200; tries += 1) {
        const a = rand() * Math.PI * 2;
        const r = Math.sqrt(rand());
        const x = cx + Math.cos(a) * r * rx;
        const z = cz + Math.sin(a) * r * rz;
        if (free(x, z, 18)) {
          p = { x, z, h: facing + (rand() - 0.5) * 0.9 };
          break;
        }
      }
      const s = ship(sq, kindOf(i), p, `${sq.name} ${i + 1}`, i === 0);
      s.order = { type: 'anchor' };
      s.speed = 0;
    }
  };
  const mix = (a: number, s: number) => (i: number): ShipKind => {
    const f = (((i * 0.61803) % 1) + 1) % 1;
    return f < a ? 'atakebune' : f < a + s ? 'sekibune' : 'kobaya';
  };

  if (id === 'hansan') {
    const cx = 700;
    const cz = -250;
    const facing = Math.PI + Math.atan2(-2400 - cz, 3000 - cx);
    const allArc = arc(cx, cz, 1150, facing, 2.25, 53);
    const sqYi = squad('joseon', '전라좌수영 본대', '통제사 이순신', 'panokseon');
    const sqTurtle = squad('joseon', '돌격 거북선', '돌격장 이기남', 'geobukseon');
    const sqEok = squad('joseon', '전라우수영', '전라우수사 이억기', 'panokseon');
    const sqWon = squad('joseon', '경상우수영', '경상우수사 원균', 'panokseon');
    line(sqWon, 'panokseon', allArc.slice(0, 7), '경상우수영');
    line(sqYi, 'panokseon', allArc.slice(7, 28), '좌수영', 10);
    line(sqEok, 'panokseon', allArc.slice(28), '우수영', 0);
    const turtleAt = { x: cx - 350, z: cz };
    line(sqTurtle, 'geobukseon', [-1, 0, 1].map((k) => ({ x: turtleAt.x + 160, z: turtleAt.z + k * 90, h: facing + Math.PI })), '거북선');
    for (const sq of [sqYi, sqEok, sqWon]) slotAll(sq);
    const jHeading = Math.atan2(cz - -2400, cx - 3000);
    const japanSquads = [
      { name: '와키자카 본대', cmd: '와키자카 야스하루', kind: 'atakebune' as ShipKind, n: 12 },
      { name: '와키자카 사베에 대', cmd: '와키자카 사베에', kind: 'atakebune' as ShipKind, n: 12 },
      { name: '와타나베 대', cmd: '와타나베 시치에몬', kind: 'atakebune' as ShipKind, n: 12 },
      { name: '마나베 대', cmd: '마나베 사마노조', kind: 'sekibune' as ShipKind, n: 12 },
      { name: '중선 후위', cmd: '이름 없는 장수', kind: 'sekibune' as ShipKind, n: 12 },
      { name: '소선 척후', cmd: '척후장', kind: 'kobaya' as ShipKind, n: 13 },
    ];
    japanSquads.forEach((g, gi) => {
      const sq = squad('japan', g.name, g.cmd, g.kind);
      const back = gi * 230;
      const cxj = 3000 - Math.cos(jHeading) * back + (gi % 2 ? 120 : -120) * Math.sin(jHeading);
      const czj = -2400 - Math.sin(jHeading) * back - (gi % 2 ? 120 : -120) * Math.cos(jHeading);
      const spacing = g.kind === 'atakebune' ? 70 : g.kind === 'sekibune' ? 50 : 34;
      line(sq, g.kind, grid(cxj, czj, jHeading, g.n, 4, spacing, spacing * 0.9, 12, rand), g.name, gi === 0 ? 0 : -1);
    });
    b.retreatBelow = 0.22;
  } else if (id === 'busan') {
    const harborShore = -900;
    const perSquad = [40, 40, 39, 39, 39, 39, 39, 39, 39, 39, 39, 39];
    for (let q = 0; q < perSquad.length; q += 1) {
      const sq = squad('japan', `부산포 정박 ${q + 1}진`, '왜장', q % 3 === 0 ? 'atakebune' : 'sekibune');
      const n = perSquad[q]!;
      const xs = -3100 + q * 520;
      for (let i = 0; i < n; i += 1) {
        const row = i % 4;
        const col = Math.floor(i / 4);
        const kind: ShipKind = i % 4 === 0 ? 'atakebune' : i % 4 === 3 ? 'kobaya' : 'sekibune';
        const s = ship(sq, kind, { x: xs + col * 48 + (rand() - 0.5) * 10, z: harborShore + 120 + row * 46 + (rand() - 0.5) * 10, h: Math.PI / 2 + (rand() - 0.5) * 0.4 }, `${sq.name} ${i + 1}`, i === 0);
        s.order = { type: 'anchor' };
        s.speed = 0;
      }
    }
    const head = Math.atan2(harborShore + 300 - 3600, -500 - -4800);
    const squads = [
      { name: '선봉', cmd: '녹도만호 정운', kind: 'panokseon' as ShipKind, n: 8 },
      { name: '전라좌수영 본대', cmd: '통제사 이순신', kind: 'panokseon' as ShipKind, n: 13 },
      { name: '돌격 거북선', cmd: '돌격장 이기남', kind: 'geobukseon' as ShipKind, n: 3 },
      { name: '전라우수영 전위', cmd: '전라우수사 이억기', kind: 'panokseon' as ShipKind, n: 20 },
      { name: '전라우수영 후위', cmd: '우수영 중군', kind: 'panokseon' as ShipKind, n: 20 },
      { name: '경상우수영', cmd: '경상우수사 원균', kind: 'panokseon' as ShipKind, n: 10 },
      { name: '좌수영 협선대', cmd: '협선장', kind: 'hyeopseon' as ShipKind, n: 30 },
      { name: '우수영 협선대', cmd: '협선장', kind: 'hyeopseon' as ShipKind, n: 42 },
      { name: '경상 협선대', cmd: '협선장', kind: 'hyeopseon' as ShipKind, n: 20 },
    ];
    squads.forEach((g, gi) => {
      const sq = squad('joseon', g.name, g.cmd, g.kind);
      const back = gi * 210;
      const cxj = -4600 - Math.cos(head) * back;
      const czj = 3600 - Math.sin(head) * back;
      const spacing = g.kind === 'hyeopseon' ? 30 : 60;
      const cols = g.kind === 'hyeopseon' ? 6 : 3;
      line(sq, g.kind, grid(cxj, czj, head, g.n, cols, spacing, spacing * 0.95, 8, rand), g.name, gi === 1 ? 0 : -1);
    });
    b.retreatBelow = 0;
  } else if (id === 'myeongnyang') {
    const yi = squad('joseon', '대장선', '통제사 이순신', 'panokseon');
    const rest = squad('joseon', '잔여 함대', '거제현령 안위 · 중군장 김응함', 'panokseon');
    ship(yi, 'panokseon', { x: -2050, z: 0, h: 0 }, '통제사 대장선', true, 0);
    line(rest, 'panokseon', arc(-2900, 0, 260, Math.PI, 1.6, 12), '판옥선');
    for (const sid of rest.shipIds) {
      const s = b.get(sid)!;
      b.setOrder([sid], { type: 'slot', x: s.x, z: s.z, face: axis });
    }
    const japanSquads = [
      { name: '도도 선봉', cmd: '도도 다카토라', n: 22 },
      { name: '구루시마 대', cmd: '구루시마 미치후사', n: 22 },
      { name: '와키자카 대', cmd: '와키자카 야스하루', n: 22 },
      { name: '가토 대', cmd: '가토 요시아키', n: 22 },
      { name: '간 대', cmd: '간 미치나가', n: 22 },
      { name: '후위', cmd: '모리 다카마사', n: 23 },
    ];
    japanSquads.forEach((g, gi) => {
      const kind: ShipKind = gi % 3 === 0 ? 'atakebune' : 'sekibune';
      const sq = squad('japan', g.name, g.cmd, kind);
      const x = 1400 + gi * 520;
      line(sq, kind, grid(x, 0, Math.PI, g.n, 5, gi % 3 === 0 ? 70 : 48, 42, 10, rand), g.name, 0);
    });
    b.retreatBelow = 0.75;
    b.tide = (t) => {
      const turn = 300;
      const k = Math.max(-1, Math.min(1, (t - turn) / 40));
      const speed = k < 0 ? -1.6 * Math.min(1, -k * 1.4) : 2.2 * k;
      return { x: speed * ca, z: speed * sa };
    };
  } else if (id === 'okpo') {
    const anchored = [squad('japan', '도도 본대', '도도 다카토라', 'atakebune'), squad('japan', '옥포 정박 2진', '왜장', 'sekibune'), squad('japan', '옥포 정박 3진', '왜장', 'sekibune')];
    anchorage(anchored[0]!, 18, -1500, 150, 650, 480, mix(0.5, 0.4), 0);
    anchorage(anchored[1]!, 17, -1100, -300, 600, 420, mix(0.3, 0.5), 0.3);
    anchorage(anchored[2]!, 15, -1050, 650, 560, 380, mix(0.2, 0.5), -0.3);
    const head = Math.PI;
    const sqYi = squad('joseon', '전라좌수영 본대', '좌수사 이순신', 'panokseon');
    const sqJung = squad('joseon', '중위 · 녹도', '녹도만호 정운', 'panokseon');
    const sqWon = squad('joseon', '경상우수영', '경상우수사 원균', 'panokseon');
    const sqHyeop = squad('joseon', '협선대', '협선장', 'hyeopseon');
    line(sqYi, 'panokseon', grid(2700, 300, head, 14, 7, 70, 62, 10, rand), '좌수영', 3);
    line(sqJung, 'panokseon', grid(3100, -380, head, 10, 5, 70, 62, 10, rand), '중위');
    line(sqWon, 'panokseon', grid(3150, 980, head, 4, 4, 70, 62, 10, rand), '경상우수영');
    line(sqHyeop, 'hyeopseon', grid(3600, 300, head, 17, 6, 34, 32, 8, rand), '협선');
    b.retreatBelow = 0.45;
  } else if (id === 'sacheon') {
    const sq1 = squad('japan', '사천 선창 대선', '왜장', 'atakebune');
    const sq2 = squad('japan', '사천 선창 중선', '왜장', 'sekibune');
    anchorage(sq1, 4, -350, -2900, 380, 520, () => 'atakebune', Math.PI / 2);
    anchorage(sq2, 9, -250, -2500, 520, 700, () => 'sekibune', Math.PI / 2);
    const head = -Math.PI / 2;
    const sqYi = squad('joseon', '전라좌수영 본대', '좌수사 이순신', 'panokseon');
    const sqTurtle = squad('joseon', '돌격 거북선', '돌격장 이기남', 'geobukseon');
    const sqJung = squad('joseon', '중위장', '광양현감 어영담', 'panokseon');
    const sqWon = squad('joseon', '경상우수영', '경상우수사 원균', 'panokseon');
    line(sqYi, 'panokseon', grid(0, 1300, head, 12, 6, 70, 64, 10, rand), '좌수영', 2);
    line(sqJung, 'panokseon', grid(-700, 1750, head, 10, 5, 70, 64, 10, rand), '중위');
    line(sqWon, 'panokseon', grid(700, 1750, head, 3, 3, 70, 64, 10, rand), '경상우수영');
    line(sqTurtle, 'geobukseon', [{ x: 0, z: 950, h: head }], '거북선');
    b.retreatBelow = 0;
  } else if (id === 'dangpo') {
    const sqFlag = squad('japan', '구루시마 대장선단', '구루시마 미치유키', 'atakebune');
    const sqRest = squad('japan', '당포 정박선', '왜장', 'sekibune');
    anchorage(sqFlag, 9, -1350, -2100, 420, 380, () => 'atakebune', 0.6);
    anchorage(sqRest, 12, -1050, -1650, 520, 420, (i) => (i % 2 ? 'sekibune' : 'kobaya'), 0.6);
    const head = Math.atan2(-1900 - 1300, -1200 - 1100);
    const sqYi = squad('joseon', '전라좌수영 본대', '좌수사 이순신', 'panokseon');
    const sqTurtle = squad('joseon', '돌격 거북선', '돌격장 이기남', 'geobukseon');
    const sqKwon = squad('joseon', '중위장', '순천부사 권준', 'panokseon');
    line(sqYi, 'panokseon', grid(1300, 1500, head, 14, 7, 70, 64, 10, rand), '좌수영', 3);
    line(sqKwon, 'panokseon', grid(1900, 1950, head, 10, 5, 70, 64, 10, rand), '중위');
    line(sqTurtle, 'geobukseon', [{ x: 950, z: 1050, h: head }, { x: 1120, z: 980, h: head }], '거북선');
    b.retreatBelow = 0;
  } else if (id === 'angolpo') {
    const sqKuki = squad('japan', '구키 본대', '구키 요시타카', 'atakebune');
    const sqKato = squad('japan', '가토 대', '가토 요시아키', 'atakebune');
    const sqSmall = squad('japan', '안골포 중소선', '왜장', 'sekibune');
    anchorage(sqKuki, 12, 150, -2350, 420, 520, (i) => (i < 11 ? 'atakebune' : 'sekibune'), Math.PI / 2);
    anchorage(sqKato, 12, 250, -1850, 420, 500, (i) => (i < 10 ? 'atakebune' : 'sekibune'), Math.PI / 2);
    anchorage(sqSmall, 18, 200, -1500, 520, 420, (i) => (i < 12 ? 'sekibune' : 'kobaya'), Math.PI / 2);
    const head = -Math.PI / 2;
    const sqYi = squad('joseon', '전라좌수영 본대', '좌수사 이순신', 'panokseon');
    const sqTurtle = squad('joseon', '돌격 거북선', '돌격장 이기남', 'geobukseon');
    const sqEok = squad('joseon', '전라우수영', '전라우수사 이억기', 'panokseon');
    const sqWon = squad('joseon', '경상우수영', '경상우수사 원균', 'panokseon');
    line(sqYi, 'panokseon', grid(0, 900, head, 22, 8, 70, 62, 10, rand), '좌수영', 4);
    line(sqEok, 'panokseon', grid(-900, 1500, head, 24, 8, 70, 62, 10, rand), '우수영', 0);
    line(sqWon, 'panokseon', grid(900, 1500, head, 6, 6, 70, 62, 10, rand), '경상우수영');
    line(sqTurtle, 'geobukseon', [{ x: -100, z: 520, h: head }, { x: 100, z: 520, h: head }], '거북선');
    b.retreatBelow = 0.5;
  } else if (id === 'chilcheon') {
    b.night = true;
    const groups = [
      { name: '통제사 본대', cmd: '통제사 원균', n: 40, z: 0 },
      { name: '경상우수영', cmd: '경상우수사 배설', n: 34, z: -900 },
      { name: '전라우수영', cmd: '전라우수사 이억기', n: 32, z: 900 },
      { name: '충청수영', cmd: '충청수사 최호', n: 28, z: 1700 },
    ];
    for (const g of groups) {
      const sq = squad('joseon', g.name, g.cmd, 'panokseon');
      line(sq, 'panokseon', grid(650, g.z, -Math.PI / 2, g.n, 3, 62, 70, 12, rand), g.name, g.name === '통제사 본대' ? 1 : -1);
      for (const sid of sq.shipIds) {
        const s = b.get(sid)!;
        s.order = { type: 'hold' };
        s.speed = 0;
      }
    }
    const turtles = squad('joseon', '거북선', '돌격장', 'geobukseon');
    line(turtles, 'geobukseon', [{ x: 520, z: -1600, h: -Math.PI / 2 }, { x: 650, z: -1650, h: -Math.PI / 2 }, { x: 780, z: -1600, h: -Math.PI / 2 }], '거북선');
    const raid = [
      { name: '도도 선봉', cmd: '도도 다카토라', n: 70, x: 650, z: -6200, h: Math.PI / 2 },
      { name: '와키자카 대', cmd: '와키자카 야스하루', n: 70, x: 500, z: -7400, h: Math.PI / 2 },
      { name: '가토 대', cmd: '가토 요시아키', n: 60, x: 800, z: -8300, h: Math.PI / 2 },
      { name: '시마즈 대', cmd: '시마즈 요시히로', n: 75, x: 650, z: 6200, h: -Math.PI / 2 },
      { name: '고니시 대', cmd: '고니시 유키나가', n: 75, x: 500, z: 7400, h: -Math.PI / 2 },
      { name: '구루시마 대', cmd: '구루시마 미치후사', n: 50, x: 800, z: 8300, h: -Math.PI / 2 },
      { name: '서쪽 매복', cmd: '모리 다카마사', n: 50, x: -1800, z: -4200, h: 0.9 },
      { name: '남서 우회대', cmd: '왜장', n: 50, x: -1600, z: 4700, h: -0.8 },
    ];
    raid.forEach((g, gi) => {
      const kindOf = mix(0.18, 0.55);
      const sq = squad('japan', g.name, g.cmd, gi % 3 === 0 ? 'atakebune' : 'sekibune');
      grid(g.x, g.z, g.h, g.n, 6, 52, 46, 14, rand).forEach((p, i) => {
        const s = ship(sq, kindOf(i + gi * 7), p, `${g.name} ${i + 1}`, i === 0);
        s.lights = false;
      });
    });
    b.retreatBelow = 0.35;
  } else {
    b.night = true;
    const head = 0;
    const sqYi = squad('joseon', '통제사 본대', '통제사 이순신', 'panokseon');
    const sqSong = squad('joseon', '조선 좌군', '중군장 송희립', 'panokseon');
    const sqRight = squad('joseon', '조선 우군', '가리포첨사 이영남', 'panokseon');
    line(sqYi, 'panokseon', grid(-2300, -420, head, 20, 4, 72, 64, 10, rand), '통제사', 1);
    line(sqSong, 'panokseon', grid(-2900, -700, head, 20, 4, 72, 64, 10, rand), '좌군');
    line(sqRight, 'panokseon', grid(-3300, -250, head, 20, 4, 72, 64, 10, rand), '우군');
    const sqChen = squad('joseon', '명 수군 본대', '도독 진린', 'mingship');
    const sqDeng = squad('joseon', '명 수군 선봉', '부총병 등자룡', 'mingship');
    const sqSha = squad('joseon', '명 사선대', '명 유격장', 'mingsmall');
    line(sqChen, 'mingship', grid(-2500, 650, head, 16, 4, 66, 60, 10, rand), '명 전선', 0);
    line(sqDeng, 'mingship', grid(-1900, 520, head, 14, 4, 66, 60, 10, rand), '명 선봉', 0);
    line(sqSha, 'mingsmall', grid(-3200, 900, head, 33, 6, 40, 36, 10, rand), '사선');
    for (let q = 0; q < 20; q += 1) {
      const cmd = q === 0 ? '시마즈 요시히로' : q === 1 ? '다치바나 무네시게' : q === 2 ? '소 요시토시' : q === 3 ? '데라자와 마사나리' : '왜장';
      const sq = squad('japan', q < 4 ? `${cmd.split(' ')[0]} 대` : `사쓰마 ${q + 1}진`, cmd, q % 4 === 0 ? 'atakebune' : 'sekibune');
      const kindOf = mix(0.22, 0.6);
      grid(1200 + q * 330, (q % 2 ? 1 : -1) * 90, Math.PI, 25, 5, 54, 48, 12, rand).forEach((p, i) => ship(sq, kindOf(i + q * 5), p, `${sq.name} ${i + 1}`, i === 0));
    }
    b.retreatBelow = 0.55;
  }
  return b;
}

export function scenarioCenter(id: ScenarioId) {
  const info = SCENARIOS[id];
  return { x: info.view.tx, z: info.view.tz };
}
