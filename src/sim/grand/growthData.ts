import type { Temper } from '../maneuvers';
import type { ShipKind, ShipMods } from '../types';
import type { GrandFaction } from './types';

/**
 * The tables of the growth rules (growth.ts): each named commander's skill tree and signature trait, and each navy's
 * tech tree. Kept apart from the logic so the economy can read a tech's income without importing the turn.
 *
 * Every effect is a factor on the battle's own ship modifiers (ShipMods), so the 3D battle and the auto-resolve read the
 * same numbers; `march` adds to the distance a fleet sails in a turn, `xp` multiplies the experience a fight gives, and
 * `temper` is how the commander leads under the maneuver rules (maneuvers.ts, tactician.ts).
 */
export type Effect = Partial<ShipMods> & { march?: number; xp?: number; temper?: Temper };

export type Branch = 'gunnery' | 'command' | 'seamanship' | 'boarding';
export const BRANCHES: readonly Branch[] = ['gunnery', 'command', 'seamanship', 'boarding'];

export type SkillDef = { id: string; branch: Branch | 'mastery'; tier: number; label: string; text: string; effect: Effect };

export const BRANCH_LABEL: Record<Branch, string> = { gunnery: '포술', command: '통솔', seamanship: '항해', boarding: '백병' };

/** The three steps of each branch. A step needs the one before it in the same branch. */
export const BRANCH_SKILLS: Record<Branch, readonly SkillDef[]> = {
  gunnery: [
    { id: 'gunnery1', branch: 'gunnery', tier: 1, label: '속사', text: '장전 +5%', effect: { reload: 1.05 } },
    { id: 'gunnery2', branch: 'gunnery', tier: 2, label: '정조준', text: '명중 +7%', effect: { accuracy: 1.07 } },
    { id: 'gunnery3', branch: 'gunnery', tier: 3, label: '화공', text: '화재 +20%, 장전 +4%', effect: { fire: 1.2, reload: 1.04 } },
  ],
  command: [
    { id: 'command1', branch: 'command', tier: 1, label: '독전', text: '사기 +8%', effect: { morale: 1.08 } },
    { id: 'command2', branch: 'command', tier: 2, label: '조련', text: '경험 +25%, 사기 +4%', effect: { xp: 1.25, morale: 1.04 } },
    { id: 'command3', branch: 'command', tier: 3, label: '진법', text: '사기 +8%, 방어 +5%', effect: { morale: 1.08, defense: 1.05 } },
  ],
  seamanship: [
    { id: 'seamanship1', branch: 'seamanship', tier: 1, label: '물때', text: '속도 +4%, 선회 +6%', effect: { speed: 1.04, turn: 1.06 } },
    { id: 'seamanship2', branch: 'seamanship', tier: 2, label: '강행', text: '항속 +12%', effect: { march: 0.12 } },
    { id: 'seamanship3', branch: 'seamanship', tier: 3, label: '조류 읽기', text: '속도 +4%, 선회 +6%, 항속 +6%', effect: { speed: 1.04, turn: 1.06, march: 0.06 } },
  ],
  boarding: [
    { id: 'boarding1', branch: 'boarding', tier: 1, label: '갈고리', text: '백병 +8%', effect: { melee: 1.08 } },
    { id: 'boarding2', branch: 'boarding', tier: 2, label: '방패벽', text: '방어 +10%', effect: { defense: 1.1 } },
    { id: 'boarding3', branch: 'boarding', tier: 3, label: '돌격', text: '백병 +10%, 사기 +4%', effect: { melee: 1.1, morale: 1.04 } },
  ],
};

/** The level a commander's mastery (his own last skill) asks for. */
export const MASTERY_LEVEL = 4;

/** A commander's tree: the branches he can learn, the trait he is born with and the mastery that crowns it. */
export type CommanderTree = { hanja: string; branches: readonly Branch[]; trait: { label: string; text: string; effect: Effect }; mastery: { label: string; text: string; effect: Effect } };

export const TREES: Record<string, CommanderTree> = {
  yi: {
    hanja: '李舜臣',
    branches: ['gunnery', 'command', 'seamanship'],
    trait: { label: '학익진', text: '학의 날개로 감싸는 진법의 대가: 명중 +6%, 사기 +6%, 침착한 지휘', effect: { accuracy: 1.06, morale: 1.06, temper: 'steady' } },
    mastery: { label: '학익진 완성', text: '명중 +6%, 장전 +5%, 사기 +6%', effect: { accuracy: 1.06, reload: 1.05, morale: 1.06 } },
  },
  won: {
    hanja: '元均',
    branches: ['boarding', 'command'],
    trait: { label: '성급함', text: '앞뒤 없이 덤벼든다: 백병 +8%, 방어 −6%, 사기 −5%, 무모한 지휘', effect: { melee: 1.08, defense: 0.94, morale: 0.95, temper: 'rash' } },
    mastery: { label: '맹공', text: '백병 +10%, 장전 +4%', effect: { melee: 1.1, reload: 1.04 } },
  },
  eokgi: {
    hanja: '李億祺',
    branches: ['command', 'gunnery'],
    trait: { label: '전라우수영', text: '서해의 수군을 이끈다: 사기 +5%', effect: { morale: 1.05 } },
    mastery: { label: '연합 함대', text: '사기 +6%, 명중 +4%', effect: { morale: 1.06, accuracy: 1.04 } },
  },
  kwon: {
    hanja: '權俊',
    branches: ['command', 'boarding'],
    trait: { label: '중위장', text: '진의 한가운데를 지킨다: 방어 +8%', effect: { defense: 1.08 } },
    mastery: { label: '순천 수성', text: '사기 +6%, 방어 +5%', effect: { morale: 1.06, defense: 1.05 } },
  },
  eo: {
    hanja: '魚泳潭',
    branches: ['seamanship', 'gunnery'],
    trait: { label: '물길 안내', text: '남해의 물길을 손금 보듯 안다: 속도 +4%, 선회 +8%, 항속 +10%', effect: { speed: 1.04, turn: 1.08, march: 0.1 } },
    mastery: { label: '남해 수로', text: '항속 +10%, 선회 +6%', effect: { march: 0.1, turn: 1.06 } },
  },
  jeongun: {
    hanja: '鄭運',
    branches: ['boarding', 'gunnery'],
    trait: { label: '선봉장', text: '언제나 맨 앞에 선다: 백병 +6%, 사기 +8%, 대담한 지휘', effect: { melee: 1.06, morale: 1.08, temper: 'bold' } },
    mastery: { label: '부산포 돌격', text: '백병 +8%, 장전 +5%', effect: { melee: 1.08, reload: 1.05 } },
  },
  kimwan: {
    hanja: '金浣',
    branches: ['gunnery', 'seamanship'],
    trait: { label: '사도첨사', text: '포수들을 손수 다그친다: 장전 +5%', effect: { reload: 1.05 } },
    mastery: { label: '포격 명수', text: '명중 +6%, 장전 +4%', effect: { accuracy: 1.06, reload: 1.04 } },
  },
  nadaeyong: {
    hanja: '羅大用',
    branches: ['gunnery', 'seamanship'],
    trait: { label: '조선 장인', text: '배를 지은 사람이 배를 안다: 방어 +6%, 선회 +4%', effect: { defense: 1.06, turn: 1.04 } },
    mastery: { label: '거북선 설계', text: '방어 +8%, 화재 +10%', effect: { defense: 1.08, fire: 1.1 } },
  },
  songhuirip: {
    hanja: '宋希立',
    branches: ['command', 'boarding'],
    trait: { label: '독전고', text: '북을 울려 싸움을 다그친다: 사기 +10%', effect: { morale: 1.1 } },
    mastery: { label: '노량의 북채', text: '사기 +8%, 장전 +4%', effect: { morale: 1.08, reload: 1.04 } },
  },
  iyeongnam: {
    hanja: '李英男',
    branches: ['boarding', 'command'],
    trait: { label: '율포 결사', text: '물러서지 않는다: 백병 +5%, 사기 +6%', effect: { melee: 1.05, morale: 1.06 } },
    mastery: { label: '노량의 분전', text: '백병 +8%, 사기 +5%', effect: { melee: 1.08, morale: 1.05 } },
  },
  baeseol: {
    hanja: '裵楔',
    branches: ['seamanship', 'command'],
    trait: { label: '몸 사림', text: '배를 아끼고 싸움을 피한다: 속도 +6%, 사기 −6%, 신중한 지휘', effect: { speed: 1.06, morale: 0.94, temper: 'cautious' } },
    mastery: { label: '열두 척의 보전', text: '방어 +8%, 속도 +4%', effect: { defense: 1.08, speed: 1.04 } },
  },
  anwi: {
    hanja: '安衛',
    branches: ['command', 'boarding'],
    trait: { label: '결사', text: '죽기를 각오한다: 사기 +12%', effect: { morale: 1.12 } },
    mastery: { label: '명량의 분전', text: '백병 +8%, 방어 +6%', effect: { melee: 1.08, defense: 1.06 } },
  },
  iwan: {
    hanja: '李莞',
    branches: ['gunnery', 'command'],
    trait: { label: '숙부의 뜻', text: '이순신의 조카: 사기 +6%, 명중 +3%', effect: { morale: 1.06, accuracy: 1.03 } },
    mastery: { label: '대장기 수호', text: '사기 +8%, 방어 +4%', effect: { morale: 1.08, defense: 1.04 } },
  },
  wakisaka: {
    hanja: '脇坂安治',
    branches: ['boarding', 'seamanship'],
    trait: { label: '공명심', text: '공을 다투어 먼저 나선다: 속도 +4%, 백병 +5%, 대담한 지휘', effect: { speed: 1.04, melee: 1.05, temper: 'bold' } },
    mastery: { label: '아와지 수군', text: '백병 +8%, 속도 +4%', effect: { melee: 1.08, speed: 1.04 } },
  },
  kuki: {
    hanja: '九鬼嘉隆',
    branches: ['gunnery', 'seamanship'],
    trait: { label: '철갑선', text: '쇠를 두른 대선의 주인: 방어 +6%, 장전 +4%', effect: { defense: 1.06, reload: 1.04 } },
    mastery: { label: '구키 수군', text: '장전 +5%, 방어 +6%', effect: { reload: 1.05, defense: 1.06 } },
  },
  kato: {
    hanja: '加藤嘉明',
    branches: ['gunnery', 'boarding'],
    trait: { label: '조총대', text: '조총으로 먼저 친다: 명중 +6%, 신중한 지휘', effect: { accuracy: 1.06, temper: 'cautious' } },
    mastery: { label: '조총 연사', text: '장전 +6%, 명중 +4%', effect: { reload: 1.06, accuracy: 1.04 } },
  },
  kurushima: {
    hanja: '來島通總',
    branches: ['seamanship', 'boarding'],
    trait: { label: '해적 수군', text: '세토 내해의 물살에서 자랐다: 속도 +5%, 선회 +8%', effect: { speed: 1.05, turn: 1.08 } },
    mastery: { label: '구루시마 수군', text: '속도 +4%, 백병 +8%', effect: { speed: 1.04, melee: 1.08 } },
  },
  todo: {
    hanja: '藤堂高虎',
    branches: ['command', 'gunnery'],
    trait: { label: '축성가', text: '성을 쌓듯 진을 친다: 방어 +8%', effect: { defense: 1.08 } },
    mastery: { label: '도도 수군', text: '명중 +5%, 방어 +5%', effect: { accuracy: 1.05, defense: 1.05 } },
  },
  michiyuki: {
    hanja: '來島通之',
    branches: ['boarding', 'seamanship'],
    trait: { label: '무라카미 선봉', text: '형제 중 맏이가 앞장선다: 백병 +7%, 대담한 지휘', effect: { melee: 1.07, temper: 'bold' } },
    mastery: { label: '형제의 선봉', text: '백병 +6%, 사기 +6%', effect: { melee: 1.06, morale: 1.06 } },
  },
  konishi: {
    hanja: '小西行長',
    branches: ['command', 'seamanship'],
    trait: { label: '신중', text: '싸움보다 협상을 먼저 생각한다: 방어 +8%, 신중한 지휘', effect: { defense: 1.08, temper: 'cautious' } },
    mastery: { label: '순천 왜성', text: '방어 +8%, 사기 +5%', effect: { defense: 1.08, morale: 1.05 } },
  },
  shimazu: {
    hanja: '島津義弘',
    branches: ['boarding', 'command'],
    trait: { label: '귀신 시마즈', text: '사쓰마 무사의 등선 돌격: 백병 +15%, 사기 +6%, 대담한 지휘', effect: { melee: 1.15, morale: 1.06, temper: 'bold' } },
    mastery: { label: '등선 맹공', text: '백병 +10%, 방어 +5%', effect: { melee: 1.1, defense: 1.05 } },
  },
  tachibana: {
    hanja: '立花宗茂',
    branches: ['boarding', 'command'],
    trait: { label: '서국 무쌍', text: '서쪽에서 견줄 이가 없다는 장수: 백병 +8%, 사기 +8%', effect: { melee: 1.08, morale: 1.08 } },
    mastery: { label: '야나가와 정예', text: '백병 +8%, 사기 +5%', effect: { melee: 1.08, morale: 1.05 } },
  },
  chenlin: {
    hanja: '陳璘',
    branches: ['gunnery', 'command'],
    trait: { label: '오만한 도독', text: '공을 앞세운다: 장전 +5%, 대담한 지휘', effect: { reload: 1.05, temper: 'bold' } },
    mastery: { label: '수군 도독', text: '명중 +6%, 사기 +6%', effect: { accuracy: 1.06, morale: 1.06 } },
  },
  deng: {
    hanja: '鄧子龍',
    branches: ['boarding', 'command'],
    trait: { label: '노장', text: '일흔이 넘도록 싸운 장수: 사기 +10%, 백병 +5%', effect: { morale: 1.1, melee: 1.05 } },
    mastery: { label: '노량의 노장', text: '백병 +8%, 사기 +5%', effect: { melee: 1.08, morale: 1.05 } },
  },
  lirusong: {
    hanja: '李如松',
    branches: ['command', 'gunnery'],
    trait: { label: '동정 제독', text: '평양성을 되찾은 제독: 사기 +6%, 명중 +4%, 대담한 지휘', effect: { morale: 1.06, accuracy: 1.04, temper: 'bold' } },
    mastery: { label: '평양성 탈환', text: '장전 +6%, 사기 +6%', effect: { reload: 1.06, morale: 1.06 } },
  },
  magui: {
    hanja: '麻貴',
    branches: ['command', 'boarding'],
    trait: { label: '비왜 제독', text: '정유년의 명군을 이끈 제독: 방어 +6%, 사기 +5%', effect: { defense: 1.06, morale: 1.05 } },
    mastery: { label: '울산 공성', text: '백병 +6%, 방어 +6%', effect: { melee: 1.06, defense: 1.06 } },
  },
  liuting: {
    hanja: '劉綎',
    branches: ['boarding', 'command'],
    trait: { label: '유대도', text: '백 근 대도를 휘두른 장수: 백병 +10%', effect: { melee: 1.1 } },
    mastery: { label: '서로군', text: '백병 +6%, 사기 +6%', effect: { melee: 1.06, morale: 1.06 } },
  },
  jijin: {
    hanja: '季金',
    branches: ['seamanship', 'gunnery'],
    trait: { label: '절강 수군', text: '노량에서 싸운 수군 유격장: 속도 +4%, 장전 +5%', effect: { speed: 1.04, reload: 1.05 } },
    mastery: { label: '노량 협공', text: '명중 +6%, 장전 +5%', effect: { accuracy: 1.06, reload: 1.05 } },
  },
  yanghao: {
    hanja: '楊鎬',
    branches: ['command', 'seamanship'],
    trait: { label: '경리', text: '군무를 총괄한 문관: 사기 +6%, 방어 +3%, 신중한 지휘', effect: { morale: 1.06, defense: 1.03, temper: 'cautious' } },
    mastery: { label: '직산 방어', text: '방어 +6%, 사기 +5%', effect: { defense: 1.06, morale: 1.05 } },
  },
  wuweizhong: {
    hanja: '吳惟忠',
    branches: ['gunnery', 'boarding'],
    trait: { label: '척가군', text: '척계광의 절강병을 이끈 유격장: 명중 +6%, 방어 +4%', effect: { accuracy: 1.06, defense: 1.04 } },
    mastery: { label: '모란봉', text: '명중 +5%, 백병 +6%', effect: { accuracy: 1.05, melee: 1.06 } },
  },

  // The Armada theatre.
  howard: {
    hanja: 'Charles Howard',
    branches: ['command', 'gunnery'],
    trait: { label: '해군 총사령관', text: '서두르지 않고 바람 위를 지킨다: 사기 +6%, 명중 +3%, 침착한 지휘', effect: { morale: 1.06, accuracy: 1.03, temper: 'steady' } },
    mastery: { label: '바람 위의 함대', text: '명중 +5%, 속도 +4%, 사기 +4%', effect: { accuracy: 1.05, speed: 1.04, morale: 1.04 } },
  },
  drake: {
    hanja: 'Francis Drake',
    branches: ['seamanship', 'gunnery', 'boarding'],
    trait: { label: '엘 드라케', text: '카디스의 수염을 그슬린 사략선장: 속도 +5%, 화재 +12%, 항속 +8%, 대담한 지휘', effect: { speed: 1.05, fire: 1.12, march: 0.08, temper: 'bold' } },
    mastery: { label: '리벤지호', text: '장전 +6%, 명중 +5%, 백병 +5%', effect: { reload: 1.06, accuracy: 1.05, melee: 1.05 } },
  },
  hawkins: {
    hanja: 'John Hawkins',
    branches: ['seamanship', 'command'],
    trait: { label: '해군 재무관', text: '선체를 낮고 빠르게 다시 지었다: 선회 +8%, 방어 +4%', effect: { turn: 1.08, defense: 1.04 } },
    mastery: { label: '레이스 빌트', text: '속도 +5%, 선회 +6%, 항속 +6%', effect: { speed: 1.05, turn: 1.06, march: 0.06 } },
  },
  frobisher: {
    hanja: 'Martin Frobisher',
    branches: ['boarding', 'gunnery'],
    trait: { label: '북서 항로 탐험가', text: '거친 바다에 단련된 함장: 사기 +5%, 백병 +5%, 무모한 지휘', effect: { morale: 1.05, melee: 1.05, temper: 'rash' } },
    mastery: { label: '트라이엄프호', text: '방어 +8%, 장전 +4%', effect: { defense: 1.08, reload: 1.04 } },
  },
  medina: {
    hanja: 'Medina Sidonia',
    branches: ['command', 'boarding'],
    trait: { label: '초승달 진형', text: '함대를 흩지 않고 진형을 지킨다: 방어 +8%, 사기 +3%, 신중한 지휘', effect: { defense: 1.08, morale: 1.03, temper: 'cautious' } },
    mastery: { label: '무적함대', text: '사기 +6%, 방어 +6%', effect: { morale: 1.06, defense: 1.06 } },
  },
  recalde: {
    hanja: 'Juan Martínez de Recalde',
    branches: ['seamanship', 'command', 'boarding'],
    trait: { label: '노련한 제독', text: '대서양을 가장 잘 아는 에스파냐 제독: 선회 +6%, 사기 +5%, 항속 +6%, 침착한 지휘', effect: { turn: 1.06, morale: 1.05, march: 0.06, temper: 'steady' } },
    mastery: { label: '산 후안호', text: '방어 +8%, 백병 +6%', effect: { defense: 1.08, melee: 1.06 } },
  },
  leyva: {
    hanja: 'Alonso de Leyva',
    branches: ['boarding', 'command'],
    trait: { label: '선봉', text: '귀족 자제들을 태운 라 라타호의 지휘관: 백병 +10%, 대담한 지휘', effect: { melee: 1.1, temper: 'bold' } },
    mastery: { label: '라 라타 산타 마리아 엔코로나다', text: '백병 +8%, 사기 +6%', effect: { melee: 1.08, morale: 1.06 } },
  },
  oquendo: {
    hanja: 'Miguel de Oquendo',
    branches: ['gunnery', 'seamanship'],
    trait: { label: '기푸스코아 전대', text: '바스크 선원들의 전대장: 장전 +5%, 속도 +3%', effect: { reload: 1.05, speed: 1.03 } },
    mastery: { label: '산타 아나호', text: '장전 +5%, 명중 +5%', effect: { reload: 1.05, accuracy: 1.05 } },
  },

  // The Lepanto theatre (Capponi, Victory of the West; Konstam, Lepanto 1571; Bicheno, Crescent and Cross).
  donjuan: {
    hanja: 'Don Juan de Austria',
    branches: ['command', 'boarding'],
    trait: { label: '카를 5세의 아들', text: '알푸하라스 반란을 진압한 스물네 살의 총사령관: 사기 +8%, 백병 +3%, 대담한 지휘', effect: { morale: 1.08, melee: 1.03, temper: 'bold' } },
    mastery: { label: '레알호', text: '백병 +6%, 사기 +5%', effect: { melee: 1.06, morale: 1.05 } },
  },
  venier: {
    hanja: 'Sebastiano Venier',
    branches: ['boarding', 'command'],
    trait: { label: '일흔다섯의 노장', text: '기함 갑판에서 석궁을 쏘며 싸운 베네치아 총사령관: 백병 +8%, 사기 +4%, 무모한 지휘', effect: { melee: 1.08, morale: 1.04, temper: 'rash' } },
    mastery: { label: '베네치아의 기함', text: '방어 +6%, 백병 +5%', effect: { defense: 1.06, melee: 1.05 } },
  },
  barbarigo: {
    hanja: 'Agostino Barbarigo',
    branches: ['command', 'gunnery'],
    trait: { label: '해안의 좌익', text: '얕은 해안에 붙여 좌익을 지켰다: 방어 +6%, 명중 +3%, 침착한 지휘', effect: { defense: 1.06, accuracy: 1.03, temper: 'steady' } },
    mastery: { label: '마지막 지휘', text: '사기 +6%, 방어 +4%', effect: { morale: 1.06, defense: 1.04 } },
  },
  doria: {
    hanja: 'Gian Andrea Doria',
    branches: ['seamanship', 'command'],
    trait: { label: '제노바의 갤리선 계약자', text: '자기 갤리선을 아끼는 노련한 선원: 선회 +8%, 방어 +3%, 신중한 지휘', effect: { turn: 1.08, defense: 1.03, temper: 'cautious' } },
    mastery: { label: '우익의 기동', text: '속도 +4%, 선회 +5%, 항속 +6%', effect: { speed: 1.04, turn: 1.05, march: 0.06 } },
  },
  alipasha: {
    hanja: 'Müezzinzade Ali Pasha',
    branches: ['command', 'boarding'],
    trait: { label: '카푸단 파샤', text: '예니체리를 태운 술타나의 지휘관: 백병 +8%, 사기 +4%, 대담한 지휘', effect: { melee: 1.08, morale: 1.04, temper: 'bold' } },
    mastery: { label: '술타나호', text: '백병 +6%, 방어 +5%', effect: { melee: 1.06, defense: 1.05 } },
  },
  pertev: {
    hanja: 'Pertev Pasha',
    branches: ['boarding', 'command'],
    trait: { label: '세르다르', text: '함대에 태운 원정군의 장군: 백병 +6%, 방어 +4%, 신중한 지휘', effect: { melee: 1.06, defense: 1.04, temper: 'cautious' } },
    mastery: { label: '원정군', text: '백병 +5%, 사기 +5%', effect: { melee: 1.05, morale: 1.05 } },
  },
  uluc: {
    hanja: 'Uluç Ali',
    branches: ['seamanship', 'gunnery', 'boarding'],
    trait: { label: '알제의 베일레르베이', text: '칼라브리아에서 붙잡혀 와 해적 제독이 되었다: 속도 +6%, 선회 +6%, 항속 +8%, 침착한 지휘', effect: { speed: 1.06, turn: 1.06, march: 0.08, temper: 'steady' } },
    mastery: { label: '몰타의 기함', text: '레판토에서 몰타 기사단의 기함을 붙잡았다: 백병 +6%, 속도 +4%', effect: { melee: 1.06, speed: 1.04 } },
  },
  siroco: {
    hanja: 'Mehmed Siroco',
    branches: ['command', 'seamanship'],
    trait: { label: '알렉산드리아 총독', text: '이집트 갤리선단을 이끈 우익의 지휘관: 사기 +5%, 선회 +4%', effect: { morale: 1.05, turn: 1.04 } },
    mastery: { label: '해안의 우익', text: '방어 +5%, 백병 +5%', effect: { defense: 1.05, melee: 1.05 } },
  },
};

export const MASTERY_ID = 'mastery';

// --- Techs ------------------------------------------------------------------------------------------------------

/**
 * One step of a navy's tech tree. `kinds` limits `effect` to those hulls (all of the navy's otherwise); `unlock` is a
 * ship the navy can build once it is done; `income` multiplies the navy's income.
 */
export type TechDef = {
  id: string;
  faction: GrandFaction;
  label: string;
  text: string;
  gold: number;
  turns: number;
  needs: readonly string[];
  effect?: Effect;
  kinds?: readonly ShipKind[];
  unlock?: ShipKind;
  income?: number;
};

export const TECHS: readonly TechDef[] = [
  { id: 'panokseon', faction: 'joseon', label: '판옥선 개량', text: '판옥선·거북선 방어 +10%, 선회 +6%, 속도 +3%', gold: 380, turns: 2, needs: [], kinds: ['panokseon', 'geobukseon'], effect: { defense: 1.1, turn: 1.06, speed: 1.03 } },
  { id: 'turtle', faction: 'joseon', label: '거북선 건조', text: '거북선 건조 가능 (선소 2단계)', gold: 350, turns: 1, needs: ['panokseon'], unlock: 'geobukseon' },
  { id: 'chongtong', faction: 'joseon', label: '총통 개량(천자·지자)', text: '전 함선 장전 +6%, 명중 +6%', gold: 600, turns: 3, needs: ['panokseon'], effect: { reload: 1.06, accuracy: 1.06 } },
  { id: 'powder', faction: 'joseon', label: '화약 증산', text: '화재 +15%, 장전 +4%', gold: 450, turns: 2, needs: [], effect: { fire: 1.15, reload: 1.04 } },
  { id: 'drill', faction: 'joseon', label: '수군 조련', text: '사기 +8%, 장수 경험 +25%', gold: 350, turns: 2, needs: ['powder'], effect: { morale: 1.08, xp: 1.25 } },

  { id: 'atake', faction: 'japan', label: '아타케부네 대형화', text: '대안택선 건조 가능 (선소 3단계), 아타케부네·대안택선 방어 +10%', gold: 450, turns: 2, needs: [], kinds: ['atakebune', 'daeantaek'], effect: { defense: 1.1 }, unlock: 'daeantaek' },
  { id: 'volley', faction: 'japan', label: '조총 일제사격', text: '전 함선 명중 +6%, 장전 +3%', gold: 420, turns: 2, needs: [], effect: { accuracy: 1.06, reload: 1.03 } },
  { id: 'boarding', faction: 'japan', label: '등선 전술', text: '백병 +10%, 방어 +5%', gold: 420, turns: 2, needs: ['volley'], effect: { melee: 1.1, defense: 1.05 } },
  { id: 'pirates', faction: 'japan', label: '해적 수군 편입', text: '세키부네·고바야 속도 +5%, 선회 +6%', gold: 380, turns: 2, needs: [], kinds: ['sekibune', 'kobaya'], effect: { speed: 1.05, turn: 1.06 } },
  { id: 'drill', faction: 'japan', label: '수군 조련', text: '사기 +8%, 장수 경험 +25%', gold: 350, turns: 2, needs: ['boarding'], effect: { morale: 1.08, xp: 1.25 } },

  { id: 'frankish', faction: 'ming', label: '불랑기 보급', text: '전 함선 장전 +6%, 명중 +3%', gold: 520, turns: 2, needs: [], effect: { reload: 1.06, accuracy: 1.03 } },
  { id: 'greatships', faction: 'ming', label: '대선 건조', text: '광선 건조 가능 (선소 3단계), 대형선·광선 방어 +10%', gold: 600, turns: 3, needs: ['frankish'], kinds: ['mingship', 'gwangseon'], effect: { defense: 1.1 }, unlock: 'gwangseon' },
  { id: 'grain', faction: 'ming', label: '군량 해운', text: '수입 +3%', gold: 450, turns: 2, needs: [], income: 1.03 },
  { id: 'drill', faction: 'ming', label: '수군 조련', text: '사기 +8%, 장수 경험 +25%', gold: 350, turns: 2, needs: ['grain'], effect: { morale: 1.08, xp: 1.25 } },

  { id: 'culverin', faction: 'england', label: '컬버린 포술', text: '전 함선 장전 +6%, 명중 +6%', gold: 480, turns: 2, needs: [], effect: { reload: 1.06, accuracy: 1.06 } },
  { id: 'raceships', faction: 'england', label: '레이스 빌트 개조', text: '갤리온·핀네이스 속도 +5%, 선회 +8%', gold: 400, turns: 2, needs: [], kinds: ['racegalleon', 'pinnace'], effect: { speed: 1.05, turn: 1.08 } },
  { id: 'fireships', faction: 'england', label: '화공선 전술', text: '화재 +20%', gold: 380, turns: 2, needs: ['culverin'], effect: { fire: 1.2 } },
  { id: 'drill', faction: 'england', label: '수병 조련', text: '사기 +8%, 장수 경험 +25%', gold: 350, turns: 2, needs: ['raceships'], effect: { morale: 1.08, xp: 1.25 } },

  { id: 'galleasses', faction: 'spain', label: '갈레아스 건조', text: '갈레아스 건조 가능 (선소 2단계), 갤리온·갈레아스 방어 +10%', gold: 450, turns: 2, needs: [], kinds: ['spgalleon', 'galleass'], effect: { defense: 1.1 }, unlock: 'galleass' },
  { id: 'tercios', faction: 'spain', label: '테르시오 승선대', text: '백병 +12%, 방어 +4%', gold: 420, turns: 2, needs: [], effect: { melee: 1.12, defense: 1.04 } },
  { id: 'silver', faction: 'spain', label: '인디아스 은 선단', text: '수입 +5%', gold: 480, turns: 2, needs: [], income: 1.05 },
  { id: 'drill', faction: 'spain', label: '수병 조련', text: '사기 +8%, 장수 경험 +25%', gold: 350, turns: 2, needs: ['tercios'], effect: { morale: 1.08, xp: 1.25 } },

  // The Lepanto theatre. Venice turned six great merchant galleys into galleasses at the Arsenal; Don Juan had the
  // galleys' spurs cut down so their bow guns could fire low; Spain's arquebusiers fought aboard; the Ottomans carried
  // janissaries and the composite bow, and the corsairs of Barbary sailed with them (Capponi; Guilmartin).
  { id: 'galleasses', faction: 'holyleague', label: '갈레아스 개조', text: '갈레아스 건조 가능 (선소 2단계), 갈레아·갈레아스 방어 +10%', gold: 450, turns: 2, needs: [], kinds: ['galea', 'vgalleass'], effect: { defense: 1.1 }, unlock: 'vgalleass' },
  { id: 'arquebus', faction: 'holyleague', label: '화승총병 승선', text: '백병 +10%, 명중 +4%', gold: 420, turns: 2, needs: [], effect: { melee: 1.1, accuracy: 1.04 } },
  { id: 'spurs', faction: 'holyleague', label: '충각 절단', text: '이물 대포 낮게 쏘기: 명중 +8%', gold: 380, turns: 2, needs: ['arquebus'], effect: { accuracy: 1.08 } },
  { id: 'drill', faction: 'holyleague', label: '수병 조련', text: '사기 +8%, 장수 경험 +25%', gold: 350, turns: 2, needs: ['galleasses'], effect: { morale: 1.08, xp: 1.25 } },

  { id: 'janissaries', faction: 'ottoman', label: '예니체리 승선', text: '백병 +12%, 방어 +4%', gold: 420, turns: 2, needs: [], effect: { melee: 1.12, defense: 1.04 } },
  { id: 'archers', faction: 'ottoman', label: '복합궁 사수', text: '전 함선 장전 +6%, 명중 +4%', gold: 400, turns: 2, needs: [], effect: { reload: 1.06, accuracy: 1.04 } },
  { id: 'corsairs', faction: 'ottoman', label: '바르바리 해적 편입', text: '카드르가·칼리야타 속도 +5%, 선회 +6%', gold: 380, turns: 2, needs: [], kinds: ['kadirga', 'kalyata'], effect: { speed: 1.05, turn: 1.06 } },
  { id: 'drill', faction: 'ottoman', label: '수병 조련', text: '사기 +8%, 장수 경험 +25%', gold: 350, turns: 2, needs: ['janissaries'], effect: { morale: 1.08, xp: 1.25 } },
];

export const techsOf = (f: GrandFaction): TechDef[] => TECHS.filter((t) => t.faction === f);
export const techById = (f: GrandFaction, id: string): TechDef | undefined => TECHS.find((t) => t.faction === f && t.id === id);

/** What the navy's finished research multiplies its income by. */
export function techIncome(done: readonly string[] | undefined, f: GrandFaction): number {
  let mult = 1;
  for (const id of done ?? []) mult *= techById(f, id)?.income ?? 1;
  return mult;
}
