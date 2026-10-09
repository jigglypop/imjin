// Close-up shots of ships in the gallery (?gallery=1): one page load, many camera poses.
//   node scripts/ship-shots.mjs --url=http://127.0.0.1:5303/ --out=<dir> [--shots=name,name] [--legacy=1] [--extra=?q=low]
// A shot is { name, key, yaw, pitch, distance, dx, dz }: the camera orbits the ship (key = kind#variant) at yaw
// radians from its heading; dx/dz move the target along/across the ship.
import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, '').split('=');
    return [k, v.join('=') || 'true'];
  }),
);
const base = args.url ?? 'http://127.0.0.1:5303/';
const out = args.out ?? 'shots';
const extra = args.extra ?? '';
const url = `${base}?scenario=hansan&gallery=1&hud=0&paused=1${args.legacy ? '&ships=legacy' : ''}${extra.replace('?', '&')}`;
const W = Number(args.w ?? 1600);
const H = Number(args.h ?? 900);

const PI = Math.PI;
const SHOTS = [
  { name: 'pano0_34', key: 'panokseon#0', yaw: 0.9, pitch: 0.2, distance: 58 },
  { name: 'pano0_flag', key: 'panokseon#0', yaw: 0.5, pitch: 0.12, distance: 22, dx: -7, dz: 0 },
  { name: 'pano0_side', key: 'panokseon#0', yaw: PI / 2, pitch: 0.08, distance: 62 },
  { name: 'pano0_deck', key: 'panokseon#0', yaw: 0.5, pitch: 0.55, distance: 24, dx: -5 },
  { name: 'pano0_pavilion', key: 'panokseon#0', yaw: 2.5, pitch: 0.28, distance: 20, dx: -8 },
  { name: 'pano0_bow', key: 'panokseon#0', yaw: -0.45, pitch: 0.12, distance: 34, dx: 8 },
  { name: 'pano1_34', key: 'panokseon#1', yaw: 0.9, pitch: 0.2, distance: 58 },
  { name: 'pano1_deck', key: 'panokseon#1', yaw: 0.5, pitch: 0.5, distance: 24, dx: -5 },
  { name: 'pano2_34', key: 'panokseon#2', yaw: 0.9, pitch: 0.2, distance: 58 },
  { name: 'pano2_deck', key: 'panokseon#2', yaw: 0.5, pitch: 0.5, distance: 24, dx: -5 },
  { name: 'geo_34', key: 'geobukseon#0', yaw: 0.8, pitch: 0.22, distance: 62 },
  { name: 'geo_side', key: 'geobukseon#0', yaw: PI / 2, pitch: 0.1, distance: 62 },
  { name: 'geo_head', key: 'geobukseon#0', yaw: -0.55, pitch: 0.15, distance: 20, dx: 14 },
  { name: 'geo_mouth', key: 'geobukseon#0', yaw: -0.3, pitch: 0.08, distance: 15, dx: 17 },
  { name: 'geo_roof', key: 'geobukseon#0', yaw: 0.4, pitch: 0.6, distance: 34 },
  { name: 'geo_stern', key: 'geobukseon#0', yaw: 3.2, pitch: 0.2, distance: 36 },
  { name: 'hyeop_34', key: 'hyeopseon#0', yaw: 0.8, pitch: 0.2, distance: 24 },
  { name: 'hyeop_side', key: 'hyeopseon#0', yaw: PI / 2, pitch: 0.1, distance: 24 },
  { name: 'row', key: 'panokseon#0', yaw: 0.7, pitch: 0.25, distance: 150, dx: 55 },
  { name: 'far', key: 'panokseon#0', yaw: 0.7, pitch: 0.2, distance: 1500, dx: 90 },
  { name: 'pano0_cut1', key: 'panokseon#0', yaw: 0.6, pitch: 0.5, distance: 60, cut: 1 },
  { name: 'pano0_cut2', key: 'panokseon#0', yaw: 0.6, pitch: 0.55, distance: 50, cut: 2 },
  { name: 'pano0_cut3', key: 'panokseon#0', yaw: 0.6, pitch: 0.6, distance: 50, cut: 3 },
  { name: 'geo_cut1', key: 'geobukseon#0', yaw: 0.6, pitch: 0.5, distance: 60, cut: 1 },
  { name: 'geo_cut2', key: 'geobukseon#0', yaw: 0.6, pitch: 0.55, distance: 50, cut: 2 },
  { name: 'geo_cut3', key: 'geobukseon#0', yaw: 0.6, pitch: 0.6, distance: 50, cut: 3 },
  { name: 'atake_34', key: 'atakebune#0', yaw: 0.8, pitch: 0.2, distance: 66 },
  { name: 'atake_side', key: 'atakebune#0', yaw: PI / 2, pitch: 0.08, distance: 70 },
  { name: 'atake_wall', key: 'atakebune#0', yaw: 1.2, pitch: 0.38, distance: 30, dx: -1 },
  { name: 'atake_castle', key: 'atakebune#0', yaw: 0.6, pitch: 0.18, distance: 28, dx: -2 },
  { name: 'atake_bow', key: 'atakebune#0', yaw: -0.5, pitch: 0.12, distance: 36, dx: 10 },
  { name: 'atake_stern', key: 'atakebune#0', yaw: 3.0, pitch: 0.2, distance: 40 },
  { name: 'atake_deck', key: 'atakebune#0', yaw: 0.5, pitch: 0.6, distance: 34 },
  { name: 'atake_cut1', key: 'atakebune#0', yaw: 0.6, pitch: 0.5, distance: 60, cut: 1 },
  { name: 'atake_cut2', key: 'atakebune#0', yaw: 0.6, pitch: 0.55, distance: 50, cut: 2 },
  { name: 'atake_cut3', key: 'atakebune#0', yaw: 0.6, pitch: 0.6, distance: 50, cut: 3 },
  { name: 'seki_34', key: 'sekibune#0', yaw: 0.8, pitch: 0.2, distance: 40 },
  { name: 'seki_side', key: 'sekibune#0', yaw: PI / 2, pitch: 0.08, distance: 44 },
  { name: 'seki_deck', key: 'sekibune#0', yaw: 0.5, pitch: 0.55, distance: 22 },
  { name: 'seki_cut2', key: 'sekibune#0', yaw: 0.6, pitch: 0.55, distance: 34, cut: 2 },
  { name: 'koba_34', key: 'kobaya#0', yaw: 0.8, pitch: 0.2, distance: 24 },
  { name: 'koba_side', key: 'kobaya#0', yaw: PI / 2, pitch: 0.08, distance: 26 },
  { name: 'koba_bow', key: 'kobaya#0', yaw: -0.5, pitch: 0.15, distance: 14, dx: 4 },
  { name: 'ming_34', key: 'mingship#0', yaw: 0.8, pitch: 0.2, distance: 62 },
  { name: 'ming_side', key: 'mingship#0', yaw: PI / 2, pitch: 0.08, distance: 64 },
  { name: 'ming_stern', key: 'mingship#0', yaw: 2.6, pitch: 0.22, distance: 36, dx: -6 },
  { name: 'ming_bow', key: 'mingship#0', yaw: -0.5, pitch: 0.12, distance: 30, dx: 10 },
  { name: 'ming_eye', key: 'mingship#0', yaw: 1.2, pitch: 0.1, distance: 14, dx: 12.5 },
  { name: 'ming_deck', key: 'mingship#0', yaw: 0.5, pitch: 0.6, distance: 32 },
  { name: 'ming_cut2', key: 'mingship#0', yaw: 0.6, pitch: 0.55, distance: 50, cut: 2 },
  { name: 'ming_cut3', key: 'mingship#0', yaw: 0.6, pitch: 0.6, distance: 50, cut: 3 },
  { name: 'msmall_34', key: 'mingsmall#0', yaw: 0.8, pitch: 0.2, distance: 34 },
  { name: 'msmall_side', key: 'mingsmall#0', yaw: PI / 2, pitch: 0.08, distance: 36 },
  { name: 'geo_hullclose', key: 'geobukseon#0', yaw: PI / 2 - 0.25, pitch: 0.06, distance: 15, dx: 3, dz: 0 },
  { name: 'geo_dragon', key: 'geobukseon#0', yaw: 0.35, pitch: 0.12, distance: 17, dx: 15.5 },
  { name: 'pano0_hullclose', key: 'panokseon#0', yaw: PI / 2 - 0.3, pitch: 0.06, distance: 15, dx: 2 },
  { name: 'ming_hullclose', key: 'mingship#0', yaw: PI / 2 - 0.3, pitch: 0.06, distance: 16, dx: 2 },
  { name: 'atake1_34', key: 'atakebune#1', yaw: 0.8, pitch: 0.2, distance: 66 },
  { name: 'atake1_castle', key: 'atakebune#1', yaw: 0.6, pitch: 0.18, distance: 28, dx: -5 },
  { name: 'seki1_34', key: 'sekibune#1', yaw: 0.8, pitch: 0.2, distance: 40 },
  { name: 'pano0_cut3_stern', key: 'panokseon#0', yaw: 0.9, pitch: 0.75, distance: 22, dx: -13, cut: 3 },
  { name: 'pano0_cut3_bow', key: 'panokseon#0', yaw: 0.6, pitch: 0.7, distance: 22, dx: 13, cut: 3 },
  { name: 'geo_mid', key: 'geobukseon#0', yaw: PI / 2 - 0.5, pitch: 0.12, distance: 34, dx: 4 },
  { name: 'row_japan', key: 'atakebune#0', yaw: 0.7, pitch: 0.25, distance: 150, dx: 60 },
];
const only = args.shots ? new Set(args.shots.split(',')) : null;

await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  channel: args.channel ?? (process.platform === 'win32' ? 'msedge' : 'chrome'),
  headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', process.platform === 'win32' ? '--use-angle=d3d11' : '--use-angle=metal'],
});
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(url, { waitUntil: 'domcontentloaded' });
try {
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
} catch {
  logs.push('[shots] ready flag timeout');
}
for (const s of SHOTS) {
  if (only && !only.has(s.name)) continue;
  const ok = await page.evaluate((s) => {
    const e = window.__engine;
    const ship = e.battle.ships.find((x) => x.name === s.key);
    if (!ship) return false;
    e.rts.followId = 0;
    e.cutaway = s.cut ?? 0;
    e.views.selected.clear();
    if (s.cut) e.views.selected.add(ship.id);
    const c = Math.cos(ship.heading);
    const n = Math.sin(ship.heading);
    const dx = s.dx ?? 0;
    const dz = s.dz ?? 0;
    e.rts.setPose({ tx: ship.x + c * dx - n * dz, tz: ship.z + n * dx + c * dz, yaw: ship.heading + s.yaw, pitch: s.pitch, distance: s.distance });
    return true;
  }, s);
  if (!ok) {
    console.log('no ship for', s.key);
    continue;
  }
  await page.waitForTimeout(Number(args.wait ?? 1800));
  await page.screenshot({ path: join(out, `${s.name}.png`) });
  if (args.twice) {
    await page.waitForTimeout(1300);
    await page.screenshot({ path: join(out, `${s.name}_b.png`) });
  }
  console.log('saved', s.name);
}
const interesting = logs.filter((l) => !l.includes('[vite]') && !l.includes('DevTools'));
if (interesting.length) console.log(interesting.slice(-30).join('\n'));
await browser.close();
