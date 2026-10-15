/** The battle depth rules: morale, routs and rallies, the drum, raking and crossfire, spreading fire. */
export const EN_BATTLE_DEPTH: Record<string, string> = {
  // A crew's or a fleet's nerve
  '사기': 'Morale',
  '동요': 'Wavering',
  '패주': 'Routing',
  '재집결': 'Rally',
  '붕괴': 'Broken',
  '사기 · 아군 {own}% · 적 {foe}%': 'Morale · ours {own}% · enemy {foe}%',
  '{n}척이 달아나고 있습니다': '{n} ships are running',
  '{n}척이 동요하고 있습니다': '{n} ships are wavering',
  '북을 울리고 있습니다': 'The drum is beating',

  // The rally drum
  '지금은 북을 울릴 수 없습니다 · 부대장선이 없거나 북이 쉬는 중입니다': 'The drum cannot beat now · the squadron has lost its leader or the drum is resting',
  '북을 울려 {n}개 부대를 재집결합니다': 'The drums beat · {n} squadrons rally',
  '재집결 북 · 고른 부대의 지휘선이 북을 울립니다': 'Rally drum · the command ships of the selected squadrons beat it',

  // Callouts
  '적 함선 {n}척 패주': '{n} enemy ships routing',
  '아군 함선 {n}척 패주 · 북을 울려 재집결하세요': '{n} of our ships routing · beat the drum to rally them',
  '아군 함선 {n}척 재집결': '{n} of our ships rally',
  '적 함선 {n}척 재집결': '{n} enemy ships rally',
  '적이 북을 울려 전열을 다잡습니다': 'Enemy drums · they steady their line',
  '아군 대장선 상실 · {name} · 함대의 사기가 크게 꺾입니다': 'Our admiral’s ship is lost · {name} · the whole fleet loses heart',
  '적 대장선 격침 · {name}': 'Enemy admiral’s ship sunk · {name}',
  '적 대장선 도주 · {name}': 'Enemy admiral’s ship flees · {name}',
  '적 대장선 전투 불능 · {name}': 'Enemy admiral’s ship out of action · {name}',
  '아군 {squadron} 지휘선 상실 · 부대가 흔들립니다': 'Our {squadron} lost its command ship · the squadron is shaken',
  '적 {squadron} 지휘선 상실': 'Enemy {squadron} lost its command ship',
  '아군 함대가 무너졌습니다 · 대부분의 함선이 달아납니다': 'Our fleet has broken · most of our ships are running',
  '적 함대가 무너져 달아납니다': 'The enemy fleet breaks and runs',
  '아군 함대 동요 · 북을 울려 다잡으세요': 'Our fleet is wavering · beat the drum to steady it',
  '적 함대 동요': 'The enemy fleet is wavering',
  '아군 함대가 전열을 되찾았습니다': 'Our fleet has steadied its line',
  '적 함대가 전열을 되찾았습니다': 'The enemy fleet has steadied its line',

  // Tooltips
  '학이 날개를 펴듯 함선을 반원으로 벌려 적을 감쌉니다. 세 방향에서 둘러싸인 적은 사기가 계속 떨어지고, 양쪽 날개에서 3초 안에 함께 맞히면 교차 사격으로 피해가 15% 커집니다.':
    'Spreads ships in a half circle like a crane opening its wings to wrap around the enemy. An enemy hemmed in on three sides keeps losing heart, and hits from both wings within 3 seconds catch it in a crossfire for 15% more damage.',
  '적과 마주 보는 가로 한 줄로 세웁니다. 모든 함선이 옆면의 포를 적에게 돌리고, 양옆에 아군을 둔 채 대열을 지키는 동안 명중이 8% 좋아지고 사기가 덜 흔들립니다.':
    'Forms a single line facing the enemy. Every ship brings its broadside to bear, and while it keeps its place with friends on either side it hits 8% more often and holds its nerve better.',
  '기함을 앞세우고 나머지가 꼬리를 물고 따릅니다. 대열을 지키면 앞 배의 물길을 타서 5% 빨라지지만, 적을 정면으로 향한 선두는 이물에서 고물까지 꿰뚫는 포격(측사)을 받습니다.':
    'The flagship leads and the rest follow in its wake, 5% faster while they keep station. The lead ship, bows-on to the enemy, takes raking fire from stem to stern.',
  '기함을 꼭짓점으로 삼아 화살촉 모양으로 나아갑니다. 대열을 지키는 동안 명중이 좋아지고 사기가 덜 흔들립니다.':
    'Advances in an arrowhead with the flagship at the tip. While the ships keep station they shoot straighter and hold their nerve better.',
  '적의 대열 한가운데를 가를 때. 갈라진 적은 양쪽에서 교차 사격을 받습니다.': 'Splitting the middle of the enemy line. The split halves take crossfire from both sides.',
  '누를 때마다 기본탄, 대장군전(선체 파괴), 조란환(승조원 공격), 화전(불화살) 순으로 바뀝니다. 크게 번진 불은 바람을 타고 가까운 함선으로 옮겨붙습니다.':
    'Each press cycles through standard shot, great general arrows (hull damage), canister (anti-crew) and fire arrows. A fire that takes hold spreads to nearby ships, more readily downwind.',
  '큰 함선의 선체를 부술 땐 대장군전, 승조원이 많은 함선엔 조란환, 정박했거나 서로 붙어 있는 목조 함선엔 화전.':
    'Great general arrows to break a big hull, canister against crowded decks, fire arrows against wooden ships at anchor or packed together.',
  '목표 적 함선에 옆면을 돌려 포문을 겨눕니다. 적의 이물이나 고물 쪽에서 쏘면 포탄이 선체를 길게 꿰뚫어(측사) 선체 피해가 25%, 승조원 피해가 40% 커집니다.':
    'Turns the ship side-on to its target so the guns can aim. Shots from off the enemy’s bow or stern rake the length of its hull for 25% more hull damage and 40% more casualties.',
  '재집결 북': 'Rally drum',
  '고른 함선이 속한 부대의 지휘선이 북을 울립니다. 25초 동안 지휘선 700m 안의 함선이 사기를 되찾고, 달아나던 함선도 다시 모입니다. 한 번 울리면 90초를 쉽니다.':
    'The command ship of each selected squadron beats the drum. For 25 seconds ships within 700 m of it regain heart and running ships come back. The drum then rests for 90 seconds.',
  '함선들이 동요하거나 달아나기 시작할 때. 지휘선을 잃은 부대는 다음 지휘선이 정해질 때까지 울릴 수 없습니다.':
    'When ships start to waver or run. A squadron that lost its command ship cannot beat it until the next captain takes over.',
  '두 함대가 얼마나 버티고 있는지입니다. 손실, 화재, 측사, 가까운 아군의 침몰, 지휘선을 잃는 것이 사기를 깎고, 지휘선의 곁, 북, 유리한 수, 잠깐의 소강이 되살립니다. 꺾인 함선은 동요해 장전과 조준이 느려지고, 더 꺾이면 달아납니다.':
    'How well each fleet is holding. Losses, fire, raking, friends sinking nearby and a lost command ship wear it down; the command ship close by, the drum, good odds and a lull restore it. A shaken crew wavers, loading and aiming worse, and a broken one runs.',
  '적이 동요할 때 몰아붙이고, 아군이 흔들리면 북을 울리거나 물러나 다시 모이세요. 함선이 모두 달아나는 쪽이 집니다.':
    'Press the enemy while it wavers; when your own ships waver, beat the drum or fall back and regroup. The side whose ships all run loses.',
  '부대 하나를 고릅니다. 두 번 누르면 카메라가 그 부대로 이동합니다. 흰 막대는 선체, 그 아래 금빛 막대는 사기입니다.':
    'Selects a squadron. Press twice to move the camera there. The white bar shows hull condition and the gold bar under it morale.',
};
