import { anchorsFor, modelKind, type ModelKind, type ShipAnchors, type V3 } from '../../ships/anchors';
import type { GunType, ShipKind } from '../../sim/types';

// The labelled parts of each model and the places a camera can stand on its deck. Positions are read from the
// runtime anchors (ship space: +X bow, +Y up, +Z starboard, metres from the waterline amidships), so a label follows
// the model when its plan changes, and an aliased kind gets its model's parts at its own scale.

/** The side of the hull a two-sided part is shown on: -1 port (-Z), 1 starboard (+Z). */
export type Side = -1 | 1;

export type Part = {
  id: string;
  label: string;
  note: string;
  /** Where the part is on side `side`, or null when this kind has none (an alias without the model's guns). */
  at: (a: ShipAnchors, side: Side) => V3 | null;
};

/** A standpoint on deck: the eye in ship space and the heading it first looks along (0 to the bow, pi to the stern). */
export type DeckView = { label: string; eye: V3; yaw: number };

const EYE = 1.65;
const lift = (p: V3 | null | undefined, y: number, x = 0): V3 | null => (p ? [p[0] + x, p[1] + y, p[2]] : null);
const portSide = (side: Side) => (side < 0 ? 0 : 1);

/** The middle one of a list, so a label sits amidships rather than at an end. */
const middle = <T,>(list: T[]) => list[Math.floor((list.length - 1) / 2)];

function gun(type: GunType | null) {
  return (a: ShipAnchors, side: Side): V3 | null => {
    const ports = a.gunPorts.filter((g) => g.side === portSide(side) && (!type || g.gun === type));
    const p = middle(ports)?.pos;
    return p ? [p[0], p[1], p[2] + side * 0.35] : null;
  };
}

function oars(a: ShipAnchors, side: Side): V3 | null {
  const p = middle(a.oarPorts.filter((o) => o.side === portSide(side)))?.pos;
  return p ? [p[0], p[1] - 0.35, p[2] + side * 1.4] : null;
}

/** The bulwark above the deck edge, `up` metres over the boarding point amidships. */
function wall(up: number) {
  return (a: ShipAnchors, side: Side): V3 | null => lift(middle(a.boardingPoints.filter((b) => b.side === portSide(side)))?.pos, up);
}

/** A point `frac` of the way up the first mast, from the main deck to its top. */
function sail(frac: number) {
  return (a: ShipAnchors): V3 | null => {
    const top = a.mastTops[0];
    return top ? [top[0], a.mainDeck + (top[1] - a.mainDeck) * frac, top[2]] : null;
  };
}

/** Halfway up the first flag of a kind. */
function flag(kind: ShipAnchors['flagMounts'][number]['kind']) {
  return (a: ShipAnchors): V3 | null => {
    const f = a.flagMounts.find((m) => m.kind === kind);
    return f ? [f.pos[0], f.pos[1] + f.size[1] * 0.5, f.pos[2]] : null;
  };
}

/** The painted eye on the bow of a Chinese ship, low on the side a little aft of the stem. */
function bowEye(a: ShipAnchors, side: Side): V3 {
  const x = a.length * 0.5 - a.length * 0.07;
  return [x, a.mainDeck * 0.7, side * (a.deckBounds.halfBeam(x) + 0.45)];
}

const COMMAND_DECK: Part['at'] = (a) => lift(a.commandDeck, 2);

const PARTS: Record<ModelKind, Part[]> = {
  panokseon: [
    { id: 'jangdae', label: '장대(將臺)', note: '위층 갑판에 높이 세운 지휘소입니다. 장수가 여기서 깃발과 북으로 함대를 지휘했습니다.', at: COMMAND_DECK },
    { id: 'upper', label: '상장 갑판(上粧)', note: '배 안 갑판 위에 다시 꾸민 위층 갑판입니다. 사부와 포수가 여기서 싸우고, 격군은 아래층에서 노를 저었습니다.', at: (a) => [a.length * 0.22, a.mainDeck + 0.4, 0] },
    { id: 'shields', label: '방패판(防牌板)', note: '위층 갑판 둘레에 두른 널빤지 벽입니다. 몸을 가리고 그 사이로 총통과 활을 쏘았습니다.', at: wall(1.3) },
    { id: 'guns', label: '포혈과 총통', note: '방패판에 뚫은 포혈로 천자·지자·현자·황자총통을 쏘았습니다. 일본 함선보다 훨씬 많은 화포를 실은 것이 판옥선의 힘이었습니다.', at: gun(null) },
    { id: 'oars', label: '노와 격군', note: '노는 아래층에서 저었습니다. 격군은 위층 갑판 아래에 있어 화살과 조총에 드러나지 않았습니다.', at: oars },
    { id: 'sail', label: '돛', note: '가로 살대를 댄 돛입니다. 바람이 좋을 때 쓰고, 싸울 때는 주로 노로 움직였습니다.', at: sail(0.62) },
  ],
  geobukseon: [
    { id: 'head', label: '용머리(龍頭)', note: '용머리의 입을 총구멍으로 썼습니다. 1795년 『이충무공전서』는 통제영 거북선의 용머리에서 연기를 뿜는다고 적었습니다.', at: (a) => lift(a.smokeStack, 0.5, -0.4) },
    { id: 'roof', label: '덮개와 칼송곳', note: '등은 판자로 덮고 십자 모양의 좁은 길만 남긴 채 칼과 송곳을 꽂았습니다. 싸울 때는 거적으로 덮어 감추었습니다.', at: (a) => lift(a.fireSpots[0], 0.6) },
    { id: 'ports', label: '총구멍', note: '좌우에 총구멍이 여섯 개씩 있었습니다. 군사들은 덮개 아래에서 밖을 내다보며 쏘았습니다.', at: gun(null) },
    { id: 'oars', label: '노', note: '노는 덮개 아래에서 저었습니다. 1795년 그림의 거북선은 좌우에 노가 8~10개씩 있었습니다.', at: oars },
    { id: 'tail', label: '거북 꼬리', note: '뒤에는 거북 꼬리를 만들고 그 아래에도 총구멍을 두었습니다.', at: (a) => lift(a.stern, 0.4, 0.8) },
  ],
  hyeopseon: [
    { id: 'gun', label: '승자총통', note: '게임의 협선은 뱃전에 승자총통을 겁니다. 승자총통은 손에 들고도 쏘던 소형 총통입니다.', at: gun('seungja') },
    { id: 'wall', label: '방패판', note: '낮은 방패판을 둘러 노 젓는 사람을 가렸습니다.', at: wall(0.45) },
    { id: 'oars', label: '노', note: '양쪽에 노가 네 개씩 있습니다. 판옥선보다 훨씬 가벼워 빠르게 오갔습니다.', at: oars },
    { id: 'sail', label: '돛', note: '가로 살대를 댄 돛 하나를 달았습니다.', at: sail(0.6) },
  ],
  atakebune: [
    { id: 'castle', label: '총야구라와 누각', note: '갑판을 덮은 상자 모양의 총야구라 위에 누각을 여러 층 올렸습니다. 성을 닮아 ‘바다 위의 성’이라 불렸습니다.', at: COMMAND_DECK },
    { id: 'walls', label: '다테이타(楯板)와 총안', note: '두꺼운 나무 방패벽입니다. 사마(狭間)라 부르는 총안으로 조총과 활을 쏘았고, 배를 붙일 때는 앞으로 넘어뜨려 건너가는 다리로 썼습니다.', at: wall(0.9) },
    { id: 'ozutsu', label: '대통(大筒)', note: '배에 실은 화포는 몇 문에 그쳤습니다. 일본 수군은 조총과 도선으로 승부를 내려 했습니다.', at: gun('ozutsu') },
    { id: 'oars', label: '노(櫓)', note: '선체 양쪽으로 노를 내밀어 저었습니다. 큰 배는 노가 100개를 넘었습니다.', at: oars },
    { id: 'sail', label: '돛', note: '짚을 엮어 만든 돛 하나를 달았습니다. 싸울 때는 돛을 내리고 노로 움직였습니다.', at: sail(0.6) },
    { id: 'nobori', label: '노보리(幟)', note: '가문의 문장을 넣은 세로 깃발입니다. 어느 다이묘의 배인지 멀리서도 알아볼 수 있었습니다.', at: flag('nobori') },
  ],
  sekibune: [
    { id: 'walls', label: '다테이타와 총안', note: '배 둘레를 나무 방패벽으로 두르고 총안을 냈습니다.', at: wall(0.8) },
    { id: 'cabin', label: '야구라(矢倉)', note: '갑판 위의 작은 선실로, 지휘하는 곳이었습니다.', at: (a) => lift(a.lanterns[0], 0.5) },
    { id: 'bow', label: '뱃머리', note: '뾰족한 뱃머리가 물을 갈라 아타케부네보다 빨랐습니다.', at: (a) => lift(a.bow, 0.5, -0.6) },
    { id: 'oars', label: '노(櫓)', note: '노는 40~80개였습니다. 싸울 때는 돛대를 눕히고 노로만 움직였습니다.', at: oars },
    { id: 'nobori', label: '노보리(幟)', note: '가문의 문장을 넣은 세로 깃발입니다.', at: flag('nobori') },
  ],
  kobaya: [
    { id: 'hull', label: '낮은 반벽', note: '총야구라 없이 낮은 반벽만 두른 트인 배입니다. 가볍고 빨랐지만 방어는 약했습니다.', at: wall(0.4) },
    { id: 'oars', label: '노(櫓)', note: '노는 대개 40개 이하였습니다.', at: oars },
    { id: 'nobori', label: '노보리(幟)', note: '긴 장대에 단 노보리로 소속을 알렸습니다.', at: flag('nobori') },
  ],
  mingship: [
    { id: 'castle', label: '고물 누각(柁樓)', note: '고물에 높이 올린 누각입니다. 『주해도편』은 복선 고물에 3층 누각을 두었다고 적었습니다.', at: COMMAND_DECK },
    { id: 'eye', label: '뱃머리 눈', note: '중국 배는 뱃머리 양옆에 눈을 그려 넣었습니다.', at: bowEye },
    { id: 'folangji', label: '불랑기포', note: '화약과 탄을 넣은 자포를 갈아 끼워 연달아 쏘는 후장식 화포입니다.', at: gun('folangji') },
    { id: 'hudun', label: '호준포', note: '산탄을 쏘는 가벼운 화포입니다. 가까이 다가온 적을 쓸어 냈습니다.', at: gun('hudun') },
    { id: 'sails', label: '정크 돛', note: '살대를 촘촘히 댄 돛입니다. 돛을 비스듬히 돌려 옆바람도 받았습니다.', at: sail(0.6) },
  ],
  mingsmall: [
    { id: 'hull', label: '평평한 바닥', note: '바닥이 평평하고 물에 얕게 잠겨, 모래톱에 얹혀도 기울지 않았습니다.', at: (a, side) => [0, 0.35, side * (a.deckBounds.halfBeam(0) + 0.5)] },
    { id: 'eye', label: '뱃머리 눈', note: '중국 배는 뱃머리 양옆에 눈을 그려 넣었습니다.', at: bowEye },
    { id: 'folangji', label: '불랑기포', note: '화약과 탄을 넣은 자포를 갈아 끼워 연달아 쏘는 후장식 화포입니다.', at: gun('folangji') },
    { id: 'sails', label: '정크 돛', note: '살대를 댄 돛 두 개를 달았습니다.', at: sail(0.6) },
    { id: 'oars', label: '노', note: '바람이 없을 때는 노를 저었습니다.', at: oars },
  ],
};

/** The anchors a kind is drawn and labelled with: its own, or its model's scaled to it. */
export const anchorsOf = (kind: ShipKind, variant = 0) => anchorsFor(`${kind}#${variant}`)!;

/** The parts this kind shows: its model's, less those it lacks. */
export function partsOf(kind: ShipKind, variant = 0): Part[] {
  const a = anchorsOf(kind, variant);
  return PARTS[modelKind(kind)].filter((p) => p.at(a, 1) !== null);
}

/** Models whose command deck is an open pavilion a camera can stand in; the atakebune's sits inside its castle walls. */
const OPEN_COMMAND: readonly ModelKind[] = ['panokseon', 'mingship'];

/**
 * Where a camera can stand on deck: the open command pavilion when there is one, then the stern and the bow. The turtle
 * ship has no open deck, so its view is from the ridge of the roof, looking over the dragon head.
 */
export function deckViews(kind: ShipKind, variant = 0): DeckView[] {
  const a = anchorsOf(kind, variant);
  const model = modelKind(kind);
  if (model === 'geobukseon') {
    const ridge = a.fireSpots[2] ?? a.fireSpots[0]!;
    // Off the centreline: the mast stands there and would fill the view.
    return [{ label: '덮개 위', eye: [ridge[0], ridge[1] + EYE + 0.3, 2.2], yaw: 0 }];
  }
  const views: DeckView[] = [];
  if (a.commandDeck && OPEN_COMMAND.includes(model)) views.push({ label: '지휘소', eye: [a.commandDeck[0], a.commandDeck[1] + EYE, 0], yaw: 0 });
  else views.push({ label: '고물', eye: [a.deckBounds.x0 + 1.2, a.mainDeck + EYE, 0], yaw: 0 });
  views.push({ label: '뱃머리', eye: [a.deckBounds.x1 - 1, a.mainDeck + EYE, 0], yaw: Math.PI });
  return views;
}
