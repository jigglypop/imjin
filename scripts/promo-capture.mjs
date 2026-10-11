// Records the shots of a vertical promo reel from the running game at 2160x3840: each shot loads a battle or screen,
// stages it, then renders it on a clock the script steps itself (30 fps, two 60 Hz steps a frame), grabbing every frame,
// so nothing drops however long a 4K frame takes to draw. Frames go straight into ffmpeg.
//   node scripts/promo-capture.mjs --url=http://127.0.0.1:5291/ --out=shots/promo/en [--only=turtle,rockets] [--lang=en]
// Writes <out>/<shot>.mp4 per shot (near-lossless intermediates). scripts/promo-edit.mjs cuts them into the reel.
import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, '').split('=');
    return [k, v.join('=') || 'true'];
  }),
);
const base = args.url ?? 'http://127.0.0.1:5291/';
const out = resolve(args.out ?? 'shots/promo');
const only = args.only ? new Set(args.only.split(',')) : null;
const lang = args.lang ?? 'en';
// A phone-shaped page drawn at four device pixels per CSS pixel: 540x960 CSS is 2160x3840 on screen.
const W = 540;
const H = 960;
const SCALE = 4;
const FPS = 30;
const SUB = 2;

/**
 * Runs before the page's own scripts: a clock the capture stops and steps. Until `enable()` the page runs on the real
 * clock (loading, staging); after it, time only moves in `step()`, and frame callbacks only run there, so each frame is
 * simulated and drawn at exactly its own moment.
 */
const VIRTUAL_TIME = `(() => {
  const realNow = performance.now.bind(performance);
  const dateBase = Date.now() - realNow();
  const realRaf = window.requestAnimationFrame.bind(window);
  const realCaf = window.cancelAnimationFrame.bind(window);
  // offset keeps the clock running forward across a switch back to real time after the stepped clock ran ahead
  const vt = { on: false, t: 0, offset: 0, queue: new Map(), next: 1e9 };
  vt.enable = () => { if (vt.on) return; vt.t = realNow() + vt.offset; vt.on = true; };
  vt.disable = () => {
    if (!vt.on) return;
    vt.offset = vt.t - realNow();
    vt.on = false;
    const q = vt.queue;
    vt.queue = new Map();
    for (const cb of q.values()) realRaf(cb);
  };
  vt.step = (ms) => { vt.t += ms; const q = vt.queue; vt.queue = new Map(); for (const cb of q.values()) cb(vt.t); };
  vt.flush = () => new Promise((r) => realRaf(() => realRaf(r)));
  performance.now = () => (vt.on ? vt.t : realNow() + vt.offset);
  Date.now = () => Math.round(dateBase + performance.now());
  window.requestAnimationFrame = (cb) => { if (!vt.on) return realRaf(cb); const id = vt.next++; vt.queue.set(id, cb); return id; };
  window.cancelAnimationFrame = (id) => { if (!vt.queue.delete(id)) realCaf(id); };
  window.__vt = vt;
})();`;

/** In the page: park every ship but a chosen pair, so one duel fills the frame. Returns the pair's names. */
function stageDuel({ kindA, kindD, dist, ammo, reload, team }) {
  const e = window.__engine;
  const b = e.battle;
  const foe = team === 'joseon' ? 'japan' : 'joseon';
  const a = b.ships.find((s) => s.alive && s.spec.kind === kindA && s.team === team) ?? b.ships.find((s) => s.alive && s.team === team);
  const d = b.ships.find((s) => s.alive && s.spec.kind === kindD && s.team === foe) ?? b.ships.find((s) => s.alive && s.team === foe);
  for (const s of b.ships) {
    if (s === a || s === d) continue;
    s.x += 6000;
    s.speed = 0;
    s.fireMode = 'hold';
  }
  const cx = a.x;
  const cz = a.z;
  e.rts.followId = 0;
  e.rts.cinematic = false;
  e.speed = 1;
  e.fastForward = false;
  e.autoFast = false;
  a.ammo = ammo;
  let next = 0;
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
    if (performance.now() > next) {
      next = performance.now() + reload * 1000;
      for (const g of a.guns) {
        g.ammo = 99;
        if (g.stage < 4) g.stage = 4;
      }
    }
  };
  hold();
  window.__hold = setInterval(hold, 16);
  window.__duel = { cx, cz, dist, a: a.id, d: d.id };
  return { a: a.name, d: d.name };
}

/** In the page: a slow camera move between two poses over `seconds` (eased), optionally riding a ship. */
function moveCamera({ from, to, seconds, follow }) {
  const e = window.__engine;
  const t0 = performance.now();
  e.rts.setPose(from, true);
  const lerp = (a, b, t) => a + (b - a) * t;
  clearInterval(window.__move);
  window.__move = setInterval(() => {
    const t = Math.min(1, (performance.now() - t0) / (seconds * 1000));
    const k = t * t * (3 - 2 * t);
    const ship = follow ? e.battle.ships.find((s) => s.id === follow) : null;
    e.rts.setPose(
      {
        tx: ship ? ship.x + (to.ox ?? 0) : lerp(from.tx, to.tx, k),
        tz: ship ? ship.z + (to.oz ?? 0) : lerp(from.tz, to.tz, k),
        yaw: lerp(from.yaw, to.yaw, k),
        pitch: lerp(from.pitch, to.pitch, k),
        distance: lerp(from.distance, to.distance, k),
      },
      false,
    );
    if (to.lift !== undefined) e.rts.lookLift = to.lift;
  }, 16);
}

const SHOTS = [
  {
    // 13 against 133: from behind the Joseon line, the whole Japanese fleet filling the strait, pushing in.
    name: 'myeong_wide',
    url: '?scenario=myeongnyang&hud=0&lv=4&q=high&sky=sunset&sea=moderate',
    seconds: 4,
    async setup(page) {
      await page.evaluate(() => {
        const e = window.__engine;
        const b = e.battle;
        e.fastForward = false;
        e.autoFast = false;
        e.speed = 1;
        const mean = (team) => {
          const s = b.ships.filter((x) => x.alive && x.team === team);
          return { x: s.reduce((a, v) => a + v.x, 0) / s.length, z: s.reduce((a, v) => a + v.z, 0) / s.length };
        };
        window.__fleets = { j: mean('joseon'), e: mean('japan') };
      });
      const f = await page.evaluate(() => window.__fleets);
      const yaw = Math.atan2(f.j.z - f.e.z, f.j.x - f.e.x);
      const tx = f.j.x * 0.55 + f.e.x * 0.45;
      const tz = f.j.z * 0.55 + f.e.z * 0.45;
      await page.evaluate(moveCamera, { from: { tx, tz, yaw: yaw + 0.25, pitch: 0.32, distance: 820 }, to: { tx, tz, yaw: yaw + 0.05, pitch: 0.2, distance: 560 }, seconds: 7 });
    },
  },
  {
    // A panokseon's broadside from just behind its guns: smoke, flashes and round shot arcing away.
    name: 'broadside',
    url: '?scenario=hansan&hud=0&lv=4&q=high&sky=sunset&sea=calm',
    seconds: 3.5,
    async setup(page) {
      await page.evaluate(stageDuel, { kindA: 'panokseon', kindD: 'atakebune', dist: 230, ammo: 'auto', reload: 2.6, team: 'joseon' });
      const { cx, cz } = await page.evaluate(() => window.__duel);
      // off the bow on the firing side: the flashes and the smoke bloom toward the lens
      await page.evaluate(moveCamera, {
        from: { tx: cx, tz: cz + 6, yaw: 1.15, pitch: 0.11, distance: 84 },
        to: { tx: cx + 2, tz: cz + 10, yaw: 0.8, pitch: 0.13, distance: 70 },
        seconds: 8,
      });
    },
  },
  {
    // The turtle ship charging, the camera low off its bow so the dragon head leads the frame.
    name: 'turtle',
    url: '?scenario=hansan&hud=0&lv=4&q=high&sky=sunset&sea=calm',
    seconds: 8,
    async setup(page) {
      await page.evaluate(() => {
        const e = window.__engine;
        const b = e.battle;
        const a = b.ships.find((s) => s.alive && s.spec.kind === 'geobukseon' && s.team === 'joseon');
        for (const s of b.ships) {
          if (s === a) continue;
          s.x += 6000;
          s.speed = 0;
          s.fireMode = 'hold';
        }
        e.rts.followId = 0;
        e.rts.cinematic = false;
        e.speed = 1;
        e.fastForward = false;
        e.autoFast = false;
        const x0 = a.x;
        const z0 = a.z;
        const t0 = performance.now();
        const v = 6;
        const hold = () => {
          const t = (performance.now() - t0) / 1000;
          a.x = x0 + v * t;
          a.z = z0;
          a.heading = 0;
          a.speed = v;
          a.throttle = 1;
          a.order = { type: 'auto' };
          a.fireMode = 'hold';
          a.fire = 0;
        };
        hold();
        window.__hold = setInterval(hold, 16);
        window.__duel = { a: a.id, cx: x0, cz: z0 };
      });
      const { a, cx, cz } = await page.evaluate(() => window.__duel);
      await page.evaluate(moveCamera, {
        from: { tx: cx + 18, tz: cz, yaw: 0.75, pitch: 0.07, distance: 40 },
        to: { ox: 19, oz: 0, yaw: 0.12, pitch: 0.1, distance: 34, lift: 2 },
        seconds: 8,
        follow: a,
      });
    },
  },
  {
    // A singijeon rocket salvo seen from the side as it climbs and falls on the enemy.
    name: 'rockets',
    url: '?scenario=hansan&hud=0&lv=4&q=high&sky=sunset&sea=calm',
    seconds: 5,
    async setup(page) {
      await page.evaluate(stageDuel, { kindA: 'panokseon', kindD: 'atakebune', dist: 240, ammo: 'fire', reload: 2.4, team: 'joseon' });
      const { cx, cz, dist } = await page.evaluate(() => window.__duel);
      // low behind the shooter, looking down the line of fire: the salvo arcs up and away toward the enemy
      await page.evaluate(moveCamera, {
        from: { tx: cx + 4, tz: cz + dist * 0.4, yaw: -1.75, pitch: 0.14, distance: dist * 0.4 + 70 },
        to: { tx: cx + 6, tz: cz + dist * 0.5, yaw: -1.5, pitch: 0.18, distance: dist * 0.5 + 50 },
        seconds: 8,
      });
    },
  },
  {
    // Japanese crews grappling and climbing onto a panokseon.
    name: 'boarding',
    url: '?scenario=hansan&hud=0&lv=4&q=high&sky=sunset&sea=calm',
    seconds: 4.2,
    async setup(page) {
      await page.evaluate(() => {
        const e = window.__engine;
        const b = e.battle;
        const a = b.ships.find((s) => s.alive && s.spec.kind === 'sekibune' && s.team === 'japan');
        const d = b.ships.find((s) => s.alive && s.spec.kind === 'panokseon' && s.team === 'joseon');
        const cx = d.x;
        const cz = d.z;
        const az = cz + (a.spec.beam + d.spec.beam) / 2 + 3;
        for (const s of b.ships) {
          if (s === a || s === d) continue;
          s.x += 6000;
          s.speed = 0;
          s.fireMode = 'hold';
        }
        for (const s of [a, d]) {
          s.speed = 0;
          s.throttle = 0;
          s.speedCap = 0;
          s.order = { type: 'auto' };
          s.fireMode = 'hold';
          s.heading = 0;
        }
        a.stance = 'board';
        for (let i = 0; i < 4; i += 1) a.roles[i] *= 2.5;
        a.crew *= 2.5;
        e.rts.followId = 0;
        e.rts.cinematic = false;
        e.speed = 1;
        e.fastForward = false;
        e.autoFast = false;
        const hold = () => {
          for (const s of [a, d]) {
            s.speed = 0;
            s.throttle = 0;
            s.x = cx;
            s.z = s === a ? az : cz;
            s.heading = 0;
            s.fire = 0;
            s.burn = 0;
            for (const g of s.guns) g.ammo = 0;
            for (let i = 0; i < 4; i += 1) s.roles[i] = Math.max(s.roles[i], s.spec.crew * s.plan[i] * 0.6);
            s.crew = s.roles[0] + s.roles[1] + s.roles[2] + s.roles[3];
            s.struck = false;
          }
          a.stance = 'board';
        };
        hold();
        window.__hold = setInterval(hold, 16);
        b.tryGrapple(a, d);
        window.__duel = { cx, cz: (az + cz) / 2 };
      });
      const { cx, cz } = await page.evaluate(() => window.__duel);
      await page.waitForTimeout(2500);
      await page.evaluate(moveCamera, {
        from: { tx: cx - 3, tz: cz, yaw: 1.15, pitch: 0.34, distance: 30 },
        to: { tx: cx + 3, tz: cz, yaw: 1.5, pitch: 0.28, distance: 24 },
        seconds: 8,
      });
    },
  },
  {
    // Noryang at night: lanterns, gun flashes and burning ships under the cinematic camera.
    name: 'night',
    url: '?scenario=noryang&hud=0&lv=4&q=high',
    seconds: 12,
    async setup(page) {
      // let the approach run until the fleets meet, then the cinematic camera takes the fight
      await page.waitForFunction(() => window.__engine.approachOver, null, { timeout: 180000 });
      await page.evaluate(() => {
        const e = window.__engine;
        e.fastForward = false;
        e.autoFast = false;
        e.speed = 1;
        e.rts.cinematic = true;
      });
      await page.waitForTimeout(4000);
    },
  },
  {
    // Myeongnyang under the cinematic camera, for spare cuts of the fight itself.
    name: 'myeong_fight',
    url: '?scenario=myeongnyang&hud=0&lv=4&q=high&sky=sunset&sea=moderate',
    seconds: 11,
    async setup(page) {
      // let the approach run until the fleets meet, then the cinematic camera takes the fight
      await page.waitForFunction(() => window.__engine.approachOver, null, { timeout: 180000 });
      await page.evaluate(() => {
        const e = window.__engine;
        e.fastForward = false;
        e.autoFast = false;
        e.speed = 1;
        e.rts.cinematic = true;
      });
      await page.waitForTimeout(4000);
    },
  },
  {
    // The screens: title, the dark history map with its flags, the faction pick and the campaign map.
    name: 'ui',
    url: '',
    seconds: 0,
    ui: true,
  },
];

/** An ffmpeg process that takes JPEG frames on stdin and writes a near-lossless H.264 intermediate. */
function encoder(file) {
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-', '-vf', 'format=yuv420p', '-c:v', 'libx264', '-preset', 'medium', '-crf', '8', file], { stdio: ['pipe', 'inherit', 'inherit'] });
  return {
    async frame(buf) {
      if (!ff.stdin.write(buf)) await once(ff.stdin, 'drain');
    },
    async close() {
      ff.stdin.end();
      await once(ff, 'close');
    },
  };
}

/** Steps the page's clock frame by frame for `seconds`, grabbing each frame into the encoder. */
async function capture(page, enc, seconds) {
  await page.evaluate(() => window.__vt.enable());
  const frames = Math.round(seconds * FPS);
  for (let i = 0; i < frames; i += 1) {
    await page.evaluate(async (sub) => {
      for (let k = 0; k < sub; k += 1) window.__vt.step(1000 / (30 * sub));
      await window.__vt.flush();
    }, SUB);
    await enc.frame(await page.screenshot({ type: 'jpeg', quality: 98 }));
  }
  // back on the real clock, so clicks and screen changes between captures run as they would for a player
  await page.evaluate(() => window.__vt.disable());
  return frames;
}

await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=metal'] });
for (const shot of SHOTS) {
  if (only && !only.has(shot.name)) continue;
  const t0 = Date.now();
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: SCALE });
  page.on('pageerror', (e) => console.log(`[${shot.name}] pageerror ${e.message}`));
  await page.addInitScript(VIRTUAL_TIME);
  const sep = shot.url.includes('?') ? '&' : '?';
  await page.goto(`${base}${shot.url}${sep}lang=${lang}&dpr=${SCALE}`, { waitUntil: 'domcontentloaded' });
  const enc = encoder(join(out, `${shot.name}.mp4`));
  let frames = 0;
  if (shot.ui) {
    // The screens: title, the history map gliding to Myeongnyang, the faction campaign's first event.
    await page.waitForSelector('.mode-card', { timeout: 60000 });
    await page.waitForTimeout(2500);
    frames += await capture(page, enc, 3.4);
    await page.locator('.mode-card').nth(0).click();
    await page.waitForTimeout(1800);
    frames += await capture(page, enc, 1.2);
    const tabs = page.locator('.hs-tab');
    if ((await tabs.count()) > 7) await tabs.nth(7).click();
    await page.waitForTimeout(400);
    frames += await capture(page, enc, 3.6);
    await page.locator('.back-btn').first().click();
    await page.waitForSelector('.mode-card', { timeout: 20000 });
    await page.waitForTimeout(600);
    await page.locator('.mode-card').nth(1).click();
    await page.waitForTimeout(1500);
    await page.getByRole('button', { name: lang === 'en' ? /^Play / : /으로 시작/ }).first().click();
    await page.waitForTimeout(2200);
    frames += await capture(page, enc, 3.2);
  } else {
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 240000 });
    await page.waitForTimeout(1500);
    await shot.setup(page);
    frames = await capture(page, enc, shot.seconds);
  }
  await enc.close();
  console.log(`${shot.name}: ${frames} frames in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  await page.close();
}
await browser.close();
