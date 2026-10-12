// The campaign commanders' abilities (장수 특수능력, src/sim/grand/commanders.ts): every commander has one with Korean and
// English text, a save made before them gets them, kwon's works, yi's and wakisaka's battle mods, the computer and the
// player treated alike, and none of it rolls the campaign's dice.
//   node scripts/test-commanders.mjs
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
const vite = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), configFile: false, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false }, optimizeDeps: { noDiscovery: true, include: [] } });
let failed = 0;
const check = (name, fn) => { try { fn(); console.log('PASS ' + name); } catch (e) { failed++; console.error('FAIL ' + name, e); } };
try {
  const load = (p) => vite.ssrLoadModule(p);
  const { newGrand, endTurn, resolveContact, autoResolveContact, captureRegion } = await load('/src/sim/grand/turn.ts');
  const { planAi } = await load('/src/sim/grand/ai.ts');
  const orders = await load('/src/sim/grand/orders.ts');
  const bridge = await load('/src/sim/grand/bridge.ts');
  const { buildGrandConquest } = await load('/src/sim/grand/spawn.ts');
  const { COMMANDERS } = await load('/src/sim/grand/regions.ts');
  const { buildingCost, buildTerms, regionIncome } = await load('/src/sim/grand/economy.ts');
  const cmd = await load('/src/sim/grand/commanders.ts');
  const { EN } = await load('/src/i18n/en/index.ts');
  const HANGUL = /[가-힣]/;
  const clone = (g) => JSON.parse(JSON.stringify(g));
  const fleetOf = (g, id) => g.fleets.find((f) => f.commanderId === id);
  /** The same campaign with every ability emptied, to compare against. */
  const plain = (run) => {
    const saved = Object.fromEntries(Object.entries(cmd.ABILITIES).map(([k, v]) => [k, v]));
    for (const k of Object.keys(cmd.ABILITIES)) cmd.ABILITIES[k] = { ...saved[k], campaign: {}, battle: {} };
    try { return run(); } finally { Object.assign(cmd.ABILITIES, saved); }
  };
  /** A Japanese attack on Geoje that waits for the Joseon player, as test-grand.mjs sets it up. */
  const meeting = (g) => {
    const jp = g.fleets.find((f) => f.faction === 'japan' && f.at === 'busan');
    g.turn = 3;
    orders.orderMove(g, jp.id, 'geoje');
    planAi(g, 'ming');
    const report = endTurn(g);
    assert.equal(report.pending.length, 1, 'the meeting at Geoje waits for the player');
    return report.pending[0];
  };

  check('every commander has an ability with a Korean name of two to four syllables, a Korean line with a number, and English for both', () => {
    for (const c of COMMANDERS) {
      const a = cmd.abilityOf(c.id);
      assert(a, `${c.id} has no ability`);
      const syllables = [...a.name].filter((ch) => HANGUL.test(ch)).length;
      assert(syllables >= 2 && syllables <= 4 && [...a.name].every((ch) => HANGUL.test(ch) || ch === ' '), `${c.id}: ${a.name}`);
      assert(HANGUL.test(a.text) && /\d/.test(a.text), `${c.id}: ${a.text}`);
      assert(EN[a.name], `no English for ${a.name}`);
      assert(EN[a.text], `no English for ${a.text}`);
      assert(Object.keys(a.campaign).length + Object.keys(a.battle).length > 0, `${c.id} does nothing`);
    }
    const names = COMMANDERS.map((c) => cmd.abilityOf(c.id).name);
    assert.equal(new Set(names).size, names.length, 'two commanders share an ability');
  });

  check('a save made before abilities (nothing stored for them) gets each commander\'s ability by his id', () => {
    const g = newGrand('joseon', 3);
    const text = JSON.stringify(g);
    assert(!text.includes('ability') && !text.includes('paidGold') && !text.includes('seizedBy'), 'a fresh save stores no ability state');
    const old = JSON.parse(text);
    for (const fl of old.fleets.filter((f) => f.commanderId)) assert.equal(cmd.fleetAbility(old, fl), cmd.ABILITIES[fl.commanderId]);
    const yi = fleetOf(old, 'yi');
    assert.equal(bridge.describeContact(old, { id: 'x', regionId: yi.at, attacker: 'japan', defender: 'joseon', attackerFleets: [], defenderFleets: [yi.id], player: true }).defender.formation, 'crane');
  });

  check('kwon\'s fleet in a port makes its works cheaper and a turn shorter; a cancel refunds what was paid, even after he left', () => {
    const g = newGrand('joseon', 4);
    g.factions.joseon.gold = 100000;
    const kwon = fleetOf(g, 'kwon');
    const port = kwon.at;
    assert.equal(cmd.campaignMultiplier(g, kwon, 'buildCost'), 0.8);
    assert.deepEqual(cmd.portBuilder(g, port, 'joseon'), { buildCost: 0.8, buildTurns: -1 });
    // A third level of a battery takes two turns on the list, one with him; a camp stays at its one turn.
    const list = buildingCost('battery', 3);
    assert.equal(list.turns, 2);
    assert.deepEqual(buildTerms(g, port, 'battery', 3), { gold: Math.round(list.gold * 0.8), turns: 1 });
    assert.equal(buildTerms(g, port, 'camp', 2).turns, 1);
    assert.equal(buildTerms(g, port, 'camp', 2).gold, Math.round(buildingCost('camp', 2).gold * 0.8));
    const elsewhere = g.fleets.find((f) => f.faction === 'joseon' && f.at && f.at !== port && !g.fleets.some((o) => o.at === f.at && o.commanderId === 'kwon')).at;
    assert.deepEqual(buildTerms(g, elsewhere, 'camp', 2), buildingCost('camp', 2));
    const before = g.factions.joseon.gold;
    assert(orders.orderBuild(g, port, 'camp').ok);
    const camp = g.regions[port].buildings.find((b) => b.kind === 'camp');
    assert.equal(before - g.factions.joseon.gold, camp.paidGold);
    kwon.at = elsewhere;
    assert(orders.cancelBuild(g, port, 'camp').ok);
    assert.equal(g.factions.joseon.gold, before);
  });

  check('yi and wakisaka carry their table\'s battle mods into the 3D battle; yi\'s seat starts in the crane wing', () => {
    assert.deepEqual(cmd.battleMods('yi'), { reload: 1.08 });
    assert.deepEqual(cmd.battleMods('wakisaka'), { opening: 1.15 });
    const g = newGrand('joseon', 5);
    const geoje = g.fleets.find((f) => f.at === 'geoje');
    fleetOf(g, 'yi').commanderId = null;
    geoje.commanderId = 'yi';
    const c = meeting(g);
    const rb = bridge.describeBattle(g, c.id);
    const yiLevel = g.factions.joseon.commanders.find((x) => x.id === 'yi').level;
    const yiShips = rb.defender.ships.filter((s) => s.fleetId === geoje.id);
    assert(yiShips.length > 0);
    for (const s of yiShips) {
      const skill = 0.03 * (yiLevel - 1) + 0.04 * Math.min(1, s.kills / 12);
      assert(Math.abs(s.mods.reload - (1 + skill) * 1.08) < 1e-12, `reload ${s.mods.reload}`);
      assert.equal(s.mods.opening, undefined);
    }
    assert.equal(rb.defender.formation, 'crane');
    const waki = fleetOf(g, 'wakisaka');
    const wakiShips = rb.attacker.ships.filter((s) => s.fleetId === waki.id);
    assert(wakiShips.length > 0);
    for (const s of wakiShips) assert.equal(s.mods.opening, 1.15);
    assert.equal(rb.attacker.formation, undefined);
    // Ships without a commander carry none of the optional mods, like every battle outside the campaign.
    for (const s of [...rb.attacker.ships, ...rb.defender.ships].filter((s) => !s.fleetId)) assert.deepEqual(Object.keys(s.mods).sort(), ['accuracy', 'defense', 'fire', 'melee', 'reload', 'speed', 'turn']);
  });

  check('in the 3D battle the ability mods reach the ships and yi\'s fleet berths on a crane arc', () => {
    const g = newGrand('joseon', 5);
    const geoje = g.fleets.find((f) => f.at === 'geoje');
    fleetOf(g, 'yi').commanderId = null;
    geoje.commanderId = 'yi';
    const c = meeting(g);
    const rb = bridge.describeBattle(g, c.id);
    const { battle } = buildGrandConquest(rb, () => -50);
    const ships = battle.ships.filter((s) => s.campaignId);
    const waki = new Set(fleetOf(g, 'wakisaka').ships.map((u) => u.id));
    for (const s of ships.filter((s) => waki.has(s.campaignId))) assert.equal(s.mods.opening, 1.15);
    for (const s of ships.filter((s) => !waki.has(s.campaignId))) assert.equal(s.mods.opening, undefined);
    // The wings stand nearer the enemy than the flagship in the middle.
    const yi = ships.filter((s) => geoje.ships.some((u) => u.id === s.campaignId));
    const foe = ships.filter((s) => waki.has(s.campaignId));
    const fx = foe.reduce((a, s) => a + s.x, 0) / foe.length, fz = foe.reduce((a, s) => a + s.z, 0) / foe.length;
    const dist = (s) => Math.hypot(s.x - fx, s.z - fz);
    const flag = yi[0];
    assert(yi.length >= 3 && Math.min(...yi.slice(-2).map(dist)) < dist(flag), 'the wings reach forward');
  });

  check('the computer and the player get the same effects from the same commander', () => {
    const base = newGrand('joseon', 5);
    const c = meeting(base);
    const as = (player) => ({ ...clone(base), player });
    const views = ['joseon', 'japan', null].map((p) => {
      const g = as(p);
      const rb = bridge.describeBattle(g, c.id);
      return {
        mods: [...rb.attacker.ships, ...rb.defender.ships].map((s) => [s.campaignId, s.mods]),
        formation: [rb.attacker.formation, rb.defender.formation],
        resolve: resolveContact(g, g.pending[0]).outcome,
        repair: g.fleets.map((f) => [cmd.campaignMultiplier(g, f, 'repair'), cmd.campaignMultiplier(g, f, 'resupply'), cmd.restDelta(g, f)]),
        reinforce: ['joseon', 'japan', 'ming'].map((f) => cmd.reinforceExtra(g, f)),
      };
    });
    assert.deepEqual(views[1], views[0]);
    assert.deepEqual(views[2], views[0]);
    assert.equal(cmd.reinforceExtra(base, 'ming'), 2);
  });

  check('the abilities change the fight they are in: a won-led defence boards harder than the same fleet without him', () => {
    const g = newGrand('joseon', 5);
    const c = meeting(g);
    const withWon = resolveContact(g, c);
    const without = plain(() => resolveContact(g, c));
    assert.notDeepEqual(withWon.strength, without.strength);
  });

  check('kato\'s captures pay 30% more silver while his navy holds them, and lose it when the port changes hands', () => {
    const g = newGrand(null, 9);
    const h = clone(g);
    captureRegion(g, 'myeongnyang', 'japan', [fleetOf(g, 'kato')]);
    captureRegion(h, 'myeongnyang', 'japan', [fleetOf(h, 'wakisaka')]);
    assert.equal(g.regions.myeongnyang.seizedBy, 'kato');
    assert.equal(h.regions.myeongnyang.seizedBy, undefined);
    const plunder = regionIncome(g, 'myeongnyang');
    const usual = regionIncome(h, 'myeongnyang');
    assert(Math.abs(plunder - usual * 1.3) <= 1, `${plunder} against ${usual}`);
    captureRegion(g, 'myeongnyang', 'joseon', []);
    assert.equal(g.regions.myeongnyang.seizedBy, undefined);
  });

  check('running turns with the abilities is deterministic: two identical computer campaigns end in the same state', () => {
    const run = () => {
      const g = newGrand(null, 77);
      for (let i = 0; i < 12 && g.phase === 'orders'; i += 1) endTurn(g);
      return g;
    };
    assert.deepEqual(run(), run());
  });

  check('the abilities never draw from the campaign\'s dice', () => {
    // Reading every effect leaves the generator where it was.
    const g = newGrand('joseon', 5);
    const c = meeting(g);
    const s = g.rng.s;
    for (const fl of g.fleets) {
      cmd.campaignMultiplier(g, fl, 'repair');
      cmd.restDelta(g, fl);
      cmd.fleetEdges(g, [fl]);
      if (fl.at) cmd.portBuilder(g, fl.at, fl.faction);
    }
    for (const f of ['joseon', 'japan', 'ming']) cmd.reinforceExtra(g, f);
    bridge.describeBattle(g, c.id);
    resolveContact(g, c);
    assert.equal(g.rng.s, s);
    // A whole turn in which no ability changes a decision (the opening turn: no fights, no repairs, no works by the
    // player) ends with the generator in the same state, and the same campaign, as one with every ability emptied.
    const turn = () => { const h = newGrand('joseon', 12); endTurn(h); return h; };
    const on = turn();
    const off = plain(turn);
    assert.equal(on.rng.s, off.rng.s);
    assert.deepEqual(on, off);
    // A settled fight draws only from its own generator, with or without the abilities.
    const h = clone(g);
    const k = clone(g);
    autoResolveContact(h, c.id);
    plain(() => autoResolveContact(k, c.id));
    assert.equal(h.rng.s, k.rng.s);
  });
} finally {
  await vite.close();
}
if (failed) {
  console.error(`${failed} check(s) failed`);
  process.exit(1);
}
console.log('all commander checks passed');
