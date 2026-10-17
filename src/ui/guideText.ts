import type { ScenarioId } from '../sim/scenarios';

/**
 * What a first-time player is told about each historical battle: the goal in one line, three hints for the first half
 * minute, and the figure the result card sets the player's result against. Korean source text: show it through t(); the
 * English is in src/i18n/en/guide.ts. The hints say "본대" and "장수 패" the way the cards and the briefing do.
 */
export type BattleGuide = {
  goal: string;
  /** Three hints, each shown for a few seconds; the first points at selecting, the rest at the battle's own plan. */
  hints: [string, string, string];
  /** What the battle is scored on: ships destroyed, or (a defeat to limit) own ships kept. */
  kind: 'destroy' | 'survive';
  /** The historical figure for that: enemy ships destroyed, or own ships that got away. */
  history: number;
};

export const GUIDES: Record<ScenarioId, BattleGuide> = {
  plymouth: {
    goal: '바람 위에서 무적함대의 초승달 진형을 멀리서 포격하세요. 붙잡히면 병사가 많은 에스파냐 갤리온에 도선당합니다.',
    hints: ['아래 장수 패로 하워드 전대를 고르세요.', '적의 날개 끝(레칼데의 좌익)으로 다가가 옆면을 돌려 포격하세요.', '적이 다가오면 물러나 거리를 두세요. 컬버린은 적의 대포보다 멀리 나갑니다.'],
    kind: 'destroy',
    history: 2,
  },
  portland: {
    goal: '곶 안쪽에 고립된 프로비셔의 분대를 갈레아스로부터 지키고, 본대로 무적함대를 밀어내세요.',
    hints: ['프로비셔 분대는 닻을 내린 채 포격으로 버팁니다.', '하워드 본대를 골라 갈레아스 쪽으로 보내세요.', '갈레아스는 이물의 대포가 강합니다. 옆에서 공격하세요.'],
    kind: 'survive',
    history: 6,
  },
  wight: {
    goal: '네 개 전대로 무적함대의 오른쪽 날개를 쳐서 솔렌트로 들어가지 못하게 하세요.',
    hints: ['드레이크 전대를 골라 바다 쪽에서 적의 오른쪽 날개로 보내세요.', '프로비셔 전대는 섬 쪽에서 적 앞을 막습니다.', '적 함대가 모래톱 쪽으로 밀리면 이깁니다.'],
    kind: 'destroy',
    history: 0,
  },
  calais: {
    goal: '화공선 8척을 정박한 무적함대 한가운데로 보내 진형을 무너뜨리세요.',
    hints: ['아래 장수 패로 화공선을 고르세요.', '정박한 적 함선 쪽 바다를 눌러 화공선을 보내세요. 닿으면 불이 옮겨 붙습니다.', '흩어지는 적을 갤리온 전대로 포격하세요.'],
    kind: 'destroy',
    history: 1,
  },
  gravelines: {
    goal: '흩어졌다 다시 모이는 무적함대에 바짝 붙어 포격하고, 플랑드르 모래톱 쪽으로 몰아내세요.',
    hints: ['드레이크 전대로 메디나 시도니아의 산 마르틴호를 노리세요.', '이번에는 가까이 붙어 쏘세요. 다만 도선당하지 않게 옆으로 지나가세요.', '모래톱은 남쪽에 있습니다. 적을 그쪽으로 모세요.'],
    kind: 'destroy',
    history: 5,
  },
  okpo: {
    goal: '포구에 정박한 일본 함선을 모두 격파하세요. 아군 손실은 적을수록 좋습니다.',
    hints: ['아래 장수 패로 본대를 고르세요.', '포구 쪽 빈 바다를 눌러 본대를 적 앞으로 보내세요.', '적 함선을 누르면 공격합니다. 옆면이 적을 향해야 포가 나갑니다.'],
    kind: 'destroy',
    history: 26,
  },
  sacheon: {
    goal: '선창에 정박한 일본 함선 13척을 모두 격파하세요. 거북선을 앞세우세요.',
    hints: ['아래 장수 패로 거북선과 본대를 고르세요.', '거북선을 선창 쪽으로 보내 적진에 먼저 뛰어들게 하세요.', '판옥선은 그 뒤에서 적 함선을 눌러 포격하세요.'],
    kind: 'destroy',
    history: 13,
  },
  dangpo: {
    goal: '당포 선창의 일본 함선 21척을 격파하고, 높은 누각의 대장선을 노리세요.',
    hints: ['아래 장수 패로 본대를 고르세요.', '선창 앞바다로 본대를 이동시키세요.', '거북선으로 누각 높은 대장선을 들이받고, 판옥선은 둘러싸서 쏘세요.'],
    kind: 'destroy',
    history: 21,
  },
  hansan: {
    goal: '견내량의 적을 한산도 앞바다로 끌어내 학익진으로 에워싸고 격파하세요.',
    hints: ['판옥선 몇 척을 골라 견내량 쪽으로 보내 적을 유인하세요.', '적이 따라 나오면 본대를 골라 진형 탭에서 학익진을 누르세요.', '적이 감싸이면 좌현·우현 일제 사격으로 몰아치세요.'],
    kind: 'destroy',
    history: 59,
  },
  angolpo: {
    goal: '좁은 안골포에 숨은 일본 함선을 격파하세요. 한꺼번에 들어가면 서로 걸립니다.',
    hints: ['아래 장수 패로 본대를 고르세요.', '포구 입구까지 나아가 일부만 안으로 들여보내세요.', '번갈아 쏘고 빠지며 적을 포구 밖으로 끌어내세요.'],
    kind: 'destroy',
    history: 20,
  },
  busan: {
    goal: '470여 척이 정박한 부산포로 돌입해 최대한 많은 적 함선을 격파하세요.',
    hints: ['아래 장수 패로 본대를 고르세요.', '배속 버튼 옆의 빠른 접근으로 적진 앞까지 가세요.', '적이 빽빽한 곳에서는 오래 머물지 말고, 격파한 뒤 물러나 다시 돌입하세요.'],
    kind: 'destroy',
    history: 100,
  },
  chilcheon: {
    goal: '이길 수 없는 싸움입니다. 포위를 뚫고 최대한 많은 함선을 살려 내세요.',
    hints: ['아래 장수 패로 함선을 고르세요.', '적이 적은 쪽의 빈 바다를 눌러 함대를 그리로 빼내세요.', '맞서 싸우기보다 돌파해 빠져나가는 배를 하나라도 더 지키세요.'],
    kind: 'survive',
    history: 12,
  },
  myeongnyang: {
    goal: '13척으로 울돌목을 지키세요. 물살이 일본 함대를 거슬러 흐를 때까지 버티세요.',
    hints: ['아래 장수 패로 본대를 고르세요.', '좁은 물목 안쪽에서 대열을 지키고, 둘러싸이지 않게 하세요.', '물살이 바뀌면 일본 함대가 흐트러집니다. 그때 몰아붙이세요.'],
    kind: 'destroy',
    history: 31,
  },
  noryang: {
    goal: '밤새 500여 척과 맞서 순천의 퇴로를 막고 최대한 많은 적을 격파하세요.',
    hints: ['아래 장수 패로 조선 본대를 고르세요.', '관음포 쪽 물목으로 본대를 보내 적의 길목을 막으세요.', '밤에는 적이 가까이 와야 보입니다. 등불을 끄고 기다렸다 쏘세요.'],
    kind: 'destroy',
    history: 200,
  },
};

export type BattleScore = {
  /** 0-3. A lost battle earns none, except a defeat to limit that kept more than history did. */
  stars: number;
  score: number;
  /** The figure the battle is scored on, and the one history set. */
  value: number;
  history: number;
};

export type Tally = { won: boolean; draw: boolean; own: number; ownTotal: number; enemyTotal: number; destroyed: number };

/**
 * The result of a battle on a 0-1000 scale: how much of the enemy was destroyed, how much of the fleet is left, and
 * the win itself. A defeat to limit (Chilcheollyang) weighs what was saved above the rest. Stars: 3 for a win that kept
 * nine ships in ten, 2 for seven in ten, 1 for any other win; the survival battle gives one star for passing history's
 * figure, two for a third of the fleet and three for half of it.
 */
export function scoreBattle(id: ScenarioId, r: Tally): BattleScore {
  const guide = GUIDES[id];
  const kept = r.ownTotal > 0 ? r.own / r.ownTotal : 0;
  const killed = r.enemyTotal > 0 ? Math.min(1, r.destroyed / r.enemyTotal) : 0;
  if (guide.kind === 'survive') {
    const stars = r.own >= r.ownTotal * 0.5 ? 3 : r.own >= r.ownTotal / 3 ? 2 : r.own > guide.history ? 1 : 0;
    return { stars, score: Math.round(kept * 700 + killed * 200 + (r.won ? 100 : 0)), value: r.own, history: guide.history };
  }
  const win = r.won && !r.draw;
  const stars = win ? (kept >= 0.9 ? 3 : kept >= 0.7 ? 2 : 1) : 0;
  return { stars, score: Math.round(killed * 450 + kept * 350 + (win ? 200 : 0)), value: r.destroyed, history: guide.history };
}
