// Memory of a battle load on the WebKit iPhone path (iOS Safari engine, WebGL2): process RSS while loading, GPU memory
// from renderer.info.memory once ready, and the same again after each further battle started in the same page (a second
// battle must not grow memory). Prints PASS/FAIL for the phone budget and exits 1 when one fails.
//   node scripts/probe-memory.mjs [url] [--then=myeongnyang,hansan] [--budget=false]
import { webkit, devices } from 'playwright-core';
import { execSync } from 'node:child_process';
const positional = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const flags = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.join('=') || 'true']; }));
const url = positional[0] ?? 'http://127.0.0.1:5291/?scenario=hansan';
const then = flags.then ? flags.then.split(',') : [];
const before = new Set(execSync("ps -axo pid=").toString().trim().split(/\s+/));
const browser = await webkit.launch({ headless: true });
const ctx = await browser.newContext({ ...devices['iPhone 15 Pro'] });
const page = await ctx.newPage();
const t0 = Date.now();
await page.goto(url, { waitUntil: 'domcontentloaded' });
const sample = (label) => {
  const rows = execSync("ps -axo pid=,rss=,comm=").toString().trim().split('\n').map((l) => l.trim().split(/\s+/));
  const mine = rows.filter(([pid, , comm]) => !before.has(pid) && /WebKit/.test(comm ?? ''));
  const total = mine.reduce((s, r) => s + Number(r[1]), 0);
  const top = mine.sort((a, b) => Number(b[1]) - Number(a[1])).slice(0, 3).map((r) => `${r.slice(2).join(' ').split('/').pop().replace('com.apple.WebKit.', '').replace('.Development', '')}:${Math.round(Number(r[1]) / 1024)}MB`);
  console.log(label, `t=${((Date.now() - t0) / 1000).toFixed(1)}s webkit=${Math.round(total / 1024)}MB`, top.join(' '));
  return Math.round(total / 1024);
};
const gpuStats = () => page.evaluate(() => {
  const e = window.__engine;
  const r = e?.renderer;
  if (!r) return null;
  const m = r.info.memory;
  return { textureMB: Math.round(m.texturesSize / 1e6), geometries: m.geometries, textures: m.textures, programs: m.programs, renderTargets: m.renderTargets, attributesMB: Math.round((m.attributesSize + m.indexAttributesSize) / 1e6), totalMB: Math.round(m.total / 1e6), level: e.level, scenario: e.scenarioId };
}).catch((e) => String(e));
let ready = false;
let readyMs = 0;
for (let i = 0; i < 90; i++) {
  await page.waitForTimeout(1000);
  ready = await page.evaluate(() => window.__ready === true).catch(() => false);
  if (i % 3 === 0 || ready) sample(ready ? 'READY' : 'load');
  if (ready) {
    readyMs = Date.now() - t0;
    break;
  }
}
await page.waitForTimeout(4000);
const rss = sample('after4s');
const first = await gpuStats();
console.log('battle 1', JSON.stringify(first));
const later = [];
for (const id of then) {
  const t1 = Date.now();
  await page.evaluate((scenario) => { void window.__engine.setScenario(scenario); }, id);
  await page.waitForFunction(() => window.__engine.ready === true, null, { timeout: 90000 });
  await page.waitForTimeout(3000);
  const stats = await gpuStats();
  later.push(stats);
  console.log(`battle ${later.length + 1} (${id}, ${((Date.now() - t1) / 1000).toFixed(1)}s)`, JSON.stringify(stats));
  sample(`after ${id}`);
}
const failures = [];
if (flags.budget !== 'false' && first && typeof first === 'object') {
  const check = (name, ok, value) => {
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${value}`);
    if (!ok) failures.push(name);
  };
  check('textures < 300 MB', first.textureMB < 300, `${first.textureMB} MB`);
  check('gpu memory < 400 MB', first.totalMB < 400, `${first.totalMB} MB`);
  check('ready < 10 s', ready && readyMs < 10000, `${(readyMs / 1000).toFixed(1)} s`);
  check('programs < 130', first.programs < 130, `${first.programs}`);
  for (const [i, s] of later.entries()) if (typeof s === 'object' && s) check(`battle ${i + 2} textures within 20% of battle 1 + 60 MB`, s.textureMB < first.textureMB * 1.2 + 60, `${s.textureMB} MB`);
}
void rss;
await browser.close();
if (failures.length) process.exitCode = 1;
