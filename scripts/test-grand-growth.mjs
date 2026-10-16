// The campaign's growth rules (growth.ts): named commanders joining on their turns, experience, skill points and the
// skill tree, the navies' tech trees, what both do to the 3D battle and the auto-resolve, the computer's picks,
// determinism, and bringing an old save under the rules.
//   node scripts/test-grand-growth.mjs
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const server = await createServer({ root, configFile: false, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] } });
const ok = (label) => console.log(`ok   ${label}`);
try {
  const load = (p) => server.ssrLoadModule(p);
  const { newGrand, endTurn, autoResolveContact, contactForces } = await load('/src/sim/grand/turn.ts');
  const growth = await load('/src/sim/grand/growth.ts');
  const data = await load('/src/sim/grand/growthData.ts');
  const { COMMANDERS } = await load('/src/sim/grand/regions.ts');
  const { grantXp } = await load('/src/sim/grand/roster.ts');
  const { factionIncome } = await load('/src/sim/grand/economy.ts');
  const { describeContact } = await load('/src/sim/grand/bridge.ts');
  const { autoResolve } = await load('/src/sim/grand/autoresolve.ts');
  const { existsSync } = await import('node:fs');

  // 1. Every named commander has a tree, a portrait and joins once.
  for (const c of COMMANDERS) {
    const tree = data.TREES[c.id];
    assert.ok(tree, `${c.id} has a tree`);
    assert.ok(tree.branches.length >= 2 && tree.branches.length <= 3, `${c.id}: two or three branches`);
    for (const size of ['', '_sm']) assert.ok(existsSync(join(root, 'public/ui/portraits', `${c.portrait}${size}.webp`)), `${c.portrait}${size}.webp`);
  }
  assert.equal(new Set(COMMANDERS.map((c) => c.id)).size, COMMANDERS.length);
  ok(`${COMMANDERS.length} commanders, each with a tree and both portrait sizes`);

  const g = newGrand('joseon', 7);
  assert.equal(g.growth, 'v1');
  const joseon = g.factions.joseon.commanders.map((c) => c.id);
  for (const id of ['yi', 'won', 'eokgi', 'kwon', 'eo', 'jeongun', 'nadaeyong']) assert.ok(joseon.includes(id), `${id} at the start`);
  for (const id of ['baeseol', 'anwi', 'iwan', 'iyeongnam']) assert.ok(!joseon.includes(id), `${id} not yet`);
  assert.ok(!g.factions.japan.commanders.some((c) => c.id === 'shimazu'));
  ok('the opening officers are there on turn 1, the later ones are not');

  // 2. Joining on the historical turn, once.
  const later = structuredClone(g);
  later.turn = 20;
  growth.joinCommanders(later);
  growth.joinCommanders(later);
  assert.equal(later.factions.joseon.commanders.filter((c) => c.id === 'baeseol').length, 1);
  assert.ok(later.factions.japan.commanders.some((c) => c.id === 'shimazu') && later.factions.japan.commanders.some((c) => c.id === 'konishi'));
  assert.ok(!later.factions.japan.commanders.some((c) => c.id === 'tachibana'));
  assert.ok(later.log.some((e) => e.text.includes('합류') && e.params?.name === '배설'));
  ok('Bae Seol, Shimazu and Konishi join in 1597 (turn 20), Tachibana not before 1598');

  // 3. Skill points and the tree's order.
  const yi = g.factions.joseon.commanders.find((c) => c.id === 'yi');
  assert.equal(yi.level, 3);
  assert.equal(growth.skillPoints(yi), 2);
  assert.equal(growth.learnSkill(g, 'joseon', 'yi', 'gunnery2').ok, false, 'a second step needs the first');
  assert.equal(growth.learnSkill(g, 'joseon', 'yi', 'boarding1').ok, false, 'not a branch of his');
  assert.equal(growth.learnSkill(g, 'joseon', 'yi', 'mastery').ok, false, 'mastery waits for level 4');
  assert.ok(growth.learnSkill(g, 'joseon', 'yi', 'gunnery1').ok);
  assert.ok(growth.learnSkill(g, 'joseon', 'yi', 'gunnery2').ok);
  assert.equal(growth.learnSkill(g, 'joseon', 'yi', 'command1').ok, false, 'no point left');
  grantXp(g, 'joseon', yi, 2000);
  assert.equal(yi.level, 6);
  assert.equal(growth.skillPoints(yi), 3);
  assert.ok(growth.learnSkill(g, 'joseon', 'yi', 'mastery').ok);
  ok('one point a level, steps in order, own branches only, mastery from level 4');

  // 4. What a commander does to his ships.
  const b = growth.commanderBonus(yi);
  assert.equal(b.temper, 'steady');
  assert.ok(b.mods.accuracy > 1.06 * 1.07 * 1.06 - 1e-9 && b.mods.reload > 1.05);
  const won = growth.commanderBonus(g.factions.joseon.commanders.find((c) => c.id === 'won'));
  assert.equal(won.temper, 'rash');
  assert.ok(won.mods.defense < 1 && won.mods.melee > 1);
  const shimazu = growth.commanderBonus({ ...COMMANDERS.find((c) => c.id === 'shimazu'), xp: 0, alive: true, skills: [] });
  assert.ok(shimazu.mods.melee >= 1.15 && shimazu.temper === 'bold');
  ok('Yi\'s crane wing steadies and aims, Won Gyun is rash, Shimazu boards hard');

  // 5. Research: paid, turns, the unlock, the refund.
  const t = newGrand('joseon', 9);
  t.factions.joseon.gold = 2000;
  assert.equal(growth.orderResearch(t, 'joseon', 'turtle').ok, false, 'turtle ship needs the improved panokseon');
  assert.ok(growth.orderResearch(t, 'joseon', 'panokseon').ok);
  assert.equal(t.factions.joseon.gold, 2000 - data.techById('joseon', 'panokseon').gold);
  assert.equal(growth.orderResearch(t, 'joseon', 'powder').ok, false, 'one at a time');
  assert.ok(growth.cancelResearch(t, 'joseon').ok);
  assert.equal(t.factions.joseon.gold, 2000);
  assert.ok(growth.orderResearch(t, 'joseon', 'panokseon').ok);
  growth.advanceResearch(t);
  assert.ok(!t.factions.joseon.tech.done.includes('panokseon'));
  growth.advanceResearch(t);
  assert.ok(t.factions.joseon.tech.done.includes('panokseon'));
  assert.ok(growth.orderResearch(t, 'joseon', 'turtle').ok);
  growth.advanceResearch(t);
  growth.advanceResearch(t);
  assert.ok(t.factions.joseon.unlocked.includes('geobukseon'));
  ok('research costs silver up front, takes its turns, unlocks the turtle ship, refunds when stopped');

  const m = growth.growthMods(t, 'joseon', 'panokseon', undefined);
  assert.ok(Math.abs(m.defense - 1.1) < 1e-9 && m.reload === 1);
  assert.equal(growth.growthMods(t, 'joseon', 'hyeopseon', undefined).defense, 1, 'the refit is for panokseon and turtle ships');
  const inc = newGrand('ming', 3);
  const before = factionIncome(inc, 'ming');
  inc.factions.ming.tech.done.push('grain');
  assert.ok(factionIncome(inc, 'ming') > before);
  ok('a tech reaches the right hulls and the treasury');

  // 6. The 3D battle and the auto-resolve read it.
  const war = newGrand(null, 21);
  // A meeting built by hand: Yi's fleet attacks the Japanese at Busan.
  const yiFleet = war.fleets.find((f) => f.commanderId === 'yi');
  const foe = war.fleets.find((f) => f.faction === 'japan' && f.at);
  if (yiFleet && foe) {
    const c = { id: 'c-test', regionId: foe.at, attacker: 'joseon', defender: 'japan', attackerFleets: [yiFleet.id], defenderFleets: [foe.id], player: false };
    const rb = describeContact(war, c);
    const ship = rb.attacker.ships.find((s) => s.fleetId === yiFleet.id);
    assert.ok(ship.mods.accuracy > 1.06, 'Yi\'s trait in the battle mods');
    const leader = rb.attacker.leader;
    assert.equal(leader.temper, 'steady');
    const forces = contactForces(war, c);
    assert.ok(forces.attacker.mods[yiFleet.ships[0].id].morale > 1);
    // The same fight with and without the growth modifiers: they help the side that has them.
    const plain = { ...forces.attacker, mods: undefined };
    const strong = { ...forces.attacker, mods: Object.fromEntries(yiFleet.ships.map((u) => [u.id, { reload: 1.3, accuracy: 1.3, speed: 1, turn: 1, fire: 1.2, melee: 1.3, defense: 1.3, morale: 1.3 }])) };
    let gain = 0;
    for (let s = 1; s <= 20; s += 1) {
      const a = autoResolve({ attacker: plain, defender: forces.defender, seed: s, tags: [1] });
      const z = autoResolve({ attacker: strong, defender: forces.defender, seed: s, tags: [1] });
      gain += z.strength.attacker[1] / z.strength.attacker[0] - a.strength.attacker[1] / a.strength.attacker[0];
    }
    assert.ok(gain > 0, `the modifiers keep more of the fleet afloat (${gain.toFixed(3)})`);
    ok('Yi\'s fleet carries his trait into the 3D battle (mods, steady temper) and the auto-resolve');
  } else throw new Error('no Yi fleet or Japanese fleet to test with');

  // 7. The computer spends points and researches; the same seed, the same war.
  const run = () => {
    const w = newGrand(null, 1592);
    for (let i = 0; i < 24 && w.phase !== 'over'; i += 1) {
      const r = endTurn(w);
      for (const p of r.pending) autoResolveContact(w, p.id);
    }
    return w;
  };
  const w1 = run();
  const w2 = run();
  assert.equal(JSON.stringify(w1), JSON.stringify(w2));
  for (const f of ['joseon', 'japan', 'ming']) assert.ok(w1.factions[f].tech.done.length >= 2, `${f} researched ${w1.factions[f].tech.done.join(',')}`);
  assert.ok(w1.factions.joseon.unlocked.includes('geobukseon'), 'the computer researches the turtle ship');
  const spent = w1.factions.japan.commanders.concat(w1.factions.joseon.commanders).filter((c) => c.skills.length > 0);
  assert.ok(spent.length > 0);
  for (const c of [...w1.factions.joseon.commanders, ...w1.factions.japan.commanders, ...w1.factions.ming.commanders]) assert.ok(growth.skillPoints(c) <= 1, `${c.id} spent his points (at most the level of the last fight is left)`);
  ok(`a computer war is deterministic; techs ${['joseon', 'japan', 'ming'].map((f) => w1.factions[f].tech.done.length).join('/')}, ${spent.length} commanders with skills`);

  // 8. An old save: no growth, no skills, no tech, only the opening commanders, the turtle ship handed out on its date.
  const old = newGrand('joseon', 5);
  delete old.growth;
  for (const f of ['joseon', 'japan', 'ming']) {
    delete old.factions[f].tech;
    old.factions[f].commanders = old.factions[f].commanders.filter((c) => COMMANDERS.find((d) => d.id === c.id).joins === undefined);
    for (const c of old.factions[f].commanders) delete c.skills;
  }
  old.factions.joseon.unlocked.push('geobukseon');
  old.turn = 21;
  const logLength = old.log.length;
  assert.ok(growth.migrateGrandGrowth(old));
  assert.equal(old.growth, 'v1');
  assert.deepEqual(old.factions.joseon.tech.done.sort(), ['panokseon', 'turtle']);
  assert.ok(old.factions.joseon.commanders.some((c) => c.id === 'anwi') && !old.factions.joseon.commanders.some((c) => c.id === 'iwan'));
  assert.equal(growth.skillPoints(old.factions.joseon.commanders.find((c) => c.id === 'yi')), 2, 'his levels become points');
  assert.equal(old.log.length, logLength, 'joining on load is not news');
  assert.equal(growth.migrateGrandGrowth(old), false);
  endTurn(old);
  ok('an old save comes under the rules: built hulls count as researched, past officers join quietly, levels become points');
} finally {
  await server.close();
}
console.log('all passed');
