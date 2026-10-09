// Forces a boarding fight in a loaded battle and screenshots it: a Japanese ship alongside a Joseon one, grappled.
//   node scripts/probe-boarding.mjs --url=http://127.0.0.1:5311/ --shots=4 --step=2500 --prefix=<path/prefix>
//   --a=sekibune --d=panokseon   kinds of the grappling (Japanese) and the held ship
//   --dist=24 --pitch=0.5 --yaw=1.57 --ox=0 --oz=0   camera around the gap between the pair (yaw 1.57 looks across it)
//   --speed=1   battle speed during the fight
//   --cut=1     open the pair in cutaway (1 roofs off, 2 walls off)
//   --boost=3   multiply the grappling crew;  --dfrac=0.5 scale the held crew
//   --gap=0     skip the grapple and place the ships this many metres apart (volleys)
//   --repel=1   the held ship repels boarders, so the grapple breaks and they retreat
//   --focus=defender|boarder   follow one man of that kind
//   --swarm=1   a second Japanese ship boards the same Joseon ship from the other side
import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, '').split('=');
    return [k, v.join('=') || 'true'];
  }),
);
const url = args.url ?? 'http://127.0.0.1:5311/';
const prefix = args.prefix ?? '/Users/yeomdonghwan/Desktop/imjin/shots/progress/crew_probe';
const shots = Number(args.shots ?? 4);
const step = Number(args.step ?? 2500);
await mkdir(dirname(prefix), { recursive: true });

const browser = await chromium.launch({
  channel: process.platform === 'win32' ? 'msedge' : 'chrome',
  headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', process.platform === 'win32' ? '--use-angle=d3d11' : '--use-angle=metal'],
});
const page = await browser.newPage({ viewport: { width: Number(args.w ?? 1600), height: Number(args.h ?? 900) } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(`${url}?scenario=${args.scenario ?? 'hansan'}&hud=0&q=${args.q ?? 'high'}${args.webgl ? "&webgl=1" : ""}`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 240000 });

const opts = {
  kindA: args.a ?? 'sekibune',
  kindD: args.d ?? 'panokseon',
  dist: Number(args.dist ?? 24),
  pitch: Number(args.pitch ?? 0.5),
  yaw: Number(args.yaw ?? 1.57),
  speed: Number(args.speed ?? 1),
  boost: Number(args.boost ?? 1),
  cut: Number(args.cut ?? 0),
  ox: Number(args.ox ?? 0),
  oz: Number(args.oz ?? 0),
  dfrac: Number(args.dfrac ?? 1),
  gap: args.gap === undefined ? null : Number(args.gap),
  swarm: Number(args.swarm ?? 0),
  repel: args.repel === '1',
};
const info = await page.evaluate(({ kindA, kindD, dist, pitch, yaw, speed, boost, cut, ox, oz, dfrac, gap, swarm, repel }) => {
  const e = window.__engine;
  const b = e.battle;
  const pick = (kind, team) => b.ships.find((s) => s.alive && s.spec.kind === kind && s.team === team && !s.grappledWith);
  const a = pick(kindA, 'japan') ?? b.ships.find((s) => s.alive && s.team === 'japan');
  const d = pick(kindD, 'joseon') ?? b.ships.find((s) => s.alive && s.team === 'joseon');
  // Park the pair side by side where the Joseon ship was, hulls a few metres apart (or gap metres bow to bow).
  const cx = d.x;
  const cz = d.z;
  const az = gap === null ? cz + (a.spec.beam + d.spec.beam) / 2 + 3 : cz + gap;
  // A second Japanese ship on the other side of the held ship.
  const a2 = swarm ? b.ships.find((s) => s.alive && s.team === 'japan' && s !== a && !s.grappledWith && s.spec.kind === a.spec.kind) : null;
  const az2 = a2 ? cz - (a2.spec.beam + d.spec.beam) / 2 - 3 : 0;
  for (const s of a2 ? [a, a2, d] : [a, d]) {
    s.speed = 0;
    s.throttle = 0;
    s.speedCap = 0;
    s.order = { type: 'auto' };
    s.fireMode = 'hold';
    s.heading = 0;
  }
  a.stance = 'board';
  // The held ship's crew throws the boarders back: the sim breaks the grapple at random.
  d.repel = repel;
  if (boost > 1) {
    for (let i = 0; i < 4; i += 1) a.roles[i] *= boost;
    a.crew *= boost;
  }
  for (let i = 0; i < 4; i += 1) d.roles[i] = d.plan[i] * d.spec.crew * dfrac;
  d.crew = d.spec.crew * dfrac;
  e.rts.followId = 0;
  if (cut) {
    e.cutaway = cut;
    e.views.selected.add(a.id);
    e.views.selected.add(d.id);
  }
  e.speed = speed;
  e.fastForward = false;
  e.autoFast = false;
  window.__pair = { a: a.id, d: d.id };
  // Freeze the pair each frame so the AI cannot sail them apart, and keep fires off the decks.
  const hold = () => {
    for (const s of a2 ? [a, a2, d] : [a, d]) {
      s.speed = 0;
      s.throttle = 0;
      s.x = s === a2 ? cx + 4 : cx;
      s.z = s === a ? az : s === a2 ? az2 : cz;
      s.heading = 0;
      s.fire = 0;
      s.burn = 0;
    }
    a.stance = 'board';
    if (a2) a2.stance = 'board';
  };
  hold();
  window.__hold = setInterval(hold, 16);
  if (gap === null) {
    b.tryGrapple(a, d);
    if (a2) b.tryGrapple(a2, d);
  } else a.stance = 'standoff';
  e.rts.setPose({ tx: cx + ox, tz: (az + cz) / 2 + oz, yaw, pitch, distance: dist });
  return { a: a.name, ka: a.spec.kind, d: d.name, kd: d.spec.kind, grappled: a.grappledWith === d.id };
}, opts);
console.log('setup', JSON.stringify(info));
// --volley=gun|bow orders one volley from the Japanese (gun) or Joseon (bow) deck and follows a shooter.
const volley = args.volley;
const fireVolley = () =>
  page.evaluate(
    ({ volley, dist, pitch, yaw }) => {
      const e = window.__engine;
      const b = e.battle;
      const { a, d } = window.__pair;
      const ship = b.get(volley === 'gun' ? a : d);
      const foe = b.get(volley === 'gun' ? d : a);
      const dx = foe.x - ship.x;
      const dz = foe.z - ship.z;
      const len = Math.hypot(dx, dz);
      ship.targetId = foe.id;
      e.crew.handle([{ type: 'musket', ship: ship.id, x: ship.x, y: 2, z: ship.z, dx: dx / len, dz: dz / len, count: 4, arms: volley === 'gun' ? 'gun' : 'bow' }], b);
      const r = e.crew.rosters.get(ship.id);
      const mem = r.members[2].find((m) => m.fireAt >= 0);
      if (!mem) return 'no shooter';
      const st = r.stations[2][mem.station];
      const p = e.views.localToWorld(ship.id, st.x, r.main, st.z, new e.camera.position.constructor());
      e.rts.setPose({ tx: p.x, tz: p.z, yaw, pitch, distance: dist });
      return `${mem.fireAt - e.crew.time}`;
    },
    { volley, dist: opts.dist, pitch: opts.pitch, yaw: opts.yaw },
  );
let volleyAt = 0;
if (volley) await page.waitForTimeout(2000);
for (let i = 0; i < shots; i += 1) {
  if (volley && (i === 0 || i - volleyAt >= Number(args.every ?? 100))) {
    console.log('volley', await fireVolley());
    volleyAt = i;
  }
  await page.waitForTimeout(step);
  // --focus=defender|boarder centres the camera on one man of that kind (the first still standing).
  if (args.focus) {
    await page.evaluate(
      ({ focus, dist, pitch, yaw }) => {
        const e = window.__engine;
        const { a, d } = window.__pair;
        const bo = e.crew.boarding;
        let p = null;
        if (focus === 'boarder') {
          const f = bo.figs.find((x) => x.used && x.state !== 5 && x.wx);
          if (f) p = { x: f.wx, z: f.wz };
        } else {
          const rD = e.crew.rosters.get(d);
          const m = rD?.members[3].find((x) => x.dying < 0 && !x.gone && !x.away) ?? rD?.members[2].find((x) => x.dying < 0 && !x.gone);
          if (m) {
            const role = rD.members[3].includes(m) ? 3 : 2;
            const st = rD.stations[role][m.station];
            p = e.views.localToWorld(d, st.x, rD.main, st.z, new e.camera.position.constructor());
          }
        }
        if (p) e.rts.setPose({ tx: p.x, tz: p.z, yaw, pitch, distance: dist });
      },
      { focus: args.focus, dist: opts.dist, pitch: opts.pitch, yaw: opts.yaw },
    );
    await page.waitForTimeout(120);
  }
  const st = await page.evaluate(() => {
    const e = window.__engine;
    const b = e.battle;
    const { a, d } = window.__pair;
    const sa = b.get(a);
    const sd = b.get(d);
    const bo = e.crew.boarding;
    const states = [0, 0, 0, 0, 0, 0];
    for (const f of bo.figs) if (f.used) states[f.state] += 1;
    const rD = e.crew.rosters.get(d);
    const alive = rD ? rD.members.map((l) => l.filter((m) => m.dying < 0 && !m.gone).length) : null;
    const awayA = e.crew.rosters.get(a)?.members.map((l) => l.filter((m) => m.away).length);
    return { t: Math.round(b.time), grapple: sa.grappledWith, crewA: Math.round(sa.crew), crewD: Math.round(sd.crew), struckD: sd.struck, struckA: sa.struck, figs: states.join('/'), capture: [...bo.captures.values()].map((c) => `${c.id}:${c.win}`).join(','), aliveD: alive?.join(','), awayA: awayA?.join(','), fallen: bo.fallen.filter((f) => f.used).length, arrows: bo.arrows.filter((f) => f.used).length, props: bo.nProps, sprites: bo.sprites.filter((f) => f.used).length, drawn: [...e.crew.assets].map(([k, x]) => `${k}:${x.lods.map((l) => l.count).join('/')}`).join(' ') };
  });
  const out = `${prefix}_${String(i).padStart(2, '0')}.png`;
  await page.screenshot({ path: out });
  console.log(i, JSON.stringify(st), out);
}
const interesting = logs.filter((l) => !l.includes('[vite]') && !l.includes('DevTools') && !l.includes('normal" not found'));
if (interesting.length) console.log(interesting.slice(-30).join('\n'));
await browser.close();
