// A contact sheet of a crew model's clips: one row per clip, frames sampled across it left to right, drawn in a paused
// battle above the sea so each pose can be checked by eye after a bake.
//   node scripts/probe-crew-clips.mjs --url=http://127.0.0.1:5462/ --key=joseon_marine [--clips=melee,parry] [--cols=6] [--weapon=4] --out=<png>
//   --side=1 looks from the figure's left instead of three-quarters front;  --live=1 plays the clips instead of freezing frames
import { chromium } from 'playwright-core';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, '').split('=');
    return [k, v.join('=') || 'true'];
  }),
);
const url = args.url ?? 'http://127.0.0.1:5291/';
const browser = await chromium.launch({
  channel: process.platform === 'win32' ? 'msedge' : 'chrome',
  headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', process.platform === 'win32' ? '--use-angle=d3d11' : '--use-angle=metal'],
});
const page = await browser.newPage({ viewport: { width: Number(args.w ?? 1600), height: Number(args.h ?? 1000) } });
const logs = [];
page.on('console', (m) => m.type() === 'error' && logs.push(m.text()));
page.on('pageerror', (e) => logs.push(e.message));
await page.goto(`${url}?scenario=${args.scenario ?? 'hansan'}&hud=0&q=high`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 240000 });
await page.waitForFunction(() => window.__engine?.crew?.assets, null, { timeout: 60000 });
const info = await page.evaluate(
  ({ key, clips, cols, weapon, side, live }) => {
    const e = window.__engine;
    const crew = e.crew;
    const asset = crew.assets.get(key);
    if (!asset) return { error: `no ${key}`, keys: [...crew.assets.keys()] };
    const names = clips ? clips.split(',') : Object.keys(asset.clips);
    const rows = names.filter((n) => asset.clips[n]);
    // A clear patch of sea in front of the camera.
    const cx = e.camera.position.x;
    const cz = e.camera.position.z;
    const gap = 1.6;
    const rowGap = 2.3;
    const y0 = 40;
    const original = crew.update.bind(crew);
    crew.update = (battle, dt, camera, view) => {
      original(battle, dt, camera, view);
      for (const a of crew.assets.values()) for (const l of a.lods) l.mesh.geometry.instanceCount = 0;
      const l = asset.lods[0];
      const arr = l.buffer.array;
      let n = 0;
      rows.forEach((name, r) => {
        const c = asset.clips[name];
        for (let k = 0; k < cols && n < l.capacity; k += 1) {
          const o = n * 16;
          n += 1;
          arr[o] = cx;
          arr[o + 1] = y0 + (rows.length - 1 - r) * rowGap;
          arr[o + 2] = cz - (k - (cols - 1) / 2) * gap;
          arr[o + 3] = 1;
          // The camera looks down -x: a three-quarters view of a man facing it, or his left side.
          const yaw = side ? Math.PI : Math.PI / 2 - 0.5;
          arr[o + 4] = 0;
          arr[o + 5] = Math.sin(yaw / 2);
          arr[o + 6] = 0;
          arr[o + 7] = Math.cos(yaw / 2);
          const f = Math.min(c.frames - 1, Math.round((k / Math.max(1, cols - 1)) * (c.frames - 1)));
          arr[o + 8] = live ? c.start : c.start + f;
          arr[o + 9] = live ? c.frames : 1;
          arr[o + 10] = live ? -k * 0.3 : 0;
          arr[o + 11] = 1;
          arr[o + 12] = weapon;
          arr[o + 13] = 0;
          arr[o + 14] = 0;
          arr[o + 15] = 0;
        }
      });
      l.mesh.geometry.instanceCount = n;
      l.buffer.clearUpdateRanges();
      l.buffer.addUpdateRange(0, n * 16);
      l.buffer.needsUpdate = true;
      // The battle camera orbits a point on the sea; this one is set by hand, level with the middle of the sheet.
      const h = rows.length * rowGap;
      const distance = Math.max(cols * gap * 0.62, h) * 1.15 + 2;
      e.camera.position.set(cx + distance, y0 + h / 2 - 0.6, cz);
      e.camera.lookAt(cx, y0 + h / 2 - 0.6, cz);
    };
    return { rows, clips: rows.map((n) => `${n}:${asset.clips[n].frames}`) };
  },
  { key: args.key ?? 'joseon_marine', clips: args.clips ?? '', cols: Number(args.cols ?? 6), weapon: Number(args.weapon ?? 0), side: args.side === '1', live: args.live === '1' },
);
console.log(JSON.stringify(info));
await page.waitForTimeout(Number(args.wait ?? 1500));
await page.screenshot({ path: args.out ?? 'shots/crew_clips.png' });
console.log('saved', args.out);
if (logs.length) console.log(logs.slice(-10).join('\n'));
await browser.close();
