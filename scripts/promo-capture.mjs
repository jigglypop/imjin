// Records the shots of a vertical promo reel (1080x1920) from the running game: each shot loads a battle or screen, stages
// it, and records the page through the DevTools screencast (JPEG frames with timestamps, encoded at a steady 30 fps).
//   node scripts/promo-capture.mjs --url=http://127.0.0.1:5291/ --out=shots/promo [--only=turtle,rockets]
// Writes <out>/<shot>.mp4 per shot. scripts/promo-edit.mjs cuts them into the reel.
import { chromium } from 'playwright-core';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, '').split('=');
    return [k, v.join('=') || 'true'];
  }),
);
const base = args.url ?? 'http://127.0.0.1:5291/';
const out = resolve(args.out ?? 'shots/promo');
const only = args.only ? new Set(args.only.split(',')) : null;
const W = 540;
const H = 960;

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
    seconds: 7,
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
    seconds: 8,
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
    seconds: 8,
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
    seconds: 8,
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
    seconds: 16,
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
    seconds: 14,
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
    url: '?lang=ko',
    seconds: 0,
    ui: true,
  },
];

async function record(page, dir, seconds, during) {
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  let n = 0;
  const pending = [];
  cdp.on('Page.screencastFrame', (f) => {
    const file = join(dir, `f${String(n).padStart(5, '0')}.jpg`);
    n += 1;
    frames.push({ file, t: f.metadata.timestamp });
    pending.push(writeFile(file, Buffer.from(f.data, 'base64')));
    cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 94, maxWidth: W * 2, maxHeight: H * 2, everyNthFrame: 1 });
  if (during) await during();
  else await page.waitForTimeout(seconds * 1000);
  await cdp.send('Page.stopScreencast');
  await Promise.all(pending);
  await cdp.detach();
  return frames;
}

/** Frames with their own timestamps into a steady 30 fps H.264 clip. */
function encode(frames, file) {
  const lines = [];
  for (let i = 0; i < frames.length; i += 1) {
    const dur = i + 1 < frames.length ? frames[i + 1].t - frames[i].t : 1 / 30;
    lines.push(`file '${frames[i].file}'`, `duration ${Math.max(0.001, dur).toFixed(4)}`);
  }
  lines.push(`file '${frames[frames.length - 1].file}'`);
  const list = `${file}.txt`;
  return writeFile(list, lines.join('\n')).then(() => {
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-vf', `fps=30,scale=${W * 2}:${H * 2}:flags=lanczos,format=yuv420p`, '-c:v', 'libx264', '-crf', '15', '-preset', 'slow', file]);
  });
}

await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=metal'] });
for (const shot of SHOTS) {
  if (only && !only.has(shot.name)) continue;
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
  page.on('pageerror', (e) => console.log(`[${shot.name}] pageerror ${e.message}`));
  await page.goto(base + shot.url, { waitUntil: 'domcontentloaded' });
  let frames;
  if (shot.ui) {
    await page.waitForSelector('.mode-card', { timeout: 60000 });
    await page.waitForTimeout(2500);
    frames = await record(page, join(out, shot.name), 0, async () => {
      await page.waitForTimeout(3200);
      await page.locator('.mode-card').nth(0).click();
      await page.waitForTimeout(3600);
      const tabs = page.locator('.hs-tab');
      if ((await tabs.count()) > 7) await tabs.nth(7).click();
      await page.waitForTimeout(3200);
      await page.locator('.back-btn').first().click();
      await page.waitForSelector('.mode-card', { timeout: 20000 });
      await page.locator('.mode-card').nth(1).click();
      await page.waitForTimeout(2600);
      await page.getByRole('button', { name: /으로 시작/ }).first().click();
      await page.waitForTimeout(2600);
      const choice = page.locator('.g-choice, .gd-choice, button:has-text("비축")').first();
      if (await choice.count()) await choice.click().catch(() => {});
      await page.waitForTimeout(3400);
    });
  } else {
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 240000 });
    await page.waitForTimeout(1500);
    await shot.setup(page);
    frames = await record(page, join(out, shot.name), shot.seconds);
  }
  await encode(frames, join(out, `${shot.name}.mp4`));
  const span = frames.length ? frames[frames.length - 1].t - frames[0].t : 0;
  console.log(`${shot.name}: ${frames.length} frames over ${span.toFixed(1)} s (${(frames.length / Math.max(span, 0.001)).toFixed(1)} fps)`);
  await page.close();
}
await browser.close();
