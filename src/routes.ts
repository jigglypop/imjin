// The addresses of the main screens. The app keeps the address and the screen in step (src/router.ts); the build
// writes one page per address so a shared link previews in its own language (vite.config.ts), and the deploy uploads
// those pages (scripts/route-pages.mjs). No imports: the Vite config and plain Node scripts load this file as it is.

/** The screens with an address. A battle has none: it opens over the screen it was started from. */
export type RouteScreen = 'menu' | 'faction' | 'skirmish' | 'select' | 'online' | 'settings';
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
];

const BY_SLUG = new Map(ROUTES.map((r) => [r.slug, r.screen]));
const BY_SCREEN = new Map(ROUTES.map((r) => [r.screen, r]));

export function isRouteScreen(screen: string): screen is RouteScreen {
  return BY_SCREEN.has(screen as RouteScreen);
}

/** The screen's name: Korean source text for t(). */
export function routeName(screen: RouteScreen): string {
  return BY_SCREEN.get(screen)!.name;
}

/** The address of a screen in one edition: /campaign and /en/campaign; the menu is / and /en. */
export function routePath(screen: RouteScreen, edition: Edition): string {
  const slug = BY_SCREEN.get(screen)!.slug;
  if (edition === 'ko') return `/${slug}`;
  return slug ? `/en/${slug}` : '/en';
}

export type ParsedRoute = {
  screen: RouteScreen;
  /** The edition the path names (/en or /ko in front), or null for an unprefixed path. */
  edition: Edition | null;
  /** False when the path names no screen: the menu opens instead. */
  known: boolean;
};

/**
 * The screen and edition a path asks for. The static host answers for every page at /campaign, /campaign/ and
 * /campaign/index.html, so a trailing slash and index.html mean the same page. /ko names the Korean edition explicitly.
 */
export function parseRoute(pathname: string): ParsedRoute {
  const parts = pathname.replace(/\/index\.html$/, '').split('/').filter(Boolean);
  const edition = parts[0] === 'en' || parts[0] === 'ko' ? (parts.shift() as Edition) : null;
  const screen = parts.length === 0 ? 'menu' : parts.length === 1 ? BY_SLUG.get(parts[0]!) : undefined;
  return screen ? { screen, edition, known: true } : { screen: 'menu', edition, known: false };
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
export const LAUNCH_PARAMS: readonly string[] = ['scenario', 'side', 'conquest', 'me', 'foe', 'size', 'seed', 'gallery', 'cam', 'follow', 'dist', 'pitch', 'yaw', 'warm', 'cine', 'tutorial'];

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

/** One page of the built site: its address, its file under dist/ and the storage keys that answer for it. */
export type RoutePage = { screen: RouteScreen; edition: Edition; path: string; file: string; keys: string[] };

/**
 * Every page the build writes. The bucket behind the site has no directory index, so each page is stored under its
 * bare path, the path with a slash and the path's index.html; the Korean menu is the bucket's root object.
 */
export function routePages(): RoutePage[] {
  const editions: Edition[] = ['ko', 'en'];
  return editions.flatMap((edition) =>
    ROUTES.map(({ screen }) => {
      const path = routePath(screen, edition);
      const dir = path.slice(1);
      const file = dir ? `${dir}/index.html` : 'index.html';
      return { screen, edition, path, file, keys: dir ? [dir, `${dir}/`, file] : [file] };
    }),
  );
}
