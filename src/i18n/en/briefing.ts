/** English for the battle briefings: each battle's one-line hook (link previews and the loading page), the loading page's own tip, and sharing. Keyed by the exact Korean source text; see ../index.ts and ../GLOSSARY.md. */
export const EN_BRIEFING: Record<string, string> = {
  // One line per historical battle (src/sim/scenarioText.ts). The link previews show about two lines of it.
  '조선 수군의 첫 출전. 일본 함선 26척을 격파하고 한 척도 잃지 않았습니다.': "The Joseon navy's first sortie: 26 Japanese ships destroyed and not one of its own lost.",
  '거북선이 처음 실전에 나선 해전. 일본 함선 13척을 모두 격파했습니다.': "The turtle ship's first battle: all 13 Japanese ships destroyed.",
  '거북선이 누각 높은 일본 대장선을 들이받고 21척을 모두 격파했습니다.': 'A turtle ship rams the towering Japanese flagship, and all 21 Japanese ships are destroyed.',
  '학익진으로 일본 함대를 에워싸 59척을 격침하거나 나포했습니다.': 'The Crane Wing closes around the Japanese fleet: 59 ships sunk or captured.',
  '좁고 얕은 포구에 번갈아 들어가 총통을 쏘아 20여 척을 격파했습니다.': 'Taking turns to fire into a narrow, shallow harbor: more than 20 Japanese ships destroyed.',
  '470여 척이 정박한 적의 거점으로 돌입해 100여 척을 격파했습니다.': "Into the enemy's base, where 470 ships lay at anchor: about 100 destroyed.",
  '조선 수군이 무너진 새벽의 기습. 포위를 뚫고 한 척이라도 더 살려야 합니다.': 'The dawn ambush that destroyed the Joseon navy. Break out and save every ship you can.',
  '13척으로 133척을 막아 낸 해전. 물살이 바뀔 때까지 버텨야 합니다.': 'Thirteen ships against 133. Hold the strait until the tide turns.',
  '임진왜란의 마지막 해전. 조선·명 수군이 500여 척과 밤새 맞붙었습니다.': "The war's last battle: the Joseon and Ming fleets against 500 Japanese ships through the night.",

  // The loading page's own tip for Myeongnyang
  '울돌목의 물살': 'The Uldolmok current',
  '물살은 때에 따라 방향이 바뀝니다. 물살이 일본 함대를 거슬러 흐르기 시작하면 형세가 뒤집힙니다.': 'The current turns with the tide. Once it runs against the Japanese fleet, the battle turns too.',

  // Sharing a battle from its briefing
  '공유': 'Share',
  '링크를 복사했습니다': 'Link copied',
  '링크를 복사해 보낼 수 있습니다': 'Copy the link to send it',
};
