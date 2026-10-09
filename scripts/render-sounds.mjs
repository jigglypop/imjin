// Renders the battle voices (src/audio/voices.ts) and a whole scripted battle through the game's own sound code
// (src/audio/battlefield.ts with the recorded samples) offline, and writes WAV files to listen to.
//   node scripts/render-sounds.mjs [--url=http://127.0.0.1:5291] [--out=<dir>] [--only=cannon_near,sinking,battle]
// Needs a running dev server: the modules are loaded through Vite, then rendered in an OfflineAudioContext in Chrome.
// `battle` writes audio2_battle.wav; the others are the synthesised voices alone.
import { chromium } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, '').split('=');
    return [k, v.join('=') || 'true'];
  }),
);
const base = (args.url ?? 'http://127.0.0.1:5291').replace(/\/$/, '');
const out = args.out ?? join(ROOT, 'shots', 'progress');
const only = args.only ? args.only.split(',') : null;
const RATE = 44100;

await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : 'chrome', headless: true });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => m.type() === 'error' && console.log('[console]', m.text()));
// Any page on the dev server's origin will do for importing its modules.
await page.goto(`${base}/src/audio/voices.ts`, { waitUntil: 'domcontentloaded' });

const scenes = {
  // Each gun fired alone, close: heaviest first.
  cannon_near: { secs: 17, play: `
    const shots = [['cheonja', 40, -0.25], ['jija', 60, 0.2], ['hyeonja', 70, -0.1], ['hwangja', 70, 0.15], ['seungja', 70, 0], ['folangji', 70, 0.1]];
    shots.forEach(([gun, d, pan], i) => { const s = ranged(d, pan); v.cannon(0.4 + i * 2.7 + s.delay, s, GUN_CLASS[gun], 'full'); });` },
  // The same heavy gun at growing range: crack and body fall away first, then the thump, and the shore echo comes late.
  cannon_far: { secs: 30, play: `
    [350, 700, 1200, 2000].forEach((d, i) => { const s = ranged(d, 0.3); v.cannon(0.4 + i * 6 + s.delay, s, GUN_CLASS.cheonja, d > 900 ? 'lite' : 'mid'); });` },
  // A broadside answered by a more distant one, then both together.
  broadside: { secs: 20, play: `
    const guns = ['cheonja', 'jija', 'jija', 'hyeonja', 'hyeonja', 'hwangja', 'hwangja', 'hwangja'];
    const volley = (t, d, pan, n, swell) => {
      const s = ranged(d, pan);
      v.cannon(t + s.delay, { ...s, gain: s.gain * swell }, GUN_CLASS[guns[0]], d > 350 ? 'mid' : 'full');
      for (let i = 1; i < n; i += 1) v.cannon(t + s.delay + Math.random() * 0.15, { ...s, gain: s.gain * 0.75, pan: s.pan + (Math.random() - 0.5) * 0.4 }, GUN_CLASS[guns[i % guns.length]], d > 350 ? 'lite' : 'mid');
    };
    volley(0.4, 120, -0.4, 8, 1.6);
    volley(6, 450, 0.5, 6, 1.5);
    volley(11, 140, -0.3, 8, 1.6); volley(11.4, 520, 0.6, 6, 1.4); volley(12.2, 350, 0.1, 5, 1.3);` },
  explosion: { secs: 16, play: `
    v.explosion(0.4, ranged(150, 0.2), 1.3);
    const far = ranged(900, -0.3); v.explosion(8 + far.delay, far, 1.3);` },
  // A ship going down over 30 s, played from the same plan the game's effects follow.
  sinking: { secs: 40, play: `
    const D = 30, spot = ranged(110, 0.25);
    const at = (p) => 0.3 + p * D;
    const blast = (t, size) => v.explosion(t, spot, 0.5 + size * 0.5);
    for (const c of planSinking(3, 2, 38)) {
      const t = at(c.at);
      if (c.kind === 'groan') v.groan(t, spot, c.size);
      else if (c.kind === 'crack' || c.kind === 'wreck') v.planks(t, spot, c.kind === 'wreck' ? c.size * 0.6 : c.size);
      else if (c.kind === 'mast') v.mast(t, spot);
      else if (c.kind === 'blast') blast(t, c.size);
      else if (c.kind === 'bubbles') v.bubbles(t, spot, 1.6 + c.size * 1.6, c.size);
      else if (c.kind === 'plunge') { v.bubbles(t, spot, 2.8, 1); v.splash(t, spot, 1.6); }
    }
    v.gurgle(at(1) + 0.2, spot, 1);` },
  // A scripted battle (about 48 s) played through Battlefield with the sample bank: a distant barrage, single heavy
  // guns, broadsides from both fleets, musketry, near misses, a magazine going up, a sinking and a ram.
  battle: { field: true, secs: 50, file: 'audio2_battle.wav', script: `
    const joseon = [1, 2, 3, 4, 5].map((id, i) => ship(id, -210 + i * 24, -170 - i * 55));
    const japan = [11, 12, 13, 14, 15, 16].map((id, i) => ship(id, 240 + i * 38, -320 - i * 45));
    const horizon = [21, 22, 23].map((id, i) => ship(id, -500 + i * 500, -1900 - i * 300));
    const heavyGuns = ['cheonja', 'jija', 'jija', 'hyeonja', 'hyeonja', 'hwangja', 'hwangja', 'seungja'];
    const lightGuns = ['hyeonja', 'hwangja', 'hwangja', 'seungja', 'seungja', 'folangji', 'hudun', 'hudun'];
    const fireAt = (t, from, gun, to, spread = 0) => {
      const ox = (rng() - 0.5) * 18, oz = (rng() - 0.5) * 18;
      const x = from.x + ox, z = from.z + oz;
      const tx = to.x + (rng() - 0.5) * 60, tz = to.z + (rng() - 0.5) * 60;
      const d = Math.hypot(tx - x, tz - z), nx = (tx - x) / d, nz = (tz - z) / d;
      const when = t + rng() * spread;
      at(when, { type: 'gun', ship: from.id, gun, x, y: 6, z, dx: nx, dy: 0.05, dz: nz, big: gun === 'cheonja' || gun === 'jija' });
      const speed = 190;
      at(when + 0.02, { type: 'shot', id: nextId(), team: 'joseon', gun, ammo: 'ball', x, y: 6, z, vx: nx * speed, vy: 12, vz: nz * speed });
      const fly = d / speed + 0.05;
      if (rng() < 0.45) at(when + fly, { type: 'hit', ship: to.id, proj: 0, x: tx, y: 4, z: tz, damage: 4 + rng() * 14, ammo: rng() < 0.12 ? 'grape' : 'ball' });
      else at(when + fly, { type: 'splash', proj: 0, x: tx, z: tz, size: rng() < 0.15 ? 1.2 : rng() < 0.2 ? 0.6 : 1 });
    };
    const broadside = (t, from, to, guns, n) => { for (let i = 0; i < n; i += 1) fireAt(t, from, guns[i % guns.length], to, 0.35); };
    // 0-9 s: a battle on the horizon only
    for (let t = 0.5; t < 9; t += 0.55 + rng() * 0.7) fireAt(t, horizon[Math.floor(rng() * 3)], 'jija', joseon[0]);
    // 5-11 s: the first single heavy guns, close
    [5, 7.2, 9.6].forEach((t, i) => fireAt(t, joseon[i % 2], 'cheonja', japan[i]));
    // 11-41 s: the fleets trade broadsides
    for (let t = 11; t < 41; t += 1.1 + rng() * 1.3) {
      const mine = rng() < 0.55;
      const from = mine ? joseon[Math.floor(rng() * joseon.length)] : japan[Math.floor(rng() * japan.length)];
      const to = mine ? japan[Math.floor(rng() * japan.length)] : joseon[Math.floor(rng() * joseon.length)];
      broadside(t, from, to, mine ? heavyGuns : lightGuns, 5 + Math.floor(rng() * 5));
      if (rng() < 0.5) fireAt(t + 0.4 + rng(), from, mine ? 'cheonja' : 'hyeonja', to);
    }
    for (let t = 13; t < 38; t += 2.6 + rng() * 2) { const from = japan[Math.floor(rng() * japan.length)]; const x = from.x - 160, z = from.z + 120; at(t, { type: 'musket', ship: from.id, x, y: 5, z, dx: -1, dz: 0, count: 8 + Math.floor(rng() * 14), arms: 'arquebus' }); }
    // near misses: rounds that pass within a few tens of metres of the camera
    [[15.5, 25], [23.2, -32], [29.8, 14]].forEach(([t, side]) => {
      const dx = side - 260, dy = 27, dz = 330, d = Math.hypot(dx, dy, dz), speed = 180;
      at(t, { type: 'shot', id: nextId(), team: 'japan', gun: 'hyeonja', ammo: 'ball', x: 260, y: 8, z: -330, vx: (dx / d) * speed, vy: (dy / d) * speed, vz: (dz / d) * speed });
    });
    [10, 22].forEach((t) => at(t, { type: 'volley', ship: 1, side: 1, count: 6 }));
    // 31-48 s: the end of it
    at(31.5, { type: 'explode', ship: 13, x: 316, y: 4, z: -410 });
    at(33.5, { type: 'sinking', ship: 12 });
    at(36.5, { type: 'ram', a: 3, b: 12, x: -100, z: -120, power: 1 });
    for (let t = 41; t < 48; t += 0.9 + rng() * 1.2) fireAt(t, horizon[Math.floor(rng() * 3)], 'jija', joseon[0]);
  ` },
};

for (const [name, scene] of Object.entries(scenes)) {
  if (only && !only.includes(name)) continue;
  const b64 = await page.evaluate(
    async ({ rate, secs, play, field, base }) => {
      const { buildBus, Voices, ranged } = await import('/src/audio/voices.ts');
      const { GUN_CLASS } = await import('/src/fx/gunClass.ts');
      const { planSinking } = await import('/src/fx/sinkPlan.ts');
      const ctx = new OfflineAudioContext(2, Math.floor(rate * secs), rate);
      const bus = buildBus(ctx);
      if (field) {
        const { Battlefield } = await import('/src/audio/battlefield.ts');
        const { Samples } = await import('/src/audio/samples.ts');
        const counts = {};
        const original = Samples.prototype.play;
        Samples.prototype.play = function (kind, t, o) { counts[kind] = (counts[kind] ?? 0) + 1; return original.call(this, kind, t, o); };
        window.__counts = counts;
        const bf = new Battlefield(ctx, bus.sfx, bus.reverb);
        await bf.load(`${base}/`);
        // Facing -z, so +x is to the right. Only x, y, z (and w) are read from these.
        const camera = { position: { x: 0, y: 35, z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 } };
        // Seeded, so every render of the script is the same battle.
        let seed = 1592;
        const rng = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
        const ships = new Map();
        const timeline = [];
        let id = 1000;
        const ship = (shipId, x, z) => { const s = { id: shipId, x, z, spec: { deck: 6 } }; ships.set(shipId, s); return s; };
        const at = (t, e) => timeline.push({ t, e });
        new Function('ship', 'at', 'rng', 'nextId', play)(ship, at, rng, () => (id += 1));
        timeline.sort((a, b) => a.t - b.t);
        const battle = { get: (shipId) => ships.get(shipId) };
        const STEP = 0.05;
        let next = 0;
        const step = (t) => {
          const events = [];
          while (next < timeline.length && timeline[next].t <= t) events.push(timeline[next++].e);
          bf.tick(camera, STEP, t * 1000);
          if (events.length) bf.update(events, battle, camera);
          if (t + STEP < secs - 0.1) ctx.suspend(t + STEP).then(() => step(t + STEP));
          ctx.resume();
        };
        ctx.suspend(STEP).then(() => step(STEP));
        var buf = await ctx.startRendering();
      } else {
        const v = new Voices(ctx, bus.sfx, bus.reverb);
        new Function('v', 'ranged', 'GUN_CLASS', 'planSinking', play)(v, ranged, GUN_CLASS, planSinking);
        var buf = await ctx.startRendering();
      }
      const l = buf.getChannelData(0);
      const r = buf.getChannelData(1);
      const pcm = new Int16Array(l.length * 2);
      let peak = 0;
      for (let i = 0; i < l.length; i += 1) peak = Math.max(peak, Math.abs(l[i]), Math.abs(r[i]));
      const k = peak > 0.98 ? 0.98 / peak : 1;
      for (let i = 0; i < l.length; i += 1) {
        pcm[i * 2] = Math.max(-1, Math.min(1, l[i] * k)) * 32767;
        pcm[i * 2 + 1] = Math.max(-1, Math.min(1, r[i] * k)) * 32767;
      }
      let bin = '';
      const bytes = new Uint8Array(pcm.buffer);
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return { data: btoa(bin), peak };
    },
    { rate: RATE, secs: scene.secs, play: scene.script ?? scene.play, field: !!scene.field, base },
  );
  if (scene.field) console.log('samples played', JSON.stringify(await page.evaluate(() => window.__counts)));
  const pcm = Buffer.from(b64.data, 'base64');
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(2, 22);
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 4, 28);
  header.writeUInt16LE(4, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  const file = join(out, scene.file ?? `${name}.wav`);
  await writeFile(file, Buffer.concat([header, pcm]));
  console.log('wrote', file, `${scene.secs}s`, 'peak', b64.peak.toFixed(2));
}
await browser.close();
