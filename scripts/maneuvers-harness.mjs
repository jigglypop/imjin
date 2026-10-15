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
  // The gun's own target, as the battle lays it, for the shots through friendly hulls.
  const fire = b.fireGun;
  b.fireGun = function (s, g, targetId) {
    const t = targetId > 0 ? b.get(targetId) : undefined;
    if (s.team === team && t && b.isActive(t)) {
      m.shots += 1;
      if (blocked(s, t)) m.masked += 1;
    }
    return fire.call(this, s, g, targetId);
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

/** Gwaneumpo: the dead-end bay behind its neck on Namhae's north-west shore (NORYANG_BATTLE_TERRAIN). */
export const inGwaneumpo = (s) => s.z > 2450 && s.x < -2000 && s.x > -3900;

/**
 * Noryang played to its end, with a player's commands (`playNoryang`) or none, and what became of the Japanese fleet:
 * sunk, taken, fled home east or through to Suncheon west, still inside Gwaneumpo at the end, and with `trace` where it
 * was every two minutes.
 */
export function noryang(mods, seed, orders, { minutes = 60, trace = false } = {}) {
  const b = scenario(mods, 'noryang', 'joseon', seed);
  const play = orders ? (orders === 'exit' ? playNoryangExit : playNoryang)(b, mods.cmd.applyCommand) : undefined;
  let next = 0;
  const r = run(mods, b, {
    minutes,
    each: () => {
      play?.();
      if (!trace || b.time < next) return;
      next += 120;
      const live = b.activeOf('japan');
      const n = (f) => live.filter(f).length;
      console.log(`  ${(b.time / 60).toFixed(0).padStart(3)} min · japan east ${n((s) => s.x > 600)} strait ${n((s) => s.x <= 600 && s.x > -600)} west ${n((s) => s.x <= -600 && !inGwaneumpo(s))} bay ${n(inGwaneumpo)} routing ${n((s) => s.moraleState === 'routing')} fled ${b.escaped.japan} · allies ${b.activeOf('joseon').length}${play ? ` · step ${play.step()}` : ''}`);
    },
  });
  const japan = b.ships.filter((s) => s.team === 'japan');
  r.bay = japan.filter((s) => inGwaneumpo(s) && b.isActive(s)).length;
  r.bayTaken = japan.filter((s) => inGwaneumpo(s) && (s.struck || s.sinking > 0)).length;
  r.taken = japan.filter((s) => s.struck).length;
  r.sunk = japan.filter((s) => s.sinking > 0 && !s.struck).length;
  r.home = japan.filter((s) => s.fled && s.x > -1500).length;
  r.through = japan.filter((s) => s.fled && s.x <= -1500).length;
  r.allies = b.ships.filter((s) => s.team === 'joseon' && !b.isActive(s) && !s.fled).length;
  return r;
}

export const noryangLine = (r) => `${r.winner ?? 'undecided'} at ${r.minutes} min · Japanese sunk ${r.sunk}, taken ${r.taken}, fled home ${r.home}, through west ${r.through}, in Gwaneumpo ${r.bay} (+${r.bayTaken} sunk or taken there) · allies lost ${r.allies} · crossfire ${r.crossShare}%`;

/**
 * A player's Noryang, only commands a player could give, each when the battle calls for it: the whole Joseon fleet lies
 * in wait, dark, on the Namhae side of the western basin the relief must cross, the Ming on the mainland side; the drum
 * when the van is deep in it; the flagship's squadron breaks through the column behind the van and holds that line
 * while the wings ring the van with one side left open toward Gwaneumpo (退開一面); a detachment shuts Gwaneumpo's mouth
 * once the broken van has run into it, and the rest run down the fugitives.
 */
export function playNoryang(b, applyCommand) {
  const ZONE = { x: -3200, z: 250, r: 600 };
  // Behind the van, across the basin from south to north: broken through, then held.
  const CUT = { x0: -1800, z0: 800, x1: -1800, z1: -800 };
  const NECK = { x0: -2750, z0: 2350, x1: -2150, z1: 2350 };
  let step = 0;
  let at = -1;
  let neck = false;
  let chase = false;
  const tick = () => {
    const sq = (name) => b.squadrons.find((s) => s.name === name);
    const ids = (s) => s.shipIds.filter((id) => b.isActive(b.get(id)));
    const yi = sq('통제사 본대');
    const left = sq('조선 좌군');
    const right = sq('조선 우군');
    const cmd = (c) => applyCommand(b, 0, c);
    const japan = b.activeOf('japan');
    if (step === 0 && b.time > 1) {
      cmd({ type: 'maneuver', ids: [...ids(yi), ...ids(left), ...ids(right)], kind: 'ambush', x0: ZONE.x, z0: ZONE.z, x1: ZONE.x + ZONE.r, z1: ZONE.z });
      step = 1;
    } else if (step === 1) {
      // The van deep in the basin: the drum, unless the ambush has sprung on its own.
      const plan = [...b.maneuvers.plans.values()].find((p) => p.owner === 0 && p.kind === 'ambush');
      if (plan && plan.phase !== 'striking' && japan.filter((s) => s.x < ZONE.x + 400).length >= 40) cmd({ type: 'signal', ids: ids(yi), signal: 'advance' });
      if (!plan || plan.phase === 'striking') {
        at = b.time;
        step = 2;
      }
    } else if (step === 2 && b.time > at + 20) {
      cmd({ type: 'maneuver', ids: ids(yi), kind: 'breach', ...CUT });
      const van = japan.filter((s) => s.x < CUT.x0);
      const x = van.length ? van.reduce((v, s) => v + s.x, 0) / van.length : ZONE.x;
      const z = van.length ? van.reduce((v, s) => v + s.z, 0) / van.length : ZONE.z;
      const mouth = { x: (NECK.x0 + NECK.x1) / 2, z: NECK.z0 };
      cmd({ type: 'maneuver', ids: [...ids(left), ...ids(right)], kind: 'encircle', x0: x, z0: z, x1: mouth.x, z1: mouth.z, open: true });
      at = b.time;
      step = 3;
    } else if (step === 3 && (b.time > at + 150 || !ids(yi).some((id) => b.maneuvers.planOf(b.get(id))?.kind === 'breach'))) {
      cmd({ type: 'maneuver', ids: ids(yi), kind: 'blockade', ...CUT });
      step = 4;
    }
    if (step < 4) return;
    if (!neck && japan.filter((s) => s.z > 2300 && s.x < -2000).length >= 8) {
      cmd({ type: 'maneuver', ids: ids(right).slice(0, 8), kind: 'blockade', ...NECK });
      neck = true;
    }
    if (!chase && japan.filter((s) => s.moraleState === 'routing').length >= 25) {
      const free = [...ids(left), ...ids(right)].filter((id) => b.maneuvers.planOf(b.get(id))?.kind !== 'blockade');
      if (free.length) cmd({ type: 'maneuver', ids: free, kind: 'pursue', x0: 0, z0: 0, x1: 0, z1: 0 });
      chase = true;
    }
  };
  tick.step = () => step + (neck ? 10 : 0) + (chase ? 20 : 0);
  return tick;
}

/**
 * Another player's Noryang: the Joseon fleet lies in wait on both shores of the narrows' western exit, the drum when
 * thirty are out; the flagship's squadron breaks through behind them and then holds that line; Gwaneumpo's mouth is
 * shut once the broken van has run in, and the wings run down the fugitives.
 */
export function playNoryangExit(b, applyCommand) {
  const ZONE = { x: -1100, z: -50, r: 480 };
  const CUT = { x0: -500, z0: -850, x1: -500, z1: 700 };
  const NECK = { x0: -2750, z0: 2350, x1: -2150, z1: 2350 };
  let step = 0;
  let at = -1;
  let neck = false;
  let chase = false;
  const tick = () => {
    const sq = (name) => b.squadrons.find((s) => s.name === name);
    const ids = (s) => s.shipIds.filter((id) => b.isActive(b.get(id)));
    const yi = sq('통제사 본대');
    const left = sq('조선 좌군');
    const right = sq('조선 우군');
    const cmd = (c) => applyCommand(b, 0, c);
    const japan = b.activeOf('japan');
    if (step === 0 && b.time > 1) {
      cmd({ type: 'maneuver', ids: [...ids(yi), ...ids(left), ...ids(right)], kind: 'ambush', x0: ZONE.x, z0: ZONE.z, x1: ZONE.x + ZONE.r, z1: ZONE.z });
      step = 1;
    } else if (step === 1) {
      const plan = [...b.maneuvers.plans.values()].find((p) => p.owner === 0 && p.kind === 'ambush');
      if (plan && plan.phase !== 'striking' && japan.filter((s) => s.x < -900).length >= 30) cmd({ type: 'signal', ids: ids(yi), signal: 'advance' });
      if (!plan || plan.phase === 'striking') {
        at = b.time;
        step = 2;
      }
    } else if (step === 2 && b.time > at + 20) {
      cmd({ type: 'maneuver', ids: ids(yi), kind: 'breach', ...CUT });
      at = b.time;
      step = 3;
    } else if (step === 3 && (b.time > at + 150 || !ids(yi).some((id) => b.maneuvers.planOf(b.get(id))?.kind === 'breach'))) {
      cmd({ type: 'maneuver', ids: ids(yi), kind: 'blockade', ...CUT });
      step = 4;
    }
    if (step < 4) return;
    if (!neck && japan.filter((s) => s.z > 2300 && s.x < -2000).length >= 8) {
      cmd({ type: 'maneuver', ids: ids(right).slice(0, 8), kind: 'blockade', ...NECK });
      neck = true;
    }
    if (!chase && japan.filter((s) => s.moraleState === 'routing').length >= 25) {
      const free = [...ids(left), ...ids(right)].filter((id) => b.maneuvers.planOf(b.get(id))?.kind !== 'blockade');
      if (free.length) cmd({ type: 'maneuver', ids: free, kind: 'pursue', x0: 0, z0: 0, x1: 0, z1: 0 });
      chase = true;
    }
  };
  tick.step = () => step + (neck ? 10 : 0) + (chase ? 20 : 0);
  return tick;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const flag = (k, d) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
  const id = args.find((a) => !a.startsWith('--')) ?? 'hansan';
  const seeds = Number(flag('seeds', 3));
  const mode = flag('mode', 'auto');
  const minutes = Number(flag('minutes', 25));
  const mods = await openSim();
  if (id === 'noryang') {
    // node scripts/maneuvers-harness.mjs noryang [--seeds=3] [--seed0=1592] [--plans=none,deep,exit] [--trace]
    const plans = flag('plans', 'none,deep').split(',');
    for (let k = 0; k < seeds; k += 1) {
      const seed = Number(flag('seed0', 1592)) + k * 101;
      for (const plan of plans) {
        const r = noryang(mods, seed, plan === 'none' ? false : plan, { minutes: Number(flag('minutes', 60)), trace: args.includes('--trace') });
        console.log(`seed ${seed} ${plan.padEnd(5)}: ${noryangLine(r)}`);
      }
    }
    await mods.server.close();
    process.exit(0);
  }
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
