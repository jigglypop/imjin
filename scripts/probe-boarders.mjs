// Isolated boarding / volley probe: parks one pair of ships away from the rest of the scenario, forces a grapple (or a
// volley across open water), and takes screenshots and an optional video from chosen camera distances.
//   node scripts/probe-boarders.mjs --url=http://127.0.0.1:5442/ --prefix=<path/prefix> [options]
//   --engine=chromium|webkit   webkit uses the iPhone 15 Pro emulation (add --q=low for the phone tier)
//   --a=sekibune --d=panokseon   kinds of the grappling and the held ship; --ateam=japan --dteam=joseon
//   --va=0 --vd=0   model variants to look for (the pair is picked from the fleet by kind and variant when one exists)
//   --dist=100 --pitch=0.5 --yaw=1.57 --ox=0 --oz=0   camera around the pair; --shots=4 --step=2500
//   --boost=3 --dfrac=1   scale the boarders' crew / the held crew;  --sustain=1 keeps both crews topped up
//   --volley=bow|gun   skip the grapple, put the ships --gap=60 m apart and order volleys every --every=3000 ms
//   --video=<dir>   record a video of the whole run;  --speed=1
import { chromium, webkit, devices } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, '').split('=');
    return [k, v.join('=') || 'true'];
  }),
);
const url = args.url ?? 'http://127.0.0.1:5442/';
const prefix = args.prefix ?? '/Users/yeomdonghwan/Desktop/imjin/shots/progress/boarders_probe';
const shots = Number(args.shots ?? 4);
const step = Number(args.step ?? 2500);
const engine = args.engine ?? 'chromium';
await mkdir(dirname(prefix), { recursive: true });

let browser;
let ctxOpts = { viewport: { width: Number(args.w ?? 1600), height: Number(args.h ?? 900) } };
if (engine === 'webkit') {
  browser = await webkit.launch({ headless: true });
  const base = devices['iPhone 15 Pro'];
  const vp = { width: base.viewport.height, height: base.viewport.width };
  ctxOpts = { ...base, viewport: vp, screen: vp };
} else {
  browser = await chromium.launch({
    channel: process.platform === 'win32' ? 'msedge' : 'chrome',
    headless: true,
    args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', process.platform === 'win32' ? '--use-angle=d3d11' : '--use-angle=metal'],
  });
}
if (args.video) {
  await mkdir(args.video, { recursive: true });
  ctxOpts.recordVideo = { dir: args.video, size: { width: Math.min(1280, ctxOpts.viewport.width), height: Math.round((Math.min(1280, ctxOpts.viewport.width) * ctxOpts.viewport.height) / ctxOpts.viewport.width) } };
}
const ctx = await browser.newContext(ctxOpts);
const page = await ctx.newPage();
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('crash', () => logs.push('[crash]'));
await page.goto(`${url}?scenario=${args.scenario ?? 'hansan'}&hud=0&q=${args.q ?? 'high'}${args.webgl ? '&webgl=1' : ''}`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 300000 });

const opts = {
  kindA: args.a ?? 'sekibune',
  kindD: args.d ?? 'panokseon',
  teamA: args.ateam ?? 'japan',
  teamD: args.dteam ?? 'joseon',
  va: args.va === undefined ? -1 : Number(args.va),
  vd: args.vd === undefined ? -1 : Number(args.vd),
  dist: Number(args.dist ?? 100),
  pitch: Number(args.pitch ?? 0.5),
  yaw: Number(args.yaw ?? 1.57),
  speed: Number(args.speed ?? 1),
  boost: Number(args.boost ?? 3),
  ox: Number(args.ox ?? 0),
  oz: Number(args.oz ?? 0),
  dfrac: Number(args.dfrac ?? 1),
  gap: args.volley ? Number(args.gap ?? 60) : null,
  sustain: args.sustain === '1',
};
const info = await page.evaluate((o) => {
  const e = window.__engine;
  const b = e.battle;
  const keyOf = (s) => e.views.states.get(s.id)?.key;
  const pick = (kind, team, v, not) => {
    const all = b.ships.filter((s) => s.alive && s.spec.kind === kind && s.team === team && !s.grappledWith && s !== not);
    return all.find((s) => v < 0 || keyOf(s) === `${kind}#${v}`) ?? all[0] ?? b.ships.find((s) => s.alive && s.team === team && s !== not);
  };
  const a = pick(o.kindA, o.teamA, o.va);
  const d = pick(o.kindD, o.teamD, o.vd, a);
  const cx = d.x;
  const cz = d.z;
  const az = o.gap === null ? cz + (a.spec.beam + d.spec.beam) / 2 + 3 : cz + o.gap;
  const pair = [a, d];
  // Everything else sails off to the far corner so nothing shoots the pair.
  for (const s of b.ships) {
    if (s === a || s === d) continue;
    s.x += 6000;
    s.speed = 0;
    s.throttle = 0;
    s.fireMode = 'hold';
  }
  for (const s of pair) {
    s.speed = 0;
    s.throttle = 0;
    s.speedCap = 0;
    s.order = { type: 'auto' };
    s.fireMode = o.gap === null ? 'hold' : 'free';
    s.heading = 0;
  }
  a.stance = 'board';
  if (o.boost > 1) {
    for (let i = 0; i < 4; i += 1) a.roles[i] *= o.boost;
    a.crew *= o.boost;
  }
  for (let i = 0; i < 4; i += 1) d.roles[i] = d.plan[i] * d.spec.crew * o.dfrac;
  d.crew = d.spec.crew * o.dfrac;
  e.rts.followId = 0;
  e.speed = o.speed;
  e.fastForward = false;
  e.autoFast = false;
  window.__pair = { a: a.id, d: d.id };
  const hold = () => {
    for (const s of pair) {
      s.speed = 0;
      s.throttle = 0;
      s.x = s === a ? cx : cx;
      s.z = s === a ? az : cz;
      s.heading = 0;
      s.fire = 0;
      s.burn = 0;
      // No cannon smoke over the boarding: the guns of the pair are empty.
      for (const g of s.guns) g.ammo = 0;
      if (o.sustain) {
        for (let i = 0; i < 4; i += 1) s.roles[i] = Math.max(s.roles[i], s.spec.crew * s.plan[i] * 0.5);
        s.crew = s.roles[0] + s.roles[1] + s.roles[2] + s.roles[3];
        s.struck = false;
      }
    }
    a.stance = o.gap === null ? 'board' : 'standoff';
  };
  hold();
  window.__hold = setInterval(hold, 16);
  if (o.gap === null) b.tryGrapple(a, d);
  e.rts.setPose({ tx: cx + o.ox, tz: (az + cz) / 2 + o.oz, yaw: o.yaw, pitch: o.pitch, distance: o.dist });
  return { a: a.name, ka: keyOf(a), d: d.name, kd: keyOf(d), grappled: a.grappledWith === d.id, crewA: a.crew, crewD: d.crew };
}, opts);
console.log('setup', JSON.stringify(info));

if (args.noprops) await page.evaluate(() => { window.__engine.crew.boarding.props.material.visible = false; });
if (args.nopuff) await page.evaluate(() => { window.__engine.crew.boarding.puffs.group.visible = false; });
const volley = args.volley;
const fireVolley = () =>
  page.evaluate(
    ({ volley }) => {
      const e = window.__engine;
      const b = e.battle;
      const { a, d } = window.__pair;
      const ship = b.get(volley === 'gun' ? a : d);
      const foe = b.get(volley === 'gun' ? d : a);
      const dx = foe.x - ship.x;
      const dz = foe.z - ship.z;
      const len = Math.hypot(dx, dz);
      ship.targetId = foe.id;
      e.crew.handle([{ type: 'musket', ship: ship.id, x: ship.x, y: 2, z: ship.z, dx: dx / len, dz: dz / len, count: 12, arms: volley === 'gun' ? 'gun' : 'bow' }], b);
      return 'ok';
    },
    { volley },
  );
if (volley) await page.waitForTimeout(Number(args.warm ?? 1500));
let lastVolley = -1e9;
for (let i = 0; i < shots; i += 1) {
  if (volley && Date.now() - lastVolley > Number(args.every ?? 3000)) {
    await fireVolley();
    lastVolley = Date.now();
  }
  await page.waitForTimeout(step);
  const st = await page.evaluate(() => {
    const e = window.__engine;
    const b = e.battle;
    const { a, d } = window.__pair;
    const sa = b.get(a);
    const sd = b.get(d);
    const bo = e.crew.boarding;
    const states = [0, 0, 0, 0, 0, 0];
    for (const f of bo.figs) if (f.used) states[f.state] += 1;
    return { t: Math.round(b.time), grapple: sa.grappledWith, crewA: Math.round(sa.crew), crewD: Math.round(sd.crew), struckD: sd.struck, struckA: sa.struck, figs: states.join('/'), capture: [...bo.captures.values()].map((c) => `${c.id}:${c.win}`).join(','), nProps: bo.nProps, puffs: bo.puffs.pool.filter((x) => x.used).length, puffKinds: [0, 1, 2, 3].map((k) => bo.puffs.pool.filter((x) => x.used && x.kind === k).length).join('/'), arrowsFlying: bo.arrows.pool.filter((x) => x.used && !x.stuck).length, arrowsStuck: bo.arrows.pool.filter((x) => x.used && x.stuck).length };
  });
  const out = `${prefix}_${String(i).padStart(2, '0')}.png`;
  await page.screenshot({ path: out });
  console.log(i, JSON.stringify(st), out);
}
const video = args.video ? page.video() : null;
await ctx.close();
if (video) console.log('video', await video.path());
const interesting = logs.filter((l) => !l.includes('[vite]') && !l.includes('DevTools') && !l.includes('normal" not found') && !l.includes('THREE.Clock'));
if (interesting.length) console.log(interesting.slice(-30).join('\n'));
await browser.close();
