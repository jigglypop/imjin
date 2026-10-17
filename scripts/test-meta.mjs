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
  const T = await load('/src/meta/talents.ts');
  const L = await load('/src/meta/loot.ts');
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
      if (g.famous && C.isImjin(g.faction)) assert.equal(C.ARMORS.filter((a) => a.general === g.id).length, 1, `${g.id} has one signature`);
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

  check('levels: 100 xp for the second level, 200 more for the third, capped at 20', () => {
    assert.equal(R.xpFor(1), 0);
    assert.equal(R.xpFor(2), 100);
    assert.equal(R.xpFor(3), 300);
    assert.equal(R.levelOf(99), 1);
    assert.equal(R.levelOf(100), 2);
    assert.equal(R.levelOf(R.xpFor(10)), 10);
    assert.equal(R.levelOf(1e12), 20);
    assert.deepEqual(R.levelProgress(150), { level: 2, into: 50, need: 200 });
    assert.equal(R.levelProgress(1e9).need, null);
  });

  check('a stored profile is cleaned: unknown generals, skills and armor dropped, counts made whole and positive', () => {
    const p = R.normalizeProfile({ coins: 12.7, owned: ['joseon_swaeja', 'nope', 'joseon_dujeong', 'joseon_swaeja'], generals: { yi: { xp: -5, talents: { 'gunnery.rapid': 1, 'boarding.hooks': 1, x: 1 }, armor: 'japan_oyoroi' }, ghost: { xp: 9 } }, stats: { wins: 'a' }, firsts: ['b', 'a', 'a'] });
    assert.equal(p.coins, 12);
    assert.deepEqual(p.owned, ['joseon_swaeja']);
    assert.deepEqual(p.generals.yi, { xp: 0, talents: {} }, 'no points at level 1, so nothing is kept');
    assert.equal(p.generals.ghost, undefined);
    assert.deepEqual(p.stats, { battles: 0, wins: 0, sunk: 0, lost: 0 });
    assert.deepEqual(p.firsts, ['a', 'b']);
    assert.deepEqual(R.normalizeProfile(null), R.newProfile());
  });

  check('talent trees: every general has three distinct branches with five tiers, one keystone each, and his 비기', () => {
    for (const g of C.GENERALS) {
      const branches = T.branchesOf(g.id);
      assert.equal(branches.length, 3, g.id);
      assert.equal(new Set(branches).size, 3, g.id);
      for (const b of TREES[g.id].branches.slice(0, 3)) assert.ok(branches.includes(b), `${g.id} keeps his campaign branch ${b}`);
      const nodes = T.talentsFor(g.id);
      assert.equal(new Set(nodes.map((n) => n.id)).size, nodes.length, g.id);
      assert.equal(nodes.filter((n) => n.keystone).length, 3, g.id);
      assert.equal(nodes.filter((n) => n.branch === 'mastery').length, 1, g.id);
    }
    for (const list of Object.values(T.BRANCH_NODES)) {
      for (const tier of [1, 2, 3, 4, 5]) assert.ok(list.some((n) => n.tier === tier));
      // Enough ranks below the keystone to open it, and keystones are two-sided.
      assert.ok(list.filter((n) => n.tier < 5).reduce((s, n) => s + n.ranks, 0) >= T.TIER_GATE[5]);
      const key = list.find((n) => n.keystone);
      assert.ok(Object.values(key.per).some((v) => v < 0) && Object.values(key.per).some((v) => v >= 0.07), key.id);
    }
  });

  check('talents: points from levels and milestones, tier gates, ranks, keystone level and exclusivity, 비기 gate', () => {
    assert.equal(T.pointsAtLevel(1), 0);
    assert.equal(T.pointsAtLevel(4), 3);
    assert.equal(T.pointsAtLevel(5), 5, 'milestone at 5 adds one');
    assert.equal(T.pointsAtLevel(20), 19 + 6);
    let p = { ...R.newProfile(), generals: { yi: { xp: R.xpFor(4), talents: {} } } };
    assert.equal(R.learnProblem(p, 'yi', 'boarding.hooks'), '이 장수가 배울 수 없는 재능입니다');
    assert.equal(R.learnProblem(p, 'yi', 'gunnery.powder'), '이 가지에 2점을 쓰면 열립니다');
    p = R.learn(R.learn(p, 'yi', 'gunnery.rapid'), 'yi', 'gunnery.rapid');
    assert.equal(p.generals.yi.talents['gunnery.rapid'], 2);
    assert.equal(R.learnProblem(p, 'yi', 'gunnery.powder'), null);
    p = R.learn(p, 'yi', 'gunnery.rapid');
    assert.equal(R.learnProblem(p, 'yi', 'gunnery.rapid'), '이미 끝까지 익혔습니다');
    assert.equal(R.learnProblem(p, 'yi', 'gunnery.aim'), '남은 재능 점수가 없습니다');
    // A level-20 general fills a branch: keystones are exclusive, the 비기 waits for its level and spent points.
    let q = { ...R.newProfile(), generals: { yi: { xp: R.xpFor(20), talents: {} } } };
    for (const n of T.BRANCH_NODES.gunnery.filter((n) => !n.keystone)) for (let i = 0; i < n.ranks; i++) q = R.learn(q, 'yi', n.id);
    for (let i = 0; i < 3; i++) q = R.learn(q, 'yi', 'command.drums');
    for (let i = 0; i < 3; i++) q = R.learn(q, 'yi', 'command.law');
    for (let i = 0; i < 2; i++) q = R.learn(q, 'yi', 'command.drill');
    q = R.learn(q, 'yi', 'command.formation');
    q = R.learn(q, 'yi', 'command.runners');
    assert.equal(R.learnProblem({ ...q, generals: { yi: { ...q.generals.yi, xp: R.xpFor(9) } } }, 'yi', 'gunnery.keystone'), '10레벨에 익힐 수 있습니다');
    q = R.learn(q, 'yi', 'gunnery.keystone');
    assert.equal(R.keystoneOf(q, 'yi').id, 'gunnery.keystone');
    assert.match(R.learnProblem(q, 'yi', 'command.keystone'), /핵심 재능은 하나만/);
    q = R.learn(q, 'yi', 'mastery');
    assert.equal(R.learnProblem({ ...q, generals: { yi: { xp: R.xpFor(11), talents: {} } } }, 'yi', 'mastery'), '12레벨에 익힐 수 있습니다');
    assert.equal(R.learnProblem({ ...q, generals: { yi: { xp: R.xpFor(12), talents: {} } } }, 'yi', 'mastery'), '재능 점수를 8점 쓴 뒤에 익힐 수 있습니다');
    // A stored tree is cleaned through the same gates, in tier order.
    const stored = R.normalizeProfile(JSON.parse(JSON.stringify({ ...q, generals: { yi: { ...q.generals.yi, talents: { ...q.generals.yi.talents, 'command.keystone': 1, 'gunnery.rapid': 9 } } } })));
    assert.deepEqual(stored.generals.yi.talents, q.generals.yi.talents);
    assert.deepEqual(R.normalizeProfile({ generals: { yi: { xp: R.xpFor(3), talents: { 'gunnery.powder': 2, 'gunnery.rapid': 1 } } } }).generals.yi.talents, { 'gunnery.rapid': 1 }, 'gates hold on load');
  });

  check('talents: resonance with the trait, keystones two-sided, caps, preview through generalMods, respec cost', () => {
    // Yi's trait raises accuracy and morale: 정조준 resonates (+1.5% a rank becomes +2.25%), 속사 does not.
    assert.ok(T.resonates('yi', T.talentById('yi', 'gunnery.aim')));
    assert.ok(!T.resonates('yi', T.talentById('yi', 'gunnery.rapid')));
    assert.ok(close(T.nodeAdds('yi', T.talentById('yi', 'gunnery.aim'), 1).accuracy, 0.0225));
    assert.ok(close(T.nodeAdds('yi', T.talentById('yi', 'gunnery.rapid'), 2).reload, 0.03));
    const e = T.talentEffect('yi', { 'gunnery.keystone': 1 });
    assert.ok(close(e.melee, 0.92) && close(e.reload, 1.08) && close(e.accuracy, 1.075), JSON.stringify(e));
    for (const g of C.GENERALS) {
      const all = Object.fromEntries(T.talentsFor(g.id).map((n) => [n.id, n.ranks]));
      for (const v of Object.values(T.talentEffect(g.id, all))) assert.ok(v <= 1 + T.TALENT_CAP.max + 1e-9 && v >= 1 + T.TALENT_CAP.min - 1e-9, g.id);
    }
    let p = { ...R.newProfile(), coins: 5000, generals: { yi: { xp: R.xpFor(6), talents: {} } } };
    const before = R.generalMods(p, 'yi');
    const preview = R.generalMods(p, 'yi', { 'gunnery.aim': 1 });
    p = R.learn(p, 'yi', 'gunnery.aim');
    assert.deepEqual(R.generalMods(p, 'yi'), preview, 'the preview is what learning gives');
    assert.ok(preview.accuracy > before.accuracy);
    assert.equal(R.respecCost(p, 'yi'), 0, 'the first reset is free');
    p = R.respec(p, 'yi');
    assert.deepEqual(p.generals.yi.talents, {});
    assert.equal(p.coins, 5000);
    assert.equal(R.respecProblem(p, 'yi'), '되돌릴 재능이 없습니다');
    p = R.learn(p, 'yi', 'gunnery.aim');
    assert.equal(R.respecCost(p, 'yi'), 600);
    p = R.respec(p, 'yi');
    assert.equal(p.coins, 4400);
    assert.equal(p.generals.yi.respecs, 2);
    assert.throws(() => R.respec({ ...R.learn(p, 'yi', 'gunnery.aim'), coins: 10 }, 'yi'), R.RuleError);
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
    for (const g of C.GENERALS.filter((x) => C.isImjin(x.faction))) {
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
    const p = { ...R.newProfile(), coins: 24, owned: ['yi_tongjesa'], generals: { yi: { xp: 600, talents: { 'gunnery.rapid': 1 }, armor: 'yi_tongjesa' }, won: { xp: 150, talents: {} } } };
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

  check('v1 migration keeps armor, currency and rewards, gives every campaign-step point back as talent points; malformed or foreign weapons fall back safely', () => {
    const old = { ...R.newProfile(), coins: 1234, owned: ['yi_tongjesa'], generals: { yi: { xp: 600, skills: ['gunnery1'], armor: 'yi_tongjesa' }, won: { xp: 300, skills: [], armor: 'yi_tongjesa', weapon: 'joseon_dangpa' }, eokgi: { xp: 10, skills: [], weapon: 'japan_yari' }, chenlin: { xp: 20, skills: [], weapon: ['ming_jian', 'ming_gong'] }, deng: { xp: 30, skills: [], weapon: 'missing' } }, firsts: ['win:history:hansan:joseon'] };
    const p = R.normalizeProfile(old);
    assert.equal(p.v, 2);
    assert.equal(p.coins, old.coins);
    assert.deepEqual(p.owned, old.owned);
    assert.deepEqual(p.firsts, old.firsts);
    assert.deepEqual(p.generals.yi, { xp: 600, talents: {}, armor: 'yi_tongjesa' });
    assert.equal(R.skillPointsLeft(p, 'yi'), 3, 'level 4: every point back');
    assert.deepEqual(p.items, []);
    assert.equal(R.wornWeapon(p, 'yi').id, 'joseon_hwando');
    assert.deepEqual(p.generals.won, { xp: 300, talents: {}, armor: 'yi_tongjesa', weapon: 'joseon_dangpa' }, 'other generals may retain the same-faction signature');
    for (const id of ['eokgi', 'chenlin', 'deng']) assert.equal(p.generals[id].weapon, undefined, id);
    assert.equal(R.wornWeapon(p, 'eokgi').faction, 'joseon');
    assert.equal(R.wornWeapon(p, 'chenlin').faction, 'ming');
    assert.deepEqual(R.normalizeProfile(JSON.parse(JSON.stringify(p))), p, 'migration is stable on later reloads');
    assert.equal(R.wornWeapon({ ...p, generals: { yi: { xp: 0, talents: {}, weapon: 'japan_yumi' } } }, 'yi').id, 'joseon_hwando', 'readback also checks faction');
    assert.equal(R.wornArmor({ ...p, generals: { yi: { xp: 0, talents: {}, armor: 'japan_tosei' } } }, 'yi').id, 'joseon_dujeong');
  });

  check('a general\'s factors: his trait, his talents and his armor multiply; the campaign-only march, xp and temper are left out', () => {
    let p = { ...R.newProfile(), coins: 9000, generals: { yi: { xp: R.xpFor(2), talents: { 'gunnery.rapid': 1 } } } };
    p = R.equip(R.buy(p, 'yi_tongjesa').profile, 'yi', 'yi_tongjesa');
    const m = R.generalMods(p, 'yi');
    const bare = R.generalMods(R.equip(p, 'yi', null), 'yi');
    assert.ok(close(bare.accuracy, 1.06) && close(bare.morale, 1.06) && close(bare.reload, 1.015) && bare.defense === 1 && bare.speed === 1, 'trait and step');
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

  check('loot catalog: every weapon is a base for its navy, every slot has bases, rolls stay in rarity ranges and caps', () => {
    assert.equal(new Set(L.ITEM_BASES.map((b) => b.id)).size, L.ITEM_BASES.length);
    for (const w of C.WEAPONS) assert.equal(L.ITEM_BASES.find((b) => b.weapon === w.id)?.faction, w.faction, w.id);
    for (const slot of L.GEAR_SLOTS) assert.ok(L.ITEM_BASES.filter((b) => b.slot === slot).length >= 4, slot);
    for (const rarity of L.RARITIES) {
      const spec = L.RARITY_ROLL[rarity];
      for (let i = 0; i < 200; i++) {
        const item = { base: L.ITEM_BASES[i % L.ITEM_BASES.length].id, rarity, seed: L.itemSeed('s', `u${i}`) };
        const r = L.rollItem(item);
        assert.deepEqual(L.rollItem(item), r, 'reproducible');
        const pts = A.PRIMARY_STATS.reduce((s, k) => s + r.stats[k], 0);
        assert.ok(pts >= spec.points[0] && pts <= spec.points[1], `${rarity} ${pts}`);
        assert.ok(r.affixes.length >= spec.affixes[0] && r.affixes.length <= spec.affixes[1]);
        for (const v of Object.values(L.itemEffect(item))) assert.ok(v > 1 && v <= L.ITEM_FACTOR_CAP + 1e-9);
      }
    }
    // Bias: a war manual leans to 지능.
    let int = 0, str = 0;
    for (let i = 0; i < 400; i++) { const r = L.rollItem({ base: 'b_sonja', rarity: 'rare', seed: L.itemSeed('s', `b${i}`) }); int += r.stats.int; str += r.stats.str; }
    assert.ok(int > 2 * str, `${int} vs ${str}`);
    // The refactor kept every armor roll as it was.
    const a = C.armorById('yi_tongjesa');
    assert.deepEqual(A.rollArmor(a, 12345), A.rollPieces((() => { let x = 12345; return () => { x = (x + 0x6d2b79f5) >>> 0; let t = x; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })(), A.TIER_ROLL.signature));
  });

  check('drops: decided by salt and counter alone, a win always drops, a first win adds a 희귀+ piece, weapons only for the own navy', () => {
    const win = { result: 'win', stars: 3, sunk: 10, firstWin: false, side: 'joseon' };
    assert.deepEqual(L.rollDrops('acct', 7, win), L.rollDrops('acct', 7, win));
    assert.notDeepEqual(L.rollDrops('acct', 7, win), L.rollDrops('other', 7, win));
    const tally = { common: 0, fine: 0, rare: 0, epic: 0, legendary: 0 };
    let lossDrops = 0;
    for (let i = 0; i < 2000; i++) {
      const d = L.rollDrops('acct', i, win);
      assert.ok(d.length >= 1 && d.length <= 2);
      for (const x of d) { tally[x.rarity]++; const b = L.itemBase(x.base); assert.ok(!b.faction || b.faction === 'joseon'); }
      lossDrops += L.rollDrops('acct', i, { ...win, result: 'loss', stars: 0 }).length;
      const first = L.rollDrops('acct', i, { ...win, firstWin: true });
      assert.ok(['rare', 'epic', 'legendary'].includes(first.at(-1).rarity));
      for (const x of L.rollDrops('acct', i, { ...win, side: 'holyleague' })) assert.equal(L.itemBase(x.base).faction, undefined);
    }
    assert.ok(tally.common > tally.fine && tally.fine > tally.rare && tally.rare > tally.epic && tally.epic > tally.legendary && tally.legendary > 0, JSON.stringify(tally));
    assert.ok(lossDrops > 250 && lossDrops < 550, `loss drops ${lossDrops}`);
  });

  check('rewards drop loot into the profile: counter moves, daily cap for untrusted, full inventory salvages, rolls verifiable', () => {
    const report = { mode: 'history', scenario: 'hansan', side: 'joseon', result: 'win', stars: 3, sunk: 8, lost: 0, simSeconds: 300, generals: [{ id: 'yi', sunk: 4 }] };
    let p = { ...R.newProfile(), salt: 'acct' };
    const first = R.rewardFor(p, report, '2026-10-17', false);
    assert.ok(first.reward.drops.length >= 2, 'first win: a regular drop and the 희귀+ bonus');
    assert.equal(first.profile.drops, 1);
    assert.deepEqual(first.profile.items, first.reward.drops);
    for (const it of first.profile.items) assert.equal(it.seed, L.itemSeed('acct', it.uid, 0));
    assert.deepEqual(R.normalizeProfile(JSON.parse(JSON.stringify(first.profile)), 'acct').items, first.profile.items, 'stored items reload the same');
    const forged = R.normalizeProfile({ ...first.profile, items: first.profile.items.map((i) => ({ ...i, seed: 1 })) }, 'acct');
    assert.deepEqual(forged.items, first.profile.items, 'a stored seed is never trusted');
    p = first.profile;
    for (let i = 0; i < 40; i++) p = R.rewardFor(p, report, '2026-10-17', false).profile;
    assert.equal(p.dropped, L.DAILY_DROPS);
    assert.equal(p.items.length, L.DAILY_DROPS);
    assert.ok(R.rewardFor(p, report, '2026-10-18', false).reward.drops.length >= 1, 'a new day drops again');
    let full = { ...p, items: Array.from({ length: L.INVENTORY_CAP }, (_, i) => ({ uid: `f${i}`, base: 'b_sonja', rarity: 'common', rerolls: 0, seed: L.itemSeed('acct', `f${i}`), src: '' })) };
    const paid = R.rewardFor(full, report, '2026-10-19', true);
    assert.equal(paid.profile.items.length, L.INVENTORY_CAP);
    assert.ok(paid.reward.salvaged > 0 && paid.reward.drops.length === 0);
  });

  check('gear: slot and navy checks, one wearer per piece, a worn weapon becomes the figure\'s weapon, salvage and reforge', () => {
    const sword = { uid: 'a-0', base: 'w_joseon_ungeom', rarity: 'epic', rerolls: 0, seed: L.itemSeed('acct', 'a-0'), src: '' };
    const katana = { uid: 'a-1', base: 'w_japan_katana', rarity: 'rare', rerolls: 0, seed: L.itemSeed('acct', 'a-1'), src: '' };
    const book = { uid: 'a-2', base: 'b_sonja', rarity: 'legendary', rerolls: 0, seed: L.itemSeed('acct', 'a-2'), src: '' };
    let p = { ...R.newProfile(), salt: 'acct', coins: 3000, items: [sword, katana, book], generals: { yi: { xp: 600, talents: {} }, won: { xp: 600, talents: {} } } };
    assert.equal(R.equipItemProblem(p, 'yi', 'weapon', 'a-1'), '다른 나라의 무기입니다');
    assert.equal(R.equipItemProblem(p, 'yi', 'book', 'a-0'), '맞지 않는 자리입니다');
    assert.equal(R.equipItemProblem(p, 'yi', 'seal', 'zz'), '가지지 않은 물건입니다');
    const bare = R.generalMods(p, 'yi');
    p = R.equipItem(R.equipItem(p, 'yi', 'weapon', 'a-0'), 'yi', 'book', 'a-2');
    assert.equal(R.wornWeapon(p, 'yi').id, 'joseon_ungeom', 'the figure holds the looted sword');
    const m = R.generalMods(p, 'yi');
    const fx = [L.itemEffect(sword), L.itemEffect(book)];
    for (const k of Object.keys(R.NEUTRAL_MODS)) assert.ok(Math.abs(m[k] - Math.min(R.GENERAL_CAP.max, bare[k] * (fx[0][k] ?? 1) * (fx[1][k] ?? 1))) < 1e-5, k);
    p = R.equipItem(p, 'won', 'book', 'a-2');
    assert.equal(R.wearerOf(p, 'a-2'), 'won');
    assert.equal(p.generals.yi.gear.book, undefined, 'moved, not copied');
    const reforged = R.reforge(p, 'a-2');
    assert.equal(reforged.coins, 3000 - L.REFORGE.legendary);
    assert.equal(reforged.items[2].seed, L.itemSeed('acct', 'a-2', 1));
    assert.equal(R.reforgeProblem({ ...p, coins: 10 }, 'a-2'), '엽전이 모자랍니다');
    const salvaged = R.salvage(p, 'a-0');
    assert.equal(salvaged.coins, 3000 + L.SALVAGE.epic);
    assert.equal(salvaged.items.length, 2);
    assert.equal(salvaged.generals.yi.gear.weapon, undefined);
    assert.equal(R.wornWeapon(salvaged, 'yi').id, 'joseon_ungeom', 'the cosmetic weapon stays');
    // Every factor of a fully geared, fully learned general stays in bounds.
    const all = Object.fromEntries(T.talentsFor('yi').map((n) => [n.id, n.ranks]));
    for (const v of Object.values(R.generalMods(p, 'yi', all))) assert.ok(v <= R.GENERAL_CAP.max && v >= R.GENERAL_CAP.min);
  });

  check('chapter commanders: full generals with three branches, their own career talent, era loot only, icons for every piece', () => {
    const chapter = C.GENERALS.filter((g) => !C.isImjin(g.faction));
    assert.equal(chapter.length, 29);
    for (const g of chapter) {
      const own = T.signatureNode(g.id);
      assert.ok(own, `${g.id} has a career talent`);
      assert.equal(own.branch, T.branchesOf(g.id)[0]);
      assert.ok(T.talentsFor(g.id).some((n) => n.id === own.id));
      const all = Object.fromEntries(T.talentsFor(g.id).map((n) => [n.id, n.ranks]));
      for (const v of Object.values(R.generalMods(R.newProfile(), g.id, all))) assert.ok(v <= R.GENERAL_CAP.max && v >= R.GENERAL_CAP.min, g.id);
    }
    // A Nelson at level 6 opens his own talent with six points in command.
    let p = { ...R.newProfile(), generals: { nelson: { xp: R.xpFor(8), talents: {} } } };
    for (const n of ['command.drums', 'command.drums', 'command.drums', 'command.law', 'command.drill', 'command.drill']) p = R.learn(p, 'nelson', n);
    p = R.learn(p, 'nelson', 'command.sig');
    assert.ok(R.generalMods(p, 'nelson').defense < R.generalMods({ ...p, generals: { nelson: { ...p.generals.nelson, talents: { ...p.generals.nelson.talents, 'command.sig': 0 } } } }, 'nelson').defense, 'breaking the line costs defense');
    for (const side of ['england', 'spain', 'holyleague', 'ottoman', 'britain', 'france', 'spain1805']) {
      for (let i = 0; i < 200; i++) for (const d of L.rollDrops('acct', i, { result: 'win', stars: 3, sunk: 5, firstWin: true, side })) {
        const b = L.itemBase(d.base);
        assert.ok(L.baseFits(b, side), `${side} dropped ${b.id}`);
        assert.ok(b.eras.includes(L.ERA_OF[side]));
      }
    }
    for (const b of L.ITEM_BASES) if (!b.weapon) assert.ok(existsSync(join(root, 'public', 'ui', 'items', `${b.id}.webp`)), `${b.id} icon`);
    const kilij = { uid: 'k', base: 'w_kilij', rarity: 'rare', rerolls: 0, seed: 1, src: '' };
    const q = { ...R.newProfile(), items: [kilij], generals: { alipasha: { xp: 0, talents: {} } } };
    assert.equal(R.equipItemProblem(q, 'nelson', 'weapon', 'k'), '다른 나라의 무기입니다');
    assert.equal(R.equipItemProblem(q, 'yi', 'weapon', 'k'), '다른 나라의 무기입니다');
    assert.equal(R.wornModel(R.equipItem(q, 'alipasha', 'weapon', 'k'), 'alipasha'), 'kilij');
    assert.equal(R.equipItemProblem({ ...q, items: [{ ...kilij, base: 'b_sonja' }] }, 'nelson', 'book', 'k'), '이 장수가 쓸 수 없는 물건입니다');
  });

  const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const storage = new Map([['imjin.meta.local.v1', JSON.stringify({ ...R.newProfile(), coins: 4321, owned: ['yi_tongjesa'], generals: { won: { xp: 300, talents: {}, armor: 'yi_tongjesa' } } })]]);
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
      assert.deepEqual(reloaded.generals.won, { xp: 300, talents: {}, armor: 'yi_tongjesa', weapon: 'joseon_gakgung' });
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
