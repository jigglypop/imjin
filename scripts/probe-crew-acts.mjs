// Close-ups of the crews at work, one scene at a time, with the camera held on one man of the right kind:
//   node scripts/probe-crew-acts.mjs --url=http://127.0.0.1:5462/ --scene=gun --out=<prefix> [--shots=4] [--step=500]
// Scenes: gun (an arquebus volley from a Japanese ship), bow (an archer volley from a panokseon), cannon (a panokseon
// gun crew loading and firing), drum (the drummer of a panokseon closing to board), fire (men fighting a deck fire),
// board (a boarding: hooks, crossing and duels), swim (men thrown overboard).
//   --from=x,y,z  camera offset from the man in his ship's frame (x forward, y up, z outboard on his side)
//   --flip=1      the Japanese ship on the other side of the panokseon (the other side lit)
//   --kind=atakebune  the Japanese ship (sekibune by default)
//   --look=y      height above the man's feet the camera looks at;  --q=high|medium|low;  --w, --h viewport
import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, '').split('=');
    return [k, v.join('=') || 'true'];
  }),
);
const url = args.url ?? 'http://127.0.0.1:5291/';
const scene = args.scene ?? 'gun';
const prefix = args.out ?? `shots/crew_${scene}`;
await mkdir(dirname(prefix), { recursive: true });
const browser = await chromium.launch({
  channel: process.platform === 'win32' ? 'msedge' : 'chrome',
  headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', process.platform === 'win32' ? '--use-angle=d3d11' : '--use-angle=metal'],
});
const page = await browser.newPage({ viewport: { width: Number(args.w ?? 1600), height: Number(args.h ?? 900) } });
const logs = [];
page.on('pageerror', (e) => logs.push(e.message));
page.on('console', (m) => m.type() === 'error' && logs.push(m.text()));
await page.goto(`${url}?scenario=${args.scenario ?? 'hansan'}&hud=0&q=${args.q ?? 'high'}`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 240000 });
await page.waitForFunction(() => window.__engine?.crew?.assets, null, { timeout: 60000 });

// Roles in the crew's rosters: 0 oar, 1 gun, 2 shot, 3 melee, 4 officer, 5 drum.
const ROLE = { gun: 2, bow: 2, cannon: 1, drum: 5, fire: 1, board: 3, swim: 3 };
const defaults = {
  gun: { from: '2.5,1.6,5.5', look: 1.2 },
  bow: { from: '2.5,1.4,5', look: 1.3 },
  cannon: { from: '-2.2,1.7,-2.6', look: 0.9 },
  drum: { from: '3.2,1.2,-4.2', look: 1.1 },
  fire: { from: '-4,4,-5', look: 0.6 },
  board: { from: '0,6,-14', look: 1 },
  swim: { from: '0,4,10', look: -2.5 },
}[scene];
const from = (args.from ?? defaults.from).split(',').map(Number);
const look = Number(args.look ?? defaults.look);

const info = await page.evaluate(
  ({ scene, role, from, look, args }) => {
    const e = window.__engine;
    const b = e.battle;
    const japanShooter = scene === 'gun' || scene === 'board' || scene === 'swim';
    const pick = (kind, team) => b.ships.find((s) => s.alive && s.spec.kind === kind && s.team === team && !s.grappledWith);
    const a = pick(args.kind ?? 'sekibune', 'japan') ?? pick('sekibune', 'japan') ?? b.ships.find((s) => s.alive && s.team === 'japan');
    const d = pick('panokseon', 'joseon') ?? b.ships.find((s) => s.alive && s.team === 'joseon');
    const cx = d.x;
    const cz = d.z;
    const touching = scene === 'board' || scene === 'swim';
    const gap = touching ? (a.spec.beam + d.spec.beam) / 2 + 3 : scene === 'cannon' ? 120 : 45;
    // --flip puts the Japanese ship on the other side, to light the scene from the other quarter.
    const az = cz + (args.flip ? -gap : gap);
    for (const s of [a, d]) {
      s.speed = 0;
      s.throttle = 0;
      s.speedCap = 0;
      s.order = { type: 'auto' };
      s.heading = 0;
      s.fireMode = scene === 'cannon' ? 'free' : 'hold';
    }
    if (touching) {
      for (let i = 0; i < 4; i += 1) a.roles[i] *= 4;
      a.crew *= 4;
      a.stance = 'board';
    }
    if (scene === 'drum') d.stance = 'board';
    a.targetId = d.id;
    d.targetId = a.id;
    const hold = () => {
      for (const s of [a, d]) {
        // The drummer's ship makes way toward the enemy while it is held in place.
        s.speed = scene === 'drum' && s === d ? s.spec.maxSpeed * 0.7 : 0;
        s.throttle = 0;
        s.x = cx;
        s.z = s === a ? az : cz;
        s.heading = 0;
        if (scene !== 'fire') s.fire = 0;
        // Neither crew loses heart and breaks off while the scene runs.
        s.morale = 1;
        s.moraleState = 'steady';
        s.burn = 0;
      }
      if (scene === 'fire') d.fire = 0.45;
      if (touching) {
        a.stance = 'board';
        // The defenders stand and fight rather than throwing the grapples off.
        d.repel = false;
        // A grapple the defenders throw off is made again, so the fight lasts the length of the scene.
        if (!a.grappledWith && !a.struck && !d.struck) {
          b.grappleLock.clear();
          b.tryGrapple(a, d);
        }
      }
    };
    hold();
    window.__hold = setInterval(hold, 16);
    // The battle depth rules would let a crew break and cut the grapples: off for the scene.
    if (touching) {
      b.morale = null;
      b.tryGrapple(a, d);
    }
    e.speed = 1;
    e.fastForward = false;
    e.autoFast = false;
    const shooterShip = scene === 'gun' ? a : d;
    const subject = scene === 'board' || scene === 'swim' ? d : shooterShip;
    const foe = subject === a ? d : a;
    // A musket volley is ordered every few seconds while the scene runs.
    if (scene === 'gun' || scene === 'bow') {
      const fire = () => {
        const dx = foe.x - shooterShip.x;
        const dz = foe.z - shooterShip.z;
        const len = Math.hypot(dx, dz);
        e.crew.handle([{ type: 'musket', ship: shooterShip.id, x: shooterShip.x, y: 2, z: shooterShip.z, dx: dx / len, dz: dz / len, count: 6, arms: scene === 'gun' ? 'gun' : 'bow' }], b);
      };
      window.__fire = fire;
      setTimeout(fire, 1500);
      window.__volleys = setInterval(fire, scene === 'gun' ? 2600 : 3200);
    }
    // The camera stays on one man: the first of his kind on the side facing the enemy (or nearest the bow).
    const crew = e.crew;
    const V = e.camera.position.constructor;
    const want = (r) => {
      const list = r.members[role] ?? [];
      const side = Math.sign(foe.z - subject.z) || 1;
      let best = null;
      let bs = -1e9;
      for (const m of list) {
        if (m.dying >= 0 || m.gone || m.away) continue;
        const st = r.stations[role][m.station];
        const s = (role === 5 || role === 4 ? 0 : Math.sign(st.z) === side ? 10 : 0) - Math.abs(st.x) * 0.3;
        if (s > bs) {
          bs = s;
          best = m;
        }
      }
      return best;
    };
    // The battle camera keeps the ship in the crew's range; the view itself is set after the crew is drawn.
    e.rts.followId = 0;
    e.rts.setPose({ tx: subject.x, tz: subject.z, yaw: 1, pitch: 0.5, distance: 30 });
    let held = null;
    const original = crew.update.bind(crew);
    crew.update = (battle, dt, camera, view) => {
      original(battle, dt, camera, view);
      const r = crew.rosters.get(subject.id);
      if (!r || r.live !== crew.frame) {
        // Out of the crew's range: come in over the ship first.
        e.camera.position.set(subject.x + 20, 25, subject.z - 20);
        e.camera.lookAt(subject.x, 3, subject.z);
        return;
      }
      if (!held || held.dying >= 0 || held.gone || !r.members[role].includes(held)) held = want(r);
      if (!held) return;
      const st = r.stations[role][held.station];
      const pl = { x: 0, z: 0, yaw: 0 };
      pl.x = st.x;
      pl.z = st.z;
      const side = Math.sign(st.z) || 1;
      const deck = st.deck === 2 ? r.main + (r.layout.command?.up ?? 0) : st.deck === 0 ? r.main - r.layout.oarDrop : r.main;
      const target = e.views.localToWorld(subject.id, pl.x, deck + look, pl.z, new V());
      const cam = e.views.localToWorld(subject.id, pl.x + from[0], deck + from[1], pl.z + side * from[2], new V());
      e.camera.position.copy(cam);
      e.camera.lookAt(target);
    };
    return { a: a.spec.kind, d: d.spec.kind, subject: subject.spec.kind, grappled: a.grappledWith === d.id };
  },
  { scene, role: ROLE[scene], from, look, args },
);
console.log('setup', JSON.stringify(info));
await page.waitForTimeout(Number(args.pre ?? 2500));
const shots = Number(args.shots ?? 4);
for (let i = 0; i < shots; i += 1) {
  const out = `${prefix}_${String(i).padStart(2, '0')}.png`;
  // The battle (and with it every crew clip, puff and arrow) holds still for the picture.
  await page.evaluate(() => {
    window.__engine.speed = 0;
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: out });
  await page.evaluate(() => {
    window.__engine.speed = 1;
  });
  const st = await page.evaluate(() => {
    const c = window.__engine.crew;
    const bo = c.boarding;
    const states = [0, 0, 0, 0, 0, 0];
    for (const f of bo.figs) if (f.used) states[f.state] += 1;
    let bodies = 0;
    for (const r of c.rosters.values()) bodies += r.corpses.length;
    return { us: bo.figs.filter((f) => f.used).slice(0, 4).map((f) => [f.u.toFixed(1), (f.d1 + f.d2 + f.d3).toFixed(1), f.style, f.dir].join(':')).join(' '), fights: bo.fights.filter((f) => f.used).map((f) => `${f.mode}:${f.dormant ? 'z' : ''}${Math.round(c.time - f.t0)}:${f.acc.toFixed(1)}`).join(','), grapple: [...c.rosters.keys()].map((id) => window.__engine.battle.get(id)).filter((s) => s && s.grappledWith).length, figs: states.join('/'), fallen: bo.fallen.filter((f) => f.used).length, swimming: bo.fallen.filter((f) => f.used && f.swim).length, bodies, arrows: bo.arrows.flying, puffs: bo.puffs.pool.filter((p) => p.used).length, drawn: [...c.assets].map(([k, x]) => `${k}:${x.lods.map((l) => l.count).join('/')}`).join(' ') };
  });
  console.log(i, JSON.stringify(st), out);
  await page.waitForTimeout(Number(args.step ?? 500));
}
if (logs.length) console.log(logs.slice(-10).join('\n'));
await browser.close();
