// Local process regression: malformed clients must leave other players and the server alive.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';
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

/** Resolves with `promise`, or fails the test when it takes longer than `ms`. */
async function within(promise, ms, what) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(what)), ms); })]);
  } finally {
    clearTimeout(timer);
  }
}

/** Waits until `test` holds, checking every 50 ms, or fails the test after `ms`. */
async function until(test, ms, what) {
  const end = Date.now() + ms;
  while (!(await test())) {
    if (Date.now() > end) throw new Error(`timed out: ${what}`);
    await sleep(50);
  }
}

async function connect(url, name) {
  const ws = new WebSocket(url);
  sockets.push(ws);
  ws.on('error', () => {});
  const inbox = [];
  const waiters = [];
  let room = null;
  let frames = 0;
  ws.on('message', (data, binary) => {
    if (binary) {
      frames += 1;
      return;
    }
    const message = JSON.parse(String(data));
    if (message.t === 'room') room = message.room;
    const index = waiters.findIndex((waiter) => waiter.test(message));
    if (index < 0) inbox.push(message);
    else waiters.splice(index, 1)[0].resolve(message);
  });
  const next = (test, ms = 5000) => {
    const index = inbox.findIndex(test);
    if (index >= 0) return Promise.resolve(inbox.splice(index, 1)[0]);
    return new Promise((resolve, reject) => {
      const waiter = { test, resolve: (message) => { clearTimeout(timer); resolve(message); } };
      const timer = setTimeout(() => {
        const index = waiters.indexOf(waiter);
        if (index >= 0) waiters.splice(index, 1);
        reject(new Error(`timed out waiting for a server message: ${test}`));
      }, ms);
      waiters.push(waiter);
    });
  };
  const send = (message) => ws.send(JSON.stringify(message));
  await once(ws, 'open');
  if (name) {
    send({ t: 'hello', name, v: protocol });
    const welcome = await next((m) => m.t === 'welcome');
    return { ws, send, next, id: welcome.id, get room() { return room; }, get frames() { return frames; } };
  }
  return { ws, send, next };
}

try {
  const built = await run('scripts/build-server.mjs');
  assert.equal(built.code, 0, built.output);
  assert(!readFileSync(new URL('../server/dist/server.cjs', import.meta.url), 'utf8').includes('node_modules/three/'), 'three.js reached the server bundle: src/sim and server/ must not import it');
  const { revision } = JSON.parse(readFileSync(new URL('../server/dist/build.json', import.meta.url), 'utf8'));
  server = spawn(process.execPath, ['server/dist/server.cjs'], {
    cwd: root,
    env: { ...process.env, PORT: '0', FF_SPEED: '1', HELLO_SECONDS: '2', FAULT_ROOM: 'fault', RANKED_STORE: join(storage, 'ranked.jsonl'), ACCOUNTS_STORE: 'memory' },
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

  // Until its hello is accepted a socket is cut after HELLO_SECONDS (2 here) or after a few frames; one that says hello stays.
  const open = (await health()).sockets;
  const late = await connect(url);
  const idle = await connect(url);
  const flooding = await connect(url);
  const idleClosed = once(idle.ws, 'close');
  const floodClosed = once(flooding.ws, 'close');
  for (let i = 0; i < 40; i++) flooding.ws.send(JSON.stringify({ t: 'ping', at: i }));
  await within(floodClosed, 1000, 'a socket sending frames without a hello was not cut before the deadline');
  late.send({ t: 'ping', at: 5 });
  late.send({ t: 'hello', name: 'late', v: protocol });
  await late.next((m) => m.t === 'welcome');
  await within(idleClosed, 5000, 'a socket that never said hello was not cut');
  late.send({ t: 'ping', at: 6 });
  await late.next((m) => m.t === 'pong' && m.at === 6);
  await until(async () => (await health()).sockets === open + 1, 3000, 'only the introduced socket is still open');
  console.log('ok: sockets without a hello are cut at the deadline or after a few frames; one that says hello stays');

  // A room whose battle throws ends alone: its player goes back to the lobby with a notice and keeps the connection, the
  // error is logged, and the battle in the other room keeps running.
  const steady = await connect(url, 'steady');
  steady.send({ t: 'create', name: 'steady', battle: { kind: 'conquest', map: 'hallyeo', size: 2 } });
  await steady.next((m) => m.t === 'room' && m.room?.name === 'steady');
  steady.send({ t: 'start' });
  await steady.next((m) => m.t === 'start', 60000);
  steady.send({ t: 'loaded' });
  await until(() => steady.frames > 0, 5000, 'the steady battle sends snapshots');
  const faulty = await connect(url, 'faulty');
  faulty.send({ t: 'create', name: 'fault', battle: { kind: 'conquest', map: 'hallyeo', size: 2 } });
  await faulty.next((m) => m.t === 'room' && m.room?.name === 'fault');
  faulty.send({ t: 'start' });
  await faulty.next((m) => m.t === 'start', 60000);
  faulty.send({ t: 'loaded' });
  const notice = await faulty.next((m) => m.t === 'closed');
  assert.equal(notice.reason, '서버 오류로 전투를 이어갈 수 없어 방이 닫혔습니다.');
  const frames = steady.frames;
  await until(() => steady.frames >= frames + 5, 5000, 'the other battle keeps running');
  faulty.send({ t: 'ping', at: 7 });
  await faulty.next((m) => m.t === 'pong' && m.at === 7);
  const after = await health();
  assert.equal(after.failedRooms, 1);
  assert.equal(after.battles, 1);
  assert.equal(after.rooms, 2);
  await until(() => /room [A-Z]{4} \(conquest:hallyeo\) failed: Error: fault injected/.test(stderr), 3000, 'the failure is logged');
  console.log('ok: a room whose battle throws ends alone with a notice; the other battle and the server keep running');

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
