import type { ShipMods } from '../sim/types';
import { BRANCHES, BRANCH_LABEL, TREES, type Branch, type Effect } from '../sim/grand/growthData';

/**
 * The account's talent trees (재능): what a general spends his level points on. Pure data plus the arithmetic of
 * effects; the rules of learning (points, gates, keystones, respec) are in rules.ts. Design: docs/design-growth.md.
 *
 * Every general gets three branches: the campaign branches of his tree (growthData.ts TREES), padded to three with the
 * branch his historical trait leans to. Each branch has five tiers: two ranked starters, a ranked second tier, a choice
 * of two at the third, a ranked fourth and a keystone. Keystones are big, two-sided choices and only one can be held.
 * His own 비기 (mastery) crowns the tree. A talent that raises a factor his trait already raises resonates (공명): that
 * part counts half again.
 *
 * Effects are fractions added per rank (0.02 = +2%); a general's talents together stay within TALENT_CAP per factor.
 */
export type ModKey = keyof ShipMods;
export type TalentNode = {
  /** `<branch>.<slot>`, the same for every general who has the branch; the mastery is `mastery`. */
  id: string;
  branch: Branch | 'mastery';
  tier: 1 | 2 | 3 | 4 | 5;
  ranks: number;
  label: string;
  hanja: string;
  /** What one rank adds, as fractions. */
  per: Partial<Record<ModKey, number>>;
  keystone?: true;
  /** Column in the branch's grid (0 left, 1 middle, 2 right), for the drawn tree. */
  col: 0 | 1 | 2;
  /** One line of flavour. */
  line: string;
};

/** Points spent in a branch that open each tier. */
export const TIER_GATE: Record<1 | 2 | 3 | 4 | 5, number> = { 1: 0, 2: 2, 3: 4, 4: 6, 5: 9 };
/** The level a keystone, and the general's own 비기, ask for. */
export const KEYSTONE_LEVEL = 10;
export const MASTERY_LEVEL = 12;
/** Points anywhere a general must spend before his 비기. */
export const MASTERY_SPENT = 8;
/** Resonance: a talent's part on a factor the general's trait raises counts this much more. */
export const RESONANCE = 0.5;
/** No factor of a general's talents together goes past these. */
export const TALENT_CAP = { max: 0.32, min: -0.1 };

export type Milestone = { level: number; label: string; text: string; bonus: number };
/** What the levels on the way bring: bonus points beyond the one a level, and what opens. */
export const MILESTONES: readonly Milestone[] = [
  { level: 3, label: '초급 무관', text: '모든 가지의 2단 개방 가능', bonus: 0 },
  { level: 5, label: '중견 장수', text: '재능 점수 +1', bonus: 1 },
  { level: 8, label: '노련한 장수', text: '재능 점수 +1', bonus: 1 },
  { level: KEYSTONE_LEVEL, label: '명장', text: '핵심 재능(셋 중 하나) 개방, 재능 점수 +1', bonus: 1 },
  { level: MASTERY_LEVEL, label: '비기 전수', text: '장수 고유의 비기 개방', bonus: 0 },
  { level: 15, label: '백전노장', text: '재능 점수 +1', bonus: 1 },
  { level: 20, label: '전설', text: '재능 점수 +2', bonus: 2 },
];

const n = (branch: Branch, slot: string, tier: TalentNode['tier'], col: TalentNode['col'], ranks: number, label: string, hanja: string, per: TalentNode['per'], line: string, keystone = false): TalentNode =>
  ({ id: `${branch}.${slot}`, branch, tier, col, ranks, label, hanja, per, line, ...(keystone ? { keystone: true as const } : {}) });

export const BRANCH_NODES: Record<Branch, readonly TalentNode[]> = {
  gunnery: [
    n('gunnery', 'rapid', 1, 0, 3, '속사', '速射', { reload: 0.015 }, '화약을 미리 재어 두고 쉬지 않고 쟁인다'),
    n('gunnery', 'aim', 1, 2, 3, '정조준', '正照準', { accuracy: 0.015 }, '포구를 낮춰 물 위를 스치듯 쏜다'),
    n('gunnery', 'powder', 2, 1, 2, '화약 배합', '火藥配合', { fire: 0.04, reload: 0.005 }, '염초를 더 넣은 불화살과 화전'),
    n('gunnery', 'volley', 3, 0, 1, '일제 사격', '一齊射擊', { reload: 0.02, accuracy: 0.02 }, '북 한 번에 모든 포가 함께 터진다'),
    n('gunnery', 'range', 3, 2, 1, '원거리 포격', '遠距離砲擊', { accuracy: 0.035 }, '닿기 전에 깨뜨린다'),
    n('gunnery', 'crews', 4, 1, 3, '포수 조련', '砲手調練', { reload: 0.012, accuracy: 0.01 }, '포수 한 명 한 명을 손수 가르친다'),
    n('gunnery', 'keystone', 5, 1, 1, '총통 포진', '銃筒布陣', { reload: 0.08, accuracy: 0.05, melee: -0.08 }, '배를 붙이지 않고 포로만 끝낸다: 백병이 약해진다', true),
  ],
  command: [
    n('command', 'drums', 1, 0, 3, '독전', '督戰', { morale: 0.02 }, '북과 깃발로 싸움을 다그친다'),
    n('command', 'law', 1, 2, 3, '군율', '軍律', { defense: 0.015 }, '물러서는 자는 벤다'),
    n('command', 'drill', 2, 1, 2, '조련', '調練', { morale: 0.015, turn: 0.01 }, '진을 바꾸는 신호를 몸에 익힌다'),
    n('command', 'formation', 3, 0, 1, '진법', '陣法', { morale: 0.03, defense: 0.02 }, '어느 배도 홀로 두지 않는다'),
    n('command', 'runners', 3, 2, 1, '전령선', '傳令船', { turn: 0.03, speed: 0.01 }, '명령이 빠르게 끝 배까지 닿는다'),
    n('command', 'presence', 4, 1, 3, '장수의 위엄', '將帥威嚴', { morale: 0.015, defense: 0.01 }, '대장선이 버티면 함대가 버틴다'),
    n('command', 'keystone', 5, 1, 1, '필사즉생', '必死則生', { morale: 0.12, defense: 0.05, speed: -0.05 }, '죽기를 각오하면 산다: 물러서지 않아 느려진다', true),
  ],
  seamanship: [
    n('seamanship', 'tides', 1, 0, 3, '물때', '潮時', { speed: 0.015 }, '밀물과 썰물에 맞춰 나아간다'),
    n('seamanship', 'helm', 1, 2, 3, '키잡이', '舵手', { turn: 0.02 }, '좁은 물목에서도 배를 돌린다'),
    n('seamanship', 'sails', 2, 1, 2, '돛 다루기', '帆術', { speed: 0.012, turn: 0.012 }, '바람을 놓치지 않는다'),
    n('seamanship', 'current', 3, 0, 1, '조류 읽기', '潮流', { speed: 0.03 }, '울돌목의 물살을 아는 자'),
    n('seamanship', 'narrows', 3, 2, 1, '좁은 물목', '狹水道', { turn: 0.04, defense: 0.01 }, '적을 좁은 곳으로 끌어들인다'),
    n('seamanship', 'oars', 4, 1, 3, '노꾼 교대', '櫓軍交代', { speed: 0.01, reload: 0.008 }, '지친 노꾼을 쉬게 하며 싸운다'),
    n('seamanship', 'keystone', 5, 1, 1, '조류 장악', '掌潮流', { speed: 0.07, turn: 0.1, defense: -0.04 }, '물살을 무기로 삼는다: 가볍게 꾸려 덜 버틴다', true),
  ],
  boarding: [
    n('boarding', 'hooks', 1, 0, 3, '갈고리', '鉤', { melee: 0.02 }, '갈고리를 던져 적선을 끌어당긴다'),
    n('boarding', 'shields', 1, 2, 3, '방패벽', '防牌壁', { defense: 0.015 }, '뱃전에 방패를 세운다'),
    n('boarding', 'ladders', 2, 1, 2, '등선 사다리', '登船梯', { melee: 0.03 }, '높은 뱃전도 단숨에 오른다'),
    n('boarding', 'vanguard', 3, 0, 1, '결사대', '決死隊', { melee: 0.04, morale: 0.02 }, '가장 먼저 뛰어드는 자들'),
    n('boarding', 'fireship', 3, 2, 1, '화공선', '火攻船', { fire: 0.08 }, '불붙인 배를 적진에 흘려보낸다'),
    n('boarding', 'armored', 4, 1, 3, '갑사', '甲士', { defense: 0.012, melee: 0.01 }, '갑옷 입은 정예가 뱃전을 지킨다'),
    n('boarding', 'keystone', 5, 1, 1, '육박 돌격', '肉薄突擊', { melee: 0.15, morale: 0.04, accuracy: -0.06 }, '포를 버리고 칼로 끝낸다: 명중이 떨어진다', true),
  ],
};

type Sig = { label: string; hanja: string; per: TalentNode['per']; line: string };
const sig = (label: string, hanja: string, per: TalentNode['per'], line: string): Sig => ({ label, hanja, per, line });

/**
 * A commander's own talent from his career (고유 재능): one rank in his first branch's fourth tier, beside its ranked
 * node, opened by the same six points. The other chapters' commanders each have one; their sources are the campaign
 * notes of growthData.ts (Corbett, Mattingly, Capponi, Adkins).
 */
export const SIGNATURES: Record<string, Sig> = {
  howard: sig('바람 위의 신중함', 'Weather gage', { defense: 0.04, accuracy: 0.02 }, '바람 위를 지키며 함부로 붙지 않았다'),
  drake: sig('칼레의 화선', 'Fireships at Calais', { fire: 0.1, speed: 0.02 }, '밤바람에 화선 여덟 척을 흘려보내 초승달을 흩었다'),
  frobisher: sig('트라이엄프호의 돌입', 'Triumph', { melee: 0.05, morale: 0.02 }, '가장 큰 배로 적진 한가운데 버텼다'),
  hawkins: sig('낮은 갤리언', 'Race-built', { turn: 0.04, speed: 0.02 }, '선루를 깎아 빠르고 날렵하게 다시 지었다'),
  medina: sig('진형의 규율', 'Disciplina', { defense: 0.04, morale: 0.03, speed: -0.02 }, '진형을 벗어나는 함장은 교수형에 처한다고 명했다'),
  recalde: sig('비스케이의 물길', 'Vizcaya', { turn: 0.03, morale: 0.02, speed: 0.01 }, '대서양의 바람과 물길을 가장 잘 알았다'),
  leyva: sig('라 라타 코로나다', 'La Rata Coronada', { melee: 0.06 }, '귀족 자제들이 등선을 기다리던 배'),
  oquendo: sig('기푸스코아의 포대', 'Gipuzkoa', { reload: 0.04, accuracy: 0.01 }, '바스크 포수들이 쉬지 않고 쟁였다'),
  donjuan: sig('레알호 돌격', 'La Real', { morale: 0.04, melee: 0.03 }, '기함을 곧장 술타나호에 붙였다'),
  venier: sig('노장의 석궁', 'Balestra', { melee: 0.04, accuracy: 0.02 }, '일흔다섯 노장이 갑판에서 몸소 쏘았다'),
  barbarigo: sig('해안 좌익 고수', 'Ala sinistra', { defense: 0.04, turn: 0.02 }, '얕은 물가에 붙여 포위를 막았다'),
  doria: sig('우익의 기동', 'Manovra', { turn: 0.05 }, '바다 쪽으로 넓게 돌며 울루치 알리와 겨루었다'),
  alipasha: sig('술타나의 예니체리', 'Yeniçeri', { melee: 0.05, morale: 0.02 }, '기함에 예니체리 정예를 태웠다'),
  pertev: sig('원정군 보병', 'Sefer', { melee: 0.03, defense: 0.03 }, '갤리선마다 원정군 병사를 실었다'),
  uluc: sig('바다 쪽 우회', 'Kanat', { speed: 0.04, turn: 0.03 }, '도리아를 끌어내 틈으로 파고들었다'),
  siroco: sig('이집트 갤리선단', 'Mısır', { morale: 0.03, turn: 0.03 }, '해안 쪽 우익을 이끌었다'),
  nelson: sig('대열 돌파', 'Breaking the line', { melee: 0.03, morale: 0.03, accuracy: 0.02, defense: -0.02 }, '종렬로 곧장 적 대열을 끊었다: 다가가는 동안 맞는다'),
  cornwallis: sig('빌리 블루의 봉쇄', 'Close blockade', { defense: 0.03, morale: 0.03 }, '겨울에도 브레스트 앞바다를 떠나지 않았다'),
  collingwood: sig('로열 소버린의 일제 사격', 'Royal Sovereign', { reload: 0.05, accuracy: 0.02 }, '3분 30초에 세 번 쏘는 포수들'),
  calder: sig('안개 속의 신중', 'Finisterre', { defense: 0.05 }, '잡은 것을 지키려 다시 싸우지 않았다'),
  hardy: sig('뒷갑판의 침착', 'Quarterdeck', { defense: 0.03, morale: 0.03 }, '포화 속 뒷갑판을 넬슨과 함께 걸었다'),
  blackwood: sig('프리깃 정찰', 'Eyes of the fleet', { speed: 0.04, turn: 0.03 }, '연합 함대의 움직임을 깃발 신호로 알렸다'),
  villeneuve: sig('아부키르의 생존', 'Aboukir', { speed: 0.03, defense: 0.03 }, '나일 해전에서 남은 배를 이끌고 빠져나갔다'),
  ganteaume: sig('출항 대기', 'Brest', { defense: 0.03, reload: 0.02 }, '봉쇄 속에서도 함대를 언제든 나갈 수 있게 했다'),
  missiessy: sig('서인도 습격', 'Antilles', { speed: 0.03, fire: 0.05 }, '로슈포르를 빠져나가 영국 섬들을 불태웠다'),
  lucas: sig('수류탄과 소총', 'Redoutable', { melee: 0.05, fire: 0.04 }, '돛대 위에서 빅토리호 갑판을 쓸었다'),
  gravina: sig('관측 전대', 'Escuadra de observación', { morale: 0.03, defense: 0.03 }, '예비대로 연합 함대 뒤를 받쳤다'),
  alava: sig('산타 아나호의 분전', 'Santa Ana', { defense: 0.04, melee: 0.02 }, '로열 소버린호와 끝까지 맞붙었다'),
  churruca: sig('측량가의 사격', 'Nepomuceno', { accuracy: 0.05 }, '포마다 거리를 재어 쏘게 한 측량가'),
};

/** A commander's own talent as a node (`<branch>.sig`), or null. */
export function signatureNode(generalId: string): TalentNode | null {
  const s = SIGNATURES[generalId];
  const branch = branchesOf(generalId)[0];
  if (!s || !branch) return null;
  return { id: `${branch}.sig`, branch, tier: 4, col: 0, ranks: 1, label: s.label, hanja: s.hanja, per: s.per, line: s.line };
}

/** Which branch a trait's factor leans to, for the third branch of a general whose campaign tree has two. */
const LEAN: Record<ModKey, Branch> = { reload: 'gunnery', accuracy: 'gunnery', fire: 'gunnery', morale: 'command', speed: 'seamanship', turn: 'seamanship', melee: 'boarding', defense: 'boarding' };
const MOD_KEYS: readonly ModKey[] = ['reload', 'accuracy', 'speed', 'turn', 'fire', 'melee', 'defense', 'morale'];

/** The factors a general's trait raises (resonance). */
export function traitKeys(generalId: string): ModKey[] {
  const e = TREES[generalId]?.trait.effect as Effect | undefined;
  return e ? MOD_KEYS.filter((k) => (e[k] ?? 1) > 1) : [];
}

/** A general's three branches, in his tree's order. */
export function branchesOf(generalId: string): Branch[] {
  const tree = TREES[generalId];
  if (!tree) return [];
  const out = [...tree.branches].slice(0, 3);
  for (const k of traitKeys(generalId)) if (out.length < 3 && !out.includes(LEAN[k])) out.push(LEAN[k]);
  for (const b of BRANCHES) if (out.length < 3 && !out.includes(b)) out.push(b);
  return out;
}

/** The general's 비기 as a node: his campaign mastery's factors, kept as fractions. */
export function masteryNode(generalId: string): TalentNode | null {
  const tree = TREES[generalId];
  if (!tree) return null;
  const per: TalentNode['per'] = {};
  for (const k of MOD_KEYS) {
    const v = (tree.mastery.effect as Effect)[k];
    if (v !== undefined) per[k] = Math.round((v - 1) * 10000) / 10000;
  }
  return { id: 'mastery', branch: 'mastery', tier: 5, col: 1, ranks: 1, label: tree.mastery.label, hanja: tree.hanja, per, line: '이 장수만의 비기' };
}

/** Every node a general can learn: his three branches, then his 비기. */
export function talentsFor(generalId: string): TalentNode[] {
  const out = branchesOf(generalId).flatMap((b) => [...BRANCH_NODES[b]]);
  const own = signatureNode(generalId);
  if (own) out.splice(out.findIndex((n) => n.branch === own.branch && n.keystone), 0, own);
  const m = masteryNode(generalId);
  if (m) out.push(m);
  return out;
}

export const talentById = (generalId: string, nodeId: string) => talentsFor(generalId).find((t) => t.id === nodeId);

/** Points a general has from his level: one a level past the first, and the milestones' bonuses. */
export function pointsAtLevel(level: number): number {
  return Math.max(0, level - 1) + MILESTONES.filter((m) => m.level <= level).reduce((s, m) => s + m.bonus, 0);
}

export const spentIn = (talents: Readonly<Record<string, number>>, branch: Branch) =>
  Object.entries(talents).reduce((s, [id, r]) => (id.startsWith(`${branch}.`) ? s + r : s), 0);
export const spentAll = (talents: Readonly<Record<string, number>>) => Object.values(talents).reduce((s, r) => s + r, 0);

/** What a node's ranks give a general, with resonance on his trait's factors: fractions per factor. */
export function nodeAdds(generalId: string, node: TalentNode, ranks: number): Partial<Record<ModKey, number>> {
  const res = new Set(traitKeys(generalId));
  const out: Partial<Record<ModKey, number>> = {};
  for (const [k, v] of Object.entries(node.per) as [ModKey, number][]) {
    const boost = v > 0 && res.has(k) && node.branch !== 'mastery' ? 1 + RESONANCE : 1;
    out[k] = Math.round(v * ranks * boost * 10000) / 10000;
  }
  return out;
}

/** True when a node resonates with the general's trait. */
export const resonates = (generalId: string, node: TalentNode) => node.branch !== 'mastery' && traitKeys(generalId).some((k) => (node.per[k] ?? 0) > 0);

/** All a general's talents together, each factor capped (TALENT_CAP), as ShipMods factors. */
export function talentEffect(generalId: string, talents: Readonly<Record<string, number>>): Partial<ShipMods> {
  const add: Partial<Record<ModKey, number>> = {};
  const nodes = talentsFor(generalId);
  for (const [id, ranks] of Object.entries(talents)) {
    const node = nodes.find((t) => t.id === id);
    if (!node || ranks <= 0) continue;
    for (const [k, v] of Object.entries(nodeAdds(generalId, node, Math.min(ranks, node.ranks))) as [ModKey, number][]) add[k] = (add[k] ?? 0) + v;
  }
  const out: Partial<ShipMods> = {};
  for (const [k, v] of Object.entries(add) as [ModKey, number][]) {
    const c = Math.max(TALENT_CAP.min, Math.min(TALENT_CAP.max, v));
    if (c !== 0) out[k] = Math.round((1 + c) * 10000) / 10000;
  }
  return out;
}

export { BRANCH_LABEL };
