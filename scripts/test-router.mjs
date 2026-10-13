// The addresses of the main screens (src/routes.ts) and the router that keeps them in step with the screen
// (src/router.ts): parsing and formatting in both editions, the forms that are rewritten (/ko, a trailing slash,
// index.html, unknown paths), which language a page opens in, which query parameters outlive a navigation, the pages
// the build writes, and the history entries the router makes, driven through a fake address bar without a browser.
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
const { ROUTES, LAUNCH_PARAMS, parseRoute, pickEdition, routePages, routePath, withoutParams } = R;

const SCREENS = { menu: '', faction: 'campaign', skirmish: 'conquest', select: 'battles', online: 'online', settings: 'settings' };

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
const HOOKS = ['scenario=hansan', 'side=japan', 'conquest=hallyeo', 'me=ming', 'foe=japan', 'size=4', 'seed=7', 'gallery=1', 'cam=1,2,3,4,5', 'follow=3', 'dist=80', 'pitch=0.2', 'yaw=1', 'warm=5', 'cine=1', 'tutorial=1'];

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
  assert.equal(pages.length, ROUTES.length * 2);
  assert.equal(new Set(pages.map((p) => p.file)).size, pages.length);
  const front = pages.find((p) => p.screen === 'menu' && p.edition === 'ko');
  assert.deepEqual(front, { screen: 'menu', edition: 'ko', path: '/', file: 'index.html', keys: ['index.html'] });
  assert.deepEqual(pages.find((p) => p.screen === 'menu' && p.edition === 'en').keys, ['en', 'en/', 'en/index.html']);
  assert.deepEqual(pages.find((p) => p.screen === 'faction' && p.edition === 'en'), { screen: 'faction', edition: 'en', path: '/en/campaign', file: 'en/campaign/index.html', keys: ['en/campaign', 'en/campaign/', 'en/campaign/index.html'] });
  for (const page of pages) {
    for (const key of page.keys) assert.deepEqual(parseRoute(`/${key}`), { screen: page.screen, edition: page.edition === 'en' ? 'en' : null, known: true }, key);
  }
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
  const app = await load("export { startRouter, onBattleBack } from './src/router'; export { useUi, setScreen, setOrigin } from './src/state/store'; export { setLang, getLang } from './src/i18n';");
  app.startRouter(battle);
  return {
    ...app,
    history,
    calls,
    stored: () => storage.get('imjin.lang') ?? null,
    address: () => location.pathname + location.search,
    entries: () => entries.map((e) => e.url.pathname + e.url.search),
    screen: () => app.useUi.getState().screen,
    title: () => document.title,
  };
}

await check('startup: the address opens its screen and is rewritten to its one form in the language on screen', async () => {
  const cases = [
    ['/campaign', {}, '/campaign', 'faction', '진영 전역 · 임진왜란'],
    ['/ko/campaign/', {}, '/campaign', 'faction', '진영 전역 · 임진왜란'],
    ['/ko', { stored: 'en' }, '/', 'menu', '임진왜란'],
    ['/campaign', { stored: 'en' }, '/en/campaign', 'faction', 'Faction Campaign · The Imjin War'],
    ['/online', { language: 'en-US' }, '/en/online', 'online', 'Online Battle · The Imjin War'],
    ['/en/conquest', { stored: 'ko' }, '/en/conquest', 'skirmish', 'Conquest · The Imjin War'],
    ['/en/', {}, '/en', 'menu', 'The Imjin War'],
    ['/en/index.html', {}, '/en', 'menu', 'The Imjin War'],
    ['/battles/index.html', {}, '/battles', 'select', '역사 전투 · 임진왜란'],
    ['/settings?lang=en&q=low', {}, '/en/settings?lang=en&q=low', 'settings', 'Settings · The Imjin War'],
    ['/en/battles?lang=ko', {}, '/battles?lang=ko', 'select', '역사 전투 · 임진왜란'],
    ['/nowhere', {}, '/', 'menu', '임진왜란'],
    ['/en/nowhere/at/all', {}, '/en', 'menu', 'The Imjin War'],
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
  assert.equal(p.title(), '진영 전역 · 임진왜란');
  p.setScreen('faction');
  assert.equal(p.calls.push, 1, 'the same screen again makes no entry');
  p.setScreen('menu');
  p.setScreen('online');
  assert.deepEqual(p.entries(), ['/', '/campaign', '/', '/online']);
  p.history.back();
  assert.equal(p.screen(), 'menu');
  p.history.back();
  assert.equal(p.screen(), 'faction');
  assert.equal(p.title(), '진영 전역 · 임진왜란');
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
  assert.equal(p.title(), 'Settings · The Imjin War');
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

if (failures) {
  console.error(`${failures} router check(s) failed`);
  process.exit(1);
}
console.log('router: all checks passed');
