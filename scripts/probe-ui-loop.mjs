// menu -> historical battle -> menu -> battle ... through the real buttons on the WebKit iPhone path (the engine and its
// renderer are kept and the battle is swapped on them, as in the game). After each battle: GPU counters from the new engine, console errors, and the WebContent / GPU process footprint (macOS).
//   node scripts/probe-ui-loop.mjs [baseUrl] [--rounds=4] [--engine=chromium]
import { webkit, chromium, devices } from 'playwright-core';
import { execSync } from 'node:child_process';
const positional = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const flags = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.join('=') || 'true']; }));
const base = positional[0] ?? 'http://127.0.0.1:5291/';
const rounds = Number(flags.rounds ?? 4);
const before = new Set(execSync('ps -axo pid=').toString().trim().split(/\s+/));
const chrome = flags.engine === 'chromium';
const browser = chrome ? await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=metal'] }) : await webkit.launch({ headless: true });
const ctx = await browser.newContext(chrome ? { viewport: { width: 393, height: 659 } } : { ...devices['iPhone 15 Pro'] });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
page.on('pageerror', (e) => errors.push(`pageerror ${String(e).slice(0, 200)}`));
const footprint = (re) => {
  const rows = execSync('ps -axo pid=,rss=,comm=').toString().trim().split('\n').map((l) => l.trim().split(/\s+/)).filter(([pid, , comm]) => !before.has(pid) && re.test(comm ?? ''));
  const top = rows.sort((a, b) => Number(b[1]) - Number(a[1]))[0];
  if (!top) return '?';
  try { return `${/Footprint: (\d+) MB/.exec(execSync(`footprint ${top[0]} 2>&1`).toString())?.[1] ?? '?'}MB`; } catch { return '?'; }
};
await page.goto(`${base}${base.includes('?') ? '&' : '?'}q=low${chrome ? '&webgl=1' : ''}`, { waitUntil: 'domcontentloaded' });
for (let round = 1; round <= rounds; round += 1) {
  // The back button returns to the screen the battle was started from (the battle list after the first round).
  const card = page.getByRole('button', { name: /역사 전투/ });
  if (await card.count()) await card.first().click();
  await page.locator('.ink-btn:not([disabled])').first().click();
  // Later rounds reuse the running engine (setScenario), so wait for it to leave and re-enter the ready state.
  await page.waitForTimeout(1500);
  await page.waitForFunction(() => window.__engine?.ready === true, null, { timeout: 120000 });
  await page.waitForTimeout(3000);
  const stats = await page.evaluate(() => {
    const m = window.__engine.renderer.info.memory;
    return { textureMB: Math.round(m.texturesSize / 1e6), geometries: m.geometries, programs: m.programs, totalMB: Math.round(m.total / 1e6) };
  });
  console.log(`battle ${round}`, JSON.stringify(stats), `web ${footprint(/WebContent/)} gpu ${footprint(/GPU/)}`);
  // Back to the battle list.
  await page.locator('.hud-menu .mini-btn').first().click();
  await page.waitForTimeout(1500);
}
console.log(errors.length ? `console errors:\n${[...new Set(errors)].join('\n')}` : 'no console errors');
await browser.close();
if (errors.length) process.exitCode = 1;
