// The growth routes (server/meta.ts) through the real HTTP API on a free port: a guest's profile with its starting
// grant, purchases and rerolls paid through the coin ledger and rolled from the account id, equipment, skills, the
// one-time import of a browser's own profile (only its choices), and the rewards of a battle against the computer.
// On the store kept in memory; with DATABASE_TEST_URL also on a throwaway PostgreSQL database (made and dropped here).
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('..', import.meta.url));
const directory = await mkdtemp(join(tmpdir(), 'imjin-meta-'));
const file = join(directory, 'meta.cjs');
await build({
  stdin: {
    contents: [
      "export * from './server/accounts.ts'", "export * from './server/accountsMemory.ts'", "export * from './server/accountsPg.ts'", "export * from './server/api.ts'",
      "export * from './server/auth.ts'", "export * from './server/meta.ts'", "export * as R from './src/meta/rules.ts'", "export * as A from './src/meta/affixes.ts'",
      "export * as B from './src/meta/battle.ts'", "export * as C from './src/meta/catalog.ts'", "export { buildScenario } from './src/sim/scenarios.ts'",
    ].join(';\n'),
    resolveDir: root, loader: 'ts',
  },
  outfile: file, platform: 'node', format: 'cjs', bundle: true, external: ['pg-native'], logLevel: 'silent',
});
const m = createRequire(import.meta.url)(file);
const { R, A, C } = m;

async function suite(name, store) {
  while (!store.ready) await new Promise((r) => setTimeout(r, 100));
  const api = new m.ApiRouter(store);
  m.authRoutes(api, null);
  m.metaRoutes(api);
  const http = createServer((req, res) => { if (!api.handle(req, res)) { res.writeHead(404); res.end(); } });
  await new Promise((r) => http.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${http.address().port}/api`;
  const call = async (method, path, body, token) => {
    const res = await fetch(base + path, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, json: await res.json() };
  };
  const ok = async (method, path, body, token) => {
    const r = await call(method, path, body, token);
    assert.equal(r.status, 200, `${path}: ${JSON.stringify(r.json)}`);
    return r.json;
  };
  let n = 0;
  const check = async (title, fn) => { await fn(); n++; console.log(`ok   [${name}] ${title}`); };
  try {
    const guest = await ok('POST', '/auth/guest', {});
    const token = guest.token;
    const id = guest.user.id;

    await check('a new account profile gets the starting grant once, as ledger coins, salted with the account id', async () => {
      const a = await ok('GET', '/meta', undefined, token);
      assert.equal(a.profile.coins, 12000);
      assert.equal(a.profile.salt, id);
      assert.equal(a.profile.generals.yi.xp, 600);
      const b = await ok('GET', '/meta', undefined, token);
      assert.equal(b.profile.coins, 12000, 'the grant is paid once');
      assert.equal(await store.balance(id, 'coin'), 12000);
      assert.equal((await call('GET', '/meta')).status, 401, 'no session, no profile');
    });

    await check('buying pays from the ledger and rolls from the account id; a reroll pays and moves the chain', async () => {
      const bought = await ok('POST', '/meta/buy', { armor: 'yi_tongjesa' }, token);
      assert.ok(bought.profile.owned.includes('yi_tongjesa'));
      assert.equal(bought.profile.rolls.yi_tongjesa.seed, A.armorSeed(id, 'yi_tongjesa', 0));
      assert.equal(bought.profile.coins, await store.balance(id, 'coin'));
      assert.equal(bought.profile.coins, 12000 - C.armorById('yi_tongjesa').price);
      const again = await call('POST', '/meta/buy', { armor: 'yi_tongjesa' }, token);
      assert.equal(again.status, 409);
      assert.equal(again.json.error.text, '이미 가진 갑옷입니다');
      const rerolled = await ok('POST', '/meta/reroll', { armor: 'yi_tongjesa' }, token);
      assert.equal(rerolled.profile.rolls.yi_tongjesa.rerolls, 1);
      assert.equal(rerolled.profile.rolls.yi_tongjesa.seed, A.armorSeed(id, 'yi_tongjesa', 1));
      assert.equal(bought.profile.coins - rerolled.profile.coins, A.rerollCost(C.armorById('yi_tongjesa')));
      const reasons = (await store.ledger(id, 'coin')).map((e) => e.reason);
      assert.deepEqual(reasons.slice(0, 3), ['reroll', 'buy', 'meta-start']);
    });

    await check('equipment and skills follow the rules, and a stored salt or purse sent by a page is ignored', async () => {
      const worn = await ok('POST', '/meta/equip', { general: 'yi', armor: 'yi_tongjesa' }, token);
      assert.equal(worn.profile.generals.yi.armor, 'yi_tongjesa');
      assert.equal((await call('POST', '/meta/equip', { general: 'wakisaka', armor: 'yi_tongjesa' }, token)).json.error.text, '다른 나라의 갑옷입니다');
      const armed = await ok('POST', '/meta/weapon', { general: 'yi', weapon: 'joseon_jangchang' }, token);
      assert.equal(armed.profile.generals.yi.weapon, 'joseon_jangchang');
      const step = R.skillsFor('yi')[0].id;
      const learned = await ok('POST', '/meta/learn', { general: 'yi', skill: step }, token);
      assert.deepEqual(learned.profile.generals.yi.skills, [step]);
      assert.equal((await call('POST', '/meta/learn', { general: 'yi', skill: step }, token)).json.error.text, '이미 익혔습니다');
      assert.equal((await call('POST', '/meta/equip', { general: 'yi' }, token)).status, 400);
    });

    await check('a browser profile is carried over once, as choices only: no coins, experience or rolls of its own', async () => {
      const other = await ok('POST', '/auth/guest', {});
      const forged = { ...R.newProfile(), coins: 9999999, salt: 'forged', owned: ['won_heukcheol'], rolls: { won_heukcheol: { seed: 42, rerolls: 7 } }, generals: { won: { xp: 99999, skills: [], armor: 'won_heukcheol', weapon: 'joseon_dangpa' } } };
      const r = await ok('POST', '/meta/import', { profile: forged }, other.token);
      assert.equal(r.imported, true);
      assert.equal(r.profile.salt, other.user.id);
      assert.ok(r.profile.coins < 12000, 'the armor is bought again from the server purse');
      assert.equal(r.profile.rolls.won_heukcheol.rerolls, 0);
      assert.equal(r.profile.rolls.won_heukcheol.seed, A.armorSeed(other.user.id, 'won_heukcheol', 0));
      assert.equal(r.profile.generals.won.xp, 600);
      assert.equal(r.profile.generals.won.armor, 'won_heukcheol');
      assert.equal(r.profile.generals.won.weapon, 'joseon_dangpa');
      const twice = await ok('POST', '/meta/import', { profile: forged }, other.token);
      assert.equal(twice.imported, false);
      assert.equal(twice.profile.coins, r.profile.coins);
    });

    await check('a battle against the computer pays once, judged against what the server knows of it', async () => {
      const before = (await ok('GET', '/meta', undefined, token)).profile;
      const { ticket } = await ok('POST', '/meta/battle/start', { mode: 'history', scenario: 'hansan', side: 'joseon', ownShips: 1, enemyShips: 1, generals: ['yi'] }, token);
      const report = { result: 'win', stars: 3, sunk: 10, lost: 0, simSeconds: 25, generals: [{ id: 'yi', sunk: 4 }] };
      const paid = await ok('POST', '/meta/battle/finish', { ticket, report }, token);
      assert.ok(paid.reward.coins > 0);
      assert.equal(paid.profile.coins, before.coins + paid.reward.coins);
      assert.ok(paid.profile.generals.yi.xp > before.generals.yi.xp);
      assert.equal(paid.profile.stats.wins, before.stats.wins + 1);
      assert.equal((await call('POST', '/meta/battle/finish', { ticket, report }, token)).status, 409, 'a ticket pays once');
      const forged = await ok('POST', '/meta/battle/start', { mode: 'history', scenario: 'hansan', side: 'joseon' }, token);
      assert.equal((await call('POST', '/meta/battle/finish', { ticket: forged.ticket, report: { ...report, sunk: 9999 } }, token)).status, 409, 'more ships sunk than the enemy had');
      assert.equal((await call('POST', '/meta/battle/finish', { ticket: forged.ticket, report: { ...report, generals: [{ id: 'wakisaka', sunk: 0 }] } }, token)).status, 409, 'a general who did not lead');
      const theirs = await ok('POST', '/auth/guest', {});
      assert.equal((await call('POST', '/meta/battle/finish', { ticket: forged.ticket, report }, theirs.token)).status, 409, 'only its own player reports a battle');
    });

    await check('a battle the server ran pays every signed-in seat, uncapped', async () => {
      const b = m.buildScenario('hansan', 0, 1592);
      for (const s of b.ships.filter((s) => s.team === 'japan').slice(0, 3)) s.alive = false;
      b.winner = 'joseon';
      b.time = 900;
      const before = (await ok('GET', '/meta', undefined, token)).profile;
      await m.payServerBattle(store, id, b, 0, 'joseon', 'joseon', 'online', 'scenario:hansan');
      const after = (await ok('GET', '/meta', undefined, token)).profile;
      assert.equal(after.stats.battles, before.stats.battles + 1);
      assert.ok(after.coins > before.coins);
      assert.equal(after.coins, await store.balance(id, 'coin'));
    });
  } finally {
    http.close();
    await store.close();
  }
  return n;
}

try {
  await suite('memory', new m.MemoryAccountStore());
  const given = process.env.DATABASE_TEST_URL;
  if (given) {
    const pg = (await import('pg')).default;
    const database = `imjin_meta_${randomBytes(4).toString('hex')}`;
    const target = new URL(given);
    target.pathname = `/${database}`;
    const admin = new pg.Client({ connectionString: given });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${database}`);
    try {
      await suite('postgres', new m.PgAccountStore(m.databaseConfig({ DATABASE_URL: target.toString() })));
    } finally {
      await admin.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
      await admin.end();
    }
  } else console.log('test-meta-server: postgres skipped (set DATABASE_TEST_URL to a throwaway PostgreSQL)');
  console.log('all passed');
} finally {
  await rm(directory, { recursive: true, force: true });
}
