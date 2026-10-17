import type { Battle } from './battle';
import type { ShipKind, Squadron, Team } from './types';
import type { ArmadaSlug } from '../routes';
import type { Commander, ScenarioInfo } from './scenarios';
import { SCENARIO_TEXT } from './scenarioText';
import { CALAIS_TERRAIN, GRAVELINES_TERRAIN, PLYMOUTH_TERRAIN, PORTLAND_TERRAIN, WIGHT_TERRAIN } from '../terrain/armadaTerrain';

// The Armada chapter's five battles, from the running fight up the Channel to Gravelines. Sources: Colin Martin and
// Geoffrey Parker, The Spanish Armada (1999); Angus Konstam, The Armada Campaign 1588 (2001); Garrett Mattingly, The
// Defeat of the Spanish Armada (1959); Howard's and Medina Sidonia's dispatches as printed in Laughton, State Papers
// relating to the Defeat of the Spanish Armada (1894). The fleets are scaled down the way the 1592 battles' are: the
// English 197 sail and the Armada's 130 become a few dozen each, in the same proportions of fighting ships.
// In battle the English take the first slot ('joseon') and the Armada the second ('japan').

const HOWARD: Commander = { name: '찰스 하워드', title: '잉글랜드 해군 총사령관', figure: 'fig_howard', portrait: 'portrait_howard', banner: 'H' };
const DRAKE: Commander = { name: '프랜시스 드레이크', title: '부사령관', figure: 'fig_drake', portrait: 'portrait_drake', banner: 'D' };
const MEDINA: Commander = { name: '메디나 시도니아 공작', title: '무적함대 총사령관', figure: 'fig_medina', portrait: 'portrait_medina', banner: 'MS' };

export const ARMADA_SCENARIOS: Record<ArmadaSlug, ScenarioInfo> = {
  plymouth: {
    id: 'plymouth',
    ...SCENARIO_TEXT.plymouth,
    season: '여름 · 아침',
    difficulty: '보통',
    summary:
      '1588년 7월 31일 아침, 플리머스에서 밤새 바람을 거슬러 빠져나온 잉글랜드 함대가 무적함대의 뒤쪽, 바람 위에 섰습니다. 무적함대는 초승달 진형으로 맞섰고, 잉글랜드는 붙어 싸우지 않고 멀리서 포를 쏘았습니다. 이날 레칼데의 산 후안호가 집중 포격을 받았고, 충돌로 돛대를 잃은 로사리오호와 폭발한 산 살바도르호가 뒤처졌습니다.',
    result: '양쪽 모두 큰 손실 없음, 에스파냐 함선 2척 낙오',
    forces: { joseon: '갤리온 15척 · 핀네이스 14척', japan: '갤리온 22척 · 갈레아스 4척 · 우르카 14척' },
    sky: 'day',
    sea: 'rough',
    night: false,
    terrain: PLYMOUTH_TERRAIN,
    joseon: HOWARD,
    japan: MEDINA,
    map: { x: 0.18, y: 0.7 },
    arrows: [{ from: [0.12, 0.66], to: [0.2, 0.7], team: 'joseon' }],
    view: { tx: 0, tz: 0, dir: Math.PI * 0.5, dist: 1300, pitch: 0.3 },
  },
  portland: {
    id: 'portland',
    ...SCENARIO_TEXT.portland,
    season: '여름 · 새벽',
    difficulty: '어려움',
    summary:
      '8월 2일 새벽, 바람이 북동풍으로 바뀌어 처음으로 무적함대가 바람 위에 섰습니다. 프로비셔의 트라이엄프호와 상선 다섯 척이 포틀랜드 곶 안쪽에 고립되었고, 몬카다의 갈레아스 네 척이 이들을 덮쳤습니다. 하워드의 본대는 바다 쪽에서 무적함대 주력과 맞붙었고, 오후에 바람이 다시 남서풍으로 돌자 형세가 뒤집혔습니다.',
    result: '프로비셔 구출, 양쪽 모두 함선 손실 없음',
    forces: { joseon: '갤리온 14척 · 핀네이스 10척 (곶 안쪽 6척)', japan: '갤리온 20척 · 갈레아스 4척 · 우르카 10척' },
    sky: 'dawn',
    sea: 'rough',
    night: false,
    terrain: PORTLAND_TERRAIN,
    joseon: { name: '마틴 프로비셔', title: '트라이엄프호 함장', figure: 'fig_frobisher', portrait: 'portrait_frobisher', banner: 'F' },
    japan: { name: '우고 데 몬카다', title: '갈레아스 함대 사령관', figure: 'fig_moncada', portrait: 'portrait_leyva', banner: 'M' },
    map: { x: 0.34, y: 0.66 },
    arrows: [{ from: [0.36, 0.7], to: [0.34, 0.665], team: 'japan' }],
    view: { tx: -900, tz: -1200, dir: Math.PI * 0.5, dist: 1200, pitch: 0.3 },
  },
  wight: {
    id: 'wight',
    ...SCENARIO_TEXT.wight,
    season: '여름 · 아침',
    difficulty: '보통',
    summary:
      '8월 4일, 무적함대는 와이트섬 동쪽 솔렌트 수로로 들어가 정박지를 얻으려 했습니다. 하워드는 함대를 넷으로 나누어 막았고, 섬 쪽에서 프로비셔가 바람을 타고 빠져나오는 동안 드레이크의 전대가 바다 쪽에서 무적함대의 오른쪽 날개를 쳐 오워스 모래톱 쪽으로 몰았습니다. 메디나 시도니아는 솔렌트를 포기하고 칼레로 향했습니다.',
    result: '무적함대 솔렌트 진입 실패, 칼레로 이동',
    forces: { joseon: '네 개 전대: 갤리온 16척 · 핀네이스 12척', japan: '갤리온 22척 · 갈레아스 4척 · 우르카 12척' },
    sky: 'afternoon',
    sea: 'moderate',
    night: false,
    terrain: WIGHT_TERRAIN,
    joseon: DRAKE,
    japan: MEDINA,
    map: { x: 0.47, y: 0.62 },
    arrows: [{ from: [0.5, 0.66], to: [0.47, 0.625], team: 'joseon' }],
    view: { tx: 600, tz: -600, dir: Math.PI * 0.5, dist: 1300, pitch: 0.3 },
  },
  calais: {
    id: 'calais',
    ...SCENARIO_TEXT.calais,
    season: '여름 · 한밤',
    difficulty: '보통',
    summary:
      '8월 7일 밤, 무적함대는 칼레 앞바다에 닻을 내리고 파르마 공작의 육군을 기다렸습니다. 자정이 지나자 잉글랜드는 역청을 채우고 포를 장전해 둔 상선 8척에 불을 붙여 바람과 밀물에 실어 보냈습니다. 불탄 배는 없었지만, 놀란 무적함대는 닻줄을 끊고 어둠 속에 흩어졌습니다.',
    result: '무적함대 정박지 붕괴, 갈레아스 산 로렌소호 좌초',
    forces: { joseon: '화공선 8척 · 갤리온 12척 · 핀네이스 8척', japan: '갤리온 22척 · 갈레아스 4척 · 우르카 12척 (정박)' },
    sky: 'night',
    sea: 'moderate',
    night: true,
    terrain: CALAIS_TERRAIN,
    joseon: HOWARD,
    japan: MEDINA,
    map: { x: 0.72, y: 0.6 },
    arrows: [{ from: [0.68, 0.56], to: [0.72, 0.6], team: 'joseon' }],
    view: { tx: 0, tz: 1200, dir: -Math.PI * 0.5, dist: 1300, pitch: 0.3 },
  },
  gravelines: {
    id: 'gravelines',
    ...SCENARIO_TEXT.gravelines,
    season: '여름 · 아침',
    difficulty: '어려움',
    summary:
      '8월 8일 새벽, 흩어진 무적함대를 다시 모으던 메디나 시도니아의 산 마르틴호를 드레이크의 리벤지호가 앞장서 덮쳤습니다. 화약을 아껴 오던 잉글랜드 함대는 이번에는 백 걸음 안까지 다가가 포를 쏘았습니다. 아홉 시간의 싸움 끝에 에스파냐 함선 여럿이 부서지거나 플랑드르 모래톱에 걸렸고, 바람이 북쪽으로 몰아가 무적함대는 다시는 칼레로 돌아오지 못했습니다.',
    result: '에스파냐 함선 5척 격침·나포, 무적함대 북해로 밀려남',
    forces: { joseon: '갤리온 18척 · 핀네이스 14척', japan: '갤리온 20척 · 갈레아스 3척 · 우르카 10척' },
    sky: 'overcast',
    sea: 'rough',
    night: false,
    terrain: GRAVELINES_TERRAIN,
    joseon: DRAKE,
    japan: MEDINA,
    map: { x: 0.8, y: 0.54 },
    arrows: [{ from: [0.74, 0.56], to: [0.8, 0.545], team: 'joseon' }],
    view: { tx: 0, tz: 600, dir: -Math.PI * 0.5, dist: 1300, pitch: 0.3 },
  },
};

export const ARMADA_ORDER: ArmadaSlug[] = ['plymouth', 'portland', 'wight', 'calais', 'gravelines'];
export const isArmadaBattle = (id: string): id is ArmadaSlug => (ARMADA_ORDER as string[]).includes(id);

/** How the named Armada commanders fought, for the computer's maneuvers. */
export const ARMADA_TEMPERS: [string, 'rash' | 'cautious' | 'bold' | 'steady'][] = [
  ['드레이크', 'bold'],
  ['프로비셔', 'rash'],
  ['호킨스', 'steady'],
  ['하워드', 'steady'],
  ['메디나', 'cautious'],
  ['레칼데', 'bold'],
  ['레이바', 'rash'],
  ['오켄도', 'bold'],
  ['몬카다', 'bold'],
];

export const ARMADA_PORTRAITS: [string, string][] = [
  ['하워드', 'portrait_howard'],
  ['드레이크', 'portrait_drake'],
  ['호킨스', 'portrait_hawkins'],
  ['프로비셔', 'portrait_frobisher'],
  ['메디나', 'portrait_medina'],
  ['레칼데', 'portrait_recalde'],
  ['오켄도', 'portrait_oquendo'],
  ['레이바', 'portrait_leyva'],
];

type Spot = { x: number; z: number; h: number };
/** The helpers buildScenario hands every battle's setup. */
export type ForceKit = {
  b: Battle;
  rand: () => number;
  squad: (team: Team, name: string, cmd: string, kind: ShipKind) => Squadron;
  ship: (sq: Squadron, kind: ShipKind, p: Spot, name: string, flagship?: boolean, variant?: number) => import('./types').Ship;
  grid: (cx: number, cz: number, heading: number, count: number, cols: number, spacingX: number, spacingZ: number, jitter: number, rand: () => number) => Spot[];
  arc: (cx: number, cz: number, radius: number, center: number, span: number, count: number) => Spot[];
  slotAll: (sq: Squadron) => void;
  numbered: (prefix: string, n: number) => string;
};

/** A squadron of mixed kinds laid out on the given spots; the first spot carries its flagship. */
function fleet(k: ForceKit, team: Team, name: string, cmd: string, kinds: ShipKind[], spots: Spot[], flagName?: string) {
  const sq = k.squad(team, name, cmd, kinds[0]!);
  spots.forEach((p, i) => k.ship(sq, kinds[i % kinds.length]!, p, i === 0 && flagName ? flagName : k.numbered(name, i + 1), i === 0));
  return sq;
}

/**
 * The Armada's crescent (the "lunula" every English account describes): the fighting ships on the two horns and the
 * rearguard, the store ships in the middle. `heading` is the way it sails.
 */
function crescent(k: ForceKit, cx: number, cz: number, heading: number, galleons: number, galleasses: number, urcas: number, anchored = false) {
  const c = Math.cos(heading), s = Math.sin(heading);
  const at = (along: number, across: number): Spot => ({ x: cx + c * along - s * across, z: cz + s * along + c * across, h: heading });
  const horn = Math.ceil(galleons / 3);
  const sqMain = fleet(k, 'japan', '본대 (포르투갈 함대)', '메디나 시도니아 공작', ['spgalleon'],
    Array.from({ length: galleons - horn * 2 }, (_, i) => at(-60 - (i % 3) * 70, (Math.floor(i / 3) - 1) * 90 + (i % 3) * 30)), '산 마르틴');
  fleet(k, 'japan', '좌익 (비스카야 함대)', '후안 마르티네스 데 레칼데', ['spgalleon'],
    Array.from({ length: horn }, (_, i) => at(-250 - i * 85, -420 - i * 70)), '산 후안');
  fleet(k, 'japan', '우익 (기푸스코아 함대)', '미겔 데 오켄도', ['spgalleon'],
    Array.from({ length: horn }, (_, i) => at(-250 - i * 85, 420 + i * 70)), '산타 아나');
  if (galleasses) fleet(k, 'japan', '나폴리 갈레아스', '우고 데 몬카다', ['galleass'], Array.from({ length: galleasses }, (_, i) => at(80, (i - (galleasses - 1) / 2) * 260)), '산 로렌소');
  if (urcas) fleet(k, 'japan', '우르카 수송대', '후안 고메스 데 메디나', ['urca'], k.grid(cx - c * 260, cz - s * 260, heading, urcas, 4, 70, 80, 20, k.rand));
  if (anchored) for (const sh of k.b.ships) if (sh.team === 'japan') { sh.order = { type: 'anchor' }; sh.speed = 0; }
  return sqMain;
}

/** English squadrons in line ahead, as they fought from the windward: galleons first, the pinnaces on the far side. */
function englishLine(k: ForceKit, name: string, cmd: string, flag: string, cx: number, cz: number, heading: number, galleons: number, pinnaces: number) {
  const c = Math.cos(heading), s = Math.sin(heading);
  const sq = k.squad('joseon', name, cmd, 'racegalleon');
  for (let i = 0; i < galleons; i += 1) k.ship(sq, 'racegalleon', { x: cx - c * i * 80, z: cz - s * i * 80, h: heading }, i === 0 ? flag : k.numbered(name, i + 1), i === 0);
  if (pinnaces) {
    const pq = k.squad('joseon', `${name} 핀네이스`, cmd, 'pinnace');  // i18n-ignore: a squadron name built from its leader's
    for (let i = 0; i < pinnaces; i += 1) k.ship(pq, 'pinnace', { x: cx - c * i * 60 + s * 120, z: cz - s * i * 60 - c * 120, h: heading }, k.numbered(`${name} 핀네이스`, i + 1));
  }
  return sq;
}

export function armadaForces(id: ArmadaSlug, k: ForceKit) {
  const { b } = k;
  b.windDrift = 0.2;
  if (id === 'plymouth') {
    // The Armada sails east up the Channel; the English have worked round to windward, west and astern of it.
    b.windAngle = 0;
    crescent(k, 900, 300, 0, 22, 4, 14);
    englishLine(k, '하워드 전대', '찰스 하워드', '아크 로열', -1500, -700, 0.25, 6, 5);
    englishLine(k, '드레이크 전대', '프랜시스 드레이크', '리벤지', -1700, 300, 0.1, 5, 5);
    englishLine(k, '호킨스 전대', '존 호킨스', '빅토리', -1900, 1200, -0.1, 4, 4);
    b.retreatBelow.japan = 0.3;
    b.retreatBelow.joseon = 0.3;
  } else if (id === 'portland') {
    // The wind is in the north-east, the Armada to windward. Frobisher lies close under the Bill to the north.
    b.windAngle = Math.PI * 0.75;
    crescent(k, 1300, 900, Math.PI, 20, 0, 10);
    const sqFro = k.squad('joseon', '프로비셔 분대', '마틴 프로비셔', 'racegalleon');
    k.grid(-600, -1900, Math.PI, 6, 3, 80, 70, 10, k.rand).forEach((p, i) => k.ship(sqFro, i ? 'pinnace' : 'racegalleon', p, i ? k.numbered('프로비셔 분대', i) : '트라이엄프', i === 0));
    for (const id2 of sqFro.shipIds) { const s = b.get(id2)!; s.order = { type: 'anchor' }; s.speed = 0; }
    fleet(k, 'japan', '갈레아스 분대', '우고 데 몬카다', ['galleass'], [0, 1, 2, 3].map((i) => ({ x: 300 + i * 120, z: -1300 - i * 90, h: Math.PI * 1.1 })), '산 로렌소');
    englishLine(k, '하워드 본대', '찰스 하워드', '아크 로열', -1500, 1300, 0.6, 9, 7);
    b.retreatBelow.japan = 0.3;
    b.retreatBelow.joseon = 0.25;
  } else if (id === 'wight') {
    b.windAngle = 0.15;
    crescent(k, 800, 200, 0.05, 22, 4, 12);
    englishLine(k, '하워드 전대', '찰스 하워드', '아크 로열', -1500, 0, 0.05, 4, 3);
    englishLine(k, '프로비셔 전대', '마틴 프로비셔', '트라이엄프', -600, -1500, 0.2, 4, 3);
    englishLine(k, '드레이크 전대', '프랜시스 드레이크', '리벤지', -1300, 1700, -0.2, 4, 3);
    englishLine(k, '호킨스 전대', '존 호킨스', '빅토리', -2000, 900, 0, 4, 3);
    b.retreatBelow.japan = 0.35;
    b.retreatBelow.joseon = 0.3;
  } else if (id === 'calais') {
    // Anchored in the Calais roads, the shore to the south; the fireships come down on the wind and the flood from the west.
    b.night = true;
    b.windAngle = 0;
    crescent(k, 600, 1400, 0, 22, 4, 12, true);
    const fires = k.squad('joseon', '화공선', '헨리 팔머', 'fireship');
    for (let i = 0; i < 8; i += 1) k.ship(fires, 'fireship', { x: -900 - (i % 2) * 60, z: 400 + i * 150, h: 0.05 }, k.numbered('화공선', i + 1), i === 0);
    englishLine(k, '하워드 전대', '찰스 하워드', '아크 로열', -2600, 700, 0, 6, 4);
    englishLine(k, '드레이크 전대', '프랜시스 드레이크', '리벤지', -2700, 1900, 0, 6, 4);
    b.retreatBelow.japan = 0.4;
  } else {
    // Gravelines: the Armada re-forming off the banks, the wind in the south-west driving both fleets toward the shoals.
    b.windAngle = 0.6;
    crescent(k, 700, 900, 0.15, 20, 3, 10);
    englishLine(k, '드레이크 전대', '프랜시스 드레이크', '리벤지', -900, -200, 0.3, 6, 5);
    englishLine(k, '하워드 전대', '찰스 하워드', '아크 로열', -1500, 600, 0.2, 6, 5);
    englishLine(k, '시모어 전대', '헨리 시모어', '레인보우', -1300, 1700, 0.1, 6, 4);
    b.retreatBelow.japan = 0.35;
    b.retreatBelow.joseon = 0.3;
  }
}
