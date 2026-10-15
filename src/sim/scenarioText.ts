// What the nine historical battles are called and what one line says about each, with nothing heavy attached: the tab
// titles (src/router.ts), the link-preview pages (vite.config.ts) and the battle cards (scripts/build-battle-art.mjs)
// read it without pulling in the sim. src/sim/scenarios.ts spreads each entry into its ScenarioInfo, so the text lives
// in one place. No imports: the Vite config and Node scripts load this file as it is. Every battle id of src/routes.ts
// must have an entry, which the readers' lookups by BattleSlug check.

export type ScenarioText = {
  /** Source text for t(); the English is in src/i18n/en/sim.ts. */
  title: string;
  hanja: string;
  date: string;
  place: string;
  /**
   * One sentence on what happened, for the link preview and the loading page: KakaoTalk shows two lines under the
   * picture, about 48 Korean characters. The English is in src/i18n/en/briefing.ts.
   */
  hook: string;
};

export const SCENARIO_TEXT = {
  okpo: { title: '옥포 해전', hanja: '玉浦海戰', date: '1592년 5월 7일', place: '거제 옥포만', hook: '조선 수군의 첫 출전. 일본 함선 26척을 격파하고 한 척도 잃지 않았습니다.' },
  sacheon: { title: '사천 해전', hanja: '泗川海戰', date: '1592년 5월 29일', place: '사천 선창', hook: '거북선이 처음 실전에 나선 해전. 일본 함선 13척을 모두 격파했습니다.' },
  dangpo: { title: '당포 해전', hanja: '唐浦海戰', date: '1592년 6월 2일', place: '통영 당포', hook: '거북선이 누각 높은 일본 대장선을 들이받고 21척을 모두 격파했습니다.' },
  hansan: { title: '한산도 대첩', hanja: '閑山島大捷', date: '1592년 7월 8일', place: '견내량 · 한산도 앞바다', hook: '학익진으로 일본 함대를 에워싸 59척을 격침하거나 나포했습니다.' },
  angolpo: { title: '안골포 해전', hanja: '安骨浦海戰', date: '1592년 7월 10일', place: '진해 안골포', hook: '좁고 얕은 포구에 번갈아 들어가 총통을 쏘아 20여 척을 격파했습니다.' },
  busan: { title: '부산포 해전', hanja: '釜山浦海戰', date: '1592년 9월 1일', place: '부산포', hook: '470여 척이 정박한 적의 거점으로 돌입해 100여 척을 격파했습니다.' },
  chilcheon: { title: '칠천량 해전', hanja: '漆川梁海戰', date: '1597년 7월 16일', place: '거제 칠천량', hook: '조선 수군이 무너진 새벽의 기습. 포위를 뚫고 한 척이라도 더 살려야 합니다.' },
  myeongnyang: { title: '명량 해전', hanja: '鳴梁海戰', date: '1597년 9월 16일', place: '울돌목', hook: '13척으로 133척을 막아 낸 해전. 물살이 바뀔 때까지 버텨야 합니다.' },
  noryang: { title: '노량 해전', hanja: '露梁海戰', date: '1598년 11월 19일', place: '노량 해협 · 관음포', hook: '임진왜란의 마지막 해전. 조선·명 수군이 500여 척과 밤새 맞붙었습니다.' },
} satisfies Record<string, ScenarioText>;
