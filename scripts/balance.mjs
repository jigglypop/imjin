// Computer-against-computer battles for balancing the playable factions. Runs the simulation only: no browser, no GPU.
//   node scripts/balance.mjs                                   every battle, every playable side, 2 seeds
//   node scripts/balance.mjs hansan okpo --side=japan --seeds=4 --minutes=20
//   node scripts/balance.mjs --pace                            opening gap, ships on land and sim time to first contact
//   node scripts/balance.mjs --kpi [--passive] [--classic]     pacing: swing, ships engaging, longest lull, routs, time to decision
//   node scripts/balance.mjs --conquest [--classic] [--kpi]    both capture-point maps with both seats computer-led
// The player's side is led by the same computer rules as the enemy, so a human with a plan should do better. --passive
// leaves the player's ships in the orders the scenario gave them, as when nobody touches the controls. --classic runs
// the rules from before the battle depth rules (no morale, raking or spreading fire), the baseline for comparisons.
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
const firstSeed = Number(flag('seed0', 0));
const minutes = Number(flag('minutes', args.includes('--kpi') ? 60 : 15));
const sides = flag('side', null)?.split(',') ?? null;
const classic = args.includes('--classic');
const passive = args.includes('--passive');
const kpi = args.includes('--kpi');

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
const { DEPTH_V1 } = await load('/src/sim/depth.ts');

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

function scenario(id, faction, seed) {
  const info = SCENARIOS[id];
  const land = landOf(info.terrain);
  const b = buildScenario(id, 0, seed, land);
  b.land = land;
  b.flow = info.current ? new CurrentField(info.current, land, 0) : null;
  b.center = { x: info.view.tx, z: info.view.tz };
  b.arenaRadius = 5200;
  applyBalance(b, id, faction);
  if (classic) b.depth = null;
  return b;
}

/**
 * Pacing of one battle, sampled every 15 s of battle time. `share(team)` is a side's share of the strength still
 * fighting; blows are what the battle's own lull rules count (a hit, a ram, a grapple, a man cut down on deck).
 */
function pacing(b, share) {
  const samples = [];
  let firstContact = null;
  let lastBlow = null;
  let lull = 0;
  let next = 0;
  const morale = { routing: 0, rallying: 0, wavering: 0 };
  const engaged = [];
  const step = () => {
    for (const e of b.events) {
      if (firstContact === null && (e.type === 'shot' || e.type === 'musket' || e.type === 'board')) firstContact = lastBlow = b.time;
      if (e.type === 'hit' || e.type === 'ram' || e.type === 'board' || (e.type === 'casualty' && e.melee)) {
        if (lastBlow !== null) lull = Math.max(lull, b.time - lastBlow);
        lastBlow = b.time;
      }
      if (e.type === 'morale' && e.state in morale) morale[e.state] += 1;
    }
    if (b.time < next) return;
    next += 15;
    samples.push({ t: b.time, joseon: share('joseon') });
    if (firstContact === null) return;
    let busy = 0;
    let all = 0;
    for (const team of ['joseon', 'japan']) for (const s of b.activeOf(team)) {
      const a = b.activityOf(s.id);
      all += 1;
      if (a === 'engaging' || a === 'charging' || a === 'boarding') busy += 1;
    }
    if (all) engaged.push(busy / all);
  };
  const result = (winner) => {
    if (lastBlow !== null) lull = Math.max(lull, b.time - lastBlow);
    const side = winner ?? 'joseon';
    const of = (s) => (side === 'joseon' ? s.joseon : 1 - s.joseon);
    let peak = 0;
    let swing = 0;
    let crossings = 0;
    let sign = 0;
    let clinch = 0;
    for (const s of samples) {
      const v = of(s);
      peak = Math.max(peak, v);
      swing = Math.max(swing, peak - v);
      const k = Math.sign(s.joseon - 0.5);
      if (k && sign && k !== sign) crossings += 1;
      if (k) sign = k;
      // The winner leads by a quarter of the strength left, for good, from the last time it was not so.
      if (v < 0.625) clinch = s.t;
    }
    const total = b.initial.joseon + b.initial.japan;
    return {
      swing,
      crossings,
      engaged: engaged.length ? engaged.reduce((a, v) => a + v, 0) / engaged.length : 0,
      lull,
      routs: (morale.routing * 100) / Math.max(1, total),
      rallies: morale.rallying,
      firstContact: firstContact ?? b.time,
      clinch: b.time > 0 ? Math.min(1, clinch / b.time) : 1,
    };
  };
  return { step, result };
}

function run(id, faction, seed) {
  const b = scenario(id, faction, seed);
  b.autopilot = !passive;
  const own = teamOf(faction);
  const enemy = own === 'joseon' ? 'japan' : 'joseon';
  const live = (team) => b.strength(team);
  const track = pacing(b, (team) => live(team) / Math.max(1, live('joseon') + live('japan')));
  const started = performance.now();
  while (!b.ended && b.time < minutes * 60) {
    b.step(SIM_DT);
    track.step();
    b.events.length = 0;
  }
  const so = b.strength(own);
  const se = b.strength(enemy);
  return {
    win: b.winner === own,
    decided: b.ended,
    draw: b.draw,
    time: b.time,
    ownLost: 1 - b.teamCount(own) / Math.max(1, b.initial[own]),
    enemyLost: 1 - (b.teamCount(enemy) + b.escaped[enemy]) / Math.max(1, b.initial[enemy]),
    enemyFled: b.escaped[enemy],
    share: so / Math.max(1, so + se),
    pace: track.result(b.winner),
    seconds: (performance.now() - started) / 1000,
    msPerStep: (performance.now() - started) / Math.max(1, b.time / SIM_DT),
  };
}

// Pacing: how far apart the fleets start, whether any ship starts on dry ground, and how long the approach takes.
// First contact is what the engine's fast-forward waits for: an enemy within 400 m, a shot in the air or a grapple.
function pace(id, seed) {
  const b = scenario(id, 'joseon', seed);
  b.autopilot = true;
  const land = b.land;
  const gap = () => {
    let min = Infinity;
    for (const a of b.activeOf('joseon')) for (const c of b.activeOf('japan')) min = Math.min(min, Math.hypot(a.x - c.x, a.z - c.z));
    return min;
  };
  b.step(SIM_DT);
  const start = gap();
  const aground = b.ships.filter((s) => land(s.x, s.z) > -1.4).length;
  let contact = null;
  while (contact === null && !b.ended && b.time < 1200) {
    b.step(SIM_DT);
    if (b.projectiles.length || b.ships.some((s) => s.grappledWith) || gap() < 400) contact = b.time;
    b.events.length = 0;
  }
  return { start, aground, contact };
}

/** A capture-point battle with both seats computer-led. The winner's ticket lead decides when it was clinched. */
function runConquest(mapId, faction, seed) {
  const foe = faction === 'japan' ? 'joseon' : 'japan';
  const seats = [
    { name: 'west', faction, team: 'joseon', human: false, fleet: autoFleet(faction) },
    { name: 'east', faction: foe, team: 'japan', human: false, fleet: autoFleet(foe) },
  ];
  const { battle: b, conquest } = buildConquest(mapId, seats, landOf(CONQUEST_MAPS[mapId].terrain), seed, classic ? {} : { depth: DEPTH_V1.version });
  const tickets = (team) => Math.max(0, conquest.tickets[team]);
  const track = pacing(b, (team) => tickets(team) / Math.max(1, tickets('joseon') + tickets('japan')));
  let spawned = 0;
  const started = performance.now();
  while (!b.ended && b.time < conquest.options.timeLimit + 5) {
    b.step(SIM_DT);
    track.step();
    for (const e of b.events) if (e.type === 'spawned') spawned += 1;
    b.events.length = 0;
  }
  return { decided: b.ended, winner: b.winner, draw: b.draw, time: b.time, spawned, pace: track.result(b.winner), seconds: (performance.now() - started) / 1000 };
}

const pct = (v) => `${Math.round(v * 100)}%`.padStart(4);
const mean = (rows, f) => rows.reduce((a, r) => a + f(r), 0) / Math.max(1, rows.length);
const paceLine = (rows) =>
  ` · swing ${mean(rows, (r) => r.pace.swing).toFixed(3)} · crossings ${mean(rows, (r) => r.pace.crossings).toFixed(1)} · engaged ${pct(mean(rows, (r) => r.pace.engaged))} · longest lull ${mean(rows, (r) => r.pace.lull).toFixed(0)} s · routs/100 ${mean(rows, (r) => r.pace.routs).toFixed(1)} · rallies ${mean(rows, (r) => r.pace.rallies).toFixed(1)} · contact ${(mean(rows, (r) => r.pace.firstContact) / 60).toFixed(1)} min · clinched at ${pct(mean(rows, (r) => r.pace.clinch))}`;
const rules = classic ? 'classic rules' : 'depth rules';

if (args.includes('--conquest')) {
  console.log(`conquest · ${rules} · seeds ${seeds} · both seats computer-led · clinched = share of the match before the winner's ticket lead held for good`);
  for (const mapId of only.length ? only : CONQUEST_ORDER) {
    for (const faction of sides ?? ['joseon', 'japan']) {
      const rows = [];
      for (let k = firstSeed; k < firstSeed + seeds; k += 1) rows.push(runConquest(mapId, faction, 1592 + k * 101));
      const results = rows.map((r) => (r.draw ? 'draw' : r.decided ? r.winner : 'open')).join(',');
      console.log(`${mapId.padEnd(13)} ${faction.padEnd(7)} ${results} · ${(mean(rows, (r) => r.time) / 60).toFixed(1)} min · spawned ${mean(rows, (r) => r.spawned).toFixed(0)} · mop-up ${pct(1 - mean(rows, (r) => r.pace.clinch))}${paceLine(rows)} · ${mean(rows, (r) => r.seconds).toFixed(0)}s/run`);
    }
  }
  await server.close();
  process.exit(0);
}

const list = only.length ? only : SCENARIO_ORDER;
if (args.includes('--pace')) {
  for (const id of list) {
    const rows = [];
    for (let k = firstSeed; k < firstSeed + seeds; k += 1) rows.push(pace(id, 1592 + k * 101));
    console.log(`${id.padEnd(12)} opening gap ${mean(rows, (r) => r.start).toFixed(0).padStart(5)} m · on land ${Math.max(...rows.map((r) => r.aground))} · first contact ${mean(rows, (r) => r.contact ?? 1200).toFixed(0).padStart(4)} s of battle time`);
  }
  await server.close();
  process.exit(0);
}
console.log(`${rules} · ${passive ? 'passive player' : 'computer leads both sides'} · seeds ${seeds} · cap ${minutes} min · win% = player side wins · lost = share of ships sunk or struck · share = strength left at the end`);
for (const id of list) {
  for (const faction of playableFactions(id)) {
    if (sides && !sides.includes(faction)) continue;
    const rows = [];
    for (let k = firstSeed; k < firstSeed + seeds; k += 1) rows.push(run(id, faction, 1592 + k * 101));
    const wins = rows.filter((r) => r.win).length;
    const open = rows.filter((r) => !r.decided).length;
    const draws = rows.filter((r) => r.draw).length;
    console.log(
      `${id.padEnd(12)} ${faction.padEnd(7)} win ${pct(wins / rows.length)}${draws ? ` (${draws} draw)` : ''}${open ? ` (${open} undecided)` : ''} · ${(mean(rows, (r) => r.time) / 60).toFixed(1)} min · own lost ${pct(mean(rows, (r) => r.ownLost))} · enemy lost ${pct(mean(rows, (r) => r.enemyLost))} · fled ${mean(rows, (r) => r.enemyFled).toFixed(0)} · share ${pct(mean(rows, (r) => r.share))}${kpi ? paceLine(rows) + ` · ${mean(rows, (r) => r.msPerStep).toFixed(2)} ms/step` : ''} · ${mean(rows, (r) => r.seconds).toFixed(0)}s/run`,
    );
  }
}
await server.close();
