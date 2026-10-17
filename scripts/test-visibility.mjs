// Shared observation must agree in AI, commands and server redaction without changing historical battles.
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const server = await createServer({ root, configFile: false, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] } });
const load = (name) => server.ssrLoadModule('/src/sim/' + name + '.ts');
let failed = 0;
const check = (name, fn) => { try { fn(); console.log('ok   ' + name); } catch (e) { failed++; console.error('FAIL ' + name + '\n' + e.stack); } };
try {
  const { Battle } = await load('battle');
  const { COMPETITIVE_PROFILE } = await load('competitive');
  const { visibleShips, isShipVisible, pointVisible, sightRange, MAIN_SIGHT, SCOUT_SIGHT } = await load('visibility');
  const { SHIP_SPECS } = await load('catalog');
  const { buildConquest } = await load('maps');
  const { RANKED_OPTIONS } = await load('conquest');
  const { Strategist } = await load('strategy');
  const fixture = () => {
    const b = new Battle(99, COMPETITIVE_PROFILE);
    const own = b.addSquadron('joseon', '', '', '', '', 0), enemy = b.addSquadron('japan', '', '', '', '', 1);
    const a = b.addShip('panokseon', 0, 0, Math.PI / 2, '', own), z = b.addShip('atakebune', 1200, 0, Math.PI / 2, '', enemy);
    b.humans = new Set([0, 1]);
    a.order = z.order = { type: 'hold' }; a.speed = z.speed = 0;
    b.active = { joseon: [a], japan: [z] };
    return { b, a, z, own, enemy };
  };
  check('each kind sees as far as its spec says: the old scouts 1600 m, the main ships 900 m', () => {
    const scouts = Object.keys(SHIP_SPECS).filter((k) => sightRange(SHIP_SPECS[k]) >= SCOUT_SIGHT);
    assert.deepEqual(scouts, ['hyeopseon', 'sahuseon', 'kobaya', 'mingsmall', 'pinnace'], 'the Armada chapter adds the pinnace');
    for (const kind of ['panokseon', 'geobukseon', 'atakebune', 'sekibune', 'mingship']) assert.equal(sightRange(SHIP_SPECS[kind]), MAIN_SIGHT, kind);
    for (const kind of ['hyeopseon', 'kobaya', 'mingsmall']) assert.equal(sightRange(SHIP_SPECS[kind]), 1600, kind);
    assert.equal(sightRange(SHIP_SPECS.sahuseon), 2200); assert.equal(sightRange(SHIP_SPECS.pojakseon), 1300); assert.equal(sightRange(SHIP_SPECS.daeantaek), 1300);
  });
  check('a lookout sees an enemy just inside its sight and not one just beyond it', () => {
    for (const [kind, near, far] of [['sahuseon', 2150, 2250], ['hyeopseon', 1550, 1650], ['pojakseon', 1250, 1350], ['panokseon', 850, 950]]) {
      const { b, a, z } = fixture(); a.alive = false; b.active.joseon = [];
      const scout = b.addShip(kind, 0, 0, 0, '', b.addSquadron('joseon', '', '', '', '', 2));
      z.x = near; b.time += 0.25; assert.equal(isShipVisible(b, scout.team, z.id), true, kind + ' near');
      z.x = far; b.time += 0.25; assert.equal(isShipVisible(b, scout.team, z.id), false, kind + ' far');
    }
  });
  check('all three navies have a scout that shares longer sight with the whole team', () => {
    for (const kind of ['hyeopseon', 'kobaya', 'mingsmall']) {
      const { b, a, z } = fixture();
      assert.equal(isShipVisible(b, a.team, z.id), false); assert.equal(pointVisible(b, a.team, z.x, z.z), false);
      const scout = b.addShip(kind, 0, 0, 0, '', b.addSquadron('joseon', '', '', '', '', 2));
      assert.equal(isShipVisible(b, a.team, z.id), true); assert.equal(pointVisible(b, a.team, z.x, z.z), true);
      assert.equal(b.nearestEnemy(a)?.id, z.id);
      scout.alive = false; b.time += 0.25;
      assert.equal(isShipVisible(b, a.team, z.id), false);
      assert.ok(visibleShips(b, a.team).has(scout.id), 'A team keeps its own wreck state.');
    }
  });
  check('islands block both target observation and map coordinates until a lookout goes around them', () => {
    const { b, a, z, own } = fixture();
    const scout = b.addShip('hyeopseon', 0, 0, 0, '', own);
    b.land = (x, zz) => x > 400 && x < 700 && Math.abs(zz) < 100 ? 50 : -50;
    assert.equal(isShipVisible(b, a.team, z.id), false); assert.equal(pointVisible(b, a.team, z.x, z.z), false);
    scout.x = 1200; scout.z = 300; b.time += 0.25;
    assert.equal(isShipVisible(b, a.team, z.id), true); assert.equal(pointVisible(b, a.team, z.x, z.z), true);
  });
  check('night shortens sight while lights, fire and a recent volley reveal a target within their real ranges', () => {
    const { b, a, z, own } = fixture(); b.night = true; z.lights = false; z.x = 600;
    assert.equal(isShipVisible(b, a.team, z.id), false);
    const scout = b.addShip('hyeopseon', 0, 0, 0, '', own);
    assert.equal(isShipVisible(b, a.team, z.id), true);
    scout.alive = false; z.x = 1500; z.lights = true; b.time += 0.25;
    assert.equal(isShipVisible(b, a.team, z.id), true);
    z.lights = false; z.x = 1300; z.fire = 0.2; b.time += 0.25;
    assert.equal(isShipVisible(b, a.team, z.id), true);
    z.fire = 0; z.x = 800; z.revealed = 1; b.time += 0.25;
    assert.equal(isShipVisible(b, a.team, z.id), true);
    z.revealed = 0; b.time += 0.25; assert.equal(isShipVisible(b, a.team, z.id), false);
  });
  check('only a living completed allied beacon provides its extended lookout, and batteries can defend alone', () => {
    const { battle: b, conquest: c } = buildConquest('hallyeo', [{ name: '', faction: 'joseon', team: 'joseon', human: true, fleet: [] }, { name: '', faction: 'japan', team: 'japan', human: true, fleet: [] }], () => -50, 99, RANKED_OPTIONS);
    const p = c.homeOf(0), slot = { x: p.x, y: 0, z: p.z, rot: 0 }, sq = b.addSquadron('japan', '', '', '', '', 1);
    // The synthetic flat sea has no building sites; give these lookout fixtures explicit shore positions.
    p.slots[1] = slot; p.slots[2] = slot;
    p.buildings[1] = { kind: 'battery', level: 1, hp: 200, progress: 1 };
    const z = b.addShip('atakebune', slot.x + 1500, slot.z, 0, '', sq);
    assert.equal(isShipVisible(b, 'joseon', z.id), false);
    p.buildings[2] = { kind: 'beacon', level: 1, hp: 200, progress: 0.5 }; b.time += 0.25;
    assert.equal(isShipVisible(b, 'joseon', z.id), false);
    p.buildings[2].progress = 1; b.time += 0.25; assert.equal(isShipVisible(b, 'joseon', z.id), true);
    p.buildings[2].hp = 0; b.time += 0.25; assert.equal(isShipVisible(b, 'joseon', z.id), false);
    const battery = p.slots[1]; z.x = battery.x + 300; z.z = battery.z; b.time += 0.25;
    assert.equal(b.canSee(z, 300, 'joseon'), true);
    p.owner = 1; b.time += 0.25; assert.equal(isShipVisible(b, 'joseon', z.id), false);
  });
  check('hidden targets cannot be ordered, hunted through a lull, or used by a prepared gun', () => {
    const { b, a, z, own } = fixture();
    b.lull = 10000; b.time = 1000;
    assert.equal(b.nearestEnemy(a), undefined); assert.equal(b.hunted(a), undefined);
    assert.equal(b.setOrder([a.id], { type: 'attack', targetId: z.id }), 0);
    assert.equal(b.setOrder([a.id], { type: 'broadside', targetId: z.id, side: 0 }), 0);
    assert.equal(b.setOrder([a.id], { type: 'follow', leaderId: z.id, dx: 0, dz: 0 }), 0);
    b.addShip('hyeopseon', 0, 0, 0, '', own);
    assert.equal(b.setOrder([a.id], { type: 'attack', targetId: z.id }), 1);
    z.x = 2500; b.time += 0.25; b.think(a);
    assert.equal(a.order.type, 'auto'); assert.equal(a.targetId, 0);
    b.events.length = 0; const ammo = a.guns[0].ammo; b.fireGun(a, a.guns[0], z.id);
    assert.equal(a.guns[0].ammo, ammo); assert.ok(!b.events.some((e) => e.type === 'gun'));
  });
  check('the computer strategist sees only observed enemy clusters', () => {
    const { b, a, z } = fixture();
    const ai = new Strategist(0); let foes;
    ai.lead = (_c, _body, observed) => { foes = observed; }; ai.raid = () => {};
    const c = { player: () => ({ team: 'joseon' }), points: [], options: RANKED_OPTIONS };
    ai.military(b, c); assert.equal(foes.length, 0);
    z.x = 700; b.time += 0.25; ai.military(b, c); assert.equal(foes[0].ships[0].id, z.id);
  });
  check('competitive weather scales all lookouts without removing the scouts advantage or changing history', () => {
    const { b, a, z, own } = fixture(); z.x = 600;
    assert.equal(isShipVisible(b, a.team, z.id), true);
    b.visibilityScale = 0.5; assert.equal(isShipVisible(b, a.team, z.id), false);
    b.addShip('hyeopseon', 0, 0, 0, '', own); assert.equal(isShipVisible(b, a.team, z.id), true);
    const historical = new Battle(); historical.visibilityScale = 0.1;
    const enemy = historical.addShip('atakebune', 5000, 0, 0, '', null);
    assert.equal(isShipVisible(historical, 'joseon', enemy.id), true);
  });
  check('cache and observations belong to each battle, and historical maps remain unrestricted', () => {
    const x = fixture(), y = fixture(); y.z.x = 500;
    assert.equal(isShipVisible(x.b, x.a.team, x.z.id), false); assert.equal(isShipVisible(y.b, y.a.team, y.z.id), true);
    x.z.x = 500; assert.equal(isShipVisible(x.b, x.a.team, x.z.id), false, 'The quarter-second observation cache has a fixed lifetime.');
    x.b.time += 0.25; assert.equal(isShipVisible(x.b, x.a.team, x.z.id), true);
    const h = new Battle(99); h.night = true;
    const enemy = h.addShip('atakebune', 10000, 10000, 0, '', null);
    assert.equal(isShipVisible(h, 'joseon', enemy.id), true); assert.equal(pointVisible(h, 'joseon', 10000, 10000), true);
    assert.equal(h.canSee(enemy, 10000, 'joseon'), false, 'Historical night combat retains its original light rules.');
  });
} finally { await server.close(); }
console.log(failed ? `${failed} failed` : 'all passed'); process.exitCode = failed ? 1 : 0;
