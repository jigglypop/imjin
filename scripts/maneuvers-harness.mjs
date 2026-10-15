// Shared plumbing for the tactical maneuver tests (scripts/test-maneuvers.mjs) and for measuring a battle from the
// command line: builds a historical battle headless as scripts/check-stalemate.mjs does, and measures its gun-line
// geometry (crossfire share, shots through friendly hulls, friendly fouling).
//   node scripts/maneuvers-harness.mjs hansan [--seeds=3] [--mode=auto|passive] [--minutes=25] [--rules=latest|v1|classic]
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'vite';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export async function openSim() {
  const server = await createServer({
    root,
    configFile: false,
    logLevel: 'error',
    appType: 'custom',
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  const load = (p) => server.ssrLoadModule(p);
  const mods = {
    server,
    load,
    scen: await load('/src/sim/scenarios.ts'),
    battle: await load('/src/sim/battle.ts'),
    bal: await load('/src/sim/balance.ts'),
    cmd: await load('/src/sim/commands.ts'),
    gen: await load('/src/terrain/generate.ts'),
    cur: await load('/src/sim/current.ts'),
    depth: await load('/src/sim/depth.ts'),
  };
  return mods;
}

const cacheDir = join(root, 'node_modules', '.cache', 'balance');
const terrains = new Map();
export function landOf(spec, generateHeightmap) {
  const key = createHash('sha1').update(JSON.stringify(spec)).digest('hex').slice(0, 12);
  let h = terrains.get(key);
  if (!h) {
    const file = join(cacheDir, `terrain-${key}.f32`);
    if (existsSync(file)) {
      const buf = readFileSync(file);
      h = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    } else {
      h = generateHeightmap(spec);
      mkdirSync(cacheDir, { recursive: true });
      writeFileSync(file, Buffer.from(h.buffer));
    }
    terrains.set(key, h);
  }
  const { size, res } = spec;
  return (sx, sz) => {
    const fx = ((sx + size / 2) / size) * res - 0.5;
    const fz = ((sz + size / 2) / size) * res - 0.5;
    const x0 = Math.max(0, Math.min(res - 2, Math.floor(fx)));
    const z0 = Math.max(0, Math.min(res - 2, Math.floor(fz)));
    const tx = Math.max(0, Math.min(1, fx - x0));
    const tz = Math.max(0, Math.min(1, fz - z0));
    const a = h[z0 * res + x0];
    const b = h[z0 * res + x0 + 1];
    const c = h[(z0 + 1) * res + x0];
    const d = h[(z0 + 1) * res + x0 + 1];
    return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
  };
}

/** A historical battle as the game builds it on axis 0 (scenario coordinates are world coordinates). */
export function scenario(mods, id, faction, seed) {
  const info = mods.scen.SCENARIOS[id];
  const land = landOf(info.terrain, mods.gen.generateHeightmap);
  const b = mods.scen.buildScenario(id, 0, seed, land);
  b.land = land;
  b.flow = info.current ? new mods.cur.CurrentField(info.current, land, 0) : null;
  b.center = { x: info.view.tx, z: info.view.tz };
  b.arenaRadius = 5200;
  mods.bal.applyBalance(b, id, faction);
  return b;
}

/** Smallest gap between two hulls, each outlined by three circles along its keel as the battle does. */
function hullGap(a, b) {
  const circles = (s) => {
    const r = s.spec.beam * 0.5;
    const half = s.spec.length * 0.5 - r;
    const c = Math.cos(s.heading);
    const n = Math.sin(s.heading);
    return [-1, 0, 1].map((i) => [s.x + c * half * i, s.z + n * half * i, r]);
  };
  let gap = Infinity;
  for (const p of circles(a)) for (const q of circles(b)) gap = Math.min(gap, Math.hypot(p[0] - q[0], p[1] - q[1]) - p[2] - q[2]);
  return gap;
}

const wrap = (a) => {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
};

/**
 * Watches a battle step by step for one side: each of its hits is a crossfire hit when another ship of that side hit
 * the same target from a bearing more than 90 degrees away in the 10 seconds before; shots whose straight line passes
 * through a friendly hull; friendly hulls overlapping.
 */
export { hullGap };

export function watch(b, team) {
  const shooterOf = new Map();
  const hitsOn = new Map();
  const m = { hits: 0, cross: 0, shots: 0, masked: 0, overlaps: 0, samples: 0, bonus: { rake: 0, cross: 0 } };
  const blocked = (s, t) => {
    for (const o of b.activeOf(s.team)) {
      if (o === s) continue;
      const ax = s.x - o.x, az = s.z - o.z, bx = t.x - o.x, bz = t.z - o.z;
      const r = o.spec.length * 0.5;
      if (Math.max(ax, bx) < -r || Math.min(ax, bx) > r || Math.max(az, bz) < -r || Math.min(az, bz) > r) continue;
      const c = Math.cos(o.heading), n = Math.sin(o.heading);
      const la0 = ax * c + az * n, la1 = -ax * n + az * c;
      const lb0 = bx * c + bz * n, lb1 = -bx * n + bz * c;
      const hl = o.spec.length * 0.5, hb = o.spec.beam * 0.5;
      let t0 = 0, t1 = 1, ok = true;
      const dx = lb0 - la0, dz = lb1 - la1;
      for (const [p, q] of [[-dx, la0 + hl], [dx, hl - la0], [-dz, la1 + hb], [dz, hb - la1]]) {
        if (Math.abs(p) < 1e-9) { if (q < 0) { ok = false; break; } continue; }
        const k = q / p;
        if (p < 0) { if (k > t1) { ok = false; break; } if (k > t0) t0 = k; } else { if (k < t0) { ok = false; break; } if (k < t1) t1 = k; }
      }
      if (ok && t0 <= t1) return true;
    }
    return false;
  };
  let lastSample = 0;
  return {
    m,
    /** Call after each step, before the events are cleared. */
    after() {
      let gunShip = 0;
      for (const e of b.events) {
        if (e.type === 'gun') {
          gunShip = e.ship;
          const s = b.get(e.ship);
          if (s?.team === team) {
            const target = b.get(s.targetId);
            m.shots += 1;
            if (target && b.isActive(target) && blocked(s, target)) m.masked += 1;
          }
        } else if (e.type === 'shot') {
          if (gunShip) shooterOf.set(e.id, gunShip);
          gunShip = 0;
        } else if (e.type === 'hit') {
          if (e.bonus) m.bonus[e.bonus] += 1;
          const tg = b.get(e.ship);
          if (!tg || tg.team === team) continue;
          const sh = b.get(shooterOf.get(e.proj) ?? 0);
          shooterOf.delete(e.proj);
          if (!sh || sh.team !== team) continue;
          m.hits += 1;
          const brg = Math.atan2(sh.z - tg.z, sh.x - tg.x);
          const list = hitsOn.get(tg.id) ?? [];
          hitsOn.set(tg.id, list);
          let cross = false;
          for (const h of list) if (h.s !== sh.id && b.time - h.t <= 10 && Math.abs(wrap(h.b - brg)) > Math.PI / 2) cross = true;
          if (cross) m.cross += 1;
          list.push({ t: b.time, b: brg, s: sh.id });
          while (list.length && b.time - list[0].t > 10) list.shift();
        }
      }
      if (b.time - lastSample >= 1) {
        lastSample = b.time;
        m.samples += 1;
        for (const s of b.activeOf(team)) {
          b.near(s.x, s.z, 60, (o) => {
            if (o.id <= s.id || o.team !== team || !b.isActive(o)) return;
            if (hullGap(s, o) < 0.5) m.overlaps += 1;
          });
        }
      }
    },
    summary() {
      return {
        hits: m.hits,
        crossShare: m.hits ? +(100 * m.cross / m.hits).toFixed(1) : 0,
        maskedShare: m.shots ? +(100 * m.masked / m.shots).toFixed(1) : 0,
        foulingPerSecond: +(m.overlaps / Math.max(1, m.samples)).toFixed(2),
        bonus: m.bonus,
      };
    },
  };
}

/** Runs a battle to its end or the limit, calling `each` before every step. */
export function run(mods, b, { minutes = 30, team = 'joseon', each } = {}) {
  const w = watch(b, team);
  const dt = mods.battle.SIM_DT;
  while (!b.ended && b.time < minutes * 60) {
    each?.(b);
    b.step(dt);
    w.after();
    b.events.length = 0;
  }
  const lost = (t) => b.ships.filter((s) => s.team === t && !b.isActive(s) && !s.fled).length;
  return { winner: b.winner, draw: b.draw, minutes: +(b.time / 60).toFixed(1), lost: { joseon: lost('joseon'), japan: lost('japan') }, fled: { ...b.escaped }, left: { joseon: b.activeOf('joseon').length, japan: b.activeOf('japan').length }, ...w.summary() };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const flag = (k, d) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
  const id = args.find((a) => !a.startsWith('--')) ?? 'hansan';
  const seeds = Number(flag('seeds', 3));
  const mode = flag('mode', 'auto');
  const minutes = Number(flag('minutes', 25));
  const mods = await openSim();
  const all = [];
  for (let k = 0; k < seeds; k += 1) {
    const b = scenario(mods, id, 'joseon', 1592 + k * 101);
    // --rules=v1 measures the depth rules before the maneuvers, --rules=classic the rules before those.
    const rules = flag('rules', 'latest');
    if (rules === 'classic') b.depth = null;
    else if (rules === 'v1') b.depth = mods.depth.DEPTH_V1;
    if (mode === 'auto') b.autopilot = true;
    const r = run(mods, b, { minutes });
    all.push(r);
    console.log(JSON.stringify({ seed: k, ...r }));
  }
  const mean = (f) => +(all.reduce((a, r) => a + f(r), 0) / all.length).toFixed(1);
  console.log(`mean crossfire ${mean((r) => r.crossShare)}% · through friends ${mean((r) => r.maskedShare)}% · fouling ${mean((r) => r.foulingPerSecond)}/s · japan lost ${mean((r) => r.lost.japan)} · joseon lost ${mean((r) => r.lost.joseon)} · ${mean((r) => r.minutes)} min`);
  await mods.server.close();
}
