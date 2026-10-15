// Photographs the moments that carry a gun fight's impact: a close broadside, a hit on a hull up close and from the RTS
// camera, a great arrow striking, a miss splash and a magazine going up. A duel is staged as in probe-projectiles.mjs
// (the blast and the miss are pushed as events); when the wanted event comes the battle is frozen `delay` seconds of battle time after it, the camera is put at a fixed
// pose relative to where it happened and the frame is saved, so two builds can be compared moment for moment.
//   node scripts/probe-impact.mjs --url=http://127.0.0.1:5560/ --out=<dir> --tag=new [--scenario=hansan] [--only=hit,splash]
import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, '').split('=');
    return [k, v.join('=') || 'true'];
  }),
);
const url = args.url ?? 'http://127.0.0.1:5560/';
const out = args.out ?? '.';
const tag = args.tag ?? 'shot';
const scenario = args.scenario ?? 'hansan';
await mkdir(out, { recursive: true });

// What to catch, how long after it to freeze, and where the camera stands (yaw, pitch, distance about the event).
const MOMENTS = [
  { name: 'broadside', want: 'gun', delays: [0.03, 0.1, 0.35, 1.2], pose: { yaw: 1.0, pitch: 0.1, distance: 48 } },
  { name: 'hit', want: 'hitBall', delays: [0.03, 0.1, 0.3, 0.9], pose: { yaw: -1.2, pitch: 0.1, distance: 34 } },
  { name: 'arrow', want: 'hitArrow', delays: [0.03, 0.12, 0.4], pose: { yaw: -1.25, pitch: 0.12, distance: 40 } },
  { name: 'rts', want: 'hitAny', delays: [0.05, 0.25], pose: { yaw: -1.0, pitch: 0.65, distance: 420 } },
  { name: 'splash', want: 'splash', delays: [0.2, 0.6, 1.4], pose: { yaw: -1.2, pitch: 0.06, distance: 55 } },
  { name: 'boom', want: 'explode', delays: [0.08, 0.4, 1.5], pose: { yaw: -1.1, pitch: 0.12, distance: 140 } },
].filter((m) => !args.only || args.only.split(',').includes(m.name));

const browser = await chromium.launch({
  channel: process.platform === 'win32' ? 'msedge' : 'chrome',
  headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', process.platform === 'win32' ? '--use-angle=d3d11' : '--use-angle=metal'],
});
const page = await browser.newPage({ viewport: { width: Number(args.w ?? 1280), height: Number(args.h ?? 720) } });
const logs = [];
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(`${url}?scenario=${scenario}&hud=0&q=${args.q ?? 'high'}${args.webgl ? '&webgl=1' : ''}`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 240000 });

await page.evaluate(({ dist }) => {
  const e = window.__engine;
  const b = e.battle;
  const a = b.ships.find((s) => s.alive && s.spec.kind === 'panokseon' && s.team === 'joseon') ?? b.ships.find((s) => s.alive && s.team === 'joseon');
  const d = b.ships.find((s) => s.alive && s.spec.kind === 'atakebune' && s.team === 'japan') ?? b.ships.find((s) => s.alive && s.team === 'japan');
  for (const s of b.ships) {
    if (s === a || s === d) continue;
    s.x += 6000;
    s.speed = 0;
    s.fireMode = 'hold';
  }
  const cx = a.x;
  const cz = a.z;
  e.rts.followId = 0;
  e.speed = 1;
  e.fastForward = false;
  e.autoFast = false;
  let nextVolley = 0;
  const hold = () => {
    for (const [s, x, z, fire] of [[a, cx, cz, 'free'], [d, cx + 10, cz + dist, 'hold']]) {
      s.x = x;
      s.z = z;
      s.speed = 0;
      s.throttle = 0;
      s.heading = 0;
      s.fireMode = fire;
      s.fire = 0;
      s.hull = s.spec.hull;
      s.crew = s.spec.crew;
    }
    a.order = { type: 'auto' };
    a.targetId = d.id;
    if (performance.now() > nextVolley && e.speed > 0) {
      nextVolley = performance.now() + 3000;
      for (const g of a.guns) {
        g.ammo = 99;
        if (g.stage < 4) g.stage = 4;
      }
    }
  };
  hold();
  window.__hold = setInterval(hold, 16);
  window.__duel = { a: a.id, d: d.id };
  // Each shot's gun, so a hit can be told by the weapon that made it.
  const guns = new Map();
  const handle = e.fx.handle.bind(e.fx);
  e.fx.handle = (events, battle) => {
    for (const ev of events) {
      if (ev.type === 'shot') guns.set(ev.id, ev.gun);
      const c = window.__catch;
      if (!c || c.at !== undefined) continue;
      const gun = ev.type === 'hit' ? guns.get(ev.proj) : undefined;
      const ok =
        (c.want === 'gun' && ev.type === 'gun' && ev.ship === a.id) ||
        (c.want === 'hitBall' && ev.type === 'hit' && ev.ammo === 'ball' && ev.ship === d.id && gun !== 'hwangja') ||
        (c.want === 'hitArrow' && ev.type === 'hit' && ev.ammo === 'arrow' && ev.ship === d.id) ||
        (c.want === 'hitAny' && ev.type === 'hit' && ev.ship === d.id) ||
        (c.want === 'splash' && ev.type === 'splash' && ev.size >= 1) ||
        (c.want === 'explode' && ev.type === 'explode');
      if (ok) Object.assign(c, { at: b.time, x: ev.x, y: ev.y ?? 0, z: ev.z, gun: gun ?? ev.gun });
    }
    handle(events, battle);
  };
  window.__catcher = setInterval(() => {
    const c = window.__catch;
    if (c && c.at !== undefined && !c.done && b.time - c.at >= c.delay) {
      e.speed = 0;
      c.done = true;
    }
  }, 2);
}, { dist: Number(args.dist ?? 160) });

for (const m of MOMENTS) {
  for (let i = 0; i < m.delays.length; i += 1) {
    await page.evaluate(({ want, delay }) => {
      window.__catch = { want, delay };
      const e = window.__engine;
      e.speed = 1;
      // A blast and a miss are made to order: the duel's shots nearly all strike, and nothing in it blows up.
      const d = e.battle.get(window.__duel.d);
      if (want === 'explode') e.battle.events.push({ type: 'explode', ship: d.id, x: d.x, y: d.spec.deck, z: d.z });
      if (want === 'splash') e.battle.events.push({ type: 'splash', proj: -1, x: d.x - 6, z: d.z - 25, size: 1.2 });
    }, { want: m.want, delay: m.delays[i] });
    const ok = await page.waitForFunction(() => window.__catch?.done === true, null, { timeout: 60000, polling: 20 }).then(() => true, () => false);
    if (!ok) {
      console.log('missed', m.name, m.delays[i]);
      continue;
    }
    const c = await page.evaluate(({ pose }) => {
      const e = window.__engine;
      const c = window.__catch;
      e.rts.setPose({ tx: c.x, tz: c.z, ...pose }, true);
      e.rts.lookLift = c.y;
      return { x: c.x, y: c.y, z: c.z, gun: c.gun };
    }, { pose: m.pose });
    await page.waitForTimeout(700);
    const file = `${out}/${tag}_${m.name}_${i}.png`;
    await page.screenshot({ path: file });
    console.log('saved', file, `+${m.delays[i]}s`, c.gun ?? '');
  }
}
if (logs.length) console.log(logs.slice(-20).join('\n'));
await browser.close();
