/** English for the words every screen shares, keyed by the exact Korean source text. See ../index.ts and ../GLOSSARY.md. */
export const EN_COMMON: Record<string, string> = {
  // The game and its modes
  '임진왜란': 'The Imjin War',
  '역사 전투': 'Historical Battles',
  '캠페인': 'Campaign',
  '쟁탈전': 'Conquest',
  '온라인 대전': 'Online Battle',
  // The menu's tagline, and the line under each mode's name on its loading screen and link-preview card
  // (src/routes.ts; the build reads these for the pages' boot screens, see vite.config.ts)
  '나라를 지킨 바다': 'The sea that held a kingdom',
  '한 나라를 이끌고 남해안의 포구를 차지하라': "Lead one nation and take the ports of Korea's south coast",
  '거점을 지켜 적의 기세를 꺾어라': "Hold the ports and break the enemy's will",
  '옥포에서 노량까지, 아홉 해전을 직접 지휘하라': 'From Okpo to Noryang: command nine naval battles',
  '다른 제독과 실시간으로 겨루는 해전': 'Naval battles in real time against other admirals',
  '소리 · 화질 · 언어 · 조작 안내': 'Sound · graphics · language · controls',

  // Navigation and actions
  '뒤로': 'Back',
  '설정': 'Settings',
  '확인': 'OK',
  '취소': 'Cancel',
  '닫기': 'Close',
  '시작': 'Start',
  '전투 시작': 'Start battle',
  '다시 시작': 'Restart',
  '나가기': 'Leave',
  '저장': 'Save',
  '계속': 'Continue',
  '완료': 'Done',
  '더 보기': 'More',
  '메뉴로': 'Back to menu',
  '새로고침': 'Reload',

  // Sides
  '조선': 'Joseon',
  '일본': 'Japan',
  '명': 'Ming',
  '조선 수군': 'Joseon Navy',
  '일본 수군': 'Japanese Navy',
  '명 수군': 'Ming Navy',

  // Results
  '승리': 'Victory',
  '패배': 'Defeat',
  '무승부': 'Draw',
  '무승부입니다. 함대를 정비한 뒤 다시 싸울 수 있습니다.': 'A draw. Refit the fleet, then try again.',

  // Device tiers (the graphics level names 낮음/보통/높음 belong to the battle sheet; 보통 is also a difficulty in sim data)
  '자동': 'Auto',
  '태블릿': 'Tablet',
  '스마트폰': 'Phone',

  // Units and shared terms
  '{n}척': 'Ships: {n}',
  '{n}명': '{n} men',
  '군영': 'Camp',
  '거점': 'Capture point',
  '군자금': 'Funds',
  '은': 'Silver',
  '기세': 'Momentum',
  '함대': 'Fleet',
  '장수': 'Commanders',
  '바다를 준비하는 중': 'Preparing the sea',
  '하늘을 불러오지 못했습니다': 'Could not load the sky',
  '가장 낮음': 'Lowest',
  '가장 높음': 'Highest',
};
