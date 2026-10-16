// Accounts regression: the store's rules in-process, then the real server's HTTP API and WebSocket on a free port with
// temporary storage. Never uses the production database or journal.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import WebSocket from 'ws';

const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
const root = fileURLToPath(new URL('..', import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), 'imjin-accounts-regression-'));
const protocol = Number(/export const PROTOCOL = (\d+)/.exec(readFileSync(new URL('../src/net/protocol.ts', import.meta.url), 'utf8'))?.[1]);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const sockets = [];
/** Every token and password the test hands the server: none may reach its output. */
const secrets = new Set();
let child;
let store;
let port;
let output = '';
let allOutput = '';

const run = (script) => new Promise((resolve, reject) => {
  const process = spawn(globalThis.process.execPath, [script], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  let text = '';
  process.stdout.on('data', (data) => text += data);
  process.stderr.on('data', (data) => text += data);
  process.once('error', reject);
  process.once('exit', (code) => resolve({ code, output: text }));
});
async function stop() {
  for (const ws of sockets.splice(0)) ws.terminate();
  if (child && child.exitCode === null) { child.kill(); await once(child, 'exit'); }
  child = null;
}
async function start(env = {}) {
  output = '';
  child = spawn(process.execPath, ['server/dist/server.cjs'], {
    cwd: root,
    env: { ...process.env, PORT: '0', FF_SPEED: '1', GRACE_SECONDS: '20', LOAD_SECONDS: '10', ACCOUNTS_DB: join(temporary, 'server', 'accounts.db'), RANKED_STORE: join(temporary, 'server', 'ranked.jsonl'), ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const collect = (data) => { output += data; allOutput += data; };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);
  port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server startup timeout: ${output}`)), 15000);
    child.once('error', reject);
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`server exited ${code}: ${output}`)); });
    child.stdout.on('data', () => { const match = /imjin server on :(\d+)/.exec(output); if (match) { clearTimeout(timer); resolve(Number(match[1])); } });
  });
}

/** One HTTP request with full control of the headers (an Origin, the address the TLS proxy would forward). */
function call(method, path, { body, raw, token, origin, address = '198.51.100.1', headers = {} } = {}) {
  const payload = raw ?? (body === undefined ? null : JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, method, path, headers: {
      'x-forwarded-for': address,
      ...(payload !== null && raw === undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(origin ? { origin } : {}),
      ...headers,
    } }, (res) => {
      let text = '';
      res.on('data', (data) => text += data);
      res.on('end', () => {
        let json = null;
        try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
        resolve({ status: res.statusCode, headers: res.headers, json });
      });
    });
    req.on('error', reject);
    if (payload !== null) req.write(payload);
    req.end();
  });
}
const health = async () => (await call('GET', '/health')).json;
async function refused(promise, status, code) {
  const response = await promise;
  assert.equal(response.status, status, JSON.stringify(response.json));
  assert.equal(response.json?.error?.code, code);
  assert.ok(typeof response.json.error.text === 'string' && /[가-힣]/.test(response.json.error.text), 'each refusal carries Korean text the page can show');
  return response;
}
const remember = (reply) => { if (reply.json?.token) secrets.add(reply.json.token); return reply; };
async function signUp(login, password, nickname, options = {}) {
  secrets.add(password);
  const reply = remember(await call('POST', '/api/auth/signup', { body: { login, password, nickname, ...options.extra }, token: options.token, address: options.address ?? `203.0.113.${login.length}` }));
  assert.equal(reply.status, 200, JSON.stringify(reply.json));
  return reply.json;
}
async function logIn(login, password, address = '198.51.100.7') {
  const reply = remember(await call('POST', '/api/auth/login', { body: { login, password }, address }));
  assert.equal(reply.status, 200, JSON.stringify(reply.json));
  return reply.json;
}

async function connect(hello, rejection = false) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  sockets.push(ws);
  ws.on('error', () => {});
  const inbox = [], waiters = [];
  ws.on('message', (data, binary) => {
    if (binary) return;
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
  send({ t: 'hello', v: protocol, ...hello });
  const welcome = await next((msg) => msg.t === (rejection ? 'error' : 'welcome'));
  if (welcome.account?.token) secrets.add(welcome.account.token);
  return { ws, next, send, welcome, inbox };
}
const journal = () => readFileSync(join(temporary, 'server', 'ranked.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));

try {
  // ---------------------------------------------------------------- the store and the password hash, in-process
  const bundle = join(temporary, 'accounts.mjs');
  await build({ stdin: { contents: "export * from './server/accounts.ts'; export * from './server/password.ts';", resolveDir: root, loader: 'ts' }, outfile: bundle, platform: 'node', format: 'esm', bundle: true, logLevel: 'silent' });
  const { AccountStore, AccountError, hashPassword, verifyPassword, staleHash } = await import(pathToFileURL(bundle).href);
  const unitPath = join(temporary, 'unit', 'accounts.db');
  store = new AccountStore(unitPath);
  const a = store.createGuest('갑');
  assert.match(a.id, /^[a-f0-9]{24}$/);
  assert.deepEqual(store.profile(a.id), { data: {}, rev: 0 });
  store.appendLedger(a.id, { kind: 'coin', amount: 120, reason: 'battle' });
  const bought = store.updateProfile(a.id, 0, (data, tx) => {
    tx.ledger({ kind: 'coin', amount: -50, item: 'armor:iron', reason: 'buy' });
    data.armor = ['iron'];
  });
  assert.deepEqual(bought, { data: { armor: ['iron'] }, rev: 1 });
  assert.equal(store.balance(a.id, 'coin'), 70);
  assert.throws(() => store.updateProfile(a.id, 0, () => ({ stale: true })), (e) => e instanceof AccountError && e.code === 'conflict');
  assert.throws(() => store.updateProfile(a.id, 1, (data, tx) => { data.armor.push('gold'); tx.ledger({ kind: 'coin', amount: -100, item: 'armor:gold', reason: 'buy' }); }), (e) => e.code === 'insufficient');
  assert.deepEqual(store.profile(a.id), { data: { armor: ['iron'] }, rev: 1 }, 'a purchase that cannot be paid leaves the profile as it was');
  store.updateProfile(a.id, null, (data, tx) => {
    try { tx.ledger({ kind: 'coin', amount: -1000, reason: 'buy' }); } catch { /* refused inside its own savepoint */ }
    tx.ledger({ kind: 'coin', amount: -10, reason: 'repair' });
    data.repaired = true;
  });
  assert.equal(store.balance(a.id, 'coin'), 60, 'a refused inner step rolls back alone; the rest of the change stays');
  assert.deepEqual(store.ledger(a.id, 'coin').map((e) => [e.amount, e.balanceAfter, e.reason]), [[-10, 60, 'repair'], [-50, 70, 'buy'], [120, 120, 'battle']]);
  for (const bad of [{ kind: 'Coin', amount: 1, reason: 'x' }, { kind: 'coin', amount: 0.5, reason: 'x' }, { kind: 'coin', amount: 0, reason: 'x' }, { kind: 'coin', amount: 1, reason: '' }]) {
    assert.throws(() => store.appendLedger(a.id, bad), (e) => e.code === 'invalid');
  }
  assert.equal(store.claimOnce(`battle:m1:${a.id}`, a.id), true);
  assert.equal(store.claimOnce(`battle:m1:${a.id}`, a.id), false);
  assert.throws(() => store.transaction(async () => 1), /cannot wait/);
  assert.throws(() => store.updateProfile(a.id, null, () => [1, 2]), (e) => e.code === 'invalid');
  store.close();
  const raw = new DatabaseSync(unitPath);
  assert.throws(() => raw.exec('UPDATE ledger SET amount = 999'), /append-only/);
  assert.throws(() => raw.exec('DELETE FROM ledger'), /append-only/);
  assert.equal(raw.prepare('PRAGMA user_version').get().user_version, 1);
  raw.exec('PRAGMA user_version = 99');
  raw.close();
  assert.throws(() => new AccountStore(unitPath), /schema 99/, 'a database from a newer server is left alone');
  const hash = await hashPassword('바다를 지킨 장수');
  assert.match(hash, /^\$scrypt\$ln=15,r=8,p=3\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$/);
  assert.equal(await verifyPassword('바다를 지킨 장수', hash), true);
  assert.equal(await verifyPassword('바다를 지킨 장수'.normalize('NFD'), hash), true, 'the same password typed with another Unicode composition');
  assert.equal(await verifyPassword('바다를 지킨 장군', hash), false);
  assert.equal(await verifyPassword('anything', null), false);
  assert.equal(staleHash(hash), false);
  assert.equal(staleHash(hash.replace('ln=15', 'ln=14')), true);
  console.log('ok: profiles change against their revision, purchases pay and receive in one transaction, the ledger is append-only, claims count once, scrypt hashes carry their parameters');

  // ---------------------------------------------------------------- the server
  const built = await run('scripts/build-server.mjs');
  assert.equal(built.code, 0, built.output);
  assert.match(readFileSync(join(root, 'server/dist/server.cjs'), 'utf8'), /getBuiltinModule\("node:sqlite"\)/, 'node:sqlite stays a Node built-in, outside the bundle');
  const backups = join(temporary, 'server', 'backups');
  mkdirSync(backups, { recursive: true });
  for (let day = 1; day <= 8; day++) writeFileSync(join(backups, `accounts-2026-01-0${day}.db`), '');
  await start();
  assert.equal((await health()).accountsReady, true);
  const today = `accounts-${new Date().toISOString().slice(0, 10)}.db`;
  assert.deepEqual(readdirSync(backups).sort(), [...['03', '04', '05', '06', '07', '08'].map((d) => `accounts-2026-01-${d}.db`), today], 'the start-up copy is made and only the newest seven are kept');
  const copy = new DatabaseSync(join(backups, today));
  assert.equal(copy.prepare('PRAGMA user_version').get().user_version, 1);
  copy.close();
  console.log('ok: a dated copy of the database is made at start-up and only the newest seven are kept');

  // Guest, then sign-up in place: the same id and the same progress.
  const guest = remember(await call('POST', '/api/auth/guest', { address: '198.51.100.2' })).json;
  assert.equal(guest.user.guest, true);
  assert.equal(guest.user.login, null);
  assert.equal(guest.user.nickname, '무명');
  assert.deepEqual(guest.profile, { data: {}, rev: 0 });
  const again = await call('POST', '/api/auth/guest', { token: guest.token, address: '198.51.100.2' });
  assert.equal(again.json.user.id, guest.user.id, 'a page that has a session gets its own guest back');
  store = new AccountStore(join(temporary, 'server', 'accounts.db'));
  store.updateProfile(guest.user.id, 0, (data) => { data.fleet = ['geobukseon']; });
  store.appendLedger(guest.user.id, { kind: 'coin', amount: 300, reason: 'battle' });
  const password = 'turtle-ship-1592';
  const yi = await signUp('Admiral_Yi', password, '  이순신  ', { token: guest.token });
  assert.equal(yi.user.id, guest.user.id);
  assert.equal(yi.token, guest.token, 'the guest keeps its session');
  assert.equal(yi.user.login, 'admiral_yi');
  assert.equal(yi.user.nickname, '이순신');
  assert.equal(yi.user.guest, false);
  assert.deepEqual(yi.profile, { data: { fleet: ['geobukseon'] }, rev: 1 });
  assert.equal(store.balance(yi.user.id, 'coin'), 300);
  await refused(call('POST', '/api/auth/signup', { body: { login: 'second_try', password, nickname: '둘' }, token: guest.token }), 409, 'registered');
  console.log('ok: a guest that signs up keeps its id, its session, its profile and its coins');

  // A second device logs in; logging out ends only that session.
  const second = await logIn('  ADMIRAL_yi ', password);
  assert.notEqual(second.token, guest.token);
  assert.equal(second.user.id, yi.user.id);
  assert.equal((await call('GET', '/api/me', { token: second.token })).json.user.nickname, '이순신');
  assert.equal((await call('POST', '/api/auth/logout', { token: second.token })).json.ok, true);
  await refused(call('GET', '/api/me', { token: second.token }), 401, 'session');
  assert.equal((await call('GET', '/api/me', { token: guest.token })).status, 200);
  assert.equal((await call('POST', '/api/auth/logout')).status, 200, 'logging out without a session is harmless');
  console.log('ok: a second device logs in to the same user; logout ends that session only');

  // Refusals.
  const wrong = await refused(call('POST', '/api/auth/login', { body: { login: 'admiral_yi', password: 'turtle-ship-1593' }, address: '198.51.100.3' }), 401, 'credentials');
  const unknown = await refused(call('POST', '/api/auth/login', { body: { login: 'nobody_here', password }, address: '198.51.100.3' }), 401, 'credentials');
  assert.equal(wrong.json.error.text, unknown.json.error.text, 'an unknown login and a wrong password read the same');
  await refused(call('POST', '/api/auth/signup', { body: { login: 'ADMIRAL_YI', password, nickname: '도용' }, address: '198.51.100.4' }), 409, 'login-taken');
  for (const [body, code] of [
    [{ login: 'ab', password, nickname: '짧음' }, 'login'],
    [{ login: 'bad login!', password, nickname: '공백' }, 'login'],
    [{ login: 'a'.repeat(17), password, nickname: '긺' }, 'login'],
    [{ login: 12345, password, nickname: '숫자' }, 'login'],
    [{ login: 'short_pw', password: 'short', nickname: '짧음' }, 'password'],
    [{ login: 'long_pw', password: 'x'.repeat(73), nickname: '긺' }, 'password'],
    [{ login: 'no_pw', nickname: '없음' }, 'password'],
    [{ login: 'no_nick', password }, 'nickname'],
    [{ login: 'blank_nick', password, nickname: '   ' }, 'nickname'],
    [{ login: 'tag_nick', password, nickname: '<<>>' }, 'nickname'],
  ]) await refused(call('POST', '/api/auth/signup', { body, address: '198.51.100.5' }), 400, code);
  const korean = await signUp('korean_pw', '가나다라마바사아', '한글', { address: '198.51.100.5' });
  assert.equal(korean.user.login, 'korean_pw', 'eight Korean characters are eight characters, not 24 bytes');
  await refused(call('POST', '/api/auth/login', { raw: '{"login":', headers: { 'content-type': 'application/json' }, address: '198.51.100.5' }), 400, 'json');
  await refused(call('POST', '/api/auth/login', { raw: '[1,2]', headers: { 'content-type': 'application/json' }, address: '198.51.100.5' }), 400, 'json');
  await refused(call('POST', '/api/auth/login', { raw: 'login=admiral_yi', headers: { 'content-type': 'application/x-www-form-urlencoded' }, address: '198.51.100.5' }), 415, 'json');
  await refused(call('POST', '/api/auth/signup', { body: { login: 'big_body', password, nickname: 'x'.repeat(17000) }, address: '198.51.100.5' }), 413, 'too-large');
  await refused(call('GET', '/api/auth/login', { address: '198.51.100.5' }), 405, 'method');
  await refused(call('GET', '/api/nothing', { address: '198.51.100.5' }), 404, 'not-found');
  await refused(call('GET', '/api/me', { address: '198.51.100.5' }), 401, 'session');
  await refused(call('GET', '/api/me', { headers: { authorization: 'Bearer nope' }, address: '198.51.100.5' }), 401, 'session');
  await refused(call('POST', '/api/me/password', { body: { current: 'x', next: 'whatever-long' }, token: (await call('POST', '/api/auth/guest', { address: '198.51.100.6' })).json.token }), 403, 'guest');
  assert.equal((await call('GET', '/health')).status, 200, 'health is unchanged beside the API');
  console.log('ok: wrong passwords, unknown and duplicate logins, malformed fields and bodies are refused with codes and Korean text');

  // Nickname and password. Each login may be tried five times a minute, the password change included.
  assert.equal((await call('POST', '/api/me/nickname', { body: { nickname: ' 충무공 ' }, token: guest.token })).json.user.nickname, '충무공');
  await refused(call('POST', '/api/me/nickname', { body: { nickname: '' }, token: guest.token }), 400, 'nickname');
  const yu = await signUp('yu_seongnyong', 'jingbirok-1592', '유성룡', { address: '198.51.100.10' });
  const yuOther = await logIn('yu_seongnyong', 'jingbirok-1592', '198.51.100.11');
  await refused(call('POST', '/api/me/password', { body: { current: 'not-the-password', next: 'panokseon-1597' }, token: yu.token }), 403, 'current');
  await refused(call('POST', '/api/me/password', { body: { current: 'jingbirok-1592', next: 'short' }, token: yu.token }), 400, 'password');
  secrets.add('panokseon-1597');
  assert.equal((await call('POST', '/api/me/password', { body: { current: 'jingbirok-1592', next: 'panokseon-1597' }, token: yu.token })).json.ok, true);
  await refused(call('GET', '/api/me', { token: yuOther.token }), 401, 'session');
  assert.equal((await call('GET', '/api/me', { token: yu.token })).status, 200, 'the session that changed the password stays');
  await refused(call('POST', '/api/auth/login', { body: { login: 'yu_seongnyong', password: 'jingbirok-1592' }, address: '198.51.100.12' }), 401, 'credentials');
  assert.equal((await logIn('yu_seongnyong', 'panokseon-1597', '198.51.100.12')).user.id, yu.user.id);
  console.log('ok: nickname and password changes; a new password ends the other sessions and keeps this one');

  // Rate limits: per login, per address, and new users per address and hour.
  await signUp('won_gyun', 'chilcheollyang', '원균', { address: '198.51.100.9' });
  for (let i = 0; i < 5; i++) await refused(call('POST', '/api/auth/login', { body: { login: 'won_gyun', password: `guess-${i}-guess` }, address: `192.0.2.${10 + i}` }), 401, 'credentials');
  const limited = await refused(call('POST', '/api/auth/login', { body: { login: 'won_gyun', password: 'chilcheollyang' }, address: '192.0.2.99' }), 429, 'rate');
  assert.equal(limited.headers['retry-after'], '60');
  for (let i = 0; i < 10; i++) await refused(call('POST', '/api/auth/login', { body: { login: `scan_${i}`, password: 'whatever-whatever' }, address: '192.0.2.50' }), 401, 'credentials');
  await refused(call('POST', '/api/auth/login', { body: { login: 'scan_10', password: 'whatever-whatever' }, address: '192.0.2.50' }), 429, 'rate');
  for (let i = 0; i < 24; i++) assert.equal((await call('POST', '/api/auth/guest', { address: '192.0.2.77' })).status, 200);
  await refused(call('POST', '/api/auth/guest', { address: '192.0.2.77' }), 429, 'rate');
  await refused(call('POST', '/api/auth/signup', { body: { login: 'one_more', password, nickname: '하나 더' }, address: '192.0.2.77' }), 429, 'rate');
  assert.equal((await call('POST', '/api/auth/guest', { address: '192.0.2.78' })).status, 200, 'another address still creates');
  console.log('ok: log-in attempts are limited per login and per address, new users per address and hour');

  // CORS: the game's own pages may call, with a preflight; other origins are refused before anything happens.
  const preflight = await call('OPTIONS', '/api/auth/login', { origin: 'https://imjin1592.com', headers: { 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization, content-type' } });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers['access-control-allow-origin'], 'https://imjin1592.com');
  assert.match(preflight.headers['access-control-allow-headers'], /authorization/);
  assert.match(preflight.headers['access-control-allow-methods'], /POST/);
  const local = await call('GET', '/api/me', { token: guest.token, origin: 'http://127.0.0.1:5331' });
  assert.equal(local.headers['access-control-allow-origin'], 'http://127.0.0.1:5331');
  const foreign = await call('OPTIONS', '/api/auth/login', { origin: 'https://evil.example', headers: { 'access-control-request-method': 'POST' } });
  assert.equal(foreign.status, 403);
  assert.equal(foreign.headers['access-control-allow-origin'], undefined);
  const users = () => { const db = new DatabaseSync(join(temporary, 'server', 'accounts.db')); try { return db.prepare('SELECT count(*) AS n FROM users').get().n; } finally { db.close(); } };
  const before = users();
  await refused(call('POST', '/api/auth/guest', { origin: 'https://evil.example', address: '192.0.2.120' }), 403, 'origin');
  assert.equal(users(), before, 'a refused origin creates nothing');
  console.log('ok: CORS answers the game\'s origins (preflight included) and refuses others before doing anything');

  // Sliding expiry: every use moves the end on; a session past it signs nobody in and is forgotten.
  const expiring = remember(await call('POST', '/api/auth/guest', { address: '198.51.100.30' })).json;
  const sessionRow = () => { const db = new DatabaseSync(join(temporary, 'server', 'accounts.db')); try { return db.prepare('SELECT expires FROM sessions WHERE hash = ?').get(sha256(expiring.token)); } finally { db.close(); } };
  const first = sessionRow().expires;
  assert.ok(first > Date.now() + 89 * 24 * 3600 * 1000 && first <= Date.now() + 90 * 24 * 3600 * 1000);
  await sleep(30);
  await call('GET', '/api/me', { token: expiring.token });
  assert.ok(sessionRow().expires > first, 'a use moves the expiry on');
  { const db = new DatabaseSync(join(temporary, 'server', 'accounts.db')); db.prepare('UPDATE sessions SET expires = ? WHERE hash = ?').run(Date.now() - 1, sha256(expiring.token)); db.close(); }
  await refused(call('GET', '/api/me', { token: expiring.token }), 401, 'session');
  assert.equal(sessionRow(), undefined, 'an expired session is deleted when it is next presented');
  console.log('ok: sessions slide 90 days on each use and expire after');

  // The ranked account through the WebSocket hello with a session.
  const kwon = await signUp('kwon_jun', 'admiral-kwon-1592', '권준', { address: '198.51.100.40' });
  const accountsBefore = journal().filter((e) => e.t === 'account').length;
  const kwonA = await connect({ name: '권준', session: kwon.token });
  assert.equal(kwonA.welcome.user, kwon.user.id);
  assert.equal(kwonA.welcome.account, null, 'a ranked account that came with a session never hands out its recovery code');
  const kwonRanked = kwonA.welcome.rank.id;
  assert.equal((await call('GET', '/api/me', { token: kwon.token })).json.user.rankedId, kwonRanked, 'the ranked account made on the first visit is linked');
  const kwonPhone = await logIn('kwon_jun', 'admiral-kwon-1592', '198.51.100.41');
  const kwonB = await connect({ name: '권준', session: kwonPhone.token });
  assert.equal(kwonB.welcome.rank.id, kwonRanked, 'another device gets the same ranked account without a recovery code');
  assert.equal(journal().filter((e) => e.t === 'account').length, accountsBefore + 1);
  kwonB.send({ t: 'hello', name: '권준', v: protocol, session: kwonPhone.token, account: 'f'.repeat(64) });
  assert.equal((await kwonB.next((m) => m.t === 'rank')).profile.id, kwonRanked, 'a renaming hello on a signed-in line ignores a recovery code');

  const anonymous = await connect({ name: '손님' });
  const anonymousCode = anonymous.welcome.account.token;
  const browserGuest = remember(await call('POST', '/api/auth/guest', { address: '198.51.100.42' })).json;
  const adopted = await connect({ name: '손님', session: browserGuest.token, account: anonymousCode });
  assert.equal(adopted.welcome.rank.id, anonymous.welcome.account.id, 'a guest is this browser: it keeps the ranked record the browser already has');
  assert.equal((await call('GET', '/api/me', { token: browserGuest.token })).json.user.rankedId, anonymous.welcome.account.id);

  const stranger = await connect({ name: '남' });
  const yiEok = await signUp('yi_eokgi', 'jeolla-right-1592', '이억기', { address: '198.51.100.43' });
  const yiEokLine = await connect({ name: '이억기', session: yiEok.token, account: stranger.welcome.account.token });
  assert.notEqual(yiEokLine.welcome.rank.id, stranger.welcome.account.id, 'a signed-up player never takes over a ranked record the browser happens to hold');

  const carried = await connect({ name: '어영담' });
  const eo = await signUp('eo_yeongdam', 'gwangyang-1592', '어영담', { address: '198.51.100.44', extra: { rankedToken: `imjin-rank-v1:${carried.welcome.account.token}` } });
  assert.equal(eo.user.rankedId, carried.welcome.account.id, 'sign-up carries over the ranked record of the page that signs up');
  assert.equal((await connect({ name: '어영담', session: eo.token })).welcome.rank.id, carried.welcome.account.id);

  const jeong = await signUp('jeong_un', 'nokdo-1592-1592', '정운', { address: '198.51.100.45' });
  await refused(call('POST', '/api/auth/link-ranked', { body: { rankedToken: 'not a code' }, token: jeong.token }), 400, 'ranked-code');
  await refused(call('POST', '/api/auth/link-ranked', { body: { rankedToken: 'a'.repeat(64) }, token: jeong.token }), 400, 'ranked-code');
  const linked = await call('POST', '/api/auth/link-ranked', { body: { rankedToken: stranger.welcome.account.token }, token: jeong.token });
  assert.equal(linked.json.user.rankedId, stranger.welcome.account.id);
  assert.equal((await call('POST', '/api/auth/link-ranked', { body: { rankedToken: stranger.welcome.account.token }, token: jeong.token })).status, 200, 'linking the same record again is harmless');
  await refused(call('POST', '/api/auth/link-ranked', { body: { rankedToken: stranger.welcome.account.token }, token: eo.token }), 409, 'ranked-other');
  await refused(call('POST', '/api/auth/link-ranked', { body: { rankedToken: stranger.welcome.account.token }, token: kwonPhone.token }), 409, 'ranked-other');
  const unlinked = remember(await call('POST', '/api/auth/guest', { address: '198.51.100.46' })).json;
  await refused(call('POST', '/api/auth/link-ranked', { body: { rankedToken: stranger.welcome.account.token }, token: unlinked.token }), 409, 'ranked-taken');

  const stale = await connect({ name: '만료', session: 'A'.repeat(43) });
  assert.equal(stale.welcome.user, undefined);
  assert.match(stale.welcome.account.token, /^[a-f0-9]{64}$/, 'an unknown session plays on as before accounts');
  assert.equal((await stale.next((m) => m.t === 'error')).code, 'session');
  console.log('ok: a session brings the signed-in user\'s ranked account to every device, links it on the first visit, and an unknown session is reported');

  // A seat in a battle comes back to its user, by any of their sessions (also one that has since ended), and to nobody else.
  kwonA.send({ t: 'create', name: '권준의 방', battle: { kind: 'conquest', map: 'hallyeo', size: 2 } });
  await kwonA.next((m) => m.t === 'room' && m.room?.name === '권준의 방');
  kwonA.send({ t: 'start' });
  await kwonA.next((m) => m.t === 'start', 60000);
  kwonA.send({ t: 'loaded' });
  const seatToken = kwonA.welcome.token;
  kwonA.ws.terminate();
  await sleep(100);
  const thief = await connect({ name: '도둑', token: seatToken, session: eo.token }, true);
  assert.equal(thief.welcome.code, 'identity', 'another user\'s session cannot take the seat');
  const anonymousThief = await connect({ name: '도둑', token: seatToken, account: stranger.welcome.account.token }, true);
  assert.equal(anonymousThief.welcome.code, 'identity', 'nor can a recovery code');
  const back = await connect({ name: '권준', token: seatToken, session: kwon.token });
  assert.equal(back.welcome.resumed, true);
  assert.equal(back.welcome.user, kwon.user.id);
  assert.equal((await back.next((m) => m.t === 'start')).resume, true);
  back.ws.terminate();
  await sleep(100);
  const kwonThird = await logIn('kwon_jun', 'admiral-kwon-1592', '198.51.100.51');
  const third = await connect({ name: '권준', token: seatToken, session: kwonThird.token });
  assert.equal(third.welcome.resumed, true, 'another session of the same user takes the seat back');
  assert.equal(third.welcome.rank.id, kwonRanked);
  await call('POST', '/api/auth/logout', { token: kwonThird.token });
  third.ws.terminate();
  await sleep(100);
  const afterLogout = await connect({ name: '권준', token: seatToken, session: kwonThird.token });
  assert.equal(afterLogout.welcome.resumed, true, 'the tab holding the seat and its session gets back into its battle after that session ended');
  afterLogout.send({ t: 'leave' });
  await afterLogout.next((m) => m.t === 'room' && m.room === null);
  console.log('ok: a battle seat taken with a session goes back to its user only');

  // Ranked between two signed-in players; a result reaches their other devices through the account.
  const p = await signUp('song_huiip', 'jeolla-left-1592', '송희립', { address: '198.51.100.47' });
  const q = await signUp('na_daeyong', 'turtle-maker-1592', '나대용', { address: '198.51.100.48' });
  const pLine = await connect({ name: '송희립', session: p.token });
  const qLine = await connect({ name: '나대용', session: q.token });
  pLine.send({ t: 'ranked', faction: 'joseon' });
  await pLine.next((m) => m.t === 'ranked' && m.state === 'searching');
  const pPhone = await logIn('song_huiip', 'jeolla-left-1592', '198.51.100.49');
  const pSecond = await connect({ name: '송희립', session: pPhone.token });
  assert.equal(pSecond.welcome.rank.id, pLine.welcome.rank.id);
  pSecond.send({ t: 'ranked', faction: 'japan' });
  assert.equal((await pSecond.next((m) => m.t === 'error')).code, 'ranked', 'one ranked account queues once, whichever device it is on');
  qLine.send({ t: 'ranked', faction: 'japan' });
  const [pStart, qStart] = await Promise.all([pLine.next((m) => m.t === 'start', 60000), qLine.next((m) => m.t === 'start', 60000)]);
  assert.equal(pStart.matchId, qStart.matchId);
  const begin = journal().find((e) => e.t === 'begin' && e.id === pStart.matchId);
  assert.deepEqual(begin.players.map((x) => x.id).sort(), [pLine.welcome.rank.id, qLine.welcome.rank.id].sort());
  pLine.send({ t: 'loaded' });
  qLine.send({ t: 'loaded' });
  pLine.send({ t: 'leave' });
  const win = await qLine.next((m) => m.t === 'rankedResult');
  assert.equal(win.result, 'win');
  const pThird = await connect({ name: '송희립', session: (await logIn('song_huiip', 'jeolla-left-1592', '198.51.100.50')).token });
  assert.equal(pThird.welcome.rank.games, 1, 'the result is on the account\'s ranked record on every device');
  console.log('ok: two signed-in players play ranked with their linked accounts, and the record follows them to another device');

  // A restart keeps users, sessions, profiles and links.
  store.close();
  await stop();
  await start();
  assert.equal((await health()).accountsReady, true);
  const kept = await call('GET', '/api/me', { token: guest.token });
  assert.equal(kept.status, 200);
  assert.equal(kept.json.user.nickname, '충무공');
  assert.deepEqual(kept.json.profile, { data: { fleet: ['geobukseon'] }, rev: 1 });
  assert.equal((await logIn('admiral_yi', password, '198.51.100.60')).user.id, yi.user.id);
  assert.equal((await logIn('yu_seongnyong', 'panokseon-1597', '198.51.100.60')).user.id, yu.user.id);
  const kwonAgain = await connect({ name: '권준', session: kwonPhone.token });
  assert.equal(kwonAgain.welcome.rank.id, kwonRanked);
  console.log('ok: users, sessions, profiles and ranked links survive a restart');

  // A store that cannot open turns accounts off; the game still serves.
  await stop();
  await start({ ACCOUNTS_DB: temporary });
  assert.equal((await health()).accountsReady, false);
  await refused(call('POST', '/api/auth/guest'), 503, 'unavailable');
  const casual = await connect({ name: '무계정', session: guest.token });
  assert.equal(casual.welcome.user, undefined);
  casual.send({ t: 'ping', at: 5 });
  await casual.next((m) => m.t === 'pong' && m.at === 5);
  assert.ok(!casual.inbox.some((m) => m.t === 'error'), 'a session that cannot be checked is not reported as ended');
  assert.match(output, /accounts unavailable/);
  console.log('ok: when the accounts store cannot open, the API answers 503 and online play goes on');
  await stop();

  for (const secret of secrets) assert.ok(!allOutput.includes(secret), 'no token, recovery code or password reaches the server log');
  console.log('accounts regression passed');
} finally {
  store?.close();
  await stop();
  if (!temporary.startsWith(join(tmpdir(), 'imjin-accounts-regression-'))) throw new Error('unexpected temporary directory');
  await rm(temporary, { recursive: true, force: true });
}
