import { getLang, t, useLangStore } from './i18n';
import { LAUNCH_PARAMS, MAIN_CHAPTER, SITE_NAME, chapterOfBattle, parseRoute, routeName, routePath, withoutParams, type BattleSlug, type ChapterId, type RouteScreen } from './routes';
import { SCENARIO_TEXT } from './sim/scenarioText';
import { useUi, type BattleOrigin, type Screen } from './state/store';

// The address bar and the screen move together. Opening a screen pushes its address (/campaign, /en/conquest), and the
// browser's back and forward buttons open the screen of the address they land on. On the history screen a picked battle
// renames the address in place (/battles/hansan), so the address is always a link to the briefing on show and back
// still leaves the screen; leaving the screen forgets the pick (setScreen), so it opens on /battles the next time. A
// battle in progress has no address of its own: it opens over the screen it was started from and leaves the address
// as it was.

/**
 * The screens whose code is a chunk of its own, so the menu does not parse them. App renders them through React.lazy;
 * pointing at a menu button starts the download early (prefetchScreen).
 */
export const screenChunks = {
  faction: () => import('./ui/GrandScreen'),
  select: () => import('./ui/HistoryScreen'),
  skirmish: () => import('./ui/ConquestSetup'),
  online: () => import('./ui/OnlinePanel'),
  codex: () => import('./ui/codex/CodexScreen'),
  generals: () => import('./ui/generals/GeneralsScreen'),
  port: () => import('./ui/port/PortScreen'),
};

export function prefetchScreen(screen: Screen) {
  if (screen in screenChunks) void screenChunks[screen as keyof typeof screenChunks]();
}

/** Set while the router itself changes the screen (back and forward), so that change is not pushed as a new entry. */
let following = false;
/** Leaves the running battle the way the HUD's back button does; BattleView hands it over while a battle is mounted. */
let leaveBattle: (() => void) | null = null;

/** BattleView registers how to leave its battle, so the browser's back button does the same. Returns the unregister. */
export function onBattleBack(handler: () => void): () => void {
  leaveBattle = handler;
  return () => {
    if (leaveBattle === handler) leaveBattle = null;
  };
}

const ORIGINS: readonly BattleOrigin[] = ['select', 'skirmish', 'online', 'faction'];

/**
 * Reads the address at startup and keeps it in step from then on. Every page has one address per language: /ko/...,
 * a trailing slash, index.html, an unknown path, or an unprefixed path while the page is in English are rewritten in
 * place to that one form. A battle's address (/battles/hansan) opens the history screen on that battle's briefing.
 * `battle`: a test hook in the query (?scenario=, ?conquest=) boots straight into a battle, which returns to the
 * address's screen when a battle can be started there.
 */
export function startRouter(battle: boolean) {
  const route = parseRoute(location.pathname);
  const chapter = route.chapter ?? MAIN_CHAPTER;
  rewrite(route.screen, location.search, route.battle, chapter);
  const origin = ORIGINS.find((o) => o === route.screen);
  const picked = route.battle ?? null;
  useUi.setState(battle ? { screen: 'battle', battle: picked, chapter, ...(origin ? { origin } : {}) } : { screen: route.screen, battle: picked, chapter });
  showHead();

  useUi.subscribe((state, previous) => {
    if (following) return;
    if (state.screen !== previous.screen || state.chapter !== previous.chapter) {
      if (state.screen !== 'battle') open(state.screen, state.battle, state.chapter);
    } else if (state.screen === 'select' && state.battle !== previous.battle) {
      rewrite('select', withoutParams(location.search, LAUNCH_PARAMS), state.battle, state.chapter);
      showHead();
    }
  });

  // Settings switched the language: the same page in the other edition. A ?lang= would now contradict the path, so it
  // goes; the choice itself is stored by setLang.
  useLangStore.subscribe((state, previous) => {
    if (state.lang === previous.lang) return;
    const here = parseRoute(location.pathname);
    rewrite(here.screen, withoutParams(location.search, ['lang']), here.battle, here.chapter ?? MAIN_CHAPTER);
    showHead();
  });

  window.addEventListener('popstate', () => {
    const { screen, battle: named, chapter: prefix } = parseRoute(location.pathname);
    const chapter = prefix ?? MAIN_CHAPTER;
    // An entry made before a language switch still names the old edition: the language stays as chosen and the
    // address follows it. Landing anywhere is moving on, so the launch hooks go too.
    rewrite(screen, withoutParams(location.search, LAUNCH_PARAMS), named, chapter);
    following = true;
    try {
      if (useUi.getState().screen === 'battle') leaveBattle?.();
      useUi.setState({ screen, battle: named ?? null, chapter });
    } finally {
      following = false;
    }
    showHead();
  });
}

/** Replaces the current entry's address with `screen` (and the battle it names) in the language on screen, when it differs. */
function rewrite(screen: RouteScreen, search: string, battle?: BattleSlug | null, chapter: ChapterId = battle ? chapterOfBattle(battle) : MAIN_CHAPTER) {
  const next = routePath(screen, getLang(), battle, chapter) + search + location.hash;
  if (next !== location.pathname + location.search + location.hash) history.replaceState(history.state, '', next);
}

/**
 * A screen the player opened: a new entry, unless the address already shows that screen (a battle returning to the
 * screen it was started from). The launch hooks go either way, so a reload does not start the test battle again.
 */
function open(screen: RouteScreen, battle: BattleSlug | null, chapter: ChapterId) {
  // Only the menu, the history screen and the campaign are a chapter's own; the other screens are the series' and keep the root.
  const own = screen === 'menu' || screen === 'select' || screen === 'faction' ? chapter : MAIN_CHAPTER;
  const path = routePath(screen, getLang(), battle, own);
  const search = withoutParams(location.search, LAUNCH_PARAMS);
  if (path === location.pathname) rewrite(screen, search, battle, own);
  else history.pushState(null, '', path + search);
  showHead();
}

/** The tab title names the page in the address (a battle's page, its battle); the description and the home-screen name follow the language. */
function showHead() {
  const { screen, battle } = parseRoute(location.pathname);
  const site = t(SITE_NAME);
  const text = battle ? SCENARIO_TEXT[battle] : null;
  document.title = text ? `${t(text.title)} · ${site}` : screen === 'menu' ? site : `${t(routeName(screen))} · ${site}`;
  document.querySelector('meta[name="description"]')?.setAttribute('content', text ? t(text.hook) : t('1592, 조선 수군의 바다. 3D 해전 전략 게임.'));
  document.querySelector('meta[name="apple-mobile-web-app-title"]')?.setAttribute('content', 'MOONWAKE');
}
