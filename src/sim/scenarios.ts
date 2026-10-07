import { Battle } from './battle';
import type { ShipKind, Squadron, Team } from './types';
import { BUSAN_TERRAIN, HANSAN_TERRAIN, MYEONGNYANG_TERRAIN, type TerrainSpec } from '../terrain/generate';
import type { SkyPresetName } from '../render/sky';
import type { SeaStateName } from '../ocean/waves';

export type ScenarioId = 'hansan' | 'busan' | 'myeongnyang';

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
  terrain: TerrainSpec;
  joseon: Commander;
  japan: Commander;
  map: { x: number; y: number };
  arrows: { from: [number, number]; to: [number, number]; team: Team }[];
  view: { tx: number; tz: number; dir: number; dist: number; pitch: number };
};

type Place = (x: number, z: number) => { x: number; z: number };

const YI: Commander = { name: '이순신', title: '삼도수군통제사', figure: 'fig_yi', portrait: 'portrait_yi', banner: '李' };

export const SCENARIOS: Record<ScenarioId, ScenarioInfo> = {
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
    sea: 'moderate',
    terrain: HANSAN_TERRAIN,
    joseon: YI,
    japan: { name: '와키자카 야스하루', title: '수군 대장', figure: 'fig_wakisaka', portrait: 'portrait_japan', banner: '脇坂' },
    map: { x: 0.58, y: 0.6 },
    arrows: [
      { from: [0.66, 0.5], to: [0.6, 0.58], team: 'japan' },
      { from: [0.5, 0.66], to: [0.57, 0.61], team: 'joseon' },
    ],
    view: { tx: 300, tz: 120, dir: -0.75, dist: 1150, pitch: 0.3 },
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
    sea: 'calm',
    terrain: BUSAN_TERRAIN,
    joseon: YI,
    japan: { name: '부산 왜군', title: '주둔 수군', figure: 'fig_japan', portrait: 'portrait_japan', banner: '倭' },
    map: { x: 0.77, y: 0.47 },
    arrows: [{ from: [0.66, 0.6], to: [0.76, 0.48], team: 'joseon' }],
    view: { tx: -4200, tz: 3200, dir: -0.77, dist: 1000, pitch: 0.3 },
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
    sea: 'moderate',
    terrain: MYEONGNYANG_TERRAIN,
    joseon: YI,
    japan: { name: '도도 다카토라', title: '수군 대장', figure: 'fig_todo', portrait: 'portrait_japan', banner: '藤堂' },
    map: { x: 0.33, y: 0.64 },
    arrows: [
      { from: [0.42, 0.62], to: [0.34, 0.64], team: 'japan' },
    ],
    view: { tx: -1500, tz: 0, dir: 0, dist: 900, pitch: 0.24 },
  },
};

export const SCENARIO_ORDER: ScenarioId[] = ['hansan', 'busan', 'myeongnyang'];

function fleet(b: Battle, sq: Squadron, place: Place, kind: ShipKind, positions: { x: number; z: number; h: number }[], axis: number, namer: (i: number) => string, variantOf: (i: number) => number, flagIndex = -1) {
  positions.forEach((p, i) => {
    const w = place(p.x, p.z);
    b.addShip(kind, w.x, w.z, p.h + axis, namer(i), sq, i === flagIndex, variantOf(i));
  });
}

function grid(cx: number, cz: number, heading: number, count: number, cols: number, spacingX: number, spacingZ: number, jitter: number, rand: () => number) {
  const out: { x: number; z: number; h: number }[] = [];
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


export function buildScenario(id: ScenarioId, axis: number, seed = 1592) {
  const b = new Battle(seed);
  const ca = Math.cos(axis);
  const sa = Math.sin(axis);
  const place: Place = (x, z) => ({ x: x * ca - z * sa, z: x * sa + z * ca });
  const rand = () => b.random();
  const slotAll = (sq: Squadron) => {
    for (const id of sq.shipIds) {
      const s = b.get(id)!;
      b.setOrder([id], { type: 'slot', x: s.x, z: s.z, face: s.heading });
    }
  };
  if (id === 'hansan') {
    const cx = 700;
    const cz = -250;
    const facing = Math.PI + Math.atan2(-2400 - cz, 3000 - cx);
    const allArc = arc(cx, cz, 1150, facing, 2.25, 53);
    const sqYi = b.addSquadron('joseon', '전라좌수영 본대', '통제사 이순신', 'portrait_yi', 'card_panokseon');
    const sqTurtle = b.addSquadron('joseon', '돌격 거북선', '돌격장 이기남', 'portrait_admiral', 'card_geobukseon');
    const sqEok = b.addSquadron('joseon', '전라우수영', '전라우수사 이억기', 'portrait_admiral', 'card_panokseon');
    const sqWon = b.addSquadron('joseon', '경상우수영', '경상우수사 원균', 'portrait_admiral', 'card_panokseon');
    fleet(b, sqWon, place, 'panokseon', allArc.slice(0, 7), axis, (i) => `경상우수영 ${i + 1}호선`, (i) => 1 + (i % 2));
    fleet(b, sqYi, place, 'panokseon', allArc.slice(7, 28), axis, (i) => (i === 10 ? '통제사 대장선' : `좌수영 ${i + 1}호선`), (i) => (i === 10 ? 0 : 1 + (i % 2)), 10);
    fleet(b, sqEok, place, 'panokseon', allArc.slice(28), axis, (i) => `우수영 ${i + 1}호선`, (i) => (i === 0 ? 0 : 1 + (i % 2)), 0);
    const turtleAt = { x: cx - 350, z: cz };
    fleet(b, sqTurtle, place, 'geobukseon', [-1, 0, 1].map((k) => ({ x: turtleAt.x + 160, z: turtleAt.z + k * 90, h: facing + Math.PI })), axis, (i) => `거북선 ${i + 1}호`, () => 0, 1);
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
      const sq = b.addSquadron('japan', g.name, g.cmd, 'portrait_japan', g.kind === 'atakebune' ? 'card_atakebune' : 'card_sekibune');
      const back = gi * 230;
      const cxj = 3000 - Math.cos(jHeading) * back + (gi % 2 ? 120 : -120) * Math.sin(jHeading);
      const czj = -2400 - Math.sin(jHeading) * back - (gi % 2 ? 120 : -120) * Math.cos(jHeading);
      const kindSpacing = g.kind === 'atakebune' ? 70 : g.kind === 'sekibune' ? 50 : 34;
      fleet(b, sq, place, g.kind, grid(cxj, czj, jHeading, g.n, 4, kindSpacing, kindSpacing * 0.9, 12, rand), axis, (i) => `${g.name} ${i + 1}`, () => 0, gi === 0 ? 0 : -1);
    });
    b.retreatBelow = 0.22;
  } else if (id === 'busan') {
    const harborShore = -900;
    const japanSquadCount = 12;
    const perSquad = [40, 40, 39, 39, 39, 39, 39, 39, 39, 39, 39, 39];
    let made = 0;
    for (let q = 0; q < japanSquadCount; q += 1) {
      const sq = b.addSquadron('japan', `부산포 정박 ${q + 1}진`, '왜장', 'portrait_japan', q % 3 === 0 ? 'card_atakebune' : 'card_sekibune');
      const n = perSquad[q]!;
      const xs = -3100 + q * 520;
      const positions: { x: number; z: number; h: number }[] = [];
      for (let i = 0; i < n; i += 1) {
        const row = i % 4;
        const col = Math.floor(i / 4);
        positions.push({ x: xs + col * 48 + (rand() - 0.5) * 10, z: harborShore + 120 + row * 46 + (rand() - 0.5) * 10, h: Math.PI / 2 + (rand() - 0.5) * 0.4 });
      }
      positions.forEach((p, i) => {
        const kind: ShipKind = i % 4 === 0 ? 'atakebune' : i % 4 === 3 ? 'kobaya' : 'sekibune';
        const w = place(p.x, p.z);
        const s = b.addShip(kind, w.x, w.z, p.h + axis, `${sq.name} ${i + 1}`, sq, i === 0, 0);
        s.order = { type: 'anchor' };
        s.speed = 0;
        made += 1;
      });
    }
    void made;
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
      const sq = b.addSquadron('joseon', g.name, g.cmd, g.cmd.includes('이순신') ? 'portrait_yi' : 'portrait_admiral', g.kind === 'geobukseon' ? 'card_geobukseon' : 'card_panokseon');
      const back = gi * 210;
      const cxj = -4600 - Math.cos(head) * back;
      const czj = 3600 - Math.sin(head) * back;
      const spacing = g.kind === 'hyeopseon' ? 30 : 60;
      const cols = g.kind === 'hyeopseon' ? 6 : 3;
      fleet(b, sq, place, g.kind, grid(cxj, czj, head, g.n, cols, spacing, spacing * 0.95, 8, rand), axis, (i) => `${g.name} ${i + 1}호`, (i) => (g.kind === 'panokseon' ? (gi === 1 && i === 0 ? 0 : 1 + (i % 2)) : 0), gi === 1 ? 0 : -1);
    });
    b.retreatBelow = 0;
  } else {
    const yi = b.addSquadron('joseon', '대장선', '통제사 이순신', 'portrait_yi', 'card_panokseon');
    const rest = b.addSquadron('joseon', '잔여 함대', '거제현령 안위 · 중군장 김응함', 'portrait_admiral', 'card_panokseon');
    fleet(b, yi, place, 'panokseon', [{ x: -2050, z: 0, h: 0 }], axis, () => '통제사 대장선', () => 0, 0);
    fleet(b, rest, place, 'panokseon', arc(-2900, 0, 260, Math.PI, 1.6, 12), axis, (i) => `판옥선 ${i + 1}호`, (i) => 1 + (i % 2));
    for (const id of rest.shipIds) {
      const s = b.get(id)!;
      b.setOrder([id], { type: 'slot', x: s.x, z: s.z, face: axis });
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
      const sq = b.addSquadron('japan', g.name, g.cmd, 'portrait_japan', gi === 0 ? 'card_atakebune' : 'card_sekibune');
      const x = 1400 + gi * 520;
      fleet(b, sq, place, gi % 3 === 0 ? 'atakebune' : 'sekibune', grid(x, 0, Math.PI, g.n, 5, gi % 3 === 0 ? 70 : 48, 42, 10, rand), axis, (i) => `${g.name} ${i + 1}`, () => 0, 0);
    });
    b.retreatBelow = 0.75;
  }
  return b;
}

export function scenarioCenter(id: ScenarioId) {
  const info = SCENARIOS[id];
  return { x: info.view.tx, z: info.view.tz };
}
