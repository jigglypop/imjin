// Exercise the actual client network modules without a renderer or an external server.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const storage = () => {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: (key) => values.delete(key) };
};
const fixture = {
  location: new URL('http://127.0.0.1/'),
  localStorage: storage(),
  sessionStorage: storage(),
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
  const { PROTOCOL, encodeSnapshot, decodeSnapshot } = await vite.ssrLoadModule('/src/net/protocol.ts');

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

  const puppet = new Battle(1594);
  puppet.addShip('panokseon', 0, 0, 0, 'own', null);
  puppet.addShip('sekibune', 0, 0, 0, 'enemy', null);
  const remote = new NetBattle(1594, own.owner);
  remote.snapshot(buffer);
  remote.advance(puppet, null, 0);
  assert.equal(puppet.get(own.id).x, own.x);
  assert.equal(puppet.get(enemy.id).x, enemy.x);
  assert.equal(puppet.get(own.id).guns[0].ammo, 17);

  own.x = 999;
  const incompatible = encodeSnapshot(20, authoritative.ships, own.owner, (ship) => authoritative.isActive(ship));
  new DataView(incompatible).setUint8(1, PROTOCOL - 1);
  assert.equal(decodeSnapshot(incompatible), null);
  remote.snapshot(incompatible);
  remote.advance(puppet, null, 0);
  assert.equal(puppet.get(own.id).x, 123.5);
  remote.dispose();
  console.log('ok: snapshots preserve positions and own gun state; previous-protocol frames cannot change the client battle');
  console.log('network client regression passed');
} finally {
  await vite.close();
  for (const [key, descriptor] of saved) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
}
