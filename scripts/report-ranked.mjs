// Read a COPY of the private server journal. Only aggregate battle outcomes leave this script.
// node scripts/report-ranked.mjs --file=<ranked.jsonl> [--out=<summary.json>]
import { readFileSync, writeFileSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [key, ...value] = arg.replace(/^--/, '').split('=');
  return [key, value.join('=')];
}));
if (!args.file) throw new Error('Supply --file with a copy of the private ranked journal');
const bytes = readFileSync(args.file);
const end = bytes.length ? bytes.lastIndexOf(10) + 1 : 0;
const starts = new Map();
const finished = new Set();
const groups = new Map();
const reasons = {};
let completed = 0;
for (const line of bytes.subarray(0, end).toString('utf8').split('\n').filter(Boolean)) {
  const event = JSON.parse(line);
  if (event.t === 'begin') starts.set(event.id, event);
  if (event.t !== 'finish') continue;
  if (finished.has(event.id)) throw new Error('Duplicate committed match result');
  finished.add(event.id);
  const match = starts.get(event.id);
  if (!match || match.players.length !== 2) throw new Error('Result without a valid match');
  reasons[event.reason] = (reasons[event.reason] ?? 0) + 1;
  completed++;
  // Network reliability, deliberate resignations, and unfinished loads are separate from combat balance.
  if (event.reason !== 'battle' || event.outcome === 'void') continue;
  const pair = match.players.map((p) => p.faction).sort();
  const version = match.balanceProfile ?? 'unrecorded';
  const key = `${version}/${match.map}/${pair.join(':')}`;
  const group = groups.get(key) ?? { balanceProfile: version, map: match.map, factions: pair, games: 0, draws: 0, firstFactionWins: 0, westWins: 0, westGames: 0 };
  group.games++;
  if (event.outcome === 'draw') group.draws++;
  else {
    if (event.outcome !== 0 && event.outcome !== 1) throw new Error('Invalid battle outcome');
    if (match.players[event.outcome].faction === pair[0]) group.firstFactionWins++;
    group.westGames++;
    if (event.outcome === 0) group.westWins++;
  }
  groups.set(key, group);
}
// Wilson intervals make small cohorts visible; they are descriptive and do not adjust for player skill.
function interval(wins, n) {
  if (!n) return null;
  const z = 1.95996398454, p = wins / n, denominator = 1 + z * z / n;
  const center = (p + z * z / (2 * n)) / denominator;
  const margin = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denominator;
  return [center - margin, center + margin].map((v) => Math.round(v * 10000) / 10000);
}
const report = {
  source: 'completed human ranked matches',
  completed,
  reasons,
  incompleteFinalBytes: bytes.length - end,
  note: 'Battle-only estimates; player skill, faction selection and map familiarity remain confounders. Mirror pairs measure side bias only.',
  matchups: [...groups.values()].map((g) => {
    const decisive = g.games - g.draws, mirror = g.factions[0] === g.factions[1];
    return { ...g, firstFactionWinRate: !mirror && decisive ? g.firstFactionWins / decisive : null, firstFaction95: mirror ? null : interval(g.firstFactionWins, decisive), westWinRate: g.westGames ? g.westWins / g.westGames : null, west95: interval(g.westWins, g.westGames) };
  }),
};
const output = JSON.stringify(report, null, 2) + '\n';
if (args.out) writeFileSync(args.out, output);
else process.stdout.write(output);
