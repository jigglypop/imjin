// The ship kinds: every kind has its data, names, anchors and a model; ranked keeps its three-kind rosters; the traits
// (sight, capture weight, fire resistance) do what they say; unarmed craft never fight; the new kinds stay deterministic.
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const server = await createServer({ root, configFile: false, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] } });
const load = (p) => server.ssrLoadModule(p);
let failed = 0;
const check = (name, fn) => { try { fn(); console.log('ok   ' + name); } catch (e) { failed++; console.error('FAIL ' + name + '\n' + e.stack); } };
const NEW = ['sahuseon', 'pojakseon', 'daeantaek', 'sogantaek', 'daegwanseon', 'byeongnyangseon', 'gwangseon', 'haechangseon', 'hoseon'];
const OLD_ROSTER = { joseon: ['panokseon', 'geobukseon', 'hyeopseon'], japan: ['atakebune', 'sekibune', 'kobaya'], ming: ['mingship', 'mingsmall'] };
try {
  const { Battle, SIM_DT } = await load('/src/sim/battle.ts');
  const { SHIP_SPECS, isUnarmed } = await load('/src/sim/catalog.ts');
  const { COMPETITIVE_UNITS, COMPETITIVE_PROFILE, combatStats, shipSpec } = await load('/src/sim/competitive.ts');
  const { Conquest, ROSTER, RANKED_ROSTER, rosterOf, SHORT_NAME, captureWeight, DEFAULT_OPTIONS, RANKED_OPTIONS } = await load('/src/sim/conquest.ts');
  const { autoFleet, RANKED_FLEET_MIX } = await load('/src/sim/maps.ts');
  const { Strategist } = await load('/src/sim/strategy.ts');
  const { anchorsFor, buildAnchorsFor, MODEL_ALIAS, PROCEDURAL_KINDS, modelKind, modelScale, cardOf } = await load('/src/ships/anchors.ts');
  const { EN } = await load('/src/i18n/en/index.ts');
  const { SHIP_PREFIX } = await load('/src/sim/grand/roster.ts');
  const { SHIP_NAME } = await load('/src/ui/grand/shared.tsx');
  const kinds = Object.keys(SHIP_SPECS);
  const land = () => -50;

  check('every kind has a spec, a competitive entry, Korean and English names, anchors and a model', () => {
    for (const k of NEW) assert.ok(kinds.includes(k), k);
    for (const kind of kinds) {
      const spec = SHIP_SPECS[kind];
      assert.equal(spec.kind, kind);
      assert.ok(COMPETITIVE_UNITS[kind], kind + ' competitive');
      for (const ko of [spec.label, SHORT_NAME[kind], SHIP_PREFIX[kind], SHIP_NAME[kind]]) {
        assert.ok(ko && /[가-힣]/.test(ko), kind + ' Korean name');
        assert.ok(EN[ko], `${kind}: no English for ${ko}`);
      }
      assert.ok(anchorsFor(`${kind}#0`), kind + ' anchors');
      assert.ok(PROCEDURAL_KINDS.includes(modelKind(kind)), kind + ' model');
      assert.ok(PROCEDURAL_KINDS.includes(kind) !== !!MODEL_ALIAS[kind], kind + ' has a builder or an alias, not both');
      assert.equal(SHIP_SPECS[modelKind(kind)].faction, spec.faction, kind + ' is drawn with a model of its own navy');
      assert.match(cardOf(kind), /^card_(panokseon|geobukseon|atakebune|sekibune)$/);
    }
  });

  check('an aliased kind uses its model anchors scaled to its length, with every gun on a modelled port', () => {
    for (const kind of NEW) {
      const k = modelScale(kind), a = anchorsFor(`${kind}#0`), base = anchorsFor(`${modelKind(kind)}#0`);
      assert.ok(Math.abs(a.length - base.length * k) < 1e-9, kind);
      assert.ok(Math.abs(a.mainDeck - base.mainDeck * k) < 1e-9, kind + ' deck');
      assert.equal(buildAnchorsFor(`${kind}#0`), undefined, kind + ' has no construction plan of its own');
      // Battle.muzzle numbers a gun by its place among all the guns of its side.
      for (const side of [0, 1, 2]) {
        const guns = SHIP_SPECS[kind].batteries.filter((b) => b.side === side).flatMap((b) => Array(b.count).fill(b.gun));
        guns.forEach((gun, slot) => {
          const port = a.gunPorts.find((g) => g.side === side && g.index === slot);
          assert.ok(port && port.gun === gun, `${kind} ${side}/${slot}`);
          assert.ok(base.gunPorts.some((g) => g.side === side && Math.abs(g.pos[0] * k - port.pos[0]) < 1e-9), `${kind} port on a drawn gun`);
        });
      }
    }
    for (const kind of PROCEDURAL_KINDS) assert.equal(modelScale(kind), 1);
  });

  check('fighting kinds are priced near the worth of their navy', () => {
    const old = (f) => OLD_ROSTER[f].reduce((a, k) => a + combatStats(k).value, 0) / OLD_ROSTER[f].reduce((a, k) => a + shipSpec(k).cost, 0);
    for (const kind of NEW) {
      if (isUnarmed(SHIP_SPECS[kind])) continue;
      const rel = combatStats(kind).value / shipSpec(kind).cost / old(SHIP_SPECS[kind].faction);
      assert.ok(rel > 0.85 && rel < 1.12, `${kind} ${rel.toFixed(2)}`);
    }
  });

  check('ranked rosters, doctrine fleets and recruiting keep the original kinds', () => {
    // The 1592 ranked rosters are untouched; the Armada navies have rosters of their own.
    assert.deepEqual({ joseon: RANKED_ROSTER.joseon, japan: RANKED_ROSTER.japan, ming: RANKED_ROSTER.ming }, OLD_ROSTER);
    for (const f of ['joseon', 'japan', 'ming']) {
      assert.deepEqual(rosterOf(f, false), OLD_ROSTER[f]);
      for (const k of OLD_ROSTER[f]) assert.ok(ROSTER[f].includes(k));
      assert.ok(NEW.filter((k) => SHIP_SPECS[k].faction === f).every((k) => ROSTER[f].includes(k)), f + ' expanded roster has the new kinds');
      assert.equal(ROSTER[f].length, kinds.filter((k) => SHIP_SPECS[k].faction === f).length);
      const ranked = autoFleet(f, RANKED_OPTIONS.musterBudget, COMPETITIVE_PROFILE, RANKED_OPTIONS.maxShips, false);
      assert.ok(ranked.every((k) => OLD_ROSTER[f].includes(k)) && ranked.length);
      assert.deepEqual(RANKED_FLEET_MIX[f].filter((k) => !OLD_ROSTER[f].includes(k)), []);
    }
    const map = [{ name: 'w', hanja: '', x: -4000, z: 0, r: 250, value: 1, home: 0 }, { name: 'e', hanja: '', x: 4000, z: 0, r: 250, value: 1, home: 1 }];
    for (const [options, allowed] of [[RANKED_OPTIONS, false], [DEFAULT_OPTIONS, true]]) {
      const b = new Battle(1, COMPETITIVE_PROFILE);
      const c = new Conquest(map, [{ slot: 0, name: 'w', faction: 'japan', team: 'joseon', human: true }, { slot: 1, name: 'e', faction: 'ming', team: 'japan', human: true }], land, options);
      b.land = land; b.rules = c;
      c.points[0].buildings[0] = { kind: 'shipyard', hp: 500, progress: 1, reload: [], level: 1, upgradeLeft: 0, upgradeTotal: 0 };
      c.players[0].funds = 5000;
      assert.equal(c.canRecruit(b, 0, 0, 'daegwanseon'), allowed);
      assert.equal(c.canRecruit(b, 0, 0, 'sekibune'), true);
    }
  });

  check('capture weight: the lookout takes nothing, the fishing boat half a warship, the old rule otherwise', () => {
    assert.equal(captureWeight(SHIP_SPECS.sahuseon), 0); assert.equal(captureWeight(SHIP_SPECS.pojakseon), 0.5);
    assert.equal(captureWeight(SHIP_SPECS.hyeopseon), 0.35); assert.equal(captureWeight(SHIP_SPECS.kobaya), 0.35);
    assert.equal(captureWeight(SHIP_SPECS.panokseon), 1); assert.equal(captureWeight(SHIP_SPECS.hoseon), 0.35);
    const hold = (kind) => {
      const map = [{ name: 'w', hanja: '', x: -4000, z: 0, r: 250, value: 1, home: 0 }, { name: 'e', hanja: '', x: 4000, z: 0, r: 250, value: 1, home: 1 }, { name: 'm', hanja: '', x: 0, z: 0, r: 250, value: 1 }];
      const b = new Battle(3, COMPETITIVE_PROFILE);
      const c = new Conquest(map, [{ slot: 0, name: 'w', faction: 'joseon', team: 'joseon', human: true }, { slot: 1, name: 'e', faction: 'japan', team: 'japan', human: true }], land, DEFAULT_OPTIONS);
      b.land = land; b.rules = c; b.humans = new Set([0, 1]);
      const s = b.addShip(kind, 0, 0, 0, '', b.addSquadron('joseon', '', '', '', '', 0)); s.order = { type: 'hold' };
      b.grid.rebuild(b.ships);
      for (let t = 0; t < 10; t += SIM_DT) c.step(b, SIM_DT);
      return c.points[2].hold;
    };
    assert.equal(hold('sahuseon'), 0);
    const boat = hold('pojakseon'), scout = hold('hyeopseon'), ship = hold('panokseon');
    assert.ok(boat > scout && ship > boat, `${scout} ${boat} ${ship}`);
  });

  check('fire resistance: the tower flagship takes half the fire of the same hit and its fire spreads half as fast', () => {
    const b = new Battle(5, COMPETITIVE_PROFILE);
    const tower = b.addShip('daeantaek', 0, 0, 0, '', null), plain = b.addShip('atakebune', 500, 0, 0, '', null);
    b.ignite(tower, 0.2); b.ignite(plain, 0.2);
    assert.ok(Math.abs(tower.fire - 0.1) < 1e-12 && Math.abs(plain.fire - 0.2) < 1e-12, `${tower.fire} ${plain.fire}`);
    assert.equal(SHIP_SPECS.daeantaek.fireResist, 0.5);
    for (const kind of kinds) if (kind !== 'daeantaek') assert.equal(SHIP_SPECS[kind].fireResist, undefined, kind);
  });

  // A computer seat with a fleet that includes every unarmed kind, beside a battle line, facing an enemy fleet.
  const scene = (seed, foeAt = 900) => {
    const map = [{ name: 'w', hanja: '', x: -3000, z: 0, r: 250, value: 1, home: 0 }, { name: 'e', hanja: '', x: 3000, z: 0, r: 250, value: 1, home: 1 }, { name: 'm', hanja: '', x: 0, z: 1500, r: 250, value: 1 }];
    const b = new Battle(seed, COMPETITIVE_PROFILE);
    const c = new Conquest(map, [{ slot: 0, name: 'w', faction: 'japan', team: 'joseon', human: false }, { slot: 1, name: 'e', faction: 'joseon', team: 'japan', human: false }], land, DEFAULT_OPTIONS);
    b.land = land; b.rules = c; b.humans = new Set();
    const own = b.addSquadron('joseon', '', '', '', '', 0), foe = b.addSquadron('japan', '', '', '', '', 1);
    const mine = ['atakebune', 'sekibune', 'sekibune', 'kobaya', 'kobaya', 'byeongnyangseon', 'daegwanseon'].map((k, i) => b.addShip(k, -200 + (i % 4) * 40, (Math.floor(i / 4) - 0.5) * 40, 0, '', own));
    const theirs = ['panokseon', 'panokseon', 'sahuseon', 'pojakseon', 'hyeopseon'].map((k, i) => b.addShip(k, foeAt + (i % 3) * 40, (Math.floor(i / 3) - 0.5) * 40, Math.PI, '', foe));
    for (const s of b.ships) s.order = { type: 'auto' };
    return { b, c, mine, theirs };
  };

  check('the strategist never puts an unarmed craft in its fighting body or a raid, nor orders it to attack', () => {
    for (const seed of [11, 12, 13]) {
      const { b, c } = scene(seed);
      const seen = [];
      assert.equal(c.brains.size, 2);
      for (const brain of c.brains.values()) {
        const lead = brain.lead.bind(brain), raid = brain.raid.bind(brain);
        brain.lead = (cc, body, foes) => { seen.push(...body); return lead(cc, body, foes); };
        brain.raid = (bb, cc, raiders, foes) => { seen.push(...raiders); return raid(bb, cc, raiders, foes); };
      }
      for (let t = 0; t < 240 && !b.ended; t += SIM_DT) {
        b.step(SIM_DT);
        for (const s of b.ships) if (isUnarmed(s.spec) && b.isActive(s)) {
          assert.ok(!['attack', 'bombard', 'broadside'].includes(s.order.type), `${s.spec.kind} got ${s.order.type}`);
          assert.equal(s.grappledWith, 0, `${s.spec.kind} grappled`);
        }
        b.events.length = 0;
      }
      assert.ok(seen.length > 0);
      assert.ok(seen.every((s) => !isUnarmed(s.spec)), 'an unarmed craft was sent to fight');
    }
  });

  check('an unarmed craft runs from an enemy within 400 m, from the strategist and in its own helm', () => {
    for (const kind of ['sahuseon', 'byeongnyangseon']) {
      const { b, c, mine, theirs } = scene(21, 3000);
      const ship = [...mine, ...theirs].find((s) => s.spec.kind === kind);
      const enemy = b.ships.find((s) => s.team !== ship.team && !isUnarmed(s.spec));
      enemy.x = ship.x + 300; enemy.z = ship.z;
      b.active = { joseon: b.ships.filter((s) => s.team === 'joseon'), japan: b.ships.filter((s) => s.team === 'japan') };
      b.grid.rebuild(b.ships); b.time += 0.25;
      const brain = new Strategist(ship.owner); brain.timer = 0;
      brain.step(b, c, 1, ship.owner);
      assert.equal(ship.order.type, 'move');
      assert.ok(Math.hypot(ship.order.x - enemy.x, ship.order.z - enemy.z) > 300 + 250, `${kind}: the move leads away from the enemy ${JSON.stringify([ship.x, ship.z, enemy.x, enemy.z, ship.order])}`);
      ship.order = { type: 'auto' }; ship.heading = 0;
      b.think(ship);
      assert.equal(b.activity.get(ship.id), 'evading');
      assert.ok(Math.abs(ship.rudder) > 0.5 || ship.throttle > 0.5);
    }
  });

  check('the lookout holds station ahead of its fleet and the transport behind it', () => {
    const { b, c, theirs } = scene(31, 2600);
    const brain = new Strategist(1);
    b.active = { joseon: b.ships.filter((s) => s.team === 'joseon'), japan: b.ships.filter((s) => s.team === 'japan') };
    b.grid.rebuild(b.ships); b.time += 0.25;
    brain.step(b, c, 3, 1);
    const lookout = theirs.find((s) => s.spec.kind === 'sahuseon');
    assert.equal(lookout.order.type, 'move');
    // The Joseon seat sails west toward the Japanese fleet (or its home), so its lookout leads to the west of the body.
    assert.ok(lookout.order.x < Math.min(...theirs.filter((s) => !isUnarmed(s.spec)).map((s) => s.x)), `${lookout.order.x}`);
  });

  check('the new kinds are deterministic: two identical battles end in the same state', () => {
    const run = () => {
      const b = new Battle(4242, COMPETITIVE_PROFILE);
      b.land = land; b.humans = new Set();
      const west = b.addSquadron('joseon', '', '', '', '', 0), east = b.addSquadron('japan', '', '', '', '', 1);
      ['gwangseon', 'haechangseon', 'hoseon', 'sahuseon', 'pojakseon', 'mingship'].forEach((k, i) => { b.addShip(k, -500, i * 50, 0, '', west).order = { type: 'auto' }; });
      ['daeantaek', 'sogantaek', 'daegwanseon', 'byeongnyangseon', 'kobaya'].forEach((k, i) => { b.addShip(k, 500, i * 50, Math.PI, '', east).order = { type: 'auto' }; });
      for (let t = 0; t < 180 && !b.ended; t += SIM_DT) { b.step(SIM_DT); b.events.length = 0; }
      assert.ok(b.ships.some((s) => s.hull < s.spec.hull), 'the fleets fought');
      return JSON.stringify(b.ships.map((s) => [s.id, s.x, s.z, s.hull, s.crew, s.fire, s.alive, s.struck]));
    };
    assert.equal(run(), run());
  });
} finally { await server.close(); }
console.log(failed ? `${failed} failed` : 'all passed'); process.exitCode = failed ? 1 : 0;
