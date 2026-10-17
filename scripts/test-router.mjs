// The addresses of the main screens and the historical battles (src/routes.ts) and the router that keeps them in step
// with the screen (src/router.ts): parsing and formatting in both editions, the forms that are rewritten (/ko, a
// trailing slash, index.html, unknown paths), which language a page opens in, which query parameters outlive a
// navigation, the pages the build writes, and the history entries the router makes, driven through a fake address bar
// without a browser.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
let failures = 0;
const check = async (name, fn) => {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${name}`, error);
  }
};

/** A module graph bundled into one ES module and imported from memory; `fresh` gives the module state of a new page. */
let instances = 0;
async function load(contents, external = []) {
  const built = await build({
    stdin: { contents, resolveDir: root, loader: 'ts' },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    logLevel: 'silent',
    // The screens' own chunks are never fetched here.
    plugins: [{ name: 'screens', setup: (b) => b.onResolve({ filter: /^\.\/ui\// }, (args) => (args.kind === 'dynamic-import' ? { path: args.path, external: true } : undefined)) }],
    external,
  });
  const code = `${built.outputFiles[0].text}\n// page ${++instances}`;
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
}

const R = await load("export * from './src/routes';");
const { ROUTES, BATTLE_SLUGS, CHAPTER_BATTLES, LAUNCH_PARAMS, cardFile, parseRoute, pickEdition, routePages, routePath, withoutParams } = R;

const SCREENS = { menu: '', faction: 'campaign', skirmish: 'conquest', select: 'battles', online: 'online', settings: 'settings', codex: 'ships', generals: 'generals' };

await check('every screen has the agreed address in both editions', () => {
  assert.deepEqual(Object.fromEntries(ROUTES.map((r) => [r.screen, r.slug])), SCREENS);
  for (const [screen, slug] of Object.entries(SCREENS)) {
    assert.equal(routePath(screen, 'ko'), `/${slug}`);
    assert.equal(routePath(screen, 'en'), slug ? `/en/${slug}` : '/en');
  }
});

await check('parse and format round trip, with a trailing slash and index.html', () => {
  for (const screen of Object.keys(SCREENS)) {
    for (const edition of ['ko', 'en']) {
      const path = routePath(screen, edition);
      const named = edition === 'en' ? 'en' : null;
      const base = path === '/' ? '' : path;
      for (const form of [path, `${base}/`, `${base}/index.html`]) assert.deepEqual(parseRoute(form), { screen, edition: named, known: true }, form);
    }
  }
});

await check('/ko names the Korean edition and its one form is unprefixed', () => {
  for (const [screen, slug] of Object.entries(SCREENS)) {
    for (const form of [`/ko/${slug}`, `/ko/${slug}/`, `/ko/${slug ? `${slug}/` : ''}index.html`]) {
      const parsed = parseRoute(form);
      assert.deepEqual(parsed, { screen, edition: 'ko', known: true }, form);
      assert.equal(routePath(parsed.screen, 'ko'), `/${slug}`);
    }
  }
});

await check('unknown paths open the menu of the edition they name', () => {
  for (const path of ['/nowhere', '/campaign/extra', '/en/en', '/ko/en/campaign', '/Campaign', '/index.htm']) assert.deepEqual(parseRoute(path), { screen: 'menu', edition: path.startsWith('/en/') ? 'en' : path.startsWith('/ko/') ? 'ko' : null, known: false }, path);
  assert.equal(routePath(parseRoute('/en/nowhere').screen, 'en'), '/en');
  assert.equal(routePath(parseRoute('/nowhere').screen, 'ko'), '/');
});

await check('language: ?lang= beats the path, which beats the stored choice, which beats the browser', () => {
  assert.equal(pickEdition('en', 'ko', 'ko', 'ko-KR'), 'en');
  assert.equal(pickEdition('ko', 'en', 'en', 'en-US'), 'ko');
  assert.equal(pickEdition(null, 'en', 'ko', 'ko-KR'), 'en');
  assert.equal(pickEdition(null, 'ko', 'en', 'en-US'), 'ko');
  assert.equal(pickEdition(null, null, 'en', 'ko-KR'), 'en');
  assert.equal(pickEdition(null, null, 'ko', 'en-US'), 'ko');
  assert.equal(pickEdition(null, null, null, 'ko-KR'), 'ko');
  assert.equal(pickEdition(null, null, null, 'KO'), 'ko');
  assert.equal(pickEdition(null, null, null, 'en-GB'), 'en');
  assert.equal(pickEdition(null, null, null, ''), 'en');
  assert.equal(pickEdition('fr', null, null, 'ko-KR'), 'ko', 'an unknown ?lang= is ignored');
});

const SETTINGS = ['lang=en', 'q=low', 'lv=2', 'webgl=1', 'map=static', 'hud=0', 'dpr=1.5', 'sky=dusk', 'sea=rough', 'paused=1', 'music=0', 'clouds=0', 'ships=legacy', 'menuqa=1'];
const HOOKS = ['scenario=hansan', 'side=japan', 'conquest=hallyeo', 'me=ming', 'foe=japan', 'size=4', 'seed=7', 'gallery=1', 'kind=sekibune', 'cam=1,2,3,4,5', 'follow=3', 'dist=80', 'pitch=0.2', 'yaw=1', 'warm=5', 'cine=1', 'tutorial=1'];

await check('settings in the query outlive a navigation; the battle-launch hooks do not', () => {
  assert.deepEqual([...LAUNCH_PARAMS].sort(), HOOKS.map((p) => p.split('=')[0]).sort());
  const mixed = [HOOKS[0], ...SETTINGS.slice(0, 7), ...HOOKS.slice(1, 9), ...SETTINGS.slice(7), ...HOOKS.slice(9)];
  assert.equal(withoutParams(`?${mixed.join('&')}`, LAUNCH_PARAMS), `?${SETTINGS.join('&')}`);
  for (const hook of HOOKS) assert.equal(withoutParams(`?${hook}`, LAUNCH_PARAMS), '', hook);
  assert.equal(withoutParams('', LAUNCH_PARAMS), '');
  assert.equal(withoutParams('?sky=%ED%95%98&cam=1%2C2&x', LAUNCH_PARAMS), '?sky=%ED%95%98&x', 'the rest keeps its spelling');
  assert.equal(withoutParams('?lang=en&q=low', ['lang']), '?q=low');
});

await check('the build writes one page per address, uploaded under the bare path, the path with a slash and index.html', () => {
  const pages = routePages();
  // A later chapter adds its front page, its history screen and its battles.
  const chapterPages = Object.values(CHAPTER_BATTLES).reduce((n, list) => n + 2 + list.length, 0);
  assert.equal(pages.length, (ROUTES.length + BATTLE_SLUGS.length + chapterPages) * 2);
  assert.equal(new Set(pages.map((p) => p.file)).size, pages.length);
  const front = pages.find((p) => p.screen === 'menu' && p.edition === 'ko');
  assert.deepEqual(front, { screen: 'menu', edition: 'ko', path: '/', file: 'index.html', keys: ['index.html'] });
  assert.deepEqual(pages.find((p) => p.screen === 'menu' && p.edition === 'en').keys, ['en', 'en/', 'en/index.html']);
  assert.deepEqual(pages.find((p) => p.screen === 'faction' && p.edition === 'en'), { screen: 'faction', edition: 'en', path: '/en/campaign', file: 'en/campaign/index.html', keys: ['en/campaign', 'en/campaign/', 'en/campaign/index.html'] });
  assert.deepEqual(pages.find((p) => p.battle === 'hansan' && p.edition === 'en'), { screen: 'select', edition: 'en', path: '/en/battles/hansan', file: 'en/battles/hansan/index.html', keys: ['en/battles/hansan', 'en/battles/hansan/', 'en/battles/hansan/index.html'], battle: 'hansan' });
  for (const page of pages) {
    for (const key of page.keys) assert.deepEqual(parseRoute(`/${key}`), { screen: page.screen, edition: page.edition === 'en' ? 'en' : null, known: true, ...(page.battle ? { battle: page.battle } : {}), ...(page.chapter ? { chapter: page.chapter } : {}) }, key);
  }
});

await check('each historical battle has an address in both editions; the history screen alone takes one', () => {
  assert.deepEqual([...BATTLE_SLUGS], ['okpo', 'sacheon', 'dangpo', 'hansan', 'angolpo', 'busan', 'chilcheon', 'myeongnyang', 'noryang']);
  for (const battle of BATTLE_SLUGS) {
    assert.equal(routePath('select', 'ko', battle), `/battles/${battle}`);
    assert.equal(routePath('select', 'en', battle), `/en/battles/${battle}`);
    for (const form of [`/battles/${battle}`, `/battles/${battle}/`, `/battles/${battle}/index.html`, `/ko/battles/${battle}`]) {
      assert.deepEqual(parseRoute(form), { screen: 'select', edition: form.startsWith('/ko') ? 'ko' : null, known: true, battle }, form);
    }
    assert.deepEqual(parseRoute(`/en/battles/${battle}/`), { screen: 'select', edition: 'en', known: true, battle });
  }
  assert.equal(routePath('faction', 'ko', 'hansan'), '/campaign', 'only the history screen names a battle');
  assert.equal(routePath('select', 'ko', null), '/battles');
  assert.deepEqual(parseRoute('/battles/nowhere'), { screen: 'select', edition: null, known: false }, 'an unknown battle opens the history screen');
  assert.deepEqual(parseRoute('/en/battles/Hansan'), { screen: 'select', edition: 'en', known: false });
  for (const path of ['/battles/hansan/extra', '/campaign/hansan', '/hansan', '/en/hansan']) assert.deepEqual(parseRoute(path), { screen: 'menu', edition: path.startsWith('/en/') ? 'en' : null, known: false }, path);
});

await check('a later chapter lives under its id; the main chapter keeps the root', () => {
  assert.equal(routePath('menu', 'ko', null, 'armada'), '/armada');
  assert.equal(routePath('menu', 'en', null, 'armada'), '/en/armada');
  assert.equal(routePath('select', 'ko', 'gravelines'), '/armada/battles/gravelines');
  assert.equal(routePath('select', 'en', 'calais'), '/en/armada/battles/calais');
  assert.deepEqual(parseRoute('/armada'), { screen: 'menu', edition: null, known: true, chapter: 'armada' });
  assert.deepEqual(parseRoute('/en/armada/battles/plymouth/'), { screen: 'select', edition: 'en', known: true, battle: 'plymouth', chapter: 'armada' });
  assert.deepEqual(parseRoute('/battles/plymouth'), { screen: 'select', edition: null, known: false }, 'an Armada battle is not a 1592 battle');
  assert.deepEqual(parseRoute('/armada/battles/hansan'), { screen: 'select', edition: null, known: false, chapter: 'armada' });
  assert.deepEqual(parseRoute('/imjin'), { screen: 'menu', edition: null, known: false }, 'the main chapter has no prefix');
});

await check('every page has a two-to-one link card: its battle\'s own, or the front card', () => {
  assert.equal(cardFile(null, 'ko'), 'og/front-ko-v1.jpg');
  assert.equal(cardFile(null, 'en'), 'og/front-en-v1.jpg');
  const cards = new Set(routePages().map((p) => cardFile(p.battle ?? null, p.edition)));
  assert.equal(cards.size, (BATTLE_SLUGS.length + 1) * 2, 'a later chapter shares the front card for now');
  for (const battle of BATTLE_SLUGS) assert.match(cardFile(battle, 'en'), new RegExp(`^og/${battle}-en-v\\d+\\.jpg$`));
});

/**
 * A page at `url` with a fake address bar: history entries, back and forward (which fire popstate), the stored
 * language and the browser's language. Returns the router, store and i18n of that page, started.
 */
async function page(url, { stored = null, language = 'ko-KR', battle = false } = {}) {
  const site = 'https://imjin1592.com';
  const entries = [{ url: new URL(url, site), state: null }];
  let index = 0;
  const calls = { push: 0, replace: 0 };
  const popstate = [];
  const location = {};
  const show = () => {
    const at = entries[index].url;
    Object.assign(location, { href: at.href, pathname: at.pathname, search: at.search, hash: at.hash });
  };
  show();
  const go = (step) => {
    index += step;
    show();
    for (const listener of popstate) listener({ state: entries[index].state });
  };
  const history = {
    get state() {
      return entries[index].state;
    },
    pushState(state, _title, next) {
      calls.push += 1;
      entries.splice(index + 1, Infinity, { url: new URL(next, location.href), state });
      index += 1;
      show();
    },
    replaceState(state, _title, next) {
      calls.replace += 1;
      entries[index] = { url: new URL(next, location.href), state };
      show();
    },
    back: () => go(-1),
    forward: () => go(1),
  };
  const storage = new Map(stored ? [['imjin.lang', stored]] : []);
  const metas = {};
  globalThis.window = { addEventListener: (type, listener) => type === 'popstate' && popstate.push(listener) };
  globalThis.location = location;
  globalThis.history = history;
  globalThis.localStorage = { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)), removeItem: (k) => storage.delete(k) };
  globalThis.document = { title: '', documentElement: { lang: '' }, querySelector: (selector) => (metas[selector] ??= { setAttribute(name, value) { this[name] = value; } }) };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { language } });
  const app = await load("export { startRouter, onBattleBack } from './src/router'; export { useUi, setScreen, setOrigin, setBattle } from './src/state/store'; export { setLang, getLang } from './src/i18n';");
  app.startRouter(battle);
  return {
    ...app,
    history,
    calls,
    stored: () => storage.get('imjin.lang') ?? null,
    address: () => location.pathname + location.search,
    entries: () => entries.map((e) => e.url.pathname + e.url.search),
    screen: () => app.useUi.getState().screen,
    battle: () => app.useUi.getState().battle,
    title: () => document.title,
    description: () => metas['meta[name="description"]']?.content,
  };
}

await check('startup: the address opens its screen and is rewritten to its one form in the language on screen', async () => {
  const cases = [
    ['/campaign', {}, '/campaign', 'faction', '캠페인 · MOONWAKE: 임진왜란'],
    ['/ko/campaign/', {}, '/campaign', 'faction', '캠페인 · MOONWAKE: 임진왜란'],
    ['/ko', { stored: 'en' }, '/', 'menu', 'MOONWAKE: 임진왜란'],
    ['/campaign', { stored: 'en' }, '/en/campaign', 'faction', 'Campaign · MOONWAKE: The Imjin War'],
    ['/online', { language: 'en-US' }, '/en/online', 'online', 'Online Battle · MOONWAKE: The Imjin War'],
    ['/en/conquest', { stored: 'ko' }, '/en/conquest', 'skirmish', 'Conquest · MOONWAKE: The Imjin War'],
    ['/en/', {}, '/en', 'menu', 'MOONWAKE: The Imjin War'],
    ['/en/index.html', {}, '/en', 'menu', 'MOONWAKE: The Imjin War'],
    ['/battles/index.html', {}, '/battles', 'select', '역사 전투 · MOONWAKE: 임진왜란'],
    ['/settings?lang=en&q=low', {}, '/en/settings?lang=en&q=low', 'settings', 'Settings · MOONWAKE: The Imjin War'],
    ['/en/battles?lang=ko', {}, '/battles?lang=ko', 'select', '역사 전투 · MOONWAKE: 임진왜란'],
    ['/nowhere', {}, '/', 'menu', 'MOONWAKE: 임진왜란'],
    ['/en/nowhere/at/all', {}, '/en', 'menu', 'MOONWAKE: The Imjin War'],
  ];
  for (const [url, options, address, screen, title] of cases) {
    const p = await page(url, options);
    assert.equal(p.address(), address, url);
    assert.equal(p.screen(), screen, url);
    assert.equal(p.title(), title, url);
    assert.equal(document.documentElement.lang, address.startsWith('/en') ? 'en' : 'ko', url);
    assert.equal(p.calls.push, 0, url);
    assert.equal(p.calls.replace, url === address ? 0 : 1, `${url}: rewritten in place only when needed`);
    assert.equal(p.stored(), options.stored ?? null, `${url}: opening an address stores no choice`);
  }
});

await check('opening a screen pushes its address once; back and forward open the screen of the entry', async () => {
  const p = await page('/');
  p.setScreen('faction');
  assert.deepEqual(p.entries(), ['/', '/campaign']);
  assert.equal(p.title(), '캠페인 · MOONWAKE: 임진왜란');
  p.setScreen('faction');
  assert.equal(p.calls.push, 1, 'the same screen again makes no entry');
  p.setScreen('menu');
  p.setScreen('online');
  assert.deepEqual(p.entries(), ['/', '/campaign', '/', '/online']);
  p.history.back();
  assert.equal(p.screen(), 'menu');
  p.history.back();
  assert.equal(p.screen(), 'faction');
  assert.equal(p.title(), '캠페인 · MOONWAKE: 임진왜란');
  p.history.forward();
  p.history.forward();
  assert.equal(p.screen(), 'online');
  assert.equal(p.calls.push, 3, 'back and forward make no entries');
});

await check('a launch hook boots into the battle; the first navigation drops the hooks and keeps the settings', async () => {
  const p = await page('/?scenario=hansan&lang=ko&q=low&cam=1,2,3,4,5', { battle: true });
  assert.equal(p.screen(), 'battle');
  assert.equal(p.address(), '/?scenario=hansan&lang=ko&q=low&cam=1,2,3,4,5', 'a reload during the test battle starts it again');
  assert.equal(p.useUi.getState().origin, 'select');
  p.setScreen('select');
  assert.deepEqual(p.entries(), ['/?scenario=hansan&lang=ko&q=low&cam=1,2,3,4,5', '/battles?lang=ko&q=low']);
  p.history.back();
  assert.equal(p.screen(), 'menu');
  assert.equal(p.address(), '/?lang=ko&q=low', 'landing back on the hook entry does not arm it again');

  const q = await page('/conquest?conquest=hallyeo&me=ming&dpr=1', { battle: true });
  assert.equal(q.useUi.getState().origin, 'skirmish', 'the battle returns to the screen of its address');
  q.setScreen('skirmish');
  assert.deepEqual(q.entries(), ['/conquest?dpr=1'], 'the address already shows the screen: the hooks go in place');
});

await check('the back button during a battle leaves it like the HUD back button, then opens the entry it lands on', async () => {
  const p = await page('/');
  p.setScreen('skirmish');
  p.setOrigin('skirmish');
  p.setScreen('battle');
  assert.deepEqual(p.entries(), ['/', '/conquest'], 'a battle makes no entry');
  assert.equal(p.address(), '/conquest');
  const left = [];
  const unregister = p.onBattleBack(() => {
    left.push(p.screen());
    p.setScreen(p.useUi.getState().origin);
  });
  p.history.back();
  assert.deepEqual(left, ['battle'], 'the battle was left once');
  assert.equal(p.screen(), 'menu');
  assert.deepEqual(p.entries(), ['/', '/conquest'], 'leaving made no entry');
  unregister();

  p.history.forward();
  p.setScreen('battle');
  p.history.back();
  assert.equal(p.screen(), 'menu', 'without a mounted battle the entry still opens');
  assert.deepEqual(left, ['battle']);
});

await check('switching the language moves the address to the other edition and stores the choice', async () => {
  const p = await page('/settings?lang=ko&q=low');
  p.setLang('en');
  assert.equal(p.address(), '/en/settings?q=low', 'a ?lang= would contradict the path');
  assert.equal(p.stored(), 'en');
  assert.equal(p.title(), 'Settings · MOONWAKE: The Imjin War');
  assert.equal(document.documentElement.lang, 'en');
  assert.equal(p.calls.push, 0);
  p.setScreen('menu');
  assert.deepEqual(p.entries(), ['/en/settings?q=low', '/en?q=low']);
  p.setLang('ko');
  assert.deepEqual(p.entries(), ['/en/settings?q=low', '/?q=low']);
  p.history.back();
  assert.equal(p.address(), '/settings?q=low', 'an entry from before the switch follows the language on screen');
  assert.equal(p.getLang(), 'ko');
  assert.equal(p.screen(), 'settings');
});

await check("a battle's address opens the history screen on its briefing, not the battle", async () => {
  const cases = [
    ['/battles/hansan', {}, '/battles/hansan', 'hansan', '한산도 대첩 · MOONWAKE: 임진왜란'],
    ['/ko/battles/myeongnyang/', {}, '/battles/myeongnyang', 'myeongnyang', '명량 해전 · MOONWAKE: 임진왜란'],
    ['/battles/noryang/index.html', { stored: 'en' }, '/en/battles/noryang', 'noryang', 'Battle of Noryang · MOONWAKE: The Imjin War'],
    ['/en/battles/okpo', {}, '/en/battles/okpo', 'okpo', 'Battle of Okpo · MOONWAKE: The Imjin War'],
    ['/battles/nowhere', {}, '/battles', null, '역사 전투 · MOONWAKE: 임진왜란'],
    ['/battles/hansan/more', {}, '/', null, 'MOONWAKE: 임진왜란'],
  ];
  for (const [url, options, address, battle, title] of cases) {
    const p = await page(url, options);
    assert.equal(p.address(), address, url);
    assert.equal(p.screen(), battle || address === '/battles' ? 'select' : 'menu', url);
    assert.equal(p.battle(), battle, url);
    assert.equal(p.title(), title, url);
    assert.equal(p.calls.push, 0, url);
  }
  const p = await page('/battles/hansan');
  assert.equal(p.description(), '학익진으로 일본 함대를 에워싸 59척을 격침하거나 나포했습니다.', 'the description is the battle\'s line');
});

await check('picking a battle renames the address in place; back still leaves the screen', async () => {
  const p = await page('/');
  p.setScreen('select');
  assert.deepEqual(p.entries(), ['/', '/battles']);
  p.setBattle('okpo');
  p.setBattle('busan');
  assert.deepEqual(p.entries(), ['/', '/battles/busan'], 'picks make no entries');
  assert.equal(p.title(), '부산포 해전 · MOONWAKE: 임진왜란');
  p.history.back();
  assert.equal(p.screen(), 'menu');
  assert.equal(p.battle(), null);
  p.history.forward();
  assert.equal(p.screen(), 'select');
  assert.equal(p.battle(), 'busan', 'forward lands on the battle the entry names');
  assert.equal(p.calls.push, 1);
});

await check('leaving the history screen forgets the pick; it opens on /battles the next time', async () => {
  const p = await page('/battles/sacheon');
  p.setScreen('menu');
  assert.equal(p.battle(), null);
  assert.deepEqual(p.entries(), ['/battles/sacheon', '/']);
  p.setScreen('select');
  assert.deepEqual(p.entries(), ['/battles/sacheon', '/', '/battles']);
  p.history.back();
  p.history.back();
  assert.equal(p.battle(), 'sacheon', 'back to the shared address brings its battle back');
  assert.equal(p.title(), '사천 해전 · MOONWAKE: 임진왜란');
});

await check('a battle started from a briefing keeps its address and returns to it', async () => {
  const p = await page('/');
  p.setScreen('select');
  p.setBattle('dangpo');
  p.setOrigin('select');
  p.setScreen('battle');
  assert.equal(p.address(), '/battles/dangpo', 'the battle has no address of its own');
  assert.equal(p.battle(), 'dangpo');
  p.setScreen('select');
  assert.deepEqual(p.entries(), ['/', '/battles/dangpo'], 'coming back makes no entry');
  assert.equal(p.battle(), 'dangpo');

  const q = await page('/battles/okpo?scenario=okpo&side=japan&q=low', { battle: true });
  assert.equal(q.screen(), 'battle');
  assert.equal(q.battle(), 'okpo');
  q.setScreen('select');
  assert.deepEqual(q.entries(), ['/battles/okpo?q=low'], 'a hook battle on a battle address returns to that briefing, hooks dropped in place');
});

await check('switching the language keeps the battle in the address', async () => {
  const p = await page('/battles/chilcheon');
  p.setLang('en');
  assert.equal(p.address(), '/en/battles/chilcheon');
  assert.equal(p.title(), 'Battle of Chilcheollyang · MOONWAKE: The Imjin War');
  assert.equal(p.description(), 'The dawn ambush that destroyed the Joseon navy. Break out and save every ship you can.');
  p.setBattle('myeongnyang');
  assert.equal(p.address(), '/en/battles/myeongnyang');
  p.setScreen('menu');
  p.setLang('ko');
  p.history.back();
  assert.equal(p.address(), '/battles/myeongnyang', 'an entry from before the switch follows the language on screen');
  assert.equal(p.battle(), 'myeongnyang');
  assert.equal(p.calls.push, 1);
});

if (failures) {
  console.error(`${failures} router check(s) failed`);
  process.exit(1);
}
console.log('router: all checks passed');
