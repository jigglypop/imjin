import { chromium } from 'playwright-core';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, ...v] = a.replace(/^--/, '').split('=');
  return [k, v.join('=') || 'true'];
}));
const scenario = args.scenario ?? 'hansan';
const warm = Number(args.warm ?? 600);
const prefix = args.prefix ?? 'combat';
const shots = Number(args.shots ?? 3);
const dist = Number(args.dist ?? 140);
const pitch = Number(args.pitch ?? 0.16);

const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', process.platform === 'win32' ? '--use-angle=d3d11' : '--use-angle=metal'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const logs = [];
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(`http://127.0.0.1:5291/?scenario=${scenario}&hud=${args.hud ?? 0}&warm=${warm}${args.sky ? `&sky=${args.sky}` : ''}`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 240000 });
for (let i = 0; i < shots; i += 1) {
  const picked = await page.evaluate(({ dist, pitch }) => {
    const e = window.__engine;
    const b = e.battle;
    let best = null;
    let bestScore = -1;
    const jp = b.ships.filter((o) => o.alive && o.sinking === 0 && o.team === 'japan');
    for (const s of b.ships) {
      if (!s.alive || s.sinking > 0 || s.team !== 'joseon') continue;
      for (const t of jp) {
        const d = Math.hypot(t.x - s.x, t.z - s.z);
        if (d > 450) continue;
        const score = 1000 - d + (b.time - s.lastHit < 6 ? 200 : 0) + (b.time - t.lastHit < 6 ? 200 : 0);
        if (score > bestScore) {
          bestScore = score;
          best = { s, t };
        }
      }
    }
    if (!best) return null;
    const { s, t } = best;
    const mx = (s.x + t.x) / 2;
    const mz = (s.z + t.z) / 2;
    const line = Math.atan2(t.z - s.z, t.x - s.x);
    e.rts.followId = 0;
    e.rts.setPose({ tx: mx, tz: mz, yaw: line + Math.PI / 2, pitch, distance: Math.max(dist, Math.hypot(t.x - s.x, t.z - s.z) * 0.9) });
    return { ship: s.name, target: t.name, d: Math.round(Math.hypot(t.x - s.x, t.z - s.z)) };
  }, { dist, pitch });
  await page.waitForTimeout(Number(args.wait ?? 2500));
  const info = await page.evaluate(() => window.__info());
  await page.screenshot({ path: `shots/${prefix}_${i}.png` });
  console.log(i, JSON.stringify(picked), 'proj', info.projectiles, 'smoke', info.smoke, 'fire', info.fire, 'fps', info.fps);
}
if (logs.length) console.log(logs.slice(-5).join('\n'));
await browser.close();
