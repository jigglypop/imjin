import type { ShipKind } from '../types';
import type { GrandFaction } from './types';

/**
 * The people of the faction campaign (진영 전역의 인물): the historical officers of the three navies, their traits, their
 * signature abilities, the skill tree they spend points on, the ranks they rise through and the names given to men
 * raised from the ranks. Plain data with no imports beyond types, so the economy, the march rules and the battle
 * hand-off can read it without pulling in the officers' rules (officers.ts).
 */

/** Every number the officers add to the campaign, kept in one place so a different calendar can retune it. A turn is a season (three months). */
export const OFFICERS = {
  /** Turns between fresh recruit candidates at the navies' camps (등용). */
  recruitEvery: 2,
  /** Generated candidates each navy is offered at a time, and how many turns they wait before going elsewhere. */
  recruitCount: 2,
  recruitStay: 2,
  /** Silver for a candidate: a base, per level above the first, per good trait; a recommended man costs this share. */
  hireBase: 120,
  hirePerLevel: 90,
  hirePerTrait: 40,
  recommendShare: 0.5,
  /** Chance per turn that an officer with a recommending skill or trait puts a man forward (천거), and at most one card a turn per navy. */
  recommendChance: 0.12,
  /** A ship's kills that make its captain fit to be raised to an officer (발탁), what it costs, and the ship's kills it takes with him. */
  promoteKills: 3,
  promoteCost: 60,
  /** No navy keeps more officers than this (dead men do not count). */
  maxOfficers: 40,
  /** Share of a battle's experience a lieutenant earns, and of his traits, skills and ability the fleet gets. */
  lieutenantXp: 0.6,
  lieutenantShare: 0.5,
  /** Lieutenant seats: one, plus one per two levels, at most three. */
  slotsBase: 1,
  slotsPerLevels: 2,
  slotsMax: 3,
  /** Experience per battle, as the old commanders earned it: a share for being there, per kill of his fleet and for a win. */
  xpBattle: 25,
  xpPerKill: 8,
  xpWin: 50,
  /** After a defeat that cost his fleet at least `heavyLoss` of its ships: chances of death, capture (flagship taken) and wounds. */
  heavyLoss: 0.5,
  deathChance: 0.04,
  captureChance: 0.08,
  woundChance: 0.18,
  /** When his whole fleet is lost the chances are higher. */
  lostDeath: 0.15,
  lostCapture: 0.3,
  /** Turns a wound keeps him from command, and turns before a captive is exchanged. */
  woundTurns: 2,
  captiveTurns: 4,
  /** Per-turn chance of a vice for an officer whose fleet has lain idle in port at least `idleTurns` turns. */
  idleTurns: 6,
  viceChance: 0.05,
  /** Battles after which an officer is a veteran (노련). */
  veteranBattles: 8,
  /** Turns of blockade an officer must keep up for a chance at patience (신중). */
  siegeTurns: 3,
  maxTraits: 5,
  /** The computer hires for and seats lieutenants in fleets of at least this many ships only. */
  aiFleetShips: 5,
} as const;

/** What a trait, a skill or an ability adds. Shares of the base value; negative is a penalty. */
export type BonusKey =
  | 'power' // fighting worth of the whole side in a settled fight; a little of every 3D stat
  | 'gun' // gun rounds; 3D reload and accuracy
  | 'melee' // boarding rounds; 3D boarding
  | 'defense' // 3D hull and crew resistance; a little of the settled fight
  | 'fire' // 3D fire setting
  | 'speed'
  | 'turn'
  | 'reach' // march range
  | 'repair' // hull and crew recovery in port
  | 'upkeep' // cut in the fleet's upkeep
  | 'income' // income of the port he lies at
  | 'supply' // cut in supply lost at sea
  | 'slots' // lieutenant seats (whole numbers)
  | 'xp' // experience earned by him and his lieutenants
  | 'hire' // cut in what officers cost his navy
  | 'recommend' // more chances to recommend men
  | 'pursuit'; // ships of a beaten enemy caught in the pursuit
export type Bonus = Partial<Record<BonusKey, number>>;

/** Caps on what a fleet's officers add together (the low bound is the worst a set of bad traits can do). */
export const BONUS_CAP: Record<BonusKey, [number, number]> = {
  power: [-0.1, 0.12],
  gun: [-0.1, 0.15],
  melee: [-0.1, 0.15],
  defense: [-0.1, 0.12],
  fire: [0, 0.25],
  speed: [-0.05, 0.08],
  turn: [-0.05, 0.1],
  reach: [-0.1, 0.2],
  repair: [-0.2, 0.5],
  upkeep: [-0.15, 0.3],
  income: [0, 0.15],
  supply: [0, 0.5],
  slots: [0, 2],
  xp: [-0.3, 0.6],
  hire: [0, 0.4],
  recommend: [0, 2],
  pursuit: [0, 0.6],
};

export const BONUS_KEYS = Object.keys(BONUS_CAP) as BonusKey[];

/** Korean labels of the bonus keys, for the character sheet's effect lines (translated where shown). */
export const BONUS_LABEL: Record<BonusKey, string> = {
  power: '전투력',
  gun: '포격',
  melee: '백병전',
  defense: '방어',
  fire: '화공',
  speed: '속도',
  turn: '선회',
  reach: '행동력',
  repair: '수리',
  upkeep: '유지비 절감',
  income: '포구 수입',
  supply: '보급 절약',
  slots: '부관 자리',
  xp: '경험치',
  hire: '등용 비용 절감',
  recommend: '천거',
  pursuit: '추격',
};

// --- Traits ------------------------------------------------------------------------------------------------------

export type TraitDef = { id: string; name: string; hanja: string; desc: string; good: boolean; bonus: Bonus };

export const TRAITS: readonly TraitDef[] = [
  { id: 'great', name: '명장', hanja: '名將', desc: '이름난 장수입니다. 그가 이끄는 함대는 더 잘 싸웁니다.', good: true, bonus: { power: 0.04 } },
  { id: 'wise', name: '지장', hanja: '智將', desc: '지략이 뛰어나 포격과 기동에 능합니다.', good: true, bonus: { gun: 0.03, reach: 0.04 } },
  { id: 'virtuous', name: '덕장', hanja: '德將', desc: '부하를 아껴 장졸이 빨리 배우고 함대가 빨리 회복합니다.', good: true, bonus: { xp: 0.2, repair: 0.15, recommend: 1 } },
  { id: 'fierce', name: '맹장', hanja: '猛將', desc: '앞장서 적선에 뛰어드는 용맹한 장수입니다.', good: true, bonus: { melee: 0.05 } },
  { id: 'cautious', name: '신중', hanja: '愼重', desc: '서두르지 않아 잘 지키지만 멀리 가지 않습니다.', good: true, bonus: { defense: 0.04, reach: -0.03 } },
  { id: 'reckless', name: '무모', hanja: '無謀', desc: '돌격을 즐기지만 방비가 허술합니다.', good: false, bonus: { melee: 0.03, defense: -0.04 } },
  { id: 'coward', name: '겁쟁이', hanja: '怯懦', desc: '싸움을 두려워해 함대의 기세가 꺾입니다.', good: false, bonus: { power: -0.04 } },
  { id: 'greedy', name: '탐욕', hanja: '貪慾', desc: '군자금을 빼돌려 유지비가 늘어납니다.', good: false, bonus: { upkeep: -0.08 } },
  { id: 'drunkard', name: '술고래', hanja: '酒癖', desc: '술을 가까이해 배우는 것이 더디고 군기가 흐트러집니다.', good: false, bonus: { xp: -0.15, power: -0.01 } },
  { id: 'veteran', name: '노련', hanja: '老鍊', desc: '숱한 해전을 치러 포격과 백병전 모두 능숙합니다.', good: true, bonus: { gun: 0.02, melee: 0.02 } },
  { id: 'defeated', name: '패장', hanja: '敗將', desc: '크게 진 뒤로 장졸의 믿음을 잃었습니다. 큰 승리로 씻을 수 있습니다.', good: false, bonus: { power: -0.03 } },
  { id: 'navigator', name: '물길에 밝음', hanja: '水路', desc: '물때와 물길을 잘 알아 멀리 항해합니다.', good: true, bonus: { reach: 0.08 } },
  { id: 'craftsman', name: '장인', hanja: '匠人', desc: '배를 손볼 줄 알아 함대가 빨리 수리됩니다.', good: true, bonus: { repair: 0.2 } },
  { id: 'incorruptible', name: '청렴', hanja: '淸廉', desc: '군자금을 아껴 써 유지비가 줄어듭니다.', good: true, bonus: { upkeep: 0.08 } },
  { id: 'oldHand', name: '노장', hanja: '老將', desc: '나이가 많아 새로 배우는 것은 더디지만 함대를 단단히 이끕니다.', good: true, bonus: { power: 0.02, xp: -0.1 } },
  { id: 'pirate', name: '해적 출신', hanja: '海賊', desc: '바다에서 잔뼈가 굵어 배에 오르는 싸움과 먼 항해에 능합니다.', good: true, bonus: { melee: 0.03, reach: 0.04 } },
  { id: 'strict', name: '엄격', hanja: '嚴格', desc: '군율이 엄해 함대가 흐트러지지 않습니다.', good: true, bonus: { power: 0.02, defense: 0.02 } },
  { id: 'scarred', name: '역전의 상흔', hanja: '傷痕', desc: '크게 다친 뒤로 몸을 아끼지만 쉽게 무너지지 않습니다.', good: true, bonus: { defense: 0.03, reach: -0.02 } },
  { id: 'trusted', name: '조정의 신임', hanja: '信任', desc: '조정의 믿음을 얻어 인재를 쉽게 불러 모읍니다.', good: true, bonus: { hire: 0.15, recommend: 1 } },
  { id: 'noble', name: '명문', hanja: '名門', desc: '이름난 가문 출신이라 영지가 넉넉하고 사람이 모입니다.', good: true, bonus: { income: 0.04, hire: 0.1 } },
  { id: 'builder', name: '축성', hanja: '築城', desc: '성과 진을 잘 쌓아 머무는 포구가 단단하고 넉넉해집니다.', good: true, bonus: { repair: 0.1, income: 0.03 } },
  { id: 'gunner', name: '화포의 달인', hanja: '火砲', desc: '화포를 잘 다뤄 포격이 정확합니다.', good: true, bonus: { gun: 0.04 } },
  { id: 'loyal', name: '충용', hanja: '忠勇', desc: '충성스럽고 용감해 어려운 싸움에서도 물러서지 않습니다.', good: true, bonus: { power: 0.02, melee: 0.02 } },
];

/** Traits a recruit candidate or a man from the ranks may come with, good and bad, by weight. */
export const CANDIDATE_TRAITS: readonly [string, number][] = [
  ['fierce', 3],
  ['cautious', 3],
  ['veteran', 2],
  ['navigator', 2],
  ['strict', 2],
  ['loyal', 3],
  ['gunner', 2],
  ['incorruptible', 1],
  ['reckless', 2],
  ['greedy', 2],
  ['drunkard', 2],
  ['coward', 1],
];

// --- Skill tree --------------------------------------------------------------------------------------------------

export type Branch = 'lead' | 'war' | 'admin';
export const BRANCHES: readonly Branch[] = ['lead', 'war', 'admin'];
export const BRANCH_INFO: Record<Branch, { name: string; hanja: string; desc: string }> = {
  lead: { name: '지휘', hanja: '統率', desc: '사기와 결속, 부관 자리' },
  war: { name: '전술', hanja: '戰術', desc: '포격, 도선, 화공' },
  admin: { name: '군정', hanja: '軍政', desc: '항해, 수리, 유지비, 포구 수입' },
};

/** One node of the tree. A node of tier n needs a node of tier n-1 in the same branch and the officer at level n or above. */
export type SkillDef = { id: string; branch: Branch; tier: number; name: string; hanja: string; desc: string; bonus: Bonus };

export const SKILLS: readonly SkillDef[] = [
  { id: 'command', branch: 'lead', tier: 1, name: '호령', hanja: '號令', desc: '우렁찬 호령으로 함대의 기세를 올립니다.', bonus: { power: 0.02 } },
  { id: 'deputies', branch: 'lead', tier: 2, name: '부장 등용', hanja: '副將', desc: '부관을 한 사람 더 거느립니다.', bonus: { slots: 1 } },
  { id: 'discipline', branch: 'lead', tier: 2, name: '군율', hanja: '軍律', desc: '엄한 군율로 대열이 흐트러지지 않습니다.', bonus: { power: 0.015, defense: 0.03 } },
  { id: 'cohesion', branch: 'lead', tier: 3, name: '결속', hanja: '結束', desc: '여러 배가 한 몸처럼 움직입니다.', bonus: { power: 0.03 } },
  { id: 'mentor', branch: 'lead', tier: 4, name: '용병', hanja: '用兵', desc: '장졸을 가르쳐 부관과 함께 빨리 성장합니다.', bonus: { xp: 0.3, recommend: 1 } },
  { id: 'morale', branch: 'lead', tier: 4, name: '사기 진작', hanja: '士氣', desc: '장졸이 끝까지 물러서지 않습니다.', bonus: { power: 0.03 } },
  { id: 'majesty', branch: 'lead', tier: 5, name: '위엄', hanja: '威嚴', desc: '이름만으로 적이 움츠러듭니다. 부관을 한 사람 더 거느립니다.', bonus: { power: 0.04, slots: 1 } },

  { id: 'gunnery', branch: 'war', tier: 1, name: '포술', hanja: '砲術', desc: '화포를 빨리 다시 쟁입니다.', bonus: { gun: 0.03 } },
  { id: 'aim', branch: 'war', tier: 2, name: '정조준', hanja: '照準', desc: '포격이 더 정확해집니다.', bonus: { gun: 0.03 } },
  { id: 'boarding', branch: 'war', tier: 2, name: '접전', hanja: '接戰', desc: '배에 올라 싸우는 데 능합니다.', bonus: { melee: 0.04 } },
  { id: 'fireships', branch: 'war', tier: 3, name: '화공', hanja: '火攻', desc: '불화살과 화선으로 적선에 불을 지릅니다.', bonus: { fire: 0.1, gun: 0.02 } },
  { id: 'formation', branch: 'war', tier: 4, name: '진형', hanja: '陣形', desc: '진형을 갖추어 화력을 모읍니다.', bonus: { gun: 0.03, turn: 0.04 } },
  { id: 'charge', branch: 'war', tier: 4, name: '돌격', hanja: '突擊', desc: '거침없이 적진으로 파고듭니다.', bonus: { melee: 0.05, speed: 0.03 } },
  { id: 'victory', branch: 'war', tier: 5, name: '필승', hanja: '必勝', desc: '이길 싸움만 하고, 이기면 끝까지 쫓습니다.', bonus: { gun: 0.03, melee: 0.03, pursuit: 0.3 } },

  { id: 'seamanship', branch: 'admin', tier: 1, name: '항해술', hanja: '航海', desc: '바람과 물때를 읽어 더 멀리 갑니다.', bonus: { reach: 0.06 } },
  { id: 'repair', branch: 'admin', tier: 2, name: '수선', hanja: '修繕', desc: '포구에서 배를 빨리 고칩니다.', bonus: { repair: 0.25 } },
  { id: 'provisions', branch: 'admin', tier: 2, name: '병량 관리', hanja: '兵糧', desc: '바다에서 보급을 아껴 씁니다.', bonus: { supply: 0.3 } },
  { id: 'farms', branch: 'admin', tier: 3, name: '둔전', hanja: '屯田', desc: '머무는 포구의 둔전을 일구어 수입을 늘립니다.', bonus: { income: 0.06 } },
  { id: 'thrift', branch: 'admin', tier: 4, name: '절검', hanja: '節儉', desc: '함대의 씀씀이를 줄입니다.', bonus: { upkeep: 0.1 } },
  { id: 'levy', branch: 'admin', tier: 4, name: '모병', hanja: '募兵', desc: '사람을 잘 모아 군관 등용이 싸지고 인재를 천거합니다.', bonus: { hire: 0.2, recommend: 1 } },
  { id: 'statecraft', branch: 'admin', tier: 5, name: '경세', hanja: '經世', desc: '수군의 살림을 꾸려 수입과 항해를 함께 늘립니다.', bonus: { income: 0.06, reach: 0.06 } },
];

export const SKILL_TIERS = 5;

// --- Signature abilities -----------------------------------------------------------------------------------------

/** The 3D battle's active commander abilities (another part of the game carries them out); the campaign only passes the id on. */
export type BattleAbility = 'crane_wing' | 'volley' | 'ram' | 'rally' | 'fire_arrows' | 'boarding' | 'ambush' | 'smoke' | 'bulwark' | 'tide';

export const BATTLE_ABILITY: Record<BattleAbility, { name: string; desc: string }> = {
  crane_wing: { name: '학익진', desc: '함대가 학의 날개처럼 펼쳐 포격이 정확해집니다.' },
  volley: { name: '일제 사격', desc: '한 번의 일제 사격에 모든 화포를 즉시 쟁이고 정확하게 쏩니다.' },
  ram: { name: '충파 돌격', desc: '빠르게 돌진해 적선을 들이받습니다.' },
  rally: { name: '필사즉생', desc: '장졸이 죽기를 각오해 사기가 오르고 도선에 버팁니다.' },
  fire_arrows: { name: '화전', desc: '불화살로 적선에 불을 붙일 확률이 높아집니다.' },
  boarding: { name: '등선 육박전', desc: '적선에 올라 백병전에서 압도합니다.' },
  ambush: { name: '기습', desc: '빨라지고 적에게 잘 보이지 않습니다.' },
  smoke: { name: '연막', desc: '연기를 피워 적의 포격을 흐트러뜨립니다.' },
  bulwark: { name: '철벽', desc: '방비를 굳혀 피해를 덜 받습니다.' },
  tide: { name: '물때 읽기', desc: '조류 속에서 더 빠르고 날렵하게 움직입니다.' },
};

/** Icons the interface draws for an ability (src/ui/grand/Officers.tsx). */
export type AbilityIcon = 'wing' | 'cannon' | 'wave' | 'sword' | 'shield' | 'fire' | 'eye' | 'smoke' | 'hammer' | 'scroll' | 'flag' | 'anchor' | 'coin' | 'star';

/**
 * One named figure's own ability (특수능력): its campaign effect, optionally cheaper ships of some kinds at the port he
 * lies at, and the 3D battle ability his fleet gets while he commands it.
 */
export type AbilityDef = { id: string; name: string; hanja: string; line: string; icon: AbilityIcon; bonus: Bonus; ships?: { kinds: ShipKind[]; cut: number }; battle?: BattleAbility };

// --- Ranks -------------------------------------------------------------------------------------------------------

/** Rank by level (index level - 1), per navy, with the hanja. */
export const RANKS: Record<GrandFaction, readonly [string, string][]> = {
  joseon: [['군관', '軍官'], ['권관', '權管'], ['만호', '萬戶'], ['우후', '虞候'], ['첨사', '僉使'], ['수사', '水使'], ['통제사', '統制使']],
  japan: [['아시가루 대장', '足輕大將'], ['사무라이 대장', '侍大將'], ['후나부교', '船奉行'], ['가로', '家老'], ['성주', '城主'], ['다이묘', '大名'], ['수군 총대장', '總大將']],
  ming: [['파총', '把總'], ['천총', '千總'], ['수비', '守備'], ['유격', '遊擊'], ['참장', '參將'], ['부총병', '副總兵'], ['도독', '都督']],
};

// --- The historical figures --------------------------------------------------------------------------------------

/**
 * When a figure comes into the war: present at the start (`start`; the ten commanders of regions.ts COMMANDERS are
 * there too), joining the navy's pool at a date (`pool`), offered as a recruit at a date (`hire`) or put forward by
 * another officer at a date (`recommend`, by `by`; if he is gone the man is offered as a recruit instead).
 */
export type Arrival = { kind: 'start' } | { kind: 'pool' | 'hire'; year: number; month: number } | { kind: 'recommend'; year: number; month: number; by: string };

export type FigureDef = {
  id: string;
  faction: GrandFaction;
  name: string;
  hanja: string;
  /** The post he held, shown beside the rank. */
  title: string;
  portrait: string;
  bio: string;
  /** 統率 lead, 戰術 war, 軍政 admin, 1..10. */
  stats: [number, number, number];
  traits: string[];
  level: number;
  arrive: Arrival;
  ability: AbilityDef;
};

const start: Arrival = { kind: 'start' };
const pool = (year: number, month: number): Arrival => ({ kind: 'pool', year, month });
const hire = (year: number, month: number): Arrival => ({ kind: 'hire', year, month });
const rec = (by: string, year: number, month: number): Arrival => ({ kind: 'recommend', year, month, by });

export const FIGURES: readonly FigureDef[] = [
  // Joseon
  { id: 'yi', faction: 'joseon', name: '이순신', hanja: '李舜臣', title: '전라좌수사', portrait: 'portrait_yi', bio: '전라좌수사. 옥포에서 노량까지 조선 수군을 이끌었고 노량 해전에서 전사했습니다.', stats: [10, 9, 9], traits: ['wise', 'strict'], level: 3, arrive: start,
    ability: { id: 'crane', name: '학익진', hanja: '鶴翼陣', line: '학이 날개를 펴듯 적을 감싸 화포를 한곳에 모읍니다.', icon: 'wing', bonus: { gun: 0.05, power: 0.03 }, battle: 'crane_wing' } },
  { id: 'won', faction: 'joseon', name: '원균', hanja: '元均', title: '경상우수사', portrait: 'portrait_won', bio: '경상우수사. 개전 초 이순신에게 구원을 청했고, 1597년 칠천량 해전에서 전사했습니다.', stats: [6, 7, 4], traits: ['fierce', 'reckless'], level: 1, arrive: start,
    ability: { id: 'firstStrike', name: '선제 돌격', hanja: '先制突擊', line: '머뭇거리지 않고 먼저 적에게 달려듭니다.', icon: 'sword', bonus: { melee: 0.04, speed: 0.03 }, battle: 'ram' } },
  { id: 'eokgi', faction: 'joseon', name: '이억기', hanja: '李億祺', title: '전라우수사', portrait: 'portrait_eokgi', bio: '전라우수사. 이순신과 연합 함대를 이루어 싸웠고 칠천량 해전에서 전사했습니다.', stats: [7, 7, 7], traits: ['virtuous'], level: 2, arrive: start,
    ability: { id: 'allied', name: '연합 함대', hanja: '聯合艦隊', line: '다른 수영과 손발을 맞추어 함께 싸웁니다.', icon: 'flag', bonus: { power: 0.03, xp: 0.1 }, battle: 'bulwark' } },
  { id: 'kwon', faction: 'joseon', name: '권준', hanja: '權俊', title: '순천부사', portrait: 'portrait_kwon', bio: '순천부사. 이순신의 중위장으로 한산도와 부산포에서 싸웠습니다.', stats: [6, 6, 7], traits: ['cautious'], level: 1, arrive: start,
    ability: { id: 'centre', name: '중위장', hanja: '中衛將', line: '함대의 한가운데를 맡아 대열을 지킵니다.', icon: 'shield', bonus: { power: 0.02, defense: 0.04 }, battle: 'bulwark' } },
  { id: 'jeongun', faction: 'joseon', name: '정운', hanja: '鄭運', title: '녹도만호', portrait: 'portrait_jeongun', bio: '녹도만호. 출전을 앞장서 주장했고 1592년 부산포 해전에서 선봉으로 싸우다 전사했습니다.', stats: [6, 9, 4], traits: ['fierce', 'loyal'], level: 2, arrive: rec('yi', 1592, 4),
    ability: { id: 'vanguard', name: '선봉', hanja: '先鋒', line: '언제나 함대의 맨 앞에서 적진을 엽니다.', icon: 'sword', bonus: { melee: 0.04, power: 0.02 }, battle: 'ram' } },
  { id: 'eo', faction: 'joseon', name: '어영담', hanja: '魚泳潭', title: '광양현감', portrait: 'portrait_eo', bio: '광양현감. 남해의 물길에 밝아 이순신 함대의 길잡이가 되었습니다.', stats: [5, 6, 8], traits: ['navigator'], level: 2, arrive: start,
    ability: { id: 'pilot', name: '물길 안내', hanja: '水路嚮導', line: '좁은 해협과 물때를 꿰고 있어 함대를 멀리, 지치지 않게 이끕니다.', icon: 'wave', bonus: { reach: 0.1, supply: 0.2 }, battle: 'tide' } },
  { id: 'sunsin_b', faction: 'joseon', name: '이순신(李純信)', hanja: '李純信', title: '방답첨사', portrait: 'portrait_sunsin_b', bio: '방답첨사. 이순신 함대의 유군장으로 싸웠고 노량 해전 뒤 수군을 수습했습니다.', stats: [7, 8, 6], traits: ['veteran'], level: 2, arrive: start,
    ability: { id: 'flying', name: '유군장', hanja: '遊軍將', line: '떠도는 별동대를 이끌고 적의 옆구리를 칩니다.', icon: 'eye', bonus: { speed: 0.04, gun: 0.02 }, battle: 'ambush' } },
  { id: 'baeheungnip', faction: 'joseon', name: '배흥립', hanja: '裵興立', title: '흥양현감', portrait: 'portrait_baeheungnip', bio: '흥양현감. 옥포에서 명량까지 싸웠고 뒤에 경상우수사에 올랐습니다.', stats: [6, 7, 6], traits: ['cautious'], level: 1, arrive: start,
    ability: { id: 'front', name: '전부장', hanja: '前部將', line: '앞 대열의 화포를 한꺼번에 터뜨립니다.', icon: 'cannon', bonus: { gun: 0.03 }, battle: 'volley' } },
  { id: 'kimwan', faction: 'joseon', name: '김완', hanja: '金浣', title: '사도첨사', portrait: 'portrait_kimwan', bio: '사도첨사. 칠천량에서 포로가 되었다가 탈출해 돌아왔습니다.', stats: [5, 7, 5], traits: ['loyal'], level: 1, arrive: start,
    ability: { id: 'lastStand', name: '결사 항전', hanja: '決死抗戰', line: '사로잡혀도 꺾이지 않는 뜻으로 끝까지 버팁니다.', icon: 'shield', bonus: { defense: 0.03, melee: 0.02 }, battle: 'rally' } },
  { id: 'jeonggeol', faction: 'joseon', name: '정걸', hanja: '丁傑', title: '조방장', portrait: 'portrait_jeonggeol', bio: '여든을 바라보는 노장. 조방장으로 이순신을 도왔고 행주산성에 화살을 실어 날랐습니다.', stats: [6, 6, 8], traits: ['oldHand', 'veteran'], level: 3, arrive: start,
    ability: { id: 'elder', name: '노장의 지혜', hanja: '老將之智', line: '수십 년 바다를 지킨 경험을 젊은 장수들에게 물려줍니다.', icon: 'scroll', bonus: { xp: 0.25, repair: 0.1 }, battle: 'bulwark' } },
  { id: 'nadaeyong', faction: 'joseon', name: '나대용', hanja: '羅大用', title: '군관', portrait: 'portrait_nadaeyong', bio: '군관. 이순신의 명으로 거북선을 만들었고 뒤에 창선과 해추선을 고안했습니다.', stats: [4, 5, 9], traits: ['craftsman'], level: 1, arrive: rec('yi', 1592, 4),
    ability: { id: 'turtle', name: '거북선 설계', hanja: '龜船', line: '그가 머무는 포구에서는 거북선과 판옥선을 싸게 짓고, 함대도 빨리 고칩니다.', icon: 'hammer', bonus: { repair: 0.15 }, ships: { kinds: ['geobukseon', 'panokseon'], cut: 0.25 }, battle: 'ram' } },
  { id: 'songhuirip', faction: 'joseon', name: '송희립', hanja: '宋希立', title: '군관', portrait: 'portrait_songhuirip', bio: '이순신의 군관. 노량에서 이순신이 쓰러진 뒤에도 북을 울려 싸움을 이끌었습니다.', stats: [6, 7, 6], traits: ['loyal'], level: 1, arrive: rec('yi', 1592, 7),
    ability: { id: 'guard', name: '대장선 수호', hanja: '護衛', line: '대장선 곁을 지키며 끝까지 북을 울립니다.', icon: 'flag', bonus: { defense: 0.03, power: 0.02 }, battle: 'rally' } },
  { id: 'yiyeongnam', faction: 'joseon', name: '이영남', hanja: '李英男', title: '율포만호', portrait: 'portrait_yiyeongnam', bio: '율포만호. 원균의 명으로 이순신에게 구원을 청하러 갔고 노량 해전에서 전사했습니다.', stats: [6, 7, 5], traits: ['loyal'], level: 1, arrive: hire(1592, 4),
    ability: { id: 'courier', name: '전령', hanja: '傳令', line: '수영 사이를 오가며 소식을 빨리 전합니다.', icon: 'wave', bonus: { reach: 0.05, power: 0.02 }, battle: 'tide' } },
  { id: 'uchijeok', faction: 'joseon', name: '우치적', hanja: '禹致績', title: '영등포만호', portrait: 'portrait_uchijeok', bio: '영등포만호. 옥포 해전에서 앞장서 일본 함선을 깨뜨렸습니다.', stats: [5, 8, 4], traits: ['fierce'], level: 1, arrive: rec('won', 1592, 7),
    ability: { id: 'breach', name: '돌파', hanja: '突破', line: '적선의 대열을 뚫고 들어가 배에 오릅니다.', icon: 'sword', bonus: { melee: 0.04 }, battle: 'boarding' } },
  { id: 'yiunryong', faction: 'joseon', name: '이운룡', hanja: '李雲龍', title: '옥포만호', portrait: 'portrait_yiunryong', bio: '옥포만호. 원균에게 이순신과의 연합을 권했고 뒤에 경상우수사와 통제사에 올랐습니다.', stats: [7, 7, 6], traits: ['strict'], level: 1, arrive: rec('won', 1592, 4),
    ability: { id: 'okpo', name: '옥포의 결의', hanja: '玉浦決意', line: '물러서자는 말을 꺾고 싸울 뜻을 모읍니다.', icon: 'flag', bonus: { power: 0.03 }, battle: 'rally' } },
  { id: 'kimeokchu', faction: 'joseon', name: '김억추', hanja: '金億秋', title: '전라우수사', portrait: 'portrait_kimeokchu', bio: '1597년 전라우수사가 되어 명량 해전에 나섰습니다.', stats: [5, 7, 4], traits: ['cautious'], level: 2, arrive: pool(1597, 7),
    ability: { id: 'fireArrows', name: '화전', hanja: '火箭', line: '불화살을 퍼부어 적선의 돛과 갑판을 태웁니다.', icon: 'fire', bonus: { fire: 0.1 }, battle: 'fire_arrows' } },
  { id: 'anwi', faction: 'joseon', name: '안위', hanja: '安衛', title: '거제현령', portrait: 'portrait_anwi', bio: '거제현령. 명량 해전에서 이순신의 꾸짖음을 듣고 적진 한가운데로 뛰어들었습니다.', stats: [6, 8, 5], traits: ['fierce'], level: 2, arrive: hire(1594, 1),
    ability: { id: 'myeongnyang', name: '명량의 분전', hanja: '鳴梁奮戰', line: '물러서면 죽는다는 각오로 적선 사이에서 싸웁니다.', icon: 'shield', bonus: { melee: 0.03, defense: 0.03 }, battle: 'rally' } },
  { id: 'baeseol', faction: 'joseon', name: '배설', hanja: '裵楔', title: '경상우수사', portrait: 'portrait_baeseol', bio: '경상우수사. 칠천량 해전에서 전선 열두 척을 이끌고 물러나 보존했습니다.', stats: [5, 5, 6], traits: ['coward', 'cautious'], level: 2, arrive: pool(1597, 1),
    ability: { id: 'preserve', name: '함선 보전', hanja: '保全', line: '무너지는 싸움에서도 배를 건져 돌아옵니다.', icon: 'smoke', bonus: { repair: 0.15, supply: 0.2 }, battle: 'smoke' } },
  { id: 'choiho', faction: 'joseon', name: '최호', hanja: '崔湖', title: '충청수사', portrait: 'portrait_choiho', bio: '충청수사. 1597년 칠천량 해전에서 전사했습니다.', stats: [6, 6, 6], traits: ['oldHand'], level: 2, arrive: pool(1596, 1),
    ability: { id: 'chungcheong', name: '충청 수영', hanja: '忠淸水營', line: '서해의 수영을 꾸려 군자금을 보탭니다.', icon: 'coin', bonus: { income: 0.06 }, battle: 'bulwark' } },
  { id: 'songyeojong', faction: 'joseon', name: '송여종', hanja: '宋汝悰', title: '녹도만호', portrait: 'portrait_songyeojong', bio: '군관 출신으로 녹도만호가 되어 명량과 절이도에서 싸웠습니다.', stats: [6, 7, 6], traits: ['loyal'], level: 1, arrive: hire(1594, 1),
    ability: { id: 'pursue', name: '추격', hanja: '追擊', line: '달아나는 적선을 놓치지 않습니다.', icon: 'sword', bonus: { pursuit: 0.3, speed: 0.03 }, battle: 'ram' } },
  { id: 'sinho', faction: 'joseon', name: '신호', hanja: '申浩', title: '낙안군수', portrait: 'portrait_sinho', bio: '낙안군수. 이순신을 따라 한산도 등에서 싸웠고 남원성에서 전사했습니다.', stats: [6, 6, 7], traits: ['virtuous'], level: 1, arrive: start,
    ability: { id: 'county', name: '고을 살림', hanja: '民政', line: '고을을 넉넉히 꾸려 수군을 먹입니다.', icon: 'coin', bonus: { income: 0.05, upkeep: 0.05 }, battle: 'volley' } },
  { id: 'ryuhyeong', faction: 'joseon', name: '류형', hanja: '柳珩', title: '해남현감', portrait: 'portrait_ryuhyeong', bio: '해남현감. 노량 해전에서 크게 다쳤으나 살아남았고 뒤에 통제사가 되었습니다.', stats: [7, 7, 7], traits: ['loyal'], level: 1, arrive: hire(1597, 7),
    ability: { id: 'rebuild', name: '수군 재건', hanja: '再建', line: '무너진 수군을 다시 일으켜 세웁니다.', icon: 'hammer', bonus: { repair: 0.15, xp: 0.1 }, battle: 'rally' } },
  { id: 'yieonryang', faction: 'joseon', name: '이언량', hanja: '李彦良', title: '군관', portrait: 'portrait_yieonryang', bio: '군관. 거북선을 맡은 돌격장으로 싸웠습니다.', stats: [5, 8, 3], traits: ['fierce', 'reckless'], level: 1, arrive: rec('yi', 1592, 7),
    ability: { id: 'turtleCaptain', name: '거북선 돌격장', hanja: '突擊將', line: '거북선을 몰아 적의 대장선으로 곧장 들이받습니다.', icon: 'sword', bonus: { melee: 0.03, speed: 0.03 }, battle: 'ram' } },
  { id: 'byeonjonseo', faction: 'joseon', name: '변존서', hanja: '卞存緖', title: '군관', portrait: 'portrait_byeonjonseo', bio: '이순신의 외사촌 동생. 군관으로 곁에서 싸웠습니다.', stats: [5, 6, 6], traits: ['virtuous'], level: 1, arrive: start,
    ability: { id: 'kin', name: '일가의 믿음', hanja: '一家', line: '대장의 곁을 지키는 피붙이라 장졸이 따릅니다.', icon: 'smoke', bonus: { xp: 0.15 }, battle: 'smoke' } },
  { id: 'jeongsajun', faction: 'joseon', name: '정사준', hanja: '鄭思竣', title: '군관', portrait: 'portrait_jeongsajun', bio: '군관. 일본의 조총을 본떠 정철총통을 만들었습니다.', stats: [4, 6, 8], traits: ['gunner'], level: 1, arrive: hire(1593, 1),
    ability: { id: 'musket', name: '정철총통', hanja: '正鐵銃筒', line: '조선에서 만든 조총으로 일제히 쏩니다.', icon: 'cannon', bonus: { gun: 0.05 }, battle: 'volley' } },
  { id: 'kiminyeong', faction: 'joseon', name: '김인영', hanja: '金仁英', title: '여도권관', portrait: 'portrait_kiminyeong', bio: '여도권관. 이순신 함대에 속해 여러 해전에 나섰습니다.', stats: [5, 6, 5], traits: ['cautious'], level: 1, arrive: start,
    ability: { id: 'defence', name: '방비', hanja: '防備', line: '작은 진을 지키던 솜씨로 배를 굳게 지킵니다.', icon: 'shield', bonus: { defense: 0.03 }, battle: 'bulwark' } },
  { id: 'yimonggu', faction: 'joseon', name: '이몽구', hanja: '李夢龜', title: '전라좌수영 우후', portrait: 'portrait_yimonggu', bio: '전라좌수영 우후. 수영의 군기와 살림을 맡았습니다.', stats: [5, 6, 6], traits: ['strict'], level: 1, arrive: start,
    ability: { id: 'order', name: '우후의 군기', hanja: '軍紀', line: '수영의 군기를 바로 세우고 살림을 아낍니다.', icon: 'scroll', bonus: { power: 0.02, upkeep: 0.04 }, battle: 'volley' } },

  // Japan
  { id: 'wakisaka', faction: 'japan', name: '와키자카 야스하루', hanja: '脇坂安治', title: '수군 대장', portrait: 'portrait_wakisaka', bio: '도요토미 정권의 수군 장수. 용인에서 조선 육군을 격파했고 한산도 해전에서 패했습니다.', stats: [7, 8, 6], traits: ['fierce'], level: 2, arrive: start,
    ability: { id: 'surprise', name: '기습', hanja: '奇襲', line: '적이 대비하기 전에 빠르게 덮칩니다.', icon: 'eye', bonus: { speed: 0.04, melee: 0.03 }, battle: 'ambush' } },
  { id: 'kuki', faction: 'japan', name: '구키 요시타카', hanja: '九鬼嘉隆', title: '수군 장수', portrait: 'portrait_kuki', bio: '구키 수군의 수장. 철판을 두른 큰 배를 만든 것으로 알려졌고 안골포에서 싸웠습니다.', stats: [7, 7, 7], traits: ['veteran'], level: 2, arrive: start,
    ability: { id: 'ironclad', name: '철갑 대안택선', hanja: '鐵甲船', line: '그가 머무는 포구에서는 대안택선과 아타케부네를 싸게 짓고, 배가 단단합니다.', icon: 'anchor', bonus: { defense: 0.04 }, ships: { kinds: ['daeantaek', 'atakebune'], cut: 0.2 }, battle: 'bulwark' } },
  { id: 'kato', faction: 'japan', name: '가토 요시아키', hanja: '加藤嘉明', title: '수군 장수', portrait: 'portrait_kato', bio: '시즈가타케 칠본창의 한 사람. 수군을 이끌고 칠천량과 명량에 나섰습니다.', stats: [6, 7, 7], traits: ['wise'], level: 2, arrive: start,
    ability: { id: 'spears', name: '칠본창', hanja: '七本槍', line: '창 한 자루로 이름을 떨친 무용으로 배에 오릅니다.', icon: 'sword', bonus: { melee: 0.04 }, battle: 'boarding' } },
  { id: 'kurushima', faction: 'japan', name: '구루시마 미치후사', hanja: '來島通總', title: '무라카미 수군', portrait: 'portrait_kurushima', bio: '무라카미 해적 가문의 수장. 1597년 명량 해전에서 전사했습니다.', stats: [6, 8, 4], traits: ['pirate', 'reckless'], level: 1, arrive: start,
    ability: { id: 'searaiders', name: '해적 수군', hanja: '海賊衆', line: '세토 내해의 해적들이 빠른 배로 적선에 달라붙습니다.', icon: 'sword', bonus: { melee: 0.04, reach: 0.05 }, battle: 'boarding' } },
  { id: 'todo', faction: 'japan', name: '도도 다카토라', hanja: '藤堂高虎', title: '수군 장수', portrait: 'portrait_todo', bio: '축성의 명수. 수군을 이끌고 칠천량에서 조선 수군을 격파했습니다.', stats: [7, 7, 8], traits: ['builder'], level: 2, arrive: start,
    ability: { id: 'castles', name: '축성술', hanja: '築城術', line: '머무는 포구를 단단한 성으로 바꾸어 배를 고치고 살림을 늘립니다.', icon: 'hammer', bonus: { repair: 0.15, income: 0.04 }, battle: 'bulwark' } },
  { id: 'shimazu', faction: 'japan', name: '시마즈 요시히로', hanja: '島津義弘', title: '사쓰마 영주', portrait: 'portrait_shimazu', bio: '사쓰마의 장수. 사천에서 명군을 크게 이겼고 노량 해전에서 퇴로를 열었습니다.', stats: [8, 10, 6], traits: ['fierce', 'great'], level: 3, arrive: start,
    ability: { id: 'oni', name: '귀신 시마즈', hanja: '鬼島津', line: '사쓰마 무사들이 귀신처럼 적선에 뛰어듭니다.', icon: 'sword', bonus: { melee: 0.06 }, battle: 'boarding' } },
  { id: 'konishi', faction: 'japan', name: '고니시 유키나가', hanja: '小西行長', title: '제1군 선봉', portrait: 'portrait_konishi', bio: '제1군의 선봉장. 평양까지 북진했고 강화 교섭을 이끌었습니다.', stats: [7, 6, 8], traits: ['wise'], level: 2, arrive: start,
    ability: { id: 'parley', name: '강화 교섭', hanja: '講和', line: '협상으로 시간을 벌고 장사꾼의 셈으로 군자금을 늘립니다.', icon: 'coin', bonus: { income: 0.05, hire: 0.15 }, battle: 'smoke' } },
  { id: 'manabe', faction: 'japan', name: '마나베 사마노조', hanja: '眞鍋左馬允', title: '와키자카 수군', portrait: 'portrait_manabe', bio: '와키자카의 수군 장수. 한산도 해전에서 배를 잃고 섬에 올랐다가 자결했다고 전합니다.', stats: [5, 7, 4], traits: ['reckless'], level: 1, arrive: start,
    ability: { id: 'cutIn', name: '칼끝 돌격', hanja: '斬込', line: '칼을 뽑아 들고 적선으로 건너갑니다.', icon: 'sword', bonus: { melee: 0.04 }, battle: 'boarding' } },
  { id: 'kan', faction: 'japan', name: '간 미치나가', hanja: '菅達長', title: '아와지 수군', portrait: 'portrait_kan', bio: '아와지의 수군 장수. 1597년 명량 해전에 나섰습니다.', stats: [5, 7, 5], traits: ['pirate'], level: 1, arrive: hire(1592, 4),
    ability: { id: 'awaji', name: '아와지 수군', hanja: '淡路衆', line: '아와지의 물길에 익은 뱃사람들이 빠르게 움직입니다.', icon: 'wave', bonus: { reach: 0.05 }, battle: 'tide' } },
  { id: 'so', faction: 'japan', name: '소 요시토시', hanja: '宗義智', title: '쓰시마 도주', portrait: 'portrait_so', bio: '쓰시마 도주. 고니시 유키나가의 사위로 선봉에 섰습니다.', stats: [6, 6, 7], traits: ['noble'], level: 1, arrive: rec('konishi', 1592, 4),
    ability: { id: 'tsushima', name: '쓰시마의 물길', hanja: '對馬', line: '조선과 일본 사이의 바닷길을 잘 압니다.', icon: 'wave', bonus: { reach: 0.06, supply: 0.2 }, battle: 'tide' } },
  { id: 'hachisuka', faction: 'japan', name: '하치스카 이에마사', hanja: '蜂須賀家政', title: '아와 영주', portrait: 'portrait_hachisuka', bio: '아와의 다이묘. 임진년과 정유년 두 번 조선에 건너왔습니다.', stats: [6, 7, 6], traits: ['cautious'], level: 1, arrive: pool(1592, 7),
    ability: { id: 'awa', name: '아와 철포대', hanja: '阿波鐵砲', line: '철포대가 한꺼번에 불을 뿜습니다.', icon: 'cannon', bonus: { gun: 0.03 }, battle: 'volley' } },
  { id: 'chosokabe', faction: 'japan', name: '조소카베 모토치카', hanja: '長宗我部元親', title: '도사 영주', portrait: 'portrait_chosokabe', bio: '도사의 다이묘. 수군을 이끌고 조선에 건너왔습니다.', stats: [7, 7, 7], traits: ['noble', 'veteran'], level: 2, arrive: pool(1592, 7),
    ability: { id: 'ichiryo', name: '일령구족', hanja: '一領具足', line: '논밭을 갈던 병사들이 갑옷 한 벌로 싸워 씀씀이가 적습니다.', icon: 'scroll', bonus: { melee: 0.03, upkeep: 0.06 }, battle: 'boarding' } },
  { id: 'nabeshima', faction: 'japan', name: '나베시마 나오시게', hanja: '鍋島直茂', title: '히젠 장수', portrait: 'portrait_nabeshima', bio: '히젠의 장수. 가토 기요마사와 함께 함경도까지 진군했습니다.', stats: [7, 7, 7], traits: ['strict'], level: 2, arrive: pool(1592, 7),
    ability: { id: 'scheme', name: '지모', hanja: '智謀', line: '싸움 앞에서 늘 한 수를 더 둡니다.', icon: 'smoke', bonus: { gun: 0.02, power: 0.02 }, battle: 'smoke' } },
  { id: 'kiyomasa', faction: 'japan', name: '가토 기요마사', hanja: '加藤清正', title: '제2군 대장', portrait: 'portrait_kiyomasa', bio: '제2군의 장수. 함경도까지 진군했고 울산성에서 농성했습니다.', stats: [8, 9, 6], traits: ['fierce'], level: 3, arrive: pool(1592, 7),
    ability: { id: 'tiger', name: '호랑이 사냥', hanja: '虎退治', line: '호랑이를 잡았다는 이야기처럼 사납게 몰아칩니다.', icon: 'sword', bonus: { melee: 0.05, power: 0.02 }, battle: 'boarding' } },
  { id: 'kuroda', faction: 'japan', name: '구로다 나가마사', hanja: '黑田長政', title: '제3군 대장', portrait: 'portrait_kuroda', bio: '제3군의 장수. 황해도로 진군했고 1597년 직산에서 싸웠습니다.', stats: [7, 8, 6], traits: ['fierce'], level: 2, arrive: pool(1592, 7),
    ability: { id: 'teppo', name: '철포대', hanja: '鐵砲隊', line: '조총수를 줄지어 세워 쉬지 않고 쏩니다.', icon: 'cannon', bonus: { gun: 0.04 }, battle: 'volley' } },
  { id: 'kobayakawa', faction: 'japan', name: '고바야카와 다카카게', hanja: '小早川隆景', title: '제6군 대장', portrait: 'portrait_kobayakawa', bio: '모리 가문의 노장. 벽제관에서 명군을 막아 냈습니다.', stats: [8, 7, 8], traits: ['great', 'oldHand'], level: 3, arrive: hire(1592, 7),
    ability: { id: 'byeokje', name: '벽제관의 반격', hanja: '碧蹄館', line: '밀려드는 적을 끌어들여 한꺼번에 되받아칩니다.', icon: 'flag', bonus: { power: 0.04 }, battle: 'rally' } },
  { id: 'ukita', faction: 'japan', name: '우키타 히데이에', hanja: '宇喜多秀家', title: '원정군 총대장', portrait: 'portrait_ukita', bio: '도요토미 히데요시의 양자. 조선 원정군의 총대장을 맡았습니다.', stats: [7, 6, 6], traits: ['noble'], level: 2, arrive: pool(1593, 1),
    ability: { id: 'supreme', name: '총대장', hanja: '總大將', line: '원정군의 깃발 아래 장수들이 모입니다.', icon: 'flag', bonus: { power: 0.03, hire: 0.1 }, battle: 'rally' } },
  { id: 'mori', faction: 'japan', name: '모리 데루모토', hanja: '毛利輝元', title: '주고쿠 영주', portrait: 'portrait_mori', bio: '주고쿠의 대다이묘. 대군과 수군을 보내 조선 원정을 떠받쳤습니다.', stats: [6, 5, 8], traits: ['noble'], level: 2, arrive: hire(1592, 7),
    ability: { id: 'moriNavy', name: '모리 수군', hanja: '毛利水軍', line: '넓은 영지에서 배와 군량을 보냅니다.', icon: 'coin', bonus: { income: 0.05, reach: 0.04 }, battle: 'tide' } },
  { id: 'horiuchi', faction: 'japan', name: '호리우치 우지요시', hanja: '堀內氏善', title: '구마노 수군', portrait: 'portrait_horiuchi', bio: '기이 구마노의 수군 장수. 구키 요시타카와 함께 수군으로 출전했습니다.', stats: [6, 7, 5], traits: ['pirate'], level: 1, arrive: rec('kuki', 1592, 7),
    ability: { id: 'kumano', name: '구마노 수군', hanja: '熊野衆', line: '험한 바다에 익은 구마노 뱃사람들이 몰래 다가갑니다.', icon: 'eye', bonus: { reach: 0.04, melee: 0.02 }, battle: 'ambush' } },
  { id: 'terazawa', faction: 'japan', name: '데라자와 마사나리', hanja: '寺澤正成', title: '나고야 봉행', portrait: 'portrait_terazawa', bio: '나고야의 봉행. 조선으로 가는 군량과 수송을 맡았습니다.', stats: [5, 5, 8], traits: ['wise'], level: 1, arrive: pool(1593, 1),
    ability: { id: 'commissary', name: '나고야 봉행', hanja: '奉行', line: '군량과 수송을 빈틈없이 꾸립니다.', icon: 'scroll', bonus: { supply: 0.3, upkeep: 0.06 }, battle: 'smoke' } },
  { id: 'moritakamasa', faction: 'japan', name: '모리 다카마사', hanja: '毛利高政', title: '수군 장수', portrait: 'portrait_moritakamasa', bio: '1597년 수군과 함께 출전했고 명량 해전에서 바다에 빠졌다가 살아났습니다.', stats: [5, 6, 6], traits: ['cautious'], level: 1, arrive: hire(1597, 1),
    ability: { id: 'survivor', name: '생환', hanja: '生還', line: '바다에 빠져도 살아 돌아오는 질긴 운을 지녔습니다.', icon: 'shield', bonus: { defense: 0.04 }, battle: 'tide' } },

  // Ming
  { id: 'chenlin', faction: 'ming', name: '진린', hanja: '陳璘', title: '수군 도독', portrait: 'portrait_chenlin', bio: '명 수군 도독. 1598년 조선에 와 이순신과 함께 노량 해전에서 싸웠습니다.', stats: [7, 8, 7], traits: ['strict'], level: 2, arrive: start,
    ability: { id: 'firepower', name: '명 수군 화력', hanja: '火力', line: '불랑기포와 호준포를 갖춘 명 수군의 화력을 쏟아붓습니다.', icon: 'cannon', bonus: { gun: 0.05 }, battle: 'volley' } },
  { id: 'deng', faction: 'ming', name: '등자룡', hanja: '鄧子龍', title: '수군 부총병', portrait: 'portrait_deng', bio: '일흔 살의 노장. 노량 해전에서 조선 판옥선에 올라 싸우다 전사했습니다.', stats: [6, 8, 6], traits: ['oldHand', 'fierce'], level: 2, arrive: start,
    ability: { id: 'oldFight', name: '노장의 분전', hanja: '老將奮戰', line: '늙은 몸을 아끼지 않고 적선에 뛰어듭니다.', icon: 'sword', bonus: { melee: 0.04, defense: 0.02 }, battle: 'boarding' } },
  { id: 'chencan', faction: 'ming', name: '진잠', hanja: '陳蠶', title: '수군 유격', portrait: 'portrait_chencan', bio: '명 수군 유격. 1598년 진린과 함께 수군을 이끌고 왔습니다.', stats: [6, 7, 6], traits: ['veteran'], level: 2, arrive: pool(1598, 1),
    ability: { id: 'zhejiang', name: '절강 수군', hanja: '浙江水軍', line: '남쪽 바다에서 단련된 절강 수군이 멀리까지 쏩니다.', icon: 'cannon', bonus: { gun: 0.03, reach: 0.03 }, battle: 'volley' } },
  { id: 'jijin', faction: 'ming', name: '계금', hanja: '季金', title: '수군 유격', portrait: 'portrait_jijin', bio: '명 수군 유격. 1598년 진린 휘하에서 노량 해전에 나섰습니다.', stats: [5, 7, 5], traits: ['fierce'], level: 1, arrive: rec('chenlin', 1598, 1),
    ability: { id: 'spearhead', name: '선봉 수군', hanja: '前鋒', line: '빠른 배로 앞서 나가 적을 묶어 둡니다.', icon: 'sword', bonus: { melee: 0.03, speed: 0.03 }, battle: 'ram' } },
  { id: 'liuting', faction: 'ming', name: '유정', hanja: '劉綎', title: '총병', portrait: 'portrait_liuting', bio: '큰 칼을 쓴 명의 장수. 1598년 서로군을 이끌고 순천 왜교성을 쳤습니다.', stats: [7, 8, 5], traits: ['fierce'], level: 2, arrive: pool(1593, 1),
    ability: { id: 'greatBlade', name: '대도', hanja: '大刀', line: '무거운 큰 칼을 휘두르며 앞장섭니다.', icon: 'sword', bonus: { melee: 0.05 }, battle: 'boarding' } },
  { id: 'magui', faction: 'ming', name: '마귀', hanja: '麻貴', title: '제독', portrait: 'portrait_magui', bio: '명의 제독. 1597년 원군을 이끌고 와 울산성을 공격했습니다.', stats: [7, 8, 6], traits: ['strict'], level: 2, arrive: pool(1597, 7),
    ability: { id: 'northern', name: '북방 정병', hanja: '北兵', line: '북쪽 변방에서 단련된 정병을 거느립니다.', icon: 'flag', bonus: { power: 0.03 }, battle: 'rally' } },
  { id: 'yanghao', faction: 'ming', name: '양호', hanja: '楊鎬', title: '경리', portrait: 'portrait_yanghao', bio: '명의 경리. 1597년 조선에 와 명군을 총괄했습니다.', stats: [6, 4, 7], traits: ['cautious'], level: 1, arrive: hire(1597, 7),
    ability: { id: 'quartermaster', name: '경리', hanja: '經理', line: '원군의 군량과 씀씀이를 꼼꼼히 관리합니다.', icon: 'scroll', bonus: { supply: 0.2, upkeep: 0.06 }, battle: 'smoke' } },
  { id: 'lirusong', faction: 'ming', name: '이여송', hanja: '李如松', title: '제독', portrait: 'portrait_lirusong', bio: '명의 제독. 1593년 평양성을 되찾았으나 벽제관에서 일본군에 막혔습니다.', stats: [9, 8, 6], traits: ['great', 'reckless'], level: 3, arrive: pool(1593, 1),
    ability: { id: 'cannonade', name: '불랑기 포격', hanja: '佛狼機', line: '평양성을 무너뜨린 화포를 앞세워 불바다를 만듭니다.', icon: 'fire', bonus: { gun: 0.04, fire: 0.1 }, battle: 'fire_arrows' } },
  { id: 'luoshangzhi', faction: 'ming', name: '낙상지', hanja: '駱尙志', title: '참장', portrait: 'portrait_luoshangzhi', bio: '힘이 세어 낙천근이라 불린 장수. 평양성 전투에서 성벽에 먼저 올랐습니다.', stats: [5, 9, 4], traits: ['fierce'], level: 1, arrive: rec('lirusong', 1593, 1),
    ability: { id: 'thousandPounds', name: '낙천근', hanja: '駱千斤', line: '천 근을 든다는 힘으로 적선에 먼저 오릅니다.', icon: 'sword', bonus: { melee: 0.05 }, battle: 'boarding' } },
  { id: 'wuweizhong', faction: 'ming', name: '오유충', hanja: '吳惟忠', title: '유격', portrait: 'portrait_wuweizhong', bio: '척계광의 부하였던 절강병 장수. 평양성 전투에서 다치면서도 싸웠습니다.', stats: [6, 7, 6], traits: ['strict'], level: 1, arrive: rec('lirusong', 1593, 1),
    ability: { id: 'qiArmy', name: '척가군', hanja: '戚家軍', line: '척계광에게 배운 원앙진으로 서로를 지킵니다.', icon: 'shield', bonus: { power: 0.03, defense: 0.02 }, battle: 'bulwark' } },
  { id: 'zhangliang', faction: 'ming', name: '장량상', hanja: '張良相', title: '수군 유격', portrait: 'portrait_zhangliang', bio: '명 수군 유격. 1598년 진린 함대와 함께 남해에서 싸웠습니다.', stats: [5, 6, 6], traits: ['veteran'], level: 1, arrive: hire(1598, 1),
    ability: { id: 'fireship', name: '화선', hanja: '火船', line: '불붙인 배를 띄워 적의 대열을 태웁니다.', icon: 'fire', bonus: { fire: 0.12 }, battle: 'fire_arrows' } },
  { id: 'wangyuanzhou', faction: 'ming', name: '왕원주', hanja: '王元周', title: '수군 유격', portrait: 'portrait_wangyuanzhou', bio: '명 수군 유격. 1598년 진린 휘하로 조선에 왔습니다.', stats: [5, 6, 6], traits: ['cautious'], level: 1, arrive: hire(1598, 1),
    ability: { id: 'convoy', name: '호송', hanja: '護送', line: '보급선을 지켜 함대가 바다에서 굶지 않게 합니다.', icon: 'smoke', bonus: { supply: 0.25, defense: 0.02 }, battle: 'smoke' } },
];

export const FIGURE_BY_ID: ReadonlyMap<string, FigureDef> = new Map(FIGURES.map((f) => [f.id, f]));
export const TRAIT_BY_ID: ReadonlyMap<string, TraitDef> = new Map(TRAITS.map((t) => [t.id, t]));
export const SKILL_BY_ID: ReadonlyMap<string, SkillDef> = new Map(SKILLS.map((s) => [s.id, s]));

// --- Men from the ranks and hired officers -----------------------------------------------------------------------

/** Shared faces for officers who are not one of the named figures (public/ui/portraits). */
export const GENERIC_PORTRAITS: Record<GrandFaction, readonly string[]> = {
  joseon: ['portrait_gen_joseon_1', 'portrait_gen_joseon_2', 'portrait_gen_joseon_3', 'portrait_gen_joseon_4', 'portrait_gen_joseon_5', 'portrait_gen_joseon_6'],
  japan: ['portrait_gen_japan_1', 'portrait_gen_japan_2', 'portrait_gen_japan_3', 'portrait_gen_japan_4', 'portrait_gen_japan_5', 'portrait_gen_japan_6'],
  ming: ['portrait_gen_ming_1', 'portrait_gen_ming_2', 'portrait_gen_ming_3', 'portrait_gen_ming_4', 'portrait_gen_ming_5', 'portrait_gen_ming_6'],
};

/**
 * Name parts for generated officers, Korean and its romanisation side by side (same order). A Korean name is a surname
 * and two syllables (김덕수, Kim Deok-su); a Japanese one a family and a given name; a Chinese one a surname and a given
 * name, as the Korean reading writes it (왕대용, Wang Dayong).
 */
export const NAME_PARTS: Record<GrandFaction, { family: [string, string]; given: [string, string]; syllables: boolean }> = {
  joseon: {
    family: ['김 이 박 최 정 강 조 윤 장 임 한 오 서 신 권 황 안 송 류 홍', 'Kim Yi Bak Choe Jeong Gang Jo Yun Jang Im Han O Seo Sin Gwon Hwang An Song Ryu Hong'], // i18n-ignore: name parts
    given: ['응 대 덕 사 계 득 수 언 의 충 효 경 립 남 영 석 춘 무 원 국 일 환 준 명', 'eung dae deok sa gye deuk su eon ui chung hyo gyeong rip nam yeong seok chun mu won guk il hwan jun myeong'], // i18n-ignore: name parts
    syllables: true,
  },
  japan: {
    family: ['마쓰다 오카모토 하야시 나카무라 이시다 야마다 모리타 요시다 니시무라 다카기 이노우에 사카이 무라이 후지타 고토 기무라', 'Matsuda Okamoto Hayashi Nakamura Ishida Yamada Morita Yoshida Nishimura Takagi Inoue Sakai Murai Fujita Goto Kimura'], // i18n-ignore: name parts
    given: ['마사노부 시게하루 나오카타 요시나리 다다쓰구 가쓰토시 모토키요 히데마사 노부카쓰 사다유키 도시나가 가게하루', 'Masanobu Shigeharu Naokata Yoshinari Tadatsugu Katsutoshi Motokiyo Hidemasa Nobukatsu Sadayuki Toshinaga Kageharu'], // i18n-ignore: name parts
    syllables: false,
  },
  ming: {
    family: ['왕 장 유 진 양 조 황 주 오 서 손 마 호 곽 하 고', 'Wang Zhang Liu Chen Yang Zhao Huang Zhou Wu Xu Sun Ma Hu Guo He Gao'], // i18n-ignore: name parts
    given: ['대용 국충 세웅 문환 정방 응룡 가상 유한 계종 원길 덕명 천작', 'Dayong Guozhong Shixiong Wenhuan Zhengfang Yinglong Jiaxiang Youhan Jizong Yuanji Deming Tianjue'], // i18n-ignore: name parts
    syllables: false,
  },
};

/** Branch each navy's computer doctrine favours first, and the second-tier and fourth-tier picks it prefers. */
export const DOCTRINE: Record<GrandFaction, { order: Branch[]; prefer: string[] }> = {
  joseon: { order: ['war', 'lead', 'admin'], prefer: ['aim', 'formation', 'deputies', 'morale', 'repair', 'thrift'] },
  japan: { order: ['war', 'lead', 'admin'], prefer: ['boarding', 'charge', 'deputies', 'morale', 'provisions', 'levy'] },
  ming: { order: ['lead', 'war', 'admin'], prefer: ['aim', 'formation', 'discipline', 'morale', 'repair', 'thrift'] },
};
