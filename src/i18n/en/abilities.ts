/** English for the commander abilities, the battle's callouts and the result card's medals. See ../index.ts and ../GLOSSARY.md. */
export const EN_ABILITIES: Record<string, string> = {
  // ---- ability names and descriptions (sim/abilities.ts); 학익진, 일제 사격 and 화전 are in battle.ts
  '충파 돌격': 'Ramming Charge',
  '필사즉생': 'Death Before Defeat',
  '등선 육박전': 'Boarding Assault',
  '기습': 'Ambush',
  '연막': 'Smoke Screen',
  '철벽': 'Iron Wall',
  '물때 읽기': 'Read the Tide',
  '대장의 함대가 진형을 굳게 지키며 포를 한 곳에 모읍니다. 명중과 장전, 선회가 좋아집니다.': "The commander's squadron holds its formation and brings its guns to bear on one point. Better aim, reloading and turning.",
  '모든 포를 즉시 장전하고 다음 일제 사격을 정확히 겨눕니다.': 'Every gun is loaded at once and the next broadside is laid with care.',
  '노를 힘껏 저어 적선에 부딪칩니다. 속도와 충돌 피해가 커집니다.': 'The rowers pull with everything they have to drive into the enemy. More speed and more ramming damage.',
  '죽고자 하면 살 것입니다. 기함 가까이의 함선이 불을 끄고 기운을 되찾아 등선해 오는 적을 막아 냅니다.': 'Those who seek death shall live. Ships near the flagship beat down their fires, take heart and throw back boarders.',
  '불화살과 화공으로 명중한 적선에 불을 붙입니다.': 'Fire arrows and incendiaries set the ships they hit alight.',
  '정예 무사를 앞세워 적선에 뛰어듭니다. 백병전이 강해지고 빨리 다가갑니다.': 'Picked fighters lead the way onto the enemy decks. Stronger in melee and quicker to close.',
  '섬 그늘과 물안개에 숨어 다가가 먼저 칩니다. 적이 늦게 알아보고, 빠르고 정확해집니다.': 'Hidden by islands and sea mist, the squadron closes and strikes first. Seen late by the enemy, faster and more accurate.',
  '연기를 피워 기함 가까이의 함선을 가립니다. 적의 조준이 크게 흐트러집니다.': "Smoke hides the ships near the flagship. The enemy's aim suffers badly.",
  '방패와 젖은 거적을 둘러 버팁니다. 받는 피해가 줄고 갑판을 잘 지키지만 느려집니다.': 'Shields and wet straw mats are hung along the sides. Less damage taken and decks better held, but slower.',
  '물길을 아는 장수가 조류를 탑니다. 빠르고 잘 돌며, 거스르는 물살에 덜 밀립니다.': 'A commander who knows these waters rides the tide. Faster and nimbler, and held back less by a current against the course.',

  // ---- surnames sim/abilities.ts matches commanders by (the others are in sim.ts)
  '다치바나': 'Tachibana',
  '데라자와': 'Terazawa',

  // ---- the ability tray and banner (ui/Abilities.tsx)
  '장수 특기': 'Commander abilities',
  '대장선을 잃었습니다': 'Flagship lost',
  '{s}초 남음': '{s}s left',
  '{s}초 뒤 사용 가능': 'Ready in {s}s',
  '사용 가능': 'Ready',
  '기함 둘레 {r}m': 'Within {r} m of the flagship',
  '대장의 함대': "The commander's squadron",
  '{s}초 지속': 'Lasts {s}s',
  '재사용 {s}초': 'Cooldown {s}s',
  '적장 {name}': 'Enemy commander {name}',
  '대장선을 잃어 {name|을/를} 쓸 수 없습니다': 'The flagship is lost: {name} cannot be used',
  '{name} · {s}초 뒤에 다시 쓸 수 있습니다': '{name} · ready again in {s}s',

  // ---- flagship and streak callouts (ui/BattleFeed.tsx)
  '적 대장선 격침!': 'Enemy flagship sunk!',
  '공훈 · 적 대장선을 격침했습니다': 'Distinction · the enemy flagship is sunk',
  '아군 대장선 상실': 'Our flagship is lost',
  '{name} · 장수의 특기를 잃었습니다': "{name} · the commander's ability is lost",
  '파죽지세': 'Unstoppable',
  '연속 격침': 'Sinking streak',
  '{n}척 연속 격침': '{n} ships in a row',

  // ---- medals on the result card
  '적 대장선 격침': 'Sink an enemy flagship',
  '아군 대장선 보전': 'Keep every flagship afloat',
  '아군 손실 {n}척 이하': 'Lose {n} ships or fewer',
  '금 훈장': 'Gold medal',
  '은 훈장': 'Silver medal',
  '동 훈장': 'Bronze medal',
};
