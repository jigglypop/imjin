import type { ShipKind, Team } from './types';
import type { TrafalgarSlug } from '../routes';
import type { Commander, ScenarioInfo } from './scenarios';
import type { ForceKit } from './armada';
import type { Quote } from './lepanto';
import { SCENARIO_TEXT } from './scenarioText';
import { FINISTERRE_TERRAIN, NILE_TERRAIN, ST_VINCENT_TERRAIN, TRAFALGAR_LEE_TERRAIN, TRAFALGAR_TERRAIN } from '../terrain/trafalgarTerrain';

// The Trafalgar chapter: Britain against the navies of France and Spain, from Cape St Vincent (1797) and the Nile (1798)
// to Calder's action off Finisterre and the two columns of Trafalgar (1805). In battle the British take the first slot
// ('joseon') and the French and Spanish the second ('japan'). Every ship of the line in the action is on the water,
// one for one as the 1592 battles are (owner 2026-10-17): St Vincent 15 against 27, the Nile 13 and the Leander
// against 13, Calder's action 15 against 20, Trafalgar 27 against 33, the whole action on the water in each column's
// battle (owner 2026-10-19). Frigates stay out of the count except where one is drawn. The
// ships keep their real names, in the sources' order of sailing; where a source names a ship but not her place in a
// division, the division she sails with here is the game's arrangement. Spanish three-deckers (Santa Ana, Principe de
// Asturias, Rayo, the 112s at St Vincent) sail as 'es74' and British 64s and 80s as 'gb74' until their own models exist.
// Sources (every number and name below is from these):
//   P. Goodwin, The Ships of Trafalgar (2005): the fleets of 21 October 1805, ship by ship;
//   R. Adkins, Trafalgar: The Biography of a Battle (2004): the approach, the wind and swell, the columns, the losses;
//   J. S. Corbett, The Campaign of Trafalgar (1910): Calder's action off Finisterre, the fog, the two Spanish prizes;
//   B. Lavery, Nelson and the Nile (1998): the French line at anchor in Abu Qir Bay, Foley's turn inshore, L'Orient;
//   N. A. M. Rodger, The Command of the Ocean (2004): Cape St Vincent, Nelson leaving the line, the four prizes;
//   J. D. Harbron, Trafalgar and the Spanish Navy (1988): Córdoba's fleet at St Vincent, Gravina, Churruca;
//   N. H. Nicolas (ed.), The Dispatches and Letters of Lord Nelson (1844-46): the signal and Nelson's words;
//   J. S. Tucker, Memoirs of Admiral the Earl of St Vincent (1844): Jervis on the quarterdeck of the Victory;
//   É. Desbrière, La campagne maritime de 1805: Trafalgar (1907): Villeneuve's orders.
/** Both Trafalgar column battles field the whole action (Goodwin 2005); the Combined Fleet's frigates are not drawn. */
const TRAFALGAR_FORCES = {
  joseon: '전열함 27척 (풍상 종렬 12 · 풍하 종렬 15) · 프리깃 4척',
  japan: '전열함 33척 (전위 8 · 중앙 7 · 후위 9 · 관측 전대 9), 프리깃 5척 · 브리그 2척 제외',
};

export const TRAFALGAR_SOURCES = [
  'Peter Goodwin, The Ships of Trafalgar, 2005',
  'Roy Adkins, Trafalgar: The Biography of a Battle, 2004',
  'Julian S. Corbett, The Campaign of Trafalgar, 1910',
  'Brian Lavery, Nelson and the Nile, 1998',
  'N. A. M. Rodger, The Command of the Ocean, 2004',
  'John D. Harbron, Trafalgar and the Spanish Navy, 1988',
  'Nicholas H. Nicolas (편), The Dispatches and Letters of Lord Nelson, 1844–1846',
  'Jedediah S. Tucker, Memoirs of Admiral the Earl of St. Vincent, 1844',
  'Édouard Desbrière, La campagne maritime de 1805: Trafalgar, 1907',
];

const NELSON: Commander = { name: '허레이쇼 넬슨', title: '지중해 함대 사령관 · 해군 중장', figure: 'fig_nelson', portrait: 'portrait_nelson', banner: 'N' };
const COLLINGWOOD: Commander = { name: '커스버트 콜링우드', title: '해군 중장 · 풍하 종렬 사령관', figure: 'fig_collingwood', portrait: 'portrait_collingwood', banner: 'C' };
const JERVIS: Commander = { name: '존 저비스', title: '지중해 함대 사령관 · 해군 대장', figure: 'fig_jervis', portrait: 'portrait_jervis', banner: 'J' };
const CALDER: Commander = { name: '로버트 콜더', title: '해군 중장 · 페롤 봉쇄 함대 사령관', figure: 'fig_calder', portrait: 'portrait_calder', banner: 'RC' };
const VILLENEUVE: Commander = { name: '피에르 빌뇌브', title: '프랑스·에스파냐 연합 함대 사령관', figure: 'fig_villeneuve', portrait: 'portrait_villeneuve', banner: 'V' };
const GRAVINA: Commander = { name: '페데리코 그라비나', title: '에스파냐 함대 사령관 · 관측 전대', figure: 'fig_gravina', portrait: 'portrait_gravina', banner: 'G' };
const BRUEYS: Commander = { name: '프랑수아폴 브뤼에스', title: '프랑스 동방 원정 함대 사령관', figure: 'fig_brueys', portrait: 'portrait_brueys', banner: 'B' };
const CORDOBA: Commander = { name: '호세 데 코르도바', title: '에스파냐 함대 사령관', figure: 'fig_cordoba', portrait: 'portrait_cordoba', banner: 'JC' };

/**
 * Lines the battle-opening cinematics can give each side's commander: recorded words (with the record) or, marked
 * "인물 대사 아님", a summary of what the sources say he ordered. Keyed by battle.
 */
export const TRAFALGAR_QUOTES: Record<TrafalgarSlug, { joseon: Quote; japan: Quote }> = {
  'st-vincent': {
    joseon: { text: '그만하게. 주사위는 던져졌네. 적이 쉰 척이라도 뚫고 지나가겠네.', source: '에스파냐 함선 수를 보고하던 함장에게 저비스가 한 말 (Tucker 1844, 1권)' },
    japan: { text: '두 무리를 합쳐라. 적의 꼬리를 돌아 카디스로 간다.', source: '코르도바의 기동을 요약한 서술(인물 대사 아님), Harbron 1988' },
  },
  nile: {
    joseon: { text: '내일 이맘때면 나는 귀족 작위를 얻었거나 웨스트민스터 사원에 묻혀 있을 것이다.', source: '전투 직전 넬슨이 장교들에게 한 말로 전해짐 (Nicolas 1845, 3권; Lavery 1998)' },
    japan: { text: '닻을 내린 채 싸운다. 해안 쪽은 얕아 적이 들어오지 못한다.', source: '브뤼에스의 정박 방어 결정을 요약한 서술(인물 대사 아님), Lavery 1998' },
  },
  finisterre: {
    joseon: { text: '안개 속이라도 적의 꼬리를 붙잡아라.', source: '콜더의 공격 신호를 요약한 서술(인물 대사 아님), Corbett 1910' },
    japan: { text: '대열을 지켜라. 우리의 목적지는 페롤이다.', source: '빌뇌브의 항로 유지를 요약한 서술(인물 대사 아님), Corbett 1910' },
  },
  'trafalgar-weather': {
    joseon: { text: '영국은 모든 이가 제 의무를 다하기를 기대한다.', source: '1805년 10월 21일 11시 45분 무렵 빅토리호가 올린 신호 "England expects that every man will do his duty" (신호 장교 존 파스코의 기록, Nicolas 1846, 7권)' },
    japan: { text: '포화 속에 있지 않은 함장은 제자리에 있지 않은 것이다.', source: '빌뇌브의 함대 훈령 "Tout capitaine qui n\'est pas dans le feu n\'est pas à son poste" (Desbrière 1907)' },
  },
  'trafalgar-lee': {
    joseon: { text: '로더럼, 넬슨이 지금 여기 있으려고 무엇인들 주지 않겠나!', source: '로열 소버린호가 먼저 적진에 들어설 때 콜링우드가 함장 로더럼에게 한 말로 전해짐 (Adkins 2004)' },
    japan: { text: '후위를 지켜라. 적이 우리 대열을 끊지 못하게 하라.', source: '그라비나의 관측 전대 배치를 요약한 서술(인물 대사 아님), Harbron 1988' },
  },
};

export const TRAFALGAR_ORDER: TrafalgarSlug[] = ['st-vincent', 'nile', 'finisterre', 'trafalgar-weather', 'trafalgar-lee'];
export const isTrafalgarBattle = (id: string): id is TrafalgarSlug => (TRAFALGAR_ORDER as string[]).includes(id);

export const TRAFALGAR_TEMPERS: [string, 'rash' | 'cautious' | 'bold' | 'steady'][] = [
  ['넬슨', 'bold'],
  ['콜링우드', 'steady'],
  ['저비스', 'steady'],
  ['콜더', 'cautious'],
  ['빌뇌브', 'cautious'],
  ['그라비나', 'steady'],
  ['브뤼에스', 'cautious'],
  ['코르도바', 'cautious'],
  ['뤼카', 'bold'],
  ['추루카', 'steady'],
  ['뒤마누아르', 'cautious'],
];

export const TRAFALGAR_PORTRAITS: [string, string][] = [
  ['넬슨', 'portrait_nelson'],
  ['콜링우드', 'portrait_collingwood'],
  ['하디', 'portrait_hardy'],
  ['블랙우드', 'portrait_blackwood'],
  ['저비스', 'portrait_jervis'],
  ['콜더', 'portrait_calder'],
  ['빌뇌브', 'portrait_villeneuve'],
  ['뤼카', 'portrait_lucas'],
  ['그라비나', 'portrait_gravina'],
  ['추루카', 'portrait_churruca'],
  ['브뤼에스', 'portrait_brueys'],
  ['코르도바', 'portrait_cordoba'],
];

export const TRAFALGAR_SCENARIOS: Record<TrafalgarSlug, ScenarioInfo> = {
  'st-vincent': {
    id: 'st-vincent',
    ...SCENARIO_TEXT['st-vincent'],
    season: '겨울 · 아침',
    difficulty: '어려움',
    summary:
      '1797년 2월 14일 아침, 안개가 걷히자 저비스의 영국 함대 15척 앞에 코르도바의 에스파냐 함대 27척이 두 무리로 흩어져 있었습니다. 저비스는 한 줄로 두 무리 사이를 뚫고 들어가 뱃머리를 돌려 큰 무리를 쫓았습니다. 에스파냐 본대가 영국 대열의 꼬리를 돌아 빠져나가려 하자, 넬슨은 명령 없이 캡틴호를 대열에서 빼내 그 앞을 막았고, 산니콜라스호와 산호세호에 차례로 올라타 두 배를 붙잡았습니다.',
    result: '영국 승리, 에스파냐 전열함 4척 나포',
    forces: { joseon: '전열함 15척 (3층 갑판 6척)', japan: '전열함 27척 (산티시마 트리니다드 포함, 본대 18척 · 풍하 분대 9척)' },
    sky: 'day',
    sea: 'moderate',
    night: false,
    terrain: ST_VINCENT_TERRAIN,
    joseon: JERVIS,
    japan: CORDOBA,
    map: { x: 0.2, y: 0.78 },
    arrows: [{ from: [0.2, 0.7], to: [0.2, 0.78], team: 'joseon' }],
    view: { tx: 0, tz: -600, dir: Math.PI * 0.5, dist: 1050, pitch: 0.28 },
  },
  nile: {
    id: 'nile',
    ...SCENARIO_TEXT.nile,
    season: '여름 · 해 질 녘',
    difficulty: '보통',
    summary:
      '1798년 8월 1일 오후, 이집트 원정군을 싣고 온 브뤼에스의 프랑스 함대 13척이 아부키르 만에 한 줄로 닻을 내리고 있었습니다. 저녁 여섯 시가 넘어 도착한 넬슨은 날이 저무는데도 곧바로 공격했습니다. 앞장선 골리앗호의 폴리 함장이 프랑스 대열의 머리를 돌아 얕은 해안 쪽으로 들어갔고, 뒤따른 배들이 대열 양쪽에서 프랑스 배를 하나씩 끼고 쏘았습니다. 밤 열 시 무렵 기함 로리앙호가 불타 폭발했습니다.',
    result: '영국 대승, 프랑스 전열함 11척 나포·격침 · 로리앙호 폭발 · 브뤼에스 전사',
    forces: { joseon: '74문 전열함 12척 · 50문함 리앤더 (좌초한 컬로든 제외)', japan: '전열함 13척 (닻을 내린 한 줄, 프리깃 4척 제외)' },
    sky: 'sunset',
    sea: 'calm',
    night: false,
    terrain: NILE_TERRAIN,
    joseon: { ...NELSON, title: '해군 소장 · 지중해 분견 함대 사령관' },
    japan: BRUEYS,
    map: { x: 0.9, y: 0.9 },
    arrows: [{ from: [0.86, 0.86], to: [0.9, 0.9], team: 'joseon' }],
    view: { tx: -400, tz: -400, dir: Math.PI * 0.25, dist: 1100, pitch: 0.3 },
  },
  finisterre: {
    id: 'finisterre',
    ...SCENARIO_TEXT.finisterre,
    season: '여름 · 오후 · 안개',
    difficulty: '보통',
    summary:
      '1805년 7월 22일, 서인도에서 돌아오던 빌뇌브의 연합 함대 20척이 피니스테레 곶 앞바다에서 콜더의 영국 함대 15척과 마주쳤습니다. 짙은 안개 속에서 두 함대는 서로를 제대로 보지 못한 채 엇갈리며 포를 쏘았고, 앞장선 그라비나의 에스파냐 배들이 가장 많이 맞았습니다. 해 질 녘까지 산라파엘호와 피르메호가 붙잡혔지만, 콜더는 이튿날 다시 싸우지 않았고 빌뇌브는 비고를 거쳐 페롤로 들어갔습니다.',
    result: '결정적 승패 없음, 에스파냐 전열함 2척 나포 · 콜더는 뒤에 군법회의에 회부',
    forces: { joseon: '전열함 15척 (98문함 4척)', japan: '전열함 20척 (에스파냐 6척 · 프랑스 14척)' },
    sky: 'overcast',
    sea: 'moderate',
    night: false,
    terrain: FINISTERRE_TERRAIN,
    joseon: CALDER,
    japan: VILLENEUVE,
    map: { x: 0.12, y: 0.12 },
    arrows: [{ from: [0.16, 0.08], to: [0.12, 0.12], team: 'joseon' }],
    view: { tx: 0, tz: -400, dir: Math.PI * 0.5, dist: 1050, pitch: 0.28 },
  },
  'trafalgar-weather': {
    id: 'trafalgar-weather',
    ...SCENARIO_TEXT['trafalgar-weather'],
    season: '가을 · 한낮',
    difficulty: '어려움',
    summary:
      '1805년 10월 21일, 카디스에서 나온 연합 함대 33척이 바람이 약한 바다에서 북쪽으로 길게 늘어선 초승달 대열을 이루었습니다. 넬슨은 함대를 두 줄로 나누어 대열에 직각으로 들이받았습니다. 빅토리호가 이끈 풍상 종렬은 큰 너울 위를 천천히 다가가며 반 시간 넘게 일방적으로 포격을 받았고, 빅토리호는 뷔상토르호의 고물을 지나며 포를 퍼부은 뒤 르두타블호와 맞붙었습니다. 넬슨은 르두타블호 돛대 위에서 날아온 총탄에 맞아 쓰러졌고, 승리를 들은 뒤 숨을 거두었습니다.',
    result: '영국 승리, 뷔상토르·산티시마 트리니다드·르두타블 나포 · 빌뇌브 포로 · 넬슨 전사',
    forces: TRAFALGAR_FORCES,
    sky: 'day',
    sea: 'moderate',
    night: false,
    terrain: TRAFALGAR_TERRAIN,
    joseon: NELSON,
    japan: VILLENEUVE,
    map: { x: 0.3, y: 0.82 },
    arrows: [{ from: [0.24, 0.82], to: [0.3, 0.82], team: 'joseon' }],
    view: { tx: -500, tz: 0, dir: Math.PI * 0.5, dist: 1050, pitch: 0.28 },
  },
  'trafalgar-lee': {
    id: 'trafalgar-lee',
    ...SCENARIO_TEXT['trafalgar-lee'],
    season: '가을 · 한낮',
    difficulty: '어려움',
    summary:
      '같은 날 정오 무렵, 콜링우드의 로열 소버린호가 풍하 종렬의 맨 앞에서 홀로 연합 함대 후위로 뛰어들어 에스파냐의 산타아나호와 맞붙었습니다. 뒤따른 배들이 하나씩 대열을 끊고 들어가 근접 난전이 벌어졌습니다. 추루카의 산후안 네포무세노호는 여섯 척에 둘러싸여 싸우다 추루카가 전사한 뒤 항복했고, 프랑스의 아실호는 불타 폭발했습니다. 크게 다친 그라비나는 남은 배를 모아 카디스로 물러났습니다.',
    result: '영국 승리, 연합 함대 후위 대부분 나포 · 아실호 폭발 · 추루카 전사',
    forces: TRAFALGAR_FORCES,
    sky: 'afternoon',
    sea: 'moderate',
    night: false,
    terrain: TRAFALGAR_LEE_TERRAIN,
    joseon: COLLINGWOOD,
    japan: GRAVINA,
    map: { x: 0.3, y: 0.84 },
    arrows: [{ from: [0.24, 0.86], to: [0.3, 0.84], team: 'joseon' }],
    view: { tx: -500, tz: 0, dir: Math.PI * 0.5, dist: 1050, pitch: 0.28 },
  },
};

type Spot = { x: number; z: number; h: number };
type Entry = [ShipKind, string];

/**
 * A line of battle in line ahead, as the ships of 1805 fought: one ship astern of the next, about two ship lengths
 * apart (a cable, scaled). The first entry leads; `flag` is the index of the flagship. `bow` bends the line into the
 * crescent the Combined Fleet formed at Trafalgar (metres of sideways offset at the ends).
 */
function lineAhead(k: ForceKit, team: Team, name: string, cmd: string, ships: Entry[], x: number, z: number, heading: number, flag: number, gap = 120, bow = 0) {
  const c = Math.cos(heading), s = Math.sin(heading);
  const sq = k.squad(team, name, cmd, ships[flag]![0]);
  const n = ships.length;
  ships.forEach(([kind, ship], i) => {
    const along = -i * gap;
    const t = n > 1 ? (2 * i) / (n - 1) - 1 : 0;
    const side = bow * t * t;
    const p: Spot = { x: x + c * along - s * side + (k.rand() - 0.5) * 12, z: z + s * along + c * side + (k.rand() - 0.5) * 12, h: heading + (k.rand() - 0.5) * 0.06 };
    k.ship(sq, kind, p, ship, i === flag);
  });
  return sq;
}

/** Ships at anchor in a line, heads to the wind (the Nile): nothing moves until it is ordered to. */
function anchorAll(k: ForceKit, team: Team) {
  for (const sh of k.b.ships) if (sh.team === team) { sh.order = { type: 'anchor' }; sh.speed = 0; }
}

export function trafalgarForces(id: TrafalgarSlug, k: ForceKit) {
  const { b } = k;
  b.windDrift = 0.12;
  // North is -z, east +x; windAngle is where the wind blows to.
  if (id === 'st-vincent') {
    // Wind W by S. Jervis in one line heading south between the Spanish main body (west, to windward) and the lee
    // division to the east (Rodger 2004; Harbron 1988).
    b.windAngle = -0.2;
    lineAhead(k, 'joseon', '영국 지중해 함대', '존 저비스', [['gb74', '컬로든'], ['firstrate', '블레넘'], ['firstrate', '프린스 조지'], ['gb74', '오라이언'], ['gb74', '콜로서스'], ['gb74', '이리지스터블'], ['firstrate', '빅토리'], ['gb74', '에그먼트'], ['gb74', '골리앗'], ['firstrate', '바플러'], ['firstrate', '브리태니아'], ['firstrate', '나무르'], ['gb74', '캡틴 (넬슨)'], ['gb74', '다이어뎀'], ['gb74', '엑설런트']], 0, -400, Math.PI / 2, 6, 110);
    lineAhead(k, 'japan', '에스파냐 본대', '호세 데 코르도바', [['es74', '산호세'], ['es74', '살바도르 델 문도'], ['es74', '산니콜라스'], ['trinidad', '산티시마 트리니다드'], ['es74', '산이시드로'], ['es74', '멕시카노'], ['es74', '콘셉시온'], ['es74', '콘데 데 레글라'], ['es74', '오리엔테'], ['es74', '소베라노'], ['es74', '산일데폰소'], ['es74', '프린시페 데 아스투리아스'], ['es74', '넵투노'], ['es74', '산안토니오'], ['es74', '산도밍고'], ['es74', '피르메'], ['es74', '산프란시스코 데 파울라'], ['es74', '산헤나로']], -1700, 900, -0.55, 3, 110, 160);
    lineAhead(k, 'japan', '에스파냐 풍하 분대', '호아킨 모레노', [['es74', '펠라요'], ['es74', '산파블로'], ['es74', '산페르민'], ['es74', '바하마'], ['es74', '아틀란테'], ['es74', '글로리오소'], ['es74', '산후안 네포무세노'], ['es74', '콩키스타도르'], ['es74', '테리블레']], 1800, 1200, -2.4, 0, 125);
    b.retreatBelow.japan = 0.4;
    b.retreatBelow.joseon = 0.3;
  } else if (id === 'nile') {
    // Wind NNW, blowing to the SSE. The French at anchor in a line from north-west (van) to south-east, heads to the
    // wind; Nelson comes down from the north-west and Foley's Goliath leads round the head of the line inshore (Lavery 1998).
    b.windAngle = 1.18;
    const heading = -1.96;
    const dx = 0.71, dz = 0.71;
    // The thirteen of the line, van to rear (Lavery 1998); the four frigates inshore of the line are left out.
    const french: Entry[] = [['fr74', '게리에'], ['fr74', '콩케랑'], ['fr74', '스파르티아트'], ['fr74', '아킬롱'], ['fr74', '푀플 수브랭'], ['fr80', '프랭클랭'], ['fr80', '로리앙'], ['fr80', '토낭'], ['fr74', '외뢰'], ['fr74', '메르퀴르'], ['fr80', '기욤 텔'], ['fr74', '제네뢰'], ['fr74', '티몰레옹']];
    const sq = k.squad('japan', '프랑스 동방 함대', '프랑수아폴 브뤼에스', 'fr80');
    french.forEach(([kind, name], i) => {
      const t = (i - (french.length - 1) / 2) * 160;
      k.ship(sq, kind, { x: dx * t, z: dz * t, h: heading }, name, name === '로리앙');
    });
    anchorAll(k, 'japan');
    lineAhead(k, 'joseon', '골리앗 선두 (해안 쪽)', '토머스 폴리', [['gb74', '골리앗'], ['gb74', '질러스'], ['gb74', '오라이언'], ['gb74', '오데이셔스'], ['gb74', '시시어스']], -1500, -1900, 0.95, 0, 130);
    lineAhead(k, 'joseon', '넬슨 본대 (바다 쪽)', '허레이쇼 넬슨', [['gb74', '뱅가드'], ['gb74', '미노타우로스'], ['gb74', '디펜스'], ['gb74', '벨레로폰'], ['gb74', '머제스틱']], -1000, -2500, 0.8, 0, 130);
    // Alexander, Swiftsure and the 50-gun Leander came up after dark; Culloden ran aground on the shoal off Abu Qir
    // island and never fired, so she is not drawn (Lavery 1998).
    lineAhead(k, 'joseon', '늦게 도착한 분대', '알렉산더 볼', [['gb74', '알렉산더'], ['gb74', '스위프트슈어'], ['gbfrigate', '리앤더']], -2300, -2700, 0.8, 0, 140);
    b.retreatBelow.japan = 0.15;
    b.retreatBelow.joseon = 0.3;
  } else if (id === 'finisterre') {
    // Light westerly airs and fog (Corbett 1910). The Combined Fleet in line heading east for Ferrol, Gravina's
    // Spaniards leading; Calder's line on the opposite course to the north, then tacking down on the van.
    b.windAngle = 0.15;
    lineAhead(k, 'japan', '연합 함대 선두 (에스파냐)', '페데리코 그라비나', [['es74', '아르고나우타'], ['es74', '테리블레'], ['es74', '아메리카'], ['es74', '에스파냐호'], ['es74', '산라파엘'], ['es74', '피르메']], 1500, 300, 0, 0, 115);
    lineAhead(k, 'japan', '연합 함대 본대 (프랑스)', '피에르 빌뇌브', [['fr74', '플뤼통'], ['fr74', '몽블랑'], ['fr74', '아틀라스'], ['fr74', '베릭'], ['fr80', '넵튠'], ['fr80', '뷔상토르'], ['fr80', '포르미다블'], ['fr74', '앵트레피드'], ['fr74', '스키피옹'], ['fr74', '스위프트슈어'], ['fr80', '앵동타블'], ['fr74', '에글'], ['fr74', '아실'], ['fr74', '알제지라스']], 800, 300, 0, 5, 115);
    lineAhead(k, 'joseon', '콜더 함대', '로버트 콜더', [['gb74', '히어로'], ['gb74', '에이잭스'], ['gb74', '트라이엄프'], ['firstrate', '바플러'], ['gb74', '아가멤논'], ['firstrate', '윈저 캐슬'], ['gb74', '디파이언스'], ['firstrate', '프린스 오브 웨일스'], ['gb74', '리펄스'], ['gb74', '레조너블'], ['gb74', '드래건'], ['firstrate', '글로리'], ['gb74', '워리어'], ['gb74', '선더러'], ['gb74', '몰타']], -900, -1100, 0.12, 7, 115);
    b.retreatBelow.japan = 0.45;
    b.retreatBelow.joseon = 0.4;
  } else {
    // Trafalgar, light airs from the WNW and a heavy swell (Adkins 2004). Both columns struck at once, so each column's
    // battle puts the whole action on the water: 27 British of the line and 4 frigates against the Combined Fleet's 33
    // (Goodwin 2005). The column the battle is named for is at the view; the other lies 2.6 km north or south of it.
    // The Combined Fleet's 5 frigates and 2 brigs are not drawn: there is no French frigate model yet.
    b.windAngle = 0.39;
    const lee = id === 'trafalgar-lee';
    const nz = lee ? -2600 : 0, sz = lee ? 0 : 2600;
    // Nelson's weather column heading east for the gap astern of the Bucentaure; Dumanoir's van ahead of the centre.
    lineAhead(k, 'japan', '뒤마누아르 전위', '피에르 뒤마누아르', [['es74', '넵투노'], ['fr74', '스키피옹'], ['fr74', '앵트레피드'], ['fr80', '포르미다블'], ['fr74', '뒤게트루앵'], ['fr74', '몽블랑'], ['es74', '라요'], ['es74', '산프란시스코 데 아시스']], 520, -1000 + nz, -Math.PI / 2, 3, 120, 50);
    lineAhead(k, 'japan', '연합 함대 중앙', '피에르 빌뇌브', [['fr74', '에로'], ['es74', '산아구스틴'], ['trinidad', '산티시마 트리니다드'], ['fr80', '뷔상토르'], ['fr74', '르두타블 (뤼카)'], ['fr80', '넵튠'], ['es74', '산레안드로']], 380, 420 + nz, -Math.PI / 2, 3, 125, -60);
    lineAhead(k, 'joseon', '풍상 종렬', '허레이쇼 넬슨', [['firstrate', '빅토리'], ['firstrate', '테메레르'], ['firstrate', '넵튠'], ['gb74', '리바이어선'], ['gb74', '컨커러'], ['firstrate', '브리태니아'], ['gb74', '에이잭스'], ['gb74', '아가멤논'], ['gb74', '오라이언'], ['gb74', '미노타우로스'], ['gb74', '스파르티에이트']], -1100, 60 + nz, 0, 0, 110);
    // The 64-gun Africa had lost touch in the night and came down alone from the north along the van (Goodwin 2005).
    const africa = k.squad('joseon', '아프리카', '헨리 딕비', 'gb74');
    k.ship(africa, 'gb74', { x: -300, z: -1700 + nz, h: 0.9 }, '아프리카', true);
    // Collingwood's column breaks the rear astern of the Santa Ana; Gravina's observation squadron closes the end of the line.
    lineAhead(k, 'japan', '연합 함대 후위', '이그나시오 데 알라바', [['es74', '산후스토'], ['es74', '산타아나'], ['fr80', '앵동타블'], ['fr74', '푸괴'], ['es74', '모나르카'], ['fr74', '플뤼통'], ['es74', '바하마'], ['fr74', '에글'], ['es74', '몬타녜스']], 380, -480 + sz, -Math.PI / 2, 1, 120, -50);
    lineAhead(k, 'japan', '관측 전대', '페데리코 그라비나', [['fr74', '알제지라스'], ['es74', '아르고나우타'], ['fr74', '스위프트슈어'], ['fr74', '아르고노트'], ['es74', '산일데폰소'], ['fr74', '아실'], ['es74', '프린시페 데 아스투리아스'], ['fr74', '베릭'], ['es74', '산후안 네포무세노 (추루카)']], 560, 720 + sz, -Math.PI / 2, 6, 120, 40);
    lineAhead(k, 'joseon', '풍하 종렬', '커스버트 콜링우드', [['firstrate', '로열 소버린'], ['gb74', '벨아일'], ['gb74', '마스'], ['gb74', '토낭'], ['gb74', '벨레로폰'], ['gb74', '콜로서스'], ['gb74', '아킬레스'], ['firstrate', '드레드노트'], ['gb74', '폴리페무스'], ['gb74', '리벤지'], ['gb74', '스위프트슈어'], ['gb74', '디파이언스'], ['gb74', '선더러'], ['gb74', '디펜스'], ['firstrate', '프린스']], -1000, -320 + sz, 0.08, 0, 105);
    // Blackwood's frigates repeating signals to windward of the columns (Goodwin 2005).
    lineAhead(k, 'joseon', '프리깃', '헨리 블랙우드', [['gbfrigate', '유리알러스'], ['gbfrigate', '나이어드'], ['gbfrigate', '피비'], ['gbfrigate', '시리어스']], -1500, -700 + nz, 0.1, 0, 700);
    b.retreatBelow.japan = 0.35;
    b.retreatBelow.joseon = 0.25;
  }
}
