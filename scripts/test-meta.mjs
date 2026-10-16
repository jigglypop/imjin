// Regression checks for an account's growth (src/meta): the catalog of generals and armor, levels and skill trees,
// buying and wearing armor, what a battle pays, the plausibility test of a single-player report, and the factors a
// general gives his squadron in a battle.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const server = await createServer({ root, configFile: false, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false }, optimizeDeps: { noDiscovery: true, include: [] } });
let failed = 0;
const check = (name, fn) => { try { fn(); console.log('ok   ' + name); } catch (e) { failed++; console.error('FAIL ' + name + '\n' + e.stack); } };
try {
  const load = (p) => server.ssrLoadModule(p);
  const C = await load('/src/meta/catalog.ts');
  const R = await load('/src/meta/rules.ts');
  const M = await load('/src/meta/battle.ts');
  const { TREES } = await load('/src/sim/grand/growthData.ts');
  const { buildScenario } = await load('/src/sim/scenarios.ts');
  const close = (a, b) => Math.abs(a - b) < 1e-12;

  check('the catalog: unique ids, a basic armor per navy, prices by tier, signatures only for famous generals of their navy', () => {
    const ids = C.ARMORS.map((a) => a.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const f of ['joseon', 'japan', 'ming']) assert.equal(C.ARMORS.filter((a) => a.faction === f && a.tier === 'basic').length, 1);
    for (const a of C.ARMORS) {
      assert.equal(a.price, C.TIER_PRICE[a.tier], a.id);
      assert.ok(a.name && a.line, a.id);
      if (a.tier === 'signature') {
        const g = C.generalById(a.general);
        assert.ok(g && g.famous && g.faction === a.faction, a.id);
      } else assert.equal(a.general, undefined, a.id);
      for (const v of Object.values(a.effect)) assert.ok(v >= 1 && v <= 1.1, a.id);
    }
    for (const g of C.GENERALS) {
      assert.ok(TREES[g.id], `${g.id} has a tree`);
      assert.ok(existsSync(join(root, 'public', 'ui', 'portraits', `portrait_${g.id}.webp`)), `${g.id} has a portrait`);
      if (g.famous) assert.equal(C.ARMORS.filter((a) => a.general === g.id).length, 1, `${g.id} has one signature`);
    }
  });

  check('levels: 100 xp for the second level, 200 more for the third, capped at 10', () => {
    assert.equal(R.xpFor(1), 0);
    assert.equal(R.xpFor(2), 100);
    assert.equal(R.xpFor(3), 300);
    assert.equal(R.levelOf(99), 1);
    assert.equal(R.levelOf(100), 2);
    assert.equal(R.levelOf(R.xpFor(10)), 10);
    assert.equal(R.levelOf(1e12), 10);
    assert.deepEqual(R.levelProgress(150), { level: 2, into: 50, need: 200 });
    assert.equal(R.levelProgress(1e9).need, null);
  });

  check('a stored profile is cleaned: unknown generals, skills and armor dropped, counts made whole and positive', () => {
    const p = R.normalizeProfile({ coins: 12.7, owned: ['joseon_swaeja', 'nope', 'joseon_dujeong', 'joseon_swaeja'], generals: { yi: { xp: -5, skills: ['gunnery1', 'boarding1', 'x'], armor: 'japan_oyoroi' }, ghost: { xp: 9 } }, stats: { wins: 'a' }, firsts: ['b', 'a', 'a'] });
    assert.equal(p.coins, 12);
    assert.deepEqual(p.owned, ['joseon_swaeja']);
    assert.deepEqual(p.generals.yi, { xp: 0, skills: ['gunnery1'] });
    assert.equal(p.generals.ghost, undefined);
    assert.deepEqual(p.stats, { battles: 0, wins: 0, sunk: 0, lost: 0 });
    assert.deepEqual(p.firsts, ['a', 'b']);
    assert.deepEqual(R.normalizeProfile(null), R.newProfile());
  });

  check('skills: one point a level, steps in order, mastery at level 6, only from the general\'s own branches', () => {
    let p = R.newProfile();
    assert.equal(R.learnProblem(p, 'yi', 'gunnery1'), '남은 재능 점수가 없습니다');
    p = { ...p, generals: { yi: { xp: R.xpFor(3), skills: [] } } };
    assert.equal(R.skillPointsLeft(p, 'yi'), 2);
    assert.equal(R.learnProblem(p, 'yi', 'gunnery2'), '앞 단계를 먼저 익혀야 합니다');
    assert.equal(R.learnProblem(p, 'yi', 'boarding1'), '이 장수가 배울 수 없는 재능입니다');
    assert.equal(R.learnProblem(p, 'yi', 'mastery'), '6레벨에 익힐 수 있습니다');
    p = R.learn(R.learn(p, 'yi', 'gunnery1'), 'yi', 'gunnery2');
    assert.deepEqual(p.generals.yi.skills, ['gunnery1', 'gunnery2']);
    assert.throws(() => R.learn(p, 'yi', 'gunnery3'), R.RuleError);
    p = { ...p, generals: { yi: { ...p.generals.yi, xp: R.xpFor(6) } } };
    assert.equal(R.learnProblem(p, 'yi', 'mastery'), null);
  });

  check('armor: bought once with enough coins, worn only by a general of its navy, signatures by their general alone', () => {
    let p = { ...R.newProfile(), coins: 10000 };
    assert.equal(R.buyProblem(p, 'joseon_dujeong'), '살 수 없는 갑옷입니다');
    p = R.buy(p, 'yi_tongjesa').profile;
    assert.equal(p.coins, 1000);
    assert.equal(R.buyProblem(p, 'yi_tongjesa'), '이미 가진 갑옷입니다');
    assert.equal(R.buyProblem(p, 'joseon_eorin'), '엽전이 모자랍니다');
    assert.equal(R.equipProblem(p, 'won', 'yi_tongjesa'), '다른 장수의 전용 갑옷입니다');
    assert.equal(R.equipProblem(p, 'wakisaka', 'joseon_pigap'), '다른 나라의 갑옷입니다');
    assert.equal(R.equipProblem(p, 'yi', 'joseon_pigap'), '아직 가지지 않은 갑옷입니다');
    p = R.equip(p, 'yi', 'yi_tongjesa');
    assert.equal(R.wornArmor(p, 'yi').id, 'yi_tongjesa');
    assert.equal(R.wornArmor(p, 'won').id, 'joseon_dujeong');
    p = R.equip(p, 'yi', null);
    assert.equal(p.generals.yi.armor, undefined);
    assert.equal(R.wornArmor(p, 'yi').id, 'joseon_dujeong');
  });

  check('a general\'s factors: his trait, his steps and his armor multiply; the campaign-only march, xp and temper are left out', () => {
    let p = { ...R.newProfile(), coins: 9000, generals: { yi: { xp: R.xpFor(2), skills: ['gunnery1'] } } };
    p = R.equip(R.buy(p, 'yi_tongjesa').profile, 'yi', 'yi_tongjesa');
    const m = R.generalMods(p, 'yi');
    assert.ok(close(m.accuracy, 1.06 * 1.03));
    assert.ok(close(m.morale, 1.06 * 1.06));
    assert.ok(close(m.defense, 1.06));
    assert.ok(close(m.reload, 1.05));
    assert.equal(m.speed, 1);
    assert.deepEqual(Object.keys(m).sort(), Object.keys(R.NEUTRAL_MODS).sort());
  });

  const report = (o = {}) => ({ mode: 'history', scenario: 'hansan', side: 'joseon', result: 'win', stars: 2, sunk: 10, lost: 1, simSeconds: 900, generals: [{ id: 'yi', sunk: 6 }, { id: 'eokgi', sunk: 2 }], ...o });

  check('a battle pays for the result and the ships sunk, a first victory and a first three stars once, experience to who led', () => {
    const first = R.rewardFor(R.newProfile(), report({ stars: 3 }), '2026-10-16', false);
    assert.equal(first.reward.coins, 120 + 30 + 300 + 300);
    assert.deepEqual(first.reward.bonuses.map((b) => b.key), ['win:history:hansan:joseon', 'stars3:history:hansan:joseon']);
    assert.equal(first.reward.xp.yi, Math.round((40 + 24) * 1.5));
    assert.equal(first.reward.levels.yi, undefined);
    assert.deepEqual(first.profile.stats, { battles: 1, wins: 1, sunk: 10, lost: 1 });
    const again = R.rewardFor(first.profile, report({ stars: 3 }), '2026-10-16', false);
    assert.equal(again.reward.coins, 150);
    assert.deepEqual(again.reward.bonuses, []);
    const loss = R.rewardFor(R.newProfile(), report({ result: 'loss', sunk: 100, generals: [{ id: 'yi', sunk: 100 }] }), '2026-10-16', false);
    assert.equal(loss.reward.coins, 30 + 120);
    assert.equal(loss.reward.xp.yi, 40 + 120);
    assert.equal(loss.reward.levels.yi, 2);
  });

  check('single-player coins stop at the daily cap and start again the next day; online results and one-time bonuses are not capped', () => {
    let p = { ...R.newProfile(), day: '2026-10-16', earned: R.DAILY_CAP - 100 };
    const r = R.rewardFor(p, report(), '2026-10-16', false);
    assert.equal(r.reward.capped, true);
    assert.equal(r.reward.coins, 100 + 300);
    assert.equal(r.profile.earned, R.DAILY_CAP);
    const next = R.rewardFor(r.profile, report(), '2026-10-17', false);
    assert.equal(next.reward.capped, false);
    assert.equal(next.profile.earned, 150);
    const online = R.rewardFor({ ...p, earned: R.DAILY_CAP }, report({ mode: 'online' }), '2026-10-16', true);
    assert.equal(online.reward.capped, false);
    assert.equal(online.profile.earned, R.DAILY_CAP);
  });

  check('a single-player report is refused when it could not have happened', () => {
    const known = { ownShips: 60, enemyShips: 73, generals: ['yi', 'eokgi', 'won'] };
    assert.equal(R.reportProblem(report(), known, 600, 32), null);
    assert.equal(R.reportProblem(report({ simSeconds: 5000 }), known, 60, 32), 'faster than the game runs');
    assert.equal(R.reportProblem(report({ sunk: 74 }), known, 600, 32), 'invalid sunk count');
    assert.equal(R.reportProblem(report({ lost: 1.5 }), known, 600, 32), 'invalid lost count');
    assert.equal(R.reportProblem(report({ generals: [{ id: 'wakisaka', sunk: 0 }] }), known, 600, 32), 'invalid generals');
    assert.equal(R.reportProblem(report({ stars: 4 }), known, 600, 32), 'invalid stars');
    assert.equal(R.reportProblem(report({ result: 'won' }), known, 600, 32), 'invalid result');
  });

  check('in a battle, only the squadrons of the account\'s generals on the player\'s team take their factors, and the same profile gives the same ships', () => {
    let p = { ...R.newProfile(), coins: 9000 };
    p = R.equip(R.buy(p, 'yi_tongjesa').profile, 'yi', 'yi_tongjesa');
    const plain = buildScenario('hansan', 0, 1592);
    const a = buildScenario('hansan', 0, 1592);
    const b = buildScenario('hansan', 0, 1592);
    const generals = M.teamGenerals(a, 'joseon');
    assert.ok(generals.includes('yi'), `hansan's Joseon generals: ${generals}`);
    assert.deepEqual(M.applyGenerals(a, 'joseon', p), generals);
    M.applyGenerals(b, 'joseon', p);
    const yiSq = a.squadrons.find((sq) => sq.team === 'joseon' && M.generalOfPortrait(sq.portrait) === 'yi');
    const ship = a.get(yiSq.shipIds[0]);
    const before = plain.get(yiSq.shipIds[0]);
    assert.ok(close(ship.mods.defense, before.mods.defense * 1.06));
    for (const s of a.ships) assert.deepEqual(s.mods, b.get(s.id).mods);
    for (const s of a.ships) if (s.team === 'japan') assert.deepEqual(s.mods, plain.get(s.id).mods);
  });
} finally {
  await server.close();
}
if (failed) { console.error(`${failed} failed`); process.exit(1); }
console.log('all passed');
