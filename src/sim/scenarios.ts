import { Battle } from './battle';
import { SHIP_SPECS } from './catalog';
import { DEPTH_LATEST } from './depth';
import { SEA_STATES } from '../ocean/waves';
import { variantFor } from '../ships/anchors';
import type { Faction, ShipKind, ShipMods, Squadron, Team } from './types';
import type { Temper } from './maneuvers';
import {
  ANGOLPO_TERRAIN,
  BUSAN_TERRAIN,
  CHILCHEON_TERRAIN,
  DANGPO_TERRAIN,
  HANSAN_TERRAIN,
  MYEONGNYANG_TERRAIN,
  NORYANG_BATTLE_TERRAIN,
  OKPO_TERRAIN,
  SACHEON_TERRAIN,
  type TerrainSpec,
} from '../terrain/generate';
import type { SkyPresetName } from '../render/sky';
import type { SeaStateName } from '../ocean/waves';
import type { CurrentSpec } from './current';
import { echelon, flagshipOf, numbered } from '../i18n/names';
import type { BattleSlug, ChapterId } from '../routes';
import { SCENARIO_TEXT, type ScenarioText } from './scenarioText';
import { ARMADA_ORDER, ARMADA_PORTRAITS, ARMADA_SCENARIOS, ARMADA_TEMPERS, armadaForces, isArmadaBattle } from './armada';
import { LEPANTO_ORDER, LEPANTO_PORTRAITS, LEPANTO_SCENARIOS, LEPANTO_TEMPERS, lepantoForces, isLepantoBattle } from './lepanto';
import { TRAFALGAR_ORDER, TRAFALGAR_PORTRAITS, TRAFALGAR_SCENARIOS, TRAFALGAR_TEMPERS, trafalgarForces, isTrafalgarBattle } from './trafalgar';
export { ARMADA_ORDER, isArmadaBattle, LEPANTO_ORDER, isLepantoBattle, TRAFALGAR_ORDER, isTrafalgarBattle };

/** The nine historical battles. Each has an address of its own (/battles/hansan), so the id list lives in src/routes.ts. */
export type ScenarioId = BattleSlug;

export type Commander = { name: string; title: string; figure: string; portrait: string; banner: string };

/** A battle's title, hanja, date, place and one-line hook come from scenarioText.ts. */
export type ScenarioInfo = ScenarioText & {
  id: ScenarioId;
  season: string;
  difficulty: string;
  summary: string;
  result: string;
  /** The two sides' forces, by battle slot: in a later chapter 'joseon' is its first navy and 'japan' its second. */
  forces: { joseon: string; japan: string; ming?: string };
  sky: SkyPresetName;
  sea: SeaStateName;
  night: boolean;
  current?: CurrentSpec;
  terrain: TerrainSpec;
  joseon: Commander;
  japan: Commander;
  /** Only where the Ming fleet took part. */
  ming?: Commander;
  map: { x: number; y: number };
  arrows: { from: [number, number]; to: [number, number]; team: Team }[];
  view: { tx: number; tz: number; dir: number; dist: number; pitch: number };
};

type Place = (x: number, z: number) => { x: number; z: number };

export type FleetSpawn = {
  /** The navy the campaign's fleet replaces in the battle: Joseon in 1592, England in the Armada chapter. */
  faction?: 'joseon' | 'england';
  squads: {
    name: string;
    commander: string;
    portrait: string;
    ships: { kind: ShipKind; name: string; hull: number; crew: number; supply: number; campaignId: string; mods: ShipMods; flagship: boolean }[];
  }[];
};
type Spot = { x: number; z: number; h: number };
type LandFn = (x: number, z: number) => number;

const YI: Commander = { name: '이순신', title: '전라좌도 수군절도사', figure: 'fig_yi', portrait: 'portrait_yi', banner: '李' };
const YI_TONGJE: Commander = { ...YI, title: '삼도수군통제사' };

export const SCENARIOS: Record<ScenarioId, ScenarioInfo> = {
  okpo: {
    id: 'okpo',
    ...SCENARIO_TEXT.okpo,
    season: '늦봄',
    difficulty: '쉬움',
    summary:
      '임진왜란이 시작되고 3주쯤 지난 5월 7일, 조선 수군이 처음으로 출전한 해전입니다. 도도 다카토라가 이끄는 일본 함선들이 옥포 포구에 정박해 마을을 약탈하고 있었고, 이순신의 함대가 포구로 들어가 공격했습니다. 일본 함선 26척을 격파했으며 조선 수군의 손실은 없었습니다.',
    result: '일본 함선 26척 격파, 아군 손실 없음',
    forces: { joseon: '판옥선 28척 · 협선 17척', japan: '함선 50여 척 (정박)' },
    sky: 'afternoon',
    sea: 'rough',
    night: false,
    terrain: OKPO_TERRAIN,
    joseon: YI,
    japan: { name: '도도 다카토라', title: '수군 장수', figure: 'fig_todo', portrait: 'portrait_todo', banner: '藤堂' },
    map: { x: 0.64, y: 0.6 },
    arrows: [{ from: [0.71, 0.66], to: [0.645, 0.605], team: 'joseon' }],
    view: { tx: 1500, tz: 300, dir: Math.PI, dist: 1150, pitch: 0.3 },
  },
  sacheon: {
    id: 'sacheon',
    ...SCENARIO_TEXT.sacheon,
    season: '초여름',
    difficulty: '보통',
    summary:
      '거북선이 처음으로 실전에 투입된 해전입니다. 일본군은 언덕 위에 조총 부대를 두고 선창에 배를 정박해 두었는데, 조선 수군은 물러나는 척하며 일본 함선을 바다로 끌어낸 뒤 거북선을 앞세워 돌격했습니다. 이순신은 이 싸움에서 왼쪽 어깨에 총상을 입었습니다.',
    result: '일본 함선 13척 전부 격파',
    forces: { joseon: '판옥선 25척 · 거북선 1척', japan: '대선 4척 · 중선 9척' },
    sky: 'day',
    sea: 'rough',
    night: false,
    terrain: SACHEON_TERRAIN,
    joseon: YI,
    japan: { name: '사천 주둔 일본군', title: '선창 수비대', figure: 'fig_japan', portrait: 'portrait_japan', banner: '日' },
    map: { x: 0.5, y: 0.56 },
    arrows: [{ from: [0.52, 0.64], to: [0.5, 0.565], team: 'joseon' }],
    view: { tx: 0, tz: -200, dir: -Math.PI / 2, dist: 1050, pitch: 0.3 },
  },
  dangpo: {
    id: 'dangpo',
    ...SCENARIO_TEXT.dangpo,
    season: '여름',
    difficulty: '보통',
    summary:
      '당포 선창에 정박한 일본 함선 21척을 공격한 해전입니다. 거북선이 높은 누각을 얹은 일본 대장선을 들이받고 판옥선들이 총통을 쏘았으며, 일본 장수 구루시마 미치유키가 화살에 맞아 쓰러졌습니다.',
    result: '일본 함선 21척 전부 격파, 적장 구루시마 미치유키 전사',
    forces: { joseon: '판옥선 24척 · 거북선 2척', japan: '대선 9척 · 중소선 12척' },
    sky: 'afternoon',
    sea: 'rough',
    night: false,
    terrain: DANGPO_TERRAIN,
    joseon: YI,
    japan: { name: '구루시마 미치유키', title: '수군 장수', figure: 'fig_kurushima', portrait: 'portrait_kurushima', banner: '來島' },
    map: { x: 0.56, y: 0.63 },
    arrows: [{ from: [0.6, 0.68], to: [0.565, 0.635], team: 'joseon' }],
    view: { tx: 300, tz: 200, dir: -2.2, dist: 1050, pitch: 0.3 },
  },
  hansan: {
    id: 'hansan',
    ...SCENARIO_TEXT.hansan,
    season: '여름',
    difficulty: '보통',
    summary:
      '견내량의 좁은 물길에 정박한 와키자카 야스하루의 함대를 한산도 앞바다로 끌어낸 해전입니다. 조선 수군은 판옥선 몇 척으로 적을 유인한 뒤 학익진으로 에워싸고 총통을 쏘아 59척을 격침하거나 나포했습니다.',
    result: '일본 함선 59척 격침·나포, 14척 도주',
    forces: { joseon: '판옥선 53척 · 거북선 3척', japan: '대선 36척 · 중선 24척 · 소선 13척' },
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
    ...SCENARIO_TEXT.angolpo,
    season: '여름',
    difficulty: '어려움',
    summary:
      '한산도 대첩 이틀 뒤, 구키 요시타카와 가토 요시아키의 함대가 정박한 안골포를 공격한 해전입니다. 포구가 좁고 얕아 판옥선이 한꺼번에 들어갈 수 없었기 때문에, 여러 척이 번갈아 드나들며 정박한 일본 함선에 총통을 쏘았습니다.',
    result: '일본 함선 20여 척 격파, 남은 적은 밤에 도주',
    forces: { joseon: '판옥선 52척 · 거북선 2척', japan: '대선 21척 · 중선 15척 · 소선 6척' },
    sky: 'overcast',
    sea: 'rough',
    night: false,
    terrain: ANGOLPO_TERRAIN,
    joseon: YI,
    japan: { name: '구키 요시타카', title: '수군 대장', figure: 'fig_kuki', portrait: 'portrait_kuki', banner: '九鬼' },
    map: { x: 0.67, y: 0.5 },
    arrows: [{ from: [0.63, 0.58], to: [0.665, 0.505], team: 'joseon' }],
    view: { tx: 200, tz: 150, dir: -Math.PI / 2, dist: 1150, pitch: 0.3 },
  },
  busan: {
    id: 'busan',
    ...SCENARIO_TEXT.busan,
    season: '가을',
    difficulty: '어려움',
    summary:
      '일본군의 거점인 부산포에는 470여 척이 정박해 있었습니다. 조선 수군은 포구 안으로 돌입해 해안의 조총 사격을 받으면서도 정박한 일본 함선을 차례로 불태웠습니다. 선봉장 정운이 이 싸움에서 전사했습니다.',
    result: '일본 함선 100여 척 격파',
    forces: { joseon: '판옥선 71척 · 거북선 3척 · 협선 92척', japan: '정박 함선 470여 척' },
    sky: 'day',
    sea: 'rough',
    night: false,
    terrain: BUSAN_TERRAIN,
    joseon: YI,
    japan: { name: '부산 주둔 일본군', title: '주둔 수군', figure: 'fig_japan', portrait: 'portrait_japan', banner: '日' },
    map: { x: 0.77, y: 0.47 },
    arrows: [{ from: [0.66, 0.6], to: [0.76, 0.48], team: 'joseon' }],
    view: { tx: -1000, tz: 2700, dir: -1.33, dist: 1100, pitch: 0.3 },
  },
  chilcheon: {
    id: 'chilcheon',
    ...SCENARIO_TEXT.chilcheon,
    season: '여름 · 새벽',
    difficulty: '극히 어려움',
    summary:
      '이순신이 투옥된 뒤 삼도수군통제사가 된 원균은 칠천량에 함대를 정박시켰습니다. 새벽 어둠 속에서 일본 함대가 사방으로 접근해 기습했고, 조선 수군은 이 싸움에서 궤멸했습니다. 포위를 뚫고 최대한 많은 함선을 지키는 것이 목표입니다.',
    result: '조선 수군 궤멸, 배설의 판옥선 12척만 탈출',
    forces: { joseon: '판옥선 134척 · 거북선 3척', japan: '함선 500여 척 (야습)' },
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
    ...SCENARIO_TEXT.myeongnyang,
    season: '가을',
    difficulty: '매우 어려움',
    summary:
      '칠천량의 패배 뒤 조선 수군에게 남은 배는 열세 척뿐이었습니다. 이순신은 울돌목의 거센 물살을 이용해 일본 함선 133척과 맞섰고, 물살의 방향이 바뀐 뒤 반격에 나서 31척을 격파했습니다.',
    result: '일본 함선 31척 격파, 적 퇴각',
    forces: { joseon: '판옥선 13척', japan: '함선 133척' },
    sky: 'overcast',
    sea: 'rough',
    night: false,
    terrain: MYEONGNYANG_TERRAIN,
    current: { cx: 0, cz: 0, angle: 0, peak: 4.6, reach: 4300, narrows: 330, turnAt: 330, slack: 50, floodFirst: true },
    joseon: YI_TONGJE,
    japan: { name: '도도 다카토라', title: '수군 대장', figure: 'fig_todo', portrait: 'portrait_todo', banner: '藤堂' },
    map: { x: 0.33, y: 0.64 },
    arrows: [{ from: [0.42, 0.62], to: [0.34, 0.64], team: 'japan' }],
    view: { tx: -1500, tz: 0, dir: 0, dist: 900, pitch: 0.24 },
  },
  noryang: {
    id: 'noryang',
    ...SCENARIO_TEXT.noryang,
    season: '겨울 · 새벽',
    difficulty: '매우 어려움',
    summary:
      '임진왜란의 마지막 해전입니다. 순천에 고립된 고니시 유키나가를 구하려는 시마즈 요시히로의 함대 500여 척과 조선·명 연합 수군이 노량 해협에서 밤새 맞붙었습니다. 이순신은 새벽 전투 중 전사했습니다.',
    result: '일본 함선 200여 척 격파, 이순신 전사',
    forces: { joseon: '판옥선 60척', ming: '전선 30척 · 사선 33척', japan: '함선 500여 척' },
    sky: 'night',
    sea: 'rough',
    night: true,
    terrain: NORYANG_BATTLE_TERRAIN,
    current: { cx: 0, cz: 0, angle: 0, peak: 1.9, reach: 4600, narrows: 480, turnAt: 480, slack: 70, floodFirst: true },
    joseon: YI_TONGJE,
    japan: { name: '시마즈 요시히로', title: '사쓰마 번주', figure: 'fig_shimazu', portrait: 'portrait_shimazu', banner: '島津' },
    ming: { name: '진린', title: '명 수군 도독', figure: 'fig_chenlin', portrait: 'portrait_chenlin', banner: '陳' },
    map: { x: 0.44, y: 0.61 },
    arrows: [
      { from: [0.5, 0.6], to: [0.45, 0.61], team: 'japan' },
      { from: [0.4, 0.63], to: [0.435, 0.615], team: 'joseon' },
    ],
    view: { tx: -1700, tz: 0, dir: 0, dist: 1000, pitch: 0.27 },
  },
  ...ARMADA_SCENARIOS,
  ...LEPANTO_SCENARIOS,
  ...TRAFALGAR_SCENARIOS,
};

export const SCENARIO_ORDER: ScenarioId[] = ['okpo', 'sacheon', 'dangpo', 'hansan', 'angolpo', 'busan', 'chilcheon', 'myeongnyang', 'noryang'];

/** Each chapter's battles in order (the first chapter's are SCENARIO_ORDER). */
export const CHAPTER_ORDER: Record<ChapterId, ScenarioId[]> = { imjin: SCENARIO_ORDER, armada: ARMADA_ORDER, lepanto: LEPANTO_ORDER, trafalgar: TRAFALGAR_ORDER };
/** The chapter a historical battle belongs to. */
export const chapterOfScenario = (id: ScenarioId): ChapterId => (isArmadaBattle(id) ? 'armada' : isLepantoBattle(id) ? 'lepanto' : isTrafalgarBattle(id) ? 'trafalgar' : 'imjin');
/** The two navies of each chapter's battles, by slot ('joseon' first, 'japan' second). */
export const CHAPTER_NAVIES: Record<ChapterId, [Faction, Faction]> = { imjin: ['joseon', 'japan'], armada: ['england', 'spain'], lepanto: ['holyleague', 'ottoman'], trafalgar: ['britain', 'france'] };

const PORTRAITS: [string, string][] = [
  ...ARMADA_PORTRAITS,
  ...LEPANTO_PORTRAITS,
  ...TRAFALGAR_PORTRAITS,
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

function portraitFor(team: Team, commander: string, kind: ShipKind) {
  for (const [name, portrait] of PORTRAITS) if (commander.includes(name)) return portrait;
  if (kind.startsWith('ming')) return 'portrait_deng';
  if (kind === 'racegalleon' || kind === 'pinnace' || kind === 'fireship') return 'portrait_howard';
  if (kind === 'spgalleon' || kind === 'galleass' || kind === 'urca') return 'portrait_medina';
  if (kind === 'reale' || kind === 'galea' || kind === 'vgalleass') return 'portrait_donjuan';
  if (kind === 'sultana' || kind === 'kadirga' || kind === 'kalyata') return 'portrait_alipasha';
  if (kind === 'firstrate' || kind === 'gb74' || kind === 'gbfrigate') return 'portrait_nelson';
  if (kind === 'fr80' || kind === 'fr74') return 'portrait_villeneuve';
  if (kind === 'trinidad' || kind === 'es74') return 'portrait_gravina';
  return team === 'japan' ? 'portrait_japan' : 'portrait_admiral';
}

/**
 * How the named commanders led, for the computer's use of the maneuvers: Wakisaka sailed out alone after glory and took
 * Yi's bait at Hansan; Kuki and Kato would not leave the shelter of Angolpo; Won Gyun went in regardless; Chen Lin
 * pressed forward; Shimazu fought his way through to Konishi.
 */
const TEMPERS: [string, Temper][] = [
  ...ARMADA_TEMPERS,
  ...LEPANTO_TEMPERS,
  ...TRAFALGAR_TEMPERS,
  ['와키자카', 'rash'],
  ['구키', 'cautious'],
  ['가토', 'cautious'],
  ['고니시', 'cautious'],
  ['원균', 'rash'],
  ['진린', 'bold'],
  ['시마즈', 'bold'],
  ['이순신', 'steady'],
];

function temperOf(commander: string): Temper | undefined {
  return TEMPERS.find(([name]) => commander.includes(name))?.[1];
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

/** The four named commanders at the head of the Noryang fleet; the other squadrons are numbered waves. */
const LEADS = [
  { squad: '시마즈 대', name: '시마즈 요시히로' },
  { squad: '다치바나 대', name: '다치바나 무네시게' },
  { squad: '소 대', name: '소 요시토시' },
  { squad: '데라자와 대', name: '데라자와 마사나리' },
];
/** Where each Noryang squadron sails in the column, from the head: the other houses lead, Shimazu sixth. */
const COLUMN_SLOT = [5, 0, 1, 2, 3, 4, ...Array.from({ length: 14 }, (_, i) => 6 + i)];

export function buildScenario(id: ScenarioId, axis: number, seed = 1592, land: LandFn = () => -50, fleet?: FleetSpawn) {
  const b = new Battle(seed);
  b.depth = DEPTH_LATEST;
  b.setSea(SEA_STATES[SCENARIOS[id].sea]);
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
  const squad = (team: Team, name: string, cmd: string, kind: ShipKind) => {
    const sq = b.addSquadron(team, name, cmd, portraitFor(team, cmd, kind), cardFor(kind));
    const temper = temperOf(cmd);
    if (temper) sq.temper = temper;
    return sq;
  };
  const ship = (sq: Squadron, kind: ShipKind, p: Spot, name: string, flagship = false, variant?: number) => {
    const r = kind === 'panokseon' || kind === 'geobukseon' || kind === 'atakebune' || kind === 'mingship' ? 22 : kind === 'sekibune' || kind === 'mingsmall' ? 15 : SHIP_SPECS[kind].faction === 'england' || SHIP_SPECS[kind].faction === 'spain' ? SHIP_SPECS[kind].length * 0.5 : 9;
    const spot = settle(p, r);
    taken.push({ x: spot.x, z: spot.z, r });
    const w = place(spot.x, spot.z);
    return b.addShip(kind, w.x, w.z, spot.h + axis, name, sq, flagship, variant ?? (kind === 'panokseon' ? 0 : variantFor(kind, taken.length, flagship)));
  };
  const panoVariant = (i: number, flag: boolean) => (flag ? 0 : 1 + (i % 2));
  const line = (sq: Squadron, kind: ShipKind, spots: Spot[], prefix: string, flagIndex = -1) =>
    spots.map((p, i) => ship(sq, kind, p, i === flagIndex ? flagshipOf(prefix) : numbered(prefix, i + 1), i === flagIndex, kind === 'panokseon' ? panoVariant(i, i === flagIndex) : undefined));
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
      const s = ship(sq, kindOf(i), p, numbered(sq.name, i + 1), i === 0);
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
    const facing = Math.PI + Math.atan2(-850 - cz, 1350 - cx);
    const allArc = arc(cx, cz, 950, facing, 2.35, 53);
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
    const jHeading = Math.atan2(cz - -850, cx - 1350);
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
      const back = gi * 190;
      const cxj = 1350 - Math.cos(jHeading) * back + (gi % 2 ? 120 : -120) * Math.sin(jHeading);
      const czj = -850 - Math.sin(jHeading) * back - (gi % 2 ? 120 : -120) * Math.cos(jHeading);
      const spacing = g.kind === 'atakebune' ? 70 : g.kind === 'sekibune' ? 50 : 34;
      line(sq, g.kind, grid(cxj, czj, jHeading, g.n, 4, spacing, spacing * 0.9, 12, rand), g.name, gi === 0 ? 0 : -1);
    });
    b.retreatBelow.japan =0.22;
  } else if (id === 'busan') {
    const harborShore = -900;
    const perSquad = [40, 40, 39, 39, 39, 39, 39, 39, 39, 39, 39, 39];
    for (let q = 0; q < perSquad.length; q += 1) {
      const sq = squad('japan', echelon('부산포 정박', q + 1), '일본 장수', q % 3 === 0 ? 'atakebune' : 'sekibune');
      const n = perSquad[q]!;
      const xs = -3100 + q * 520;
      for (let i = 0; i < n; i += 1) {
        const row = i % 4;
        const col = Math.floor(i / 4);
        const kind: ShipKind = i % 4 === 0 ? 'atakebune' : i % 4 === 3 ? 'kobaya' : 'sekibune';
        const s = ship(sq, kind, { x: xs + col * 48 + (rand() - 0.5) * 10, z: harborShore + 120 + row * 46 + (rand() - 0.5) * 10, h: Math.PI / 2 + (rand() - 0.5) * 0.4 }, numbered(sq.name, i + 1), i === 0);
        s.order = { type: 'anchor' };
        s.speed = 0;
      }
    }
    const head = Math.atan2(harborShore + 200 - 4300, -200 - -1300);
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
      const cxj = -1100 - Math.cos(head) * back * 0.55 + (gi % 3 - 1) * 260;
      const czj = 650 - Math.sin(head) * back * 0.55;
      const spacing = g.kind === 'hyeopseon' ? 30 : 60;
      const cols = g.kind === 'hyeopseon' ? 6 : 3;
      line(sq, g.kind, grid(cxj, czj, head, g.n, cols, spacing, spacing * 0.95, 8, rand), g.name, gi === 1 ? 0 : -1);
    });
    b.retreatBelow.japan =0;
  } else if (id === 'myeongnyang') {
    const yi = squad('joseon', '대장선', '통제사 이순신', 'panokseon');
    const rest = squad('joseon', '남은 함대', '거제현령 안위 · 중군장 김응함', 'panokseon');
    ship(yi, 'panokseon', { x: -2050, z: 0, h: 0 }, '통제사 대장선', true, 0);
    line(rest, 'panokseon', arc(-2900, 0, 260, Math.PI, 1.6, 12), '남은 함대');
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
      const x = -600 + gi * 430;
      line(sq, kind, grid(x, 0, Math.PI, g.n, 5, gi % 3 === 0 ? 70 : 48, 42, 10, rand), g.name, 0);
    });
    b.retreatBelow.japan =0.75;
  } else if (id === 'okpo') {
    const anchored = [squad('japan', '도도 본대', '도도 다카토라', 'atakebune'), squad('japan', '옥포 정박 2진', '일본 장수', 'sekibune'), squad('japan', '옥포 정박 3진', '일본 장수', 'sekibune')];
    anchorage(anchored[0]!, 18, -1500, 150, 650, 480, mix(0.5, 0.4), 0);
    anchorage(anchored[1]!, 17, -1100, -300, 600, 420, mix(0.3, 0.5), 0.3);
    anchorage(anchored[2]!, 15, -1050, 650, 560, 380, mix(0.2, 0.5), -0.3);
    const head = Math.PI;
    const sqYi = squad('joseon', '전라좌수영 본대', '좌수사 이순신', 'panokseon');
    const sqJung = squad('joseon', '중위 · 녹도', '녹도만호 정운', 'panokseon');
    const sqWon = squad('joseon', '경상우수영', '경상우수사 원균', 'panokseon');
    const sqHyeop = squad('joseon', '협선대', '협선장', 'hyeopseon');
    line(sqYi, 'panokseon', grid(700, 300, head, 14, 7, 70, 62, 10, rand), '좌수영', 3);
    line(sqJung, 'panokseon', grid(1100, -380, head, 10, 5, 70, 62, 10, rand), '중위');
    line(sqWon, 'panokseon', grid(1150, 980, head, 4, 4, 70, 62, 10, rand), '경상우수영');
    line(sqHyeop, 'hyeopseon', grid(1600, 300, head, 17, 6, 34, 32, 8, rand), '협선');
    b.retreatBelow.japan =0.45;
  } else if (id === 'sacheon') {
    const sq1 = squad('japan', '사천 선창 대선', '일본 장수', 'atakebune');
    const sq2 = squad('japan', '사천 선창 중선', '일본 장수', 'sekibune');
    anchorage(sq1, 4, -350, -2900, 380, 520, () => 'atakebune', Math.PI / 2);
    anchorage(sq2, 9, -250, -2500, 520, 700, () => 'sekibune', Math.PI / 2);
    const head = -Math.PI / 2;
    const sqYi = squad('joseon', '전라좌수영 본대', '좌수사 이순신', 'panokseon');
    const sqTurtle = squad('joseon', '돌격 거북선', '돌격장 이기남', 'geobukseon');
    const sqJung = squad('joseon', '중위장', '광양현감 어영담', 'panokseon');
    const sqWon = squad('joseon', '경상우수영', '경상우수사 원균', 'panokseon');
    line(sqYi, 'panokseon', grid(0, -450, head, 12, 6, 70, 64, 10, rand), '좌수영', 2);
    line(sqJung, 'panokseon', grid(-700, 0, head, 10, 5, 70, 64, 10, rand), '중위');
    line(sqWon, 'panokseon', grid(700, 0, head, 3, 3, 70, 64, 10, rand), '경상우수영');
    line(sqTurtle, 'geobukseon', [{ x: 0, z: -800, h: head }], '거북선');
    b.retreatBelow.japan =0;
  } else if (id === 'dangpo') {
    const sqFlag = squad('japan', '구루시마 대장선단', '구루시마 미치유키', 'atakebune');
    const sqRest = squad('japan', '당포 정박선', '일본 장수', 'sekibune');
    anchorage(sqFlag, 9, -1350, -2100, 420, 380, () => 'atakebune', 0.6);
    anchorage(sqRest, 12, -1050, -1650, 520, 420, (i) => (i % 2 ? 'sekibune' : 'kobaya'), 0.6);
    const head = Math.atan2(-1900 - 1300, -1200 - 1100);
    const sqYi = squad('joseon', '전라좌수영 본대', '좌수사 이순신', 'panokseon');
    const sqTurtle = squad('joseon', '돌격 거북선', '돌격장 이기남', 'geobukseon');
    const sqKwon = squad('joseon', '중위장', '순천부사 권준', 'panokseon');
    line(sqYi, 'panokseon', grid(-50, -100, head, 14, 7, 70, 64, 10, rand), '좌수영', 3);
    line(sqKwon, 'panokseon', grid(550, 350, head, 10, 5, 70, 64, 10, rand), '중위');
    line(sqTurtle, 'geobukseon', [{ x: -400, z: -550, h: head }, { x: -230, z: -620, h: head }], '거북선');
    b.retreatBelow.japan =0;
  } else if (id === 'angolpo') {
    const sqKuki = squad('japan', '구키 본대', '구키 요시타카', 'atakebune');
    const sqKato = squad('japan', '가토 대', '가토 요시아키', 'atakebune');
    const sqSmall = squad('japan', '안골포 중소선', '일본 장수', 'sekibune');
    anchorage(sqKuki, 12, 150, -2350, 420, 520, (i) => (i < 11 ? 'atakebune' : 'sekibune'), Math.PI / 2);
    anchorage(sqKato, 12, 250, -1850, 420, 500, (i) => (i < 10 ? 'atakebune' : 'sekibune'), Math.PI / 2);
    anchorage(sqSmall, 18, 200, -1500, 520, 420, (i) => (i < 12 ? 'sekibune' : 'kobaya'), Math.PI / 2);
    const head = -Math.PI / 2;
    const sqYi = squad('joseon', '전라좌수영 본대', '좌수사 이순신', 'panokseon');
    const sqTurtle = squad('joseon', '돌격 거북선', '돌격장 이기남', 'geobukseon');
    const sqEok = squad('joseon', '전라우수영', '전라우수사 이억기', 'panokseon');
    const sqWon = squad('joseon', '경상우수영', '경상우수사 원균', 'panokseon');
    line(sqYi, 'panokseon', grid(0, 150, head, 22, 8, 70, 62, 10, rand), '좌수영', 4);
    line(sqEok, 'panokseon', grid(-900, 750, head, 24, 8, 70, 62, 10, rand), '우수영', 0);
    line(sqWon, 'panokseon', grid(900, 750, head, 6, 6, 70, 62, 10, rand), '경상우수영');
    line(sqTurtle, 'geobukseon', [{ x: -100, z: -250, h: head }, { x: 100, z: -250, h: head }], '거북선');
    b.retreatBelow.japan =0.5;
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
      { name: '도도 선봉', cmd: '도도 다카토라', n: 70, x: 650, z: -3300, h: Math.PI / 2 },
      { name: '와키자카 대', cmd: '와키자카 야스하루', n: 70, x: 500, z: -4300, h: Math.PI / 2 },
      { name: '가토 대', cmd: '가토 요시아키', n: 60, x: 800, z: -5200, h: Math.PI / 2 },
      { name: '시마즈 대', cmd: '시마즈 요시히로', n: 75, x: 650, z: 3900, h: -Math.PI / 2 },
      { name: '고니시 대', cmd: '고니시 유키나가', n: 75, x: 500, z: 4900, h: -Math.PI / 2 },
      { name: '구루시마 대', cmd: '구루시마 미치후사', n: 50, x: 800, z: 5800, h: -Math.PI / 2 },
      { name: '서쪽 매복', cmd: '모리 다카마사', n: 50, x: -1500, z: -3600, h: 0.9 },
      { name: '남서 우회대', cmd: '일본 장수', n: 50, x: -1400, z: 4300, h: -0.8 },
    ];
    raid.forEach((g, gi) => {
      const kindOf = mix(0.18, 0.55);
      const sq = squad('japan', g.name, g.cmd, gi % 3 === 0 ? 'atakebune' : 'sekibune');
      grid(g.x, g.z, g.h, g.n, 6, 52, 46, 14, rand).forEach((p, i) => {
        const s = ship(sq, kindOf(i + gi * 7), p, numbered(g.name, i + 1), i === 0);
        s.lights = false;
      });
    });
    b.retreatBelow.japan =0.35;
  } else if (isArmadaBattle(id)) {
    armadaForces(id, { b, rand, squad, ship, grid, arc, slotAll, numbered });
  } else if (isLepantoBattle(id)) {
    lepantoForces(id, { b, rand, squad, ship, grid, arc, slotAll, numbered });
  } else if (isTrafalgarBattle(id)) {
    trafalgarForces(id, { b, rand, squad, ship, grid, arc, slotAll, numbered });
  } else {
    b.night = true;
    const head = 0;
    const sqYi = squad('joseon', '통제사 본대', '통제사 이순신', 'panokseon');
    const sqSong = squad('joseon', '조선 좌군', '중군장 송희립', 'panokseon');
    const sqRight = squad('joseon', '조선 우군', '가리포첨사 이영남', 'panokseon');
    // The two horns of the allied fleet (掎角): the Ming along the mainland shore to the north, the Joseon fleet on the
    // Namhae side to the south, before Gwaneumpo, as the local tradition of the battle has it.
    line(sqYi, 'panokseon', grid(-2300, 620, head, 20, 4, 72, 64, 10, rand), '통제사 본대', 1);
    line(sqSong, 'panokseon', grid(-2900, 900, head, 20, 4, 72, 64, 10, rand), '조선 좌군');
    line(sqRight, 'panokseon', grid(-3300, 450, head, 20, 4, 72, 64, 10, rand), '조선 우군');
    const sqChen = squad('joseon', '명 수군 본대', '도독 진린', 'mingship');
    const sqDeng = squad('joseon', '명 수군 선봉', '부총병 등자룡', 'mingship');
    const sqSha = squad('joseon', '명 사선대', '명 유격장', 'mingsmall');
    line(sqChen, 'mingship', grid(-2500, -450, head, 16, 4, 66, 60, 10, rand), '명 수군 본대', 0);
    line(sqDeng, 'mingship', grid(-1900, -520, head, 14, 4, 66, 60, 10, rand), '명 수군 선봉', 0);
    line(sqSha, 'mingsmall', grid(-3200, -650, head, 33, 6, 40, 36, 10, rand), '명 사선대');
    // The Japanese column comes on from the east still short of the strait's waist, so the allies have the time to
    // choose where to meet it: at the narrows, from both shores, as on the night.
    // Shimazu's own squadron is made first, so his flagship is the fleet's admiral, but sails in the middle of the
    // column behind a van of the other houses: a column cut behind its van leaves the van without him.
    for (let q = 0; q < 20; q += 1) {
      const lead = LEADS[q];
      const at = COLUMN_SLOT[q] ?? q;
      const sq = squad('japan', lead ? lead.squad : echelon('사쓰마', q + 1), lead ? lead.name : '일본 장수', q % 4 === 0 ? 'atakebune' : 'sekibune');
      const kindOf = mix(0.22, 0.6);
      grid(2200 + at * 170, (at % 2 ? 1 : -1) * 90, Math.PI, 25, 5, 54, 48, 12, rand).forEach((p, i) => ship(sq, kindOf(i + q * 5), p, numbered(sq.name, i + 1), i === 0));
    }
    b.retreatBelow.japan =0.55;
    // Shimazu came to break through to Konishi at Suncheon, west of the strait: unopposed, his column keeps going.
    b.objectives.japan = { x: -5200, z: 200 };
    // The Japanese held Namhae island (a castle at Seonso): crews that could not get home ran for its shore, and
    // Gwaneumpo's bay on its north-west coast was the nearest water under it.
    b.havens.japan = { x: -2900, z: 3250 };
  }
  if (fleet) spawnFleet(b, fleet, axis, land);
  return b;
}

function spawnFleet(b: Battle, fleet: FleetSpawn, axis: number, land: LandFn) {
  const navy = fleet.faction ?? 'joseon';
  const old = b.ships.filter((s) => s.spec.faction === navy);
  if (!old.length) return;
  let cx = 0;
  let cz = 0;
  let hx = 0;
  let hz = 0;
  for (const s of old) {
    cx += s.x;
    cz += s.z;
    hx += Math.cos(s.heading);
    hz += Math.sin(s.heading);
  }
  cx /= old.length;
  cz /= old.length;
  const heading = Math.atan2(hz, hx);
  const holding = old.filter((s) => s.order.type === 'hold').length > old.length / 2;
  b.removeShips((s) => s.spec.faction === navy);
  const ca = Math.cos(axis);
  const sa = Math.sin(axis);
  const wet = (x: number, z: number) => land(x * ca + z * sa, -x * sa + z * ca) < -4;
  const fx = Math.cos(heading);
  const fz = Math.sin(heading);
  const px = -fz;
  const pz = fx;
  const blocks = fleet.squads.map((sq) => {
    const big = sq.ships.filter((x) => x.kind !== 'hyeopseon').length;
    const cols = Math.max(3, Math.min(6, Math.ceil(Math.sqrt(sq.ships.length * 1.6))));
    const spacing = big ? 66 : 34;
    return { sq, cols, spacing, width: cols * spacing };
  });
  const total = blocks.reduce((acc, bl) => acc + bl.width + 40, 0);
  let offset = -total / 2;
  const taken: { x: number; z: number }[] = [];
  for (const bl of blocks) {
    const squad = b.addSquadron('joseon', bl.sq.name, bl.sq.commander, bl.sq.portrait, bl.sq.ships.some((x) => x.kind === 'geobukseon') && bl.sq.ships.every((x) => x.kind === 'geobukseon') ? 'card_geobukseon' : 'card_panokseon');
    const mid = offset + bl.width / 2;
    bl.sq.ships.forEach((spec, i) => {
      const row = Math.floor(i / bl.cols);
      const col = i % bl.cols;
      let x = cx + px * (mid + (col - (bl.cols - 1) / 2) * bl.spacing) - fx * row * bl.spacing * 1.05;
      let z = cz + pz * (mid + (col - (bl.cols - 1) / 2) * bl.spacing) - fz * row * bl.spacing * 1.05;
      for (let ring = 0; ring < 30 && (!wet(x, z) || taken.some((t) => (t.x - x) ** 2 + (t.z - z) ** 2 < 900)); ring += 1) {
        const a = ring * 2.4;
        x += Math.cos(a) * 30;
        z += Math.sin(a) * 30;
      }
      taken.push({ x, z });
      const ship = b.addShip(spec.kind, x, z, heading, spec.name, squad, spec.flagship, variantFor(spec.kind, i, spec.flagship));
      ship.hull = ship.spec.hull * Math.max(0.05, spec.hull);
      b.setCrew(ship, ship.spec.crew * Math.max(0.05, spec.crew));
      b.applySupply(ship, spec.supply);
      ship.mods = { ...spec.mods };
      ship.campaignId = spec.campaignId;
      if (holding) {
        ship.order = { type: 'hold' };
        ship.speed = 0;
      }
    });
    offset += bl.width + 40;
  }
}

export function scenarioCenter(id: ScenarioId) {
  const info = SCENARIOS[id];
  return { x: info.view.tx, z: info.view.tz };
}
