// WebSocket-only check of the multiplayer server (no browser): a conquest duel, a historical duel, quick match
// (paired and filled by the computer), reconnect within the grace period, and a rejected old protocol.
//   npm run server:build && PORT=8791 node server/dist/server.cjs     (add BASE_SPEED=20 to see a battle end)
//   node scripts/mp-smoke.mjs [ws://127.0.0.1:8791/ws] [--skip-fill]
//   BASE_SPEED=30 server, then: node scripts/mp-smoke.mjs --rematch    (battle end, rematch in a room and in a quick room)
import { readFileSync } from 'node:fs';
import WebSocket from 'ws';

const url = process.argv.find((a) => a.startsWith('ws://')) ?? 'ws://127.0.0.1:8791/ws';
const skipFill = process.argv.includes('--skip-fill');
const PROTOCOL = Number(/export const PROTOCOL = (\d+)/.exec(readFileSync(new URL('../src/net/protocol.ts', import.meta.url), 'utf8'))?.[1]);
if (!PROTOCOL) throw new Error('PROTOCOL not found in src/net/protocol.ts');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (ok, label, extra = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${extra ? ` ${extra}` : ''}`);
  if (!ok) failures += 1;
};

class Player {
  constructor(name) {
    this.name = name;
    this.snaps = 0;
    this.last = {};
    this.msgs = [];
    this.token = null;
    this.waiters = [];
  }
  connect(token) {
    this.ws = new WebSocket(url);
    this.ws.on('open', () => this.send({ t: 'hello', name: this.name, v: PROTOCOL, token }));
    this.ws.on('message', (d, bin) => {
      if (bin) {
        this.snaps += 1;
        this.ships = new DataView(d.buffer, d.byteOffset, d.byteLength).getUint16(2, true);
        return;
      }
      const m = JSON.parse(String(d));
      this.msgs.push(m);
      this.last[m.t] = m;
      if (m.t === 'welcome') this.token = m.token;
      this.waiters = this.waiters.filter((w) => !w(m));
    });
    return new Promise((resolve) => this.once((m) => m.t === 'welcome' && resolve(m)));
  }
  send(m) {
    this.ws.send(JSON.stringify(m));
  }
  /** Resolves with the first matching message from now on, or null after `ms`. */
  once(test, ms = 15000) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), ms);
      this.waiters.push((m) => {
        if (!test(m)) return false;
        clearTimeout(timer);
        resolve(m);
        return true;
      });
    });
  }
  count(t) {
    return this.msgs.filter((m) => m.t === t).length;
  }
}

async function duel(label, battle, factions = {}) {
  const a = new Player(`${label}-갑`);
  const b = new Player(`${label}-을`);
  await a.connect();
  await b.connect();
  a.send({ t: 'create', name: label, battle });
  const room = await a.once((m) => m.t === 'room' && m.room);
  check(!!room, `${label}: room created`, room?.room.id);
  b.send({ t: 'join', room: room.room.id });
  await b.once((m) => m.t === 'room' && m.room?.seats[1].client);
  if (factions.b) b.send({ t: 'seat', index: 1, faction: factions.b });
  b.send({ t: 'ready', ready: true });
  await a.once((m) => m.t === 'room' && m.room?.seats[1].ready);
  const startA = a.once((m) => m.t === 'start', 60000);
  const startB = b.once((m) => m.t === 'start', 60000);
  const t0 = Date.now();
  a.send({ t: 'start' });
  const [sa, sb] = await Promise.all([startA, startB]);
  check(!!sa && !!sb, `${label}: both started`, `${Date.now() - t0} ms`);
  check(sa?.you === 0 && sb?.you === 1, `${label}: seats 0 and 1`);
  check(sa?.battle.kind === battle.kind, `${label}: battle kind ${sa?.battle.kind}`);
  await sleep(1200);
  check(a.snaps === 0 && a.last.speed?.target === 0, `${label}: clock held while pages load`);
  a.send({ t: 'loaded' });
  b.send({ t: 'loaded' });
  await sleep(1500);
  check(a.snaps > 5 && b.snaps > 5, `${label}: snapshots flow`, `${a.snaps}/${b.snaps}, ${a.ships} ships`);
  check((a.last.speed?.target ?? 1) > 1, `${label}: approach fast-forward`, `target ${a.last.speed?.target}`);
  const ids = [...Array(20).keys()].map((i) => i + 1);
  b.send({ t: 'cmd', cmd: { type: 'order', ids, order: { type: 'move', x: 0, z: 0 } } });
  return { a, b, room: room.room };
}

async function reconnect({ b, room }) {
  const token = b.token;
  b.ws.terminate();
  await sleep(500);
  const again = new Player(b.name);
  const welcome = await again.connect(token);
  check(welcome.resumed === true && welcome.id === b.last.welcome.id, 'reconnect: session resumed');
  const start = await again.once((m) => m.t === 'start', 5000);
  again.send({ t: 'loaded' });
  check(start?.resume === true && start.you === 1, 'reconnect: battle start resent with resume', `you ${start?.you}`);
  await again.once((m) => m.t === 'meta', 3000);
  const before = again.snaps;
  await sleep(1000);
  check(again.snaps > before, 'reconnect: snapshots again');
  check(again.msgs.some((m) => m.t === 'room' && m.room?.id === room.id && !m.room.seats[1].away), 'reconnect: seat is back');
  again.ws.close();
  return again;
}

async function quickPair() {
  const c = new Player('빠른-갑');
  const d = new Player('빠른-을');
  await c.connect();
  await d.connect();
  const choice = { kind: 'scenario', id: 'okpo' };
  c.send({ t: 'quick', battle: choice, faction: 'joseon' });
  const searching = await c.once((m) => m.t === 'quick' && m.state === 'searching', 3000);
  check(!!searching, 'quick: searching', `${searching?.seconds}s`);
  // A second Joseon player is not a match; a Japanese one is.
  const e = new Player('빠른-병');
  await e.connect();
  e.send({ t: 'quick', battle: choice, faction: 'joseon' });
  await sleep(500);
  check(!c.last.start && !e.last.start, 'quick: same side does not pair');
  e.send({ t: 'quickCancel' });
  const startC = c.once((m) => m.t === 'start', 30000);
  const startD = d.once((m) => m.t === 'start', 30000);
  d.send({ t: 'quick', battle: choice, faction: 'japan' });
  const [sc, sd] = await Promise.all([startC, startD]);
  check(!!sc && !!sd && sc.you === 0 && sd.you === 1, 'quick: two players paired and started', `seats ${sc?.you}/${sd?.you}`);
  check(sc?.seats.every((s) => s.human), 'quick: both seats human');
  for (const p of [c, d, e]) p.ws.close();
}

async function quickFill() {
  const f = new Player('빠른-홀로');
  await f.connect();
  const t0 = Date.now();
  f.send({ t: 'quick', battle: { kind: 'conquest', map: 'hallyeo', size: 2 }, faction: 'japan' });
  const s = await f.once((m) => m.t === 'start', 40000);
  const waited = (Date.now() - t0) / 1000;
  check(!!s && waited >= 19 && waited < 30, 'quick: computer fills after ~20 s', `${waited.toFixed(1)}s`);
  check(s?.you === 1 && s.seats[0].human === false && s.seats[1].human === true, 'quick: human on the Japanese seat, computer opposite', JSON.stringify(s?.seats.map((x) => [x.faction, x.human])));
  f.ws.close();
}

async function oldProtocol() {
  const ws = new WebSocket(url);
  const got = await new Promise((resolve) => {
    ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', name: 'old', v: 1 })));
    ws.on('message', (d) => resolve(JSON.parse(String(d))));
    setTimeout(() => resolve(null), 3000);
  });
  check(got?.t === 'error' && got.code === 'version', 'old protocol is told to refresh');
  ws.close();
}

/** Needs a server started with BASE_SPEED=30: an idle Japanese fleet at Okpo is wiped out in seconds, then both rematch paths run. */
async function rematch() {
  const h = new Player('재대결');
  await h.connect();
  h.send({ t: 'create', name: 'rematch', battle: { kind: 'scenario', id: 'okpo' } });
  await h.once((m) => m.t === 'room' && m.room);
  h.send({ t: 'take', index: 1 });
  await h.once((m) => m.t === 'room' && m.room?.seats[1].client);
  h.send({ t: 'start' });
  await h.once((m) => m.t === 'start', 20000);
  h.send({ t: 'loaded' });
  const end = await h.once((m) => m.t === 'end', 120000);
  check(!!end, 'rematch: battle ended', `winner ${end?.winner}`);
  h.send({ t: 'rematch' });
  const lobby = await h.once((m) => m.t === 'room' && m.room?.state === 'lobby', 5000);
  check(!!lobby && lobby.room.seats.every((s) => !s.rematch && !s.ready), 'rematch: room is back in the lobby');
  h.send({ t: 'leave' });
  // A quick-match room restarts at once.
  const q = new Player('재대결-빠른');
  await q.connect();
  q.send({ t: 'quick', battle: { kind: 'scenario', id: 'okpo' }, faction: 'japan' });
  await q.once((m) => m.t === 'start', 40000);
  q.send({ t: 'loaded' });
  await q.once((m) => m.t === 'end', 120000);
  q.send({ t: 'rematch' });
  const again = await q.once((m) => m.t === 'start', 5000);
  check(!!again && !again.resume, 'rematch: quick room starts again at once');
  h.ws.close();
  q.ws.close();
}

const health = await fetch(url.replace(/^ws/, 'http').replace(/\/ws$/, '/health')).then((r) => r.json());
check(health.protocol === PROTOCOL, `server speaks protocol ${PROTOCOL}`, JSON.stringify(health));
await oldProtocol();
if (process.argv.includes('--rematch')) {
  await rematch();
  console.log(failures ? `${failures} FAILED` : 'all passed');
  process.exit(failures ? 1 : 0);
}
const fill = skipFill ? null : quickFill();
const conquest = await duel('쟁탈', { kind: 'conquest', map: 'hallyeo', size: 2 }, { b: 'ming' });
const hansan = await duel('한산도', { kind: 'scenario', id: 'hansan' });
await reconnect(hansan);
await quickPair();
await fill;
const after = await fetch(url.replace(/^ws/, 'http').replace(/\/ws$/, '/health')).then((r) => r.json());
console.log('health', JSON.stringify(after));
for (const p of [conquest.a, conquest.b, hansan.a, hansan.b]) p.ws.close();
await sleep(300);
console.log(failures ? `${failures} FAILED` : 'all passed');
process.exit(failures ? 1 : 0);
