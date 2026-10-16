// The campaign's commanders' screen (장수) and tech tree (기술) in a browser, from a war built by the game's own rules:
// opens both from the top bar, takes a skill, starts a research and appoints a commander, and saves screenshots.
//   node scripts/grand-growth-browser.mjs [--url=http://127.0.0.1:5291/] [--out=shots/growth] [--engine=webkit] [--orient=portrait,landscape] [--lang=en]
// Desktop is Edge (Windows) or Chrome; --engine=webkit emulates an iPhone 15 Pro in each orientation.
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium, devices, webkit } from 'playwright-core';

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.length ? v.join('=') : 'true']; }));
const url = args.url ?? 'http://127.0.0.1:5291/';
const out = args.out ?? join(fileURLToPath(new URL('..', import.meta.url)), 'shots', 'growth');
await mkdir(out, { recursive: true });

// Turn 9, autumn 1594: Yi has risen a level with a point to spend, the navy can afford a research.
const vite = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), configFile: false, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] } });
const { newGrand } = await vite.ssrLoadModule('/src/sim/grand/turn.ts');
const { grantXp } = await vite.ssrLoadModule('/src/sim/grand/roster.ts');
const growth = await vite.ssrLoadModule('/src/sim/grand/growth.ts');
const save = newGrand('joseon', 1597);
save.events.pending = null;
save.factions.joseon.gold = 2400;
const yi = save.factions.joseon.commanders.find((c) => c.id === 'yi');
grantXp(save, 'joseon', yi, 700);
growth.learnSkill(save, 'joseon', 'yi', 'gunnery1');
growth.learnSkill(save, 'joseon', 'yi', 'gunnery2');
save.factions.joseon.tech.done.push('panokseon');
await vite.close();

const errors = [];
const run = async (label, context) => {
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${label}: ${m.text()}`); });
  await page.addInitScript((data) => {
    localStorage.setItem('imjin.grand.v1', JSON.stringify(data.save));
    localStorage.setItem('imjin.grand.guide.v1', '1');
    if (data.lang) localStorage.setItem('imjin.lang', data.lang);
  }, { save, lang: args.lang });
  await page.goto(url + (args.lang === 'en' ? 'en/campaign' : 'campaign'), { waitUntil: 'domcontentloaded' });
  await page.locator('.g-hub__actions .g-btn--primary').click({ timeout: 90000 });
  await page.locator('.g-top__cmd').click({ timeout: 60000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(out, `${label}-commanders.png`) });
  // Take the open skill of the picked commander, then look at an officer still to come.
  const open = page.locator('.g-skill--open').first();
  if (await open.count()) await open.click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(out, `${label}-commanders-learned.png`) });
  const coming = page.locator('.g-cmd__pick--coming').first();
  if (await coming.count()) {
    await coming.click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: join(out, `${label}-commanders-coming.png`) });
  }
  await page.keyboard.press('Escape');
  await page.locator('.g-top__tech').click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(out, `${label}-tech.png`) });
  const go = page.locator('.g-tech__go:not([disabled])').first();
  if (await go.count()) await go.click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(out, `${label}-tech-research.png`) });
  await page.keyboard.press('Escape');
  // The toast of the research fades first.
  await page.waitForTimeout(4500);
  await page.screenshot({ path: join(out, `${label}-map.png`) });
  await page.close();
};

if (args.engine === 'webkit') {
  const browser = await webkit.launch({ headless: true });
  for (const orient of (args.orient ?? 'portrait,landscape').split(',')) {
    const base = devices['iPhone 15 Pro'];
    const viewport = orient === 'landscape' ? { width: base.viewport.height, height: base.viewport.width } : base.viewport;
    const context = await browser.newContext({ ...base, viewport, screen: viewport });
    await run(`phone-${orient}`, context);
    await context.close();
  }
  await browser.close();
} else {
  const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', process.platform === 'win32' ? '--use-angle=d3d11' : '--use-angle=metal'] });
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  await run('desktop', context);
  await browser.close();
}
console.log(errors.length ? `errors:\n${errors.join('\n')}` : 'no page errors');
console.log(`shots in ${out}`);
