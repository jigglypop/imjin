import { at, commander, first, flagship, fleet, squadron } from '../subjects';
import type { Scene } from '../types';
import { aboard, home, order } from './shots';

/**
 * Noryang, told from the records (src/cinema/SOURCES.md): the night crossing from Myodo, the moon past full and high,
 * the allied fleets, Shimazu's relief fleet; and after the battle the dawn pursuit, the bullet, the hidden death.
 * Where the records disagree the caption says so (300-odd ships in the Sillok, 500-odd in the Haengnok).
 */

const yi = first(commander('이순신'), flagship('joseon', 'joseon'));
const chen = first(commander('진린'), flagship('joseon', 'ming'));
const deng = first(commander('등자룡'), chen);
const shimazu = first(commander('시마즈'), flagship('japan'));
const joseon = fleet('joseon', 'joseon');
const ming = fleet('joseon', 'ming');
const japan = fleet('japan');
const allied = fleet('joseon');

export const NORYANG_INTRO: Scene = {
  id: 'noryang-intro',
  fadeIn: 3,
  castLight: 'night',
  cast: {
    yi: { file: 'yi__yi_tongjesa', weapon: 'joseon_hwando', ship: yi, facing: japan, portrait: 'portrait_yi' },
    chen: { file: 'chenlin__chenlin_dudok', weapon: 'ming_jian', ship: chen, facing: japan, portrait: 'portrait_chenlin' },
    deng: { file: 'deng__deng_nojang', weapon: 'ming_dao', ship: deng, facing: japan, portrait: 'portrait_deng' },
    shimazu: { file: 'shimazu__shimazu_oni', weapon: 'japan_tachi', ship: shimazu, facing: allied, portrait: 'portrait_shimazu' },
  },
  shots: [
    // The moon on a long lens over the Japanese fleet's lanterns: the title.
    { dur: 9.5, cam: { type: 'orbit', at: at(japan, 'moon'), yaw: [Math.PI + 0.05, Math.PI - 0.02], pitch: 0.012, dist: [1500, 1350], lift: 4 }, fov: [23, 21], tilt: 0.12 },
    aboard(yi, 8, -1),
    aboard(chen, 4.5, 1),
    aboard(deng, 6, -1, true),
    aboard(shimazu, 7, 1),
    order(yi, japan, 4.5),
    // Behind the flagship, low over the water, the lanterns of the Japanese fleet ahead.
    { dur: 7, cam: { type: 'orbit', at: at(yi, { toward: japan }), yaw: [Math.PI + 0.3, Math.PI + 0.14], pitch: [0.045, 0.065], dist: [92, 135], lift: [6, 10] }, fov: 30 },
    home(at(joseon)),
  ],
  captions: [
    { kind: 'stamp', at: 1.2, dur: 7, when: '1598년 음력 11월 19일 · 사경 (새벽 1~3시)', where: '노량 해협 · 남해도와 하동 사이' },
    { kind: 'title', at: 3.2, dur: 6, eyebrow: '칠 년 전쟁의 마지막 바다', title: '노량 해전', hanja: '露梁海戰', sub: '1598' },
    {
      kind: 'say', at: 10.4, dur: 6.4, cast: 'yi', side: 'joseon', who: '이순신', role: '삼도수군통제사 · 그날 밤 삼경, 배 위에서 하늘에 빌며',
      text: '이 원수를 없앨 수 있다면, 죽어도 여한이 없겠습니다.', hanja: '此讎若除 死卽無憾', source: '이분 『행록』',
    },
    { kind: 'say', at: 18, dur: 3.8, cast: 'chen', side: 'ming', who: '진린', role: '명 수군 도독 · 조선 수군과 기각을 이루어', text: '', source: '「전라좌수영대첩비」 · 『명사』 진린전' },
    {
      kind: 'say', at: 22.4, dur: 5.2, cast: 'deng', side: 'ming', who: '등자룡', role: '명 부총병 · 일흔이 넘은 노장',
      text: '늙었다 하여 뒤에 설 수는 없다. 선봉은 내가 맡겠다.',
      source: '『명사』 권247 등자룡전', note: '일흔이 넘었으나 기개가 더욱 굳세어 앞장서 공을 세우려 했다는 기록에 따른 대사',
    },
    {
      kind: 'say', at: 28.6, dur: 5.6, cast: 'shimazu', side: 'japan', who: '시마즈 요시히로', role: '사쓰마의 장수 · 일본 구원 함대',
      text: '고니시를 구한다. 노량을 뚫고 나아가라.',
      source: '『征韓録』 · 이분 『행록』', note: '순천 왜교성에 갇힌 고니시를 구하러 왔다는 기록에 따른 대사',
    },
    { kind: 'label', at: 39.2, dur: 6, target: at(joseon), text: '조선 수군', sub: '통제사 이순신', side: 'joseon' },
    { kind: 'label', at: 39.5, dur: 5.7, target: at(ming), text: '명 수군', sub: '도독 진린 · 부총병 등자룡', side: 'ming' },
    { kind: 'label', at: 39.8, dur: 5.4, target: at(squadron('시마즈')), text: '일본 함대', sub: '시마즈 요시히로', side: 'japan' },
  ],
  cues: [
    { kind: 'hush', at: 0, depth: 0.35 },
    { kind: 'drums', at: 35.4, count: 3 },
    { kind: 'drums', at: 37.6, count: 3 },
    { kind: 'drums', at: 40, count: 5 },
    { kind: 'hush', at: 45, depth: 0 },
  ],
};

export const NORYANG_OUTRO: Scene = {
  id: 'noryang-outro',
  fadeIn: 2.6,
  fadeOut: 3,
  black: [[25.6, 35.2]],
  shots: [
    // Dawn behind the fleet: hulls against the first light.
    { dur: 10, cam: { type: 'orbit', at: at(allied, 'moon'), yaw: [Math.PI - 0.32, Math.PI - 0.12], pitch: [0.035, 0.05], dist: [520, 430], lift: 8 }, fov: 26 },
    { dur: 9, cam: { type: 'track', at: at(yi), from: [-22, -1, 15], to: [-15, -0.4, 11.5], look: [-5, 5.2, 0] }, fov: 28, tilt: 0.05, aperture: 0.9 },
    // The bullet: the scene slows, the sound drops away.
    { dur: 6.6, cam: { type: 'track', at: at(yi), from: [11, 1.4, 9.5], to: [8.5, 1.8, 8.2], look: [-5, 4.8, 0] }, fov: 24, roll: [0, 0.06], slow: 0.3, aperture: 1.2 },
    { dur: 9.6, cam: { type: 'orbit', at: at(yi), yaw: [1.6, 1.5], pitch: 0.2, dist: 140 }, fov: 30 },
    { dur: 10, cam: { type: 'orbit', at: at(yi), yaw: [1.25, 0.8], pitch: [0.09, 0.11], dist: [68, 84], lift: 5 }, fov: 30, aperture: 0.6 },
    { dur: 10, cam: { type: 'orbit', at: at(chen, { toward: yi }), yaw: [0.5, 0.75], pitch: [0.07, 0.09], dist: [90, 76], lift: 5 }, fov: 30, aperture: 0.6 },
    { dur: 13, cam: { type: 'orbit', at: at(allied, 'moon'), yaw: [Math.PI - 0.7, Math.PI - 0.3], pitch: [0.16, 0.26], dist: [650, 950], lift: 10 }, fov: 34 },
    { dur: 10, cam: { type: 'orbit', at: at(allied, 'moon'), yaw: [Math.PI - 0.3, Math.PI - 0.18], pitch: [0.26, 0.3], dist: [950, 1100], lift: 10 }, fov: 32 },
  ],
  captions: [
    { kind: 'stamp', at: 2.6, dur: 7, when: '1598년 음력 11월 19일 · 여명', where: '관음포 앞바다' },
    { kind: 'doc', at: 4.6, dur: 5.6, tag: '전황', head: '추격', body: '밤새 싸운 끝에 일본 함대가 무너졌다. 날이 밝을 무렵 연합 함대는 달아나는 적을 쫓았다.', hanja: '大戰至朝', source: '이분 『행록』' },
    { kind: 'doc', at: 12, dur: 6, tag: '', head: '북소리', hanja: '皷音未衰', body: '대장선의 북소리는 아직 잦아들지 않았다.', source: '『이충무공전서』 권10' },
    { kind: 'doc', at: 19.6, dur: 5.6, tag: '', head: '날아온 탄환', hanja: '公方督戰 忽中飛丸', body: '싸움을 독려하던 이순신이 날아온 탄환에 맞았다. 『선조실록』은 몸소 활을 쏘다가 맞았다고 적었다.', source: '이분 『행록』 · 『선조실록』 1598년 11월 27일' },
    { kind: 'quote', at: 26.2, dur: 8.6, text: '싸움이 급하니, 내가 죽었다는 말을 하지 말라.', hanja: '戰方急 愼勿言我死', source: '이분 『행록』' },
    { kind: 'card', at: 35.8, dur: 6.6, who: '이완', hanja: '李莞', role: '이순신의 조카 · 곁에서 활을 잡고 있었다', portrait: 'portrait_admiral', side: 'joseon' },
    { kind: 'doc', at: 37.8, dur: 7, tag: '', head: '죽음을 숨기다', hanja: '仍麾旗督戰 如前不已', body: '맏아들 이회와 조카 이완은 울음을 삼키고 시신을 방 안으로 옮겼다. 그리고 전처럼 깃발을 흔들어 싸움을 독려했다.', source: '이분 『행록』' },
    { kind: 'line', at: 46, dur: 4.4, who: '진린', role: '명 수군 도독', portrait: 'portrait_chenlin', text: '통제사, 어서 오시오, 어서 오시오.', hanja: '統制速來速來', source: '싸움이 끝나고 · 이분 『행록』' },
    { kind: 'line', at: 50.6, dur: 4.6, who: '이완', role: '뱃머리에 서서', portrait: 'portrait_admiral', text: '숙부께서 돌아가셨습니다.', hanja: '叔父命休', source: '이분 『행록』' },
    { kind: 'doc', at: 56, dur: 6.4, tag: '', head: '진린', hanja: '旣死之後 乃能救我', body: '진린은 배 위에 세 번 쓰러지며 통곡했다. "죽은 뒤에도 나를 구했구나."', source: '이분 『행록』' },
    { kind: 'doc', at: 63.2, dur: 6.6, tag: '결과', head: '노량 해전', body: '일본 함선 200여 척이 부서지거나 불탔고, 100여 척은 남해 쪽으로 달아났다. 고니시는 그 틈에 먼 바다로 빠져나갔다. 이순신, 이영남, 방덕룡, 고득장, 그리고 명의 등자룡이 전사했다.', source: '『징비록』 · 『선조실록』 · 『명사』' },
    { kind: 'title', at: 70.2, dur: 7.2, eyebrow: '1592 – 1598', title: '노량 해전', hanja: '露梁海戰', sub: '이순신 1545 – 1598' },
  ],
  cues: [
    { kind: 'sky', at: 0.1, name: 'dawn' },
    { kind: 'hush', at: 0, depth: 0.45 },
    { kind: 'drums', at: 10.4, count: 4 },
    { kind: 'drums', at: 12.6, count: 4 },
    { kind: 'drums', at: 14.8, count: 4 },
    { kind: 'drums', at: 17, count: 3 },
    { kind: 'hush', at: 19.6, depth: 0.95 },
    { kind: 'hush', at: 35.4, depth: 0.5 },
    { kind: 'drums', at: 37.6, count: 3 },
    { kind: 'drums', at: 40, count: 3 },
  ],
};
