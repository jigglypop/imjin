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
  racegalleon: [
    { id: 'castles', label: '낮은 선루', note: '존 호킨스가 고친 "레이스 빌트" 갤리온은 앞뒤 선루를 낮추고 선체를 길고 날렵하게 만들었습니다. 바람을 거슬러 더 잘 나아갔습니다.', at: COMMAND_DECK },
    { id: 'culverin', label: '컬버린포', note: '포신이 긴 장거리 화포입니다. 영국 함대는 거리를 두고 포격하며 에스파냐 배에 접근을 허락하지 않았습니다.', at: gun('culverin') },
    { id: 'ports', label: '두 층의 포문', note: '아래 갑판과 위 갑판에 포문을 두 줄로 냈습니다. 포문 뚜껑은 싸울 때 위로 들어 올렸습니다.', at: gun(null) },
    { id: 'sails', label: '가로돛', note: '앞돛대와 큰돛대에 성 조지 십자를 그린 가로돛을, 뒤쪽 돛대에는 세모난 래틴 돛을 달았습니다.', at: sail(0.55) },
    { id: 'flag', label: '성 조지 깃발', note: '흰 바탕에 붉은 십자, 잉글랜드의 깃발입니다.', at: flag('pennant') },
  ],
  pinnace: [
    { id: 'hull', label: '작은 선체', note: '돛대 둘의 작고 빠른 배입니다. 정찰과 연락, 큰 배의 호위를 맡았습니다.', at: wall(0.6) },
    { id: 'saker', label: '세이커포', note: '가벼운 화포 몇 문만 실었습니다.', at: gun('saker') },
    { id: 'sails', label: '가로돛', note: '두 돛대에 가로돛을, 고물에 작은 래틴 돛을 달았습니다.', at: sail(0.55) },
  ],
  fireship: [
    { id: 'hull', label: '낡은 상선', note: '1588년 8월 7일 밤 칼레 앞바다에서 영국군은 낡은 상선 여덟 척에 불을 붙여 바람에 띄워 보냈습니다.', at: wall(0.6) },
    { id: 'brush', label: '나뭇단과 역청', note: '갑판에 나뭇단과 역청 통을 쌓고, 대포에는 탄을 재워 둔 채 불길 속에서 저절로 터지게 했습니다.', at: (a) => lift(a.fireSpots[0], 0.6) },
    { id: 'sails', label: '돛', note: '돛을 펴고 키를 묶어 둔 채 사람은 작은 배로 옮겨 탔습니다.', at: sail(0.55) },
  ],
  spgalleon: [
    { id: 'castles', label: '높은 선루', note: '앞뒤로 여러 층의 선루를 높이 쌓았습니다. 병사를 가득 태우고 적선에 올라타 싸우려는 배였습니다.', at: COMMAND_DECK },
    { id: 'cannon', label: '대포', note: '무거운 탄을 쏘는 짧은 대포입니다. 육지용 포가에 얹은 것이 많아 다시 장전하기가 느렸습니다.', at: gun('cannon') },
    { id: 'base', label: '선회포', note: '선루 난간에 꽂아 쓰는 작은 포로, 올라타려는 적을 쓸어 냈습니다.', at: gun('base') },
    { id: 'sails', label: '부르고뉴 십자 돛', note: '돛에는 붉은 부르고뉴 십자를, 기함의 큰 돛에는 큰 십자를 그렸습니다.', at: sail(0.55) },
    { id: 'stern', label: '고물 장식', note: '고물을 금박 조각과 성인의 그림으로 꾸몄습니다.', at: (a) => lift(a.stern, 3.5, 0.4) },
  ],
  galleass: [
    { id: 'bow', label: '뱃머리 포루', note: '높은 뱃머리 포루에 큰 대포를 앞으로 향해 놓았습니다. 갤리선과 달리 배 앞쪽으로 강한 포격을 할 수 있었습니다.', at: (a) => lift(a.fireSpots[3], 0.6) },
    { id: 'oars', label: '노와 노꾼', note: '양쪽에 노가 서른 개 남짓이었습니다. 바람이 없어도 움직일 수 있었지만 큰 선체에는 힘이 모자랐습니다.', at: oars },
    { id: 'sails', label: '래틴 돛', note: '돛대 셋에 세모난 래틴 돛을 달았습니다.', at: sail(0.6) },
    { id: 'stern', label: '고물 차양', note: '지휘하는 고물 갑판 위에 줄무늬 차양을 쳤습니다.', at: COMMAND_DECK },
  ],
  urca: [
    { id: 'hull', label: '둥근 선체', note: '배가 둥글고 넓은 발트해의 화물선입니다. 무적함대의 보급선으로 식량과 물, 말과 화약을 실었습니다.', at: wall(0.6) },
    { id: 'saker', label: '세이커포', note: '가벼운 화포 몇 문만 실어 싸움에는 약했습니다.', at: gun('saker') },
    { id: 'sails', label: '가로돛', note: '느렸고 바람을 거슬러 가기가 힘들었습니다.', at: sail(0.55) },
  ],  reale: [
    { id: 'bow', label: '이물 포대', note: '이물 단 위에 큰 대포 한 문과 작은 포 넷을 앞으로 향해 놓았습니다.', at: (a) => lift(a.fireSpots[3], 0.6) },
    { id: 'oars', label: '노와 노꾼', note: '노 하나에 노꾼 셋에서 다섯이 붙어 저었습니다. 노꾼은 죄수, 노예, 품삯을 받는 자원자였습니다.', at: oars },
    { id: 'sails', label: '래틴 돛', note: '세모난 래틴 돛을 달았지만, 싸울 때는 돛을 내리고 노로만 움직였습니다.', at: sail(0.6) },
    { id: 'stern', label: '고물', note: '지휘관이 서는 고물 갑판 위에 차양을 쳤습니다.', at: COMMAND_DECK },
  ],
  galea: [
    { id: 'bow', label: '이물 포대', note: '이물 단 위에 큰 대포 한 문과 작은 포 두셋을 앞으로 향해 놓았습니다.', at: (a) => lift(a.fireSpots[3], 0.6) },
    { id: 'oars', label: '노와 노꾼', note: '노 하나에 노꾼 셋에서 다섯이 붙어 저었습니다. 노꾼은 죄수, 노예, 품삯을 받는 자원자였습니다.', at: oars },
    { id: 'sails', label: '래틴 돛', note: '세모난 래틴 돛을 달았지만, 싸울 때는 돛을 내리고 노로만 움직였습니다.', at: sail(0.6) },
    { id: 'stern', label: '고물', note: '지휘관이 서는 고물 갑판 위에 차양을 쳤습니다.', at: COMMAND_DECK },
  ],
  vgalleass: [
    { id: 'bow', label: '뱃머리 포루', note: '둥근 뱃머리 포루에서 큰 포를 앞과 옆으로 쏘았습니다. 레판토에서 이 포격이 오스만 대열을 흐트러뜨렸습니다.', at: (a) => lift(a.fireSpots[3], 0.6) },
    { id: 'oars', label: '노와 노꾼', note: '큰 선체에 비해 노의 힘이 모자라 싸움터까지 갤리선이 끌어 주었습니다.', at: oars },
    { id: 'sails', label: '래틴 돛', note: '돛대 셋에 래틴 돛을 달았습니다.', at: sail(0.6) },
  ],
  sultana: [
    { id: 'bow', label: '이물 포대', note: '이물 단 위에 큰 대포 한 문과 작은 포를 놓았습니다. 병사들은 포보다 활을 많이 썼습니다.', at: (a) => lift(a.fireSpots[3], 0.6) },
    { id: 'oars', label: '노와 노꾼', note: '노 하나에 노꾼 셋에서 다섯이 붙어 저었습니다. 노꾼은 죄수, 노예, 품삯을 받는 자원자였습니다.', at: oars },
    { id: 'sails', label: '래틴 돛', note: '세모난 래틴 돛을 달았지만, 싸울 때는 돛을 내리고 노로만 움직였습니다.', at: sail(0.6) },
    { id: 'stern', label: '고물', note: '지휘관이 서는 고물 갑판 위에 차양을 쳤습니다.', at: COMMAND_DECK },
  ],
  kadirga: [
    { id: 'bow', label: '이물 포대', note: '이물 포는 베네치아 갤리선보다 적었습니다.', at: (a) => lift(a.fireSpots[3], 0.6) },
    { id: 'oars', label: '노와 노꾼', note: '노 하나에 노꾼 셋에서 다섯이 붙어 저었습니다. 노꾼은 죄수, 노예, 품삯을 받는 자원자였습니다.', at: oars },
    { id: 'sails', label: '래틴 돛', note: '세모난 래틴 돛을 달았지만, 싸울 때는 돛을 내리고 노로만 움직였습니다.', at: sail(0.6) },
    { id: 'stern', label: '고물', note: '지휘관이 서는 고물 갑판 위에 차양을 쳤습니다.', at: COMMAND_DECK },
  ],
  kalyata: [
    { id: 'oars', label: '노와 노꾼', note: '노 하나에 노꾼 둘이 붙은 가볍고 빠른 배였습니다.', at: oars },
    { id: 'sails', label: '래틴 돛', note: '돛대 하나에 큰 래틴 돛을 달았습니다.', at: sail(0.6) },
  ],
  firstrate: [
    { id: 'decks', label: '세 층의 포갑판', note: '아래 갑판에 32파운드, 가운데에 24파운드, 위에 12파운드 포를 실어 한쪽 현측 포격만 50문이었습니다.', at: gun(null) },
    { id: 'chequer', label: '넬슨 체크무늬', note: '검은 선체에 포문 줄마다 노란 띠를 칠하고 포문 뚜껑은 검게 칠했습니다. 넬슨이 함대 전체에 이 칠을 따르게 했습니다 (Goodwin 2005).', at: gun(null) },
    { id: 'long32', label: '32파운드 장포', note: '가장 무거운 포를 가장 낮은 갑판에 실어 배가 기울지 않게 했습니다.', at: gun('long32') },
    { id: 'quarterdeck', label: '뒷갑판', note: '함장과 제독이 서서 지휘하던 곳입니다. 넬슨은 이곳에서 르두타블호 저격병의 총에 맞았습니다.', at: COMMAND_DECK },
    { id: 'sails', label: '가로돛', note: '돛대 셋에 가로돛을 세 단씩 달고, 뒤쪽 돛대에는 세로돛(스팽커)을 달았습니다.', at: sail(0.55) },
  ],
  gb74: [
    { id: 'chequer', label: '넬슨 체크무늬', note: '검은 선체에 포문 줄마다 노란 띠를 칠하고 포문 뚜껑은 검게 칠했습니다. 넬슨이 함대 전체에 이 칠을 따르게 했습니다 (Goodwin 2005).', at: gun(null) },
    { id: 'carronade', label: '캐로네이드', note: '짧고 가벼운 대구경 포로, 가까운 거리에서 적의 고물을 부쉈습니다.', at: gun('carronade') },
    { id: 'sails', label: '가로돛', note: '돛대 셋에 가로돛을 세 단씩 달았습니다.', at: sail(0.55) },
  ],
  gbfrigate: [
    { id: 'deck', label: '한 층의 포갑판', note: '포갑판이 하나뿐이라 가볍고 빨랐습니다. 전열에는 서지 않았습니다.', at: gun(null) },
    { id: 'sails', label: '가로돛', note: '빠르게 오가며 기함의 신호를 받아 다른 배에 다시 올렸습니다.', at: sail(0.55) },
  ],
  fr80: [
    { id: 'long36', label: '36리브르 장포', note: '영국 32파운드 포보다 무거운 탄을 쏘는 아래 갑판의 포입니다.', at: gun('long36') },
    { id: 'stern', label: '고물', note: '고물 회랑의 유리창이 넓어, 빅토리호가 고물을 지나며 쏜 포탄이 배 끝까지 꿰뚫었습니다.', at: (a) => lift(a.stern, 3.5, 0.4) },
  ],
  fr74: [
    { id: 'tops', label: '돛대 위 저격대', note: '뤼카는 돛대 위 망루에 소총수와 척탄병을 올려 적 갑판을 쏘게 했습니다.', at: sail(0.8) },
    { id: 'long36', label: '36리브르 장포', note: '아래 갑판의 무거운 포입니다.', at: gun('long36') },
  ],
  trinidad: [
    { id: 'decks', label: '네 층의 포갑판', note: '1795년 앞뒤 갑판을 이어 네 번째 포갑판을 만들고 대포 136문을 실었습니다.', at: gun(null) },
    { id: 'stern', label: '고물 장식', note: '삼위일체를 새긴 고물 조각으로 이름이 붙었습니다.', at: (a) => lift(a.stern, 3.5, 0.4) },
  ],
  es74: [
    { id: 'long36', label: '36파운드 장포', note: '아래 갑판의 무거운 포입니다. 훈련이 모자라 장전이 느렸습니다.', at: gun('long36') },
    { id: 'sails', label: '가로돛', note: '돛대 셋에 가로돛을 세 단씩 달았습니다.', at: sail(0.55) },
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
