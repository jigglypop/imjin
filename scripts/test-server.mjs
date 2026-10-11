// Local process regression: malformed clients must leave other players and the server alive.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const root = fileURLToPath(new URL('..', import.meta.url));
const protocol = Number(/export const PROTOCOL = (\d+)/.exec(readFileSync(new URL('../src/net/protocol.ts', import.meta.url), 'utf8'))?.[1]);
const sockets = [];
let server;
let stderr = '';
const storage = mkdtempSync(join(tmpdir(), 'imjin-server-regression-'));

function run(script, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (data) => output += data);
    child.stderr.on('data', (data) => output += data);
    child.once('error', reject);
    child.once('exit', (code) => resolve({ code, output }));
  });
}

async function connect(url, name) {
  const ws = new WebSocket(url);
  sockets.push(ws);
  ws.on('error', () => {});
  const inbox = [];
  const waiters = [];
  let room = null;
  ws.on('message', (data, binary) => {
    if (binary) return;
    const message = JSON.parse(String(data));
    if (message.t === 'room') room = message.room;
    const index = waiters.findIndex((waiter) => waiter.test(message));
    if (index < 0) inbox.push(message);
    else waiters.splice(index, 1)[0].resolve(message);
  });
  const next = (test) => {
    const index = inbox.findIndex(test);
    if (index >= 0) return Promise.resolve(inbox.splice(index, 1)[0]);
    return new Promise((resolve, reject) => {
      const waiter = { test, resolve: (message) => { clearTimeout(timer); resolve(message); } };
      const timer = setTimeout(() => {
        const index = waiters.indexOf(waiter);
        if (index >= 0) waiters.splice(index, 1);
        reject(new Error(`timed out waiting for a server message: ${test}`));
      }, 5000);
      waiters.push(waiter);
    });
  };
  const send = (message) => ws.send(JSON.stringify(message));
  await once(ws, 'open');
  if (name) {
    send({ t: 'hello', name, v: protocol });
    const welcome = await next((m) => m.t === 'welcome');
    return { ws, send, next, id: welcome.id, get room() { return room; } };
  }
  return { ws, send, next };
}

try {
  const built = await run('scripts/build-server.mjs');
  assert.equal(built.code, 0, built.output);
  const { revision } = JSON.parse(readFileSync(new URL('../server/dist/build.json', import.meta.url), 'utf8'));
  server = spawn(process.execPath, ['server/dist/server.cjs'], {
    cwd: root,
    env: { ...process.env, PORT: '0', FF_SPEED: '1', RANKED_STORE: join(storage, 'ranked.jsonl') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stderr.on('data', (data) => stderr += data);
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server did not start')), 10000);
    server.once('error', reject);
    server.once('exit', (code) => { clearTimeout(timer); reject(new Error(`server exited ${code}: ${stderr}`)); });
    let output = '';
    server.stdout.on('data', (data) => {
      output += data;
      const match = /imjin server on :(\d+)/.exec(output);
      if (match) { clearTimeout(timer); resolve(Number(match[1])); }
    });
  });
  const url = `ws://127.0.0.1:${port}/ws`;
  const healthUrl = `http://127.0.0.1:${port}/health`;
  const health = async () => {
    assert.equal(server.exitCode, null, stderr);
    const response = await fetch(healthUrl, { signal: AbortSignal.timeout(3000) });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const state = await response.json();
    assert.equal(state.ok, true);
    assert.equal(state.protocol, protocol);
    assert.equal(state.revision, revision);
    return state;
  };
  const host = await connect(url, 'host');
  const guest = await connect(url, 'guest');
  host.send({ t: 'create', name: 'regression', battle: { kind: 'conquest', map: 'hallyeo', size: 2 } });
  const created = await host.next((m) => m.t === 'room' && m.room);
  guest.send({ t: 'join', room: created.room.id });
  await guest.next((m) => m.t === 'room' && m.room?.seats[1].client === guest.id);
  guest.send({ t: 'ready', ready: true });
  await host.next((m) => m.t === 'room' && m.room?.seats[1].ready);

  const oversize = await connect(url);
  const closed = once(oversize.ws, 'close');
  oversize.ws.send('a'.repeat(65537));
  await Promise.race([closed, new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error('oversize connection was not closed')), 3000);
    closed.finally(() => clearTimeout(timer));
  })]);
  await health();
  guest.send({ t: 'ping', at: 1 });
  await guest.next((m) => m.t === 'pong' && m.at === 1);
  console.log('ok: oversize pre-hello frame closes only its socket; health and other player survive');

  for (const index of ['length', '__proto__', 'constructor', -1, 0.5, 2, 4, null, [0]]) {
    host.send({ t: 'seat', index, faction: 'japan' });
    host.send({ t: 'take', index });
  }
  for (const message of [
    { t: 'seat', index: 0, faction: 'unknown' },
    { t: 'seat', index: 0, human: 'false' },
    { t: 'ready', ready: 'true' },
    { t: 'join', room: { toString: null } },
    { t: 'create', name: { toString: null }, battle: { kind: 'conquest', map: 'hallyeo', size: 2 } },
    { t: 'create', name: 'bad map', battle: { kind: 'conquest', map: 'constructor', size: 2 } },
    { t: 'quick', battle: { kind: 'scenario', id: '__proto__' }, faction: 'joseon' },
    { t: 'hello', name: { toString: null }, v: protocol },
    { t: 'chat', text: { toString: null } },
    { t: 'cmd', cmd: null },
    null,
    [],
  ]) host.send(message);
  host.ws.send('{ invalid JSON');
  host.send({ t: 'ping', at: 2 });
  await host.next((m) => m.t === 'pong' && m.at === 2);
  assert.equal((await health()).rooms, 1);
  host.send({ t: 'list' });
  const listed = await host.next((m) => m.t === 'rooms' && m.rooms.some((room) => room.id === created.room.id));
  assert.equal(listed.rooms.length, 1);
  guest.send({ t: 'chat', text: 'still connected' });
  await host.next((m) => m.t === 'chat' && m.text === 'still connected');
  host.send({ t: 'seat', index: 1, faction: 'joseon' }); // Host cannot edit an occupied guest seat.
  host.send({ t: 'ping', at: 3 });
  await host.next((m) => m.t === 'pong' && m.at === 3);
  assert.equal(host.room.seats[1].faction, 'japan');
  assert.equal(host.room.seats[1].ready, true);
  guest.send({ t: 'seat', index: 1, faction: 'joseon' });
  const changed = await host.next((m) => m.t === 'room' && m.room?.seats[1].faction === 'joseon');
  assert.equal(changed.room.seats[1].ready, false);
  guest.send({ t: 'ready', ready: true });
  await host.next((m) => m.t === 'room' && m.room?.seats[1].ready);
  guest.send({ t: 'leave' });
  await host.next((m) => m.t === 'room' && !m.room?.seats[1].client);
  host.send({ t: 'take', index: 1 });
  const moved = await host.next((m) => m.t === 'room' && m.room?.seats[1].client === host.id);
  assert.equal(moved.room.seats[0].client, null);
  console.log('ok: invalid indices and lobby fields are ignored; ownership, faction, ready, leave and take still work');

  const accepted = await run('scripts/check-mp-health.mjs', [`--url=${healthUrl}`, `--revision=${revision}`]);
  assert.equal(accepted.code, 0, accepted.output);
  const stale = await run('scripts/check-mp-health.mjs', [`--url=${healthUrl}`, '--revision=old-revision']);
  assert.equal(stale.code, 1, stale.output);
  const staticOnly = await run('scripts/check-mp-health.mjs', [`--url=${healthUrl}`, '--protocol-only']);
  assert.equal(staticOnly.code, 0, staticOnly.output);
  const incompatible = createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ ok: true, protocol: protocol + 1, revision }));
  });
  incompatible.listen(0, '127.0.0.1');
  await once(incompatible, 'listening');
  try {
    const wrong = await run('scripts/check-mp-health.mjs', [`--url=http://127.0.0.1:${incompatible.address().port}/health`, `--revision=${revision}`]);
    assert.equal(wrong.code, 1, wrong.output);
    const wrongStatic = await run('scripts/check-mp-health.mjs', [`--url=http://127.0.0.1:${incompatible.address().port}/health`, '--protocol-only']);
    assert.equal(wrongStatic.code, 1, wrongStatic.output);
  } finally {
    await new Promise((resolve) => incompatible.close(resolve));
  }
  console.log('ok: deployment health accepts the built revision and rejects stale revision or wrong protocol despite HTTP 200');
  await health();
  console.log('server regression passed');
} finally {
  for (const ws of sockets) ws.terminate();
  if (server && server.exitCode === null) {
    server.kill();
    await once(server, 'exit');
  }
  if (!storage.startsWith(join(tmpdir(), 'imjin-server-regression-'))) throw new Error('unexpected temporary storage path');
  rmSync(storage, { recursive: true, force: true });
}
