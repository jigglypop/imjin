// The addresses of the main screens and of the historical battles. The app keeps the address and the screen in step
// (src/router.ts); the build writes one page per address so a shared link previews in its own language with its own
// picture (vite.config.ts), and the deploy uploads those pages (scripts/route-pages.mjs). No imports: the Vite config
// and plain Node scripts load this file as it is.

/** The screens with an address. A battle in progress has none: it opens over the screen it was started from. */
export type RouteScreen = 'menu' | 'faction' | 'skirmish' | 'select' | 'online' | 'settings' | 'codex';
/** The Korean edition is unprefixed; the English one lives under /en. */
export type Edition = 'ko' | 'en';

/** Each screen's address in the Korean edition, and its name (Korean source text, translated through t()). */
export const ROUTES: readonly { screen: RouteScreen; slug: string; name: string }[] = [
  { screen: 'menu', slug: '', name: '임진왜란' },
  { screen: 'faction', slug: 'campaign', name: '캠페인' },
  { screen: 'skirmish', slug: 'conquest', name: '쟁탈전' },
  { screen: 'select', slug: 'battles', name: '역사 전투' },
  { screen: 'online', slug: 'online', name: '온라인 대전' },
  { screen: 'settings', slug: 'settings', name: '설정' },
  { screen: 'codex', slug: 'ships', name: '함선 도감' },
];

/**
 * The historical battles, each with an address of its own: /battles/hansan opens the history screen on Hansan's
 * briefing. They are the scenario ids of src/sim/scenarios.ts in SCENARIO_ORDER (ScenarioId is this type, and
 * scripts/test-sim.mjs keeps the order the same); a literal list here because this file takes no imports.
 */
export const BATTLE_SLUGS = ['okpo', 'sacheon', 'dangpo', 'hansan', 'angolpo', 'busan', 'chilcheon', 'myeongnyang', 'noryang'] as const;
export type BattleSlug = (typeof BATTLE_SLUGS)[number];

export function isBattleSlug(slug: string | undefined): slug is BattleSlug {
  return !!slug && (BATTLE_SLUGS as readonly string[]).includes(slug);
}

const BY_SLUG = new Map(ROUTES.map((r) => [r.slug, r.screen]));
const BY_SCREEN = new Map(ROUTES.map((r) => [r.screen, r]));

export function isRouteScreen(screen: string): screen is RouteScreen {
  return BY_SCREEN.has(screen as RouteScreen);
}

/** The screen's name: Korean source text for t(). */
export function routeName(screen: RouteScreen): string {
  return BY_SCREEN.get(screen)!.name;
}

/**
 * The address of a screen in one edition: /campaign and /en/campaign; the menu is / and /en. The history screen may
 * name the battle it shows: /battles/hansan and /en/battles/hansan.
 */
export function routePath(screen: RouteScreen, edition: Edition, battle?: BattleSlug | null): string {
  const slug = BY_SCREEN.get(screen)!.slug;
  const path = edition === 'ko' ? `/${slug}` : slug ? `/en/${slug}` : '/en';
  return screen === 'select' && battle ? `${path}/${battle}` : path;
}

export type ParsedRoute = {
  screen: RouteScreen;
  /** The edition the path names (/en or /ko in front), or null for an unprefixed path. */
  edition: Edition | null;
  /** False when the path names no screen, or a battle that does not exist: the menu, or the history screen, opens instead. */
  known: boolean;
  /** The battle a /battles/<id> path names; absent on every other path. */
  battle?: BattleSlug;
};

/**
 * The screen and edition a path asks for. The static host answers for every page at /campaign, /campaign/ and
 * /campaign/index.html, so a trailing slash and index.html mean the same page. /ko names the Korean edition explicitly.
 * Only the history screen takes a second segment, and it must be a battle: /battles/nowhere opens the history screen.
 */
export function parseRoute(pathname: string): ParsedRoute {
  const parts = pathname.replace(/\/index\.html$/, '').split('/').filter(Boolean);
  const edition = parts[0] === 'en' || parts[0] === 'ko' ? (parts.shift() as Edition) : null;
  const screen = parts.length === 0 ? 'menu' : BY_SLUG.get(parts[0]!);
  if (screen && parts.length <= 1) return { screen, edition, known: true };
  if (screen === 'select' && parts.length === 2) return isBattleSlug(parts[1]) ? { screen, edition, known: true, battle: parts[1] } : { screen, edition, known: false };
  return { screen: 'menu', edition, known: false };
}

/**
 * The language a page opens in: ?lang= first, then the edition the path names, then the choice stored on this device,
 * then the browser's language (Korean browsers get Korean, every other browser English).
 */
export function pickEdition(query: string | null, path: Edition | null, stored: Edition | null, browser: string): Edition {
  if (query === 'ko' || query === 'en') return query;
  return path ?? stored ?? (browser.toLowerCase().startsWith('ko') ? 'ko' : 'en');
}

/**
 * Query parameters that start a battle when the page loads (test hooks, see src/ui/launch.ts and BattleView). They are
 * dropped from the address once the player moves to another screen, so a reload does not start the battle again.
 * Every other parameter (lang, q, lv, webgl, map, hud, dpr, sky, sea, paused and the other switches) stays.
 */
export const LAUNCH_PARAMS: readonly string[] = ['scenario', 'side', 'conquest', 'me', 'foe', 'size', 'seed', 'gallery', 'kind', 'cam', 'follow', 'dist', 'pitch', 'yaw', 'warm', 'cine', 'tutorial'];

/** `search` ('' or '?a=1&b=2') without the named parameters. The rest keeps its exact spelling and order. */
export function withoutParams(search: string, names: readonly string[]): string {
  const keyOf = (pair: string) => {
    const raw = pair.split('=')[0]!.replace(/\+/g, ' ');
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  };
  const kept = search.replace(/^\?/, '').split('&').filter((pair) => pair && !names.includes(keyOf(pair)));
  return kept.length ? `?${kept.join('&')}` : '';
}

/**
 * The link-preview card of a page, under public/: a battle's own scene, or the front page's turtle ship for every
 * other page. 1200x600, the two-to-one shape KakaoTalk shows uncropped (scripts/build-battle-art.mjs composes them).
 * KakaoTalk keeps a picture for days on its servers and on each phone, so a new picture takes a new name: raise the
 * card's version here when its picture changes.
 */
export const CARD_SIZE = { width: 1200, height: 600 } as const;
const CARD_VERSION: Record<BattleSlug | 'front', number> = { front: 1, okpo: 1, sacheon: 1, dangpo: 1, hansan: 1, angolpo: 1, busan: 1, chilcheon: 1, myeongnyang: 1, noryang: 1 };

export function cardFile(battle: BattleSlug | null, edition: Edition): string {
  const id = battle ?? 'front';
  return `og/${id}-${edition}-v${CARD_VERSION[id]}.jpg`;
}

/** One page of the built site: its address, its file under dist/ and the storage keys that answer for it. */
export type RoutePage = { screen: RouteScreen; edition: Edition; path: string; file: string; keys: string[]; battle?: BattleSlug };

/**
 * Every page the build writes. The bucket behind the site has no directory index, so each page is stored under its
 * bare path, the path with a slash and the path's index.html; the Korean menu is the bucket's root object. Each
 * historical battle has a page of its own in both editions.
 */
export function routePages(): RoutePage[] {
  const editions: Edition[] = ['ko', 'en'];
  const page = (screen: RouteScreen, edition: Edition, battle?: BattleSlug): RoutePage => {
    const path = routePath(screen, edition, battle);
    const dir = path.slice(1);
    const file = dir ? `${dir}/index.html` : 'index.html';
    return { screen, edition, path, file, keys: dir ? [dir, `${dir}/`, file] : [file], ...(battle ? { battle } : {}) };
  };
  return editions.flatMap((edition) => [...ROUTES.map(({ screen }) => page(screen, edition)), ...BATTLE_SLUGS.map((battle) => page('select', edition, battle))]);
}
