// Two browsers against a local multiplayer server: one opens a room, the other joins, both sail, both screenshot.
import { chromium } from 'playwright-core';

const url = process.argv[2] ?? 'http://127.0.0.1:5291/';
const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', process.platform === 'win32' ? '--use-angle=d3d11' : '--use-angle=metal'] });
const open = async (name) => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.mode-switch', { timeout: 60000 });
  await page.click('.mode-switch button:nth-child(4)');
  await page.fill('.net-input', name);
  await page.click('.net-go');
  await page.waitForSelector('.net-rooms', { timeout: 20000 });
  return { page, errors };
};
const a = await open('갑');
const b = await open('을');
await a.page.click('.cs-row .chip.chip--on:has-text("열기")');
await a.page.waitForSelector('.net-seats', { timeout: 10000 });
await b.page.click('.mode-switch button:nth-child(4)');
await b.page.waitForTimeout(4500);
await b.page.click('.net-room .chip');
await b.page.waitForSelector('.net-seats', { timeout: 10000 });
await b.page.click('.net-seat--me .cs-faction:nth-child(3)');
await b.page.waitForTimeout(500);
await b.page.click('.cs-row .chip:has-text("준비")');
await a.page.waitForTimeout(800);
await a.page.screenshot({ path: 'shots/mp_lobby.png' });
await a.page.click('.net-go');
for (const p of [a, b]) await p.page.waitForFunction(() => window.__ready === true, null, { timeout: 150000 });
await a.page.waitForTimeout(12000);
for (const [i, p] of [a, b].entries()) {
  const info = await p.page.evaluate(() => {
    const e = window.__engine;
    return { remote: !!e.remote, owner: e.owner, ships: e.battle.ships.filter((s) => s.alive).length, time: Math.round(e.battle.time), own: e.battle.ships.filter((s) => s.owner === e.owner && s.alive).length };
  });
  await p.page.screenshot({ path: `shots/mp_${i}.png` });
  console.log(i, JSON.stringify(info), p.errors.slice(-3));
}
// Player B orders its fleet toward the centre; A should see it move.
await b.page.evaluate(() => {
  const e = window.__engine;
  const ids = e.battle.ships.filter((s) => s.owner === e.owner && s.alive).map((s) => s.id);
  e.issue({ type: 'order', ids, order: { type: 'move', x: 0, z: 0 } });
});
const before = await a.page.evaluate(() => { const e = window.__engine; const s = e.battle.ships.find((x) => x.owner === 1 && x.alive); return s && [Math.round(s.x), Math.round(s.z), s.order.type]; });
await a.page.waitForTimeout(6000);
const after = await a.page.evaluate(() => { const e = window.__engine; const s = e.battle.ships.find((x) => x.owner === 1 && x.alive); return s && [Math.round(s.x), Math.round(s.z), s.order.type]; });
console.log('seen from A', before, after);
await browser.close();
