// Computer-against-computer grand campaigns, for balancing the three factions of the strategic mode.
//   node scripts/balance-grand.mjs                          60 seeds, summary
//   node scripts/balance-grand.mjs --seeds=200 --curves     adds the per-turn fleet and economy curves
//   node scripts/balance-grand.mjs --set=faction.japan.power=1,ai.japan.attackRatio=0.9    try numbers without editing code
//   node scripts/balance-grand.mjs --sweep='startFleet.japan=1.4|1.7|2;faction.ming.income=1|1.2'    every combination, one line each
//   node scripts/balance-grand.mjs --spread=0.1             perturb every navy's opening fleet by up to 10%, to see how stable the result is
//   node scripts/balance-grand.mjs --fit=japan --seeds=300  find the fighting-power multiplier that gives that navy a third of the wars
//   node scripts/balance-grand.mjs --catalog --odds         the ship table the campaign derives from SHIP_SPECS, and auto-resolve odds for a few matched fleets
//   node scripts/balance-grand.mjs --verbose                one line per game
//   node scripts/balance-grand.mjs --trace=1592             one game turn by turn: gold (net), each region as owner+garrison[fleets], the log
// Game rules are in src/sim/grand/*. --set and --sweep reach TUNING (economy.ts) by dotted path, and AI (ai.ts) with an "ai." prefix.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const a = args.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : fallback;
};
const seeds = Number(flag('seeds', 60));
const seed0 = Number(flag('seed0', 1592));

const server = await createServer({
  root,
  configFile: false,
  logLevel: 'error',
  appType: 'custom',
  server: { middlewareMode: true, hmr: false, ws: false },
  optimizeDeps: { noDiscovery: true, include: [] },
});
const load = (p) => server.ssrLoadModule(p);
const { newGrand, endTurn, MAX_TURNS, scoreOf } = await load('/src/sim/grand/turn.ts');
const { TUNING, netIncome } = await load('/src/sim/grand/economy.ts');
const { AI } = await load('/src/sim/grand/ai.ts');
const { REGION_ORDER } = await load('/src/sim/grand/regions.ts');

const FACTIONS = ['joseon', 'japan', 'ming'];
const label = { joseon: '조선', japan: '일본', ming: '명' };
const tag = { joseon: 'J', japan: 'N', ming: 'M' };

function setPath(path, raw) {
  const parts = path.split('.');
  let target = parts[0] === 'ai' ? AI : TUNING;
  const keys = parts[0] === 'ai' ? parts.slice(1) : parts;
  for (const k of keys.slice(0, -1)) target = target[k];
  target[keys[keys.length - 1]] = Number.isNaN(Number(raw)) ? raw : Number(raw);
}

for (const pair of (flag('set', '') || '').split(',').filter(Boolean)) setPath(...pair.split('='));

const spread = Number(flag('spread', 0));

function play(seed) {
  const g = newGrand(null, seed, 'normal', spread);
  for (let guard = 0; guard < 60 && g.phase !== 'over'; guard += 1) endTurn(g);
  return g;
}

function batch(count) {
  const games = [];
  for (let k = 0; k < count; k += 1) games.push(play(seed0 + k * 17));
  return games;
}

function summarize(games) {
  const wins = Object.fromEntries(FACTIONS.map((f) => [f, { total: 0, objective: 0, score: 0, elimination: 0 }]));
  let none = 0;
  let length = 0;
  for (const g of games) {
    length += g.victory ? g.victory.turn : MAX_TURNS;
    if (!g.victory) none += 1;
    else {
      wins[g.victory.faction].total += 1;
      wins[g.victory.faction][g.victory.kind] += 1;
    }
  }
  const mean = (f) => games.reduce((s, g) => s + f(g), 0) / games.length;
  return { wins, none, length: length / games.length, battles: mean((g) => g.stats.reduce((a, r) => a + r.battles, 0)), mean };
}

const pct = (n, of) => `${Math.round((n / of) * 100)}%`.padStart(4);

// --catalog: what the scaling layer makes of the battle catalog, and --odds: how auto-resolve settles some matched fleets.
if (args.includes('--catalog') || args.includes('--odds')) {
  const { shipDef } = await load('/src/sim/grand/economy.ts');
  const { autoResolve } = await load('/src/sim/grand/autoresolve.ts');
  if (args.includes('--catalog')) {
    for (const k of ['panokseon', 'geobukseon', 'hyeopseon', 'atakebune', 'sekibune', 'kobaya', 'mingship', 'mingsmall']) {
      const d = shipDef(k);
      console.log(`${k.padEnd(11)} gold ${String(d.gold).padStart(4)}  turns ${d.turns}  strength ${String(Math.round(d.strength)).padStart(5)}  gun share ${d.ranged.toFixed(2)}  boarding resist ${d.boardResist.toFixed(2)}`);
    }
  }
  if (args.includes('--odds')) {
    let n = 0;
    const fleet = (mix) => Object.entries(mix).flatMap(([k, c]) => Array.from({ length: c }, () => ({ id: `s${++n}`, kind: k, name: k, hull: 1, crew: 1, supply: 1, kills: 0 })));
    const strength = (list) => list.reduce((a, u) => a + shipDef(u.kind).strength, 0);
    const trial = (name, A, D) => {
      let wins = 0;
      let lostA = 0;
      let lostD = 0;
      for (let k = 0; k < 200; k += 1) {
        const a = fleet(A);
        const d = fleet(D);
        const r = autoResolve({ attacker: { ships: a, leader: 1 }, defender: { ships: d, leader: 1 }, seed: k, tags: [1] });
        if (r.outcome.winner === 'attacker') wins += 1;
        lostA += r.sunk.attacker / a.length;
        lostD += r.sunk.defender / d.length;
      }
      console.log(`${name.padEnd(34)} strength ${Math.round(strength(fleet(A)))} vs ${Math.round(strength(fleet(D)))}  attacker wins ${pct(wins, 200)}  sunk ${Math.round(lostA / 2)}% / ${Math.round(lostD / 2)}%`);
    };
    trial('10 panokseon vs 10 panokseon', { panokseon: 10 }, { panokseon: 10 });
    trial('15 panokseon vs 10 panokseon', { panokseon: 15 }, { panokseon: 10 });
    trial('12 panokseon vs 40 Japanese', { panokseon: 12 }, { atakebune: 8, sekibune: 16, kobaya: 16 });
    trial('40 Japanese vs 12 panokseon', { atakebune: 8, sekibune: 16, kobaya: 16 }, { panokseon: 12 });
    trial('8 mingship vs 8 panokseon', { mingship: 8 }, { panokseon: 8 });
  }
  await server.close();
  process.exit(0);
}

// --trace
if (flag('trace', null)) {
  const g = newGrand(null, Number(flag('trace', 1592)));
  while (g.phase !== 'over' && g.turn <= MAX_TURNS) {
    const from = g.log.length;
    endTurn(g);
    const board = REGION_ORDER.map((id) => {
      const count = { joseon: 0, japan: 0, ming: 0 };
      for (const f of g.fleets) if (f.at === id) count[f.faction] += f.ships.length;
      const here = FACTIONS.filter((f) => count[f]).map((f) => `${tag[f]}${count[f]}`).join('');
      const r = g.regions[id];
      return `${id.slice(0, 4)}:${r.owner ? tag[r.owner] : '-'}${r.garrison.length}[${here}]${r.queue.length ? `q${r.queue.length}` : ''}`;
    });
    console.log(`T${g.turn} gold ${FACTIONS.map((f) => `${Math.round(g.factions[f].gold)}(${netIncome(g, f)})`).join('/')} ${board.join(' ')}`);
    for (const e of g.log.slice(from)) console.log(`     ${e.text}`);
  }
  await server.close();
  process.exit(0);
}

// --fit=japan: bisects faction.<f>.power until that navy wins about a third of the wars, to re-centre after the catalog changes.
if (flag('fit', null)) {
  const f = flag('fit', 'japan');
  let lo = 0.7;
  let hi = 1.25;
  for (let i = 0; i < 9; i += 1) {
    const mid = (lo + hi) / 2;
    TUNING.faction[f].power = mid;
    const rate = batch(seeds).filter((g) => g.victory?.faction === f).length / seeds;
    console.log(`power ${mid.toFixed(3)} -> ${f} wins ${Math.round(rate * 100)}%`);
    if (rate > 1 / 3) hi = mid;
    else lo = mid;
  }
  console.log(`faction.${f}.power ~ ${((lo + hi) / 2).toFixed(3)}`);
  await server.close();
  process.exit(0);
}

// --sweep
if (flag('sweep', null)) {
  const axes = flag('sweep', '').split(';').map((a) => {
    const [path, values] = a.split('=');
    return { path, values: values.split('|') };
  });
  const combos = axes.reduce((acc, axis) => acc.flatMap((c) => axis.values.map((v) => [...c, [axis.path, v]])), [[]]);
  console.log(`${combos.length} combinations x ${seeds} games`);
  for (const combo of combos) {
    for (const [path, v] of combo) setPath(path, v);
    const s = summarize(batch(seeds));
    const rates = FACTIONS.map((f) => `${label[f]} ${pct(s.wins[f].total, seeds)}`).join(' ');
    console.log(`${combo.map(([p, v]) => `${p}=${v}`).join(' ').padEnd(70)} ${rates} | ${s.length.toFixed(1)} turns | ${s.battles.toFixed(1)} battles`);
  }
  await server.close();
  process.exit(0);
}

const started = performance.now();
const games = batch(seeds);
const seconds = (performance.now() - started) / 1000;
if (args.includes('--verbose')) {
  for (const g of games) {
    const last = g.stats[g.stats.length - 1];
    console.log(
      `seed ${g.seed} turn ${g.turn} winner ${g.victory ? `${g.victory.faction}/${g.victory.kind}` : 'none'} regions ${FACTIONS.map((f) => last.regions[f]).join('/')} ships ${FACTIONS.map((f) => last.ships[f]).join('/')} score ${FACTIONS.map((f) => scoreOf(g, f)).join('/')}`,
    );
  }
}
const s = summarize(games);
if (args.includes('--json')) {
  console.log(JSON.stringify({ games: games.length, wins: s.wins, none: s.none, averageTurns: s.length, battles: s.battles }));
} else {
  console.log(`${games.length} games, seeds ${seed0}+17k, ${seconds.toFixed(1)}s`);
  console.log('win rate   ' + FACTIONS.map((f) => `${label[f]} ${pct(s.wins[f].total, games.length)} (목표 ${s.wins[f].objective} · 점수 ${s.wins[f].score} · 섬멸 ${s.wins[f].elimination})`).join('  |  ') + `  |  none ${s.none}`);
  console.log(`average length ${s.length.toFixed(1)} turns, battles per game ${s.battles.toFixed(1)}`);
  // How hard Japan hits: its best moment, and how low Joseon is driven.
  const peak = (g, f) => Math.max(...g.stats.map((r) => r.regions[f]));
  const trough = (g, f) => Math.min(...g.stats.map((r) => r.regions[f]));
  console.log(
    `Japan peak ${s.mean((g) => peak(g, 'japan')).toFixed(1)} regions, held 7+ in ${pct(games.filter((g) => peak(g, 'japan') >= 7).length, games.length).trim()} of games · Joseon trough ${s.mean((g) => trough(g, 'joseon')).toFixed(1)}, down to 3 or fewer in ${pct(games.filter((g) => trough(g, 'joseon') <= 3).length, games.length).trim()}`,
  );
  const final = (f, key) => s.mean((g) => g.stats[g.stats.length - 1][key][f]);
  console.log('end state  ' + FACTIONS.map((f) => `${label[f]}: regions ${final(f, 'regions').toFixed(1)} ships ${final(f, 'ships').toFixed(0)} strength ${final(f, 'strength').toFixed(0)} gold ${final(f, 'gold').toFixed(0)}`).join('  |  '));
}

if (args.includes('--curves') && !args.includes('--json')) {
  const checkpoints = [0, 3, 6, 12, 18, 24, 30, 36];
  for (const key of ['regions', 'ships', 'strength', 'gold', 'income']) {
    console.log(`\n${key} by turn (mean)`);
    console.log('turn      ' + checkpoints.map((t) => String(t).padStart(7)).join(''));
    for (const f of FACTIONS) {
      const row = checkpoints.map((t) => {
        const vals = games.map((g) => (g.stats.find((r) => r.turn === t) ?? g.stats[g.stats.length - 1])[key][f]);
        return (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(key === 'regions' ? 1 : 0).padStart(7);
      });
      console.log(label[f].padEnd(8) + '  ' + row.join(''));
    }
  }
}
await server.close();
