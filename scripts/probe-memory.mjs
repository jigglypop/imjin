import { webkit, devices } from 'playwright-core';
import { execSync } from 'node:child_process';
const url = process.argv[2] ?? 'http://127.0.0.1:5291/?scenario=hansan';
const before = new Set(execSync("ps -axo pid=").toString().trim().split(/\s+/));
const browser = await webkit.launch({ headless: true });
const ctx = await browser.newContext({ ...devices['iPhone 15 Pro'] });
const page = await ctx.newPage();
const t0 = Date.now();
await page.goto(url, { waitUntil: 'domcontentloaded' });
const sample = (label) => {
  const rows = execSync("ps -axo pid=,rss=,comm=").toString().trim().split('\n').map((l) => l.trim().split(/\s+/));
  const mine = rows.filter(([pid]) => !before.has(pid));
  const total = mine.reduce((s, r) => s + Number(r[1]), 0);
  const top = mine.sort((a, b) => Number(b[1]) - Number(a[1])).slice(0, 4).map((r) => `${r.slice(2).join(' ').split('/').pop()}:${Math.round(Number(r[1]) / 1024)}MB`);
  console.log(label, `t=${((Date.now() - t0) / 1000).toFixed(1)}s total=${Math.round(total / 1024)}MB`, top.join(' '));
};
let peak = 0;
for (let i = 0; i < 60; i++) {
  await page.waitForTimeout(1000);
  const ready = await page.evaluate(() => window.__ready === true).catch(() => false);
  if (i % 3 === 0 || ready) sample(ready ? 'READY' : 'load');
  if (ready) break;
}
await page.waitForTimeout(5000);
sample('after5s');
const info = await page.evaluate(() => { const r = window.__engine?.renderer; return r ? { mem: r.info.memory, render: { calls: r.info.render.calls, triangles: r.info.render.triangles } } : null; }).catch((e) => String(e));
console.log(JSON.stringify(info));
await browser.close();
