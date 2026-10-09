// Renders the battle voices (src/audio/voices.ts) offline and writes WAV files to listen to.
//   node scripts/render-sounds.mjs [--url=http://127.0.0.1:5291] [--out=<dir>] [--only=cannon_near,sinking]
// Needs a running dev server: the voices are loaded through Vite, then rendered in an OfflineAudioContext in Chrome.
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
};

for (const [name, scene] of Object.entries(scenes)) {
  if (only && !only.includes(name)) continue;
  const b64 = await page.evaluate(
    async ({ rate, secs, play }) => {
      const { buildBus, Voices, ranged } = await import('/src/audio/voices.ts');
      const { GUN_CLASS } = await import('/src/fx/gunClass.ts');
      const { planSinking } = await import('/src/fx/sinkPlan.ts');
      const ctx = new OfflineAudioContext(2, Math.floor(rate * secs), rate);
      const bus = buildBus(ctx);
      const v = new Voices(ctx, bus.sfx, bus.reverb);
      new Function('v', 'ranged', 'GUN_CLASS', 'planSinking', play)(v, ranged, GUN_CLASS, planSinking);
      const buf = await ctx.startRendering();
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
    { rate: RATE, secs: scene.secs, play: scene.play },
  );
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
  const file = join(out, `${name}.wav`);
  await writeFile(file, Buffer.concat([header, pcm]));
  console.log('wrote', file, `${scene.secs}s`, 'peak', b64.peak.toFixed(2));
}
await browser.close();
