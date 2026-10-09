// Stages a gun duel in a loaded battle and photographs the projectiles: round shot, grape, heavy arrows, a rocket salvo.
//   node scripts/probe-projectiles.mjs --url=http://127.0.0.1:5441/ --prefix=<path/prefix> --ammo=auto|hull|crew|fire
//   --a=panokseon --d=atakebune --dist=240   shooter and target kinds and the gap between them (m)
//   --cam=mid|close|far|target|high          camera framing, --shots=6 --step=700  how many frames and the pause between them
//   --video=1 --seconds=14                   record the page instead of taking stills (webm in the prefix's folder)
//   --team=japan                             make the shooter a Japanese ship instead (hiya probe: --a=atakebune --d=panokseon)
import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, '').split('=');
    return [k, v.join('=') || 'true'];
  }),
);
const url = args.url ?? 'http://127.0.0.1:5441/';
const prefix = args.prefix ?? '/Users/yeomdonghwan/Desktop/imjin/shots/progress/projectiles_probe';
const shots = Number(args.shots ?? 6);
const step = Number(args.step ?? 700);
await mkdir(dirname(prefix), { recursive: true });

const browser = await chromium.launch({
  channel: process.platform === 'win32' ? 'msedge' : 'chrome',
  headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', process.platform === 'win32' ? '--use-angle=d3d11' : '--use-angle=metal'],
});
const size = { width: Number(args.w ?? 1600), height: Number(args.h ?? 900) };
const ctx = await browser.newContext({ viewport: size, ...(args.video ? { recordVideo: { dir: dirname(prefix), size } } : {}) });
const t0 = Date.now();
const page = await ctx.newPage();
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(`${url}?scenario=${args.scenario ?? 'hansan'}&hud=0&q=${args.q ?? 'high'}${args.webgl ? '&webgl=1' : ''}`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 240000 });

const opts = { kindA: args.a ?? 'panokseon', kindD: args.d ?? 'atakebune', dist: Number(args.dist ?? 240), ammo: args.ammo ?? 'auto', team: args.team ?? 'joseon', cam: args.cam ?? 'mid', speed: Number(args.speed ?? 1), reload: Number(args.reload ?? 4), follow: Number(args.follow ?? 0), fyaw: Number(args.fyaw ?? 0.6), fpitch: Number(args.fpitch ?? 0.1) };
const info = await page.evaluate(({ kindA, kindD, dist, ammo, team, cam, speed, reload, follow, fyaw, fpitch }) => {
  const e = window.__engine;
  const b = e.battle;
  const foeTeam = team === 'joseon' ? 'japan' : 'joseon';
  const a = b.ships.find((s) => s.alive && s.spec.kind === kindA && s.team === team) ?? b.ships.find((s) => s.alive && s.team === team);
  const d = b.ships.find((s) => s.alive && s.spec.kind === kindD && s.team === foeTeam) ?? b.ships.find((s) => s.alive && s.team === foeTeam);
  // Everything else is parked far away so only the duel is in view.
  for (const s of b.ships) {
    if (s === a || s === d) continue;
    s.x += 6000;
    s.speed = 0;
    s.fireMode = 'hold';
  }
  const cx = a.x;
  const cz = a.z;
  e.rts.followId = 0;
  e.speed = speed;
  e.fastForward = false;
  e.autoFast = false;
  a.ammo = ammo;
  const hold = () => {
    a.x = cx;
    a.z = cz;
    a.speed = 0;
    a.throttle = 0;
    a.heading = 0;
    a.order = { type: 'auto' };
    a.fireMode = 'free';
    a.targetId = d.id;
    a.fire = 0;
    d.x = cx + 10;
    d.z = cz + dist;
    d.speed = 0;
    d.throttle = 0;
    d.heading = 0;
    d.fireMode = 'hold';
    d.fire = 0;
    d.hull = d.spec.hull;
    d.crew = d.spec.crew;
    a.hull = a.spec.hull;
    a.crew = a.spec.crew;
    // Reloading is instant once per `reload` seconds, so a volley goes out on a rhythm the camera can wait for.
    if (performance.now() > nextVolley) {
      nextVolley = performance.now() + reload * 1000;
      for (const g of a.guns) {
        g.ammo = 99;
        if (g.stage < 4) g.stage = 4;
      }
    }
  };
  let nextVolley = 0;
  // --follow=<m>: ride beside the newest shell (yaw/pitch from --fyaw/--fpitch) so a close look at one round is possible.
  if (follow > 0) {
    window.__follow = setInterval(() => {
      // The oldest shell that has left the muzzle's glare.
      let p = null;
      for (const q of b.projectiles) if (q.age > 0.3 && (!p || q.age > p.age)) p = q;
      if (!p) return;
      e.rts.setPose({ tx: p.x, tz: p.z, yaw: fyaw, pitch: fpitch, distance: follow }, true);
      e.rts.lookLift = p.y + e.fx.liftOf(p);
    }, 16);
  }
  hold();
  window.__hold = setInterval(hold, 16);
  const poses = {
    close: { tx: cx + 4, tz: cz + 14, yaw: 0.0, pitch: 0.18, distance: 46 },
    mid: { tx: cx + 5, tz: cz + dist * 0.45, yaw: 0.0, pitch: 0.2, distance: dist * 0.9 },
    far: { tx: cx + 5, tz: cz + dist * 0.5, yaw: 0.0, pitch: 0.35, distance: dist * 2.4 },
    flight: { tx: cx + 5, tz: cz + dist * 0.5, yaw: 0.0, pitch: 0.1, distance: dist * 0.6 },
    hit: { tx: cx + 10, tz: cz + dist - 6, yaw: -1.15, pitch: 0.12, distance: 70 },
    hull: { tx: cx + 10, tz: cz + dist - 5, yaw: -1.2, pitch: 0.08, distance: 30 },
    salvo: { tx: cx + 40, tz: cz + dist * 0.28, yaw: -0.75, pitch: 0.1, distance: 85 },
    arrows: { tx: cx + 10, tz: cz + dist - 8, yaw: -1.0, pitch: 0.1, distance: 48 },
    behind: { tx: cx + 5, tz: cz + dist * 0.5, yaw: -1.5708, pitch: 0.13, distance: dist * 0.5 + 55 },
    target: { tx: cx + 10, tz: cz + dist, yaw: 0.0, pitch: 0.16, distance: 60 },
    high: { tx: cx + 5, tz: cz + dist * 0.5, yaw: 0.0, pitch: 0.9, distance: dist * 1.1 },
  };
  e.rts.setPose(poses[cam] ?? poses.mid);
  return { a: a.name, ka: a.spec.kind, d: d.name, kd: d.spec.kind, guns: a.guns.length };
}, opts);
console.log('setup', JSON.stringify(info), 'video starts at', ((Date.now() - t0) / 1000).toFixed(1), 's');
// --freeze=<m>[,<m>...]: stop the battle with a shell in the air and photograph it from each distance in turn.
if (args.freeze) {
  await page.waitForFunction(() => window.__engine.battle.projectiles.some((q) => q.age > 0.45), null, { timeout: 120000, polling: 30 });
  const dists = args.freeze.split(',').map(Number);
  for (let i = 0; i < dists.length; i += 1) {
    await page.evaluate(({ dist, fyaw, fpitch }) => {
      const e = window.__engine;
      let p = null;
      for (const q of e.battle.projectiles) if (q.age > 0.3 && (!p || q.age > p.age)) p = q;
      if (!p) p = window.__frozen;
      window.__frozen = p;
      clearInterval(window.__follow);
      e.speed = 0;
      e.rts.setPose({ tx: p.x, tz: p.z, yaw: fyaw, pitch: fpitch, distance: dist }, true);
      const lift = p.y + e.fx.liftOf(p);
      clearInterval(window.__lift);
      window.__lift = setInterval(() => {
        e.rts.lookLift = lift;
      }, 8);
    }, { dist: dists[i], fyaw: Number(args.fyaw ?? 0.7), fpitch: Number(args.fpitch ?? 0.05) });
    await page.waitForTimeout(900);
    const out = `${prefix}_${String(i).padStart(2, '0')}.png`;
    await page.screenshot({ path: out });
    console.log('saved', out, 'at', dists[i], 'm');
  }
} else if (!args.video) {
  // --await=stuck|rockets|shells: start photographing once that exists (the volleys of a duel come on their own rhythm).
  if (args.await) {
    await page.waitForFunction((what) => {
      const e = window.__engine;
      return what === 'stuck' ? e.fx.mun.stuckArrows > 0 : what === 'rockets' ? e.fx.mun.rocketsInFlight > 0 : e.battle.projectiles.length > 0;
    }, args.await, { timeout: 120000, polling: 50 });
  }
  for (let i = 0; i < shots; i += 1) {
    await page.waitForTimeout(i === 0 ? Number(args.first ?? 3500) : step);
    const out = `${prefix}_${String(i).padStart(2, '0')}.png`;
    await page.screenshot({ path: out });
    const stat = await page.evaluate(() => ({ shells: window.__engine.battle.projectiles.length, rockets: window.__engine.fx.mun.rocketsInFlight, stuck: window.__engine.fx.mun.stuckArrows, smoke: window.__engine.fx.smoke.count, fire: window.__engine.fx.fire.count, streaks: window.__engine.fx.streaks.count }));
    console.log('saved', out, JSON.stringify(stat));
  }
} else {
  await page.waitForTimeout(Number(args.seconds ?? 14) * 1000);
}
const interesting = logs.filter((l) => !l.includes('[vite]') && !l.includes('Download the React DevTools'));
if (interesting.length) console.log(interesting.slice(-30).join('\n'));
await page.evaluate(() => clearInterval(window.__hold));
await ctx.close();
await browser.close();
