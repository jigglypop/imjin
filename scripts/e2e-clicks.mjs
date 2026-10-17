// Click regression: every primary button of the main menu, the chapter tabs, the history battle list and /generals is
// reachable (no overlay takes the pointer at its centre or edges) and does what it says within a second.
//   node scripts/e2e-clicks.mjs [--url=http://127.0.0.1:5291] [--headed] [--max-ms=1000]
// Needs a running dev server (npm run dev). Exit code 1 on any failure.
import { chromium } from 'playwright-core';
import { parseArgs } from './e2e/util.mjs';

const args = parseArgs(process.argv.slice(2));
const base = (args.url ?? 'http://127.0.0.1:5291').replace(/\/$/, '');
const maxMs = Number(args['max-ms'] ?? 1000);
const win = process.platform === 'win32';
const browser = await chromium.launch({
  channel: args.channel ?? (win ? 'msedge' : 'chrome'),
  headless: args.headed !== 'true',
  args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', win ? '--use-angle=d3d11' : '--use-angle=metal'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const results = [];
const record = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
};

/** Buttons on screen whose centre or edges hit another element: something above them takes the click. */
async function blocked(selector = 'button, a[href], [role=tab]') {
  return page.evaluate((sel) => {
    const out = [];
    for (const el of document.querySelectorAll(sel)) {
      const rc = el.getBoundingClientRect();
      if (rc.width < 4 || rc.height < 4 || el.closest('[aria-hidden=true]')) continue;
      // Clipped by a scrolling list: not on screen, not a blocker.
      let clip = el.parentElement, hidden = false;
      while (clip && clip !== document.body) {
        const s = getComputedStyle(clip);
        if (/(auto|scroll|hidden)/.test(s.overflow + s.overflowX + s.overflowY)) {
          const c = clip.getBoundingClientRect();
          if (rc.top < c.top || rc.bottom > c.bottom || rc.left < c.left || rc.right > c.right) hidden = true;
        }
        clip = clip.parentElement;
      }
      if (hidden) continue;
      const miss = [];
      for (const [fx, fy] of [[0.5, 0.5], [0.15, 0.5], [0.85, 0.5]]) {
        const x = rc.left + rc.width * fx, y = rc.top + rc.height * fy;
        if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
        const hit = document.elementFromPoint(x, y);
        if (!hit || !(el === hit || el.contains(hit))) miss.push(hit ? `${hit.tagName.toLowerCase()}.${String(hit.className).split(' ')[0]}` : 'null');
      }
      if (miss.length) out.push(`"${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 24)}" under ${[...new Set(miss)].join(',')}`);
    }
    return out;
  }, selector);
}

/** Clicks with a real pointer at the element's centre and times how long until `done` holds in the page. */
async function clickAndWait(name, locator, done, arg) {
  try {
    await locator.waitFor({ state: 'visible', timeout: 15000 });
    const t0 = Date.now();
    await locator.click({ timeout: 3000, noWaitAfter: true, force: false });
    await page.waitForFunction(done, arg, { timeout: 8000, polling: 16 });
    const ms = Date.now() - t0;
    record(name, ms <= maxMs, `${ms} ms`);
  } catch (e) {
    record(name, false, e.message.split('\n')[0]);
  }
}

async function open(path) {
  await page.goto(base + path, { waitUntil: 'load' });
  await page.waitForTimeout(2500);
}


// The main menu: the chapter tabs (they sat under the masthead's full-width header) and the header and mode buttons.
await open('/');
const menuBlocked = await blocked('.screen.menu button');
record('menu: no button covered', !menuBlocked.length, menuBlocked.join('; '));
for (const chapter of ['armada', 'lepanto', 'trafalgar', 'imjin']) {
  const chip = page.locator('.chapter-chip').nth(['imjin', 'armada', 'lepanto', 'trafalgar'].indexOf(chapter));
  await clickAndWait(`menu: chapter tab ${chapter}`, chip, (i) => document.querySelectorAll('.chapter-chip')[i]?.getAttribute('aria-pressed') === 'true', ['imjin', 'armada', 'lepanto', 'trafalgar'].indexOf(chapter));
}
const MENU_TARGETS = [
  ['[data-mode=select]', '/battles'],
  ['[data-mode=faction]', '/campaign'],
  ['[data-mode=codex]', '/ships'],
  ['[data-mode=generals]', '/generals'],
];
for (const [sel, want] of MENU_TARGETS) {
  await open('/');
  await clickAndWait(`menu: ${sel} -> ${want}`, page.locator(`.screen.menu ${sel}`).first(), (w) => location.pathname.endsWith(w), want);
}
for (const chapter of ['armada', 'lepanto', 'trafalgar']) {
  await open(`/${chapter}`);
  await clickAndWait(`${chapter} menu: battles`, page.locator('.screen.menu [data-mode=select]').first(), (w) => location.pathname.endsWith(w), '/battles');
}

// The history battle list of every chapter: each battle tab selects its battle, and its address follows.
for (const prefix of ['', '/armada', '/lepanto', '/trafalgar']) {
  await open(`${prefix}/battles`);
  const covered = await blocked('.screen-top button, .hs-tabs button, .hs-brief button');
  record(`${prefix || '/imjin'} battles: no button covered`, !covered.length, covered.join('; '));
  const tabs = page.locator('.hs-tabs .hs-tab:not([disabled])');
  const n = await tabs.count();
  record(`${prefix || '/imjin'} battles: list present`, n > 0, `${n} tabs`);
  for (let i = n - 1; i >= 0; i--) {
    await clickAndWait(`${prefix || '/imjin'} battles: tab ${i + 1}`, tabs.nth(i), (j) => document.querySelectorAll('.hs-tabs .hs-tab:not([disabled])')[j]?.classList.contains('hs-tab--on'), i);
  }
  await clickAndWait(`${prefix || '/imjin'} battles: back`, page.locator('.screen-top .back-btn').first(), () => !location.pathname.includes('/battles'));
}

// /generals: faction tabs switch the list.
await open('/generals');
const genBlocked = await blocked('.screen-top button, .gen-tabs button, .gen-pick');
record('generals: no button covered', !genBlocked.length, genBlocked.join('; '));
const factionTabs = page.locator('.gen-tabs .gen-tab');
for (let i = (await factionTabs.count()) - 1; i >= 0; i--) {
  await clickAndWait(`generals: faction tab ${i + 1}`, factionTabs.nth(i), (j) => {
    return document.querySelectorAll('.gen-tabs .gen-tab')[j]?.getAttribute('aria-selected') === 'true';
  }, i);
}

if (errors.length) record('no page errors', false, errors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
