import { COMMANDERS } from '../sim/grand/regions';
import type { GrandFaction } from '../sim/grand/types';

/**
 * Each commander's short opening (8–15 s): a slow reveal, his name and title in --font-title, then one or two lines of
 * his own in --font-cine. A line with `note` is written in character from what the record says he did, and the subtitle
 * says so ("기록에 따른 대사"); a line without it is quoted (records in src/cinema/SOURCES.md). Presentation only.
 */
export type IntroLine = { text: string; hanja?: string; source: string; note?: string };
export type CommanderIntro = { id: string; year: string; lines: IntroLine[] };

const L = (text: string, source: string, note?: string, hanja?: string): IntroLine => ({ text, source, note, hanja });

const INTROS: CommanderIntro[] = [
  // 1592–1598, Joseon
  { id: 'yi', year: '1545 – 1598', lines: [
    L('함부로 움직이지 마라. 산처럼 무겁고 고요하게.', '이순신 장계 「옥포파왜병장」', undefined, '勿令妄動 靜重如山'),
    L('신에게는 아직 열두 척의 배가 있습니다.', '이분 『행록』', undefined, '今臣戰船 尙有十二'),
  ] },
  { id: 'won', year: '1540 – 1597', lines: [
    L('경상우수영의 배로는 막아 낼 수 없다. 전라 수군에 구원을 청하라.', '유성룡 『징비록』 권1', '율포만호 이영남을 보내 이순신에게 구원을 청한 기록'),
  ] },
  { id: 'eokgi', year: '1561 – 1597', lines: [
    L('전라우수영 함대가 좌수영과 함께 나아간다.', '이순신 장계 「당항포파왜병장」', '1592년 6월 이순신 함대에 합류한 기록'),
  ] },
  { id: 'kwon', year: '1547 – 1611', lines: [
    L('순천의 배는 중위에서 통제사의 기함을 지킨다.', '이순신 장계 「당항포파왜병장」', '중위장 순천부사로 이름이 오른 기록'),
  ] },
  { id: 'eo', year: '1532 – 1594', lines: [
    L('이 바다의 물길은 제가 압니다. 앞장서 길을 열겠습니다.', '이순신 장계 · 한국민족문화대백과 「어영담」', '물길에 밝아 함대의 길잡이를 맡았다는 기록'),
  ] },
  { id: 'jeongun', year: '1543 – 1592', lines: [
    L('적을 치는 데 이 도 저 도가 어디 있습니까. 지금 나가야 합니다.', '이분 『행록』', '경상도로 나가기를 망설일 때 출전을 주장한 기록'),
  ] },
  { id: 'kimwan', year: '1546 – 1607', lines: [
    L('사도의 배는 물러서지 않는다.', '이순신 장계 「옥포파왜병장」 · 「견내량파왜병장」', '사도첨사로 옥포·한산 해전에 나선 기록'),
  ] },
  { id: 'nadaeyong', year: '1556 – 1612', lines: [
    L('앞에는 용머리, 등에는 쇠못. 안에서는 밖을 보아도 밖에서는 안을 보지 못한다.', '이순신 장계 「당포파왜병장」', '장계의 거북선 묘사를, 건조를 맡은 그의 말로 옮김', '前設龍頭 背植鐵尖'),
  ] },
  { id: 'songhuirip', year: '1553 – 1623', lines: [
    L('영남을 구하지 않으면 호남도 지킬 수 없습니다.', '이분 『행록』', '1592년 출전 논의 때 정운과 함께 출전을 주장한 기록'),
  ] },
  { id: 'iyeongnam', year: '1563 – 1598', lines: [
    L('원 수사께서 구원을 청하십니다. 경상도 바다가 위태롭습니다.', '유성룡 『징비록』 권1', '원균의 명으로 이순신에게 구원을 청하러 간 기록'),
  ] },
  { id: 'baeseol', year: '1551 – 1599', lines: [
    L('칠천량에서 배 열두 척을 이끌고 빠져나왔다.', '『선조실록』 1597년 7월', '칠천량 패전 때 전선을 이끌고 물러나 남은 배가 되었다는 기록'),
  ] },
  { id: 'anwi', year: '1563 – 1644', lines: [
    L('물러설 곳은 없다. 적진으로 들어간다!', '『난중일기』 정유년 9월 16일', '이순신의 호령을 듣고 적선 속으로 돌입했다는 기록'),
  ] },
  { id: 'iwan', year: '1579 – 1627', lines: [
    L('숙부의 죽음을 알리지 마라. 북을 멈추지 마라.', '이분 『행록』', '이순신의 유언대로 죽음을 숨기고 독전한 기록'),
  ] },
  // Japan
  { id: 'wakisaka', year: '1554 – 1626', lines: [
    L('용인에서 조선의 대군을 깨뜨렸다. 바다라 하여 다를 것 없다.', '『脇坂記』 · 일본 측 기록', '1592년 6월 용인 전투에서 이기고 수군을 이끌고 내려온 기록'),
  ] },
  { id: 'kuki', year: '1542 – 1600', lines: [
    L('철갑 대선으로 모리의 수군을 막은 것이 나다.', '『信長公記』 · 일본 측 기록', '1578년 기즈가와구치에서 철갑선을 이끈 기록'),
  ] },
  { id: 'kato', year: '1563 – 1631', lines: [
    L('시즈가타케의 창으로 이름을 얻었다. 바다에서도 물러서지 않는다.', '일본 측 기록 (시즈가타케 칠본창)', '시즈가타케 전투의 일곱 창 가운데 한 사람이라는 기록'),
  ] },
  { id: 'kurushima', year: '1561 – 1597', lines: [
    L('형님이 이 바다에서 쓰러졌다. 그 원수를 갚으리라.', '일본 측 기록 (ja.wikipedia 「来島通総」)', '형 미치유키가 1592년 당포에서 전사한 기록'),
  ] },
  { id: 'michiyuki', year: '? – 1592', lines: [
    L('세토의 물살에서 자란 배다. 조선의 바다도 다르지 않다.', '일본 측 기록 (ja.wikipedia 「来島通之」)', '무라카미 수군 구루시마 가문 출신, 1592년 당포에서 전사한 기록'),
  ] },
  { id: 'todo', year: '1556 – 1630', lines: [
    L('칠천량에서 조선 수군을 깨뜨렸다. 남은 배는 몇 척 되지 않는다.', '일본 측 기록 (ja.wikipedia 「漆川梁海戦」)', '1597년 칠천량 해전과 명량 해전에 수군을 이끈 기록'),
  ] },
  { id: 'konishi', year: '1558 – 1600', lines: [
    L('싸우려면 싸우고, 싸우지 않으려면 길을 빌려 달라.', '유성룡 『징비록』 권1', '1592년 4월 동래성 앞에 내건 글', '戰則戰矣 不戰則假道'),
  ] },
  { id: 'shimazu', year: '1535 – 1619', lines: [
    L('사천에서 명군을 막았다. 이제 고니시를 구하러 간다.', '『征韓録』 · 일본 측 기록', '1598년 사천 전투와 노량 구원 출진의 기록'),
  ] },
  { id: 'tachibana', year: '1567 – 1643', lines: [
    L('야나가와의 군사는 벽제관에서 물러서지 않았다.', '일본 측 기록 (ja.wikipedia 「碧蹄館の戦い」)', '1593년 벽제관 전투에서 선봉으로 싸운 기록'),
  ] },
  // Ming
  { id: 'chenlin', year: '1543 – 1607', lines: [
    L('통제사는 하늘과 땅을 다스릴 재주와 하늘을 깁고 해를 씻은 공이 있다.', '『이충무공전서』 · 진린이 명 조정에 올린 글로 전함', undefined, '經天緯地之才 補天浴日之功'),
  ] },
  { id: 'deng', year: '1528 – 1598', lines: [
    L('늙었다 하여 뒤에 설 수는 없다. 선봉은 내가 맡겠다.', '『명사』 권247 등자룡전', '일흔이 넘었으나 기개가 더욱 굳세어 앞장섰다는 기록'),
  ] },
  { id: 'lirusong', year: '1549 – 1598', lines: [
    L('평양을 되찾는다. 대포를 앞세워라.', '『선조실록』 1593년 1월 · 『명사』 이여송전', '1593년 1월 평양성을 포격해 되찾은 기록'),
  ] },
  { id: 'wuweizhong', year: '? – ?', lines: [
    L('절강의 병사는 성벽 앞에서 물러나지 않는다.', '『선조실록』 1593년 1월', '평양성 모란봉을 공격하다 탄환을 맞고도 싸웠다는 기록'),
  ] },
  { id: 'yanghao', year: '? – 1629', lines: [
    L('한성은 내줄 수 없다. 직산에서 적을 막아라.', '『선조실록』 1597년 9월', '경리로서 직산 전투로 왜군의 북상을 막은 기록'),
  ] },
  { id: 'magui', year: '? – ?', lines: [
    L('울산의 성을 에워싸라. 물과 양식이 먼저 다할 것이다.', '『선조실록』 1597년 12월', '제독으로 울산성을 포위한 기록'),
  ] },
  { id: 'liuting', year: '1558 – 1619', lines: [
    L('서로군은 순천의 왜성을 친다. 수군과 함께 조여라.', '『선조실록』 1598년 9월', '1598년 순천 왜교성 수륙 협공의 기록'),
  ] },
  { id: 'jijin', year: '? – ?', lines: [
    L('도독을 따라 고금도로 간다. 조선 수군과 함께 진을 친다.', '『선조실록』 1598년', '진린과 함께 온 명 수군 유격장의 기록'),
  ] },
  // 1588, England and Spain
  { id: 'howard', year: '1536 – 1624', lines: [
    L('저들의 힘은 놀랍도록 크고 강하다. 그래도 우리는 깃털을 조금씩 뽑아낸다.', '하워드가 월싱엄에게 보낸 편지, 1588년 7월 (Laughton 1894)'),
  ] },
  { id: 'drake', year: '1540 – 1596', lines: [
    L('모든 싸움에서 때와 곳을 얻으면 절반은 이긴 것입니다.', '드레이크가 여왕에게 보낸 편지, 1588년 4월 (Laughton 1894)'),
  ] },
  { id: 'frobisher', year: '1535 – 1594', lines: [
    L('트라이엄프호는 곶 안쪽에서 버틴다. 바람이 바뀔 때까지.', 'Mattingly 1959, 22장', '포틀랜드 곶 안쪽에서 고립된 채 싸운 기록'),
  ] },
  { id: 'hawkins', year: '1532 – 1595', lines: [
    L('배를 낮고 길게 고쳤다. 바람 앞에서 저들보다 빠르다.', 'Martin & Parker 1988, 2장', '해군 재무관으로 갤리온을 낮고 빠르게 고친 기록'),
  ] },
  { id: 'medina', year: '1550 – 1615', lines: [
    L('바다에 조금 나가 본 경험으로도, 저는 늘 뱃멀미를 합니다.', '메디나 시도니아가 펠리페 2세에게 보낸 편지, 1588년 2월 (Mattingly 1959)'),
  ] },
  { id: 'recalde', year: '1526 – 1588', lines: [
    L('적이 항구 안에 있을 때 쳐야 합니다.', 'Martin & Parker 1988, 9장', '플리머스 앞 군사회의에서 공격을 주장한 기록'),
  ] },
  { id: 'leyva', year: '? – 1588', lines: [
    L('라타호가 선봉에 선다. 적의 배에 붙어 올라탄다.', 'Martin & Parker 1988, 9장', '선봉을 맡아 접전과 등선을 노린 기록'),
  ] },
  { id: 'oquendo', year: '1524 – 1588', lines: [
    L('기푸스코아 전대는 기함을 홀로 두지 않는다.', 'Mattingly 1959, 26장', '그라블린에서 기함 곁을 지킨 기록'),
  ] },
  // 1571, the Holy League and the Ottomans
  { id: 'donjuan', year: '1547 – 1578', lines: [
    L('여기서 이기든가 죽든가 하라.', 'Capponi 2006, 12장'),
  ] },
  { id: 'venier', year: '1496 – 1578', lines: [
    L('일흔이 넘었어도 쇠뇌는 아직 당길 수 있다.', 'Capponi 2006, 12장', '일흔다섯의 나이에 갑판에서 쇠뇌를 쏘았다는 기록'),
  ] },
  { id: 'barbarigo', year: '1516 – 1571', lines: [
    L('얼굴을 가리면 내 명령이 들리지 않는다.', 'Capponi 2006, 12장', '투구 가리개를 올리고 지휘하다 화살에 맞았다는 기록'),
  ] },
  { id: 'doria', year: '1539 – 1606', lines: [
    L('울루치 알리가 바다 쪽으로 돈다. 우리도 바깥으로 간다.', 'Guilmartin 2003 · Capponi 2006', '우익을 바깥으로 벌려 울루치 알리를 따라간 기록'),
  ] },
  { id: 'alipasha', year: '? – 1571', lines: [
    L('오늘 이기면 너희를 풀어 주겠다. 지면 신이 너희에게 주신 것이다.', 'Capponi 2006 · Konstam 2003 (기독교도 노잡이에게 한 말로 전함)'),
  ] },
  { id: 'pertev', year: '? – 1572', lines: [
    L('병사를 갤리선에 태워라. 갑판 위에서 결판낸다.', 'Capponi 2006, 11장', '원정군 총사령관으로 병력을 함대에 실은 기록'),
  ] },
  { id: 'uluc', year: '1500 – 1587', lines: [
    L('바다는 넓다. 끝까지 남는 자가 이긴다.', 'Capponi 2006, 12장', '몰타 기함을 잡고 갤리선을 이끌고 빠져나간 기록'),
  ] },
  { id: 'siroco', year: '? – 1571', lines: [
    L('해안에 붙어 저들의 옆구리를 돌아라.', 'Capponi 2006, 12장', '우익을 이끌고 해안 쪽으로 베네치아 좌익을 돌아 들어간 기록'),
  ] },
];

const BY_ID = new Map(INTROS.map((i) => [i.id, i]));

/** Who serves which navy, as the intro's eyebrow names it. */
export const NAVY_LABEL: Record<GrandFaction, string> = {
  joseon: '조선 수군', japan: '일본 수군', ming: '명군',
  england: '잉글랜드 해군', spain: '에스파냐 무적함대', holyleague: '신성동맹 함대', ottoman: '오스만 함대',
} as Record<GrandFaction, string>;

export type IntroView = CommanderIntro & { name: string; title: string; portrait: string; faction: GrandFaction };

/** A commander's intro with his name, title and portrait from the campaign roster; null when he has none. */
export function introOf(id: string): IntroView | null {
  const intro = BY_ID.get(id);
  const c = COMMANDERS.find((x) => x.id === id);
  if (!intro || !c) return null;
  return { ...intro, name: c.name, title: c.title, portrait: c.portrait, faction: c.faction };
}

/** The commander a battle's cutscene names by his Korean name (or surname), for the first-feature name plate. */
export function introByName(name: string): IntroView | null {
  const c = COMMANDERS.find((x) => x.name === name) ?? COMMANDERS.find((x) => x.name.split(' ').slice(-1)[0] === name);
  return c ? introOf(c.id) : null;
}

export const allIntroIds = () => INTROS.map((i) => i.id);

/** Seconds of the film: the reveal and name card, then each line. */
export const INTRO_TIMING = { nameAt: 1.2, nameDur: 4.6, firstLine: 5.4, lineDur: 3.9, tail: 1.2 };
export const introLength = (i: CommanderIntro) => INTRO_TIMING.firstLine + i.lines.length * INTRO_TIMING.lineDur + INTRO_TIMING.tail;

const SEEN_KEY = 'imjin.introduced';

function seen(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

/** Whether `id`'s opening has been shown on this device. */
export const introduced = (id: string) => seen().has(id);

export function markIntroduced(id: string) {
  try {
    const s = seen();
    s.add(id);
    localStorage.setItem(SEEN_KEY, JSON.stringify([...s]));
  } catch {
    // Private mode: he is introduced again next time.
  }
}

/** The battle films' setting (Cinema's `imjin.cutscenes`): intros and openings follow it. */
export function filmsOn() {
  try {
    return localStorage.getItem('imjin.cutscenes') !== '0';
  } catch {
    return true;
  }
}
