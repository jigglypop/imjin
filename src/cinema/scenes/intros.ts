import { at, commander, first, flagship, fleet } from '../subjects';
import type { Scene } from '../types';

/** The shorter openings of Hansan and Myeongnyang, from Yi's own reports and diary (src/cinema/SOURCES.md). */

const yi = first(commander('이순신'), flagship('joseon', 'joseon'));
const joseon = fleet('joseon');
const japan = fleet('japan');

export const HANSAN_INTRO: Scene = {
  id: 'hansan-intro',
  fadeIn: 2.5,
  shots: [
    { dur: 9, cam: { type: 'orbit', at: at(first(commander('와키자카 야스하루'), flagship('japan'))), yaw: [0.5, 0.88], pitch: [0.06, 0.08], dist: [135, 98], lift: 6 }, fov: 30, aperture: 0.5 },
    // Ahead of the Japanese fleet as it comes out after the decoys, looking back at it.
    { dur: 9, cam: { type: 'orbit', at: at(japan, { toward: joseon }), yaw: [0.16, 0.32], pitch: [0.035, 0.05], dist: [560, 470], lift: 10 }, fov: 32 },
    // The crane's wing from above.
    { dur: 11, cam: { type: 'orbit', at: at(fleet('joseon'), { toward: japan }), yaw: [Math.PI + 0.12, Math.PI + 0.02], pitch: [1.0, 1.12], dist: [2500, 2150] }, fov: 38 },
    { dur: 6, cam: { type: 'track', at: at(yi), from: [-36, -1.6, 23], to: [-27, -1.2, 18], look: [-5, 5.5, 0] }, fov: 30, tilt: 0.04, aperture: 0.7 },
    { dur: 8.5, cam: { type: 'orbit', at: at(yi, { toward: japan }), yaw: [Math.PI + 0.32, Math.PI + 0.16], pitch: [0.05, 0.07], dist: [95, 125], lift: [6, 10] }, fov: 30 },
  ],
  captions: [
    { kind: 'stamp', at: 1, dur: 7, when: '1592년 음력 7월 8일', where: '견내량 · 한산도 앞바다' },
    { kind: 'card', at: 3.4, dur: 5.4, who: '와키자카 야스하루', hanja: '脇坂安治', role: '일본 수군 장수 · 대선 36척, 중선 24척, 소선 13척', portrait: 'portrait_wakisaka', side: 'japan' },
    { kind: 'doc', at: 10, dur: 7.6, tag: '기동', head: '거짓 후퇴', hanja: '佯退而還', body: '판옥선 대여섯 척이 좁은 견내량의 적을 쫓다가 물러나는 척했다. 일본 함선들이 일제히 돛을 달고 넓은 바다까지 따라 나왔다.', source: '이순신 장계 「견내량파왜병장」' },
    { kind: 'label', at: 18.6, dur: 9.8, target: at(joseon), text: '조선 수군', sub: '이순신 · 이억기 · 원균', side: 'joseon' },
    { kind: 'label', at: 19, dur: 9.4, target: at(japan), text: '일본 함대', sub: '와키자카 야스하루', side: 'japan' },
    { kind: 'doc', at: 19.4, dur: 8.6, tag: '진형', head: '학익진', hanja: '鶴翼列陣 一時齊進', body: '넓은 바다에 나오자 장수들에게 학의 날개처럼 벌려 서게 하고 한꺼번에 나아가 지자·현자·승자 총통을 쏘았다.', source: '이순신 장계 「견내량파왜병장」' },
    { kind: 'card', at: 29.4, dur: 5.4, who: '이순신', hanja: '李舜臣', role: '전라좌도 수군절도사', portrait: 'portrait_yi', side: 'joseon' },
    { kind: 'title', at: 35.6, dur: 7.6, eyebrow: '1592 · 임진년 여름', title: '한산도 대첩', hanja: '閑山島大捷' },
  ],
  cues: [
    { kind: 'hush', at: 0, depth: 0.3 },
    { kind: 'drums', at: 34.6, count: 3 },
    { kind: 'drums', at: 36.8, count: 4 },
  ],
};

export const MYEONGNYANG_INTRO: Scene = {
  id: 'myeongnyang-intro',
  fadeIn: 2.5,
  shots: [
    { dur: 9, cam: { type: 'orbit', at: at(japan, { toward: yi }), yaw: [0.22, 0.06], pitch: [0.03, 0.04], dist: [760, 640], lift: 10 }, fov: 30 },
    { dur: 10, cam: { type: 'orbit', at: at(yi), yaw: [1.9, 1.4], pitch: [0.05, 0.08], dist: [92, 70], lift: 4 }, fov: 30, aperture: 0.6 },
    { dur: 9, cam: { type: 'orbit', at: at(first(commander('도도'), flagship('japan'))), yaw: [0.6, 1.0], pitch: 0.07, dist: [125, 92], lift: 5 }, fov: 30, aperture: 0.5 },
    { dur: 7, cam: { type: 'track', at: at(yi), from: [-36, -1.6, 23], to: [-27, -1.2, 18], look: [-5, 5.5, 0] }, fov: 30, tilt: 0.04, aperture: 0.7 },
    { dur: 8.5, cam: { type: 'orbit', at: at(yi, { toward: japan }), yaw: [Math.PI + 0.3, Math.PI + 0.15], pitch: [0.05, 0.07], dist: [95, 125], lift: [6, 10] }, fov: 30 },
  ],
  captions: [
    { kind: 'stamp', at: 1, dur: 7, when: '1597년 음력 9월 16일 · 아침', where: '명량 (울돌목) · 진도와 해남 사이' },
    { kind: 'doc', at: 3.4, dur: 5.6, tag: '전황', head: '열세 척', body: '칠천량에서 수군이 무너진 뒤 남은 판옥선은 열세 척이었다. 그 앞으로 일본 함선 133척이 물목을 타고 들어왔다.', source: '『난중일기』 정유년 9월 16일' },
    { kind: 'line', at: 10.6, dur: 7.6, who: '이순신', role: '삼도수군통제사', portrait: 'portrait_yi', text: '지금 신에게는 아직 열두 척의 전선이 있습니다.', hanja: '今臣戰船 尙有十二', source: '수군을 버리라는 조정에 올린 글 · 이분 『행록』' },
    { kind: 'card', at: 19.8, dur: 4.6, who: '도도 다카토라', hanja: '藤堂高虎', role: '일본 수군 장수', portrait: 'portrait_todo', side: 'japan' },
    { kind: 'card', at: 24.2, dur: 4.4, who: '구루시마 미치후사', hanja: '來島通總', role: '일본 수군 장수 · 이날 전사했다', portrait: 'portrait_kurushima', side: 'japan' },
    { kind: 'line', at: 28.6, dur: 6.6, who: '이순신', role: '전날, 장수들에게', portrait: 'portrait_yi', text: '죽고자 하면 살고, 살고자 하면 죽는다. 한 사람이 길목을 지키면 천 명도 두렵게 할 수 있다.', hanja: '必死則生 必生則死 一夫當逕 足懼千夫', source: '『난중일기』 정유년 9월 15일' },
    { kind: 'title', at: 36, dur: 7.4, eyebrow: '1597 · 정유년 가을', title: '명량 해전', hanja: '鳴梁海戰' },
  ],
  cues: [
    { kind: 'hush', at: 0, depth: 0.3 },
    { kind: 'drums', at: 35, count: 3 },
    { kind: 'drums', at: 37.2, count: 4 },
  ],
};
