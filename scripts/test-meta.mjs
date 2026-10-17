// Regression checks for an account's growth (src/meta): the catalog of generals, armor and weapons, levels and skill trees,
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
  const A = await load('/src/meta/affixes.ts');
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

  check('weapons: two distinct variants of swords, spears and bows in every faction, with a valid default sword', () => {
    assert.equal(new Set(C.WEAPONS.map((w) => w.id)).size, C.WEAPONS.length);
    assert.equal(C.WEAPONS.length, 18);
    for (const faction of ['joseon', 'japan', 'ming']) {
      for (const kind of C.WEAPON_KINDS) {
        const list = C.WEAPONS.filter((w) => w.faction === faction && w.kind === kind);
        assert.equal(list.length, 2, `${faction} ${kind}`);
        assert.notEqual(list[0].name, list[1].name);
      }
      assert.equal(C.defaultWeapon(faction).faction, faction);
      assert.equal(C.defaultWeapon(faction).kind, 'sword');
    }
    for (const w of C.WEAPONS) {
      assert.ok(w.name && w.hanja && w.line, w.id);
      assert.equal(C.weaponById(w.id), w);
      assert.equal(w.effect, undefined, 'weapon cosmetics have no battle modifiers');
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

  check('armor: bought once with enough coins and signatures shared by every general of their navy', () => {
    let p = { ...R.newProfile(), coins: 10000 };
    assert.equal(R.buyProblem(p, 'joseon_dujeong'), '살 수 없는 갑옷입니다');
    p = R.buy(p, 'yi_tongjesa').profile;
    assert.equal(p.coins, 1000);
    assert.equal(R.buyProblem(p, 'yi_tongjesa'), '이미 가진 갑옷입니다');
    assert.equal(R.buyProblem(p, 'joseon_eorin'), '엽전이 모자랍니다');
    assert.equal(R.equipProblem(p, 'won', 'yi_tongjesa'), null);
    assert.equal(R.wornArmor(R.equip(p, 'won', 'yi_tongjesa'), 'won').id, 'yi_tongjesa');
    assert.equal(R.equipProblem(p, 'wakisaka', 'joseon_pigap'), '다른 나라의 갑옷입니다');
    assert.equal(R.equipProblem(p, 'yi', 'joseon_pigap'), '아직 가지지 않은 갑옷입니다');
    p = R.equip(p, 'yi', 'yi_tongjesa');
    assert.equal(R.wornArmor(p, 'yi').id, 'yi_tongjesa');
    assert.equal(R.wornArmor(p, 'won').id, 'joseon_dujeong');
    p = R.equip(p, 'yi', null);
    assert.equal(p.generals.yi.armor, undefined);
    assert.equal(R.wornArmor(p, 'yi').id, 'joseon_dujeong');
  });

  check('the complete armor/general matrix: every same-faction armor can be worn, every cross-faction armor is refused', () => {
    const p = { ...R.newProfile(), owned: C.ARMORS.filter((a) => a.tier !== 'basic').map((a) => a.id) };
    for (const g of C.GENERALS) {
      assert.deepEqual(C.armorsFor(g).map((a) => a.id), C.ARMORS.filter((a) => a.faction === g.faction).map((a) => a.id));
      for (const a of C.ARMORS) {
        if (a.faction === g.faction) {
          assert.equal(R.equipProblem(p, g.id, a.id), null, `${g.id} can wear ${a.id}`);
          const equipped = R.equip(p, g.id, a.id);
          assert.equal(R.wornArmor(equipped, g.id).id, a.id);
          assert.equal(R.normalizeProfile(JSON.parse(JSON.stringify(equipped))).generals[g.id].armor, a.tier === 'basic' ? undefined : a.id);
        } else {
          assert.equal(R.equipProblem(p, g.id, a.id), '다른 나라의 갑옷입니다');
          assert.throws(() => R.equip(p, g.id, a.id), R.RuleError);
        }
      }
    }
    assert.deepEqual(p.generals, {}, 'equipment changes do not mutate the source profile');
  });

  check('the complete weapon/general matrix: one free same-faction weapon per general; unknown and foreign weapons refused', () => {
    const p = R.newProfile();
    for (const g of C.GENERALS) {
      assert.deepEqual(C.weaponsFor(g).map((w) => w.id), C.WEAPONS.filter((w) => w.faction === g.faction).map((w) => w.id));
      assert.equal(R.wornWeapon(p, g.id).id, C.defaultWeapon(g.faction).id);
      for (const w of C.WEAPONS) {
        if (w.faction === g.faction) {
          assert.equal(R.equipWeaponProblem(p, g.id, w.id), null, `${g.id} can carry ${w.id}`);
          const equipped = R.equipWeapon(p, g.id, w.id);
          assert.equal(R.wornWeapon(equipped, g.id).id, w.id);
          assert.equal(R.wornWeapon(R.normalizeProfile(equipped), g.id).id, w.id);
          assert.equal(equipped.coins, 0, 'weapons are free');
        } else {
          assert.equal(R.equipWeaponProblem(p, g.id, w.id), '다른 나라의 무기입니다');
          assert.throws(() => R.equipWeapon(p, g.id, w.id), R.RuleError);
        }
      }
    }
    assert.equal(R.equipWeaponProblem(p, 'ghost', null), '없는 장수입니다');
    assert.equal(R.equipWeaponProblem(p, 'yi', 'ghost'), '없는 무기입니다');
    assert.equal(R.wornWeapon(p, 'ghost'), undefined);
    assert.deepEqual(p.generals, {});
  });

  check('switching weapon replaces one slot while preserving armor, progression, other generals and battle factors', () => {
    const p = { ...R.newProfile(), coins: 24, owned: ['yi_tongjesa'], generals: { yi: { xp: 600, skills: ['gunnery1'], armor: 'yi_tongjesa' }, won: { xp: 150, skills: [] } } };
    const original = JSON.stringify(p);
    let next = p;
    for (const w of C.weaponsFor(C.generalById('yi'))) {
      next = R.equipWeapon(next, 'yi', w.id);
      assert.deepEqual(next.generals.yi, { ...p.generals.yi, weapon: w.id });
      assert.equal(next.generals.won, p.generals.won);
      assert.deepEqual(R.generalMods(next, 'yi'), R.generalMods(p, 'yi'));
      assert.equal(next.coins, p.coins);
      assert.deepEqual(next.owned, p.owned);
    }
    next = R.equipWeapon(next, 'yi', null);
    assert.deepEqual(next.generals.yi, p.generals.yi);
    assert.equal(R.wornWeapon(next, 'yi').id, 'joseon_hwando');
    assert.equal(JSON.stringify(p), original);
  });

  check('v1 migration keeps armor, currency, skills and rewards; malformed or foreign weapons fall back safely', () => {
    const old = { ...R.newProfile(), coins: 1234, owned: ['yi_tongjesa'], generals: { yi: { xp: 600, skills: ['gunnery1'], armor: 'yi_tongjesa' }, won: { xp: 300, skills: [], armor: 'yi_tongjesa', weapon: 'joseon_dangpa' }, eokgi: { xp: 10, skills: [], weapon: 'japan_yari' }, chenlin: { xp: 20, skills: [], weapon: ['ming_jian', 'ming_gong'] }, deng: { xp: 30, skills: [], weapon: 'missing' } }, firsts: ['win:history:hansan:joseon'] };
    const p = R.normalizeProfile(old);
    assert.equal(p.v, 1);
    assert.equal(p.coins, old.coins);
    assert.deepEqual(p.owned, old.owned);
    assert.deepEqual(p.firsts, old.firsts);
    assert.deepEqual(p.generals.yi, old.generals.yi);
    assert.equal(R.wornWeapon(p, 'yi').id, 'joseon_hwando');
    assert.deepEqual(p.generals.won, old.generals.won, 'other generals may retain the same-faction signature');
    for (const id of ['eokgi', 'chenlin', 'deng']) assert.equal(p.generals[id].weapon, undefined, id);
    assert.equal(R.wornWeapon(p, 'eokgi').faction, 'joseon');
    assert.equal(R.wornWeapon(p, 'chenlin').faction, 'ming');
    assert.deepEqual(R.normalizeProfile(JSON.parse(JSON.stringify(p))), p, 'migration is stable on later reloads');
    assert.equal(R.wornWeapon({ ...p, generals: { yi: { xp: 0, skills: [], weapon: 'japan_yumi' } } }, 'yi').id, 'joseon_hwando', 'readback also checks faction');
    assert.equal(R.wornArmor({ ...p, generals: { yi: { xp: 0, skills: [], armor: 'japan_tosei' } } }, 'yi').id, 'joseon_dujeong');
  });

  check('a general\'s factors: his trait, his steps and his armor multiply; the campaign-only march, xp and temper are left out', () => {
    let p = { ...R.newProfile(), coins: 9000, generals: { yi: { xp: R.xpFor(2), skills: ['gunnery1'] } } };
    p = R.equip(R.buy(p, 'yi_tongjesa').profile, 'yi', 'yi_tongjesa');
    const m = R.generalMods(p, 'yi');
    const bare = R.generalMods(R.equip(p, 'yi', null), 'yi');
    assert.ok(close(bare.accuracy, 1.06) && close(bare.morale, 1.06) && close(bare.reload, 1.05) && bare.defense === 1 && bare.speed === 1, 'trait and step');
    const fx = A.rollEffect(R.armorRoll(p, 'yi_tongjesa'));
    assert.ok(Object.keys(fx).length > 0, 'a signature always rolls something');
    for (const k of Object.keys(R.NEUTRAL_MODS)) assert.ok(close(m[k], bare[k] * (fx[k] ?? 1)), k);
    assert.deepEqual(Object.keys(m).sort(), Object.keys(R.NEUTRAL_MODS).sort());
  });


  check('rolled armor: the same seed rolls the same piece; points, abilities and factors stay inside the tier ranges', () => {
    const rank = (t) => C.ARMOR_TIERS.indexOf(t);
    const seen = new Set();
    for (const a of C.ARMORS) {
      const spec = A.TIER_ROLL[a.tier];
      for (let i = 0; i < 300; i++) {
        const seed = A.armorSeed('salt' + i, a.id);
        const r = A.rollArmor(a, seed);
        assert.deepEqual(A.rollArmor(a, seed), r, 'reproducible');
        const pts = A.PRIMARY_STATS.reduce((s, k) => s + r.stats[k], 0);
        assert.ok(pts >= spec.points[0] && pts <= spec.points[1], `${a.id} points ${pts}`);
        assert.ok(r.affixes.length >= spec.affixes[0] && r.affixes.length <= spec.affixes[1], `${a.id} affixes`);
        assert.equal(new Set(r.affixes.map((x) => x.id)).size, r.affixes.length, 'no duplicate ability');
        for (const af of r.affixes) {
          const def = A.affixById(af.id);
          seen.add(def.id);
          for (const [k, v] of Object.entries(af.values)) assert.ok(v >= def.ranges[k][0] && v <= def.ranges[k][1] + 1e-9, `${af.id}.${k}`);
        }
        for (const v of Object.values(A.rollEffect(r))) assert.ok(v > 1 && v <= A.ARMOR_FACTOR_CAP, a.id);
        const q = A.rollQuality(a, r);
        assert.ok(q >= 0 && q <= 1);
      }
      if (a.tier === 'basic') assert.deepEqual(A.rollEffect(A.rollArmor(a, 123)), {}, 'basic armor rolls nothing');
    }
    assert.equal(seen.size, A.AFFIXES.length, 'every ability can drop');
    for (let i = 1; i < C.ARMOR_TIERS.length; i++) assert.ok(A.TIER_ROLL[C.ARMOR_TIERS[i]].points[1] >= A.TIER_ROLL[C.ARMOR_TIERS[i - 1]].points[1], 'better tiers roll more');
    assert.ok(rank('signature') > rank('basic'));
    // Rare abilities drop less often than common ones.
    const counts = {};
    const leg = C.armorById('joseon_eorin');
    for (let i = 0; i < 4000; i++) for (const af of A.rollArmor(leg, A.hashSeed('w' + i)).affixes) counts[A.affixById(af.id).rarity] = (counts[A.affixById(af.id).rarity] ?? 0) + 1;
    assert.ok(counts.common / 4 > counts.rare / 4 * 1.2 && counts.rare / 4 > counts.epic / 2, JSON.stringify(counts));
  });

  check('rolled armor in a profile: rolled at purchase from the salt, migrated deterministically, rerolled for coins', () => {
    const p0 = { ...R.newProfile(), salt: 'acct-42', coins: 9000 };
    const p1 = R.buy(p0, 'joseon_eorin').profile;
    assert.deepEqual(p1.rolls.joseon_eorin, { seed: A.armorSeed('acct-42', 'joseon_eorin'), rerolls: 0 });
    assert.deepEqual(R.armorRoll(p1, 'joseon_eorin'), A.rollArmor(C.armorById('joseon_eorin'), A.armorSeed('acct-42', 'joseon_eorin')));
    assert.equal(R.armorRoll(p1, 'joseon_dujeong'), null, 'basic armor has no roll');
    assert.equal(R.armorRoll(p1, 'joseon_pigap'), null, 'unowned armor has no roll');
    // An old save without salt or rolls: every owned piece gets the roll its account id and armor id give.
    const old = { coins: 5, owned: ['joseon_swaeja', 'japan_oyoroi'], generals: {} };
    const a = R.normalizeProfile(old, 'acct-7');
    const b = R.normalizeProfile(JSON.parse(JSON.stringify(old)), 'acct-7');
    assert.deepEqual(a, b);
    assert.equal(a.salt, 'acct-7');
    assert.deepEqual(a.rolls.joseon_swaeja, { seed: A.armorSeed('acct-7', 'joseon_swaeja'), rerolls: 0 });
    assert.notDeepEqual(R.normalizeProfile(old, 'acct-8').rolls.joseon_swaeja, a.rolls.joseon_swaeja);
    assert.deepEqual(R.normalizeProfile(JSON.parse(JSON.stringify(a)), 'other'), a, 'a stored salt wins over the fallback');
    // A forged seed is ignored: the roll is always the chain's (salt, id, rerolls), so a server can recompute it.
    const forged = R.normalizeProfile({ ...JSON.parse(JSON.stringify(a)), rolls: { joseon_swaeja: { seed: 1, rerolls: 2 } } });
    assert.deepEqual(forged.rolls.joseon_swaeja, { seed: A.armorSeed('acct-7', 'joseon_swaeja', 2), rerolls: 2 });
    // Reroll.
    const cost = A.rerollCost(C.armorById('joseon_eorin'));
    const p2 = R.reroll(p1, 'joseon_eorin');
    assert.equal(p2.coins, p1.coins - cost);
    assert.deepEqual(p2.rolls.joseon_eorin, { seed: A.armorSeed('acct-42', 'joseon_eorin', 1), rerolls: 1 });
    assert.deepEqual(R.normalizeProfile(JSON.parse(JSON.stringify(p2))), p2);
    assert.throws(() => R.reroll({ ...p1, coins: cost - 1 }, 'joseon_eorin'), R.RuleError);
    assert.throws(() => R.reroll(p1, 'joseon_dujeong'), R.RuleError);
    assert.throws(() => R.reroll(p1, 'joseon_pigap'), R.RuleError);
    assert.equal(p1.rolls.joseon_eorin.rerolls, 0, 'reroll does not mutate');
    // Wearing the basic armor brings no armor factors at all.
    const yi = R.generalMods(R.equip(p2, 'yi', null), 'yi');
    const tree = TREES.yi.trait.effect;
    for (const k of Object.keys(R.NEUTRAL_MODS)) assert.ok(close(yi[k], tree[k] ?? 1), k);
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
    const fx = A.rollEffect(R.armorRoll(p, 'yi_tongjesa'));
    const gm = R.generalMods(p, 'yi');
    for (const k of Object.keys(R.NEUTRAL_MODS)) assert.ok(close(ship.mods[k], before.mods[k] * gm[k]), k);
    assert.ok(Object.keys(fx).some((k) => ship.mods[k] > before.mods[k]), 'the rolled armor reaches the ships');
    for (const s of a.ships) assert.deepEqual(s.mods, b.get(s.id).mods);
    for (const s of a.ships) if (s.team === 'japan') assert.deepEqual(s.mods, plain.get(s.id).mods);
  });

  check('a finished battle reports its side: sunk, lost, stars and the generals who led with the kills of their squadrons', () => {
    const b = buildScenario('hansan', 0, 1592);
    const own = b.ships.filter((s) => s.team === 'joseon');
    const foe = b.ships.filter((s) => s.team === 'japan');
    for (const s of foe.slice(0, 5)) s.alive = false;
    own[0].alive = false;
    b.winner = 'joseon';
    b.time = 321.7;
    const yiSq = b.squadrons.find((sq) => sq.team === 'joseon' && M.generalOfPortrait(sq.portrait) === 'yi');
    b.get(yiSq.shipIds[0]).kills = 3;
    const r = M.battleReport(b, 'joseon', null, 'history', 'hansan', 'joseon');
    assert.equal(r.result, 'win');
    assert.equal(r.sunk, 5);
    assert.equal(r.lost, 1);
    assert.equal(r.stars, 2);
    assert.equal(r.simSeconds, 321);
    assert.ok(r.generals.find((g) => g.id === 'yi').sunk >= 3);
    assert.equal(R.reportProblem(r, { ownShips: own.length, enemyShips: foe.length, generals: M.teamGenerals(b, 'joseon') }, 400, 128), null);
    const theirs = M.battleReport(b, 'japan', null, 'history', 'hansan', 'japan');
    assert.equal(theirs.result, 'loss');
    assert.equal(theirs.stars, 0);
    assert.equal(theirs.sunk, 1);
  });

  const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const storage = new Map([['imjin.meta.local.v1', JSON.stringify({ ...R.newProfile(), coins: 4321, owned: ['yi_tongjesa'], generals: { won: { xp: 300, skills: [], armor: 'yi_tongjesa' } } })]]);
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)) } });
  try {
    const { useLocalProfile } = await load('/src/meta/localProfile.ts');
    check('local profile reloads an old v1 save, persists one weapon per general and leaves refused changes unwritten', () => {
      const initial = useLocalProfile.getState().profile;
      assert.equal(initial.coins, 4321);
      assert.equal(initial.generals.won.armor, 'yi_tongjesa');
      assert.equal(R.wornWeapon(initial, 'won').id, 'joseon_hwando');
      assert.equal(useLocalProfile.getState().equipWeapon('won', 'joseon_jangchang'), true);
      assert.equal(useLocalProfile.getState().equipWeapon('won', 'joseon_gakgung'), true);
      const persisted = storage.get('imjin.meta.local.v1');
      const reloaded = R.normalizeProfile(JSON.parse(persisted));
      assert.deepEqual(reloaded.generals.won, { xp: 300, skills: [], armor: 'yi_tongjesa', weapon: 'joseon_gakgung' });
      assert.equal(reloaded.coins, 4321);
      assert.equal(useLocalProfile.getState().equipWeapon('won', 'japan_yari'), false);
      assert.equal(useLocalProfile.getState().refused, '다른 나라의 무기입니다');
      assert.equal(storage.get('imjin.meta.local.v1'), persisted);
      assert.deepEqual(useLocalProfile.getState().profile, reloaded);
      assert.equal(useLocalProfile.getState().equipWeapon('won', null), true);
      assert.equal(useLocalProfile.getState().refused, null);
      assert.equal(JSON.parse(storage.get('imjin.meta.local.v1')).generals.won.weapon, undefined);
    });
  } finally {
    if (storageDescriptor) Object.defineProperty(globalThis, 'localStorage', storageDescriptor);
    else delete globalThis.localStorage;
  }
} finally {
  await server.close();
}
if (failed) { console.error(`${failed} failed`); process.exit(1); }
console.log('all passed');
