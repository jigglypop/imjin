import { getLang, t, useLangStore } from './i18n';
import { LAUNCH_PARAMS, parseRoute, routeName, routePath, withoutParams, type RouteScreen } from './routes';
import { useUi, type BattleOrigin, type Screen } from './state/store';

// The address bar and the screen move together. Opening a screen pushes its address (/campaign, /en/conquest), and the
// browser's back and forward buttons open the screen of the address they land on. A battle has no address of its own:
// it opens over the screen it was started from and leaves the address as it was.

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
 * place to that one form. `battle`: a test hook in the query (?scenario=, ?conquest=) boots straight into a battle,
 * which returns to the address's screen when a battle can be started there.
 */
export function startRouter(battle: boolean) {
  const route = parseRoute(location.pathname);
  rewrite(route.screen, location.search);
  const origin = ORIGINS.find((o) => o === route.screen);
  useUi.setState(battle ? { screen: 'battle', ...(origin ? { origin } : {}) } : { screen: route.screen });
  showHead();

  useUi.subscribe((state, previous) => {
    if (state.screen === previous.screen || following || state.screen === 'battle') return;
    open(state.screen);
  });

  // Settings switched the language: the same page in the other edition. A ?lang= would now contradict the path, so it
  // goes; the choice itself is stored by setLang.
  useLangStore.subscribe((state, previous) => {
    if (state.lang === previous.lang) return;
    rewrite(parseRoute(location.pathname).screen, withoutParams(location.search, ['lang']));
    showHead();
  });

  window.addEventListener('popstate', () => {
    const { screen } = parseRoute(location.pathname);
    // An entry made before a language switch still names the old edition: the language stays as chosen and the
    // address follows it. Landing anywhere is moving on, so the launch hooks go too.
    rewrite(screen, withoutParams(location.search, LAUNCH_PARAMS));
    following = true;
    try {
      if (useUi.getState().screen === 'battle') leaveBattle?.();
      useUi.setState({ screen });
    } finally {
      following = false;
    }
    showHead();
  });
}

/** Replaces the current entry's address with `screen` in the language on screen, when it differs. */
function rewrite(screen: RouteScreen, search: string) {
  const next = routePath(screen, getLang()) + search + location.hash;
  if (next !== location.pathname + location.search + location.hash) history.replaceState(history.state, '', next);
}

/**
 * A screen the player opened: a new entry, unless the address already shows that screen (a battle returning to the
 * screen it was started from). The launch hooks go either way, so a reload does not start the test battle again.
 */
function open(screen: RouteScreen) {
  const path = routePath(screen, getLang());
  const search = withoutParams(location.search, LAUNCH_PARAMS);
  if (path === location.pathname) rewrite(screen, search);
  else history.pushState(null, '', path + search);
  showHead();
}

/** The tab title names the page in the address; the description and the home-screen name follow the language. */
function showHead() {
  const { screen } = parseRoute(location.pathname);
  const site = t('임진왜란');
  document.title = screen === 'menu' ? site : `${t(routeName(screen))} · ${site}`;
  document.querySelector('meta[name="description"]')?.setAttribute('content', t('1592, 조선 수군의 바다. 3D 해전 전략 게임.'));
  document.querySelector('meta[name="apple-mobile-web-app-title"]')?.setAttribute('content', site);
}
