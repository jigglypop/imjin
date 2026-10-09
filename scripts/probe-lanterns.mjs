// Night lanterns in a real battle: a ship of ours lit, then blacked out with the L key, an enemy ship lit and dark.
// Prints how many lantern sprites are drawn at each step and saves a screenshot per step.
//   node scripts/probe-lanterns.mjs --url=http://127.0.0.1:5421/ --scenario=noryang --out=<dir> [--prefix=lantern_] [--engine=webkit --w=844 --h=390]
// With --engine=webkit it runs the iPhone 15 Pro emulation (the WebGL2 path), like probe-mobile.mjs.
import { chromium, webkit, devices } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, '').split('=');
    return [k, v.join('=') || 'true'];
  }),
);
const base = args.url ?? 'http://127.0.0.1:5421/';
const scenario = args.scenario ?? 'noryang';
const out = args.out ?? 'shots';
const prefix = args.prefix ?? `lantern_${scenario}_`;
const phone = args.engine === 'webkit';
await mkdir(out, { recursive: true });
const browser = phone
  ? await webkit.launch()
  : await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=metal'] });
const ctx = phone
  ? await browser.newContext({ ...devices['iPhone 15 Pro landscape'], viewport: { width: Number(args.w ?? 844), height: Number(args.h ?? 390) } })
  : await browser.newContext({ viewport: { width: Number(args.w ?? 1400), height: Number(args.h ?? 800) } });
const page = await ctx.newPage();
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
const q = `?scenario=${scenario}&paused=1${phone ? '&q=low' : ''}${args.extra ?? ''}`;
await page.goto(`${base}${q}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });

const state = (label) =>
  page.evaluate((label) => {
    const e = window.__engine;
    return { label, night: e.battle.night, glow: e.lanterns.glow.count, refl: e.lanterns.refl.count, selected: [...e.views.selected], lightsOwn: e.battle.ships.filter((s) => e.isOwn(s) && s.alive && s.lights).length, ownAlive: e.battle.ships.filter((s) => e.isOwn(s) && s.alive).length };
  }, label);

// A ship of ours in the middle of its fleet, and the enemy ship nearest to it.
const pick = await page.evaluate(() => {
  const e = window.__engine;
  const own = e.battle.ships.filter((s) => e.isOwn(s) && s.alive);
  const foe = e.battle.ships.filter((s) => s.team !== e.team && s.alive);
  const cx = own.reduce((a, s) => a + s.x, 0) / own.length;
  const cz = own.reduce((a, s) => a + s.z, 0) / own.length;
  own.sort((a, b) => (a.x - cx) ** 2 + (a.z - cz) ** 2 - ((b.x - cx) ** 2 + (b.z - cz) ** 2));
  const me = own[0];
  foe.sort((a, b) => (a.x - me.x) ** 2 + (a.z - me.z) ** 2 - ((b.x - me.x) ** 2 + (b.z - me.z) ** 2));
  const enemy = foe[0];
  return { me: me.id, enemy: enemy.id, dist: Math.hypot(enemy.x - me.x, enemy.z - me.z) };
});
console.log('pick', JSON.stringify(pick));

const look = (id, distance, yaw = 0.8, pitch = 0.3) =>
  page.evaluate(
    ({ id, distance, yaw, pitch }) => {
      const e = window.__engine;
      const s = e.battle.get(id);
      e.rts.followId = 0;
      e.rts.setPose({ tx: s.x, tz: s.z, yaw: s.heading + yaw, pitch, distance });
    },
    { id, distance, yaw, pitch },
  );
const shot = async (name) => {
  await page.waitForTimeout(Number(args.wait ?? 1800));
  await page.screenshot({ path: join(out, `${prefix}${name}.png`) });
  console.log(JSON.stringify(await state(name)));
};

await look(pick.me, 80);
await shot('own_lit_near');
await look(pick.me, 700, 0.8, 0.45);
await shot('own_lit_far');
// Select the ship and black it out with the key, as a player does.
await page.evaluate((id) => {
  const e = window.__engine;
  e.views.selected.clear();
  e.views.selected.add(id);
}, pick.me);
await look(pick.me, 80);
await page.keyboard.press('l');
await shot('own_dark_near');
await look(pick.me, 700, 0.8, 0.45);
await shot('own_dark_far');
await page.keyboard.press('l');
await look(pick.me, 80);
await shot('own_relit_near');
// Every ship of ours dark, then lit again (no selection means the whole fleet).
await page.evaluate(() => window.__engine.views.selected.clear());
await page.keyboard.press('l');
await look(pick.me, 400, 0.8, 0.4);
await shot('fleet_dark');
await page.keyboard.press('l');
await shot('fleet_lit');
await look(pick.enemy, 90);
await shot('enemy_near');
await page.evaluate((id) => {
  const e = window.__engine;
  for (const s of e.battle.ships) if (s.team !== e.team) s.lights = false;
}, pick.enemy);
await shot('enemy_dark_near');
const interesting = logs.filter((l) => !l.includes('[vite]') && !l.includes('DevTools') && !l.includes('Clock'));
if (interesting.length) console.log(interesting.slice(-20).join('\n'));
await browser.close();
