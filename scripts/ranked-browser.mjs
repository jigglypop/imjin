// Real lobby, GPU-rendered ranked battle, forfeit, persistent profile and responsive layout.
// Start a LOCAL server with an isolated RANKED_STORE and Vite pointing at it, then:
// node scripts/ranked-browser.mjs --url=http://127.0.0.1:5291/ --out=shots/ranked
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [key, ...value] = arg.replace(/^--/, '').split('=');
  return [key, value.join('=')];
}));
const url = args.url ?? 'http://127.0.0.1:5291/';
if (!/^(localhost|127\.0\.0\.1)$/.test(new URL(url).hostname)) throw new Error('Scored browser fixtures must run locally');
const out = args.out ?? 'shots/ranked';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'] });
const fixtures = [];
const suffix = Date.now().toString(36);

async function open(name, viewport = { width: 1365, height: 900 }) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const evidence = { errors: [], profile: null, result: null, start: null, frames: 0 };
  page.on('pageerror', (e) => evidence.errors.push(e.message));
  page.on('websocket', (socket) => socket.on('framereceived', ({ payload }) => {
    if (typeof payload !== 'string') { evidence.frames++; return; }
    let msg; try { msg = JSON.parse(payload); } catch { return; }
    if (msg.t === 'welcome') evidence.profile = msg.rank;
    if (msg.t === 'rank') evidence.profile = msg.profile;
    if (msg.t === 'start') evidence.start = { ranked: msg.ranked, matchId: msg.matchId, seed: msg.seed, factions: msg.seats.map((s) => s.faction), you: msg.you };
    if (msg.t === 'rankedResult') { evidence.result = msg; evidence.profile = msg.profile; }
  }));
  await page.goto(`${url}?lang=en&q=low&webgl=1`, { waitUntil: 'domcontentloaded' });
  await page.locator('.mode-grid .mode-card').nth(3).click({ timeout: 60000 });
  await page.locator('.on-input').fill(name);
  await page.locator('.on-connect').click();
  await page.locator('.on-tab-ranked').waitFor({ timeout: 20000 });
  await page.locator('.on-tab-ranked').click();
  await page.locator('.on-rank-profile').waitFor();
  const fixture = { page, context, evidence };
  fixtures.push(fixture);
  return fixture;
}
async function ready(f) {
  await f.page.waitForFunction(() => window.__ready === true && window.__engine?.remote && window.__engine.battle.time > 0, null, { timeout: 180000 });
}
async function noOverflow(page) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'page must fit viewport width');
}
try {
  const a = await open(`rankA${suffix}`);
  await a.page.locator('.on-rank .on-navy[data-faction="ming"]').click();
  await a.page.locator('.on-rank-start').click();
  await a.page.locator('.on-rank-cancel').waitFor();
  await a.page.screenshot({ path: `${out}/rank-search.png` });
  await a.page.locator('.on-rank-cancel').click();
  await a.page.locator('.on-rank-start').waitFor();
  const b = await open(`rankB${suffix}`);
  await b.page.locator('.on-rank .on-navy[data-faction="japan"]').click();
  await a.page.locator('.on-rank-start').click();
  await b.page.locator('.on-rank-start').click();
  await Promise.all([ready(a), ready(b)]);
  assert.ok(a.evidence.start.ranked && b.evidence.start.ranked);
  assert.equal(a.evidence.start.matchId, b.evidence.start.matchId);
  assert.deepEqual([...a.evidence.start.factions].sort(), ['japan', 'ming']);
  await a.page.screenshot({ path: `${out}/rank-battle.png` });
  // The real HUD exit submits a ranked forfeit; no simulation state or result is injected.
  await a.page.locator('.hud-menu .mini-btn').first().click();
  await b.page.locator('.rank-result').waitFor({ timeout: 20000 });
  await a.page.locator('.on-rank-profile').waitFor({ timeout: 20000 });
  assert.equal(a.evidence.result.result, 'loss');
  assert.equal(b.evidence.result.result, 'win');
  assert.equal(a.evidence.result.delta + b.evidence.result.delta, 0);
  assert.equal(a.evidence.result.profile.games, 1);
  assert.equal(b.evidence.result.profile.games, 1);
  await b.page.waitForTimeout(700); // Let the result card's existing entrance animation finish before visual review.
  await b.page.screenshot({ path: `${out}/rank-result-desktop.png` });
  await b.page.setViewportSize({ width: 390, height: 844 });
  await b.page.waitForTimeout(400);
  await noOverflow(b.page);
  await b.page.screenshot({ path: `${out}/rank-result-mobile.png` });
  await b.page.locator('.on-rank-lobby').click();
  await b.page.locator('.on-rank-profile').waitFor();
  await noOverflow(b.page);
  await b.page.screenshot({ path: `${out}/rank-lobby-mobile.png` });
  const id = a.evidence.profile.id, rating = a.evidence.profile.rating;
  const code = await a.page.evaluate(() => window.__net.exportAccount());
  await a.page.reload();
  await a.page.locator('.mode-grid .mode-card').nth(3).click({ timeout: 60000 });
  await a.page.locator('.on-tab-ranked').waitFor({ timeout: 20000 });
  await a.page.locator('.on-tab-ranked').click();
  await a.page.waitForFunction((expected) => document.querySelector('.on-rank-profile')?.textContent.includes(String(expected)), rating);
  assert.equal(a.evidence.profile.id, id);
  const recovered = await open(`rankA${suffix}`, { width: 390, height: 844 });
  await recovered.page.locator('.on-recovery summary').click();
  await recovered.page.locator('.on-recovery-input').fill(code);
  await recovered.page.locator('.on-recovery-restore').click();
  await recovered.page.waitForFunction((expected) => document.querySelector('.on-rank-profile')?.textContent.includes(String(expected)), rating);
  assert.equal(recovered.evidence.profile.id, id);
  assert.equal(recovered.evidence.profile.rating, rating);
  for (const fixture of fixtures) assert.deepEqual(fixture.evidence.errors, []);
  const report = { passed: true, checks: ['rank queue cancel', 'human ranked match with Japan and Ming', 'real binary snapshots', 'HUD forfeit and conserved rating', 'result desktop/mobile', 'profile reload', 'recovery across browser contexts'], clients: fixtures.map((f) => ({ profile: f.evidence.profile, result: f.evidence.result, start: f.evidence.start, frames: f.evidence.frames, errors: f.evidence.errors })) };
  assert.ok(a.evidence.frames && b.evidence.frames);
  await writeFile(`${out}/browser-verification.json`, JSON.stringify(report, null, 2));
  console.log('ranked browser acceptance passed; account credentials were excluded from artifacts');
} catch (error) {
  const diagnostics = [];
  for (const [index, fixture] of fixtures.entries()) {
    await fixture.page.screenshot({ path: `${out}/failure-${index}.png` }).catch(() => {});
    const state = await fixture.page.evaluate(() => ({ ready: window.__ready, engine: !!window.__engine, remote: !!window.__engine?.remote, time: window.__engine?.battle.time, ships: window.__engine?.battle.ships.length, text: document.body.innerText.slice(0, 1800) })).catch(() => null);
    diagnostics.push({ state, errors: fixture.evidence.errors, start: fixture.evidence.start, frames: fixture.evidence.frames, result: fixture.evidence.result });
  }
  await writeFile(`${out}/browser-failure.json`, JSON.stringify({ error: error.message, diagnostics }, null, 2));
  throw error;
} finally {
  for (const fixture of fixtures) await fixture.page.evaluate(() => window.__net.disconnect()).catch(() => {});
  await browser.close();
}
