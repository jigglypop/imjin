// Cross-chapter ship balance: equal-points fleets fought computer against computer on open water.
//   node scripts/balance-cross.mjs                       the standard pairings, 4 seeds, both seats each
//   node scripts/balance-cross.mjs --pair=racegalleon:panokseon --seeds=6 --budget=4200
//   node scripts/balance-cross.mjs --fit [--rounds=3]    nudge the fitted points (src/sim/points.ts) toward 50% and print them
//   node scripts/balance-cross.mjs --check               exit 1 if a pairing's win rate is outside 50 +/- tolerance (--tol=15)
// A fight ends when one side has nothing left fighting or after --minutes (default 14) of sim time; a fight not won by
// then is scored by the points still afloat (hull share of each live, unstruck ship). Each pairing is played from both
// seats so the spawn lean cancels. A fleet that cannot buy a whole number of ships gets its last ship at a part strength.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const a = args.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : fallback;
};
const seeds = Number(flag('seeds', 4));
const budget = Number(flag('budget', 4200));
const minutes = Number(flag('minutes', 14));
const tol = Number(flag('tol', 15));
const fit = args.includes('--fit');
const rounds = Number(flag('rounds', 3));

const server = await createServer({
  root,
  configFile: false,
  logLevel: 'error',
  appType: 'custom',
  server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] },
});
const load = (p) => server.ssrLoadModule(p);
const { Battle, SIM_DT } = await load('/src/sim/battle.ts');
const points = await load('/src/sim/points.ts');
const { COMPETITIVE_PROFILE } = await load('/src/sim/competitive.ts');

/** Kinds whose price is fixed (the ranked 1592 balance), and the pairings every run checks. */
const ANCHORS = new Set(['panokseon', 'geobukseon', 'hyeopseon', 'atakebune', 'sekibune', 'kobaya', 'mingship', 'mingsmall']);
// Each navy's fleet, in the shares its opening muster buys (src/sim/maps.ts RANKED_FLEET_MIX, the Armada's by the same rule).
const MIX = {
  joseon: 'panokseon+panokseon+geobukseon+panokseon+hyeopseon+panokseon+hyeopseon',
  japan: 'atakebune+sekibune+sekibune+kobaya+atakebune+sekibune+kobaya+sekibune',
  ming: 'mingship+mingsmall+mingship+mingsmall+mingsmall',
  england: 'racegalleon+pinnace+racegalleon+pinnace+racegalleon+fireship',
  spain: 'spgalleon+galleass+urca+spgalleon+spgalleon',
};
// The gate: whole navies at equal points. Ship-against-ship pairings are printed for reading only: within a chapter the
// navies are meant to beat each other's kinds the way history had it (the Joseon gun line over the Japanese boarders).
const GATE = [
  'england:spain', 'england:joseon', 'england:japan', 'england:ming', 'spain:joseon', 'spain:japan', 'spain:ming',
  'joseon:japan', 'joseon:ming', 'japan:ming',
].map((p) => p.split(':').map((f) => MIX[f].split('+')).concat([p]));
const KINDS = [
  'racegalleon:spgalleon', 'racegalleon:galleass', 'pinnace:galleass', 'racegalleon:panokseon', 'racegalleon:atakebune',
  'racegalleon:mingship', 'spgalleon:panokseon', 'spgalleon:atakebune', 'galleass:atakebune', 'pinnace:sekibune', 'spgalleon:geobukseon',
].map((p) => p.split(':').map((s) => s.split('+')).concat([p]));
const custom = flag('pair', null)?.split(',').map((p) => p.split(':').map((s) => (MIX[s] ?? s).split('+')).concat([p]));
const pairs = custom ?? (args.includes('--kinds') ? [...GATE, ...KINDS] : GATE);

/** Real-valued ship counts for a mix: the budget split evenly by points between its kinds. */
function muster(kinds) {
  const share = budget / kinds.length;
  return kinds.map((k) => ({ kind: k, n: share / points.shipPoints(k) }));
}

function spawn(b, team, kinds, x0, heading) {
  const sq = b.addSquadron(team, team, '', '', '', team === 'joseon' ? 0 : 1);
  const list = [];
  for (const { kind, n } of muster(kinds)) {
    const whole = Math.floor(n + 1e-9);
    for (let i = 0; i < whole; i += 1) list.push({ kind, part: 1 });
    if (n - whole > 0.1) list.push({ kind, part: n - whole });
  }
  list.forEach((u, i) => {
    const row = i % 6, col = Math.floor(i / 6);
    const s = b.addShip(u.kind, x0 - Math.sign(x0) * col * 140, (row - 2.5) * 120, heading, '', sq, i === 0, 0);
    s.order = { type: 'auto' };
    if (u.part < 1) {
      s.hull *= u.part;
      s.crew = Math.max(1, Math.round(s.crew * u.part));
    }
  });
}

const value = (b, team) => b.ships.filter((s) => s.team === team && s.alive && !s.struck).reduce((a, s) => a + points.shipPoints(s.spec.kind) * (s.hull / s.spec.hull), 0);

function fight(a, z, seed, swap) {
  const b = new Battle(seed, COMPETITIVE_PROFILE);
  b.windDrift = 0;
  b.humans.clear();
  const [west, east] = swap ? [z, a] : [a, z];
  spawn(b, 'joseon', west, -600, 0);
  spawn(b, 'japan', east, 600, Math.PI);
  b.initial.joseon = b.ships.filter((s) => s.team === 'joseon').length;
  b.initial.japan = b.ships.length - b.initial.joseon;
  const start = { joseon: value(b, 'joseon'), japan: value(b, 'japan') };
  const steps = Math.round((minutes * 60) / SIM_DT);
  for (let i = 0; i < steps && !b.ended; i += 1) {
    b.step(SIM_DT);
    if (i % 300 === 0 && (value(b, 'joseon') < 1 || value(b, 'japan') < 1)) break;
  }
  const left = { joseon: value(b, 'joseon') / start.joseon, japan: value(b, 'japan') / start.japan };
  // Score for the first fleet of the pairing: 1 a win, 0 a loss, by the share of points afloat.
  const mine = swap ? left.japan : left.joseon;
  const theirs = swap ? left.joseon : left.japan;
  return { win: mine > theirs ? 1 : mine < theirs ? 0 : 0.5, margin: mine - theirs };
}

function play(pair) {
  const [a, z] = pair;
  let wins = 0, margin = 0, n = 0;
  for (let s = 0; s < seeds; s += 1) for (const swap of [false, true]) {
    const r = fight(a, z, 1588 + s * 7919, swap);
    if (args.includes("--verbose")) console.log(`  seed ${s} ${swap ? "east" : "west"}: ${r.margin.toFixed(2)}`);
    wins += r.win;
    margin += r.margin;
    n += 1;
  }
  return { rate: (wins / n) * 100, margin: margin / n };
}

const md = [];
function table() {
  const rows = [];
  for (const pair of pairs) {
    const r = play(pair);
    if (args.includes('--md')) { md.push(`| ${pair[2].replace(':', ' 대 ')} | ${r.rate.toFixed(0)}% | ${r.margin >= 0 ? '+' : ''}${r.margin.toFixed(2)} |`); }
    rows.push({ pair, ...r });
    console.log(`${pair[2].padEnd(28)} ${r.rate.toFixed(0).padStart(4)}%  margin ${r.margin >= 0 ? '+' : ''}${r.margin.toFixed(2)}`);
  }
  return rows;
}

if (fit) {
  // Only the kinds outside the anchors move. A fleet that wins by a margin m buys, by Lanchester's square law, about
  // sqrt(1 + m) times the strength it needs, so its price rises by that factor (damped).
  const FITTED = (await load('/src/sim/points.ts'));
  const prices = {};
  for (let r = 0; r < rounds; r += 1) {
    console.log(`-- round ${r + 1}`);
    const rows = table();
    const push = {};
    for (const { pair, margin } of rows) {
      const sides = [[pair[0], margin], [pair[1], -margin]];
      for (const [kinds, m] of sides) for (const k of new Set(kinds)) if (!ANCHORS.has(k)) (push[k] ??= []).push(m);
    }
    for (const [k, ms] of Object.entries(push)) {
      const m = ms.reduce((a, x) => a + x, 0) / ms.length;
      const p = FITTED.shipPoints(k);
      prices[k] = Math.round((p * Math.sqrt(Math.max(0.3, 1 + m * 0.8))) / 5) * 5;
    }
    FITTED.overridePoints(prices);
    console.log('points:', JSON.stringify(prices));
  }
} else {
  const rows = table();
  if (args.includes('--check')) {
    const bad = rows.filter((r) => Math.abs(r.rate - 50) > tol);
    if (bad.length) {
      console.error(`${bad.length} pairing(s) outside 50 +/- ${tol}%`);
      await server.close();
      process.exit(1);
    }
    console.log(`all pairings within 50 +/- ${tol}%`);
  }
}
if (md.length) console.log(['| 대진 | 승률 | 점수 차 |', '|---|---|---|', ...md].join('\n'));
await server.close();
