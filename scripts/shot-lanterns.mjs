// Night lanterns in the gallery: every ship kind from several distances with the lights on (or, with --off=1, after a blackout order).
//   node scripts/shot-lanterns.mjs --url=http://127.0.0.1:5421/ --out=<dir> [--prefix=lantern_] [--off=1] [--shots=name,name]
import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, '').split('=');
    return [k, v.join('=') || 'true'];
  }),
);
const base = args.url ?? 'http://127.0.0.1:5421/';
const out = args.out ?? 'shots';
const prefix = args.prefix ?? 'lantern_';
const url = `${base}?scenario=hansan&gallery=1&hud=0&paused=1&sky=night${args.extra ?? ''}`;
const SHOTS = [
  { name: 'pano0_34', key: 'panokseon#0', yaw: 0.9, pitch: 0.2, distance: 58 },
  { name: 'pano0_deck', key: 'panokseon#0', yaw: 0.5, pitch: 0.5, distance: 26, dx: -4 },
  { name: 'pano0_far', key: 'panokseon#0', yaw: 0.7, pitch: 0.25, distance: 400 },
  { name: 'pano1_34', key: 'panokseon#1', yaw: 0.9, pitch: 0.2, distance: 58 },
  { name: 'pano2_34', key: 'panokseon#2', yaw: 0.9, pitch: 0.2, distance: 58 },
  { name: 'geo_34', key: 'geobukseon#0', yaw: 0.8, pitch: 0.22, distance: 62 },
  { name: 'hyeop_34', key: 'hyeopseon#0', yaw: 0.8, pitch: 0.2, distance: 24 },
  { name: 'atake0_34', key: 'atakebune#0', yaw: 0.8, pitch: 0.2, distance: 66 },
  { name: 'atake1_34', key: 'atakebune#1', yaw: 0.8, pitch: 0.2, distance: 66 },
  { name: 'seki0_34', key: 'sekibune#0', yaw: 0.8, pitch: 0.2, distance: 40 },
  { name: 'seki1_34', key: 'sekibune#1', yaw: 0.8, pitch: 0.2, distance: 40 },
  { name: 'koba_34', key: 'kobaya#0', yaw: 0.8, pitch: 0.2, distance: 24 },
  { name: 'ming_34', key: 'mingship#0', yaw: 0.8, pitch: 0.2, distance: 62 },
  { name: 'msmall_34', key: 'mingsmall#0', yaw: 0.8, pitch: 0.2, distance: 34 },
  { name: 'pano0_bow', key: 'panokseon#0', yaw: 0.6, pitch: 0.25, distance: 22, dx: 12 },
  { name: 'pano0_stern', key: 'panokseon#0', yaw: 2.3, pitch: 0.3, distance: 22, dx: -12 },
  { name: 'pano0_pavilion', key: 'panokseon#0', yaw: 0.7, pitch: 0.3, distance: 20, dx: -8 },
  { name: 'geo_roof', key: 'geobukseon#0', yaw: 0.8, pitch: 0.4, distance: 38 },
  { name: 'geo_stern', key: 'geobukseon#0', yaw: 2.4, pitch: 0.3, distance: 28, dx: -10 },
  { name: 'atake0_tower', key: 'atakebune#0', yaw: 0.7, pitch: 0.3, distance: 36 },
  { name: 'ming_stern', key: 'mingship#0', yaw: 2.4, pitch: 0.25, distance: 36, dx: -8 },
  { name: 'row_near', key: 'panokseon#0', yaw: 0.7, pitch: 0.25, distance: 150, dx: 55 },
  { name: 'row_far', key: 'panokseon#0', yaw: 0.7, pitch: 0.2, distance: 1500, dx: 90 },
];
// --sheet=1: one 2x2 sheet per ship model (bow and stern, both sides), to check where every lantern hangs.
const KEYS = ['panokseon#0', 'panokseon#1', 'panokseon#2', 'geobukseon#0', 'hyeopseon#0', 'atakebune#0', 'atakebune#1', 'sekibune#0', 'sekibune#1', 'kobaya#0', 'mingship#0', 'mingsmall#0'];
const only = args.shots ? new Set(args.shots.split(',')) : null;
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  channel: args.channel ?? 'chrome',
  headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=metal'],
});
const page = await browser.newPage({ viewport: { width: Number(args.w ?? 1400), height: Number(args.h ?? 800) }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
await page.evaluate((off) => {
  const e = window.__engine;
  e.battle.night = true;
  for (const s of e.battle.ships) s.lights = !off;
}, !!args.off);
for (const s of args.sheet ? [] : SHOTS) {
  if (only && !only.has(s.name)) continue;
  const ok = await page.evaluate((s) => {
    const e = window.__engine;
    const ship = e.battle.ships.find((x) => x.name === s.key);
    if (!ship) return false;
    e.rts.followId = 0;
    const c = Math.cos(ship.heading);
    const n = Math.sin(ship.heading);
    const dx = s.dx ?? 0;
    e.rts.setPose({ tx: ship.x + c * dx, tz: ship.z + n * dx, yaw: ship.heading + s.yaw, pitch: s.pitch, distance: s.distance });
    return true;
  }, s);
  if (!ok) {
    console.log('no ship for', s.key);
    continue;
  }
  await page.waitForTimeout(Number(args.wait ?? 1500));
  await page.screenshot({ path: join(out, `${prefix}${s.name}.png`) });
  console.log('saved', s.name);
}
if (args.sheet) {
  const sheetPage = await browser.newPage({ viewport: { width: 1400, height: 800 } });
  for (const key of KEYS) {
    const info = await page.evaluate((key) => {
      const e = window.__engine;
      const ship = e.battle.ships.find((x) => x.name === key);
      return { len: e.views.assets[key].anchors.length, lanterns: e.views.assets[key].anchors.lanterns, id: ship.id };
    }, key);
    const poses = [
      { yaw: 0.9, dx: info.len * 0.28 },
      { yaw: -0.9, dx: info.len * 0.28 },
      { yaw: 2.3, dx: -info.len * 0.28 },
      { yaw: -2.3, dx: -info.len * 0.28 },
    ];
    const imgs = [];
    for (const po of poses) {
      await page.evaluate(
        ({ key, po, dist }) => {
          const e = window.__engine;
          const ship = e.battle.ships.find((x) => x.name === key);
          e.rts.followId = 0;
          const c = Math.cos(ship.heading);
          const n = Math.sin(ship.heading);
          e.rts.setPose({ tx: ship.x + c * po.dx, tz: ship.z + n * po.dx, yaw: ship.heading + po.yaw, pitch: 0.32, distance: dist });
        },
        { key, po, dist: Math.max(18, info.len * 0.62) },
      );
      await page.waitForTimeout(900);
      imgs.push((await page.screenshot({ type: 'jpeg', quality: 88 })).toString('base64'));
    }
    await sheetPage.setContent(`<body style="margin:0;background:#000;display:grid;grid-template-columns:700px 700px">${imgs.map((i) => `<img style="width:700px;height:400px" src="data:image/jpeg;base64,${i}">`).join('')}</body>`);
    await sheetPage.screenshot({ path: join(out, `${prefix}sheet_${key.replace('#', '')}.png`) });
    console.log('sheet', key, JSON.stringify(info.lanterns.map((l) => l.map((v) => Math.round(v * 10) / 10))));
  }
  await sheetPage.close();
}
const interesting = logs.filter((l) => !l.includes('[vite]') && !l.includes('DevTools'));
if (interesting.length) console.log(interesting.slice(-30).join('\n'));
await browser.close();
