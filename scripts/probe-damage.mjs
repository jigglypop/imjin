// The damage gallery (?gallery=damage) one ship at a time: each kind at each stage of a fight (pristine, shield wall
// broken, holed, burning, listing), shot broadside on from the side its marks are on, and a close-up of the holed one.
//   node scripts/probe-damage.mjs --url=http://127.0.0.1:5540/ --out=<dir> [--kinds=panokseon,atakebune] [--prefix=]
//     [--dist=1.0] [--close=0.4] [--w=1600] [--h=900]
import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const flags = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.join('=') || 'true']; }));
const base = (flags.url ?? 'http://127.0.0.1:5540/').replace(/\/?(\?.*)?$/, '/');
const out = flags.out ?? 'shots/damage';
const prefix = flags.prefix ?? '';
const kinds = (flags.kinds ?? 'panokseon,geobukseon,hyeopseon,atakebune,sekibune,kobaya,mingship,mingsmall').split(',');
const dist = Number(flags.dist ?? 1.0);
const close = Number(flags.close ?? 0.4);
const STAGES = ['0_pristine', '1_shields', '2_holed', '3_burning', '4_listing'];
await mkdir(out, { recursive: true });

const browser = await chromium.launch({
  channel: process.platform === 'win32' ? 'msedge' : 'chrome',
  headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', process.platform === 'win32' ? '--use-angle=d3d11' : '--use-angle=metal'],
});
const page = await browser.newPage({ viewport: { width: Number(flags.w ?? 1600), height: Number(flags.h ?? 900) }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
for (const kind of kinds) {
  await page.goto(`${base}?scenario=hansan&gallery=damage&kind=${kind}&sea=calm&sky=day&hud=0&lv=4`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 300000 });
  await page.waitForTimeout(2500);
  const ships = await page.evaluate(() => window.__engine.battle.ships.map((s) => ({ id: s.id, x: s.x, z: s.z, length: s.spec.length })));
  for (let i = 0; i < ships.length; i += 1) {
    const s = ships[i];
    const shoot = async (label, distance, pitch, yaw, dx = 0) => {
      await page.evaluate(({ s, distance, pitch, yaw, dx }) => {
        const e = window.__engine;
        e.rts.followId = 0;
        e.rts.setPose({ tx: s.x + dx, tz: s.z, yaw, pitch, distance }, true);
      }, { s, distance, pitch, yaw, dx });
      for (let k = 0; k < 8; k += 1) await page.evaluate(() => new Promise((r) => requestAnimationFrame(r)));
      await page.screenshot({ path: join(out, `${prefix}${kind}_${label}.png`) });
    };
    await shoot(STAGES[i], s.length * dist + 12, 0.12, Math.PI / 2);
    if (i === 2 || i === 4) await shoot(`${STAGES[i]}_close`, s.length * close + 6, 0.08, Math.PI / 2 - 0.25, s.length * 0.12);
  }
  console.log(kind, JSON.stringify(await page.evaluate(() => window.__engine.fx.scarStats())));
}
await browser.close();
