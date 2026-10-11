// Durable rating/identity and real local WebSocket lifecycle regression. Never uses the production store.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { appendFileSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import WebSocket from 'ws';

const root = fileURLToPath(new URL('..', import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), 'imjin-ranked-regression-'));
const protocol = Number(/export const PROTOCOL = (\d+)/.exec(readFileSync(new URL('../src/net/protocol.ts', import.meta.url), 'utf8'))?.[1]);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sockets = [];
let child;
let store;
let healthUrl;
let wsUrl;
let serverErrors = '';
const run = (script, args = []) => new Promise((resolve, reject) => {
  const process = spawn(globalThis.process.execPath, [script, ...args], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  process.stdout.on('data', (data) => output += data);
  process.stderr.on('data', (data) => output += data);
  process.once('error', reject);
  process.once('exit', (code) => resolve({ code, output }));
});
async function stop() {
  if (child && child.exitCode === null) { child.kill(); await once(child, 'exit'); }
  child = null;
  for (const ws of sockets.splice(0)) ws.terminate();
}
async function start(path) {
  serverErrors = '';
  child = spawn(process.execPath, ['server/dist/server.cjs'], { cwd: root, env: { ...process.env, PORT: '0', FF_SPEED: '1', GRACE_SECONDS: '1.2', LOAD_SECONDS: '0.7', RANKED_STORE: path }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stderr.on('data', (data) => serverErrors += data);
  const port = await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`server startup timeout: ${serverErrors}`)), 15000);
    child.once('error', reject);
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`server exited ${code}: ${serverErrors}`)); });
    child.stdout.on('data', (data) => { output += data; const match = /imjin server on :(\d+)/.exec(output); if (match) { clearTimeout(timer); resolve(Number(match[1])); } });
  });
  healthUrl = `http://127.0.0.1:${port}/health`;
  wsUrl = `ws://127.0.0.1:${port}/ws`;
}
const health = async () => {
  assert.equal(child.exitCode, null, serverErrors);
  const response = await fetch(healthUrl, { signal: AbortSignal.timeout(3000) });
  assert.equal(response.status, 200);
  return response.json();
};
async function connect(name, credential, session, rejection = false) {
  const ws = new WebSocket(wsUrl);
  sockets.push(ws);
  ws.on('error', () => {});
  const inbox = [], waiters = [];
  let snapshots = 0;
  let firstSnapshotShips = null;
  ws.on('message', (data, binary) => {
    if (binary) { snapshots++; firstSnapshotShips ??= data.readUInt16LE(2); return; }
    const msg = JSON.parse(String(data));
    const index = waiters.findIndex((waiter) => waiter.test(msg));
    if (index < 0) inbox.push(msg); else waiters.splice(index, 1)[0].resolve(msg);
  });
  const next = (test, timeout = 15000) => {
    const index = inbox.findIndex(test);
    if (index >= 0) return Promise.resolve(inbox.splice(index, 1)[0]);
    return new Promise((resolve, reject) => {
      const waiter = { test, resolve: (msg) => { clearTimeout(timer); resolve(msg); } };
      const timer = setTimeout(() => { const i = waiters.indexOf(waiter); if (i >= 0) waiters.splice(i, 1); reject(new Error(`message timeout: ${test}`)); }, timeout);
      waiters.push(waiter);
    });
  };
  const send = (msg) => ws.send(JSON.stringify(msg));
  await once(ws, 'open');
  send({ t: 'hello', name, v: protocol, account: credential, token: session });
  const welcome = await next((msg) => msg.t === (rejection ? 'error' : 'welcome'));
  return { ws, next, send, welcome, id: welcome.id, get snapshots() { return snapshots; }, get firstSnapshotShips() { return firstSnapshotShips; }, clear(type) { for (let i = inbox.length - 1; i >= 0; i--) if (inbox[i].t === type) inbox.splice(i, 1); } };
}
async function pair(a, b) {
  a.send({ t: 'ranked', faction: 'ming' });
  b.send({ t: 'ranked', faction: 'joseon' });
  const [sa, sb] = await Promise.all([a.next((m) => m.t === 'start', 60000), b.next((m) => m.t === 'start', 60000)]);
  assert.equal(sa.ranked, true); assert.equal(sb.ranked, true); assert.equal(sa.matchId, sb.matchId);
  assert.equal(sa.seed, sb.seed); assert.notEqual(sa.you, sb.you);
  assert.deepEqual(sa.battle, { kind: 'conquest', map: 'hallyeo', size: 2 });
  assert.deepEqual(sa.seats.map((s) => s.faction).sort(), ['joseon', 'ming']);
  assert(sa.seats.every((s) => s.human));
  return sa;
}
const leave = async (player) => { player.send({ t: 'leave' }); await player.next((m) => m.t === 'room' && m.room === null); };

try {
  const bundle = join(temporary, 'ranked.mjs');
  await build({ entryPoints: [join(root, 'server/ranked.ts')], outfile: bundle, platform: 'node', format: 'esm', bundle: true, logLevel: 'silent' });
  const { RankedStore, rankRange } = await import(pathToFileURL(bundle).href);
  const fixture = join(temporary, 'unit.jsonl');
  store = new RankedStore(fixture);
  const a = store.account(undefined, '갑'), b = store.account(undefined, '을');
  assert.match(a.token, /^[a-f0-9]{64}$/);
  assert.equal(store.account(a.token, '새 이름').id, a.id);
  assert.throws(() => store.account('f'.repeat(64), '도용'), /unknown account/);
  assert.throws(() => store.account(a.id, '도용'), /invalid account/);
  assert.throws(() => new RankedStore(fixture), /live writer/);
  assert(!readFileSync(fixture, 'utf8').includes(a.token));
  let now = Date.now();
  const participants = [{ id: a.id, faction: 'ming' }, { id: b.id, faction: 'japan' }];
  const match = store.begin(participants, now, 'a'.repeat(40));
  assert.throws(() => store.begin([{ id: a.id, faction: 'ming' }, { id: a.id, faction: 'ming' }]), /cannot enter/);
  const result = store.finish(match.id, 0, 'battle', now);
  assert.equal(result[0].delta, 20); assert.equal(result[1].delta, -20);
  assert.equal(store.finish(match.id, 1, 'battle', now), null);
  assert.equal(store.profile(a.id).rating + store.profile(b.id).rating, 2000);
  assert.equal(store.profile(a.id).games, 1);
  store.finish(store.begin(participants, now).id, 'draw', 'battle', now);
  store.finish(store.begin(participants, now).id, 1, 'forfeit', now);
  assert.equal(store.canPair(a.id, b.id, now), false);
  assert.throws(() => store.begin(participants, now), /cannot enter/);
  assert.equal(store.canPair(a.id, b.id, now + 3600001), true);
  for (let i = 0; i < 10; i++) {
    now += 3600001;
    store.finish(store.begin(participants, now).id, 'draw', 'battle', now);
  }
  assert.equal(store.profile(a.id).placementLeft, 0);
  assert.notEqual(store.profile(a.id).tier, 'provisional');
  assert.equal(store.profile(a.id).rating + store.profile(b.id).rating, 2000);
  now += 3600001;
  const unfinished = store.begin(participants, now);
  const beforeRestart = store.profile(a.id).rating;
  store.close();
  appendFileSync(fixture, '{"v":1,');
  store = new RankedStore(fixture);
  assert.equal(store.profile(a.id).rating, beforeRestart);
  assert.equal(store.result(unfinished.id, a.id).reason, 'restart');
  assert.equal(store.result(unfinished.id, a.id).delta, 0);
  assert.equal(store.account(a.token, '새 이름').id, a.id);
  assert.equal(store.activeMatch(a.id), undefined);
  assert.equal(store.result(match.id, a.id).delta, 20);
  assert.equal(rankRange(0), 100); assert.equal(rankRange(20000), 150); assert.equal(rankRange(999999), 500);
  for (let i = 0; i < 52; i++) {
    now += 3600001;
    const other = store.account(undefined, `장수${i}`);
    store.finish(store.begin([{ id: other.id, faction: 'joseon' }, { id: b.id, faction: 'ming' }], now).id, 0, 'battle', now);
  }
  const leaders = store.leaderboard();
  assert.equal(leaders.length, 50);
  assert(leaders.every((p) => !('token' in p) && !('hash' in p) && !('recent' in p)));
  assert(store.profile(b.id).recent.length <= 20);
  assert.equal(store.result(match.id, b.id).delta, -20); // Exact receipts survive the recent-history cap.
  store.close(); store = null;
  const report = await run('scripts/report-ranked.mjs', [`--file=${fixture}`]);
  assert.equal(report.code, 0, report.output);
  const aggregate = JSON.parse(report.output);
  const events = readFileSync(fixture, 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(aggregate.matchups.reduce((n, g) => n + g.games, 0), events.filter((e) => e.t === 'finish' && e.reason === 'battle').length);
  assert.equal(aggregate.reasons.forfeit, 1); assert.equal(aggregate.reasons.restart, 1);
  assert(!report.output.includes(a.token)); assert(!report.output.includes(events.find((e) => e.t === 'account').hash));
  appendFileSync(fixture, 'malformed committed record\n');
  const corrupt = readFileSync(fixture);
  assert.throws(() => new RankedStore(fixture), /unavailable/);
  assert.deepEqual(readFileSync(fixture), corrupt);
  console.log('ok: hashed identities, conserved Elo, placements, duplicate results, pair limit, public leaderboard, torn-tail recovery and restart void persist');
  console.log('ok: aggregate balance report excludes forfeits/restarts and exposes no credentials');

  const built = await run('scripts/build-server.mjs');
  assert.equal(built.code, 0, built.output);
  const journal = join(temporary, 'server.jsonl');
  await start(journal);
  assert.equal((await health()).rankedReady, true);
  let host = await connect('랭크 갑'), guest = await connect('랭크 을');
  const hostCredential = host.welcome.account.token, guestCredential = guest.welcome.account.token;
  const hostAccount = host.welcome.account.id;
  const initialAccountCount = readFileSync(journal, 'utf8').split('\n').filter((line) => line && JSON.parse(line).t === 'account').length;
  const rejected = await connect('랭크 갑', 'f'.repeat(64), undefined, true);
  assert.equal(rejected.welcome.code, 'identity');
  assert.equal(readFileSync(journal, 'utf8').split('\n').filter((line) => line && JSON.parse(line).t === 'account').length, initialAccountCount);
  host.send({ t: 'hello', name: '도용', v: protocol, account: guestCredential });
  assert.equal((await host.next((m) => m.t === 'error')).code, 'identity');
  host.send({ t: 'rankedProfile' });
  assert.equal((await host.next((m) => m.t === 'rank')).profile.id, hostAccount);
  host.send({ t: 'ranked', faction: 'ming' });
  const otherTab = await connect('랭크 갑', hostCredential);
  otherTab.send({ t: 'ranked', faction: 'japan' });
  assert.equal((await otherTab.next((m) => m.t === 'error')).code, 'ranked');
  assert.equal((await health()).rankedQueue, 1);
  host.send({ t: 'rankedCancel' });
  await host.next((m) => m.t === 'ranked' && m.state === 'idle');
  otherTab.ws.terminate();
  console.log('ok: unknown credential cannot create an account; name/account switching and duplicate-account queues are rejected');

  let started = await pair(host, guest);
  host.send({ t: 'rankedCancel' });
  assert.equal((await host.next((m) => m.t === 'error')).code, 'ranked');
  assert.equal((await health()).battles, 1);
  host.send({ t: 'loaded' }); guest.send({ t: 'loaded' });
  const snapshotDeadline = Date.now() + 3000;
  while ((!host.snapshots || !guest.snapshots) && Date.now() < snapshotDeadline) await sleep(50);
  assert(host.snapshots > 0 && guest.snapshots > 0);
  const privateState = (await host.next((m) => m.t === 'state')).conquest;
  assert.ok(privateState.players[started.you].funds > 0);
  assert.equal(privateState.players[1 - started.you].funds, 0, 'The real WebSocket stream redacts the opposing treasury.');
  assert.equal(privateState.players[1 - started.you].income, 0);
  host.send({ t: 'rankedResult', matchId: started.matchId, result: 'win', after: 99999 });
  host.send({ t: 'rankedProfile' });
  assert.equal((await host.next((m) => m.t === 'rank')).profile.games, 0);
  const session = host.welcome.token;
  host.ws.terminate();
  await sleep(50);
  await leave(guest); // Offline host wins because the opponent explicitly forfeited.
  const guestLoss = await guest.next((m) => m.t === 'rankedResult');
  assert.equal(guestLoss.reason, 'forfeit'); assert.equal(guestLoss.result, 'loss');
  host = await connect('랭크 갑', hostCredential, session);
  assert.equal(host.welcome.resumed, true);
  const missed = await host.next((m) => m.t === 'rankedResult');
  assert.equal(missed.matchId, started.matchId); assert.equal(missed.reason, 'forfeit'); assert.equal(missed.delta, 20);
  assert.equal(missed.before, 1000); assert.equal(missed.after, 1020); assert.equal(missed.profile.games, 1);
  assert.equal(host.welcome.rank.games, 1);
  await leave(host);
  console.log('ok: all-faction human-only ranked snapshots work; client-forged results cannot score; missed committed results replay after reconnect without extra Elo');

  started = await pair(host, guest);
  const beforeGraceSnapshots = host.snapshots;
  host.send({ t: 'loaded' }); guest.send({ t: 'loaded' });
  // terminate() can discard a pending loaded frame. Wait until the server has actually started this match.
  const graceStartedDeadline = Date.now() + 3000;
  while (host.snapshots <= beforeGraceSnapshots && Date.now() < graceStartedDeadline) await sleep(25);
  assert(host.snapshots > beforeGraceSnapshots, 'both loading acknowledgements must precede the disconnect');
  const guestSession = guest.welcome.token;
  guest.ws.terminate();
  const graceWin = await host.next((m) => m.t === 'rankedResult');
  assert.equal(graceWin.matchId, started.matchId); assert.equal(graceWin.reason, 'disconnect'); assert.equal(graceWin.result, 'win');
  guest = await connect('랭크 을', guestCredential, guestSession);
  assert.equal(guest.welcome.resumed, false);
  assert.equal(guest.welcome.rank.games, 2);
  await leave(host);
  console.log('ok: disconnected seats keep the reconnect grace; expiry scores one forfeit and releases the old session');

  started = await pair(host, guest);
  host.send({ t: 'loaded' }); // The guest never acknowledges loading: no ranking gain or loss.
  const [voidA, voidB] = await Promise.all([host.next((m) => m.t === 'rankedResult'), guest.next((m) => m.t === 'rankedResult')]);
  for (const r of [voidA, voidB]) { assert.equal(r.matchId, started.matchId); assert.equal(r.reason, 'load-timeout'); assert.equal(r.result, 'void'); assert.equal(r.delta, 0); assert.equal(r.profile.games, 2); }
  await leave(host); await leave(guest);
  console.log('ok: incomplete loading voids the human match without counting a game or changing ratings');

  started = await pair(host, guest);
  host.send({ t: 'loaded' }); guest.send({ t: 'loaded' });
  await stop();
  await start(journal);
  host = await connect('랭크 갑', hostCredential);
  guest = await connect('랭크 을', guestCredential);
  assert.equal(host.welcome.rank.games, 2);
  assert.equal(host.welcome.rank.recent[0].matchId, started.matchId);
  assert.equal(host.welcome.rank.recent[0].reason, 'restart');
  assert.equal(host.welcome.rank.recent[0].delta, 0);
  console.log('ok: a real server restart preserves identities/ratings and voids the unfinished match');

  host.send({ t: 'create', name: '비랭크', battle: { kind: 'conquest', map: 'hallyeo', size: 2 }, ranked: true });
  const custom = await host.next((m) => m.t === 'room' && m.room?.state === 'lobby');
  assert.notEqual(custom.room.ranked, true);
  host.send({ t: 'start' });
  const aiStart = await host.next((m) => m.t === 'start', 60000);
  assert.notEqual(aiStart.ranked, true); assert.equal(aiStart.seats.filter((s) => s.human).length, 1);
  host.send({ t: 'loaded' }); await leave(host);
  host.send({ t: 'create', name: '역사', battle: { kind: 'scenario', id: 'okpo' } });
  await host.next((m) => m.t === 'room' && m.room?.state === 'lobby');
  host.send({ t: 'start' });
  assert.notEqual((await host.next((m) => m.t === 'start', 60000)).ranked, true);
  await leave(host);
  host.send({ t: 'rankedProfile' });
  assert.equal((await host.next((m) => m.t === 'rank')).profile.games, 2);
  console.log('ok: custom, AI and historical matches cannot register ranking results');

  const committed = readFileSync(journal, 'utf8').trim().split('\n').map(JSON.parse);
  assert(committed.filter((e) => e.t === 'begin').every((e) => e.balanceProfile === 'competitive-v1' && /^[a-f0-9]{40}$/.test(e.revision) && Number.isSafeInteger(e.seed)));
  assert.equal(committed.filter((e) => e.t === 'finish').length, 4);
  assert(!readFileSync(journal, 'utf8').includes(hostCredential));
  await stop();
  appendFileSync(journal, 'invalid committed record\n');
  const corruptServerJournal = readFileSync(journal);
  await start(journal);
  assert.equal((await health()).rankedReady, false);
  const casual = await connect('비랭크 이용자', hostCredential);
  assert.equal(casual.welcome.account, null); assert.equal(casual.welcome.rank, null);
  casual.send({ t: 'ranked', faction: 'ming' });
  assert.equal((await casual.next((m) => m.t === 'error')).code, 'ranked');
  casual.send({ t: 'create', name: '사용 가능', battle: { kind: 'conquest', map: 'hallyeo', size: 2 } });
  await casual.next((m) => m.t === 'room' && m.room?.state === 'lobby');
  assert.deepEqual(readFileSync(journal), corruptServerJournal);
  console.log('ok: corrupted committed storage disables only ranked play and never resets the journal');
  console.log('ranked regression passed');
} finally {
  store?.close();
  await stop();
  if (!temporary.startsWith(join(tmpdir(), 'imjin-ranked-regression-'))) throw new Error('unexpected temporary directory');
  await rm(temporary, { recursive: true, force: true });
}
