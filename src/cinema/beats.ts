import type { FormationKind } from '../sim/commands';
import type { ScenarioId } from '../sim/scenarios';
import type { BattleEvent, Ship } from '../sim/types';
import { at, commander, eventShip, fleet, nearestFoe } from './subjects';
import type { Caption, SceneContext, Scene, Shot } from './types';

/**
 * In-battle beats: a sim event that is a turning point of the fight gets a documentary caption (what is happening and
 * which maneuver it is) and, while the documentary camera runs, a short shot of it. The words of a historical battle
 * come from its records where an event matches one (Chen Lin's ship boarded, Deng Zilong's ship burning); elsewhere
 * the caption explains the maneuver in plain words and claims no source.
 */

/** `ship` is the ship the beat is about: the shots' `eventShip` picks it. */
export type Beat = { key: string; priority: number; cooldown: number; once?: boolean; ship: number; scene: Scene };

type Doc = Extract<Caption, { kind: 'doc' }>;
type Text = Omit<Doc, 'kind' | 'at' | 'dur'>;

const LEN = (s: Ship | undefined) => s?.spec.length ?? 30;

/** A close shot of the event's ship and a wider one around it; `slow` for the moment a ship is lost. */
function shipShots(ctx: SceneContext, slow?: number): Shot[] {
  const s = ctx.battle.get(ctx.event);
  const L = LEN(s);
  const side = ctx.event % 2 ? 1 : -1;
  return [
    { dur: 4.6, cam: { type: 'orbit', at: at(eventShip), yaw: [side * 1.25, side * 0.95], pitch: [0.08, 0.1], dist: [L * 3.4, L * 2.8], lift: 4 }, fov: 30, slow, aperture: 0.5 },
    { dur: 3.6, cam: { type: 'orbit', at: at(eventShip, { toward: nearestFoe(eventShip) }), yaw: [side * 2.2, side * 2.0], pitch: [0.16, 0.2], dist: [L * 6, L * 6.8], lift: 6 }, fov: 34 },
  ];
}

/** The fleets from above and behind the player's side: a maneuver reads as a shape. */
function planShots(ctx: SceneContext): Shot[] {
  const own = fleet(ctx.team);
  const foe = fleet(ctx.team === 'joseon' ? 'japan' : 'joseon');
  return [{ dur: 7, cam: { type: 'orbit', at: at(own, { toward: foe }), yaw: [Math.PI + 0.2, Math.PI + 0.05], pitch: [0.62, 0.7], dist: [1300, 1150] }, fov: 36 }];
}

function beat(key: string, priority: number, cooldown: number, text: Text, shots: Shot[], once = false, ship = 0): Beat {
  return { key, priority, cooldown, once, ship, scene: { id: key, shots, captions: [{ kind: 'doc', at: 0.3, dur: 7.2, ...text }] } };
}

const FIRST: Partial<Record<ScenarioId, Text>> = {
  noryang: { tag: '전황', head: '밤새 이어진 싸움', hanja: '遇賊五百餘艘 大戰至朝', body: '사경에 노량에 이른 연합 함대는 일본 함대와 맞붙어 아침까지 싸웠다.', source: '이분 『행록』' },
  hansan: { tag: '포격', head: '총통 사격', hanja: '先破其二三隻 則諸船之倭 挫氣退遁', body: '지자·현자·승자 총통을 쏘아 먼저 두세 척을 깨뜨리자, 나머지 일본 배들이 기세가 꺾여 물러나려 했다.', source: '이순신 장계 「견내량파왜병장」' },
  myeongnyang: { tag: '기동', head: '홀로 나아간 대장선', hanja: '余促櫓突前 亂放地玄各樣銃筒 發如風雷', body: '장수들이 머뭇거리는 사이 대장선이 노를 재촉해 나아가 지자·현자 총통을 바람과 우레처럼 쏘았다.', source: '『난중일기』 정유년 9월 16일' },
};

const BROKEN: Partial<Record<ScenarioId, Text>> = {
  noryang: { tag: '전황', head: '무너진 일본 함대', body: '일본 함대가 무너져 달아나기 시작했다. 일부는 관음포 쪽으로 밀려 들어갔다고 전한다.', source: '이분 『행록』 · 한국민족문화대백과' },
  hansan: { tag: '전황', head: '달아나는 적', hanja: '促櫓逃遁', body: '남은 일본 배 14척은 노를 재촉해 달아났고, 400여 명은 한산도에 올랐다.', source: '이순신 장계 「견내량파왜병장」' },
  myeongnyang: { tag: '전황', head: '물러나는 적', hanja: '賊不能抵當', body: '일본 함대가 당해 내지 못하고 물러났다. 이날 깨뜨린 적선은 서른 척이었다.', source: '『난중일기』 정유년 9월 16일' },
};

export const FORMATION_TEXT: Partial<Record<FormationKind, Text>> = {
  crane: { tag: '진형', head: '학익진', hanja: '鶴翼列陣', body: '학이 날개를 펴듯 반원으로 벌려 서서, 들어오는 적을 세 방향에서 한꺼번에 친다. 한산도에서 쓴 진형이다.', source: '이순신 장계 「견내량파왜병장」' },
  line: { tag: '진형', head: '일자진', body: '한 줄로 나란히 벌려 서서 모든 배의 뱃전 포가 적을 향하게 한다.' },
  column: { tag: '진형', head: '장사진', hanja: '長蛇突前', body: '긴 뱀처럼 한 줄로 이어 나아가 좁은 물목이나 포구를 꿰뚫는다. 부산포에서 이렇게 돌입했다.', source: '이순신 장계 「부산파왜병장」' },
  wedge: { tag: '진형', head: '쐐기 대형', body: '뾰족하게 모여 적 대열의 한가운데로 파고든다.' },
};

/** The beat a formation order starts. */
export function formationBeat(kind: FormationKind, ctx: SceneContext): Beat | null {
  const text = FORMATION_TEXT[kind];
  return text ? beat(`formation-${kind}`, 5, 40, text, planShots(ctx), false, ctx.event) : null;
}

/** State the rules keep across events: what has fired, the first gun, ships routing lately. */
export type BeatMemory = { fired: Set<string>; routing: number[] };

export function beatFor(e: BattleEvent, ctx: SceneContext, scenario: ScenarioId | null, memory: BeatMemory): Beat | null {
  const b = ctx.battle;
  const is = (pick: ReturnType<typeof commander>, id: number) => {
    const got = pick(ctx);
    return !!got && !Array.isArray(got) && got.id === id;
  };
  const chenLin = (id: number) => scenario === 'noryang' && is(commander('진린'), id);
  const deng = (id: number) => scenario === 'noryang' && is(commander('등자룡'), id);
  switch (e.type) {
    case 'gun': {
      if (memory.fired.has('first')) return null;
      const text = (scenario && FIRST[scenario]) || { tag: '전황', head: '첫 포성', body: '두 함대가 사거리에 들어와 포를 쏘기 시작했다.' };
      return beat('first', 6, 0, text, shipShots({ ...ctx, event: e.ship }), true, e.ship);
    }
    case 'board': {
      if (chenLin(e.b) || chenLin(e.a)) {
        return beat('chenlin', 9, 0, { tag: '구원', head: '도독의 배가 에워싸이다', hanja: '賊圍都督船幾陷 諸將見公船麾促 爭赴救解', body: '적이 진린의 배를 에워싸 거의 함락될 뻔했다. 이순신의 배가 깃발로 재촉하자 장수들이 다투어 구하러 갔다.', source: '이분 『행록』' }, shipShots({ ...ctx, event: chenLin(e.b) ? e.b : e.a }), true, chenLin(e.b) ? e.b : e.a);
      }
      return beat('board', 4, 70, { tag: '전술', head: '등선 백병전', body: '갈고리를 걸고 적선에 올라타 칼과 창으로 싸운다. 일본 수군이 가장 즐겨 쓴 싸움이었다. 조선 수군은 높은 뱃전과 긴 창으로 막았다.' }, shipShots({ ...ctx, event: e.b }), false, e.b);
    }
    case 'ignite':
    case 'struck':
    case 'sinking':
      if (deng(e.ship)) {
        return beat('deng', 9, 0, { tag: '전황', head: '등자룡의 최후', hanja: '他舟誤擲火器入子龍舟 舟中火 賊乘之', body: '다른 배가 잘못 던진 화기가 등자룡의 배에 떨어져 불이 났고, 적이 그 틈에 올라왔다. 일흔이 넘은 명의 노장은 여기서 전사했다.', source: '『명사』 등자룡전' }, shipShots({ ...ctx, event: e.ship }, e.type === 'sinking' ? 0.4 : undefined), true, e.ship);
      }
      return null;
    case 'hit':
      if (e.bonus === 'rake') return beat('rake', 3, 90, { tag: '포격', head: '세로 사격', body: '적선의 이물이나 고물 쪽에서 쏜 탄은 배를 길이로 꿰뚫는다. 선체와 군사가 함께 크게 다친다.' }, shipShots({ ...ctx, event: e.ship }), false, e.ship);
      if (e.bonus === 'cross') return beat('cross', 3, 90, { tag: '포격', head: '교차 사격', body: '두 방향에서 함께 쏘면 적은 한쪽 뱃전만으로 막을 수 없다. 학익진이 노리는 것이 이것이다.' }, shipShots({ ...ctx, event: e.ship }), false, e.ship);
      return null;
    case 'explode':
      return beat('explode', 5, 60, { tag: '전황', head: '화약고 폭발', body: '불이 화약에 닿으면 배가 한순간에 터져 나간다.' }, shipShots({ ...ctx, event: e.ship }, 0.35), false, e.ship);
    case 'leader': {
      if (!e.flagship) return null;
      const s = b.get(e.ship);
      if (!s) return null;
      if (scenario === 'noryang' && s.team === 'japan') {
        return beat('shimazu', 8, 0, { tag: '전황', head: '시마즈의 대장선', body: '역사에서 시마즈는 살아 돌아갔다. 일본 측 기록에 따르면 그의 배는 갈고리에 걸려 위태로웠으나 휘하 장수들이 구해 냈다.', source: '일본 측 기록 『정한록』' }, shipShots({ ...ctx, event: e.ship }, 0.4), true, e.ship);
      }
      const own = s.team === ctx.team;
      return beat(`leader-${s.team}`, 8, 0, own ? { tag: '전황', head: '대장선을 잃다', body: '지휘하던 배를 잃은 함대는 신호를 받지 못해 크게 흔들린다.' } : { tag: '전황', head: '적 대장선이 쓰러지다', body: '적의 지휘선이 싸움에서 빠졌다. 신호를 잃은 적 함대가 흔들린다.' }, shipShots({ ...ctx, event: e.ship }, 0.4), true, e.ship);
    }
    case 'broken': {
      if (e.team === ctx.team) return null;
      const text = (scenario && BROKEN[scenario]) || { tag: '전황', head: '패주', body: '사기가 꺾인 적 함대가 싸움을 버리고 달아난다.' };
      return beat(`broken-${e.team}`, 7, 0, text, shipShots({ ...ctx, event: e.ship }), true, e.ship);
    }
    case 'morale': {
      if (e.state !== 'routing') return null;
      const now = b.time;
      memory.routing = memory.routing.filter((t) => now - t < 20);
      memory.routing.push(now);
      if (memory.routing.length < 3) return null;
      const s = b.get(e.ship);
      const own = !!s && s.team === ctx.team;
      return beat(`rout-${own ? 'own' : 'foe'}`, 5, 120, own ? { tag: '사기', head: '흔들리는 아군', body: '포격과 곁의 침몰에 놀란 배들이 대열을 벗어나 달아나려 한다. 지휘선이 북을 울리면 다잡을 수 있다.' } : { tag: '사기', head: '흔들리는 적', body: '적선들이 대열을 벗어나 달아나기 시작했다. 흩어진 배는 서로를 엄호하지 못한다.' }, shipShots({ ...ctx, event: e.ship }), false, e.ship);
    }
    case 'drum':
      return beat('drum', 4, 120, scenario === 'hansan' ? { tag: '지휘', head: '북 한 번', hanja: '舜臣鳴皷一聲 諸船一齊回棹', body: '좁은 목을 나오자 북 한 번에 모든 배가 일제히 노를 돌려 바다에 벌여 섰다.', source: '유성룡 『징비록』' } : { tag: '지휘', head: '북', body: '지휘선이 북을 울려 흔들리는 배들을 다잡는다. 깃발과 북이 바다 위의 명령이었다.' }, shipShots({ ...ctx, event: e.ship }), false, e.ship);
    default:
      return null;
  }
}
