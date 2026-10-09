// Computer-against-computer battles for balancing the playable factions. Runs the simulation only: no browser, no GPU.
//   node scripts/balance.mjs                                   every battle, every playable side, 2 seeds
//   node scripts/balance.mjs hansan okpo --side=japan --seeds=4 --minutes=20
//   node scripts/balance.mjs --pace                            opening gap, ships on land and sim time to first contact
// The player's side is led by the same computer rules as the enemy, so a human with a plan should do better.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const a = args.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : fallback;
};
const only = args.filter((a) => !a.startsWith('--'));
const seeds = Number(flag('seeds', 2));
const minutes = Number(flag('minutes', 15));
const sides = flag('side', null)?.split(',') ?? null;

const server = await createServer({
  root,
  configFile: false,
  logLevel: 'error',
  appType: 'custom',
  server: { middlewareMode: true, hmr: false, ws: false },
  optimizeDeps: { noDiscovery: true, include: [] },
});
const load = (p) => server.ssrLoadModule(p);
const { buildScenario, SCENARIOS, SCENARIO_ORDER } = await load('/src/sim/scenarios.ts');
const { SIM_DT } = await load('/src/sim/battle.ts');
const { applyBalance, playableFactions } = await load('/src/sim/balance.ts');
const { teamOf } = await load('/src/sim/types.ts');
const { generateHeightmap } = await load('/src/terrain/generate.ts');
const { CurrentField } = await load('/src/sim/current.ts');
const { waveField, SEA_STATES } = await load('/src/ocean/waves.ts');

// Heightmaps take a while to generate, so they are kept between runs.
const cacheDir = join(root, 'node_modules', '.cache', 'balance');
mkdirSync(cacheDir, { recursive: true });
const terrains = new Map();
function landOf(spec) {
  const key = createHash('sha1').update(JSON.stringify(spec)).digest('hex').slice(0, 12);
  let h = terrains.get(key);
  if (!h) {
    const file = join(cacheDir, `terrain-${key}.f32`);
    if (existsSync(file)) {
      const buf = readFileSync(file);
      h = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    } else {
      h = generateHeightmap(spec);
      writeFileSync(file, Buffer.from(h.buffer));
    }
    terrains.set(key, h);
  }
  const { size, res } = spec;
  // Same bilinear lookup as Terrain.heightAtScenario. The battle runs unrotated, so world and scenario axes agree.
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

function run(id, faction, seed) {
  const info = SCENARIOS[id];
  const land = landOf(info.terrain);
  waveField.setState(SEA_STATES[info.sea]);
  waveField.time = 0;
  const b = buildScenario(id, 0, seed, land);
  b.land = land;
  b.flow = info.current ? new CurrentField(info.current, land, 0) : null;
  b.center = { x: info.view.tx, z: info.view.tz };
  b.arenaRadius = 5200;
  applyBalance(b, id, faction);
  b.autopilot = true;
  const own = teamOf(faction);
  const enemy = own === 'joseon' ? 'japan' : 'joseon';
  const started = performance.now();
  while (!b.winner && b.time < minutes * 60) {
    b.step(SIM_DT);
    waveField.time += SIM_DT;
    b.events.length = 0;
  }
  const so = b.strength(own);
  const se = b.strength(enemy);
  return {
    win: b.winner === own,
    decided: !!b.winner,
    time: b.time,
    ownLost: 1 - b.teamCount(own) / Math.max(1, b.initial[own]),
    enemyLost: 1 - (b.teamCount(enemy) + b.escaped[enemy]) / Math.max(1, b.initial[enemy]),
    enemyFled: b.escaped[enemy],
    share: so / Math.max(1, so + se),
    seconds: (performance.now() - started) / 1000,
  };
}

// Pacing: how far apart the fleets start, whether any ship starts on dry ground, and how long the approach takes.
// First contact is what the engine's fast-forward waits for: an enemy within 400 m, a shot in the air or a grapple.
function pace(id, seed) {
  const info = SCENARIOS[id];
  const land = landOf(info.terrain);
  waveField.setState(SEA_STATES[info.sea]);
  waveField.time = 0;
  const b = buildScenario(id, 0, seed, land);
  b.land = land;
  b.flow = info.current ? new CurrentField(info.current, land, 0) : null;
  b.center = { x: info.view.tx, z: info.view.tz };
  b.arenaRadius = 5200;
  b.autopilot = true;
  const gap = () => {
    let min = Infinity;
    for (const a of b.activeOf('joseon')) for (const c of b.activeOf('japan')) min = Math.min(min, Math.hypot(a.x - c.x, a.z - c.z));
    return min;
  };
  b.step(SIM_DT);
  const start = gap();
  const aground = b.ships.filter((s) => land(s.x, s.z) > -1.4).length;
  let contact = null;
  while (contact === null && b.time < 1200) {
    b.step(SIM_DT);
    waveField.time += SIM_DT;
    if (b.projectiles.length || b.ships.some((s) => s.grappledWith) || gap() < 400) contact = b.time;
    b.events.length = 0;
  }
  return { start, aground, contact };
}

const pct = (v) => `${Math.round(v * 100)}%`.padStart(4);
const list = only.length ? only : SCENARIO_ORDER;
if (args.includes('--pace')) {
  for (const id of list) {
    const rows = [];
    for (let k = 0; k < seeds; k += 1) rows.push(pace(id, 1592 + k * 101));
    const mean = (f) => rows.reduce((a, r) => a + f(r), 0) / rows.length;
    console.log(`${id.padEnd(12)} opening gap ${mean((r) => r.start).toFixed(0).padStart(5)} m · on land ${Math.max(...rows.map((r) => r.aground))} · first contact ${mean((r) => r.contact ?? 1200).toFixed(0).padStart(4)} s of battle time`);
  }
  await server.close();
  process.exit(0);
}
console.log(`seeds ${seeds} · cap ${minutes} min · win% = player side wins · lost = share of ships sunk or struck · share = strength left at the end`);
for (const id of list) {
  for (const faction of playableFactions(id)) {
    if (sides && !sides.includes(faction)) continue;
    const rows = [];
    for (let k = 0; k < seeds; k += 1) rows.push(run(id, faction, 1592 + k * 101));
    const mean = (f) => rows.reduce((a, r) => a + f(r), 0) / rows.length;
    const wins = rows.filter((r) => r.win).length;
    const open = rows.filter((r) => !r.decided).length;
    console.log(
      `${id.padEnd(12)} ${faction.padEnd(7)} win ${pct(wins / rows.length)}${open ? ` (${open} undecided)` : ''} · ${(mean((r) => r.time) / 60).toFixed(1)} min · own lost ${pct(mean((r) => r.ownLost))} · enemy lost ${pct(mean((r) => r.enemyLost))} · fled ${mean((r) => r.enemyFled).toFixed(0)} · share ${pct(mean((r) => r.share))} · ${mean((r) => r.seconds).toFixed(0)}s/run`,
    );
  }
}
await server.close();
