// Visual QA of the real campaign UI and elevation renderer on a local static build.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const args = Object.fromEntries(process.argv.slice(2).map((arg) => { const [key, ...value] = arg.replace(/^--/, '').split('='); return [key, value.join('=')]; }));
const url = args.url ?? 'http://127.0.0.1:5292/';
if (!['localhost', '127.0.0.1'].includes(new URL(url).hostname)) throw new Error('Map QA runs on localhost only');
const out = args.out ?? 'shots/map-relief-2026-10-11';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'] });
const report = { passed: false, url, assets: [], checks: [], screenshots: [], errors: [], desktop: null, mobile: null };
const shot = async (page, name) => { await page.screenshot({ path: `${out}/${name}.png` }); report.screenshots.push(name); };
const open = async (touch = false, webgl = true) => {
  const context = await browser.newContext({ viewport: touch ? { width: 390, height: 844 } : { width: 1920, height: 1080 }, deviceScaleFactor: 1, hasTouch: touch, isMobile: touch });
  const page = await context.newPage(); page.on('pageerror', (error) => report.errors.push(error.message));
  await page.goto(`${url}?lang=en&q=low&webgl=${webgl ? 1 : 0}`, { waitUntil: 'domcontentloaded' });
  await page.locator('.mode-card').nth(1).click({ timeout: 60000 }); await page.locator('.g-pick__go').click();
  await page.locator('.gm[data-relief="ready"]').waitFor({ timeout: 60000 });
  if (await page.locator('.g-event__choices button').count()) await page.locator('.g-event__choices button').last().click();
  if (await page.locator('.g-guide__actions').count()) await page.locator('.g-guide__actions button').last().click();
  await page.waitForTimeout(700);
  return { page, context };
};
const state = (page) => page.evaluate(() => {
  const map = document.querySelector('.gm'); const canvas = document.querySelector('.gm__relief');
  const r = canvas.getBoundingClientRect();
  return { relief: map.dataset.relief, tilt: Number(map.dataset.tilt), yaw: Number(map.dataset.yaw), nodes: document.querySelectorAll('.gm-node').length, selected: document.querySelectorAll('.gm-fleet--sel').length,
    canvas: { cssWidth: r.width, cssHeight: r.height, width: canvas.width, height: canvas.height }, overflow: document.documentElement.scrollWidth > innerWidth + 1,
    controls: [...document.querySelectorAll('.gm__terrain button, .gm__terrain input')].map((el) => { const b = el.getBoundingClientRect(); return { text: el.getAttribute('aria-label') ?? el.textContent, x: b.x, y: b.y, width: b.width, height: b.height }; }) };
});
try {
  const { page, context } = await open();
  report.assets = await page.evaluate(() => performance.getEntriesByType('resource').map((r) => r.name).filter((name) => /\/(index|GrandScreen)-[^/]+\.js$/.test(name)));
  const initial = await state(page); assert.equal(initial.relief, 'ready'); assert.ok(initial.nodes >= 24); assert.equal(initial.overflow, false);
  await shot(page, 'desktop-relief-default');
  await page.locator('.gm-rotate-right').click(); await page.locator('.gm-tilt').fill('58'); await page.waitForTimeout(350);
  const rotated = await state(page); assert.ok(rotated.yaw > initial.yaw); assert.ok(rotated.tilt > initial.tilt);
  await shot(page, 'desktop-relief-rotated');
  await page.locator('.gm-mode').click(); assert.equal((await state(page)).tilt, 0); await shot(page, 'desktop-flat-view');
  await page.locator('.gm-mode').click();
  const ownNodes = page.locator('.gm-node:not(.gm-node--neutral):not(.gm-node--off)');
  await ownNodes.first().locator('.gm-node__disc').click(); await page.locator('.g-dock .g-sheet').waitFor(); await page.waitForTimeout(700); await shot(page, 'desktop-relief-port');
  await page.locator('.g-dock .g-sheet .g-icon-btn').first().click();
  await page.locator('.g-top__batch').click();
  const fleets = page.locator('.gm-fleet:not(.gm-fleet--foreign)');
  assert.ok(await fleets.count() >= 2);
  await fleets.nth(0).locator('.gm-fleet__pill').click(); await page.keyboard.down('Shift'); await fleets.nth(1).locator('.gm-fleet__pill').click(); await page.keyboard.up('Shift');
  assert.ok(await page.locator('.gm-fleet--sel').count() >= 2); await shot(page, 'desktop-relief-multiple-fleets');
  report.checks.push('real DEM terrain ready and all current region markers', 'orthographic rotation/tilt/flat controls', 'port click retains real building panel', 'Shift additive fleet selection highlights multiple tokens');
  report.desktop = { initial, rotated, final: await state(page) }; await context.close();

  const mobile = await open(true);
  const before = await state(mobile.page); assert.equal(before.overflow, false);
  for (const b of before.controls) assert.ok(b.x >= 0 && b.x + b.width <= 390 && b.y >= 0 && b.y + b.height <= 844, JSON.stringify(b));
  await shot(mobile.page, 'mobile-relief-default');
  await mobile.page.locator('.gm-rotate-left').tap(); await mobile.page.locator('.gm-tilt').fill('60');
  await mobile.page.waitForTimeout(300); const after = await state(mobile.page); assert.ok(after.yaw < before.yaw); assert.ok(after.tilt > before.tilt);
  await shot(mobile.page, 'mobile-relief-rotated');
  await mobile.page.locator('.gm-mode').tap(); assert.equal((await state(mobile.page)).tilt, 0); await mobile.page.locator('.gm-mode').tap();
  // The port discs use enlarged overlapping touch padding. Tap the real coordinate and verify nearest-port resolution.
  const portDisc = await mobile.page.locator('.gm-node[data-region="yeosu"] .gm-node__disc').boundingBox();
  await mobile.page.touchscreen.tap(portDisc.x + portDisc.width / 2, portDisc.y + portDisc.height / 2);
  await mobile.page.locator('.g-dock .g-sheet').waitFor();
  assert.equal(await mobile.page.locator('.gm-node[data-region="yeosu"]').getAttribute('aria-pressed'), 'true');
  await mobile.page.waitForTimeout(700);
  await shot(mobile.page, 'mobile-relief-port'); report.mobile = { initial: before, rotated: after, final: await state(mobile.page) };
  report.checks.push('mobile touch controls fit viewport and change actual pose', 'mobile flat toggle and port panel'); await mobile.context.close();

  const native = await open(false, false);
  const nativeContext = await native.page.evaluate(() => !!document.querySelector('.gm__relief').getContext('webgpu'));
  assert.equal(nativeContext, true, 'native WebGPU canvas context');
  await native.page.locator('.gm-rotate-left').click(); await native.page.waitForTimeout(300); await shot(native.page, 'desktop-native-webgpu');
  report.checks.push('actual native WebGPU terrain canvas and rotation'); await native.context.close();

  const fallback = await browser.newContext({ viewport: { width: 1280, height: 720 } }); const fallbackPage = await fallback.newPage();
  fallbackPage.on('pageerror', (error) => report.errors.push(error.message));
  await fallbackPage.route('**/ui/grand_relief.bin', (route) => route.fulfill({ status: 503, body: 'Unavailable' }));
  await fallbackPage.goto(`${url}?lang=en&q=low&webgl=1`); await fallbackPage.locator('.mode-card').nth(1).click(); await fallbackPage.locator('.g-pick__go').click();
  await fallbackPage.locator('.gm__img').waitFor(); await fallbackPage.waitForTimeout(1000);
  assert.equal(await fallbackPage.locator('.gm[data-relief="ready"]').count(), 0); assert.equal(await fallbackPage.locator('.gm__img').count(), 1);
  await fallback.close(); report.checks.push('failed elevation request retains functional flat fallback');
  assert.deepEqual(report.errors, []); report.passed = true; console.log('Map browser QA passed');
} catch (error) {
  report.failure = error.stack; console.error(error); process.exitCode = 1;
} finally {
  await writeFile(`${out}/verification.json`, JSON.stringify(report, null, 2)); await browser.close();
}
