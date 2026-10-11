// Regression checks for persistent fleets, supplies, independent seas and battle results.
// Runs the actual simulation/store modules headlessly: node scripts/test-sim.mjs.
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const storage = new Map();
// Node 24 exposes the host's navigator.language; make the fixture's initial locale explicit.
storage.set('imjin.lang', 'ko');
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
};
const server = await createServer({ root, configFile: false, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false }, optimizeDeps: { noDiscovery: true, include: [] } });
let failed = 0;
async function check(name, run) {
  try {
    await run();
    console.log(`ok   ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name}\n${error.stack}`);
  }
}
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);
const sumRoles = (s) => s.roles.reduce((a, x) => a + x, 0);

try {
  const load = (p) => server.ssrLoadModule(p);
  const { Battle, SIM_DT } = await load('/src/sim/battle.ts');
  const { SHIP_SPECS, GUN_SHOTS, NO_MODS } = await load('/src/sim/catalog.ts');
  const { buildScenario, SCENARIOS } = await load('/src/sim/scenarios.ts');
  const { buildConquestOn, buildConquest, CONQUEST_MAPS } = await load('/src/sim/maps.ts');
  const { BUILDINGS } = await load('/src/sim/conquest.ts');
  const { applyCommand } = await load('/src/sim/commands.ts');
  const { SEA_STATES, waveField } = await load('/src/ocean/waves.ts');
  const { setLang } = await load('/src/i18n/index.ts');
  const campaign = await load('/src/campaign/campaign.ts');
  const { newGrand } = await load('/src/sim/grand/turn.ts');
  const { describeContact, winnerOfBattle } = await load('/src/sim/grand/bridge.ts');
  const { buildGrandConquest } = await load('/src/sim/grand/spawn.ts');

  function fixture(options = {}) {
    const map = { night: false, sea: 'calm', points: [
      { name: 'west', hanja: '', x: -1000, z: 0, r: 250, value: 1, home: 0 },
      { name: 'east', hanja: '', x: 1000, z: 0, r: 250, value: 1, home: 1 },
    ] };
    const seats = [
      { name: 'west', faction: 'joseon', team: 'joseon', human: true, fleet: ['panokseon'] },
      { name: 'east', faction: 'japan', team: 'japan', human: true, fleet: ['atakebune'] },
    ];
    const built = buildConquestOn(map, seats, (_x, z) => z < -300 ? 3 : -50, 77, options);
    for (const s of built.battle.ships) {
      const p = built.conquest.homeOf(s.owner);
      s.x = p.x; s.z = p.z; s.speed = 0; s.order = { type: 'anchor' }; s.fireMode = 'hold';
    }
    for (const p of built.conquest.points) p.buildings = p.buildings.map((bd) => bd?.kind === 'battery' ? null : bd);
    return built;
  }

  await check('worn campaign crews have worn stations and casualties never restore men', () => {
    const fleet = { squads: [{ name: 'worn', commander: '', portrait: '', ships: [{ kind: 'panokseon', name: 'worn', hull: 1, crew: 0.1, supply: 1, campaignId: 's1', mods: { ...NO_MODS }, flagship: false }] }] };
    const b = buildScenario('okpo', 0, 77, () => -50, fleet);
    const s = b.ships.find((x) => x.campaignId === 's1');
    close(s.crew, 16); assert.equal(s.crew, sumRoles(s));
    close(b.rowing(s), 0.1); close(b.gunnery(s), 0.1);
    b.casualties(s, 1, 'all', false);
    close(s.crew, 15); assert.equal(s.crew, sumRoles(s));
  });

  await check('all hulls conserve station totals through reassignment, casualties and dock recovery', () => {
    const b = new Battle(77);
    b.land = () => -50;
    for (const kind of Object.keys(SHIP_SPECS)) {
      const s = b.addShip(kind, b.ships.length * 1000, 0, 0, kind, null);
      s.order = { type: 'anchor' }; s.fireMode = 'hold';
      assert.equal(s.crew, sumRoles(s));
      b.setCrew(s, s.spec.crew * 0.4);
      const before = s.crew;
      b.setPlan([s.id], [2, 1, 3, 4]);
      for (let i = 0; i < 30; i += 1) b.reassign(s, SIM_DT);
      close(s.crew, before); assert.equal(s.crew, sumRoles(s));
      for (const exposure of ['all', 'deck', 'hull', 'melee']) {
        const prior = s.crew;
        b.casualties(s, 2, exposure, false);
        assert.ok(s.crew <= prior); assert.equal(s.crew, sumRoles(s));
        b.mend(s, 0.01, 0.03);
        assert.equal(s.crew, sumRoles(s)); assert.ok(s.roles.every((v) => v >= 0));
      }
      const plan = [...s.plan];
      for (const bad of [[0, 0, 0, 0], [Infinity, 1, 1, 1], [NaN, 1, 1, 1], [Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE]]) b.setPlan([s.id], bad);
      assert.deepEqual(s.plan, plan);
      b.setCrew(s, s.spec.crew * 2); close(s.crew, s.spec.crew);
      b.mend(s, 0, 1); close(s.crew, s.spec.crew);
    }
  });

  await check('a wiped historical fleet rebuilds, saves and retries its current battle', () => {
    campaign.resetCampaign();
    const before = campaign.useCampaign.getState().campaign;
    const ids = before.squads.flatMap((q) => q.ships).map((s) => s.id);
    const report = campaign.applyOutcome({ id: 'okpo', win: false, enemySunk: 0, enemyEscaped: 0, ships: ids.map((campaignId) => ({ campaignId, alive: false, hull: 0, crew: 0, supply: 0, kills: 0 })) });
    assert.equal(report.lost, 43);
    assert.equal(campaign.useCampaign.getState().campaign.squads.length, 0);
    const funds = structuredClone(campaign.useCampaign.getState().campaign.resources);
    campaign.buildShip('hyeopseon', '');
    const rebuilt = campaign.useCampaign.getState().campaign;
    assert.equal(rebuilt.squads.length, 1); assert.equal(rebuilt.squads[0].ships.length, 1);
    assert.equal(rebuilt.squads[0].commanderId, 'yi');
    assert.equal(rebuilt.step, 0); assert.equal(campaign.currentBattle(rebuilt), 'okpo'); assert.equal(campaign.campaignOver(rebuilt), false);
    for (const key of ['grain', 'timber', 'powder']) assert.equal(rebuilt.resources[key], funds[key] - campaign.BUILD.hyeopseon[key]);
    assert.deepEqual(JSON.parse(storage.get('imjin.campaign.v1')), rebuilt);
    const spawned = buildScenario('okpo', 0, 77, () => -50, campaign.fleetSpawn(rebuilt));
    assert.equal(spawned.ships.filter((s) => s.campaignId).length, 1);
    const empty = structuredClone(rebuilt); empty.squads = []; empty.resources.timber = 0;
    campaign.useCampaign.setState({ campaign: empty });
    campaign.buildShip('hyeopseon', '');
    assert.equal(campaign.useCampaign.getState().campaign.squads.length, 0);
    // Legacy saves with no squad take the same build path, without requiring another battle outcome.
    empty.resources.timber = 100;
    campaign.useCampaign.setState({ campaign: JSON.parse(JSON.stringify(empty)) });
    campaign.buildShip('hyeopseon', '');
    assert.equal(campaign.useCampaign.getState().campaign.squads[0].ships.length, 1);
  });

  for (const locale of [
    { lang: 'ko', defeat: '패전했습니다. 함대를 정비한 뒤 다시 싸울 수 있습니다.', draw: '무승부입니다. 함대를 정비한 뒤 다시 싸울 수 있습니다.', defeatLabel: '패배', drawLabel: '무승부' },
    { lang: 'en', defeat: 'Defeated. Refit the fleet and try again.', draw: 'A draw. Refit the fleet, then try again.', defeatLabel: 'Defeat', drawLabel: 'Draw' },
  ]) await check(`campaign draws save a neutral result and retain the legacy defeat retry/reward policy (${locale.lang})`, () => {
    setLang(locale.lang);
    const outcome = { id: 'okpo', win: false, enemySunk: 2, enemyEscaped: 0, ships: [] };
    campaign.resetCampaign();
    const lost = campaign.applyOutcome(outcome);
    const legacy = JSON.parse(storage.get('imjin.campaign.v1'));
    assert.equal(lost.draw, undefined); assert.equal(legacy.history[0].draw, undefined);
    assert.deepEqual(lost.events, [locale.defeat]);
    assert.ok(legacy.log[0].includes(`: ${locale.defeatLabel} ·`));
    const { battle: b } = fixture({ timeLimit: SIM_DT }); b.step(SIM_DT);
    assert.equal(b.draw, true);
    campaign.resetCampaign();
    const report = campaign.applyOutcome({ ...outcome, win: b.winner === 'joseon', draw: b.draw });
    const c = campaign.useCampaign.getState().campaign;
    assert.equal(report.win, false); assert.equal(report.draw, true);
    assert.equal(c.step, 0); assert.equal(campaign.currentBattle(c), 'okpo'); assert.equal(campaign.campaignOver(c), false);
    assert.equal(c.history[0].win, false); assert.equal(c.history[0].draw, true);
    assert.deepEqual(c.resources, legacy.resources); assert.deepEqual(report.loot, lost.loot); assert.deepEqual(report.xp, lost.xp);
    assert.deepEqual(report.events, [locale.draw]);
    assert.ok(!report.events.includes(locale.defeat));
    assert.ok(c.log[0].includes(`: ${locale.drawLabel} ·`)); assert.ok(!c.log[0].includes(`: ${locale.defeatLabel} ·`));
    assert.deepEqual(JSON.parse(storage.get('imjin.campaign.v1')), c);
    assert.equal(buildScenario('okpo', 0, 77, () => -50, campaign.fleetSpawn(c)).ships.filter((s) => s.campaignId).length, 43);
    // A contradictory caller cannot grant the victory policy to a draw.
    campaign.resetCampaign();
    const conflict = campaign.applyOutcome({ ...outcome, win: true, draw: true });
    assert.equal(conflict.win, false); assert.equal(campaign.useCampaign.getState().campaign.step, 0);
    assert.deepEqual(conflict.loot, lost.loot);
  });
  setLang('ko');

  await check('one second of magazine service supplies exactly one percent at 1/20/30/60 Hz', () => {
    const results = [];
    for (const hz of [1, 20, 30, 60]) {
      const { battle: b, conquest: c } = fixture();
      const s = b.ships.find((s) => s.owner === 0);
      b.applySupply(s, 0);
      const home = c.homeOf(0);
      home.buildings.push({ kind: 'magazine', hp: BUILDINGS.magazine.hp, progress: 1, reload: [] });
      for (let i = 0; i < hz; i += 1) b.step(1 / hz);
      close(s.supply, 0.01);
      for (const g of s.guns) close(g.ammo, GUN_SHOTS[s.spec.batteries[g.battery].gun] * 0.01);
      results.push(s.guns.map((g) => g.ammo));
      const snapshot = JSON.stringify(s.guns);
      for (const amount of [0, -1, NaN, Infinity]) b.resupply(s, amount);
      assert.equal(JSON.stringify(s.guns), snapshot);
      b.resupply(s, 2);
      for (const g of s.guns) assert.equal(g.ammo, GUN_SHOTS[s.spec.batteries[g.battery].gun]);
    }
    results.slice(1).forEach((row) => row.forEach((v, i) => close(v, results[0][i])));
  });

  await check('fractional credits cannot load or fire a round; a completed round can fire', () => {
    const b = new Battle(77);
    const s = b.addShip('panokseon', 0, 0, 0, 'test', null);
    const g = s.guns[0];
    b.applySupply(s, 0); b.resupply(s, 0.001);
    g.stage = 0; g.t = 0;
    b.weapons(s, 100);
    assert.equal(g.stage, 0); assert.equal(g.t, 0);
    g.stage = 5; g.fireDelay = 0; g.target = -1;
    b.weapons(s, SIM_DT);
    assert.equal(b.events.filter((e) => e.type === 'shot').length, 0);
    g.ammo = 1;
    b.weapons(s, SIM_DT);
    assert.equal(b.events.filter((e) => e.type === 'shot').length, 1); assert.equal(g.ammo, 0);
  });

  function projectileBattle() {
    const b = new Battle(77); b.setSea(SEA_STATES.rough);
    b.projectiles.push({ id: 1, x: 0, y: 0.1, z: 0, vx: 0, vy: 0, vz: 0, team: 'joseon', shooter: 0, damage: 1, crewDamage: 1, ammo: 'ball', gun: 'cheonja', fireChance: 0, age: 0, alive: true });
    return b;
  }
  const snap = (b) => JSON.stringify({ time: b.time, ships: b.ships, projectiles: b.projectiles, events: b.events, winner: b.winner, draw: b.draw });
  await check('other battles and rendering wave changes cannot alter projectile outcomes', () => {
    const a = projectileBattle(); const z = projectileBattle(); const other = new Battle(3);
    assert.notEqual(a.waves, z.waves); assert.notEqual(a.waves, waveField);
    for (let i = 0; i < 30; i += 1) {
      a.step(SIM_DT);
      other.setSea(i % 2 ? SEA_STATES.calm : SEA_STATES.rough); other.step(SIM_DT * 7);
      waveField.setState(i % 2 ? SEA_STATES.moderate : SEA_STATES.calm); waveField.time = i * 100 + 4.5;
      z.step(SIM_DT);
      assert.equal(snap(a), snap(z)); assert.equal(a.waves.time, a.time); assert.equal(z.waves.time, z.time);
    }
    assert.deepEqual(a.waves.state, SEA_STATES.rough);
  });

  await check('scenario/map builders own the correct sea and projectile collisions follow local time', () => {
    for (const [id, info] of Object.entries(SCENARIOS)) assert.deepEqual(buildScenario(id, 0, 77).waves.state, SEA_STATES[info.sea]);
    for (const [id, info] of Object.entries(CONQUEST_MAPS)) assert.deepEqual(buildConquest(id, [], () => -50, 77).battle.waves.state, SEA_STATES[info.sea]);
    const a = projectileBattle(); const z = projectileBattle();
    a.time = 4.5 - SIM_DT; z.time = 0.3 - SIM_DT;
    waveField.time = -100;
    a.step(SIM_DT); z.step(SIM_DT);
    assert.equal(a.projectiles.length, 0); assert.equal(z.projectiles.length, 1);
    assert.ok(a.events.some((e) => e.type === 'splash'));
  });

  await check('ordinary conquest ties are draws, including simultaneous elimination and exhausted tickets', () => {
    for (const options of [{ timeLimit: SIM_DT }, { tickets: 0 }]) {
      const { battle: b } = fixture(options); b.step(SIM_DT);
      assert.equal(b.draw, true); assert.equal(b.winner, null); assert.equal(b.ended, true);
      b.step(SIM_DT); assert.equal(b.draw, true); assert.equal(b.winner, null);
    }
    const { battle: b, conquest: c } = fixture();
    b.ships.forEach((s) => s.struck = true); c.points.forEach((p) => { p.buildings = []; p.queue = []; }); c.players.forEach((p) => p.funds = 0);
    b.time = 6; b.step(SIM_DT);
    assert.equal(b.draw, true); assert.equal(b.ended, true);
    for (const winner of ['joseon', 'japan']) {
      const one = fixture({ timeLimit: SIM_DT }); one.conquest.tickets[winner] += 1; one.battle.step(SIM_DT);
      assert.equal(one.battle.winner, winner); assert.equal(one.battle.draw, false);
    }
  });

  await check('equal-ticket grand timeouts hold the defending port for either invading navy', () => {
    for (const [attacker, defender] of [['joseon', 'japan'], ['japan', 'joseon']]) {
      const g = newGrand(attacker, 3);
      const c = { id: 'tie', regionId: defender === 'joseon' ? 'hansan' : 'busan', attacker, defender, attackerFleets: g.fleets.filter((f) => f.faction === attacker).map((f) => f.id), defenderFleets: g.fleets.filter((f) => f.faction === defender).map((f) => f.id), player: true };
      const rb = describeContact(g, c); const { battle: b, conquest } = buildGrandConquest(rb, () => -50);
      // Keep a live ship on each side and reach the real builder's timeout without advancing the ticket drain.
      assert.ok(b.ships.some((s) => s.team === rb.attacker.team)); assert.ok(b.ships.some((s) => s.team === rb.defender.team));
      b.time = rb.options.timeLimit; b.step(SIM_DT);
      assert.equal(conquest.tickets.joseon, conquest.tickets.japan);
      assert.equal(b.winner, rb.defender.team); assert.equal(b.draw, false); assert.equal(b.ended, true);
      assert.equal(winnerOfBattle(rb, b.winner), 'defender');
    }
  });

  await check('malformed building/queue indices are rejected without mutation; valid commands still refund', () => {
    const { battle: b, conquest: c } = fixture();
    const p = c.homeOf(0); const pl = c.player(0);
    assert.ok(c.recruitIn(b, 0, p.id, 'hyeopseon'));
    const before = JSON.stringify({ points: c.points, players: c.players, events: b.events });
    for (const bad of ['length', 'constructor', '0', -1, 0.5, NaN, Infinity, 10000]) {
      assert.equal(applyCommand(b, 0, { type: 'demolish', point: p.id, slot: bad }, c), 0);
      assert.equal(applyCommand(b, 0, { type: 'cancel', point: p.id, index: bad }, c), 0);
      assert.equal(applyCommand(b, 0, { type: 'demolish', point: bad, slot: 0 }, c), 0);
      assert.equal(applyCommand(b, 0, { type: 'cancel', point: bad, index: 0 }, c), 0);
    }
    assert.equal(JSON.stringify({ points: c.points, players: c.players, events: b.events }), before);
    let funds = pl.funds;
    assert.equal(applyCommand(b, 0, { type: 'cancel', point: p.id, index: 0 }, c), 1);
    assert.equal(pl.funds, funds + SHIP_SPECS.hyeopseon.cost); assert.equal(p.queue.length, 0);
    funds = pl.funds;
    assert.equal(applyCommand(b, 0, { type: 'demolish', point: p.id, slot: 0 }, c), 1);
    assert.equal(pl.funds, funds + Math.round(BUILDINGS.shipyard.cost * 0.25)); assert.equal(p.buildings[0], null);
  });
} finally {
  await server.close();
  delete globalThis.localStorage;
}
console.log(failed ? `${failed} failed` : 'all passed');
process.exitCode = failed ? 1 : 0;
