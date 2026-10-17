// The addresses of the main screens and of the historical battles. The app keeps the address and the screen in step
// (src/router.ts); the build writes one page per address so a shared link previews in its own language with its own
// picture (vite.config.ts), and the deploy uploads those pages (scripts/route-pages.mjs). No imports: the Vite config
// and plain Node scripts load this file as it is.

/** The screens with an address. A battle in progress has none: it opens over the screen it was started from. */
export type RouteScreen = 'menu' | 'faction' | 'skirmish' | 'select' | 'online' | 'settings' | 'codex' | 'generals';
/** The Korean edition is unprefixed; the English one lives under /en. */
export type Edition = 'ko' | 'en';

/** The series and this chapter, as page titles and the tab show them; the English edition translates it (i18n common). */
export const SITE_NAME = 'MOONWAKE: 임진왜란';

/** Each screen's address in the Korean edition, and its name (Korean source text, translated through t()). */
export const ROUTES: readonly { screen: RouteScreen; slug: string; name: string }[] = [
  { screen: 'menu', slug: '', name: '임진왜란' },
  { screen: 'faction', slug: 'campaign', name: '캠페인' },
  { screen: 'skirmish', slug: 'conquest', name: '쟁탈전' },
  { screen: 'select', slug: 'battles', name: '역사 전투' },
  { screen: 'online', slug: 'online', name: '온라인 대전' },
  { screen: 'settings', slug: 'settings', name: '설정' },
  { screen: 'codex', slug: 'ships', name: '함선 도감' },
  { screen: 'generals', slug: 'generals', name: '장수' },
];

/**
 * The historical battles, each with an address of its own: /battles/hansan opens the history screen on Hansan's
 * briefing. They are the scenario ids of src/sim/scenarios.ts in SCENARIO_ORDER (ScenarioId is this type, and
 * scripts/test-sim.mjs keeps the order the same); a literal list here because this file takes no imports.
 */
export const BATTLE_SLUGS = ['okpo', 'sacheon', 'dangpo', 'hansan', 'angolpo', 'busan', 'chilcheon', 'myeongnyang', 'noryang'] as const;

/**
 * The chapters of the MOONWAKE series. The first (임진왜란) is the main one and lives at the site's root; every other
 * chapter's pages live under its id (/armada, /armada/battles/gravelines, /en/armada). The chapter registry with its
 * names, navies and ships is src/chapters; this file keeps only the ids and battle slugs, since it takes no imports.
 */
export const CHAPTER_IDS = ['imjin', 'armada', 'lepanto', 'trafalgar'] as const;
export type ChapterId = (typeof CHAPTER_IDS)[number];
export const MAIN_CHAPTER: ChapterId = 'imjin';
const PREFIXED: readonly string[] = CHAPTER_IDS.filter((c) => c !== MAIN_CHAPTER);
export const isChapterId = (id: string | undefined): id is ChapterId => !!id && (CHAPTER_IDS as readonly string[]).includes(id);

/** The historical battles of each later chapter, in order. */
export const CHAPTER_BATTLES = {
  armada: ['plymouth', 'portland', 'wight', 'calais', 'gravelines'],
  lepanto: ['preveza', 'djerba', 'lepanto-north', 'lepanto-centre', 'lepanto-south'],
  trafalgar: ['st-vincent', 'nile', 'finisterre', 'trafalgar-weather', 'trafalgar-lee'],
} as const;
export type ArmadaSlug = (typeof CHAPTER_BATTLES.armada)[number];
export type LepantoSlug = (typeof CHAPTER_BATTLES.lepanto)[number];
export type TrafalgarSlug = (typeof CHAPTER_BATTLES.trafalgar)[number];
export type BattleSlug = (typeof BATTLE_SLUGS)[number] | ArmadaSlug | LepantoSlug | TrafalgarSlug;
/** The battles of a chapter, the first chapter's included. */
export const battlesOf = (chapter: ChapterId): readonly BattleSlug[] => (chapter === 'imjin' ? BATTLE_SLUGS : CHAPTER_BATTLES[chapter]);
export const chapterOfBattle = (slug: BattleSlug): ChapterId => (CHAPTER_IDS.find((c) => c !== MAIN_CHAPTER && (battlesOf(c) as readonly string[]).includes(slug)) ?? MAIN_CHAPTER);

export function isBattleSlug(slug: string | undefined, chapter: ChapterId = MAIN_CHAPTER): slug is BattleSlug {
  return !!slug && (battlesOf(chapter) as readonly string[]).includes(slug);
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
export function routePath(screen: RouteScreen, edition: Edition, battle?: BattleSlug | null, chapter: ChapterId = battle ? chapterOfBattle(battle) : MAIN_CHAPTER): string {
  const parts = [edition === 'en' ? 'en' : '', chapter === MAIN_CHAPTER ? '' : chapter, BY_SCREEN.get(screen)!.slug, screen === 'select' && battle ? battle : ''].filter(Boolean);
  return `/${parts.join('/')}`;
}

export type ParsedRoute = {
  screen: RouteScreen;
  /** The edition the path names (/en or /ko in front), or null for an unprefixed path. */
  edition: Edition | null;
  /** False when the path names no screen, or a battle that does not exist: the menu, or the history screen, opens instead. */
  known: boolean;
  /** The battle a /battles/<id> path names; absent on every other path. */
  battle?: BattleSlug;
  /** The chapter a prefixed path names (/armada/...); absent for the main chapter. */
  chapter?: ChapterId;
};

/**
 * The screen and edition a path asks for. The static host answers for every page at /campaign, /campaign/ and
 * /campaign/index.html, so a trailing slash and index.html mean the same page. /ko names the Korean edition explicitly.
 * Only the history screen takes a second segment, and it must be a battle: /battles/nowhere opens the history screen.
 */
export function parseRoute(pathname: string): ParsedRoute {
  const parts = pathname.replace(/\/index\.html$/, '').split('/').filter(Boolean);
  const edition = parts[0] === 'en' || parts[0] === 'ko' ? (parts.shift() as Edition) : null;
  const named = PREFIXED.includes(parts[0]!) ? (parts.shift() as ChapterId) : null;
  const chapter = named ?? MAIN_CHAPTER;
  const tag = named ? { chapter: named } : {};
  const screen = parts.length === 0 ? 'menu' : BY_SLUG.get(parts[0]!);
  if (screen && parts.length <= 1) return { screen, edition, known: true, ...tag };
  if (screen === 'select' && parts.length === 2) return isBattleSlug(parts[1], chapter) ? { screen, edition, known: true, battle: parts[1], ...tag } : { screen, edition, known: false, ...tag };
  return { screen: 'menu', edition, known: false, ...tag };
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
const CARD_VERSION: Partial<Record<BattleSlug | 'front', number>> & Record<(typeof BATTLE_SLUGS)[number] | 'front', number> = {
  front: 1, okpo: 1, sacheon: 1, dangpo: 1, hansan: 1, angolpo: 1, busan: 1, chilcheon: 1, myeongnyang: 1, noryang: 1,
  // The later chapters' battles that have their own cards so far (scripts/build-battle-art.mjs); the rest share the front card.
  plymouth: 1, calais: 1, gravelines: 1, preveza: 1, djerba: 1, 'lepanto-north': 1, 'lepanto-south': 1,
};

export function cardFile(battle: BattleSlug | null, edition: Edition): string {
  // A later chapter's battles have no cards of their own yet: they share the front card.
  const id = battle && battle in CARD_VERSION ? battle : 'front';
  return `og/${id}-${edition}-v${CARD_VERSION[id]!}.jpg`;
}

/** One page of the built site: its address, its file under dist/ and the storage keys that answer for it. */
export type RoutePage = { screen: RouteScreen; edition: Edition; path: string; file: string; keys: string[]; battle?: BattleSlug; chapter?: ChapterId };

/**
 * Every page the build writes. The bucket behind the site has no directory index, so each page is stored under its
 * bare path, the path with a slash and the path's index.html; the Korean menu is the bucket's root object. Each
 * historical battle has a page of its own in both editions.
 */
export function routePages(): RoutePage[] {
  const editions: Edition[] = ['ko', 'en'];
  const page = (screen: RouteScreen, edition: Edition, battle?: BattleSlug, chapter: ChapterId = MAIN_CHAPTER): RoutePage => {
    const path = routePath(screen, edition, battle, chapter);
    const dir = path.slice(1);
    const file = dir ? `${dir}/index.html` : 'index.html';
    return { screen, edition, path, file, keys: dir ? [dir, `${dir}/`, file] : [file], ...(battle ? { battle } : {}), ...(chapter !== MAIN_CHAPTER ? { chapter } : {}) };
  };
  // A later chapter has its own front page, history screen and battle pages; the other screens are the series' own.
  const chapterPages = (edition: Edition) =>
    PREFIXED.flatMap((c) => [page('menu', edition, undefined, c as ChapterId), page('select', edition, undefined, c as ChapterId), ...battlesOf(c as ChapterId).map((battle) => page('select', edition, battle, c as ChapterId))]);
  return editions.flatMap((edition) => [...ROUTES.map(({ screen }) => page(screen, edition)), ...BATTLE_SLUGS.map((battle) => page('select', edition, battle)), ...chapterPages(edition)]);
}
