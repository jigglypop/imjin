// Records what the game really sends to the speakers. A tap on the AudioContext destination (installed before any page
// script runs) collects the master bus into WAV files, one per scene, while the scene plays in real time.
//   node scripts/audio/capture.mjs --url=http://127.0.0.1:5291 --tag=after --out=<dir> [--only=menu,battle1x] [--secs=60]
// Scenes: menu, battle1x, battle8x, battle32x, fight (fast-forwarded to the first broadsides, then 60 s at 2x), skirmish, campaign. Writes <out>/<tag>_<scene>.wav and a line of
// battle stats per scene (<out>/<tag>_<scene>.json) so the recording can be matched against what the engine was doing.
import { chromium } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, '').split('=');
    return [k, v.join('=') || 'true'];
  }),
);
const base = (args.url ?? 'http://127.0.0.1:5291').replace(/\/$/, '');
const out = args.out ?? join(new URL('../..', import.meta.url).pathname, 'shots', 'progress', 'audio3');
const tag = args.tag ?? 'run';
const secs = Number(args.secs ?? 60);
const only = args.only ? args.only.split(',') : null;
await mkdir(out, { recursive: true });

const TAP = () => {
  const taps = new WeakMap();
  const proto = AudioNode.prototype;
  const connect = proto.connect;
  window.__rec = { chunks: [[], []], rate: 48000, on: false, ctx: null };
  proto.connect = function (dest, ...rest) {
    if (dest instanceof AudioDestinationNode && !taps.has(dest.context)) {
      const ctx = dest.context;
      const sp = ctx.createScriptProcessor(4096, 2, 2);
      sp.onaudioprocess = (e) => {
        if (!window.__rec.on) return;
        for (let c = 0; c < 2; c += 1) window.__rec.chunks[c].push(new Float32Array(e.inputBuffer.getChannelData(Math.min(c, e.inputBuffer.numberOfChannels - 1))));
      };
      taps.set(dest.context, sp);
      window.__rec.rate = ctx.sampleRate;
      window.__rec.ctx = ctx;
      connect.call(this, sp);
      connect.call(sp, dest);
    }
    return connect.call(this, dest, ...rest);
  };
};

const browser = await chromium.launch({
  channel: process.platform === 'win32' ? 'msedge' : 'chrome',
  headless: true,
  args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', process.platform === 'win32' ? '--use-angle=d3d11' : '--use-angle=metal'],
});

async function save(page, scene, extra) {
  const total = await page.evaluate(() => window.__rec.chunks[0].reduce((n, c) => n + c.length, 0));
  const rate = await page.evaluate(() => window.__rec.rate);
  const pcm = Buffer.alloc(total * 4);
  const step = 48000 * 5;
  for (let from = 0; from < total; from += step) {
    const b64 = await page.evaluate(
      ({ from, step }) => {
        const flat = (c) => {
          const all = window.__rec.chunks[c];
          const out = new Float32Array(all.reduce((n, a) => n + a.length, 0));
          let o = 0;
          for (const a of all) {
            out.set(a, o);
            o += a.length;
          }
          return out;
        };
        window.__flat ??= [flat(0), flat(1)];
        const l = window.__flat[0];
        const r = window.__flat[1];
        const n = Math.min(step, l.length - from);
        const i16 = new Int16Array(n * 2);
        for (let i = 0; i < n; i += 1) {
          i16[i * 2] = Math.max(-1, Math.min(1, l[from + i])) * 32767;
          i16[i * 2 + 1] = Math.max(-1, Math.min(1, r[from + i])) * 32767;
        }
        const bytes = new Uint8Array(i16.buffer);
        let bin = '';
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        return btoa(bin);
      },
      { from, step },
    );
    Buffer.from(b64, 'base64').copy(pcm, from * 4);
  }
  await page.evaluate(() => {
    window.__flat = undefined;
    window.__rec.chunks = [[], []];
  });
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(2, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 4, 28);
  header.writeUInt16LE(4, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  const file = join(out, `${tag}_${scene}.wav`);
  await writeFile(file, Buffer.concat([header, pcm]));
  await writeFile(join(out, `${tag}_${scene}.json`), JSON.stringify(extra, null, 1));
  console.log('wrote', file, `${(total / rate).toFixed(1)}s`);
}

const stats = (page) =>
  page.evaluate(() => {
    const e = window.__engine;
    if (!e) return null;
    const b = e.battle;
    const live = b.ships.filter((s) => s.alive && s.sinking <= 0);
    let min = Infinity;
    for (const a of live) for (const c of live) if (a.team !== c.team) min = Math.min(min, Math.hypot(a.x - c.x, a.z - c.z));
    const sinking = b.ships.filter((s) => s.alive && s.sinking > 0).length;
    return { t: +b.time.toFixed(0), ff: e.fastForward, speed: e.speed, closest: Math.round(min), shots: b.projectiles.length, ships: live.length, sinking };
  });

async function record(page, scene, seconds, probe) {
  await page.evaluate(() => {
    window.__rec.chunks = [[], []];
    window.__rec.on = true;
  });
  const timeline = [];
  for (let t = 0; t < seconds; t += 5) {
    await page.waitForTimeout(5000);
    const s = probe ? await probe(page) : null;
    if (s) timeline.push({ real: t + 5, ...s });
  }
  await page.evaluate(() => {
    window.__rec.on = false;
  });
  await save(page, scene, { scene, tag, seconds, timeline });
}

const poke = async (page) => {
  // A first gesture starts the context; the corner of the page does nothing in any screen.
  await page.mouse.click(4, 4);
  await page.keyboard.press('Shift');
  await page.waitForTimeout(300);
};

async function battle(page, scene, url, speed) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
  await poke(page);
  await page.evaluate((s) => {
    window.__engine.speed = s;
  }, speed);
  await record(page, scene, secs, stats);
}

const scenes = {
  async menu(page) {
    await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    await poke(page);
    await record(page, 'menu', secs);
  },
  async fight(page) {
    await page.goto(`${base}/?scenario=myeongnyang`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
    await poke(page);
    await page.evaluate(() => {
      window.__engine.speed = 32;
    });
    // Run the approach at 32x and slow down once enemy ships are inside broadside range of one another.
    await page.waitForFunction(
      () => {
        const b = window.__engine.battle;
        const live = b.ships.filter((s) => s.alive && s.sinking <= 0);
        let min = Infinity;
        for (const a of live) for (const c of live) if (a.team !== c.team) min = Math.min(min, Math.hypot(a.x - c.x, a.z - c.z));
        return min < 120;
      },
      null,
      { timeout: 240000, polling: 250 },
    );
    await page.evaluate(() => {
      window.__engine.speed = 2;
    });
    await record(page, 'fight', secs, stats);
  },
  battle1x: (page) => battle(page, 'battle1x', `${base}/?scenario=myeongnyang`, 1),
  battle8x: (page) => battle(page, 'battle8x', `${base}/?scenario=myeongnyang`, 8),
  battle32x: (page) => battle(page, 'battle32x', `${base}/?scenario=myeongnyang`, 32),
  skirmish: (page) => battle(page, 'skirmish', `${base}/?conquest=hallyeo&me=joseon&foe=japan&size=2`, 1),
  async campaign(page) {
    await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    await poke(page);
    await page.locator('.mode-card').nth(1).click();
    await page.waitForTimeout(2500);
    await page.screenshot({ path: join(out, `${tag}_campaign_a.png`) });
    // Pick a faction and start, whatever the screen calls it.
    for (const text of ['조선', '시작', '새 전역']) {
      const b = page.getByText(text, { exact: false }).first();
      if (await b.count()) {
        await b.click({ timeout: 2000 }).catch(() => undefined);
        await page.waitForTimeout(1200);
      }
    }
    await page.screenshot({ path: join(out, `${tag}_campaign_b.png`) });
    await record(page, 'campaign', secs);
  },
};

for (const [name, run] of Object.entries(scenes)) {
  if (only && !only.includes(name)) continue;
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.addInitScript(TAP);
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  try {
    await run(page);
  } catch (err) {
    console.log('scene failed', name, err.message);
  }
  await page.close();
}
await browser.close();
