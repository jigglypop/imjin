// Every battle must end. Runs each historical scenario with a passive player (no orders, so the player's ships keep the
// orders the scenario gave them) and asserts that a winner is decided within the time limit. Simulation only, no browser.
//   node scripts/check-stalemate.mjs                           every scenario, every playable side, 2 seeds, 65 sim minutes
//   node scripts/check-stalemate.mjs hansan --side=joseon --seeds=4 --minutes=30 --verbose
//   node scripts/check-stalemate.mjs --conquest                the capture-point maps instead, with an idle player
// Exits 1 when a battle is still undecided at the limit. The server runs the same simulation, so this guards multiplayer too.
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
const minutes = Number(flag('minutes', 65));
const sides = flag('side', null)?.split(',') ?? null;
const verbose = args.includes('--verbose');
const trace = args.includes('--trace');

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
const { buildConquest, CONQUEST_MAPS, CONQUEST_ORDER, autoFleet } = await load('/src/sim/maps.ts');
const { SIM_DT } = await load('/src/sim/battle.ts');
const { applyBalance, playableFactions } = await load('/src/sim/balance.ts');
const { teamOf } = await load('/src/sim/types.ts');
const { generateHeightmap } = await load('/src/terrain/generate.ts');
const { CurrentField } = await load('/src/sim/current.ts');
const { waveField, SEA_STATES } = await load('/src/ocean/waves.ts');

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
  // autopilot stays off: the player's ships keep the orders the scenario gave them, as when nobody touches the controls.
  const started = performance.now();
  let shots = 0;
  while (!b.winner && b.time < minutes * 60) {
    b.step(SIM_DT);
    waveField.time += SIM_DT;
    if (trace && Math.floor(b.time / SIM_DT) % Math.round(120 / SIM_DT) === 0) {
      const kinds = {};
      for (const t of ['joseon', 'japan']) for (const s of b.activeOf(t)) kinds[`${t}:${s.order.type}/${b.activityOf(s.id)}`] = (kinds[`${t}:${s.order.type}/${b.activityOf(s.id)}`] ?? 0) + 1;
      const dry = { joseon: 0, japan: 0 };
      for (const t of ['joseon', 'japan']) for (const s of b.activeOf(t)) if (s.guns.length && s.guns.every((g) => g.ammo <= 0)) dry[t] += 1;
      console.log(`  t=${(b.time / 60).toFixed(0)}m shots ${shots} dry ${dry.joseon}/${dry.japan} grapples ${b.ships.filter((s) => s.grappledWith).length} ${JSON.stringify(kinds)}`);
    }
    if (trace && Math.floor(b.time / SIM_DT) % Math.round(600 / SIM_DT) === 0) {
      for (const t of ['joseon', 'japan']) {
        const a = b.activeOf(t);
        if (a.length <= 12) for (const s of a) console.log(`    ${t} #${s.id} ${s.spec.kind} ${s.order.type}/${b.activityOf(s.id)} at ${s.x.toFixed(0)},${s.z.toFixed(0)} r=${Math.hypot(s.x - b.center.x, s.z - b.center.z).toFixed(0)} spd ${s.speed.toFixed(1)} aground ${s.aground.toFixed(1)} hull ${(s.hull / s.spec.hull).toFixed(2)} crew ${(s.crew / s.spec.crew).toFixed(2)}`);
      }
    }
    for (const e of b.events) if ((e.type === 'shot' || e.type === 'musket')) shots += 1;
    b.events.length = 0;
  }
  return {
    decided: !!b.winner,
    winner: b.winner,
    time: b.time,
    left: { joseon: b.teamCount('joseon'), japan: b.teamCount('japan') },
    fled: { ...b.escaped },
    seconds: (performance.now() - started) / 1000,
  };
}

/** A capture-point battle against the computer with the player idle: the ships hold where they muster. The ticket count or the clock decides it. */
function runConquest(mapId, faction, seed) {
  const map = CONQUEST_MAPS[mapId];
  const land = landOf(map.terrain);
  waveField.setState(SEA_STATES[map.sea]);
  waveField.time = 0;
  const foe = faction === 'japan' ? 'joseon' : 'japan';
  const seats = [
    { name: 'player', faction, team: 'joseon', human: true, fleet: autoFleet(faction) },
    { name: 'computer', faction: foe, team: 'japan', human: false, fleet: autoFleet(foe) },
  ];
  const { battle: b, conquest } = buildConquest(mapId, seats, land, seed, {});
  const started = performance.now();
  while (!b.winner && b.time < conquest.options.timeLimit + 5) {
    b.step(SIM_DT);
    waveField.time += SIM_DT;
    b.events.length = 0;
  }
  return { decided: !!b.winner, winner: b.winner, time: b.time, left: { joseon: b.teamCount('joseon'), japan: b.teamCount('japan') }, fled: { ...b.escaped }, seconds: (performance.now() - started) / 1000 };
}

const list = only.length ? only : SCENARIO_ORDER;
let bad = 0;
if (args.includes('--conquest')) {
  for (const mapId of only.length ? only : CONQUEST_ORDER) {
    for (const faction of ['joseon', 'japan']) {
      for (let k = 0; k < seeds; k += 1) {
        const r = runConquest(mapId, faction, 1592 + k * 101);
        if (!r.decided) bad += 1;
        if (!r.decided || verbose) console.log(`${r.decided ? 'ok  ' : 'FAIL'} conquest ${mapId.padEnd(10)} ${faction.padEnd(7)} seed ${k} · ${r.decided ? `${r.winner} wins` : 'UNDECIDED'} at ${(r.time / 60).toFixed(1)} min · left ${r.left.joseon}/${r.left.japan} · ${r.seconds.toFixed(0)}s`);
      }
    }
  }
  console.log(bad ? `${bad} battle(s) did not end` : 'every battle ended');
  await server.close();
  process.exit(bad ? 1 : 0);
}
console.log(`passive player · seeds ${seeds} · limit ${minutes} sim min`);
for (const id of list) {
  for (const faction of playableFactions(id)) {
    if (sides && !sides.includes(faction)) continue;
    for (let k = 0; k < seeds; k += 1) {
      const r = run(id, faction, 1592 + k * 101);
      if (!r.decided) bad += 1;
      if (!r.decided || verbose) {
        console.log(
          `${r.decided ? 'ok  ' : 'FAIL'} ${id.padEnd(12)} ${faction.padEnd(7)} seed ${k} · ${r.decided ? `${r.winner} wins` : 'UNDECIDED'} at ${(r.time / 60).toFixed(1)} min · left joseon ${r.left.joseon} japan ${r.left.japan} · fled ${r.fled.joseon}/${r.fled.japan} · ${r.seconds.toFixed(0)}s`,
        );
      }
    }
  }
}
console.log(bad ? `${bad} battle(s) did not end` : 'every battle ended');
await server.close();
process.exit(bad ? 1 : 0);
