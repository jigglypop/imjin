// Contact sheet of one crew clip: figures standing in a row, each frozen at a different frame, for choosing cue frames.
//   node scripts/probe-clips.mjs --key=japan_ashigaru --clip=shoot --from=0 --to=59 --step=4 --weapon=3 --out=<png>
import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, '').split('=');
    return [k, v.join('=') || 'true'];
  }),
);
const out = args.out ?? '/Users/yeomdonghwan/Desktop/imjin/shots/progress/crew_clip.png';
await mkdir(dirname(out), { recursive: true });
const browser = await chromium.launch({
  channel: process.platform === 'win32' ? 'msedge' : 'chrome',
  headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', process.platform === 'win32' ? '--use-angle=d3d11' : '--use-angle=metal'],
});
const page = await browser.newPage({ viewport: { width: 1800, height: 700 } });
const logs = [];
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(`${args.url ?? 'http://127.0.0.1:5311/'}?scenario=hansan&hud=0&q=high`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 240000 });
await page.waitForTimeout(1500);
const res = await page.evaluate(
  async ({ key, clip, from, to, step, weapon, rows, rot, dist }) => {
    const m = await import('/src/fx/crewModels.ts');
    const e = window.__engine;
    e.crew.update = () => {};
    const asset = e.crew.assets.get(key);
    const c = asset.clips[clip];
    const cam = e.camera.position;
    const frames = [];
    for (let f = from; f <= to; f += step) frames.push(f);
    const perRow = Math.ceil(frames.length / rows);
    m.beginCrew(e.crew.assets);
    const base = e.battle.ships[0];
    const cx = base.x - 300;
    const cz = base.z - 300;
    e.rts.setPose({ tx: cx, tz: cz, yaw: 0, pitch: 0.12, distance: dist });
    const l = asset.lods[0];
    frames.forEach((f, i) => {
      const col = i % perRow;
      const row = Math.floor(i / perRow);
      // Face the camera: it looks along -x from +x with yaw 0.
      const x = cx - row * 2.2;
      const z = cz + (col - (perRow - 1) / 2) * 1.5;
      const yawF = rot;
      const q = Math.sin(yawF / 2);
      m.pushCrew(l, x, 0.6, z, 1, 0, q, 0, Math.cos(yawF / 2), { start: c.start, frames: c.frames, loop: false }, m.crewTime.value - (f + 0.5) / 15, 1, weapon, 0);
    });
    m.endCrew(e.crew.assets);
    return { frames, perRow, cam: [cam.x, cam.y, cam.z], clip: c };
  },
  { key: args.key ?? 'japan_ashigaru', clip: args.clip ?? 'shoot', from: Number(args.from ?? 0), to: Number(args.to ?? 59), step: Number(args.step ?? 4), weapon: Number(args.weapon ?? 0), rows: Number(args.rows ?? 1), rot: Number(args.rot ?? 0), dist: Number(args.dist ?? 9) },
);
console.log(JSON.stringify(res));
await page.waitForTimeout(1500);
await page.screenshot({ path: out });
if (logs.length) console.log(logs.join('\n'));
await browser.close();
