import type { ShipKind, Team } from './types';
import type { LepantoSlug } from '../routes';
import type { Commander, ScenarioInfo } from './scenarios';
import type { ForceKit } from './armada';
import { SCENARIO_TEXT } from './scenarioText';
import { CENTRE_TERRAIN, DJERBA_TERRAIN, NORTH_TERRAIN, PREVEZA_TERRAIN, SOUTH_TERRAIN } from '../terrain/lepantoTerrain';

// The Lepanto chapter: the galley wars of the Holy League and the Ottoman Empire, Preveza (1538) and Djerba (1560) to
// the three wings of Lepanto (7 October 1571). In battle the Christian fleet takes the first slot ('joseon') and the
// Ottoman fleet the second ('japan'). Fleets are scaled down as the 1592 and 1588 battles are, in the same proportions.
// Sources (every number and name below is from these):
//   N. Capponi, Victory of the West: The Story of the Battle of Lepanto (2006): orders of battle, the wings, the wind;
//   J. F. Guilmartin, Gunpowder and Galleys (1974, rev. 2003): Preveza, Djerba, galley tactics and armament;
//   A. Konstam, Lepanto 1571 (Osprey Campaign 114, 2003): orders of battle, timings, losses;
//   H. Bicheno, Crescent and Cross: The Battle of Lepanto 1571 (2003): Barbarigo's and Doria's wings;
//   F. Braudel, The Mediterranean and the Mediterranean World in the Age of Philip II (1949, tr. 1972): Djerba 1560.
export const LEPANTO_SOURCES = [
  'Niccolò Capponi, Victory of the West: The Story of the Battle of Lepanto, 2006',
  'John F. Guilmartin, Gunpowder and Galleys, 1974 (개정 2003)',
  'Angus Konstam, Lepanto 1571, Osprey, 2003',
  'Hugh Bicheno, Crescent and Cross: The Battle of Lepanto 1571, 2003',
  'Fernand Braudel, 『지중해』, 1949',
];

/** A quote for a battle's opening, with where it is recorded; text is the Korean source for t(). */
export type Quote = { text: string; source: string };

const DONJUAN: Commander = { name: '돈 후안 데 아우스트리아', title: '신성동맹 함대 총사령관', figure: 'fig_donjuan', portrait: 'portrait_donjuan', banner: 'J' };
const BARBARIGO: Commander = { name: '아고스티노 바르바리고', title: '베네치아 함대 부사령관 · 좌익', figure: 'fig_barbarigo', portrait: 'portrait_barbarigo', banner: 'B' };
const DORIA: Commander = { name: '조반니 안드레아 도리아', title: '제노바 제독 · 우익', figure: 'fig_doria', portrait: 'portrait_doria', banner: 'D' };
const ALI: Commander = { name: '뮈에진자데 알리 파샤', title: '오스만 함대 대제독(카푸단 파샤)', figure: 'fig_alipasha', portrait: 'portrait_alipasha', banner: 'A' };
const SIROCO: Commander = { name: '메흐메드 시로코', title: '알렉산드리아 총독 · 우익', figure: 'fig_siroco', portrait: 'portrait_siroco', banner: 'S' };
const ULUC: Commander = { name: '울루치 알리', title: '알제 총독 · 좌익', figure: 'fig_uluc', portrait: 'portrait_uluc', banner: 'U' };
const ANDREA: Commander = { name: '안드레아 도리아', title: '신성동맹 함대 총사령관', figure: 'fig_andreadoria', portrait: 'portrait_andreadoria', banner: 'AD' };
const BARBAROSSA: Commander = { name: '하이레딘 바르바로사', title: '오스만 함대 대제독(카푸단 파샤)', figure: 'fig_barbarossa', portrait: 'portrait_barbarossa', banner: 'H' };
const MEDINACELI: Commander = { name: '메디나셀리 공작', title: '에스파냐 원정군 사령관', figure: 'fig_medinaceli', portrait: 'portrait_medinaceli', banner: 'M' };
const PIYALE: Commander = { name: '피얄레 파샤', title: '오스만 함대 대제독(카푸단 파샤)', figure: 'fig_piyale', portrait: 'portrait_piyale', banner: 'P' };

/**
 * Lines the battle-opening cinematics can give each side's commander: recorded words (with the record) or, marked
 * "in character", a paraphrase of what the sources say he ordered. Keyed by battle.
 */
export const LEPANTO_QUOTES: Record<LepantoSlug, { joseon: Quote; japan: Quote }> = {
  preveza: {
    joseon: { text: '바람이 바뀌기 전에는 움직이지 않는다.', source: '도리아의 지연 기동을 요약한 서술(인물 대사 아님), Guilmartin 2003, 4장' },
    japan: { text: '적이 망설이고 있다. 노를 저어 나가라.', source: '바르바로사의 출격 명령을 요약한 서술(인물 대사 아님), Guilmartin 2003, 4장' },
  },
  djerba: {
    joseon: { text: '배에 오르라, 적의 함대가 온다!', source: '제르바 기습 당시 상황 요약(인물 대사 아님), Braudel 1972, 2부' },
    japan: { text: '저들이 물을 긷는 동안 덮친다.', source: '피얄레 파샤의 기습 요약(인물 대사 아님), Guilmartin 2003, 6장' },
  },
  'lepanto-north': {
    joseon: { text: '해안에 붙어라. 적이 우리 옆으로 돌아오지 못하게 하라.', source: '바르바리고 전대의 해안 밀착 기동 요약(인물 대사 아님), Bicheno 2003' },
    japan: { text: '얕은 물로 돌아 저들의 옆구리를 쳐라.', source: '시로코의 우회 기동 요약(인물 대사 아님), Capponi 2006' },
  },
  'lepanto-centre': {
    joseon: { text: '여기서 이기든가 죽든가 하라.', source: '돈 후안이 전투 전에 함대를 돌며 한 말로 전해짐 (Capponi 2006, 12장; Konstam 2003)' },
    japan: { text: '노예들이여, 오늘 이기면 자유를 주겠다.', source: '알리 파샤가 기독교도 노꾼들에게 했다고 전해지는 말 (Konstam 2003; Capponi 2006)' },
  },
  'lepanto-south': {
    joseon: { text: '바다 쪽으로 넓혀라. 저들이 우리를 감싸지 못하게 하라.', source: '도리아의 남쪽 확장 기동 요약(인물 대사 아님), Capponi 2006' },
    japan: { text: '틈이 벌어졌다. 몰타의 기함을 쳐라.', source: '울루치 알리의 돌파 요약(인물 대사 아님), Bicheno 2003' },
  },
};

export const LEPANTO_ORDER: LepantoSlug[] = ['preveza', 'djerba', 'lepanto-north', 'lepanto-centre', 'lepanto-south'];
export const isLepantoBattle = (id: string): id is LepantoSlug => (LEPANTO_ORDER as string[]).includes(id);

export const LEPANTO_TEMPERS: [string, 'rash' | 'cautious' | 'bold' | 'steady'][] = [
  ['돈 후안', 'bold'],
  ['바르바리고', 'steady'],
  ['베니에르', 'rash'],
  ['조반니 안드레아', 'cautious'],
  ['안드레아 도리아', 'cautious'],
  ['알리 파샤', 'bold'],
  ['시로코', 'bold'],
  ['울루치', 'bold'],
  ['바르바로사', 'steady'],
  ['피얄레', 'bold'],
  ['메디나셀리', 'cautious'],
];

export const LEPANTO_PORTRAITS: [string, string][] = [
  ['돈 후안', 'portrait_donjuan'],
  ['바르바리고', 'portrait_barbarigo'],
  ['베니에르', 'portrait_venier'],
  ['조반니 안드레아', 'portrait_doria'],
  ['안드레아 도리아', 'portrait_andreadoria'],
  ['알리 파샤', 'portrait_alipasha'],
  ['시로코', 'portrait_siroco'],
  ['울루치', 'portrait_uluc'],
  ['페르테브', 'portrait_pertev'],
  ['바르바로사', 'portrait_barbarossa'],
  ['피얄레', 'portrait_piyale'],
  ['메디나셀리', 'portrait_medinaceli'],
];

export const LEPANTO_SCENARIOS: Record<LepantoSlug, ScenarioInfo> = {
  preveza: {
    id: 'preveza',
    ...SCENARIO_TEXT.preveza,
    season: '가을 · 아침',
    difficulty: '어려움',
    summary:
      '1538년 9월 28일, 바르바로사의 오스만 함대가 프레베자 만 입구에서 나왔습니다. 안드레아 도리아의 신성동맹 함대는 갤리선과 범선이 섞여 있어 바람이 약하자 대열을 맞추지 못했고, 도리아는 정면 대결을 피했습니다. 바람이 없는 바다에 남은 콘둘메르의 베네치아 대형 범선은 오스만 갤리선에 둘러싸여 하루 종일 버텼지만, 동맹 함대는 갤리선 여러 척을 잃고 물러났습니다.',
    result: '오스만 승리, 동맹 함대 갤리선 약 13척 손실 후 퇴각',
    forces: { joseon: '갤리선 18척 · 갈레아스 1척', japan: '갤리선 16척 · 갈리오트 6척' },
    sky: 'day',
    sea: 'calm',
    night: false,
    terrain: PREVEZA_TERRAIN,
    joseon: ANDREA,
    japan: BARBAROSSA,
    map: { x: 0.74, y: 0.22 },
    arrows: [{ from: [0.76, 0.2], to: [0.74, 0.23], team: 'japan' }],
    view: { tx: 0, tz: 0, dir: Math.PI * 0.5, dist: 1100, pitch: 0.3 },
  },
  djerba: {
    id: 'djerba',
    ...SCENARIO_TEXT.djerba,
    season: '봄 · 아침',
    difficulty: '어려움',
    summary:
      '1560년 5월, 트리폴리를 되찾으려던 에스파냐 원정군은 제르바 섬을 점령하고 요새를 쌓고 있었습니다. 5월 11일 피얄레 파샤의 오스만 함대가 예상보다 일찍 나타났고, 물을 싣던 기독교 함대는 대열을 갖추지 못한 채 흩어졌습니다. 갤리선 약 30척이 붙잡히거나 침몰했고, 섬에 남은 수비대는 석 달을 버티다 항복했습니다.',
    result: '오스만 대승, 기독교 연합 갤리선 약 30척 손실',
    forces: { joseon: '갤리선 14척 · 수송선 4척 (흩어짐)', japan: '갤리선 22척' },
    sky: 'day',
    sea: 'calm',
    night: false,
    terrain: DJERBA_TERRAIN,
    joseon: MEDINACELI,
    japan: PIYALE,
    map: { x: 0.12, y: 0.86 },
    arrows: [{ from: [0.2, 0.82], to: [0.13, 0.86], team: 'japan' }],
    view: { tx: 0, tz: 0, dir: Math.PI * 0.5, dist: 1100, pitch: 0.3 },
  },
  'lepanto-north': {
    id: 'lepanto-north',
    ...SCENARIO_TEXT['lepanto-north'],
    season: '가을 · 한낮',
    difficulty: '보통',
    summary:
      '1571년 10월 7일 정오 무렵, 신성동맹 함대의 좌익 바르바리고의 베네치아 갤리선 53척이 아이톨리아 해안에 바짝 붙어 나아갔습니다. 마주한 메흐메드 시로코의 갤리선 54척은 얕은 물길로 돌아 들어와 베네치아 대열의 옆을 쳤고, 바르바리고는 눈에 화살을 맞고 쓰러졌습니다. 그러나 베네치아 갤리선이 바다 쪽에서 돌아 들어와 오스만 우익을 해안으로 밀어붙였고, 시로코는 전사했습니다.',
    result: '신성동맹 승리, 오스만 우익 거의 전멸 · 바르바리고와 시로코 모두 전사',
    forces: { joseon: '갤리선 16척 · 갈레아스 2척', japan: '갤리선 16척 · 갈리오트 2척' },
    sky: 'day',
    sea: 'calm',
    night: false,
    terrain: NORTH_TERRAIN,
    joseon: BARBARIGO,
    japan: SIROCO,
    map: { x: 0.78, y: 0.27 },
    arrows: [{ from: [0.8, 0.26], to: [0.785, 0.27], team: 'japan' }],
    view: { tx: 0, tz: 0, dir: Math.PI * 0.5, dist: 1100, pitch: 0.3 },
  },
  'lepanto-centre': {
    id: 'lepanto-centre',
    ...SCENARIO_TEXT['lepanto-centre'],
    season: '가을 · 한낮',
    difficulty: '어려움',
    summary:
      '중앙에서 돈 후안의 기함 라 레알호가 알리 파샤의 기함 술타나호와 이물을 맞대고 부딪쳤습니다. 앞에 세운 갈레아스 두 척의 포격이 오스만 대열을 흐트러뜨린 뒤였습니다. 두 기함 갑판 위에서 에스파냐 화승총병과 예니체리가 두 번 밀고 밀리는 동안, 베니에르와 콜론나의 기함이 옆을 받쳤습니다. 세 번째 돌격에 술타나호가 함락되고 알리 파샤가 전사하자 오스만 중앙이 무너졌습니다.',
    result: '신성동맹 승리, 술타나호 나포 · 알리 파샤 전사',
    forces: { joseon: '갤리선 18척 · 갈레아스 2척 (라 레알 포함)', japan: '갤리선 18척 · 갈리오트 4척 (술타나 포함)' },
    sky: 'day',
    sea: 'calm',
    night: false,
    terrain: CENTRE_TERRAIN,
    joseon: DONJUAN,
    japan: ALI,
    map: { x: 0.79, y: 0.29 },
    arrows: [{ from: [0.77, 0.29], to: [0.79, 0.29], team: 'joseon' }],
    view: { tx: 0, tz: 0, dir: Math.PI * 0.5, dist: 1100, pitch: 0.3 },
  },
  'lepanto-south': {
    id: 'lepanto-south',
    ...SCENARIO_TEXT['lepanto-south'],
    season: '가을 · 오후',
    difficulty: '어려움',
    summary:
      '남쪽에서는 울루치 알리가 바다 쪽으로 대열을 넓히자 조반니 안드레아 도리아도 감싸이지 않으려 남쪽으로 따라 움직였습니다. 그 사이 동맹 우익과 중앙 사이에 틈이 벌어졌고, 울루치 알리는 그 틈으로 돌아 들어와 몰타 기사단의 기함을 붙잡았습니다. 산타 크루스 후작의 예비대와 돈 후안이 돌아오자 울루치 알리는 붙잡은 깃발을 들고 갤리선 서른여 척과 함께 빠져나갔습니다.',
    result: '동맹 승리로 끝났으나 울루치 알리 탈출 · 몰타 기함 한때 나포',
    forces: { joseon: '갤리선 16척 (예비대 4척 포함)', japan: '갤리선 14척 · 갈리오트 6척' },
    sky: 'afternoon',
    sea: 'calm',
    night: false,
    terrain: SOUTH_TERRAIN,
    joseon: DORIA,
    japan: ULUC,
    map: { x: 0.8, y: 0.31 },
    arrows: [{ from: [0.82, 0.32], to: [0.8, 0.31], team: 'japan' }],
    view: { tx: 0, tz: 0, dir: Math.PI * 0.5, dist: 1100, pitch: 0.3 },
  },
};

type Spot = { x: number; z: number; h: number };

/**
 * A galley squadron in line abreast, as galleys fought: bows to the enemy, about 30 m between ships (Guilmartin's
 * "half a galley's length" of oar room each side). The flagship takes the middle; kinds go from the middle outwards.
 */
function lineAbreast(k: ForceKit, team: Team, name: string, cmd: string, kinds: ShipKind[], cx: number, cz: number, heading: number, n: number, flagName: string, gap = 34) {
  const c = Math.cos(heading), s = Math.sin(heading);
  const sq = k.squad(team, name, cmd, kinds[0]!);
  for (let i = 0; i < n; i += 1) {
    const j = i === 0 ? 0 : (i % 2 ? 1 : -1) * Math.ceil(i / 2);
    const p: Spot = { x: cx - s * j * gap, z: cz + c * j * gap, h: heading };
    k.ship(sq, i === 0 ? kinds[0]! : kinds[1 + (i % (kinds.length - 1 || 1))] ?? kinds[0]!, p, i === 0 ? flagName : k.numbered(name, i), i === 0);
  }
  return sq;
}

/** Two galleasses towed out ahead of a division, as at Lepanto (a mile ahead, Capponi; scaled). */
function galleassScreen(k: ForceKit, name: string, cx: number, cz: number, heading: number) {
  const c = Math.cos(heading), s = Math.sin(heading);
  const sq = k.squad('joseon', name, '프란체스코 두오도', 'vgalleass');
  for (const j of [-1, 1]) k.ship(sq, 'vgalleass', { x: cx + c * 380 - s * j * 220, z: cz + s * 380 + c * j * 220, h: heading }, k.numbered(name, j < 0 ? 1 : 2), j < 0);
  return sq;
}

export function lepantoForces(id: LepantoSlug, k: ForceKit) {
  const { b } = k;
  b.windDrift = 0.1;
  // Ships face along +x for the League (heading 0) and -x for the Ottomans (heading pi); the shore lies north (-z).
  if (id === 'preveza') {
    // Barbarossa comes out of the Gulf of Arta eastward of the League; little wind, Doria's sailing ships becalmed.
    b.windAngle = Math.PI * 1.5;
    lineAbreast(k, 'japan', '오스만 본대', '하이레딘 바르바로사', ['kadirga', 'kadirga', 'kalyata'], 900, -200, Math.PI, 16, '바르바로사 기함');
    lineAbreast(k, 'japan', '투르구트 분대', '투르구트 레이스', ['kalyata'], 900, 900, Math.PI, 6, '투르구트 기함');
    lineAbreast(k, 'joseon', '동맹 갤리선대', '안드레아 도리아', ['galea', 'galea'], -1300, 0, 0, 18, '도리아 기함');
    const sail = k.squad('joseon', '베네치아 대형 범선', '알레산드로 콘둘메르', 'vgalleass');
    k.ship(sail, 'vgalleass', { x: -300, z: 300, h: 0 }, '갈레오네 디 베네치아', true);
    b.retreatBelow.joseon = 0.45;
    b.retreatBelow.japan = 0.3;
  } else if (id === 'djerba') {
    // The Christian galleys lie off the island taking on water; Piyale's galleys come up fast from the east.
    b.windAngle = Math.PI;
    lineAbreast(k, 'japan', '오스만 함대', '피얄레 파샤', ['kadirga', 'kadirga', 'kalyata'], 1200, 0, Math.PI, 22, '피얄레 기함');
    const sq = k.squad('joseon', '기독교 연합 갤리선', '조반니 안드레아 도리아', 'galea');
    k.grid(-500, 400, 0.4, 14, 5, 90, 120, 60, k.rand).forEach((p, i) => k.ship(sq, 'galea', p, i ? k.numbered('연합 갤리선', i) : '도리아 기함', i === 0));
    const tr = k.squad('joseon', '수송선', '메디나셀리 공작', 'vgalleass');
    k.grid(-1100, 900, 0.2, 4, 2, 120, 120, 30, k.rand).forEach((p, i) => k.ship(tr, 'vgalleass', p, k.numbered('수송선', i + 1), i === 0));
    b.retreatBelow.joseon = 0.5;
    b.retreatBelow.japan = 0.25;
  } else if (id === 'lepanto-north') {
    // Barbarigo's wing hugs the Aetolian shore to the north; Siroco tries to slip round inshore of it. The wind had
    // dropped and come round to the west before noon (Capponi), behind the League.
    b.windAngle = 0;
    galleassScreen(k, '좌익 갈레아스', -800, -300, 0);
    lineAbreast(k, 'joseon', '바르바리고 전대 (좌익)', '아고스티노 바르바리고', ['galea', 'galea'], -1200, -200, 0, 16, '바르바리고 기함');
    lineAbreast(k, 'japan', '시로코 전대 (우익)', '메흐메드 시로코', ['kadirga', 'kadirga', 'kalyata'], 1000, -300, Math.PI, 18, '시로코 기함');
    b.retreatBelow.japan = 0.25;
    b.retreatBelow.joseon = 0.3;
  } else if (id === 'lepanto-centre') {
    galleassScreen(k, '중앙 갈레아스', -800, 0, 0);
    b.windAngle = 0;
    lineAbreast(k, 'joseon', '돈 후안 전대 (중앙)', '돈 후안 데 아우스트리아', ['reale', 'galea', 'galea'], -1200, 0, 0, 18, '라 레알');
    lineAbreast(k, 'japan', '알리 파샤 전대 (중앙)', '뮈에진자데 알리 파샤', ['sultana', 'kadirga', 'kadirga'], 1100, 0, Math.PI, 18, '술타나');
    lineAbreast(k, 'japan', '중앙 후위', '뮈에진자데 알리 파샤', ['kalyata'], 1500, 0, Math.PI, 4, '후위 갈리오트', 60);
    b.retreatBelow.japan = 0.3;
    b.retreatBelow.joseon = 0.3;
  } else {
    // Doria edges south to avoid being outflanked, opening a gap towards the centre that Uluç Ali turns into.
    b.windAngle = 0;
    lineAbreast(k, 'joseon', '도리아 전대 (우익)', '조반니 안드레아 도리아', ['galea', 'galea'], -1100, 600, 0.12, 12, '도리아 기함');
    lineAbreast(k, 'joseon', '산타 크루스 예비대', '산타 크루스 후작', ['galea'], -2000, -200, 0, 4, '산타 크루스 기함');
    lineAbreast(k, 'japan', '울루치 알리 전대 (좌익)', '울루치 알리', ['kadirga', 'kadirga', 'kalyata'], 1100, 300, Math.PI + 0.1, 20, '울루치 기함');
    b.retreatBelow.japan = 0.35;
    b.retreatBelow.joseon = 0.3;
  }
}
