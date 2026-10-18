import type { TheatreId } from '../sim/grand/types';

/**
 * The campaigns' openings: a short documentary over the campaign's own 3D map, as strategy games open (one short line
 * per shot, the date and place stamped in --font-title, a strong closing title). 45–75 s, skippable, music and sound
 * only. Every line is a recorded fact; its record is in `source` and in src/cinema/SOURCES.md. Presentation only.
 *
 * A camera is a place (lon/lat), how far the eye stands (map frame units: the frame is 1 wide), its turn (0 looks
 * north) and its pitch (radians above the ground; low is cinematic, the map clamps it to 0.2..1.45).
 */
export type MapEye = { lon: number; lat: number; dist: number; yaw: number; pitch: number };
export type OpeningShot = { dur: number; from: MapEye; to: MapEye; when?: string; where?: string; line?: string; source?: string };
export type CampaignOpening = { theatre: TheatreId; shots: OpeningShot[]; title: { eyebrow: string; title: string; hanja?: string; sub?: string; source?: string; dur: number } };

const E = (lon: number, lat: number, dist: number, yaw: number, pitch: number): MapEye => ({ lon, lat, dist, yaw, pitch });

export const CAMPAIGN_OPENINGS: Record<'imjin' | 'armada' | 'lepanto' | 'trafalgar', CampaignOpening> = {
  imjin: {
    theatre: 'imjin',
    shots: [
      { dur: 8, from: E(129.88, 33.6, 0.16, 0.5, 0.3), to: E(129.8, 33.7, 0.1, 0.25, 0.24), when: '1592년 봄', where: '히젠 나고야성', line: '15만이 넘는 군사가 바다를 건널 채비를 마쳤다.', source: '한국민족문화대백과 「임진왜란」' },
      { dur: 7.5, from: E(129.3, 34.4, 0.3, 0.9, 0.36), to: E(129.15, 34.85, 0.22, 0.6, 0.3), when: '1592년 음력 4월 13일', where: '쓰시마 · 부산 앞바다', line: '고니시 유키나가의 제1군이 부산 앞바다에 닿았다.', source: '유성룡 『징비록』 권1' },
      { dur: 7, from: E(129.05, 35.1, 0.09, -0.4, 0.34), to: E(129.08, 35.17, 0.06, -0.15, 0.28), when: '4월 14일 – 15일', where: '부산진 · 동래성', line: '부산진과 동래성이 이틀 만에 무너졌다.', source: '유성룡 『징비록』 권1' },
      { dur: 7, from: E(128.6, 35.2, 0.32, 0, 0.22), to: E(128.6, 35.35, 0.4, 0, 0.2), when: '5월 3일', where: '한성', line: '왜군은 스무날 만에 도성에 들어갔다.', source: '『선조수정실록』 1592년 5월 · 『징비록』 권1' },
      { dur: 8, from: E(127.6, 34.6, 0.12, 2.6, 0.32), to: E(127.75, 34.72, 0.07, 2.9, 0.26), when: '전라좌수영', where: '여수', line: '그러나 이순신은 이미 거북선에 포를 쏘아 시험해 두었다.', source: '『난중일기』 임진년 4월 12일' },
      { dur: 7.5, from: E(128.6, 34.75, 0.12, -0.6, 0.3), to: E(128.7, 34.88, 0.08, -0.9, 0.26), when: '5월 7일', where: '옥포', line: '첫 출전에서 적선 스물여섯 척을 깨뜨렸다.', source: '이순신 장계 「옥포파왜병장」' },
      { dur: 8, from: E(128.35, 34.6, 0.18, 0.4, 0.3), to: E(128.48, 34.75, 0.12, 0.7, 0.26), when: '7월 8일', where: '한산도 앞바다', line: '바다와 뭍으로 서쪽을 치려던 적은 이 한 싸움으로 한 팔을 잃었다.', source: '유성룡 『징비록』 권1 "賴此一戰 遂斷其一臂"' },
    ],
    title: { eyebrow: '1592 – 1598', title: '임진왜란', hanja: '壬辰倭亂', sub: '칠 년 전쟁, 바다를 지킨 자들', dur: 8.5 },
  },
  armada: {
    theatre: 'armada',
    shots: [
      { dur: 8, from: E(-6.5, 48.2, 0.5, Math.PI, 0.26), to: E(-6, 48.5, 0.4, Math.PI - 0.2, 0.22), when: '1588년 5월', where: '리스본', line: '무적함대 130척이 리스본을 떠나 북쪽으로 향했다.', source: 'Martin & Parker 1988' },
      { dur: 7.5, from: E(-5.4, 49.7, 0.14, 0.6, 0.3), to: E(-5.2, 49.95, 0.09, 0.3, 0.25), when: '7월 29일', where: '리저드 곶', line: '돛이 보이자 해안을 따라 봉화가 차례로 올랐다.', source: 'Mattingly 1959, 19–20장' },
      { dur: 7.5, from: E(-4.4, 50.1, 0.12, -0.5, 0.3), to: E(-4.15, 50.3, 0.08, -0.2, 0.25), when: '7월 31일', where: '플리머스', line: '하워드와 드레이크가 바람 위로 나와 초승달 진형을 뒤쫓았다.', source: 'Mattingly 1959, 21장' },
      { dur: 7.5, from: E(-2.6, 50.3, 0.2, 0.2, 0.26), to: E(-1.3, 50.5, 0.2, 0.5, 0.24), when: '8월 2일 – 4일', where: '포틀랜드 · 와이트섬', line: '해협을 따라 쫓고 쫓기는 포격전이 이어졌다.', source: 'Mattingly 1959, 22–23장' },
      { dur: 7.5, from: E(1.6, 50.8, 0.1, -0.8, 0.3), to: E(1.85, 50.95, 0.07, -1.1, 0.25), when: '8월 7일 밤', where: '칼레', line: '불붙은 배 여덟 척이 닻을 내린 함대 쪽으로 흘러들었다.', source: 'Mattingly 1959, 25장' },
      { dur: 7.5, from: E(2.0, 51.1, 0.12, 0.9, 0.28), to: E(2.2, 51.2, 0.16, 1.2, 0.24), when: '8월 8일', where: '그라블린', line: '흩어진 함대는 바람 아래에서 포위되었다.', source: 'Mattingly 1959, 26장' },
      { dur: 8, from: E(-6, 56.5, 0.7, 0.2, 0.32), to: E(-7, 56, 0.85, 0.35, 0.3), when: '1588년 가을', where: '스코틀랜드 · 아일랜드', line: '함대는 북쪽으로 돌아갔고, 많은 배가 폭풍 속에 돌아오지 못했다.', source: 'Martin & Parker 1988' },
    ],
    title: { eyebrow: '1588', title: '아르마다', sub: 'Flavit et dissipati sunt', source: '1588년 승전 기념 메달의 글 "바람이 불어 그들이 흩어졌다"', dur: 8.5 },
  },
  lepanto: {
    theatre: 'lepanto',
    shots: [
      { dur: 8, from: E(27.5, 35.2, 0.4, -1.4, 0.24), to: E(28.5, 35.4, 0.45, -1.55, 0.22), when: '1570년 7월', where: '키프로스', line: '오스만 제국이 베네치아의 섬 키프로스에 상륙했다.', source: 'Capponi 2006' },
      { dur: 7.5, from: E(12.6, 41.7, 0.14, 0.3, 0.3), to: E(12.5, 41.9, 0.1, 0.1, 0.25), when: '1571년 5월 25일', where: '로마', line: '교황과 에스파냐, 베네치아가 신성동맹을 맺었다.', source: 'Capponi 2006' },
      { dur: 7.5, from: E(15.4, 38.0, 0.12, -0.4, 0.3), to: E(15.55, 38.2, 0.08, -0.7, 0.25), when: '1571년 8월 – 9월', where: '메시나', line: '돈 후안 데 아우스트리아가 동맹의 갤리선을 메시나에 모았다.', source: 'Capponi 2006' },
      { dur: 7.5, from: E(28.6, 40.6, 0.14, 2.6, 0.3), to: E(28.95, 41.0, 0.1, 2.9, 0.26), when: '1571년', where: '이스탄불', line: '술탄의 함대는 파마구스타를 떨어뜨리고 서쪽으로 나아갔다.', source: 'Capponi 2006 · Guilmartin 2003' },
      { dur: 8, from: E(20.6, 38.0, 0.2, 1.2, 0.26), to: E(21.3, 38.3, 0.12, 1.4, 0.22), when: '1571년 10월 7일 아침', where: '파트라스 만 어귀', line: '양쪽 합쳐 400척이 넘는 배가 마주 섰다.', source: 'Capponi 2006 · Guilmartin 2003' },
      { dur: 7.5, from: E(21.1, 38.25, 0.08, -0.5, 0.26), to: E(21.2, 38.35, 0.05, -0.8, 0.22), when: '정오 무렵', where: '쿠르촐라리 앞바다', line: '갈레아스 여섯 척의 포가 먼저 울렸다.', source: 'Capponi 2006, 12장' },
    ],
    title: { eyebrow: '1571', title: '레판토', sub: '갤리선이 맞붙은 마지막 대해전', source: 'Guilmartin 2003', dur: 8.5 },
  },
  trafalgar: {
    theatre: 'trafalgar',
    shots: [
      { dur: 7.5, from: E(1.2, 50.4, 0.16, 0.4, 0.3), to: E(1.55, 50.7, 0.1, 0.15, 0.25), when: '1804년 – 1805년', where: '불로뉴', line: '영국을 칠 군대가 해협 건너 불로뉴에 모였다.', source: 'Corbett 1910' },
      { dur: 7.5, from: E(6.4, 42.6, 0.14, -0.5, 0.3), to: E(6.0, 43.0, 0.09, -0.2, 0.25), when: '1805년 3월 30일', where: '툴롱', line: '빌뇌브의 함대가 넬슨의 감시를 피해 툴롱을 빠져나갔다.', source: 'Corbett 1910' },
      { dur: 7.5, from: E(-6.9, 36.1, 0.12, 0.6, 0.3), to: E(-6.45, 36.4, 0.08, 0.3, 0.25), when: '4월 9일', where: '카디스', line: '그라비나의 에스파냐 함대가 카디스에서 합류했다.', source: 'Corbett 1910' },
      { dur: 7.5, from: E(-10.4, 42.6, 0.18, 1.0, 0.28), to: E(-9.8, 43.0, 0.12, 1.3, 0.24), when: '7월 22일', where: '피니스테레 곶 앞바다', line: '안개 속에서 콜더가 연합 함대와 싸워 두 척을 빼앗았다.', source: 'Corbett 1910' },
      { dur: 7.5, from: E(-8.6, 39.5, 0.4, 0.2, 0.28), to: E(-7.2, 37.6, 0.3, 0.4, 0.25), when: '8월 20일', where: '카디스', line: '연합 함대는 해협 대신 남쪽 카디스로 들어갔다.', source: 'Corbett 1910' },
      { dur: 8, from: E(-6.6, 35.8, 0.12, 0.9, 0.26), to: E(-6.2, 36.0, 0.07, 1.2, 0.22), when: '1805년 10월 21일 정오 무렵', where: '트라팔가르 곶 앞바다', line: '넬슨의 두 종대가 연합 함대 서른세 척의 전열을 꿰뚫었다.', source: 'Corbett 1910 · Adkins 2004' },
    ],
    title: { eyebrow: '1805', title: '트라팔가르', sub: '"영국은 모든 이가 제 의무를 다하기를 기대한다"', source: '넬슨의 신호, 1805년 10월 21일 (Pasco의 기록)', dur: 8.5 },
  },
};

export const openingLength = (o: CampaignOpening) => o.shots.reduce((s, x) => s + x.dur, 0) + o.title.dur;

const KEY = 'imjin.campaignOpening';

export function openingSeen(theatre: string) {
  try {
    return (localStorage.getItem(KEY) ?? '').split(',').includes(theatre);
  } catch {
    return false;
  }
}

export function markOpeningSeen(theatre: string) {
  try {
    const list = new Set((localStorage.getItem(KEY) ?? '').split(',').filter(Boolean));
    list.add(theatre);
    localStorage.setItem(KEY, [...list].join(','));
  } catch {
    // Private mode: it plays again next time.
  }
}
