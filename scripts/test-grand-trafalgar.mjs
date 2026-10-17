// The faction campaign's Trafalgar theatre (src/sim/grand/theatre.ts, regionsTrafalgar.ts), headless: a war of Britain
// against France and Spain, allied as Joseon and Ming are in 1592, on its own regions, lanes, commanders and techs,
// deterministic and playable to its end; its battles fought between Britain and one of the allies; and the 1592 war
// untouched by it.
//   node scripts/test-grand-trafalgar.mjs
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
const { TRAFALGAR_REGION_ORDER: ORDER } = await load('/src/sim/grand/regionsTrafalgar.ts');
const { REGION_MAPS, regionArt } = await load('/src/sim/grand/coast.ts');
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

const NAVIES = ['britain', 'france', 'spain1805'];

try {
  check('a Trafalgar war holds the theatre, its regions, three navies (France and Spain allied) and the growth objective', () => {
    const g = newGrand('britain', 7, 'normal', 0, 'trafalgar');
    assert.equal(g.theatre, 'trafalgar');
    assert.deepEqual(Object.keys(g.regions), [...ORDER]);
    assert.deepEqual(Object.keys(g.factions), NAVIES);
    assert.deepEqual(g.relations, { 'britain:france': 'war', 'britain:spain1805': 'war', 'france:spain1805': 'allied' });
    assert.equal(g.victoryRules?.kind, 'growth-v1');
    assert.equal(dateLabel(g.turn, g), '1805년 1월');
    assert.ok(Object.values(g.regions).every((r) => NAVIES.includes(r.owner)));
    const capital = (f) => REGIONS[THEATRES.trafalgar.order.find((id) => REGIONS[id].capitalOf === f)].name;
    assert.equal(capital('britain'), '포츠머스');
    assert.equal(capital('france'), '브레스트');
    assert.equal(capital('spain1805'), '카디스');
    for (const fl of g.fleets) assert.ok(ORDER.includes(fl.at), `${fl.name} at ${fl.at}`);
    for (const f of NAVIES) for (const fl of g.fleets.filter((x) => x.faction === f)) for (const u of fl.ships) assert.ok(kindsOf(f).includes(u.kind), `${f} ${u.kind}`);
  });

  check("the 1592 war is untouched: no theatre in its state, none of the Trafalgar theatre's regions, navies or commanders", () => {
    const g = newGrand('joseon', 7);
    assert.ok(!('theatre' in g));
    assert.deepEqual(Object.keys(g.regions), [...REGION_ORDER]);
    assert.deepEqual(Object.keys(g.factions), ['joseon', 'japan', 'ming']);
    assert.ok(!g.fleets.some((f) => NAVIES.includes(f.faction)));
    assert.deepEqual(orderOf(g), REGION_ORDER);
    assert.deepEqual(factionsOf(g), ['joseon', 'japan', 'ming']);
    for (const id of REGION_ORDER) for (const l of LANES[id]) assert.ok(REGION_ORDER.includes(l.to), `${id} -> ${l.to}`);
  });

  check("the theatre's lanes run both ways inside it and join every port", () => {
    for (const id of ORDER) {
      assert.ok(LANES[id].length > 0, `${id} has a lane`);
      for (const l of LANES[id]) {
        assert.ok(ORDER.includes(l.to), `${id} -> ${l.to}`);
        assert.ok(LANES[l.to].some((b) => b.to === id && b.turns === l.turns), `${l.to} -> ${id}`);
      }
    }
    const seen = new Set(['spithead']);
    const stack = ['spithead'];
    while (stack.length) for (const l of LANES[stack.pop()]) if (!seen.has(l.to)) { seen.add(l.to); stack.push(l.to); }
    assert.equal(seen.size, ORDER.length);
  });

  check('the commanders of 1805 lead the opening fleets, each with a skill tree; each navy has its techs and the four-decker waits for one', () => {
    const g = newGrand('france', 11, 'normal', 0, 'trafalgar');
    assert.deepEqual(g.factions.britain.commanders.map((c) => c.id).sort(), ['calder', 'collingwood', 'cornwallis', 'hardy', 'nelson']); // Blackwood joins in the autumn
    assert.deepEqual(g.factions.france.commanders.map((c) => c.id).sort(), ['ganteaume', 'lucas', 'missiessy', 'villeneuve']);
    assert.deepEqual(g.factions.spain1805.commanders.map((c) => c.id).sort(), ['alava', 'churruca', 'gravina']);
    for (const f of NAVIES) for (const c of g.factions[f].commanders) assert.ok(skillsOf(c.id).length >= 7, `${c.id} tree`);
    for (const f of NAVIES) assert.equal(techsOf(f).length, 4);
    assert.ok(orderResearch(g, 'france', 'boarders').ok);
    assert.equal(techOf(g, 'france').doing?.id, 'boarders');
    assert.equal(techsOf('spain1805').find((t) => t.id === 'fourdecks')?.unlock, 'trinidad');
    for (const k of ['firstrate', 'gb74', 'gbfrigate', 'fr80', 'fr74', 'trinidad', 'es74']) assert.ok(shipDef(k).strength > 0, k);
  });

  check('a Trafalgar war is deterministic and plays to its end, every fleet staying in the theatre', () => {
    const a = play(newGrand(null, 1805, 'normal', 0, 'trafalgar'));
    const b = play(newGrand(null, 1805, 'normal', 0, 'trafalgar'));
    assert.equal(JSON.stringify(a), JSON.stringify(b));
    assert.equal(a.phase, 'over');
    assert.ok(NAVIES.includes(a.victory.faction));
    for (const fl of a.fleets) assert.ok(ORDER.includes(fl.at ?? fl.transit?.from), `${fl.id}`);
    for (const row of a.stats) assert.deepEqual(Object.keys(row.gold).sort(), [...NAVIES].sort());
  });

  check("a meeting the player fights is a 3D battle on a Trafalgar coast between Britain and an ally, dated in the theatre's years", () => {
    let found = null;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const g = newGrand('britain', seed, 'normal', 0, 'trafalgar');
      for (let t = 0; t < 30 && !found && g.phase !== 'over'; t += 1) {
        endTurn(g);
        if (g.phase === 'battles' && g.pending.length) found = { g, rb: describeBattle(g, g.pending[0].id) };
        while (g.phase === 'battles' && g.pending.length && !found) autoResolveContact(g, g.pending[0].id);
      }
      if (found) break;
    }
    assert.ok(found, 'a meeting for the player');
    const { rb } = found;
    assert.equal(rb.theatre, 'trafalgar');
    assert.ok(ORDER.includes(rb.mapId));
    const sides = [rb.attacker.faction, rb.defender.faction];
    assert.ok(sides.includes('britain') && sides.some((f) => f === 'france' || f === 'spain1805'), sides.join());
    assert.notEqual(rb.attacker.team, rb.defender.team);
    assert.ok(REGION_MAPS[rb.mapId].points.length >= 3, `${rb.mapId} points`);
    assert.match(grandInfo(rb).date, /^18(0\d|1\d)년/);
  });

  check("every Trafalgar port has a battle map with its capture points, and borrows no other war's loading picture", () => {
    for (const id of ORDER) {
      const map = REGION_MAPS[id];
      assert.ok(map.points.length >= 4, `${id}: ${map.points.length} points`);
      assert.ok(map.points.some((p) => p.home === 0) && map.points.some((p) => p.home === 1), `${id} homes`);
      const art = regionArt(id);
      assert.ok(art === null || ['st-vincent', 'nile', 'finisterre', 'trafalgar-weather', 'trafalgar-lee'].includes(art), `${id}: ${art}`);
    }
    assert.equal(regionArt('trafalgar'), 'trafalgar-weather');
    assert.equal(regionArt('cadiz'), 'trafalgar-weather');
    assert.equal(regionArt('plymsound'), null);
  });
  console.log(`${passed} Trafalgar theatre checks passed`);
} finally {
  await server.close();
}
