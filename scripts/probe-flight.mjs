// Photographs one shell in flight up close and from the RTS camera, so two builds can be compared at the same moment of
// a flight. A duel is staged as in probe-projectiles.mjs; the first shell of the wanted kind is frozen `age` seconds after
// it left the muzzle and the camera is set round its drawn position at each distance in turn.
//   node scripts/probe-flight.mjs --url=http://127.0.0.1:5640/ --out=<dir> --tag=new --want=ball|arrow|grape|rocket|hiya
//     [--sky=day|night] [--age=0.7] [--dists=6,18,60,420] [--yaw=0.7] [--pitch=0.05] [--gun=cheonja]
import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, '').split('=');
    return [k, v.join('=') || 'true'];
  }),
);
const url = args.url ?? 'http://127.0.0.1:5640/';
const out = args.out ?? '.';
const tag = args.tag ?? 'flight';
const want = args.want ?? 'ball';
const sky = args.sky ?? 'day';
const dists = (args.dists ?? '6,18,60,420').split(',').map(Number);
await mkdir(out, { recursive: true });

const browser = await chromium.launch({
  channel: process.platform === 'win32' ? 'msedge' : 'chrome',
  headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', process.platform === 'win32' ? '--use-angle=d3d11' : '--use-angle=metal'],
});
const page = await browser.newPage({ viewport: { width: Number(args.w ?? 1280), height: Number(args.h ?? 720) } });
const logs = [];
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(`${url}?scenario=${args.scenario ?? 'hansan'}&hud=0&q=${args.q ?? 'high'}&sky=${sky}&sea=calm${args.webgl ? '&webgl=1' : ''}`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 240000 });

const staged = await page.evaluate(({ want, dist, age, gun }) => {
  const e = window.__engine;
  const b = e.battle;
  const japan = want === 'hiya';
  const team = japan ? 'japan' : 'joseon';
  const a = b.ships.find((s) => s.alive && s.spec.kind === (japan ? 'atakebune' : 'panokseon') && s.team === team) ?? b.ships.find((s) => s.alive && s.team === team);
  const d = b.ships.find((s) => s.alive && s.team !== team && s.spec.kind === (japan ? 'panokseon' : 'atakebune')) ?? b.ships.find((s) => s.alive && s.team !== team);
  for (const s of b.ships) {
    if (s === a || s === d) continue;
    s.x += 6000;
    s.speed = 0;
    s.fireMode = 'hold';
  }
  const cx = a.x;
  const cz = a.z;
  e.rts.followId = 0;
  e.speed = 1;
  e.fastForward = false;
  e.autoFast = false;
  a.ammo = want === 'grape' ? 'crew' : want === 'rocket' || want === 'hiya' ? 'fire' : want === 'ball' ? 'hull' : 'auto';
  let nextVolley = 0;
  const hold = () => {
    for (const [s, x, z, fire] of [[a, cx, cz, 'free'], [d, cx + 10, cz + dist, 'hold']]) {
      s.x = x;
      s.z = z;
      s.speed = 0;
      s.throttle = 0;
      s.heading = 0;
      s.fireMode = fire;
      s.fire = 0;
      s.hull = s.spec.hull;
      s.crew = s.spec.crew;
    }
    a.order = { type: 'auto' };
    a.targetId = d.id;
    if (performance.now() > nextVolley && e.speed > 0) {
      nextVolley = performance.now() + 3000;
      for (const g of a.guns) {
        g.ammo = 99;
        if (g.stage < 4) g.stage = 4;
      }
    }
  };
  hold();
  window.__hold = setInterval(hold, 16);
  const ammo = want === 'rocket' || want === 'hiya' ? 'fire' : want;
  window.__catcher = setInterval(() => {
    if (window.__frozen) return;
    const p = b.projectiles.find((q) => q.ammo === ammo && q.age >= age && (!gun || q.gun === gun));
    if (!p) return;
    e.speed = 0;
    window.__frozen = p;
  }, 2);
  e.rts.setPose({ tx: cx + 5, tz: cz + dist * 0.45, yaw: 0, pitch: 0.2, distance: dist * 0.9 }, true);
  return { a: a.spec.kind, d: d.spec.kind };
}, { want, dist: Number(args.dist ?? 240), age: Number(args.age ?? 0.7), gun: args.gun ?? '' });

const ok = await page.waitForFunction(() => !!window.__frozen, null, { timeout: 90000, polling: 50 }).then(() => true, () => false);
if (!ok) {
  console.log('no', want, 'shell came', JSON.stringify(staged));
  await browser.close();
  process.exit(1);
}
const shell = await page.evaluate(() => ({ gun: window.__frozen.gun, ammo: window.__frozen.ammo, age: window.__frozen.age }));
for (const dist of dists) {
  await page.evaluate(({ dist, yaw, pitch }) => {
    const e = window.__engine;
    const p = window.__frozen;
    const rts = dist >= 200;
    e.rts.setPose({ tx: p.x, tz: p.z, yaw, pitch: rts ? 0.65 : pitch, distance: dist }, true);
    const lift = p.y + e.fx.liftOf(p);
    clearInterval(window.__lift);
    window.__lift = setInterval(() => {
      e.rts.lookLift = lift;
    }, 8);
  }, { dist, yaw: Number(args.yaw ?? 0.7), pitch: Number(args.pitch ?? 0.05) });
  await page.waitForTimeout(900);
  const file = `${out}/${tag}_${want}_${sky}_${dist}m.png`;
  await page.screenshot({ path: file });
  console.log('saved', file, JSON.stringify(shell));
}
if (logs.length) console.log(logs.slice(-20).join('\n'));
await browser.close();
