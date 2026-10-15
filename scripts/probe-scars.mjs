// The marks a fight leaves on the hulls: runs a battle fast until the fleets have traded fire for a while, pauses it,
// and shoots the most damaged ships of each side broadside on from close by, a three-quarter view, and the battle
// camera's RTS view. Prints the persistent-mark counters with each frame.
//   node scripts/probe-scars.mjs --url=http://127.0.0.1:5291/?scenario=hansan --out=<dir> [--prefix=before_]
//     [--fight=60] [--speed=8] [--ships=2] [--w=1600] [--h=900]
import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const flags = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.join('=') || 'true']; }));
let url = flags.url ?? 'http://127.0.0.1:5291/?scenario=hansan';
if (!/[?&]lv=/.test(url)) url += `${url.includes('?') ? '&' : '?'}lv=4`;
if (!/[?&]hud=/.test(url)) url += '&hud=0';
const out = flags.out ?? 'shots/scars';
const prefix = flags.prefix ?? '';
const fight = Number(flags.fight ?? 60);
const speed = Number(flags.speed ?? 8);
const perSide = Number(flags.ships ?? 2);
await mkdir(out, { recursive: true });

const browser = await chromium.launch({
  channel: process.platform === 'win32' ? 'msedge' : 'chrome',
  headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', process.platform === 'win32' ? '--use-angle=d3d11' : '--use-angle=metal'],
});
const page = await browser.newPage({ viewport: { width: Number(flags.w ?? 1600), height: Number(flags.h ?? 900) }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(url);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 300000 });

// Count hits as they happen, so the run stops a while after the first one.
await page.evaluate((speed) => {
  const e = window.__engine;
  window.__hits = 0;
  window.__firstHit = -1;
  const handle = e.fx.handle.bind(e.fx);
  e.fx.handle = (events, battle) => {
    for (const ev of events) if (ev.type === 'hit') {
      window.__hits += 1;
      if (window.__firstHit < 0) window.__firstHit = battle.time;
    }
    return handle(events, battle);
  };
  e.speed = speed;
}, speed);
const started = Date.now();
while (Date.now() - started < 600000) {
  const s = await page.evaluate(() => ({ t: window.__engine.battle.time, first: window.__firstHit, ended: window.__engine.battle.ended }));
  if (s.ended || (s.first >= 0 && s.t > s.first + fight)) break;
  await page.waitForTimeout(400);
}
// A last stretch at normal speed so the effects of the last hits have drawn, then hold the battle still.
await page.evaluate(() => { window.__engine.speed = 1; window.__engine.fastForward = false; window.__engine.autoFast = false; });
await page.waitForTimeout(1500);
await page.evaluate(() => { window.__engine.paused = true; });

const picks = await page.evaluate((perSide) => {
  const e = window.__engine;
  const out = [];
  for (const team of ['joseon', 'japan', 'ming']) {
    const ships = e.battle.ships.filter((s) => s.alive && s.sinking === 0 && s.team === team && e.views.states.has(s.id));
    ships.sort((a, b) => b.hull / b.spec.hull < a.hull / a.spec.hull ? 1 : -1);
    for (const s of ships.slice(0, perSide)) out.push({ id: s.id, kind: s.spec.kind, team, hull: +(s.hull / s.spec.hull).toFixed(2), length: s.spec.length });
  }
  return out;
}, perSide);
console.log('hits', await page.evaluate(() => window.__hits), 'time', await page.evaluate(() => window.__engine.battle.time.toFixed(0)));
console.log('picks', JSON.stringify(picks));

const stats = () => page.evaluate(() => window.__engine.fx.scarStats?.() ?? null);
async function frame(label, id, distance, pitch, yaw) {
  await page.evaluate(({ id, distance, pitch, yaw }) => {
    const e = window.__engine;
    const s = e.battle.get(id);
    e.rts.followId = id;
    e.rts.setPose({ tx: s.x, tz: s.z, yaw: s.heading + yaw, pitch, distance }, true);
  }, { id, distance, pitch, yaw });
  for (let i = 0; i < 6; i += 1) await page.evaluate(() => new Promise((r) => requestAnimationFrame(r)));
  const file = join(out, `${prefix}${label}.png`);
  await page.screenshot({ path: file });
  console.log(label, JSON.stringify(await stats()));
}
for (const p of picks) {
  const tag = `${p.team}_${p.kind}_${p.id}`;
  await frame(`${tag}_port`, p.id, p.length * 0.9, 0.12, -Math.PI / 2);
  await frame(`${tag}_starboard`, p.id, p.length * 0.9, 0.12, Math.PI / 2);
  await frame(`${tag}_quarter`, p.id, p.length * 1.4, 0.3, 2.4);
}
if (picks[0]) await frame('rts', picks[0].id, 650, 0.85, 1.2);
await browser.close();
