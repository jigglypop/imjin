// What a battle sends to the GPU each frame on desktop WebGPU: every GPUQueue.writeBuffer, grouped by the buffer's label
// and the game code that caused it (one call in 64 is traced back to its first src/ frames), as KB and ms per frame.
//   node scripts/probe-uploads.mjs --url=http://127.0.0.1:5291/?scenario=myeongnyang [--seconds=8] [--top=25]
import { chromium } from 'playwright-core';
import { waitForContact } from './perf-camera.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '')).map((a) => [a.split('=')[0], a.includes('=') ? a.slice(a.indexOf('=') + 1) : 'true']));
const url = args.url ?? 'http://127.0.0.1:5291/?scenario=myeongnyang';
const seconds = Number(args.seconds ?? 8);
const top = Number(args.top ?? 25);

const browser = await chromium.launch({
  channel: process.platform === 'win32' ? 'msedge' : 'chrome',
  headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', process.platform === 'win32' ? '--use-angle=d3d11' : '--use-angle=metal', '--disable-gpu-vsync', '--disable-frame-rate-limit'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.addInitScript(() => {
  const stats = (window.__uploads = { on: false, frames: 0, rows: {} });
  const where = () => {
    const lines = (new Error().stack ?? '').split('\n').filter((l) => /\/src\//.test(l)).slice(0, 2);
    return lines.map((l) => (l.match(/at (\S+).*\/src\/([^?:]+)[^:]*:(\d+)/) ?? []).slice(1).join(' ')).join(' < ');
  };
  const sites = new Map();
  let n = 0;
  const patch = () => {
    const Q = window.GPUQueue?.prototype;
    if (!Q || Q.__w) return;
    Q.__w = true;
    const write = Q.writeBuffer;
    Q.writeBuffer = function (buffer, offset, data, dataOffset, size) {
      if (!stats.on) return write.apply(this, arguments);
      const bytes = size !== undefined ? size * (data.BYTES_PER_ELEMENT ?? 1) : data.byteLength - (dataOffset ?? 0) * (data.BYTES_PER_ELEMENT ?? 1);
      const s = performance.now();
      write.apply(this, arguments);
      const ms = performance.now() - s;
      let site = sites.get(buffer);
      if (site === undefined || (n++ & 63) === 0) {
        site = where() || '(three internal)';
        sites.set(buffer, site);
      }
      const key = `${buffer.label || '(no label)'} [${buffer.size}] ${site}`;
      const r = (stats.rows[key] ??= [0, 0, 0]);
      r[0] += bytes;
      r[1] += ms;
      r[2] += 1;
    };
  };
  patch();
  const tick = () => {
    if (stats.on) stats.frames++;
    patch();
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
page.on('console', (m) => m.type() === 'error' && console.error('console', m.text().slice(0, 300)));
page.on('pageerror', (e) => console.error('pageerror', String(e).slice(0, 200)));
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 90000 });
await waitForContact(page, 120);
await page.evaluate(() => (window.__engine.speed = 1));
await page.evaluate(() => (window.__uploads.on = true));
await page.waitForTimeout(seconds * 1000);
const out = await page.evaluate(() => {
  const s = window.__uploads;
  s.on = false;
  return { frames: s.frames, rows: Object.entries(s.rows) };
});
const f = Math.max(1, out.frames);
let kb = 0, ms = 0, calls = 0;
for (const [, r] of out.rows) { kb += r[0] / 1024; ms += r[1]; calls += r[2]; }
console.log(`${out.frames} frames: ${(kb / f).toFixed(0)} KB, ${(ms / f).toFixed(2)} ms, ${(calls / f).toFixed(0)} writeBuffer calls per frame`);
console.log('  KB/frame   ms/frame  calls/frame  buffer [size] site');
for (const [key, r] of out.rows.sort((a, b) => b[1][1] - a[1][1]).slice(0, top)) {
  console.log(`${(r[0] / 1024 / f).toFixed(1).padStart(10)} ${(r[1] / f).toFixed(3).padStart(10)} ${(r[2] / f).toFixed(1).padStart(12)}  ${key}`);
}
await browser.close();
