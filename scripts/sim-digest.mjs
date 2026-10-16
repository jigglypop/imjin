// A fingerprint of the simulation, step by step, to prove that a speed-up changed nothing: the historical battles,
// Myeongnyang again on its own coast with its tidal current, a ranked and a casual conquest, and a night conquest on
// the Hallyeo coast under the single-player rules run on autopilot, and after every step each ship's numbers (as raw
// Float64 bytes, so -0 and +0 differ), the projectiles and the events go into a hash. Run it on the old and the new
// code and compare. The two battles on a real coast read the heightmaps scripts/balance.mjs keeps in node_modules/.cache.
//
//   node scripts/sim-digest.mjs --out=before.json [--seconds=180] [--only=busan,ranked] [--every=1]
//   node scripts/sim-digest.mjs --compare=before.json,after.json      the first step where each battle differs
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.length ? v.join('=') : 'true']; }));

if (args.compare) {
  const [a, b] = args.compare.split(',').map((p) => JSON.parse(readFileSync(p, 'utf8')));
  let same = true;
  for (const name of Object.keys(a.battles)) {
    const x = a.battles[name];
    const y = b.battles[name];
    if (!y) { console.log(`${name}: missing from the second run`); same = false; continue; }
    const n = Math.min(x.steps.length, y.steps.length);
    const first = x.steps.findIndex((d, i) => i < n && d !== y.steps[i]);
    if (first < 0 && x.steps.length === y.steps.length) console.log(`${name}: identical over ${n} samples`);
    else { same = false; console.log(`${name}: differs from step ${first < 0 ? n : first * x.every} (${(((first < 0 ? n : first) * x.every) / 30).toFixed(2)} s)`); }
  }
  process.exit(same ? 0 : 1);
}

const { createServer } = await import('vite');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const server = await createServer({ root, configFile: false, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false }, optimizeDeps: { noDiscovery: true, include: [] } });
const load = (p) => server.ssrLoadModule(p);
const { SIM_DT } = await load('/src/sim/battle.ts');
const { buildScenario, SCENARIOS } = await load('/src/sim/scenarios.ts');
const { buildConquest, autoFleet, CONQUEST_MAPS } = await load('/src/sim/maps.ts');
const { DEFAULT_OPTIONS, RANKED_OPTIONS } = await load('/src/sim/conquest.ts');
const { generateHeightmap } = await load('/src/terrain/generate.ts');
const { CurrentField } = await load('/src/sim/current.ts');
const { applyBalance } = await load('/src/sim/balance.ts');
const { DEPTH_LATEST } = await load('/src/sim/depth.ts');

// The heightmap cache and bilinear lookup of scripts/balance.mjs, so both tools sail on the same coast.
const cacheDir = join(root, 'node_modules', '.cache', 'balance');
mkdirSync(cacheDir, { recursive: true });
function landOf(spec) {
  const file = join(cacheDir, `terrain-${createHash('sha1').update(JSON.stringify(spec)).digest('hex').slice(0, 12)}.f32`);
  let h;
  if (existsSync(file)) {
    const buf = readFileSync(file);
    h = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  } else {
    h = generateHeightmap(spec);
    writeFileSync(file, Buffer.from(h.buffer));
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

/** A historical battle on its own coast, with its current, as scripts/balance.mjs and the game build it. */
function onCoast(id, faction, seed) {
  const info = SCENARIOS[id];
  const land = landOf(info.terrain);
  const b = buildScenario(id, 0, seed, land);
  b.land = land;
  b.flow = info.current ? new CurrentField(info.current, land, 0) : null;
  b.center = { x: info.view.tx, z: info.view.tz };
  b.arenaRadius = 5200;
  applyBalance(b, id, faction);
  return b;
}

const seconds = Number(args.seconds ?? 180);
const every = Math.max(1, Number(args.every ?? 1));
const open = () => -50;
const seats = (rankedFleet) => [
  { name: 'a', faction: 'joseon', team: 'joseon', human: false, fleet: rankedFleet ? autoFleet('joseon', undefined, undefined, 36, false) : autoFleet('joseon') },
  { name: 'b', faction: 'japan', team: 'japan', human: false, fleet: rankedFleet ? autoFleet('japan', undefined, undefined, 36, false) : autoFleet('japan') },
];
const BATTLES = {
  hansan: () => buildScenario('hansan', 0, 1592),
  busan: () => buildScenario('busan', 0, 1592),
  noryang: () => buildScenario('noryang', 0, 1592),
  myeongnyang: () => buildScenario('myeongnyang', 0, 1592),
  ranked: () => buildConquest('hallyeo', seats(true), open, 7, RANKED_OPTIONS).battle,
  casual: () => buildConquest('hallyeo', seats(false), open, 1598, DEFAULT_OPTIONS).battle,
  tide: () => onCoast('myeongnyang', 'joseon', 1592),
  // Seed 1592 falls at night on this map; the depth rules are those of a game against the computer.
  night: () => buildConquest('hallyeo', seats(false), landOf(CONQUEST_MAPS.hallyeo.terrain), 1592, { depth: DEPTH_LATEST.version }).battle,
};
const only = args.only ? args.only.split(',') : Object.keys(BATTLES);

// Walks plain data a few levels deep in a fixed key order. Ships and specs are referenced, not owned, so a ship met
// below the top of the walk stops it, as does anything already walked from the same root.
const floats = new Float64Array(1);
const bytes = new Uint8Array(floats.buffer);
let ships = new Set();
function feed(hash, value, depth, seen) {
  if (typeof value === 'number') { floats[0] = value; hash.update(bytes); return; }
  if (typeof value === 'boolean') { hash.update(value ? 't' : 'f'); return; }
  if (typeof value === 'string') { hash.update(`s${value.length}:${value}`); return; }
  if (value === null || value === undefined) { hash.update('n'); return; }
  if (depth <= 0 || typeof value !== 'object' || seen.has(value) || ships.has(value)) return;
  seen.add(value);
  if (ArrayBuffer.isView(value)) { hash.update(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)); return; }
  if (value instanceof Set || value instanceof Map) { hash.update(`c${value.size}`); for (const v of value) feed(hash, v, depth - 1, seen); return; }
  if (Array.isArray(value)) { hash.update(`a${value.length}`); for (const v of value) feed(hash, v, depth - 1, seen); return; }
  for (const key of Object.keys(value).sort()) {
    if (key === 'spec' || key === 'specs' || key === 'battle') continue;
    hash.update(key);
    feed(hash, value[key], depth - 1, seen);
  }
}

const out = { seconds, every, battles: {} };
for (const name of only) {
  const b = BATTLES[name]();
  b.autopilot = true;
  b.humans = new Set();
  const steps = [];
  const started = performance.now();
  const total = Math.round(seconds / SIM_DT);
  for (let i = 0; i < total; i += 1) {
    b.step(SIM_DT);
    if (i % every === 0) {
      const hash = createHash('sha256');
      ships = new Set(b.ships);
      for (const s of b.ships) {
        hash.update(`ship${s.id}`);
        for (const key of Object.keys(s).sort()) if (key !== 'spec') { hash.update(key); feed(hash, s[key], 3, new Set()); }
      }
      feed(hash, b.projectiles, 3, new Set());
      feed(hash, b.events, 4, new Set());
      steps.push(hash.digest('base64').slice(0, 16));
    }
    b.events.length = 0;
  }
  const ms = performance.now() - started;
  out.battles[name] = { ships: b.ships.length, every, steps };
  console.log(`${name}: ${b.ships.length} ships, ${total} steps in ${(ms / 1000).toFixed(1)} s, final ${steps.at(-1)}`);
}
await server.close();
if (args.out) writeFileSync(args.out, JSON.stringify(out));
