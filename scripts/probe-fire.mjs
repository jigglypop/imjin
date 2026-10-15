// A ship catching fire, burning and going down, as a sequence of frames from close by and from the battle camera's
// distance. The ship is set alight through the engine's test hook (window.__engine): its fire is held at rising levels
// while the sim burns it, then its hull gives out and the sinking plays to the end and after. Each frame is shot twice,
// close and far, and the effect counters are printed with it.
//   node scripts/probe-fire.mjs --url=http://127.0.0.1:5291/?scenario=noryang&side=japan --out=<dir> [--prefix=before_]
//     [--kind=atakebune] [--close=75] [--far=420] [--yaw=1.9] [--burst=4] [--w=1280] [--h=720] [--stop=burst]
import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const positional = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const flags = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.join('=') || 'true']; }));
let url = flags.url ?? positional[0] ?? 'http://127.0.0.1:5291/?scenario=noryang&side=japan';
if (!/[?&]lv=/.test(url)) url += `${url.includes('?') ? '&' : '?'}lv=4`;
if (!/[?&]hud=/.test(url)) url += '&hud=0';
const out = flags.out ?? 'shots/fire';
const prefix = flags.prefix ?? '';
const close = Number(flags.close ?? 75);
const far = Number(flags.far ?? 420);
const yaw = Number(flags.yaw ?? 1.9);
await mkdir(out, { recursive: true });

const browser = await chromium.launch({
  channel: process.platform === 'win32' ? 'msedge' : 'chrome',
  headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', process.platform === 'win32' ? '--use-angle=d3d11' : '--use-angle=metal'],
});
const page = await browser.newPage({ viewport: { width: Number(flags.w ?? 1280), height: Number(flags.h ?? 720) }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(url);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 300000 });

// The player's own ship of the asked kind, the largest one otherwise: the player always sees their own ships.
const target = await page.evaluate((kind) => {
  const e = window.__engine;
  e.autoFast = false;
  e.fastForward = false;
  e.approachOver = true;
  e.speed = 1;
  const own = e.battle.ships.filter((s) => s.alive && s.team === e.team);
  const pick = own.find((s) => s.spec.kind === kind) ?? own.sort((a, b) => b.spec.length - a.spec.length)[0];
  if (!pick) return null;
  window.__fireLevel = 0;
  window.__fireHold = setInterval(() => {
    const s = e.battle.get(pick.id);
    if (s && s.alive && s.sinking === 0) s.fire = Math.max(s.fire, window.__fireLevel);
  }, 50);
  return { id: pick.id, kind: pick.spec.kind, length: pick.spec.length, t0: e.battle.time };
}, flags.kind ?? 'atakebune');
if (!target) {
  console.log('no ship to set alight');
  process.exit(1);
}
console.log('target', JSON.stringify(target));

const simTime = () => page.evaluate(() => window.__engine.battle.time);
async function until(t) {
  while ((await simTime()) < t) await page.waitForTimeout(150);
}
const counters = () =>
  page.evaluate((id) => {
    const e = window.__engine;
    const f = e.fx;
    const s = e.battle.get(id);
    const lit = f.lightPos.filter((p) => p.w > 0).length;
    return {
      t: +(e.battle.time).toFixed(1),
      fps: e.fps,
      fire: s ? +s.fire.toFixed(2) : null,
      burn: s ? +s.burn.toFixed(2) : null,
      sinking: s ? +s.sinking.toFixed(2) : null,
      smoke: f.smoke.count,
      flames: f.fire.count,
      spray: f.spray.count,
      streaks: f.streaks.count,
      debris: f.debris.count,
      lights: lit,
      ...(f.blaze ? { blaze: f.blaze.stats() } : {}),
    };
  }, target.id);

/** Puts the camera on the ship (or where it went down) at a distance and lets two frames draw. */
async function frame(label, distance, pitch) {
  await page.evaluate(
    ({ id, distance, pitch, yaw }) => {
      const e = window.__engine;
      const s = e.battle.get(id);
      if (s?.alive) {
        e.rts.followId = id;
        window.__lastAt = { x: s.x, z: s.z, heading: s.heading };
      }
      const at = window.__lastAt;
      e.rts.setPose({ tx: at.x, tz: at.z, yaw: at.heading + yaw, pitch, distance });
    },
    { id: target.id, distance, pitch, yaw },
  );
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const file = join(out, `${prefix}${label}.png`);
  await page.screenshot({ path: file });
  console.log(label, JSON.stringify(await counters()));
}
async function both(label) {
  await frame(`${label}_close`, close, 0.16);
  await frame(`${label}_far`, far, 0.42);
}

const t0 = target.t0;
const ignite = (level) =>
  page.evaluate(({ id, level }) => {
    const e = window.__engine;
    const s = e.battle.get(id);
    if (!s) return;
    if (s.fire < 0.05) e.battle.events.push({ type: 'ignite', ship: id });
    window.__fireLevel = level;
    s.fire = Math.max(s.fire, level);
  }, { id: target.id, level });

await both('00_before');
await ignite(0.22);
await until(t0 + 2);
await both('01_caught');
await until(t0 + 7);
await both('02_taking');
await ignite(0.55);
await until(t0 + 15);
await both('03_spreading');
await ignite(0.95);
await until(t0 + 24);
await both('04_ablaze');
// Consecutive close frames: the flicker and the roll of the flames and smoke.
for (let i = 0; i < Number(flags.burst ?? 4); i += 1) {
  await page.waitForTimeout(120);
  await frame(`05_burst${i}_close`, close * 0.8, 0.12);
}
if (flags.stop === 'burst') {
  await browser.close();
  process.exit(0);
}
await page.evaluate((id) => {
  const s = window.__engine.battle.get(id);
  if (s) s.hull = 0.01;
}, target.id);
const sinkAt = async (p) => {
  while (true) {
    const state = await page.evaluate((id) => {
      const s = window.__engine.battle.get(id);
      return s ? { alive: s.alive, sinking: s.sinking } : null;
    }, target.id);
    if (!state || !state.alive || state.sinking >= p) return;
    await page.waitForTimeout(120);
  }
};
for (const [p, label] of [[0.06, '06_sink06'], [0.2, '07_sink20'], [0.35, '08_sink35'], [0.5, '09_sink50'], [0.65, '10_sink65'], [0.8, '11_sink80'], [0.92, '12_sink92']]) {
  await sinkAt(p);
  await both(label);
}
await page.waitForFunction((id) => !window.__engine.battle.get(id)?.alive, target.id, { timeout: 120000 });
const gone = await simTime();
await until(gone + 3);
await both('13_after03');
await until(gone + 12);
await both('14_after12');
await browser.close();
