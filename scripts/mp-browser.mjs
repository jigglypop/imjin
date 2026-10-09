// Two browser pages against a local multiplayer server, driving the real lobby UI: open a room (or quick match),
// both sail, both screenshot; a command from one page must show on the other; one page drops and comes back.
//   npm run server:build && PORT=8791 node server/dist/server.cjs
//   VITE_MP_URL=ws://127.0.0.1:8791/ws npx vite --port 5306 --strictPort --host 127.0.0.1
//   node scripts/mp-browser.mjs --url=http://127.0.0.1:5306/ --mode=conquest|scenario|quick|fill|reconnect|all [--out=<dir>] [--scenario=hansan]
// macOS drives Chrome on Metal, Windows Edge on D3D11 (same flags as scripts/shot.mjs).
import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, '').split('=');
    return [k, v.join('=') || 'true'];
  }),
);
const url = args.url ?? 'http://127.0.0.1:5306/';
const mode = args.mode ?? 'all';
const out = args.out ?? join(new URL('..', import.meta.url).pathname, 'shots');
const scenario = args.scenario ?? 'hansan';
// The UI language of the pages (the lobby is matched by its words): --lang=ko|en.
const lang = args.lang ?? 'ko';
const X = lang === 'en'
  ? { newRoom: 'New room', quickMatch: 'Quick Match', historical: 'Historical Battles', japan: 'Japan', takeSeat: 'Take seat', rematch: 'Rematch', unreachable: 'Cannot reach the server' }
  : { newRoom: '새 방', quickMatch: '빠른 대전', historical: '역사 전투', japan: '일본', takeSeat: '자리 잡기', rematch: '재대결', unreachable: '서버에 연결할 수 없습니다' };
const width = Number(args.w ?? 1280);
const height = Number(args.h ?? 760);
await mkdir(out, { recursive: true });

const browser = await chromium.launch({
  channel: args.channel ?? (process.platform === 'win32' ? 'msedge' : 'chrome'),
  headless: args.headed !== 'true',
  args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', process.platform === 'win32' ? '--use-angle=d3d11' : '--use-angle=metal'],
});

let shotNo = Number(args.first ?? 1);
const shot = async (page, name) => {
  const file = join(out, `${args.prefix ?? 'mp'}_${String(shotNo++).padStart(2, '0')}_${name}.png`);
  await page.screenshot({ path: file });
  console.log('shot', file);
};
let failures = 0;
const check = (ok, label, extra = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${extra ? ` ${extra}` : ''}`);
  if (!ok) failures += 1;
};

const open = async (name, size = { width, height }) => {
  const context = await browser.newContext({ viewport: size, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/WebSocket|ERR_CONNECTION/.test(m.text()) && errors.push(m.text()));
  await page.goto(`${url}${url.includes('?') ? '&' : '?'}lang=${lang}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.mode-card', { timeout: 60000 });
  await gotoOnline(page, name);
  return { page, errors, name };
};
const gotoOnline = async (page, name) => {
  await page.click('.mode-grid .mode-card:nth-child(4)');
  await page.fill('.on-input', name);
  await page.click('.on-connect');
  await page.waitForSelector('.on-card', { timeout: 20000 });
};

/** The pieces of the battle two honest clients must agree on. */
const probe = (p) =>
  p.page.evaluate(() => {
    const e = window.__engine;
    const b = e.battle;
    const alive = b.ships.filter((s) => s.alive);
    const mine = alive.filter((s) => s.owner === e.owner);
    const ref = b.ships.find((s) => s.id === 1);
    return {
      remote: !!e.remote,
      scenario: e.conquestSetup ? `conquest:${e.conquestSetup.map}` : `scenario:${e.scenarioId}`,
      owner: e.owner,
      team: e.team,
      time: Math.round(b.time),
      ships: alive.length,
      own: mine.length,
      ref: ref && [Math.round(ref.x), Math.round(ref.z)],
      orders: Object.fromEntries(['joseon', 'japan'].map((t) => [t, alive.filter((s) => s.team === t && s.order.type === 'move').length])),
    };
  });

const waitBattle = (p, timeout = 180000) => p.page.waitForFunction(() => window.__ready === true && window.__engine?.remote && window.__engine.battle.ships.length > 0, null, { timeout });

async function battleChecks(a, b, label) {
  await Promise.all([waitBattle(a), waitBattle(b)]);
  await a.page.waitForTimeout(6000);
  const [pa, pb] = [await probe(a), await probe(b)];
  console.log(label, 'A', JSON.stringify(pa));
  console.log(label, 'B', JSON.stringify(pb));
  check(pa.remote && pb.remote, `${label}: both drawing a remote battle`);
  check(pa.scenario === pb.scenario, `${label}: same battle`, pa.scenario);
  check(Math.abs(pa.ships - pb.ships) <= 3, `${label}: same ship count`, `${pa.ships}/${pb.ships}`);
  check(pa.owner !== pb.owner && pa.team !== pb.team, `${label}: opposite sides`, `${pa.team}/${pb.team}`);
  check(pa.ref && pb.ref && Math.hypot(pa.ref[0] - pb.ref[0], pa.ref[1] - pb.ref[1]) < 200, `${label}: ship 1 in the same place`, `${pa.ref} ${pb.ref}`);
  await shot(a.page, `${label}_A`);
  await shot(b.page, `${label}_B`);
  // B orders its fleet toward the middle; A must see it.
  await b.page.evaluate(() => {
    const e = window.__engine;
    const ids = e.battle.ships.filter((s) => s.owner === e.owner && s.alive).map((s) => s.id);
    e.issue({ type: 'order', ids, order: { type: 'move', x: 0, z: 0 } });
  });
  await a.page.waitForTimeout(2500);
  const seen = await probe(a);
  const sideB = pb.team;
  check(seen.orders[sideB] > 0, `${label}: A sees B's move orders`, JSON.stringify(seen.orders));
  const badge = await a.page.locator('.on-pill').first().textContent({ timeout: 1000 }).catch(() => null);
  console.log(label, 'speed badge:', badge);
  return { pa, pb };
}

async function room(kind) {
  const a = await open(`갑-${kind}`);
  const b = await open(`을-${kind}`);
  await shot(a.page, `${kind}_lobby`);
  if (kind === 'scenario') {
    await a.page.click(`.on-card:has-text("${X.newRoom}") .on-seg-btn:has-text("${X.historical}")`);
    await a.page.selectOption(`.on-card:has-text("${X.newRoom}") .on-select`, scenario);
  }
  await a.page.click('.on-create');
  await a.page.waitForSelector('.on-seats', { timeout: 10000 });
  // B joins by the code A reads off the room title (older rooms of earlier runs may still be listed).
  const code = (await a.page.locator('.on-title code').textContent()).trim();
  await b.page.fill('.on-input--code', code);
  await b.page.click('.on-input--code ~ .chip');
  await b.page.waitForSelector('.on-seats', { timeout: 10000 });
  await b.page.click('.on-ready');
  await a.page.waitForFunction(() => document.querySelectorAll('.on-seat .on-tag--on').length >= 2, null, { timeout: 10000 });
  await shot(a.page, `${kind}_room_host`);
  await shot(b.page, `${kind}_room_guest`);
  await a.page.click('.on-start');
  return { a, b };
}

async function reconnectCheck(a, b) {
  const before = await probe(b);
  // Line drop: the socket closes under the page, which retries and gets its seat back.
  await b.page.evaluate(() => window.__net.ws.close());
  await b.page.waitForTimeout(300);
  await shot(b.page, 'reconnect_dropped');
  await b.page.waitForFunction(() => window.__net && document.querySelector('.on-pill--warn') === null, null, { timeout: 20000 });
  await b.page.waitForTimeout(2500);
  const after = await probe(b);
  check(after.remote && after.time >= before.time, 'reconnect: line drop recovered, battle keeps running', `${before.time}s -> ${after.time}s`);
  // Page reload: the tab keeps its session token, the page rebuilds the battle from the resume start.
  await b.page.reload({ waitUntil: 'domcontentloaded' });
  await waitBattle(b);
  await b.page.waitForTimeout(3000);
  const reloaded = await probe(b);
  check(reloaded.remote && reloaded.owner === before.owner, 'reconnect: reloaded page is back on its own seat', JSON.stringify(reloaded));
  await shot(b.page, 'reconnect_reloaded');
  // Tab closed and reopened (Chrome restores the tab's session storage): the new page takes the seat over.
  const token = await b.page.evaluate(() => sessionStorage.getItem('imjin.session'));
  check(!!token, 'reconnect: the tab holds a session token');
  const context = b.page.context();
  await b.page.close();
  await a.page.waitForTimeout(1500);
  const page = await context.newPage();
  await page.addInitScript((t) => sessionStorage.setItem('imjin.session', t), token);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${url}${url.includes('?') ? '&' : '?'}lang=${lang}`, { waitUntil: 'domcontentloaded' });
  const again = { page, errors, name: b.name };
  await waitBattle(again);
  await page.waitForTimeout(3000);
  const reopened = await probe(again);
  check(reopened.remote && reopened.owner === before.owner, 'reconnect: reopened tab is back on its own seat', `${reopened.time}s`);
  await shot(page, 'reconnect_reopened');
  b.page = page;
}

try {
  if (mode === 'conquest' || mode === 'all') {
    const { a, b } = await room('conquest');
    await battleChecks(a, b, 'conquest');
    for (const p of [a, b]) {
      console.log(p.name, 'errors', p.errors.slice(-3));
      await p.page.context().close();
    }
  }
  if (mode === 'scenario' || mode === 'reconnect' || mode === 'all') {
    const { a, b } = await room('scenario');
    await battleChecks(a, b, 'scenario');
    if (mode !== 'scenario') await reconnectCheck(a, b);
    for (const p of [a, b]) {
      console.log(p.name, 'errors', p.errors.slice(-3));
      await p.page.context().close();
    }
  }
  if (mode === 'quick' || mode === 'all') {
    const a = await open('갑-quick');
    const b = await open('을-quick');
    await a.page.click(`.on-card:has-text("${X.quickMatch}") .on-seg-btn:has-text("${X.historical}")`);
    await a.page.selectOption(`.on-card:has-text("${X.quickMatch}") .on-select`, 'okpo');
    await b.page.click(`.on-card:has-text("${X.quickMatch}") .on-seg-btn:has-text("${X.historical}")`);
    await b.page.selectOption(`.on-card:has-text("${X.quickMatch}") .on-select`, 'okpo');
    await b.page.click(`.on-navy:has-text("${X.japan}")`);
    await a.page.click('.on-quick-go');
    await a.page.waitForSelector('.on-searching');
    await a.page.waitForTimeout(1500);
    await shot(a.page, 'quick_searching');
    await b.page.click('.on-quick-go');
    await battleChecks(a, b, 'quick');
    for (const p of [a, b]) await p.page.context().close();
  }
  if (mode === 'ui') {
    // Lobby and room at the size given by --w/--h (a phone, say), then a room with a historical duel.
    const a = await open('장수');
    await shot(a.page, 'ui_lobby');
    await a.page.click(`.on-card:has-text("${X.newRoom}") .on-seg-btn:has-text("${X.historical}")`);
    await a.page.click('.on-create');
    await a.page.waitForSelector('.on-seats');
    await a.page.waitForTimeout(400);
    await shot(a.page, 'ui_room');
    await a.page.context().close();
  }
  if (mode === 'down') {
    // Run with the server stopped: the first connection fails with a retry offered.
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    await page.goto(`${url}${url.includes('?') ? '&' : '?'}lang=${lang}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.mode-card', { timeout: 60000 });
    await page.click('.mode-grid .mode-card:nth-child(4)');
    await page.fill('.on-input', '장수');
    await page.click('.on-connect');
    await page.waitForSelector('.on-alert', { timeout: 20000 });
    check((await page.locator('.on-alert').textContent()).includes(X.unreachable), 'down: unreachable server is explained');
    await shot(page, 'down_error');
    await context.close();
  }
  if (mode === 'rematch') {
    // Needs a server with BASE_SPEED=30. The host takes the Japanese seat and sits idle; the Joseon computer wins.
    const a = await open('홀로-rematch');
    await a.page.click(`.on-card:has-text("${X.newRoom}") .on-seg-btn:has-text("${X.historical}")`);
    await a.page.selectOption(`.on-card:has-text("${X.newRoom}") .on-select`, 'okpo');
    await a.page.click('.on-create');
    await a.page.waitForSelector('.on-seats');
    await a.page.locator('.on-seat').nth(1).locator(`.chip:has-text("${X.takeSeat}")`).click();
    await a.page.waitForTimeout(500);
    await a.page.click('.on-start');
    await waitBattle(a, 120000);
    await a.page.waitForSelector('.on-end', { timeout: 240000 });
    await a.page.waitForTimeout(1500);
    await shot(a.page, 'rematch_ended');
    await a.page.click(`.on-end .chip:has-text("${X.rematch}")`);
    await a.page.waitForSelector('.on-seats', { timeout: 10000 });
    check((await a.page.locator('.on-seats').count()) === 1 && (await a.page.locator('.on-overlay .on-end').count()) === 0, 'rematch: back in the room lobby');
    await shot(a.page, 'rematch_room');
    await a.page.context().close();
  }
  if (mode === 'fill') {
    const a = await open('홀로-quick');
    await a.page.click('.on-quick-go');
    await a.page.waitForSelector('.on-searching');
    await a.page.waitForTimeout(2000);
    await shot(a.page, 'fill_searching');
    await waitBattle(a, 120000);
    await a.page.waitForTimeout(5000);
    console.log('fill', JSON.stringify(await probe(a)));
    await shot(a.page, 'fill_battle');
    await a.page.context().close();
  }
} catch (err) {
  console.error('FAILED', err);
  failures += 1;
}
await browser.close();
console.log(failures ? `${failures} FAILED` : 'all passed');
process.exit(failures ? 1 : 0);
