// Regression checks for the battle depth rules (src/sim/depth.ts): morale, rout and rally, the drum, raking, crossfire,
// formation cohesion and fire spread, which battles carry them, and that the rules before them are untouched.
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const server = await createServer({ root, configFile: false, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false }, optimizeDeps: { noDiscovery: true, include: [] } });
let failed = 0;
const check = (name, fn) => { try { fn(); console.log('ok   ' + name); } catch (e) { failed++; console.error('FAIL ' + name + '\n' + e.stack); } };
try {
  const load = (p) => server.ssrLoadModule(p);
  const { Battle, SIM_DT } = await load('/src/sim/battle.ts');
  const { DEPTH_V1, DEPTH_V2, DEPTH_LATEST } = await load('/src/sim/depth.ts');
  const { buildScenario, SCENARIO_ORDER } = await load('/src/sim/scenarios.ts');
  const { buildConquest, buildConquestOn, autoFleet } = await load('/src/sim/maps.ts');
  const { DEFAULT_OPTIONS, RANKED_OPTIONS } = await load('/src/sim/conquest.ts');
  const { applyCommand } = await load('/src/sim/commands.ts');
  const { newGrand } = await load('/src/sim/grand/turn.ts');

  /** Two squadrons face to face; the Joseon one is led by its first ship. Owners 0 and 1 are the computer unless `humans`. */
  const duel = ({ depth = DEPTH_V1, seed = 5, joseon = ['panokseon', 'panokseon', 'panokseon'], japan = ['sekibune'], gap = 2000, humans = [] } = {}) => {
    const b = new Battle(seed);
    b.depth = depth;
    b.humans = new Set(humans);
    b.windDrift = 0;
    const own = b.addSquadron('joseon', 'own', 'leader', '', '', 0);
    const foe = b.addSquadron('japan', 'foe', 'leader', '', '', 1);
    const a = joseon.map((kind, i) => b.addShip(kind, 0, i * 60, 0, 'j' + i, own, i === 0));
    const z = japan.map((kind, i) => b.addShip(kind, gap, i * 60, Math.PI, 'w' + i, foe, i === 0));
    for (const s of [...a, ...z]) { s.speed = 0; s.order = { type: 'hold' }; }
    return { b, a, z, own, foe };
  };
  const steps = (b, seconds) => { for (let i = 0; i < Math.round(seconds / SIM_DT); i += 1) b.step(SIM_DT); };
  const events = (b, seconds, type) => {
    const out = [];
    for (let i = 0; i < Math.round(seconds / SIM_DT); i += 1) {
      b.step(SIM_DT);
      for (const e of b.events) if (e.type === type) out.push(e);
      b.events.length = 0;
    }
    return out;
  };

  check('historical battles, conquest against the computer and the campaign carry the newest depth rules; ranked and online rooms none', () => {
    for (const id of SCENARIO_ORDER) assert.equal(buildScenario(id, 0, 3).depth, DEPTH_LATEST);
    const seats = [
      { name: 'a', faction: 'joseon', team: 'joseon', human: true, fleet: autoFleet('joseon') },
      { name: 'b', faction: 'japan', team: 'japan', human: false, fleet: autoFleet('japan') },
    ];
    const flat = () => -50;
    assert.equal(buildConquest('hallyeo', seats, flat, 3, {}).battle.depth, null, 'online casual rooms build with the default options');
    assert.equal(buildConquest('hallyeo', seats, flat, 3, DEFAULT_OPTIONS).battle.depth, null);
    assert.equal(buildConquest('hallyeo', seats, flat, 3, RANKED_OPTIONS).battle.depth, null, 'ranked keeps the rules it was calibrated with');
    assert.equal(buildConquest('hallyeo', seats, flat, 3, { depth: 'depth-v1' }).battle.depth, DEPTH_V1);
    assert.equal(buildConquest('hallyeo', seats, flat, 3, { depth: 'depth-v2' }).battle.depth, DEPTH_V2);
    assert.ok(newGrand, 'the campaign module loads');
  });

  check('without the depth rules no crew loses heart, and the morale, tactics and fire systems stay off', () => {
    const { b, a, z } = duel({ depth: null, gap: 300 });
    for (const s of [...a, ...z]) s.order = { type: 'auto' };
    const seen = events(b, 90, 'morale');
    assert.equal(seen.length, 0);
    assert.equal(b.morale, null);
    assert.equal(b.tactics, null);
    assert.equal(b.fireSpread, null);
    for (const s of b.ships) { assert.equal(s.morale, 1); assert.equal(s.moraleState, 'steady'); }
    assert.equal(b.drum(a.map((s) => s.id)), 0);
  });

  check('losses wear a crew down until it wavers, then runs; a wavering crew loads slower and a running one stops firing', () => {
    const { b, a } = duel();
    const s = a[1];
    steps(b, 1);
    b.setCrew(s, s.spec.crew * 0.62);
    s.hull = s.spec.hull * 0.6;
    const seen = events(b, 1.5, 'morale');
    assert.equal(s.moraleState, 'wavering', `morale ${s.morale.toFixed(2)}`);
    assert.ok(seen.some((e) => e.ship === s.id && e.state === 'wavering'));
    assert.ok(b.morale.steadiness(s) < 1 && b.morale.steadiness(s) > 0);
    b.morale.shock(s, 1);
    assert.equal(s.moraleState, 'routing');
    assert.equal(b.morale.steadiness(s), 0);
    const loading = s.guns.filter((g) => g.stage < 4).map((g) => g.t);
    steps(b, 2);
    assert.deepEqual(s.guns.filter((g) => g.stage < 4).map((g) => g.t), loading, 'a running crew leaves its guns');
    assert.equal(b.activityOf(s.id), 'fleeing');
  });

  check('a running crew rallies with its leader close by, and regroups on it before it takes orders again', () => {
    const { b, a } = duel();
    const s = a[2];
    steps(b, 1);
    b.morale.shock(s, 1);
    assert.equal(s.moraleState, 'routing');
    s.morale = 0.5;
    const seen = events(b, 12, 'morale');
    assert.ok(seen.some((e) => e.ship === s.id && e.state === 'rallying'), 'rallies after the rout has run its first seconds');
    steps(b, 8);
    assert.ok(s.moraleState === 'steady' || s.moraleState === 'wavering', s.moraleState);
  });

  check('losing a squadron leader shakes the squadron, is called out, and the next captain takes over after 30 s', () => {
    const { b, a, own } = duel();
    steps(b, 1);
    const before = a.slice(1).map((s) => s.morale);
    a[0].hull = 1;
    b.damage(a[0], 5);
    const lost = b.events.filter((e) => e.type === 'leader');
    assert.deepEqual(lost.map((e) => e.ship), [a[0].id]);
    assert.equal(lost[0].flagship, true, 'the leader of the first Joseon squadron is the navy\'s admiral');
    a.slice(1).forEach((s, i) => assert.ok(s.morale < before[i] - 0.3, `shock ${before[i] - s.morale}`));
    steps(b, 31);
    assert.ok(own.leaderId === a[1].id || own.leaderId === a[2].id, 'a surviving ship leads the squadron');
  });

  check('the drum steadies a squadron, rests 90 s between beats, needs its leader and is answered only for the owner', () => {
    const { b, a, z } = duel({ humans: [0] });
    steps(b, 1);
    a[1].morale = 0.45;
    a[1].moraleState = 'wavering';
    assert.equal(applyCommand(b, 1, { type: 'drum', ids: [a[1].id] }), 0, 'another commander cannot beat this squadron\'s drum');
    assert.equal(applyCommand(b, 0, { type: 'drum', ids: [a[1].id, a[2].id] }), 1, 'one squadron, one drum');
    assert.ok(b.events.some((e) => e.type === 'drum' && e.ship === a[0].id));
    assert.ok(b.morale.drumWait(a[0].squadronId) > 85);
    assert.equal(applyCommand(b, 0, { type: 'drum', ids: [a[1].id] }), 0, 'the drum rests');
    steps(b, 20);
    assert.ok(a[1].morale > 0.62 && a[1].moraleState === 'steady', `${a[1].morale}`);
    assert.equal(applyCommand(b, 1, { type: 'drum', ids: [z[0].id] }), 1);
  });

  check('a boarded crew that loses heart gives its ship up', () => {
    const { b, a, z } = duel({ japan: ['sekibune', 'sekibune'], gap: 30 });
    steps(b, 0.5);
    z[0].grappledWith = a[1].id;
    a[1].morale = 0.1;
    a[1].moraleState = 'routing';
    steps(b, SIM_DT);
    assert.equal(a[1].struck, true);
  });

  check('a computer fleet whose ships still fighting fall under its line breaks: every crew runs and the side loses', () => {
    const { b, z } = duel({ japan: ['sekibune', 'sekibune', 'sekibune', 'sekibune'] });
    b.retreatBelow.japan = 0.6;
    steps(b, 61);
    // Two of four running, the flagship holding: half the fleet still fights, under the line of 0.6.
    for (const s of z.slice(1, 3)) b.morale.shock(s, 1);
    const broken = events(b, 1, 'broken');
    assert.equal(broken.length, 1);
    assert.equal(broken[0].team, 'japan');
    assert.ok(z.every((s) => !b.isActive(s) || s.moraleState === 'routing'));
    steps(b, 40);
    assert.equal(b.winner, null, 'the winner has 45 s to run the fleeing ships down');
    steps(b, 7);
    assert.equal(b.winner, 'joseon', 'a side mostly running for 45 s has lost the field');
  });

  check('a fleet a person leads breaks at its line too', () => {
    const { b, a } = duel({ humans: [0], joseon: ['panokseon', 'panokseon', 'panokseon', 'panokseon', 'panokseon'] });
    b.retreatBelow.joseon = 0.5;
    steps(b, 61);
    b.morale.shock(a[1], 1);
    b.morale.shock(a[2], 1);
    steps(b, 1);
    assert.equal(b.isRetreating('joseon'), false, '3 of 5 fighting is above 0.5');
    b.morale.shock(a[3], 1);
    steps(b, 1);
    assert.equal(b.isRetreating('joseon'), true, '2 of 5 is under it');
  });

  check('a shot down the keel line rakes; hits from two quarters within 3 s catch a ship in a crossfire', () => {
    const { b, z } = duel({ japan: ['atakebune'] });
    steps(b, 1);
    const t = z[0];
    const keel = b.tactics.hit(t, 1, 'ball', Math.cos(t.heading) * 100, Math.sin(t.heading) * 100);
    assert.equal(keel.bonus, 'rake');
    assert.ok(keel.hull > 1 && keel.crew > 1);
    const beam = b.tactics.hit(t, 2, 'ball', -Math.sin(t.heading) * 100, Math.cos(t.heading) * 100);
    assert.equal(beam.bonus, undefined, 'a beam shot from the first shooter\'s bearing alone is ordinary');
    const other = b.tactics.hit(t, 3, 'ball', Math.sin(t.heading) * 100, -Math.cos(t.heading) * 100);
    assert.equal(other.bonus, 'cross');
    assert.ok(other.hull > 1);
    assert.equal(b.tactics.hit(t, 4, 'fire', Math.cos(t.heading) * 100, Math.sin(t.heading) * 100).bonus !== 'rake', true, 'fire arrows do not rake');
  });

  check('ships keeping a formation slot beside friends on the same heading hold together', () => {
    const { b, a } = duel({ joseon: ['panokseon', 'panokseon', 'panokseon', 'panokseon'] });
    a.forEach((s, i) => { s.x = 0; s.z = i * 60; s.heading = 0; s.order = { type: 'slot', x: 0, z: i * 60, face: 0 }; });
    steps(b, 1);
    assert.ok(b.tactics.cohesive.has(a[1].id) && b.tactics.cohesive.has(a[2].id), 'the inner ships have a friend on each side');
    a[2].heading = 1.2;
    steps(b, 0.6);
    assert.equal(b.tactics.cohesive.has(a[1].id), false, 'a friend turned away breaks the line');
  });

  check('fire jumps to a hull lying close downwind, not to one far off, and marks where it came from', () => {
    let caught = 0;
    let far = 0;
    for (let seed = 1; seed <= 6; seed += 1) {
      const { b, z } = duel({ seed, japan: ['sekibune', 'sekibune', 'sekibune'] });
      b.windAngle = Math.PI / 2;
      z[0].x = z[1].x = z[2].x = 3000;
      z[0].z = 0; z[1].z = 22; z[2].z = 400;
      z[0].fire = 1;
      const seen = events(b, 45, 'ignite');
      if (seen.some((e) => e.ship === z[1].id && e.from === z[0].id)) caught += 1;
      if (seen.some((e) => e.ship === z[2].id)) far += 1;
    }
    assert.ok(caught >= 4, `caught ${caught} of 6`);
    assert.equal(far, 0);
  });

  check('the same seed and commands give the same battle under the depth rules', () => {
    const run = () => {
      const b = buildScenario('hansan', 0, 77);
      b.autopilot = true;
      steps(b, 240);
      return JSON.stringify({ ships: b.ships.map((s) => [s.x, s.z, s.hull, s.crew, s.morale, s.moraleState, s.fire]), time: b.time });
    };
    assert.equal(run(), run());
  });

  check('a broken conquest fleet bleeds its tickets and its running ships make for their own port', () => {
    const map = { night: false, sea: 'calm', points: [
      { name: 'west', hanja: '', x: -1500, z: 0, r: 250, value: 1, home: 0 },
      { name: 'east', hanja: '', x: 1500, z: 0, r: 250, value: 1, home: 1 },
    ] };
    const seats = [
      { name: 'west', faction: 'joseon', team: 'joseon', human: false, fleet: ['panokseon', 'panokseon'] },
      { name: 'east', faction: 'japan', team: 'japan', human: false, fleet: ['atakebune', 'atakebune'] },
    ];
    const { battle: b, conquest } = buildConquestOn(map, seats, () => -50, 9, { depth: 'depth-v1' });
    steps(b, 121);
    const west = b.ships.filter((s) => s.team === 'joseon');
    for (const s of west) b.morale.shock(s, 1);
    const port = conquest.refuge(b, west[0]);
    assert.deepEqual(port, { x: conquest.homeOf(0).x, z: conquest.homeOf(0).z });
    const before = conquest.tickets.joseon;
    steps(b, 3);
    assert.ok(before - conquest.tickets.joseon >= conquest.options.tickets * 0.02, `${before - conquest.tickets.joseon}`);
  });

  check('a conquest fleet beaten down to a remnant is swept from the sea; a port that only ever had a few ships is not', () => {
    const map = { night: false, sea: 'calm', points: [
      { name: 'west', hanja: '', x: -1500, z: 0, r: 250, value: 1, home: 0 },
      { name: 'east', hanja: '', x: 1500, z: 0, r: 250, value: 1, home: 1 },
    ] };
    const seats = (west) => [
      { name: 'west', faction: 'joseon', team: 'joseon', human: true, fleet: west },
      { name: 'east', faction: 'japan', team: 'japan', human: true, fleet: ['atakebune', 'atakebune', 'atakebune'] },
    ];
    const hold = (b) => { for (const s of b.ships) { s.order = { type: 'anchor' }; s.fireMode = 'hold'; } };
    const beaten = buildConquestOn(map, seats(['panokseon', 'panokseon', 'panokseon']), () => -50, 9, { depth: 'depth-v1' }).battle;
    hold(beaten);
    steps(beaten, 30);
    for (const s of beaten.ships) if (s.team === 'joseon') { s.hull = s.spec.hull * 0.05; beaten.setCrew(s, s.spec.crew * 0.05); }
    // The remnant keeps its nerve, so neither a rout nor the tickets decide this: only the sweep can.
    beaten.morale.memo.clear();
    steps(beaten, 330);
    assert.ok(beaten.ships.every((s) => s.moraleState === 'steady'));
    assert.equal(beaten.winner, 'japan', 'under a third of the foe and half of what it had, for 45 s after the opening');
    const small = buildConquestOn(map, seats(['hyeopseon']), () => -50, 9, { depth: 'depth-v1' }).battle;
    hold(small);
    steps(small, 360);
    assert.equal(small.winner, null);
  });
} finally {
  await server.close();
}
if (failed) {
  console.error(`${failed} depth check(s) failed`);
  process.exit(1);
}
console.log('all passed');
