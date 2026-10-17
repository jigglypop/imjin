import { at, commander, first, flagship, fleet } from '../subjects';
import type { Scene } from '../types';
import { closeUp, home, order } from './shots';

/**
 * The openings of Hansan and Myeongnyang (src/cinema/SOURCES.md): the sea and the title, the side's commander close on
 * his deck, the enemy commander in the reverse shot, the order, the fleet, the hand-off. Quoted lines carry their record;
 * a line marked `note` is written in character from what the records say the man did.
 */

const yi = first(commander('이순신'), flagship('joseon', 'joseon'));
const joseon = fleet('joseon');
const japan = fleet('japan');

const wakisaka = first(commander('와키자카 야스하루'), flagship('japan'));

export const HANSAN_INTRO: Scene = {
  id: 'hansan-intro',
  fadeIn: 2.2,
  castLight: 'day',
  cast: {
    yi: { file: 'yi__yi_tongjesa', weapon: 'joseon_hwando', ship: yi, facing: japan, portrait: 'portrait_yi' },
    wakisaka: { file: 'wakisaka__wakisaka_shichihon', weapon: 'japan_tachi', ship: wakisaka, facing: joseon, portrait: 'portrait_wakisaka' },
  },
  shots: [
    // Ahead of the Japanese fleet as it comes out of the narrows after the decoys, looking back at it: the title.
    { dur: 8.5, cam: { type: 'orbit', at: at(japan, { toward: joseon }), yaw: [0.16, 0.3], pitch: [0.035, 0.05], dist: [600, 500], lift: 10 }, fov: 30 },
    closeUp('yi', yi, 7.5, -1),
    closeUp('wakisaka', wakisaka, 7, 1),
    closeUp('yi', yi, 4, -1),
    order(yi, japan, 4.5),
    // High behind the Korean line, the crane's wing opening toward the Japanese fleet.
    { dur: 7.5, cam: { type: 'orbit', at: at(joseon, { toward: japan }), offset: [250, 0, 0], yaw: [Math.PI + 0.35, Math.PI + 0.2], pitch: [0.3, 0.36], dist: [1500, 1700], lift: 10 }, fov: 34 },
    home(at(joseon)),
  ],
  captions: [
    { kind: 'stamp', at: 0.8, dur: 6.4, when: '1592년 음력 7월 8일', where: '견내량 · 한산도 앞바다' },
    { kind: 'title', at: 2.2, dur: 5.8, eyebrow: '1592 · 임진년 여름', title: '한산도 대첩', hanja: '閑山島大捷' },
    {
      kind: 'say', at: 9.2, dur: 5.8, cast: 'yi', side: 'joseon', who: '이순신', role: '전라좌도 수군절도사',
      text: '견내량은 좁고 암초가 많아 판옥선이 싸우기 어렵다. 적을 큰 바다로 꾀어내어 모조리 잡으리라.',
      source: '이순신 장계 「견내량파왜병장」', note: '장계에 적은 계책을 그의 말로 옮김',
    },
    {
      kind: 'say', at: 16.4, dur: 5.4, cast: 'wakisaka', side: 'japan', who: '와키자카 야스하루', role: '일본 수군 장수 · 대선 36척, 중선 24척, 소선 13척',
      text: '구키와 가토를 기다릴 것 없다. 조선 수군은 우리가 친다.',
      source: '『脇坂記』 · 일본 측 기록', note: '구키·가토보다 먼저 홀로 출진했다는 기록에 따른 대사',
    },
    {
      kind: 'say', at: 23.4, dur: 4.6, cast: 'yi', side: 'joseon', who: '이순신', role: '',
      text: '학익진을 펼쳐라. 일시에 나아가라!', hanja: '鶴翼列陣 一時齊進',
      source: '이순신 장계 「견내량파왜병장」', note: '장계의 기록을 명령으로 옮김',
    },
    { kind: 'label', at: 28.6, dur: 6, target: at(joseon), text: '조선 수군', sub: '이순신 · 이억기 · 원균', side: 'joseon' },
    { kind: 'label', at: 29, dur: 5.6, target: at(wakisaka), text: '일본 함대', sub: '와키자카 야스하루', side: 'japan' },
  ],
  cues: [
    { kind: 'hush', at: 0, depth: 0.3 },
    { kind: 'drums', at: 24.2, count: 1 },
    { kind: 'drums', at: 28.4, count: 4 },
    { kind: 'hush', at: 35, depth: 0 },
  ],
};

const kurushima = first(commander('구루시마 미치후사'), commander('도도'), flagship('japan'));

export const MYEONGNYANG_INTRO: Scene = {
  id: 'myeongnyang-intro',
  fadeIn: 2.2,
  castLight: 'overcast',
  cast: {
    yi: { file: 'yi__yi_tongjesa', weapon: 'joseon_hwando', ship: yi, facing: japan, portrait: 'portrait_yi' },
    kurushima: { file: 'kurushima__japan_oyoroi', weapon: 'japan_katana', ship: kurushima, facing: yi, portrait: 'portrait_kurushima' },
  },
  shots: [
    // Ahead of the 133 ships as the flood carries them into the strait.
    { dur: 8.5, cam: { type: 'orbit', at: at(japan, { toward: yi }), yaw: [0.22, 0.08], pitch: [0.03, 0.04], dist: [760, 650], lift: 10 }, fov: 30 },
    closeUp('yi', yi, 8.5, -1),
    closeUp('kurushima', kurushima, 7, 1),
    order(yi, japan, 4.5),
    // Behind the lone flagship, rowing toward the fleet.
    { dur: 7, cam: { type: 'orbit', at: at(yi, { toward: japan }), yaw: [Math.PI + 0.3, Math.PI + 0.16], pitch: [0.05, 0.07], dist: [95, 125], lift: [6, 10] }, fov: 30 },
    home(at(yi)),
  ],
  captions: [
    { kind: 'stamp', at: 0.8, dur: 6.4, when: '1597년 음력 9월 16일 · 아침', where: '명량 (울돌목) · 판옥선 13척, 일본 함선 133척' },
    { kind: 'title', at: 2.2, dur: 5.8, eyebrow: '1597 · 정유년 가을', title: '명량 해전', hanja: '鳴梁海戰' },
    {
      kind: 'say', at: 9.2, dur: 3.9, cast: 'yi', side: 'joseon', who: '이순신', role: '삼도수군통제사 · 전날 장수들에게',
      text: '죽고자 하면 살고, 살고자 하면 죽는다.', hanja: '必死則生 必生則死', source: '『난중일기』 정유년 9월 15일',
    },
    {
      kind: 'say', at: 13.3, dur: 3.9, cast: 'yi', side: 'joseon', who: '이순신', role: '삼도수군통제사 · 전날 장수들에게',
      text: '한 사람이 길목을 지키면 천 명도 두렵게 할 수 있다.', hanja: '一夫當逕 足懼千夫', source: '『난중일기』 정유년 9월 15일',
    },
    {
      kind: 'say', at: 17.8, dur: 5.6, cast: 'kurushima', side: 'japan', who: '구루시마 미치후사', role: '일본 수군 선봉장',
      text: '물살이 우리를 민다. 단숨에 물목을 넘어라.',
      source: '일본 측 기록 (ja.wikipedia 「鳴梁海戦」)', note: '이날 선봉으로 울돌목에 들어왔다가 전사했다는 기록에 따른 대사',
    },
    {
      kind: 'say', at: 24.3, dur: 4.2, cast: 'yi', side: 'joseon', who: '이순신', role: '',
      text: '노를 재촉하라. 앞으로 나아간다!', hanja: '促櫓突前',
      source: '『난중일기』 정유년 9월 16일', note: '일기의 "내가 노를 재촉해 앞으로 나아갔다"를 명령으로 옮김',
    },
    { kind: 'label', at: 29, dur: 5.6, target: at(japan), text: '일본 함대', sub: '도도 다카토라 · 구루시마 미치후사 · 와키자카 야스하루', side: 'japan' },
  ],
  cues: [
    { kind: 'hush', at: 0, depth: 0.3 },
    { kind: 'drums', at: 24.6, count: 1 },
    { kind: 'drums', at: 29, count: 4 },
    { kind: 'hush', at: 35, depth: 0 },
  ],
};
