// Check the exact server redaction helpers against the shared real simulation.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
const vite = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), configFile: false, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] } });
let failed = 0;
const check = (name, fn) => { try { fn(); console.log('PASS ' + name); } catch (e) { failed++; console.error('FAIL ' + name, e); } };
try {
  const { Battle } = await vite.ssrLoadModule('/src/sim/battle.ts');
  const { COMPETITIVE_PROFILE } = await vite.ssrLoadModule('/src/sim/competitive.ts');
  const { buildConquest } = await vite.ssrLoadModule('/src/sim/maps.ts');
  const { RANKED_OPTIONS } = await vite.ssrLoadModule('/src/sim/conquest.ts');
  const { observedShips, observedState, observedEvent, observedMetadata } = await vite.ssrLoadModule('/server/observation.ts');
  const { encodeSnapshot, decodeSnapshot } = await vite.ssrLoadModule('/src/net/protocol.ts');
  const { eventObserved } = await vite.ssrLoadModule('/src/sim/observation.ts');
  const { timeToImpact } = await vite.ssrLoadModule('/src/fx/flight.ts');
  check('an unseen enemy and its position never enter the actual snapshot encoder; a scout reveals it and later loses it', () => {
    const b = new Battle(99, COMPETITIVE_PROFILE);
    const a = b.addShip('panokseon', 0, 0, 0, 'a', null), e = b.addShip('atakebune', 1200, 0, 0, 'e', null);
    const frames = () => decodeSnapshot(encodeSnapshot(b.time, observedShips(b, a.team), a.owner, (s) => b.isActive(s))).ships;
    assert.deepEqual(frames().map((s) => s.id), [a.id]);
    const scout = b.addShip('hyeopseon', 0, 0, 0, 'scout', null);
    assert.ok(frames().some((s) => s.id === e.id && s.x === e.x));
    scout.alive = false; b.time += 0.25;
    assert.equal(frames().some((s) => s.id === e.id), false); assert.equal(e.alive, true);
  });
  check('shore building, recruitment, rally and private enemy funds are redacted without modifying the authoritative state', () => {
    const seats = [{ name: 'a', faction: 'joseon', team: 'joseon', human: true, fleet: [] }, { name: 'e', faction: 'japan', team: 'japan', human: true, fleet: [] }];
    const { battle: b, conquest: c } = buildConquest('hallyeo', seats, () => -100, 99, RANKED_OPTIONS);
    const p = c.homeOf(1); p.rally = { x: 123, z: 456 }; p.queue.push({ kind: 'kobaya', total: 14, left: 7 });
    const before = JSON.stringify(c.state());
    const redacted = observedState(c, b, 'joseon');
    assert.ok(redacted.points[p.id].buildings.every((x) => x === null));
    assert.deepEqual(redacted.points[p.id].queue, []); assert.equal(redacted.points[p.id].rally, null);
    assert.equal(redacted.players[1].funds, 0); assert.equal(redacted.players[1].income, 0);
    assert.equal(JSON.stringify(c.state()), before);
    const client = buildConquest('hallyeo', seats, () => -100, 99, RANKED_OPTIONS).conquest;
    client.applyState(redacted);
    assert.equal(client.held('japan'), c.held('japan'), 'Public weighted capture totals stay correct when the enemy beacon is hidden.');
    b.addShip('hyeopseon', p.x, p.z, 0, 'scout', null); b.time += 0.25;
    const seen = observedState(c, b, 'joseon');
    assert.ok(seen.points[p.id].buildings.some(Boolean)); assert.deepEqual(seen.points[p.id].rally, p.rally);
    assert.equal(seen.points[p.id].queue.length, 1); assert.equal(seen.players[1].funds, 0);
  });
  check('observed metadata updates captured ownership without leaking unseen hull identities or repeating unchanged records', () => {
    const b = new Battle(99, COMPETITIVE_PROFILE), known = new Map();
    const a = b.addShip('panokseon', 0, 0, 0, 'a', null), e = b.addShip('atakebune', 700, 0, 0, 'e', null);
    b.addShip('kobaya', 5000, 0, 0, 'hidden', null);
    assert.deepEqual(observedMetadata(b, a.team, known).map((m) => m.id), [a.id, e.id]);
    assert.deepEqual(observedMetadata(b, a.team, known), []);
    e.team = a.team; e.owner = a.owner; b.time += 0.25;
    const changed = observedMetadata(b, a.team, known); assert.equal(changed.length, 1);
    assert.equal(changed[0].id, e.id); assert.equal(changed[0].team, a.team); assert.equal(changed[0].owner, a.owner);
    assert.equal(known.size, 2);
  });
  check('hidden weapon, fire, damage and shore events are filtered while public capture objectives remain available', () => {
    const b = new Battle(99, COMPETITIVE_PROFILE);
    const a = b.addShip('panokseon', 0, 0, 0, 'a', null), e = b.addShip('atakebune', 3000, 0, 0, 'e', null);
    assert.equal(observedEvent({ type: 'sink', ship: e.id }, b, null, a.team), false);
    assert.equal(observedEvent({ type: 'shot', x: e.x, z: e.z }, b, null, a.team), false);
    assert.equal(observedEvent({ type: 'splash', x: a.x, z: a.z }, b, null, a.team), true);
    assert.equal(observedEvent({ type: 'captured', point: 0 }, b, null, a.team), true);
    assert.equal(observedEvent({ type: 'sink', ship: a.id }, b, null, a.team), true);
    b.profile = 'historical'; assert.equal(observedEvent({ type: 'sink', ship: e.id }, b, null, a.team), true);
    assert.equal(observedShips(b, a.team).length, 2);
  });
  check('visible sinking completion reaches both local effects and the wire after the hull becomes inactive, including lit night targets', () => {
    for (const night of [false, true]) {
      const b = new Battle(99, COMPETITIVE_PROFILE); b.night = night; b.humans = new Set([0, 1]);
      b.addShip('panokseon', 0, 0, 0, 'a', null);
      const e = b.addShip('atakebune', night ? 1200 : 700, 0, 0, 'e', null);
      e.sinking = 0.999; e.lights = true; b.step(0.1);
      assert.equal(e.alive, false);
      const removed = b.events.find((e) => e.type === 'removed'); assert.ok(removed);
      assert.equal(observedEvent(removed, b, null, 'joseon'), true);
      assert.equal(eventObserved(removed, b, null, 'joseon'), true);
      e.x = 6000; b.time += 0.25;
      assert.equal(observedEvent(removed, b, null, 'joseon'), false);
    }
  });
  check('a hidden stale hull cannot change the visual impact prediction of an observed cannonball', () => {
    const b = new Battle(99, COMPETITIVE_PROFILE);
    const e = b.addShip('atakebune', 50, 0, 0, 'hidden', null);
    const p = { x: 0, y: 4, z: 0, vx: 100, vy: 0, vz: 0, team: 'joseon' };
    e.alive = false; const seaOnly = timeToImpact(p, b, () => 0);
    e.alive = true; e.observed = false; assert.equal(timeToImpact(p, b, () => 0), seaOnly);
    e.observed = true; assert.ok(timeToImpact(p, b, () => 0) < seaOnly);
  });
} finally { await vite.close(); }
process.exitCode = failed ? 1 : 0;
