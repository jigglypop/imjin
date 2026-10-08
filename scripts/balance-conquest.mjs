// Computer-against-computer conquest battles for balancing the three navies against each other.
//   node scripts/balance-conquest.mjs                          every pairing on every map, both sides of the map, 2 seeds
//   node scripts/balance-conquest.mjs --map=hallyeo --match=joseon:japan --seeds=4 --minutes=25
// Each pairing is played from both home ports so the map's own lean cancels out.
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
const seeds = Number(flag('seeds', 2));
const minutes = Number(flag('minutes', 30));
const verbose = args.includes('--verbose');

const server = await createServer({
  root,
  configFile: false,
  logLevel: 'error',
  appType: 'custom',
  server: { middlewareMode: true, hmr: false, ws: false },
  optimizeDeps: { noDiscovery: true, include: [] },
});
const load = (p) => server.ssrLoadModule(p);
const battleModule = await load('/src/sim/battle.ts');
const { SIM_DT } = battleModule;
const { buildConquest, CONQUEST_MAPS, CONQUEST_ORDER, autoFleet } = await load('/src/sim/maps.ts');
const { generateHeightmap } = await load('/src/terrain/generate.ts');
const { waveField, SEA_STATES } = await load('/src/ocean/waves.ts');

const maps = flag('map', null)?.split(',') ?? CONQUEST_ORDER;
const matches = (flag('match', 'joseon:japan,ming:japan,joseon:ming,japan:japan')).split(',').map((m) => m.split(':'));

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

function run(mapId, west, east, seed) {
  const map = CONQUEST_MAPS[mapId];
  const land = landOf(map.terrain);
  waveField.setState(SEA_STATES[map.sea]);
  waveField.time = 0;
  const seats = [
    { name: 'west', faction: west, team: 'joseon', human: false, fleet: autoFleet(west) },
    { name: 'east', faction: east, team: 'japan', human: false, fleet: autoFleet(east) },
  ];
  const { battle: b, conquest: c } = buildConquest(mapId, seats, land, seed, { timeLimit: minutes * 60 });
  if (verbose && seed === 1592) {
    for (const p of c.points) console.log(`  ${p.name.padEnd(8)} slots ${p.slots.length} spawn ${p.spawn.x.toFixed(0)},${p.spawn.z.toFixed(0)} land@spawn ${land(p.spawn.x, p.spawn.z).toFixed(1)}`);
  }
  const started = performance.now();
  let built = 0;
  let recruited = 0;
  let captures = 0;
  let nextTrace = 60;
  const lostValue = { joseon: 0, japan: 0 };
  while (!b.winner && b.time < minutes * 60 + 1) {
    b.step(SIM_DT);
    for (const e of b.events) {
      if (e.type === 'sinking' || e.type === 'struck') {
        const s = b.get(e.ship);
        if (s && !(e.type === 'sinking' && s.struck)) lostValue[s.team] += s.spec.cost;
      }
    }
    if (args.includes('--trace') && b.time >= nextTrace) {
      nextTrace += 60;
      const orders = {};
      for (const s of b.ships) if (b.isActive(s)) orders[s.team + ':' + s.order.type] = (orders[s.team + ':' + s.order.type] ?? 0) + 1;
      console.log('    t' + Math.round(b.time / 60), 'lost', lostValue.joseon, lostValue.japan, 'value', ['joseon', 'japan'].map((t) => b.ships.filter((x) => x.team === t && b.isActive(x)).reduce((a, x) => a + x.spec.cost, 0)).join('/'), 'held', c.held('joseon'), c.held('japan'), 'tix', Math.round(c.tickets.joseon), Math.round(c.tickets.japan), 'ships', b.teamCount('joseon'), b.teamCount('japan'), 'funds', c.players.map((p) => Math.round(p.funds)).join('/'), 'pts', c.points.map((p) => p.owner + ':' + p.hold.toFixed(1) + (p.contested ? '!' : '')).join(' '), JSON.stringify(orders));
    }
    waveField.time += SIM_DT;
    for (const e of b.events) {
      if (e.type === 'built') built += 1;
      else if (e.type === 'spawned') recruited += 1;
      else if (e.type === 'captured' && e.owner >= 0) captures += 1;
    }
    b.events.length = 0;
  }
  return {
    westWin: b.winner === 'joseon',
    time: b.time,
    tickets: { west: Math.round(c.tickets.joseon), east: Math.round(c.tickets.japan) },
    ships: { west: b.teamCount('joseon'), east: b.teamCount('japan') },
    held: { west: c.held('joseon'), east: c.held('japan') },
    built,
    recruited,
    captures,
    seconds: (performance.now() - started) / 1000,
  };
}

/** Open-water fleet battle with equal budgets: cost-effectiveness of each navy without points or shipyards. */
function duel(a, z, seed, budget) {
  const { Battle } = battleModule;
  const b = new Battle(seed);
  b.land = () => -50;
  b.humans = new Set();
  b.retreatBelow = { joseon: 0, japan: 0 };
  const sides = [
    { faction: a, team: 'joseon', x: -650, h: 0 },
    { faction: z, team: 'japan', x: 650, h: Math.PI },
  ];
  sides.forEach((side, owner) => {
    const fleet = autoFleet(side.faction, owner === 1 ? budget * Number(flag("ratio", 1)) : budget);
    const sq = b.addSquadron(side.team, side.faction, side.faction, '', '', owner);
    fleet.forEach((kind, i) => {
      const row = Math.floor(i / 6);
      const col = (i % 6) - 2.5;
      const s = b.addShip(kind, side.x + (side.h ? row : -row) * 60, col * 60, side.h, kind + i, sq);
      s.order = { type: 'auto' };
    });
  });
  while (!b.winner && b.time < 900) {
    b.step(SIM_DT);
    waveField.time += SIM_DT;
    b.events.length = 0;
  }
  const value = (team) => b.ships.filter((s) => s.team === team && b.isActive(s)).reduce((v, s) => v + s.spec.cost * (s.hull / s.spec.hull * 0.6 + s.crew / s.spec.crew * 0.4), 0);
  return { aWin: b.winner === 'joseon' || (!b.winner && value('joseon') > value('japan')), time: b.time, left: [value('joseon'), value('japan')].map(Math.round) };
}

const pct = (v) => `${Math.round(v * 100)}%`.padStart(4);
console.log(`seeds ${seeds} per side · cap ${minutes} min · win% = first faction wins, counting games from both home ports`);
if (args.includes('--duel')) {
  const budget = Number(flag('budget', 5200));
  for (const [a, z] of matches) {
    const rows = [];
    for (let k = 0; k < seeds; k += 1) rows.push(duel(a, z, 1592 + k * 31, budget));
    const wins = rows.filter((r) => r.aWin).length;
    const minutesMean = rows.reduce((s, r) => s + r.time, 0) / rows.length / 60;
    console.log(`duel ${a.padEnd(7)} vs ${z.padEnd(7)} ${pct(wins / rows.length)} · ${minutesMean.toFixed(1)} min · left ${rows.map((r) => r.left.join('/')).join(' ')}`);
  }
  await server.close();
  process.exit(0);
}
for (const mapId of maps) {
  for (const [a, z] of matches) {
    const rows = [];
    for (let k = 0; k < seeds; k += 1) {
      const seed = 1592 + k * 101;
      const r1 = run(mapId, a, z, seed);
      const r2 = run(mapId, z, a, seed + 7);
      rows.push({ aWin: r1.westWin, ...r1, side: 'west' }, { aWin: !r2.westWin, ...r2, side: 'east' });
      if (verbose) {
        for (const r of [r1, r2]) console.log(`   ${mapId} ${r === r1 ? a + ' W' : z + ' W'} ${(r.time / 60).toFixed(1)}min tickets ${r.tickets.west}/${r.tickets.east} ships ${r.ships.west}/${r.ships.east} held ${r.held.west}/${r.held.east} built ${r.built} recruited ${r.recruited} caps ${r.captures} ${r.seconds.toFixed(0)}s`);
      }
    }
    const wins = rows.filter((r) => r.aWin).length;
    const mean = (f) => rows.reduce((s, r) => s + f(r), 0) / rows.length;
    console.log(`${mapId.padEnd(14)} ${a.padEnd(7)} vs ${z.padEnd(7)} ${pct(wins / rows.length)} · ${(mean((r) => r.time) / 60).toFixed(1)} min · built ${mean((r) => r.built).toFixed(1)} · recruited ${mean((r) => r.recruited).toFixed(1)} · captures ${mean((r) => r.captures).toFixed(1)} · ${mean((r) => r.seconds).toFixed(0)}s/run`);
  }
}
await server.close();
