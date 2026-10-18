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
      "export * as B from './src/meta/battle.ts'", "export * as L from './src/meta/loot.ts'", "export * as C from './src/meta/catalog.ts'", "export * as F from './src/meta/fleet.ts'", "export { buildScenario } from './src/sim/scenarios.ts'",
    ].join(';\n'),
    resolveDir: root, loader: 'ts',
  },
  outfile: file, platform: 'node', format: 'cjs', bundle: true, external: ['pg-native'], logLevel: 'silent',
});
const m = createRequire(import.meta.url)(file);
const { R, A, C, L, F } = m;

async function suite(name, store, sql = null) {
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

    await check('equipment, talents and respec follow the rules, and a stored salt or purse sent by a page is ignored', async () => {
      const worn = await ok('POST', '/meta/equip', { general: 'yi', armor: 'yi_tongjesa' }, token);
      assert.equal(worn.profile.generals.yi.armor, 'yi_tongjesa');
      assert.equal((await call('POST', '/meta/equip', { general: 'wakisaka', armor: 'yi_tongjesa' }, token)).json.error.text, '다른 나라의 갑옷입니다');
      const armed = await ok('POST', '/meta/weapon', { general: 'yi', weapon: 'joseon_jangchang' }, token);
      assert.equal(armed.profile.generals.yi.weapon, 'joseon_jangchang');
      const step = 'gunnery.powder';
      assert.equal((await call('POST', '/meta/learn', { general: 'yi', skill: step }, token)).json.error.text, '이 가지에 2점을 쓰면 열립니다');
      await ok('POST', '/meta/learn', { general: 'yi', skill: 'gunnery.rapid' }, token);
      const learned = await ok('POST', '/meta/learn', { general: 'yi', skill: 'gunnery.rapid' }, token);
      assert.deepEqual(learned.profile.generals.yi.talents, { 'gunnery.rapid': 2 });
      await ok('POST', '/meta/learn', { general: 'yi', skill: step }, token);
      assert.equal((await call('POST', '/meta/learn', { general: 'yi', skill: 'gunnery.aim' }, token)).json.error.text, '남은 재능 점수가 없습니다');
      const reset = await ok('POST', '/meta/respec', { general: 'yi' }, token);
      assert.deepEqual(reset.profile.generals.yi.talents, {});
      assert.equal(reset.profile.coins, learned.profile.coins, 'the first reset is free');
      await ok('POST', '/meta/learn', { general: 'yi', skill: 'gunnery.aim' }, token);
      const paidReset = await ok('POST', '/meta/respec', { general: 'yi' }, token);
      assert.equal(reset.profile.coins - paidReset.profile.coins, R.RESPEC_PER_LEVEL * 4);
      assert.equal((await store.ledger(id, 'coin'))[0].reason, 'respec');
      assert.equal((await call('POST', '/meta/equip', { general: 'yi' }, token)).status, 400);
    });

    await check('a browser profile is carried over once, as choices only: no coins, experience or rolls of its own', async () => {
      const other = await ok('POST', '/auth/guest', {});
      const forged = { ...R.newProfile(), coins: 9999999, salt: 'forged', owned: ['won_heukcheol'], rolls: { won_heukcheol: { seed: 42, rerolls: 7 } }, generals: { won: { xp: 99999, talents: { 'boarding.hooks': 2 }, armor: 'won_heukcheol', weapon: 'joseon_dangpa' } }, items: [{ uid: 'x', base: 'b_sonja', rarity: 'legendary', rerolls: 0, seed: 1 }] };
      const r = await ok('POST', '/meta/import', { profile: forged }, other.token);
      assert.equal(r.imported, true);
      assert.equal(r.profile.salt, other.user.id);
      assert.ok(r.profile.coins < 12000, 'the armor is bought again from the server purse');
      assert.equal(r.profile.rolls.won_heukcheol.rerolls, 0);
      assert.equal(r.profile.rolls.won_heukcheol.seed, A.armorSeed(other.user.id, 'won_heukcheol', 0));
      assert.equal(r.profile.generals.won.xp, 600);
      assert.equal(r.profile.generals.won.armor, 'won_heukcheol');
      assert.equal(r.profile.generals.won.weapon, 'joseon_dangpa');
      assert.deepEqual(r.profile.items, [], 'loot is never carried over');
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
      // Loot: rolled from the account id and the drop counter (verifiable), a first win adds a 희귀+ piece, and every
      // piece is a line of the item ledger.
      assert.ok(paid.reward.drops.length >= 2);
      assert.equal(paid.profile.drops, before.drops + 1);
      const expect = L.rollDrops(id, before.drops, { result: 'win', stars: 3, sunk: 10, firstWin: true, side: 'joseon' });
      assert.deepEqual(paid.reward.drops.map((d) => [d.uid, d.base, d.rarity]), expect.map((d) => [d.uid, d.base, d.rarity]));
      for (const d of paid.reward.drops) assert.equal(d.seed, L.itemSeed(id, d.uid, 0));
      assert.equal(await store.balance(id, 'item'), paid.profile.items.length);
      const loot = paid.profile.items[0];
      const slot = L.itemBase(loot.base).slot;
      const geared = await ok('POST', '/meta/item/equip', { general: 'yi', slot, item: loot.uid }, token);
      assert.equal(geared.profile.generals.yi.gear[slot], loot.uid);
      assert.equal((await call('POST', '/meta/item/equip', { general: 'yi', slot: 'nope', item: loot.uid }, token)).status, 400);
      assert.equal((await call('POST', '/meta/item/equip', { general: 'yi', slot, item: 'zz' }, token)).json.error.text, '가지지 않은 물건입니다');
      const reforged = await ok('POST', '/meta/item/reforge', { item: loot.uid }, token);
      assert.equal(reforged.profile.items[0].seed, L.itemSeed(id, loot.uid, 1));
      assert.equal(geared.profile.coins - reforged.profile.coins, L.REFORGE[loot.rarity]);
      const broken = await ok('POST', '/meta/item/salvage', { item: loot.uid }, token);
      assert.equal(broken.profile.coins - reforged.profile.coins, L.SALVAGE[loot.rarity]);
      assert.equal(broken.profile.generals.yi.gear?.[slot], undefined);
      assert.equal(await store.balance(id, 'item'), broken.profile.items.length);
      assert.equal((await store.ledger(id, 'item'))[0].reason, 'salvage');
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

    await check('the profile lives in its tables, not in the JSON; loot no longer held is kept as salvaged', async () => {
      const stored = await store.profile(id);
      assert.equal(stored.data.meta, undefined, 'no JSON copy of the profile');
      if (!sql) return;
      const p = (await ok('GET', '/meta', undefined, token)).profile;
      const held = await sql('SELECT item_uid, def_id, rarity, seed, reforge_count FROM items WHERE user_id = $1 AND salvaged_at IS NULL ORDER BY pos', [id]);
      assert.deepEqual(held.map((r) => [r.item_uid, r.def_id, r.rarity, Number(r.seed), r.reforge_count]), p.items.map((i) => [i.uid, i.base, i.rarity, i.seed, i.rerolls]));
      assert.ok((await sql('SELECT count(*)::integer AS n FROM items WHERE user_id = $1 AND salvaged_at IS NOT NULL', [id]))[0].n >= 1, 'the salvaged piece stays as a row');
      const [yi] = await sql("SELECT xp, level, talents FROM commander_progress WHERE user_id = $1 AND commander_id = 'yi'", [id]);
      assert.equal(Number(yi.xp), p.generals.yi.xp);
      assert.equal(yi.level, R.levelOf(p.generals.yi.xp));
      assert.deepEqual(yi.talents, p.generals.yi.talents);
      const worn = await sql('SELECT commander_id, slot, item_uid FROM equipment WHERE user_id = $1', [id]);
      const gear = Object.entries(p.generals).flatMap(([g, s]) => Object.entries(s.gear ?? {}).map(([slot, uid]) => [g, slot, uid]));
      assert.deepEqual(worn.map((r) => [r.commander_id, r.slot, r.item_uid]).sort(), gear.sort());
      await assert.rejects(sql("INSERT INTO equipment (user_id, commander_id, slot, item_uid) VALUES ($1, 'yi', 'seal', 'no-such')", [id]), /foreign key/);
    });

    await check('a v2 JSON profile moves into the tables once (start-up sweep), keeping its choices and paying nothing', async () => {
      const source = (await ok('GET', '/meta', undefined, token)).profile;
      const other = await ok('POST', '/auth/guest', {});
      const json = { ...source, v: 2, coins: 777777, salt: 'forged' };
      json.generals = { ...source.generals, yi: { ...source.generals.yi, xp: 5000 } };
      await store.updateProfile(other.user.id, null, (data) => { data.meta = json; });
      assert.deepEqual(await store.jsonMetaUsers(10), [other.user.id]);
      const lines = (await store.ledger(other.user.id)).length;
      assert.equal(await m.migrateJsonMeta(store), 1);
      assert.deepEqual(await store.jsonMetaUsers(10), [], 'nothing left as JSON');
      assert.equal(await m.migrateJsonMeta(store), 0, 'a second run moves nothing');
      assert.equal((await store.profile(other.user.id)).data.meta, undefined);
      const want = R.normalizeProfile({ ...json, salt: other.user.id }, other.user.id);
      const got = (await ok('GET', '/meta', undefined, other.token)).profile;
      assert.equal(got.coins, 0, 'the JSON coins are not money: the ledger is the purse');
      assert.equal(got.salt, other.user.id);
      for (const key of ['owned', 'rolls', 'items', 'stats', 'firsts', 'drops', 'dropped']) assert.deepEqual(got[key], want[key], key);
      for (const [g, s] of Object.entries(want.generals)) assert.deepEqual(got.generals[g], s, g);
      assert.equal((await store.ledger(other.user.id)).length, lines + 0, 'moving writes no ledger line');
      if (sql) {
        assert.equal((await sql('SELECT count(*)::integer AS n FROM items WHERE user_id = $1', [other.user.id]))[0].n, want.items.length);
        assert.equal((await sql("SELECT level FROM commander_progress WHERE user_id = $1 AND commander_id = 'yi'", [other.user.id]))[0].level, R.levelOf(5000));
      }
      // The rollback path: the rows written back as the JSON of schema 1 read as the same profile.
      assert.equal(await m.exportJsonMeta(store, other.user.id), true);
      const back = R.normalizeProfile((await store.profile(other.user.id)).data.meta, other.user.id);
      for (const key of ['owned', 'rolls', 'items', 'generals', 'stats']) assert.deepEqual(back[key], got[key], `exported ${key}`);
    });

    await check('the account navy: one nation on first entry, recruits and hulls paid through the ledger, kept across sessions, one change', async () => {
      const g = await ok('POST', '/auth/guest', {});
      const fresh = await ok('GET', '/meta', undefined, g.token);
      assert.equal(fresh.profile.nation, null);
      assert.equal((await call('POST', '/meta/recruit', { general: 'kwon' }, g.token)).json.error.text, '먼저 나라를 고르세요');
      assert.equal((await call('POST', '/meta/nation', { nation: 'atlantis' }, g.token)).json.error.text, '고를 수 없는 나라입니다');
      const chosen = await ok('POST', '/meta/nation', { nation: 'joseon' }, g.token);
      assert.equal(chosen.profile.nation, 'joseon');
      assert.deepEqual(chosen.profile.recruited, ['eokgi', 'won', 'yi']);
      assert.deepEqual(chosen.profile.ships, F.startingFleet('joseon'));
      assert.equal(chosen.profile.coins, 12000, 'choosing is free');
      assert.equal((await call('POST', '/meta/learn', { general: 'wakisaka', skill: 'gunnery.rapid' }, g.token)).json.error.text, '다른 나라의 제독입니다');
      assert.equal((await call('POST', '/meta/learn', { general: 'kwon', skill: 'gunnery.rapid' }, g.token)).json.error.text, '아직 맞이하지 않은 제독입니다');
      const hired = await ok('POST', '/meta/recruit', { general: 'kwon' }, g.token);
      assert.ok(hired.profile.recruited.includes('kwon'));
      assert.equal(hired.profile.coins, 12000 - F.RECRUIT_PRICE);
      const built = await ok('POST', '/meta/ship', { kind: 'geobukseon', count: 2 }, g.token);
      assert.equal(built.profile.ships.geobukseon, (chosen.profile.ships.geobukseon ?? 0) + 2);
      assert.equal(built.profile.coins, hired.profile.coins - 2 * F.shipPrice('geobukseon'));
      assert.equal(built.profile.coins, await store.balance(g.user.id, 'coin'));
      assert.equal((await call('POST', '/meta/ship', { kind: 'atakebune' }, g.token)).json.error.text, '이 나라가 지을 수 없는 배입니다');
      assert.equal((await call('POST', '/meta/ship', { kind: 'geobukseon', count: 'x' }, g.token)).status, 400);
      const again = await ok('GET', '/meta', undefined, g.token);
      assert.equal(again.profile.nation, 'joseon', 'the navy is kept');
      assert.deepEqual(again.profile.ships, built.profile.ships);
      assert.deepEqual(again.profile.recruited, built.profile.recruited);
      const value = F.fleetValue(again.profile);
      const changed = await ok('POST', '/meta/nation', { nation: 'japan' }, g.token);
      assert.equal(changed.profile.nation, 'japan');
      assert.equal(changed.profile.coins, again.profile.coins + Math.floor(value * F.SELLBACK), 'the old hulls are sold back at half');
      assert.deepEqual(changed.profile.ships, F.startingFleet('japan'));
      assert.ok(changed.profile.recruited.includes('kwon') && changed.profile.recruited.includes('wakisaka'), 'old admirals stay on the profile');
      assert.equal(changed.profile.generals.kwon !== undefined, true);
      assert.equal((await call('POST', '/meta/nation', { nation: 'ming' }, g.token)).json.error.text, '나라는 한 번만 바꿀 수 있습니다');
      assert.equal((await call('POST', '/meta/learn', { general: 'kwon', skill: 'gunnery.rapid' }, g.token)).json.error.text, '다른 나라의 제독입니다');
      // A browser's own navy comes over with the import, bought again from the server's purse.
      const h = await ok('POST', '/auth/guest', {});
      const local = { ...R.newProfile(), nation: 'ming', recruited: ['chenlin', 'deng', 'magui'], ships: { ...F.startingFleet('ming'), mingship: 99 } };
      const imported = await ok('POST', '/meta/import', { profile: local }, h.token);
      assert.equal(imported.profile.nation, 'ming');
      assert.ok(imported.profile.recruited.includes('magui'));
      assert.ok(imported.profile.coins >= 0);
      assert.ok((imported.profile.ships.mingship ?? 0) <= R.MAX_SHIPS_PER_KIND);
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
      const client = new pg.Client({ connectionString: target.toString() });
      await client.connect();
      try {
        await suite('postgres', new m.PgAccountStore(m.databaseConfig({ DATABASE_URL: target.toString() })), async (text, values) => (await client.query(text, values)).rows);
      } finally {
        await client.end();
      }
    } finally {
      await admin.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
      await admin.end();
    }
  } else console.log('test-meta-server: postgres skipped (set DATABASE_TEST_URL to a throwaway PostgreSQL)');
  console.log('all passed');
} finally {
  await rm(directory, { recursive: true, force: true });
}
