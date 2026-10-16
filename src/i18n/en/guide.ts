/** English for the first-play guidance: each battle's goal and its three opening hints, and the result card's score and comparison with history. Keyed by the exact Korean source text; see ../index.ts and ../GLOSSARY.md. */
export const EN_GUIDE: Record<string, string> = {
  // Okpo
  '포구에 정박한 일본 함선을 모두 격파하세요. 아군 손실은 적을수록 좋습니다.': 'Destroy every Japanese ship anchored in the harbor. The fewer you lose, the better.',
  '아래 장수 패로 본대를 고르세요.': 'Pick your main fleet with the commander cards below.',
  '포구 쪽 빈 바다를 눌러 본대를 적 앞으로 보내세요.': 'Tap open water toward the harbor to send your fleet in front of the enemy.',
  '적 함선을 누르면 공격합니다. 옆면이 적을 향해야 포가 나갑니다.': 'Tap an enemy ship to attack it. The guns fire from the sides, so turn a broadside to the enemy.',
  // Sacheon
  '선창에 정박한 일본 함선 13척을 모두 격파하세요. 거북선을 앞세우세요.': 'Destroy all 13 Japanese ships at the quay. Put the turtle ship in front.',
  '아래 장수 패로 거북선과 본대를 고르세요.': 'Pick the turtle ship and your main fleet with the cards below.',
  '거북선을 선창 쪽으로 보내 적진에 먼저 뛰어들게 하세요.': 'Send the turtle ship toward the quay to break into the enemy first.',
  '판옥선은 그 뒤에서 적 함선을 눌러 포격하세요.': 'Have the panokseon follow and shell the enemy ships you tap.',
  // Dangpo
  '당포 선창의 일본 함선 21척을 격파하고, 높은 누각의 대장선을 노리세요.': 'Destroy the 21 Japanese ships at Dangpo and go for the flagship with the tall tower.',
  '선창 앞바다로 본대를 이동시키세요.': 'Move your fleet to the water off the quay.',
  '거북선으로 누각 높은 대장선을 들이받고, 판옥선은 둘러싸서 쏘세요.': 'Ram the tall flagship with the turtle ship, and surround and shoot with the panokseon.',
  // Hansando
  '견내량의 적을 한산도 앞바다로 끌어내 학익진으로 에워싸고 격파하세요.': 'Lure the enemy out of Gyeonnaeryang into the open sea off Hansando, then close around it in the Crane Wing and destroy it.',
  '판옥선 몇 척을 골라 견내량 쪽으로 보내 적을 유인하세요.': 'Pick a few panokseon and send them toward Gyeonnaeryang to draw the enemy out.',
  '적이 따라 나오면 본대를 골라 진형 탭에서 학익진을 누르세요.': 'When the enemy follows, pick your main fleet and press the Crane Wing on the formation tab.',
  '적이 감싸이면 좌현·우현 일제 사격으로 몰아치세요.': 'Once the enemy is enclosed, hammer it with port and starboard volleys.',
  // Angolpo
  '좁은 안골포에 숨은 일본 함선을 격파하세요. 한꺼번에 들어가면 서로 걸립니다.': 'Destroy the Japanese ships hiding in narrow Angolpo. Sailing in all at once makes your ships foul each other.',
  '포구 입구까지 나아가 일부만 안으로 들여보내세요.': 'Advance to the mouth of the harbor and send only some ships in.',
  '번갈아 쏘고 빠지며 적을 포구 밖으로 끌어내세요.': 'Take turns firing and pulling back, and draw the enemy out of the harbor.',
  // Busan
  '470여 척이 정박한 부산포로 돌입해 최대한 많은 적 함선을 격파하세요.': 'Charge into Busan, where over 470 ships lie at anchor, and destroy as many as you can.',
  '배속 버튼 옆의 빠른 접근으로 적진 앞까지 가세요.': "Use the fast approach next to the speed button to reach the enemy's front.",
  '적이 빽빽한 곳에서는 오래 머물지 말고, 격파한 뒤 물러나 다시 돌입하세요.': 'Do not linger where the enemy is thick: strike, pull back, and go in again.',
  // Chilcheollyang
  '이길 수 없는 싸움입니다. 포위를 뚫고 최대한 많은 함선을 살려 내세요.': 'This fight cannot be won. Break through the encirclement and save as many ships as you can.',
  '아래 장수 패로 함선을 고르세요.': 'Pick ships with the commander cards below.',
  '적이 적은 쪽의 빈 바다를 눌러 함대를 그리로 빼내세요.': 'Tap open water where the enemy is thinnest to pull your fleet out that way.',
  '맞서 싸우기보다 돌파해 빠져나가는 배를 하나라도 더 지키세요.': 'Break out rather than stand and fight, and protect every extra ship that gets away.',
  // Myeongnyang
  '13척으로 울돌목을 지키세요. 물살이 일본 함대를 거슬러 흐를 때까지 버티세요.': 'Hold Uldolmok with thirteen ships until the current runs against the Japanese fleet.',
  '좁은 물목 안쪽에서 대열을 지키고, 둘러싸이지 않게 하세요.': 'Keep your line inside the narrows and do not let it be surrounded.',
  '물살이 바뀌면 일본 함대가 흐트러집니다. 그때 몰아붙이세요.': 'When the current turns, the Japanese fleet falls into disorder. Press them then.',
  // Noryang
  '밤새 500여 척과 맞서 순천의 퇴로를 막고 최대한 많은 적을 격파하세요.': 'Face over 500 ships through the night, cut off the retreat from Suncheon and destroy as many as you can.',
  '아래 장수 패로 조선 본대를 고르세요.': 'Pick the Joseon main fleet with the commander cards below.',
  '관음포 쪽 물목으로 본대를 보내 적의 길목을 막으세요.': "Send the fleet to the strait toward Gwaneumpo and block the enemy's way.",
  '밤에는 적이 가까이 와야 보입니다. 등불을 끄고 기다렸다 쏘세요.': 'At night the enemy is seen only up close. Put out your lanterns, wait, then fire.',

  // The result card
  '실제 역사': 'History',
  '당신': 'You',
  '결과 점수': 'Score',
  '결과 공유': 'Share result',
  '{n}척 생존': '{n} ships survived',
  '일본 함선 {n}척 격파, 아군 {m}척 손실': '{n} Japanese ships destroyed, {m} of yours lost',
  '역사보다 {n}척을 더 살렸습니다.': 'You saved {n} more ships than history did.',
  '역사만큼 함선을 지켜 내지 못했습니다.': 'You could not keep as many ships as history did.',
  '역사의 전과를 넘어섰습니다.': "You matched or beat history's tally.",
  '역사의 전과에 {n}척 모자랍니다.': "{n} short of history's tally.",
  '별 {n}개': '{n} stars',
  '{title} {stars} {score}점 · {yours} · {time}': '{title} {stars} {score} pts · {yours} · {time}',
};
