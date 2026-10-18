// Freeze frames of burning ships' smoke, by day and at night, and of the night battle, for before/after comparisons.
// The page runs on a clock the script steps (frame callbacks and performance.now only move in `step`, as in
// promo-capture.mjs) with Math.random seeded, so the same build gives the same frames: a ship is set alight at a fixed
// moment, burns for a fixed time and is photographed frozen from fixed cameras; Noryang is run to fixed battle times
// after first contact and shot from its default camera, over the fight and low on the water; the menu's burning
// backdrop at fixed moments of its cycle. `scan` runs Noryang's cinematic camera and keeps its darkest frames.
// Desktop is Edge on WebGPU; --phone is WebKit in probe-mobile.mjs's iPhone 15 Pro emulation (the WebGL2 path).
//   node scripts/probe-smoke.mjs --url=http://127.0.0.1:5365/ --out=<dir> --tag=before [--phone] [--only=day,night,noryang,scan,menu]
import { chromium, webkit, devices } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, '').split('=');
    return [k, v.join('=') || 'true'];
  }),
);
const base = (args.url ?? 'http://127.0.0.1:5291/').replace(/\/?$/, '/');
const out = args.out ?? 'shots/smoke';
const tag = args.tag ?? 'shot';
const phone = args.phone === 'true';
const only = new Set((args.only ?? 'day,night,noryang,scan,menu').split(','));
const quality = phone ? 'q=low&lv=2' : 'q=high&lv=4';
await mkdir(out, { recursive: true });

/**
 * Runs before the page's own scripts. Until `enable()` the page runs on the real clock (loading); after it, time only
 * moves in `step()`, and frame callbacks only run there. Math.random is a seeded generator `__seed` restarts.
 */
const CLOCK = `(() => {
  const realNow = performance.now.bind(performance);
  const realRaf = window.requestAnimationFrame.bind(window);
  const realCaf = window.cancelAnimationFrame.bind(window);
  const vt = { on: false, t: 0, queue: new Map(), next: 1e9 };
  // A fixed start, so the frame times (differences of large numbers) round the same way on every run.
  vt.enable = () => { if (vt.on) return; vt.t = 1e7; vt.on = true; };
  vt.step = (ms) => { vt.t += ms; const q = vt.queue; vt.queue = new Map(); for (const cb of q.values()) cb(vt.t); };
  vt.flush = () => new Promise((r) => realRaf(() => realRaf(r)));
  performance.now = () => (vt.on ? vt.t : realNow());
  window.requestAnimationFrame = (cb) => { if (!vt.on) return realRaf(cb); const id = vt.next++; vt.queue.set(id, cb); return id; };
  window.cancelAnimationFrame = (id) => { if (!vt.queue.delete(id)) realCaf(id); };
  window.__vt = vt;
  let s = 1592;
  Math.random = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  window.__seed = (n) => { s = n | 0; };
  // No kill-cam slow motion: the battle reaches each moment in the same number of frames.
  try { localStorage.setItem('imjin.slowmo', '0'); } catch {}
})();`;

const browser = phone
  ? await webkit.launch({ headless: true })
  : await chromium.launch({
      channel: process.platform === 'win32' ? 'msedge' : 'chrome',
      headless: true,
      args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', process.platform === 'win32' ? '--use-angle=d3d11' : '--use-angle=metal'],
    });

async function open(path) {
  const device = devices['iPhone 15 Pro'];
  const vp = phone ? { width: device.viewport.height, height: device.viewport.width } : { width: Number(args.w ?? 1280), height: Number(args.h ?? 720) };
  const ctx = await browser.newContext(phone ? { ...device, viewport: vp, screen: vp } : { viewport: vp, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.addInitScript(CLOCK);
  await page.goto(`${base}${path}`, { waitUntil: 'domcontentloaded' });
  return { ctx, page };
}

/** Steps the page clock `frames` frames of 1/30 s, a few at a time, letting the browser present between batches. */
async function run(page, frames, batch = 5) {
  for (let i = 0; i < frames; i += batch) {
    await page.evaluate(async (n) => {
      for (let k = 0; k < n; k += 1) window.__vt.step(1000 / 30);
      await window.__vt.flush();
    }, Math.min(batch, frames - i));
  }
}

const meta = [];
async function shoot(page, name, extra = {}) {
  const file = join(out, `${tag}_${name}.png`);
  await page.screenshot({ path: file });
  const info = await page.evaluate(() => {
    const e = window.__engine;
    if (!e) return {};
    const f = e.fx;
    const p = e.camera.position;
    return { t: +e.battle.time.toFixed(2), cam: [+p.x.toFixed(1), +p.y.toFixed(1), +p.z.toFixed(1)], plume: f.blaze.plume.count, flames: f.blaze.flames.count, smoke: f.smoke.count, blaze: f.blaze.stats() };
  });
  meta.push({ name, file, ...info, ...extra });
  console.log('saved', file, JSON.stringify(info));
}

/** In the page: freezes the battle, puts the camera at a pose and lets the clouds settle over a few frames. */
async function frozen(page, name, pose, settle = 12) {
  await page.evaluate((pose) => {
    const e = window.__engine;
    e.paused = true;
    if (pose) {
      e.rts.followId = 0;
      e.rts.setPose(pose, true);
      e.rts.lookLift = pose.lift ?? 0;
    }
  }, pose);
  await run(page, settle);
  await shoot(page, name, { pose });
}

/** Runs the battle at `speed` until battle time `until`, then freezes it. */
async function runTo(page, until, speed, each) {
  await page.evaluate((speed) => {
    const e = window.__engine;
    e.speed = speed;
    e.paused = false;
  }, speed);
  for (;;) {
    const t = await page.evaluate(() => window.__engine.battle.time);
    if (t >= until - 1e-6) break;
    const left = Math.ceil(((until - t) * 30) / speed);
    await run(page, Math.min(left, 30));
    if (each) await page.evaluate(each);
  }
  await page.evaluate(() => (window.__engine.paused = true));
}

/** The renderer's own clock (the `time` the shaders flicker with) restarts with the stepped one. */
const restartShaderTime = (renderer) => {
  const frame = renderer?._nodes?.nodeFrame;
  if (!frame) return;
  frame.time = 0;
  frame.lastTime = undefined;
};

async function ready(page) {
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 600000, polling: 500 });
  await page.evaluate(`(${restartShaderTime})(window.__engine.renderer); window.__vt.enable()`);
  await run(page, 3);
  await page.evaluate(() => window.__seed(1592));
}

/**
 * In the page: one Japanese ship set alight beside a Joseon one, everything else parked far away. The pair is held in
 * place and kept whole every frame, so the fire burns at the asked level without the hull ever giving out (and a
 * magazine blast, the gunfire's own effect, is not drawn), until `__sink` lets it go down.
 */
function stageFire({ kind, other }) {
  const e = window.__engine;
  const b = e.battle;
  const target = b.ships.find((s) => s.alive && s.spec.kind === kind && s.team === 'japan') ?? b.ships.find((s) => s.alive && s.team === 'japan');
  const near = b.ships.find((s) => s.alive && s.spec.kind === other && s.team === 'joseon') ?? b.ships.find((s) => s.alive && s.team === 'joseon');
  const parked = b.ships.filter((s) => s !== target && s !== near);
  for (const s of parked) s.x += 6000;
  const cx = target.x;
  const cz = target.z;
  e.rts.followId = 0;
  e.rts.cinematic = false;
  e.fastForward = false;
  e.autoFast = false;
  e.approachOver = true;
  window.__level = 0;
  window.__sink = false;
  const hold = () => {
    for (const s of parked) {
      s.speed = 0;
      s.throttle = 0;
      s.fireMode = 'hold';
      s.order = { type: 'hold' };
    }
    for (const [s, x, z] of [[target, cx, cz], [near, cx + 70, cz - 105]]) {
      if (!s.alive) continue;
      if (s === target && window.__sink) continue;
      s.x = x;
      s.z = z;
      s.heading = 0;
      s.speed = 0;
      s.throttle = 0;
      s.order = { type: 'hold' };
      s.fireMode = 'hold';
      s.hull = s.spec.hull;
      s.crew = s.spec.crew;
    }
    if (target.alive && !window.__sink) target.fire = window.__level;
    near.fire = 0;
  };
  const update = e.update.bind(e);
  e.update = (dt) => {
    hold();
    update(dt);
  };
  const handle = e.fx.handle.bind(e.fx);
  e.fx.handle = (events, battle) => handle(events.filter((ev) => ev.type !== 'explode'), battle);
  window.__target = target.id;
  window.__at = { x: cx, z: cz };
  return { id: target.id, kind: target.spec.kind, near: near.spec.kind, t: b.time };
}

const ignite = (page, level) =>
  page.evaluate((level) => {
    const e = window.__engine;
    const s = e.battle.get(window.__target);
    if (s.fire < 0.05) e.battle.events.push({ type: 'ignite', ship: s.id });
    window.__level = level;
  }, level);

async function fireScene(scene, sky) {
  const { ctx, page } = await open(`?scenario=hansan&hud=0&${quality}&paused=1${sky ? `&sky=${sky}` : ''}`);
  await ready(page);
  const t = await page.evaluate(stageFire, { kind: 'atakebune', other: 'panokseon' });
  console.log(scene, 'target', JSON.stringify(t));
  // The camera looks across the wind, so the column leans across the frame.
  const yaw = Math.atan2(1.6, 2.4) + Math.PI / 2;
  const at = await page.evaluate(() => window.__at);
  const close = { tx: at.x, tz: at.z, yaw, pitch: 0.16, distance: 80, lift: 6 };
  const rts = { tx: at.x + 20, tz: at.z + 10, yaw, pitch: 0.48, distance: 430 };
  const low = { tx: at.x + 30, tz: at.z + 20, yaw: yaw - 0.35, pitch: 0.05, distance: 240, lift: 18 };
  await page.evaluate((p) => window.__engine.rts.setPose(p, true), rts);
  await ignite(page, 0.5);
  await runTo(page, t.t + 10, 2);
  await ignite(page, 0.95);
  await runTo(page, t.t + 28, 2);
  await page.evaluate((p) => window.__engine.rts.setPose(p, true), close);
  await runTo(page, t.t + 30, 1);
  await frozen(page, `${scene}_close`, close);
  await page.evaluate((p) => window.__engine.rts.setPose(p, true), rts);
  await runTo(page, t.t + 31.5, 1);
  await frozen(page, `${scene}_rts`, rts);
  await page.evaluate((p) => window.__engine.rts.setPose(p, true), low);
  await runTo(page, t.t + 33, 1);
  await frozen(page, `${scene}_low`, low);
  // The hull gives out and goes down burning; its wreck burns on the water.
  await page.evaluate(() => {
    const s = window.__engine.battle.get(window.__target);
    window.__sink = true;
    s.hull = 0.01;
  });
  await page.evaluate((p) => window.__engine.rts.setPose(p, true), rts);
  const sunk = await page.evaluate(() => window.__engine.battle.time);
  for (let i = 0; i < 40; i += 1) {
    await runTo(page, sunk + (i + 1) * 3, 4);
    if (!(await page.evaluate(() => window.__engine.battle.get(window.__target)?.alive))) break;
  }
  const gone = await page.evaluate(() => window.__engine.battle.time);
  await runTo(page, gone + 10, 2);
  await runTo(page, gone + 12, 1);
  await frozen(page, `${scene}_pyre_rts`, rts);
  await page.evaluate((p) => window.__engine.rts.setPose(p, true), low);
  await runTo(page, gone + 13.5, 1);
  await frozen(page, `${scene}_pyre_low`, low);
  await ctx.close();
}

/** In the page: where the fight is, as a camera pose over it, and the biggest fire near it. */
function fightPose() {
  const e = window.__engine;
  const b = e.battle;
  const burning = b.ships.filter((s) => s.alive && s.fire > 0.08);
  const engaged = b.ships.filter((s) => s.alive && s.sinking === 0 && s.targetId);
  const pool = burning.length >= 2 ? burning : engaged.length ? engaged : b.ships.filter((s) => s.alive);
  const cx = pool.reduce((a, s) => a + s.x, 0) / pool.length;
  const cz = pool.reduce((a, s) => a + s.z, 0) / pool.length;
  const fire = burning.sort((a, c) => Math.hypot(a.x - cx, a.z - cz) - Math.hypot(c.x - cx, c.z - cz))[0];
  return { cx, cz, fire: fire ? { x: fire.x, z: fire.z, level: +fire.fire.toFixed(2), kind: fire.spec.kind } : null, burning: burning.length };
}

async function noryang(scan) {
  const { ctx, page } = await open(`?scenario=noryang&hud=0&${quality}&paused=1`);
  await ready(page);
  const home = await page.evaluate(() => ({ ...window.__engine.rts.goal }));
  await frozen(page, 'noryang_t0_default', home);
  // The approach is skipped as the game skips it, up to the first contact.
  await page.evaluate(() => {
    const e = window.__engine;
    e.autoFast = true;
    e.speed = 1;
    e.paused = false;
  });
  for (let i = 0; i < 400; i += 1) {
    await run(page, 5);
    if (await page.evaluate(() => window.__engine.approachOver)) break;
  }
  const contact = await page.evaluate(() => window.__engine.battle.time);
  console.log('contact at', contact.toFixed(1));
  const follow = () => {
    const e = window.__engine;
    const b = e.battle;
    const burning = b.ships.filter((s) => s.alive && s.fire > 0.08);
    const pool = burning.length >= 2 ? burning : b.ships.filter((s) => s.alive && s.sinking === 0 && s.targetId);
    if (!pool.length) return;
    const cx = pool.reduce((a, s) => a + s.x, 0) / pool.length;
    const cz = pool.reduce((a, s) => a + s.z, 0) / pool.length;
    e.rts.setPose({ ...e.rts.goal, tx: cx, tz: cz, pitch: 0.5, distance: 700 }, true);
  };
  for (const [label, after] of [['t1', 90], ['t2', 240]]) {
    await runTo(page, contact + after - 3, 8, follow);
    const f = await page.evaluate(fightPose);
    const over = { tx: f.cx, tz: f.cz, yaw: home.yaw, pitch: 0.5, distance: 700 };
    const fx = f.fire ?? { x: f.cx, z: f.cz };
    const low = { tx: fx.x, tz: fx.z, yaw: home.yaw, pitch: 0.06, distance: 170, lift: 12 };
    await page.evaluate((p) => window.__engine.rts.setPose(p, true), over);
    await runTo(page, contact + after, 1);
    await frozen(page, `noryang_${label}_fight`, over);
    await frozen(page, `noryang_${label}_default`, home);
    await page.evaluate((p) => window.__engine.rts.setPose(p, true), low);
    await runTo(page, contact + after + 1.5, 1);
    await frozen(page, `noryang_${label}_low`, low, 12);
    meta.at(-1).fight = f;
  }
  if (scan) {
    // The cinematic camera for 12 s: the darkest frames it gives, with what is in front of it.
    await page.evaluate(() => {
      const e = window.__engine;
      e.rts.cinematic = true;
      e.speed = 1;
      e.paused = false;
    });
    const frames = [];
    for (let i = 0; i < 72; i += 1) {
      await run(page, 5);
      const file = join(out, `${tag}_scan_${String(i).padStart(2, '0')}.jpg`);
      await page.screenshot({ path: file, type: 'jpeg', quality: 80 });
      const info = await page.evaluate(() => {
        const e = window.__engine;
        const p = e.camera.position;
        const b = e.battle;
        let nearest = 1e9;
        let kind = '';
        for (const s of b.ships) {
          if (!s.alive) continue;
          const d = Math.hypot(s.x - p.x, s.z - p.z);
          if (d < nearest) {
            nearest = d;
            kind = `${s.spec.kind} fire ${s.fire.toFixed(2)}`;
          }
        }
        return { t: +b.time.toFixed(2), cam: [+p.x.toFixed(1), +p.y.toFixed(1), +p.z.toFixed(1)], shot: e.director.shotName, nearest: +nearest.toFixed(1), kind };
      });
      frames.push({ file, ...info });
    }
    meta.push({ name: 'scan', frames });
  }
  await ctx.close();
}

async function menu() {
  const { ctx, page } = await open('?menuqa=1');
  await page.waitForFunction(() => window.__menuScene?.info().ready, null, { timeout: 300000, polling: 250 });
  await page.evaluate(`(${restartShaderTime})(window.__menuScene.renderer); window.__vt.enable()`);
  // The backdrop starts its next cycle (a new encounter of a fixed seed) on the stepped clock: fixed moments into it.
  await page.evaluate(() => {
    const m = window.__menuScene;
    m.cycle = 0;
    m.elapsed = 40;
    window.__seed(1592);
  });
  await run(page, 30 * 8);
  await shoot(page, 'menu_08s');
  await run(page, 30 * 14);
  await shoot(page, 'menu_22s');
  await ctx.close();
}

const started = Date.now();
if (only.has('day')) await fireScene('day');
if (only.has('night')) await fireScene('night', 'night');
if (only.has('noryang') || only.has('scan')) await noryang(only.has('scan'));
if (only.has('menu')) await menu();
await writeFile(join(out, `${tag}_meta.json`), JSON.stringify(meta, null, 1));
console.log('done in', ((Date.now() - started) / 1000).toFixed(0), 's');
await browser.close();
