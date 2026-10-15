// Exercise the actual client network modules without a renderer or an external server.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const storage = () => {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: (key) => values.delete(key) };
};
const sockets = [];
class Socket {
  static OPEN = 1;
  readyState = 0;
  messages = [];
  constructor(url) { this.url = url; sockets.push(this); }
  send(text) { this.messages.push(JSON.parse(text)); }
  open() { this.readyState = 1; this.onopen?.(); }
  receive(msg) { this.onmessage?.({ data: JSON.stringify(msg) }); }
  close() { this.readyState = 3; this.onclose?.({ code: 1000 }); }
}
const fixture = {
  location: new URL('http://127.0.0.1/'),
  localStorage: storage(),
  sessionStorage: storage(),
  WebSocket: Socket,
  window: { setTimeout, clearTimeout, setInterval, clearInterval },
};
const saved = new Map(Object.keys(fixture).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
for (const [key, value] of Object.entries(fixture)) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
const vite = await createServer({
  root: fileURLToPath(new URL('..', import.meta.url)),
  server: { middlewareMode: true, hmr: false },
  appType: 'custom',
  logLevel: 'error',
});

try {
  const { NetBattle } = await vite.ssrLoadModule('/src/net/NetBattle.ts');
  const { Battle } = await vite.ssrLoadModule('/src/sim/battle.ts');
  const { PROTOCOL, SENT_EVENTS, encodeSnapshot, decodeSnapshot } = await vite.ssrLoadModule('/src/net/protocol.ts');
  const { net, useNet } = await vite.ssrLoadModule('/src/net/NetClient.ts');

  net.connect('Navigator');
  const socket = sockets.at(-1);
  socket.open();
  assert.deepEqual(socket.messages.at(-1), { t: 'hello', name: 'Navigator', v: PROTOCOL });
  const credential = 'ab'.repeat(32);
  const profile = { id: 'public-1', name: 'Navigator', rating: 1000, wins: 0, losses: 0, draws: 0, games: 0, placementLeft: 10, tier: 'provisional', recent: [] };
  socket.receive({ t: 'welcome', id: 'session-1', v: PROTOCOL, token: 'cd'.repeat(16), resumed: false, account: { id: profile.id, token: credential }, rank: profile });
  assert.equal(localStorage.getItem('imjin.ranked-account'), credential);
  const route = Array.from({ length: 1200 }, (_, i) => ({ id: i + 1, order: { type: 'move', x: 1234.567890123456 + i, z: -2345.678901234567 - i } }));
  const beforeRoute = socket.messages.length;
  net.send({ t: 'cmd', cmd: { type: 'orders', list: route, queue: true } });
  const packets = socket.messages.slice(beforeRoute);
  assert.deepEqual(packets.flatMap((m) => m.cmd.list), route, 'every uncapped fleet destination is sent once in order');
  assert.ok(packets.every((m) => m.cmd.queue === true && Buffer.byteLength(JSON.stringify(m)) < 64 * 1024), 'queued destinations fit the authoritative server frame gate');
  net.ranked('ming');
  assert.deepEqual(socket.messages.at(-1), { t: 'ranked', faction: 'ming' });
  socket.receive({ t: 'ranked', state: 'searching', since: 100, range: 150 });
  assert.equal(useNet.getState().rankedQueue.range, 150);
  assert.equal(net.restoreAccount('ef'.repeat(32)), false, 'cannot change identity while queued');
  socket.receive({ t: 'ranked', state: 'idle', since: 0, range: 0 });
  socket.receive({ t: 'rankedResult', matchId: 'match-1', result: 'win', reason: 'forfeit', before: 1000, after: 1020, delta: 20, profile: { ...profile, rating: 1020, wins: 1, games: 1 } });
  assert.equal(useNet.getState().rankProfile.rating, 1020);
  assert.equal(useNet.getState().rankResult.delta, 20);
  socket.receive({ t: 'welcome', id: 'session-1', v: PROTOCOL, token: 'cd'.repeat(16), resumed: true, account: null, rank: null });
  assert.equal(net.exportAccount(), 'imjin-rank-v1:' + credential, 'server storage failure retains recovery credential');
  net.disconnect();
  assert.equal(sessionStorage.getItem('imjin.session'), null);
  assert.equal(localStorage.getItem('imjin.ranked-account'), credential);
  assert.equal(net.restoreAccount('invalid'), false);
  assert.equal(net.restoreAccount('imjin-rank-v1:' + credential), true);
  const recovered = sockets.at(-1);
  recovered.open();
  assert.equal(recovered.messages.at(-1).account, credential);
  recovered.receive({ t: 'error', text: 'Invalid account', code: 'identity' });
  recovered.close();
  assert.equal(useNet.getState().status, 'error', 'identity rejection must remain visible after socket close');
  assert.equal(localStorage.getItem('imjin.ranked-account'), credential);
  assert.equal(net.newAccount(), true, 'an explicitly rejected recovery credential can be replaced');
  const fresh = sockets.at(-1);
  fresh.open();
  assert.equal(fresh.messages.at(-1).account, undefined);
  const freshCredential = 'ef'.repeat(32);
  fresh.receive({ t: 'welcome', id: 'session-2', v: PROTOCOL, token: '12'.repeat(16), resumed: false, account: { id: 'public-2', token: freshCredential }, rank: { ...profile, id: 'public-2' } });
  const currentPing = net.pingTimer;
  recovered.receive({ t: 'welcome', id: 'stale-session', v: PROTOCOL, token: '34'.repeat(16), resumed: false, account: { id: 'stale', token: credential }, rank: profile });
  recovered.onopen();
  recovered.onclose({ code: 1000 });
  assert.equal(useNet.getState().rankProfile.id, 'public-2', 'queued old socket traffic cannot replace the restored account');
  assert.equal(localStorage.getItem('imjin.ranked-account'), freshCredential);
  assert.equal(net.pingTimer, currentPing);
  assert.equal(currentPing._destroyed, false, 'a delayed old close cannot stop the current heartbeat');
  assert.equal(net.newAccount(), false, 'a normal account cannot be reset by this recovery escape hatch');
  assert.equal(localStorage.getItem('imjin.ranked-account'), freshCredential);
  fresh.receive({ t: 'start', battle: { kind: 'conquest', map: 'hallyeo', size: 2 }, seats: [], you: 0, seed: 20, ranked: true, matchId: 'expired-match' });
  const receipt = { matchId: 'expired-match', opponent: { id: 'other', name: 'Other' }, faction: 'ming', opponentFaction: 'japan', map: 'hallyeo', result: 'loss', reason: 'disconnect', at: 1, before: 1000, after: 980, delta: -20 };
  fresh.receive({ t: 'welcome', id: 'new-after-timeout', v: PROTOCOL, token: '56'.repeat(16), resumed: false, account: { id: 'public-2', token: freshCredential }, rank: { ...profile, id: 'public-2', rating: 980, recent: [receipt] } });
  assert.equal(useNet.getState().battle, 'lost');
  assert.equal(useNet.getState().rankResult.matchId, 'expired-match');
  assert.equal(useNet.getState().rankResult.delta, -20, 'removed-seat reconnect recovers only the matching durable receipt');
  net.send({ t: 'leave' });
  let staleStarts = 0;
  net.onStart = () => staleStarts++;
  assert.equal(staleStarts, 0, 'leaving clears a start deferred before a screen listener was ready');
  net.onStart = null;
  net.disconnect();
  assert.equal(net.pingTimer, 0, 'explicit disconnect releases the current heartbeat without depending on an old close callback');
  console.log('ok: ranked client messages, conserved credential, queue identity lock, recovery and rejection state');

  const drawn = new Battle(1592);
  const draw = new NetBattle(1592, 0);
  draw.message({ t: 'end', winner: null, draw: true });
  draw.advance(drawn, null, 1 / 60);
  assert.equal(drawn.ended, true);
  assert.equal(drawn.winner, null);
  assert.equal(drawn.draw, true);
  draw.dispose();

  const won = new Battle(1593);
  const win = new NetBattle(1593, 0);
  win.message({ t: 'end', winner: 'joseon', draw: false });
  win.advance(won, null, 1 / 60);
  assert.equal(won.ended, true);
  assert.equal(won.winner, 'joseon');
  assert.equal(won.draw, false);
  win.dispose();
  console.log('ok: client end messages apply a draw or winning team to a real Battle');

  const authoritative = new Battle(1594);
  const own = authoritative.addShip('panokseon', 123.5, 456.25, 0.6, 'own', null);
  const enemy = authoritative.addShip('sekibune', -321, 89, 1.2, 'enemy', null);
  own.speed = 2.5;
  own.hull *= 0.6;
  own.guns[0].stage = 2;
  own.guns[0].t = 1.2;
  own.guns[0].ammo = 17;
  own.orderQueue = [{ type: 'move', x: 100, z: 200 }, { type: 'move', x: 300, z: 400 }];
  enemy.orderQueue = [{ type: 'move', x: 999, z: 999 }];
  const buffer = encodeSnapshot(12.5, authoritative.ships, own.owner, (ship) => authoritative.isActive(ship));
  const decoded = decodeSnapshot(buffer);
  assert.equal(decoded.time, 12.5);
  assert.equal(decoded.ships.length, 2);
  const ownFrame = decoded.ships.find((ship) => ship.id === own.id);
  const enemyFrame = decoded.ships.find((ship) => ship.id === enemy.id);
  assert.equal(ownFrame.x, own.x);
  assert.equal(ownFrame.z, own.z);
  assert.equal(ownFrame.speed, own.speed);
  assert.ok(Math.abs(ownFrame.hull - own.hull) < 0.001);
  assert.deepEqual(ownFrame.guns[0], { stage: 2, t: 1.2, ammo: 17 });
  assert.equal(enemyFrame.guns, null);
  assert.equal(ownFrame.queuedWaypoints, 2);
  assert.equal(enemyFrame.queuedWaypoints, 0);
  own.damageState = { flooding: 0.4, propulsion: 0.2, steering: 0.6 };
  const damage = decodeSnapshot(encodeSnapshot(13, authoritative.ships, own.owner, (s) => authoritative.isActive(s))).ships.find((s) => s.id === own.id).damageState;
  for (const key of Object.keys(damage)) assert.ok(Math.abs(damage[key] - own.damageState[key]) <= 1 / 255);
  const { MORALE_STATES } = await vite.ssrLoadModule('/src/sim/types.ts');
  own.struck = false;
  own.lights = true;
  own.repel = true;
  own.fireMode = 'hold';
  for (const [i, state] of MORALE_STATES.entries()) {
    own.moraleState = state;
    own.morale = 0.17 + i * 0.2;
    const nerve = decodeSnapshot(encodeSnapshot(13.5, authoritative.ships, own.owner, (s) => authoritative.isActive(s))).ships.find((s) => s.id === own.id);
    assert.equal(nerve.moraleState, state, 'the morale state shares the flags byte without disturbing the other flags');
    assert.ok(Math.abs(nerve.morale - own.morale) <= 1 / 255);
    assert.deepEqual([nerve.struck, nerve.lights, nerve.repel, nerve.hold], [false, true, true, true]);
  }
  own.moraleState = 'wavering';
  own.morale = 0.37;
  own.repel = false;
  own.fireMode = 'free';
  for (const type of ['morale', 'leader', 'broken', 'drum']) assert.ok(SENT_EVENTS.has(type), `${type} events reach the clients`);
  console.log('ok: morale and its state ride in the 64-byte ship record and the depth events are sent');

  const puppet = new Battle(1594);
  puppet.addShip('panokseon', 0, 0, 0, 'own', null);
  puppet.addShip('sekibune', 0, 0, 0, 'enemy', null);
  const remote = new NetBattle(1594, own.owner);
  remote.snapshot(buffer);
  remote.advance(puppet, null, 0);
  assert.equal(puppet.get(own.id).x, own.x);
  assert.equal(puppet.get(enemy.id).x, enemy.x);
  assert.equal(puppet.get(own.id).guns[0].ammo, 17);
  assert.equal(puppet.get(own.id).remoteQueueCount, 2);
  remote.snapshot(encodeSnapshot(12.6, authoritative.ships, own.owner, (s) => authoritative.isActive(s)));
  remote.advance(puppet, null, 0);
  assert.equal(puppet.get(own.id).moraleState, 'wavering');
  assert.ok(Math.abs(puppet.get(own.id).morale - 0.37) <= 1 / 255, 'the client copies the nerve of the server crews');
  const { DEPTH_V1 } = await vite.ssrLoadModule('/src/sim/depth.ts');
  const drummed = new Battle(1596);
  drummed.depth = DEPTH_V1;
  const squadron = drummed.addSquadron('joseon', 'sq', 'cmd', '', '', 0);
  const leader = drummed.addShip('panokseon', 0, 0, 0, 'leader', squadron);
  const listener = new NetBattle(1596, 0);
  listener.message({ t: 'events', events: [{ type: 'drum', ship: leader.id }] });
  listener.advance(drummed, null, 0);
  assert.ok(drummed.morale.drumWait(squadron.id) > 0, 'a drum beaten on the server rests on the client too, for the order button');
  listener.dispose();

  own.x = 999;
  const incompatible = encodeSnapshot(20, authoritative.ships, own.owner, (ship) => authoritative.isActive(ship));
  new DataView(incompatible).setUint8(1, PROTOCOL - 1);
  assert.equal(decodeSnapshot(incompatible), null);
  remote.snapshot(incompatible);
  remote.advance(puppet, null, 0);
  assert.equal(puppet.get(own.id).x, 123.5);
  remote.dispose();
  console.log('ok: snapshots preserve positions and own gun state; previous-protocol frames cannot change the client battle');
  const { COMPETITIVE_PROFILE } = await vite.ssrLoadModule('/src/sim/competitive.ts');
  const { shipObserved } = await vite.ssrLoadModule('/src/sim/observation.ts');
  const fog = new Battle(1595, COMPETITIVE_PROFILE);
  const friend = fog.addShip('panokseon', 0, 0, 0, 'friend', null);
  const hidden = fog.addShip('sekibune', 0, 0, 0, 'hidden', null);
  const observation = new NetBattle(1595, friend.owner);
  observation.advance(fog, null, 0);
  assert.equal(shipObserved(fog, friend.team, hidden), false, 'Locally staged enemy fleets remain hidden before the first snapshot.');
  observation.snapshot(encodeSnapshot(1, [friend, hidden], friend.owner, (s) => fog.isActive(s)));
  observation.advance(fog, null, 0);
  assert.equal(hidden.observed, true);
  observation.snapshot(encodeSnapshot(2, [friend], friend.owner, (s) => fog.isActive(s)));
  observation.advance(fog, null, 1);
  assert.equal(hidden.observed, false);
  assert.equal(hidden.alive, true, 'Loss of observation is never a sinking or death.');
  hidden.x = 8000;
  observation.snapshot(encodeSnapshot(3, [friend, hidden], friend.owner, (s) => fog.isActive(s)));
  observation.advance(fog, null, 1);
  assert.equal(hidden.observed, true);
  assert.equal(hidden.x, 8000, 'Reappearance snaps to a received observation instead of sailing from a stale location.');
  assert.equal(shipObserved(fog, friend.team, hidden), true, 'Server observation overrides incomplete local lookout reconstruction.');
  observation.dispose();
  console.log('ok: unseen online ships stay alive, hide before staging, and recover from the authoritative observation');
  console.log('network client regression passed');
} finally {
  await vite.close();
  for (const [key, descriptor] of saved) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
}
