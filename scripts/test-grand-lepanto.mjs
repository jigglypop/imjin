// The faction campaign's Lepanto theatre (src/sim/grand/theatre.ts, regionsLepanto.ts), headless: a war of the Holy
// League and the Ottoman Empire on its own regions, lanes, commanders and techs, deterministic and playable to its end;
// its battles fought on the Lepanto chapter's coasts; and the 1592 war untouched by it.
//   node scripts/test-grand-lepanto.mjs
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const server = await createServer({ root, configFile: false, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] } });
const load = (p) => server.ssrLoadModule(p);
const { newGrand, endTurn, autoResolveContact } = await load('/src/sim/grand/turn.ts');
const { THEATRES, factionsOf, orderOf } = await load('/src/sim/grand/theatre.ts');
const { REGIONS, REGION_ORDER, LANES } = await load('/src/sim/grand/regions.ts');
const { LEPANTO_REGION_ORDER } = await load('/src/sim/grand/regionsLepanto.ts');
const { REGION_MAPS } = await load('/src/sim/grand/coast.ts');
const { describeBattle } = await load('/src/sim/grand/bridge.ts');
const { grandInfo } = await load('/src/sim/grand/spawn.ts');
const { dateLabel, kindsOf, shipDef } = await load('/src/sim/grand/economy.ts');
const { skillsOf, techOf, orderResearch } = await load('/src/sim/grand/growth.ts');
const { techsOf } = await load('/src/sim/grand/growthData.ts');

let passed = 0;
const check = (name, test) => { test(); passed++; console.log(`ok - ${name}`); };

/** Plays a war to its end with the computer taking every decision, the player's meetings settled automatically. */
function play(g, turns = 40) {
  for (let t = 0; t < turns && g.phase !== 'over'; t += 1) {
    endTurn(g);
    for (let guard = 0; g.phase === 'battles' && guard < 60; guard += 1) {
      const c = g.pending[0];
      if (c) autoResolveContact(g, c.id);
      if (!g.pending.length && g.phase === 'battles') endTurn(g);
    }
  }
  return g;
}

try {
  check('a Lepanto war holds the theatre, its regions, its two navies at war and the growth objective', () => {
    const g = newGrand('holyleague', 7, 'normal', 0, 'lepanto');
    assert.equal(g.theatre, 'lepanto');
    assert.deepEqual(Object.keys(g.regions), [...LEPANTO_REGION_ORDER]);
    assert.deepEqual(Object.keys(g.factions), ['holyleague', 'ottoman']);
    assert.deepEqual(g.relations, { 'holyleague:ottoman': 'war' });
    assert.equal(g.victoryRules?.kind, 'growth-v1');
    assert.equal(dateLabel(g.turn, g), '1571년 7월');
    assert.ok(Object.values(g.regions).every((r) => r.owner === 'holyleague' || r.owner === 'ottoman'));
    assert.equal(REGIONS[THEATRES.lepanto.order.find((id) => REGIONS[id].capitalOf === 'ottoman')].name, '이스탄불');
    for (const fl of g.fleets) assert.ok(LEPANTO_REGION_ORDER.includes(fl.at), `${fl.name} at ${fl.at}`);
    for (const f of ['holyleague', 'ottoman']) for (const fl of g.fleets.filter((x) => x.faction === f)) for (const u of fl.ships) assert.ok(kindsOf(f).includes(u.kind), `${f} ${u.kind}`);
  });

  check("the 1592 war is untouched: no theatre in its state, none of the Lepanto theatre's regions, navies or commanders", () => {
    const g = newGrand('joseon', 7);
    assert.ok(!('theatre' in g));
    assert.deepEqual(Object.keys(g.regions), [...REGION_ORDER]);
    assert.deepEqual(Object.keys(g.factions), ['joseon', 'japan', 'ming']);
    assert.ok(!g.fleets.some((f) => ['holyleague', 'ottoman'].includes(f.faction)));
    assert.deepEqual(orderOf(g), REGION_ORDER);
    assert.deepEqual(factionsOf(g), ['joseon', 'japan', 'ming']);
    for (const id of REGION_ORDER) for (const l of LANES[id]) assert.ok(REGION_ORDER.includes(l.to), `${id} -> ${l.to}`);
  });

  check("the theatre's lanes run both ways inside it and join every port", () => {
    for (const id of LEPANTO_REGION_ORDER) {
      assert.ok(LANES[id].length > 0, `${id} has a lane`);
      for (const l of LANES[id]) {
        assert.ok(LEPANTO_REGION_ORDER.includes(l.to), `${id} -> ${l.to}`);
        assert.ok(LANES[l.to].some((b) => b.to === id && b.turns === l.turns), `${l.to} -> ${id}`);
      }
    }
    const seen = new Set(['messina']);
    const stack = ['messina'];
    while (stack.length) for (const l of LANES[stack.pop()]) if (!seen.has(l.to)) { seen.add(l.to); stack.push(l.to); }
    assert.equal(seen.size, LEPANTO_REGION_ORDER.length);
  });

  check('the commanders of 1571 lead the opening fleets, each with a skill tree; each navy has its techs', () => {
    const g = newGrand('ottoman', 11, 'normal', 0, 'lepanto');
    assert.deepEqual(g.factions.holyleague.commanders.map((c) => c.id).sort(), ['barbarigo', 'donjuan', 'doria', 'venier']);
    assert.deepEqual(g.factions.ottoman.commanders.map((c) => c.id).sort(), ['alipasha', 'pertev', 'siroco', 'uluc']);
    for (const f of ['holyleague', 'ottoman']) for (const c of g.factions[f].commanders) assert.ok(skillsOf(c.id).length >= 7, `${c.id} tree`);
    assert.equal(techsOf('holyleague').length, 4);
    assert.equal(techsOf('ottoman').length, 4);
    assert.ok(orderResearch(g, 'ottoman', 'janissaries').ok);
    assert.equal(techOf(g, 'ottoman').doing?.id, 'janissaries');
    assert.ok(shipDef('galea').strength > 0 && shipDef('kadirga').strength > 0);
  });

  check('a Lepanto war is deterministic and plays to its end, every fleet staying in the theatre', () => {
    const a = play(newGrand(null, 1571, 'normal', 0, 'lepanto'));
    const b = play(newGrand(null, 1571, 'normal', 0, 'lepanto'));
    assert.equal(JSON.stringify(a), JSON.stringify(b));
    assert.equal(a.phase, 'over');
    assert.ok(['holyleague', 'ottoman'].includes(a.victory.faction));
    for (const fl of a.fleets) assert.ok(LEPANTO_REGION_ORDER.includes(fl.at ?? fl.transit?.from), `${fl.id}`);
    for (const row of a.stats) assert.deepEqual(Object.keys(row.gold).sort(), ['holyleague', 'ottoman']);
  });

  check("a meeting the player fights is a 3D battle on a Lepanto coast between the League and the Ottomans, dated in the theatre's years", () => {
    let found = null;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const g = newGrand('holyleague', seed, 'normal', 0, 'lepanto');
      for (let t = 0; t < 30 && !found && g.phase !== 'over'; t += 1) {
        endTurn(g);
        if (g.phase === 'battles' && g.pending.length) found = { g, rb: describeBattle(g, g.pending[0].id) };
        while (g.phase === 'battles' && g.pending.length && !found) autoResolveContact(g, g.pending[0].id);
      }
      if (found) break;
    }
    assert.ok(found, 'a meeting for the player');
    const { rb } = found;
    assert.equal(rb.theatre, 'lepanto');
    assert.ok(LEPANTO_REGION_ORDER.includes(rb.mapId));
    assert.deepEqual([rb.attacker.faction, rb.defender.faction].sort(), ['holyleague', 'ottoman']);
    assert.notEqual(rb.attacker.team, rb.defender.team);
    const map = REGION_MAPS[rb.mapId];
    assert.ok(map.points.length >= 3, `${rb.mapId} points`);
    assert.ok(map.terrain.biome ?? map.terrain.region?.biome, `${rb.mapId} is fought on a Mediterranean coast`);
    const info = grandInfo(rb);
    assert.match(info.date, /^15(7\d|8\d)년/);
  });

  check("every Lepanto port has a battle map on a Mediterranean coast with its capture points", () => {
    for (const id of LEPANTO_REGION_ORDER) {
      const map = REGION_MAPS[id];
      assert.ok(map.points.length >= 4, `${id}: ${map.points.length} points`);
      assert.ok(map.points.some((p) => p.home === 0) && map.points.some((p) => p.home === 1), `${id} homes`);
    }
  });
  console.log(`${passed} Lepanto theatre checks passed`);
} finally {
  await server.close();
}
