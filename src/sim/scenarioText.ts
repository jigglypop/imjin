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
  // The Armada chapter, 1588.
  plymouth: { title: '플리머스 해전', hanja: 'Plymouth', date: '1588년 7월 31일', place: '플리머스 앞바다 · 에디스톤', hook: '바람 위를 잡은 잉글랜드 함대가 무적함대의 초승달 진형을 멀리서 포격했습니다.' },
  portland: { title: '포틀랜드 해전', hanja: 'Portland Bill', date: '1588년 8월 2일', place: '포틀랜드 곶', hook: '곶 안쪽에 고립된 프로비셔를 갈레아스가 덮칩니다. 바람이 바뀔 때까지 버텨야 합니다.' },
  wight: { title: '와이트섬 해전', hanja: 'Isle of Wight', date: '1588년 8월 4일', place: '와이트섬 앞바다 · 오워스', hook: '솔렌트로 들어가려는 무적함대를 네 개 전대로 막아 모래톱 쪽으로 몰아냈습니다.' },
  calais: { title: '칼레 화공', hanja: 'Calais', date: '1588년 8월 7–8일', place: '칼레 앞바다', hook: '한밤중 불붙은 배 8척이 정박한 무적함대를 덮쳐 진형을 무너뜨렸습니다.' },
  gravelines: { title: '그라블린 해전', hanja: 'Gravelines', date: '1588년 8월 8일', place: '그라블린 앞바다 · 플랑드르 모래톱', hook: '아르마다 전쟁의 결전. 잉글랜드 함대가 처음으로 가까이 붙어 포를 쏘았습니다.' },
  // The Lepanto chapter, 1538-1571.
  preveza: { title: '프레베자 해전', hanja: 'Preveza', date: '1538년 9월 28일', place: '프레베자 · 아르타 만 입구', hook: '바람이 잦아든 바다에서 바르바로사의 갤리선이 도리아의 연합 함대를 몰아냈습니다.' },
  djerba: { title: '제르바 해전', hanja: 'Djerba', date: '1560년 5월 11–14일', place: '제르바 섬 앞바다', hook: '물을 싣던 기독교 함대를 피얄레 파샤가 덮쳤습니다. 흩어진 갤리선을 한 척이라도 더 살려야 합니다.' },
  'lepanto-north': { title: '레판토 해전 · 북쪽 날개', hanja: 'Lepanto · Ala sinistra', date: '1571년 10월 7일', place: '파트라스 만 · 아이톨리아 해안', hook: '해안에 붙은 바르바리고의 베네치아 갤리선을 시로코가 얕은 물길로 돌아 칩니다.' },
  'lepanto-centre': { title: '레판토 해전 · 중앙', hanja: 'Lepanto · Battaglia', date: '1571년 10월 7일', place: '파트라스 만 · 쿠르촐라리 앞바다', hook: '라 레알호와 술타나호가 이물을 맞댄 레판토의 결전.' },
  'lepanto-south': { title: '레판토 해전 · 남쪽 날개', hanja: 'Lepanto · Corno destro', date: '1571년 10월 7일', place: '파트라스 만 · 바다 쪽', hook: '도리아와 울루치 알리가 서로 바다 쪽으로 돌다 틈이 벌어졌습니다.' },
} satisfies Record<string, ScenarioText>;
