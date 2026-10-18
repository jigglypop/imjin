// The faction campaign's Armada theatre (src/sim/grand/theatre.ts, regionsArmada.ts), headless: a war of England and
// Spain on its own regions, lanes, commanders and techs, deterministic and playable to its end; its battles fought on the
// Channel coasts; and the 1592 war untouched by it (no theatre in its state, none of the Armada's regions).
//   node scripts/test-grand-armada.mjs
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
const { ARMADA_REGION_ORDER } = await load('/src/sim/grand/regionsArmada.ts');
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
  check('an Armada war holds the theatre, its regions, its two navies at war and the growth objective', () => {
    const g = newGrand('england', 7, 'normal', 0, 'armada');
    assert.equal(g.theatre, 'armada');
    assert.deepEqual(Object.keys(g.regions), [...ARMADA_REGION_ORDER]);
    assert.deepEqual(Object.keys(g.factions), ['england', 'spain']);
    assert.deepEqual(g.relations, { 'england:spain': 'war' });
    assert.equal(g.victoryRules?.kind, 'growth-v1');
    assert.equal(dateLabel(g.turn, g), '1588년 7월');
    assert.ok(Object.values(g.regions).every((r) => r.owner === 'england' || r.owner === 'spain'));
    assert.equal(REGIONS[THEATRES.armada.order.find((id) => REGIONS[id].capitalOf === 'england')].name, '런던·템스강');
    for (const fl of g.fleets) assert.ok(ARMADA_REGION_ORDER.includes(fl.at), `${fl.name} at ${fl.at}`);
    for (const f of ['england', 'spain']) for (const fl of g.fleets.filter((x) => x.faction === f)) for (const u of fl.ships) assert.ok(kindsOf(f).includes(u.kind), `${f} ${u.kind}`);
  });

  check("the 1592 war is untouched: no theatre in its state, none of the Armada's regions, navies or commanders", () => {
    const g = newGrand('joseon', 7);
    assert.ok(!('theatre' in g));
    assert.deepEqual(Object.keys(g.regions), [...REGION_ORDER]);
    assert.deepEqual(Object.keys(g.factions), ['joseon', 'japan', 'ming']);
    assert.ok(!g.fleets.some((f) => ['england', 'spain'].includes(f.faction)));
    assert.deepEqual(orderOf(g), REGION_ORDER);
    assert.deepEqual(factionsOf(g), ['joseon', 'japan', 'ming']);
    for (const id of REGION_ORDER) for (const l of LANES[id]) assert.ok(REGION_ORDER.includes(l.to), `${id} -> ${l.to}`);
  });

  check("the theatre's lanes run both ways inside it and join every port", () => {
    for (const id of ARMADA_REGION_ORDER) {
      assert.ok(LANES[id].length > 0, `${id} has a lane`);
      for (const l of LANES[id]) {
        assert.ok(ARMADA_REGION_ORDER.includes(l.to), `${id} -> ${l.to}`);
        assert.ok(LANES[l.to].some((b) => b.to === id && b.turns === l.turns), `${l.to} -> ${id}`);
      }
    }
    const seen = new Set(['london']);
    const stack = ['london'];
    while (stack.length) for (const l of LANES[stack.pop()]) if (!seen.has(l.to)) { seen.add(l.to); stack.push(l.to); }
    assert.equal(seen.size, ARMADA_REGION_ORDER.length);
  });

  check('the commanders of 1588 lead the opening fleets and join on their turns, each with a skill tree; each navy has its techs', () => {
    const g = newGrand('spain', 11, 'normal', 0, 'armada');
    assert.deepEqual(g.factions.england.commanders.map((c) => c.id).sort(), ['drake', 'frobisher', 'hawkins', 'howard']);
    assert.deepEqual(g.factions.spain.commanders.map((c) => c.id).sort(), ['leyva', 'medina', 'oquendo', 'recalde']);
    for (const f of ['england', 'spain']) for (const c of g.factions[f].commanders) assert.ok(skillsOf(c.id).length >= 7, `${c.id} tree`);
    assert.equal(techsOf('england').length, 4);
    assert.equal(techsOf('spain').length, 4);
    assert.ok(orderResearch(g, 'spain', 'galleasses').ok);
    assert.equal(techOf(g, 'spain').doing?.id, 'galleasses');
    assert.ok(shipDef('racegalleon').strength > 0 && shipDef('urca').strength > 0);
  });

  check('an Armada war is deterministic and plays to its end, every fleet staying in the theatre', () => {
    const a = play(newGrand(null, 2024, 'normal', 0, 'armada'));
    const b = play(newGrand(null, 2024, 'normal', 0, 'armada'));
    assert.equal(JSON.stringify(a), JSON.stringify(b));
    assert.equal(a.phase, 'over');
    assert.ok(['england', 'spain'].includes(a.victory.faction));
    for (const fl of a.fleets) assert.ok(ARMADA_REGION_ORDER.includes(fl.at ?? fl.transit?.from), `${fl.id}`);
    for (const row of a.stats) assert.deepEqual(Object.keys(row.gold).sort(), ['england', 'spain']);
  });

  check("a meeting the player fights is a 3D battle on a Channel coast between England and Spain, dated in the theatre's years", () => {
    let found = null;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const g = newGrand('england', seed, 'normal', 0, 'armada');
      for (let t = 0; t < 30 && !found && g.phase !== 'over'; t += 1) {
        endTurn(g);
        if (g.phase === 'battles' && g.pending.length) found = { g, rb: describeBattle(g, g.pending[0].id) };
        while (g.phase === 'battles' && g.pending.length && !found) autoResolveContact(g, g.pending[0].id);
      }
      if (found) break;
    }
    assert.ok(found, 'a meeting for the player');
    const { rb } = found;
    assert.equal(rb.theatre, 'armada');
    assert.ok(ARMADA_REGION_ORDER.includes(rb.mapId));
    assert.deepEqual([rb.attacker.faction, rb.defender.faction].sort(), ['england', 'spain']);
    assert.notEqual(rb.attacker.team, rb.defender.team);
    const map = REGION_MAPS[rb.mapId];
    assert.ok(map.points.length >= 3, `${rb.mapId} points`);
    assert.ok(map.terrain.biome ?? map.terrain.region?.biome, `${rb.mapId} is fought on a Channel coast`);
    const info = grandInfo(rb);
    assert.match(info.date, /^15(8[89]|9\d)년/);
  });

  check("every Armada port has a battle map on a Channel coast with its capture points", () => {
    for (const id of ARMADA_REGION_ORDER) {
      const map = REGION_MAPS[id];
      assert.ok(map.points.length >= 4, `${id}: ${map.points.length} points`);
      assert.ok(map.points.some((p) => p.home === 0) && map.points.some((p) => p.home === 1), `${id} homes`);
    }
  });
  console.log(`${passed} Armada theatre checks passed`);
} finally {
  await server.close();
}
