import type { Faction, GunType, ShipKind } from '../../sim/types';

// The ship codex: what the record says about each kind the game draws. Pure data, no three.js: the codex screen, the
// battle's close look and scripts/test-kinds.mjs read it. Every text is Korean source text shown through t(); the
// English is in src/i18n/en/codex.ts. Numbers come from the sources listed with them, not from the game's catalog
// (the spec sheet reads that).

/**
 * How firmly the record holds the ship. A: period records give its size and crew. B: period accounts and later drawings
 * or studies agree on its form, while its exact size is reconstructed. C: little survives, so the game's ship is mostly
 * a reconstruction.
 */
export type Grade = 'A' | 'B' | 'C';

export type CodexEntry = {
  /** The name in the script of its own navy: hanja for Joseon and Ming ships, kanji for Japanese ones. */
  native: string;
  era: string;
  role: string;
  story: string;
  /** Short recorded facts, each with its number and where it comes from. */
  facts: string[];
  sources: string[];
  grade: Grade;
};

export const GRADE_NOTE: Record<Grade, string> = {
  A: '당대 기록에 크기와 정원이 남아 있습니다.',
  B: '당대 기록과 후대의 도면·연구로 모습을 복원했습니다.',
  C: '남은 기록이 적어 게임에서 추정해 만든 모습입니다.',
};

/** The navies in the order the codex lists them, each with its ships from the largest to the smallest. */
export const NAVIES: { faction: Faction; kinds: ShipKind[] }[] = [
  { faction: 'joseon', kinds: ['panokseon', 'geobukseon', 'hyeopseon', 'sahuseon', 'pojakseon'] },
  { faction: 'japan', kinds: ['daeantaek', 'atakebune', 'sogantaek', 'daegwanseon', 'sekibune', 'byeongnyangseon', 'kobaya'] },
  { faction: 'ming', kinds: ['gwangseon', 'mingship', 'haechangseon', 'mingsmall', 'hoseon'] },
];

/** The seal of each navy: its name in hanja (the menu's serif cut carries these characters). */
export const NAVY_SEAL: Record<Faction, string> = { joseon: '朝鮮', japan: '日本', ming: '明' };

const KIM_1982 = '김재근, 『조선왕조군선연구』, 일조각, 1982';
const ISHII_1995 = '이시이 겐지(石井謙治), 『화선(和船) II』, 호세이대학출판국, 1995';
const QI = '척계광(戚繼光), 『기효신서(紀效新書)』';
const ZHENG = '정약증(鄭若曾), 『주해도편(籌海圖編)』, 1562';
const MAO = '모원의(茅元儀), 『무비지(武備志)』, 1621';
const JANGCHO = '이순신, 『임진장초(壬辰狀草)』';

export const ENTRIES: Record<ShipKind, CodexEntry> = {
  panokseon: {
    native: '板屋船',
    era: '1555년(명종 10) 무렵부터',
    role: '조선 수군의 주력 전선',
    story:
      '배 안 갑판 위에 상장(上粧)을 꾸며 갑판을 2층으로 올린 전선입니다. 노를 젓는 격군은 아래층에 몸을 숨기고, 활을 쏘는 사부와 총통을 다루는 포수는 높은 위층 갑판에서 싸웠습니다. 높은 갑판은 적이 뛰어오르기 어렵게 했고, 총통을 내려 쏘기에도 좋았습니다.',
    facts: [
      '1555년에 새 군선으로 시험되었습니다 (『명종실록』).',
      '임진왜란 때 125명이 넘는 군사가 탔습니다.',
      '한 복원 추정치는 길이 32.16m, 너비 8.74m, 높이 5.56m입니다.',
      '1592년 첫 출전 때 이순신의 함대는 판옥선 24척, 협선 15척, 포작선 46척이었습니다 (『임진장초』).',
    ],
    sources: ['『명종실록』', '『선조실록』', '『각선도본(各船圖本)』', KIM_1982, '한국민족문화대백과사전 「판옥선」'],
    grade: 'B',
  },
  geobukseon: {
    native: '龜船',
    era: '1413년 첫 기록 · 1592년 이순신이 건조',
    role: '덮개를 씌운 돌격선',
    story:
      '판옥선의 위쪽을 고쳐 덮개를 씌운 돌격선입니다. 앞에는 용머리를 달아 그 입을 총구멍으로 쓰고, 등에는 칼과 송곳을 꽂아 적이 뛰어오르지 못하게 했습니다. 1592년 사천 해전에서 처음 실전에 나섰습니다.',
    facts: [
      '『태종실록』 1413년 기사에 임진 나루에서 거북선의 모의 전투를 지켜보았다는 기록이 처음 나옵니다.',
      '전쟁 전날인 1592년 4월 12일, 이순신은 거북선에서 지자포와 현자포를 시험 사격했습니다 (『난중일기』).',
      '좌우에 총구멍이 여섯 개씩 있었고, 꼬리 아래에도 총구멍을 두었습니다 (『선조수정실록』).',
      '1795년 『이충무공전서』의 그림은 밑판 길이 64척 8촌, 노는 통제영 거북선 좌우 10개, 전라좌수영 거북선 좌우 8개입니다.',
      '덮개를 철판으로 쌌다는 기록은 조선 사료에 없습니다. 게임의 육각 철판은 후대 복원의 해석을 따른 것입니다.',
    ],
    sources: ['『태종실록』', '『선조수정실록』', '『이충무공전서』(1795) 「귀선도설」', '이순신, 『난중일기』', '김재근, 『거북선』, 정우사, 1992', '한국민족문화대백과사전 「거북선」'],
    grade: 'B',
  },
  hyeopseon: {
    native: '挾船',
    era: '1555년 무렵 ~ 임진왜란',
    role: '판옥선에 딸린 작은 배',
    story:
      '판옥선 곁을 따라다니며 연락과 정찰, 물자 운반을 맡은 작은 배입니다. 판옥선이 생긴 뒤 그 부속선으로 쓰였고, 임진왜란 중에 사후선이 점차 그 자리를 대신했습니다.',
    facts: ['1592년 첫 출전 함대에 협선 15척이 있었습니다 (『임진장초』).', '크기와 정원은 기록이 적습니다. 작은 총통과 보급 역할은 게임의 설정입니다.'],
    sources: [JANGCHO, KIM_1982, '한국민족문화대백과사전 「사후선」'],
    grade: 'C',
  },
  sahuseon: {
    native: '伺候船',
    era: '임진왜란 ~ 조선 후기',
    role: '무장 없는 정찰선',
    story: '전선에 딸린 무장 없는 작은 배입니다. 싸울 때는 정찰과 탐망을, 평소에는 잡무를 맡았습니다. 임진왜란 중에 협선을 대신해 전선마다 따라붙게 되었습니다.',
    facts: ['정원은 5명으로, 키잡이 1명과 격군 4명입니다.', '1744년 『속대전』에는 전국 군선 776척 가운데 318척이 사후선이었습니다.', '밑판 길이는 21척 6촌(『전라우수영지』) 또는 24척(『여암전서』)입니다.'],
    sources: ['『속대전』(1744)', '『전라우수영지』', '신경준, 『여암전서』', KIM_1982, '한국민족문화대백과사전 「사후선」'],
    grade: 'A',
  },
  pojakseon: {
    native: '鮑作船',
    era: '임진왜란',
    role: '징발한 어선',
    story: '전복을 따는 포작인의 배를 수군이 징발한 것입니다. 직접 싸우기보다 정찰과 연락, 짐 나르기를 맡았습니다.',
    facts: ['1592년 첫 출전 함대 85척 가운데 46척이 포작선이었습니다 (『임진장초』).'],
    sources: [JANGCHO, '한국민족문화대백과사전 「옥포해전」'],
    grade: 'B',
  },
  atakebune: {
    native: '安宅船',
    era: '16세기 중엽 ~ 17세기 초',
    role: '일본 수군의 대형 기함',
    story:
      '갑판 전체를 상자 모양의 총야구라(総矢倉)로 덮고 그 위에 여러 층 누각을 올려 ‘바다 위의 성’이라 불린 대형 군선입니다. 두꺼운 나무 방패벽의 총안으로 조총과 활을 쏘고, 배를 붙인 뒤 올라타 싸우는 도선을 장기로 삼았습니다. 주로 수군의 기함으로 쓰였습니다.',
    facts: [
      '노 50~150여 개를 노꾼 50~200명이 저었습니다.',
      '작은 것은 500석, 큰 것은 1,000석 넘게 실었습니다.',
      '임진왜란 때 도요토미 히데요시는 영지 10만 석마다 대선 2척을 마련하게 했습니다 (『태합기』).',
      '조선 수군의 총통 사격에 맞서기에는 실은 화포가 적었습니다.',
    ],
    sources: [ISHII_1995, '『태합기(太閤記)』', "Stephen Turnbull, Samurai Invasion: Japan's Korean War 1592–98, 2002"],
    grade: 'B',
  },
  daeantaek: {
    native: '大安宅',
    era: '1590년대',
    role: '누각을 올린 대장선',
    story: '아타케부네 가운데 가장 큰 급의 배입니다. 구키 요시타카가 도요토미 히데요시를 위해 지은 니혼마루(日本丸)가 대표적이며, 1592년 안골포 해전에서 조선 수군의 공격을 선체로 버티고 빠져나갔습니다.',
    facts: ['니혼마루는 길이 약 30m(백 척), 노 100개에 노꾼과 전투원 180명이 탔다고 전합니다.', '큰 아타케부네는 두 사람이 함께 젓는 큰 노를 쓰기도 했습니다.'],
    sources: [ISHII_1995, '『태합기(太閤記)』'],
    grade: 'B',
  },
  sogantaek: {
    native: '小安宅',
    era: '16세기 후반',
    role: '중형 누각선',
    story: '아타케부네 가운데 작은 급의 배입니다. 총야구라와 낮은 누각을 갖추고 대통과 조총을 실었습니다.',
    facts: ['작은 아타케부네는 500석 정도를 실었습니다.'],
    sources: [ISHII_1995],
    grade: 'C',
  },
  sekibune: {
    native: '関船',
    era: '16세기 ~ 에도 시대',
    role: '일본 수군의 중형 쾌속선',
    story:
      '아타케부네보다 가늘고 길며 뱃머리가 뾰족해 빠르고 몸놀림이 좋았던 중형 군선입니다. 일본 수군 전력의 중심이었고, 방패벽 너머로 조총과 활을 쏘다가 배를 붙여 올라타 싸웠습니다.',
    facts: ['노 40~80개짜리 배를 세키부네로 쳤습니다.', '돛대를 떼어 눕힐 수 있어, 싸울 때는 노로만 움직였습니다.', '이름은 바다의 관문(関所)에서 통행세를 받던 배라는 데서 왔다고 합니다.'],
    sources: [ISHII_1995, '『일포사전(日葡辭書)』, 1603'],
    grade: 'B',
  },
  daegwanseon: {
    native: '大関船',
    era: '16세기 후반',
    role: '큰 세키부네',
    story: '노가 80개에 가까운 큰 세키부네입니다. 아타케부네보다 가볍고 빨라, 적선에 재빨리 다가가 올라타는 데 쓰였습니다.',
    facts: ['세키부네는 노 40~80개 사이로, 클수록 더 많은 병력을 실었습니다.'],
    sources: [ISHII_1995],
    grade: 'C',
  },
  byeongnyangseon: {
    native: '兵糧船',
    era: '임진왜란',
    role: '병력과 군량 수송선',
    story: '바다 건너 병력과 쌀을 실어 나른 수송선입니다. 일본군의 보급은 이 배들에 달려 있었고, 조선 수군은 남해에서 바닷길을 끊어 일본군의 진격을 늦췄습니다.',
    facts: [],
    sources: ["Stephen Turnbull, Samurai Invasion: Japan's Korean War 1592–98, 2002"],
    grade: 'C',
  },
  kobaya: {
    native: '小早',
    era: '16세기 ~ 에도 시대',
    role: '작고 빠른 연락선',
    story: '일본 군선 세 가지 가운데 가장 작은 배로, 이름 그대로 작고 빠릅니다. 총야구라와 두꺼운 방패벽 없이 낮은 반벽만 둘러 방어는 약했지만, 정찰과 연락, 기습에 쓰였습니다.',
    facts: ['노는 대개 40개 이하였습니다.', '이마바리시 무라카미 해적 박물관의 복원선은 길이 8.4m, 너비 2m, 노 5개입니다.'],
    sources: [ISHII_1995, '이마바리시 무라카미 해적 박물관'],
    grade: 'B',
  },
  gwangseon: {
    native: '廣船',
    era: '16세기',
    role: '광둥의 대형 정크',
    story: '광둥(廣東)에서 만든 대형 정크입니다. 명대 병서는 검게 칠한 광둥 배를 ‘오조(烏艚)’라 불러 푸젠 배와 구별했습니다. 명 연안 방어에 쓰였지만, 조선에 왔다는 기록은 확인되지 않습니다.',
    facts: [],
    sources: [MAO],
    grade: 'C',
  },
  mingship: {
    native: '福船',
    era: '16세기',
    role: '명 수군의 대형 전선',
    story:
      '푸젠(福建)에서 만든 명 수군의 주력 대형 전선입니다. 바닥이 뾰족하고 물에 깊이 잠겨 먼바다에 강했지만, 노로는 몰기 어려워 바람에 기대야 했습니다. 1598년 진린이 이끈 명 수군은 조선 수군과 함께 노량 해전에 나섰습니다.',
    facts: [
      '척계광은 복선을 ‘높고 커서 성과 같다’, ‘사람의 힘으로 몰 수 없고 오로지 바람에 기댄다’고 적었습니다.',
      '‘백 명을 태울 수 있고, 고물에 3층 누각을 두었다’ (『주해도편』).',
      '물에 잠기는 깊이는 1장 1~2척이었습니다 (『기효신서』).',
    ],
    sources: [QI, ZHENG, MAO, '『선조실록』'],
    grade: 'B',
  },
  haechangseon: {
    native: '海滄船',
    era: '16세기 중엽',
    role: '복선보다 작은 푸젠 전선',
    story: '큰 복선은 얕은 바다에서 쓰기 어려워, 척계광은 그보다 작은 해창선을 함께 두었습니다. 물에 덜 잠기고 바람이 약해도 움직일 수 있었습니다. 조선에 왔다는 기록은 확인되지 않습니다.',
    facts: ['푸젠 배는 크기에 따라 여섯 호로 나뉘었고, 해창선은 넷째인 동선(冬船)입니다.', '물에 잠기는 깊이는 7~8척으로, 복선보다 얕았습니다.'],
    sources: [QI, MAO],
    grade: 'C',
  },
  mingsmall: {
    native: '沙船',
    era: '명대',
    role: '바닥이 평평한 소형선',
    story: '양쯔강 어귀와 북쪽 얕은 바다에서 쓰인 배입니다. 바닥이 평평하고 뱃머리와 고물이 네모나 모래톱에 얹혀도 기울지 않았습니다. 평소에는 짐배로 쓰다가 전쟁 때 병력 수송에 징발했으며, 게임에서는 명 수군의 소형 전선으로 씁니다.',
    facts: ['물에 얕게 잠겨 먼바다 항해에는 쓰지 않았습니다.'],
    sources: [ZHENG],
    grade: 'C',
  },
  hoseon: {
    native: '唬船',
    era: '명대',
    role: '빠른 소형선',
    story: '명 수군의 빠른 소형선입니다. 생김새와 크기를 전하는 기록이 남아 있지 않아, 게임에서는 명 사선의 모습을 줄여 그립니다.',
    facts: [],
    sources: [],
    grade: 'C',
  },
};

/** What each gun was and what it fired, from the record. */
export const GUN_NOTES: Record<GunType, string> = {
  cheonja:
    '조선 총통 가운데 가장 큰 화포입니다. 1555년 명문이 남은 유물은 길이 1.31m, 포구 지름 12.8cm입니다. 길이 11척 9촌, 무게 50근의 대장군전을 쏘면 900보를 날아갔다고 합니다.',
  jija: '천자총통 다음 크기의 총통입니다. 무게 33근의 장군전을 쏘았고, 사거리는 2,000여 보로 기록되어 있습니다.',
  hyeonja: '중형 총통으로, 무게 7근의 차대전이나 쇠 탄환을 쏘았습니다. 1596년 명문이 있는 유물이 1984년 거제 앞바다에서 인양되었습니다.',
  hwangja: '작은 총통입니다. 피령차중전을 쏘면 1,100보를 날아갔고, 쇠 탄환 40개를 한꺼번에 넣어 쏘기도 했습니다 (『화포식언해』).',
  seungja: '1575년 무렵 김지가 만든, 손에 들고 쏘는 소형 총통입니다. 임진왜란 때에는 일본의 조총에 밀렸습니다.',
  ozutsu: '쇠를 두드려 만든 일본의 대구경 화기입니다. 주조한 포보다 터질 위험이 적었고, 20몬메(약 75g)부터 수백 몬메에 이르는 탄을 쏘았습니다.',
  folangji: '포르투갈의 후장식 선회포를 명이 본떠 만든 화포입니다. 화약과 탄을 미리 넣은 자포(子砲)를 갈아 끼워 빠르게 연달아 쏠 수 있었고, 조선도 들여와 썼습니다.',
  hudun: '척계광이 만든 가벼운 화포로, 앞발을 땅에 박아 고정한 모습이 웅크린 호랑이 같다 하여 붙은 이름입니다. 산탄을 쏘았으며, 『화포식언해』는 납탄 70개 또는 쇠탄 30개를 넣는다고 적었습니다.',
};

export const GUN_SOURCES = ['한국민족문화대백과사전 「천자총통」 · 「대장군전」 · 「장군전」 · 「차대전」 · 「현자총통」 · 「황자총통」 · 「승자총통」', '『훈국신조군기도설』', '『융원필비』', '이서, 『화포식언해』, 1635'];
