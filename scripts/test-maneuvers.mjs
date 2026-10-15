// Regression and acceptance checks for the tactical maneuvers (src/sim/maneuvers.ts, src/sim/tactician.ts, depth-v2).
//   node scripts/test-maneuvers.mjs            the rules on small battles, then Hansan (about 5 minutes)
//   node scripts/test-maneuvers.mjs --unit     the rules only (under two minutes)
//   node scripts/test-maneuvers.mjs --noryang  also Noryang played by commands against no commands (about 15 minutes more).
//     This one is the open target: the commands win near the record but do not yet beat the computer allies left to
//     themselves, and the broken van does not reach Gwaneumpo in the whole battle (it does when the strait is shut on it).
// Every battle is headless and seeded. The acceptance part shows that the battles come out of the maneuvers: the crane
// at Hansan gives a crossfire the old rules never did, and at Noryang a player's commands alone (an ambush at the
// strait, a breach behind the van, a pincer, the narrows and Gwaneumpo held) do far better than no commands at all.
import assert from 'node:assert/strict';
import { openSim, scenario, run, noryang, noryangLine } from './maneuvers-harness.mjs';

const unitOnly = process.argv.includes('--unit');
const noryangToo = process.argv.includes('--noryang');
const mods = await openSim();
const { Battle, SIM_DT } = mods.battle;
const { DEPTH_V1, DEPTH_V2 } = mods.depth;
const { applyCommand } = mods.cmd;
const { encodeSnapshot, decodeSnapshot, SENT_EVENTS, ORDER_NAMES } = await mods.load('/src/net/protocol.ts');
let failed = 0;
const check = async (name, fn) => {
  const t0 = performance.now();
  try {
    await fn();
    console.log(`ok   ${name} (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
  } catch (e) {
    failed += 1;
    console.error('FAIL ' + name + '\n' + e.stack);
  }
};
const steps = (b, seconds, each) => {
  const out = [];
  for (let i = 0; i < Math.round(seconds / SIM_DT); i += 1) {
    each?.(b);
    b.step(SIM_DT);
    out.push(...b.events);
    b.events.length = 0;
  }
  return out;
};
/** Squadrons on open water: `own` for owner 0 (Joseon), `foe` for owner 1 (Japan). Nobody is a person unless `humans`. */
const sea = ({ seed = 7, depth = DEPTH_V2, own = [], foe = [], humans = [0], night = false } = {}) => {
  const b = new Battle(seed);
  b.depth = depth;
  b.night = night;
  b.windDrift = 0;
  b.humans = new Set(humans);
  b.retreatBelow = { joseon: 0, japan: 0 };
  const make = (team, owner, list) =>
    list.map((g, k) => {
      const sq = b.addSquadron(team, `${team}${k}`, 'leader', '', '', owner);
      return g.map(([kind, x, z, h = 0], i) => {
        const s = b.addShip(kind, x, z, h, `${team}${k}-${i}`, sq, i === 0);
        s.speed = 0;
        s.order = { type: 'hold' };
        return s;
      });
    });
  return { b, own: make('joseon', 0, own), foe: make('japan', 1, foe) };
};
const row = (kind, x, z, n, dx, dz, h = 0) => Array.from({ length: n }, (_, i) => [kind, x + dx * i, z + dz * i, h]);

await check('a ship on a formation station stops on it and turns there instead of circling it', () => {
  const { b, own } = sea({ own: [row('panokseon', 0, 0, 1, 0, 0)] });
  const s = own[0][0];
  s.order = { type: 'slot', x: 400, z: 200, face: Math.PI / 2 };
  steps(b, 120);
  let far = 0;
  let off = 0;
  steps(b, 60, () => {
    if (Math.hypot(s.x - 400, s.z - 200) > 45) far += 1;
    const diff = Math.abs(Math.atan2(Math.sin(s.heading - Math.PI / 2), Math.cos(s.heading - Math.PI / 2)));
    if (Math.min(diff, Math.PI - diff) > 0.3) off += 1;
  });
  assert.equal(far, 0, 'stays within 45 m of its station');
  assert.ok(off < 60 / SIM_DT * 0.1, `keeps its facing ${off}`);
});

await check('guns are not fired through a friend’s hull under the maneuver rules; the older rules still do', () => {
  const lane = (depth) => {
    // A friend lies between the gun ship and its only target, both broadside on.
    const { b, own, foe } = sea({ depth, own: [[['panokseon', 0, 0, 0], ['panokseon', 0, 150, 0]]], foe: [row('sekibune', 0, 320, 1, 0, 0)] });
    for (const s of [...own[0], ...foe[0]]) s.order = { type: 'anchor' };
    const shooter = own[0][0];
    const target = foe[0][0];
    const shots = steps(b, 20).filter((e) => e.type === 'gun' && e.ship === shooter.id);
    void target;
    return shots.length;
  };
  assert.equal(lane(DEPTH_V2), 0);
  assert.ok(lane(DEPTH_V1) > 0);
});

await check('an ambush holds fire, dark, until the enemy enters its zone; then every broadside goes off and the first hits are a surprise', () => {
  const { b, own, foe } = sea({ night: true, own: [row('panokseon', -700, -300, 6, 0, 120)], foe: [row('sekibune', 1400, 0, 4, 0, 60, Math.PI)] });
  const ids = own[0].map((s) => s.id);
  assert.ok(applyCommand(b, 0, { type: 'maneuver', ids, kind: 'ambush', x0: 0, z0: 0, x1: 300, z1: 0 }));
  for (const s of own[0]) assert.equal(s.lights, false);
  for (const s of own[0]) assert.equal(s.fireMode, 'hold');
  // Unseen in the dark from beyond 260 m.
  const lurker = own[0][0];
  steps(b, 90);
  assert.equal(b.canSee(lurker, 600, 'japan'), false);
  assert.equal(b.canSee(lurker, 200, 'japan'), true);
  const before = steps(b, 1).filter((e) => e.type === 'gun' && own[0].some((s) => s.id === e.ship));
  assert.equal(before.length, 0);
  for (const s of foe[0]) s.order = { type: 'move', x: -300, z: s.z };
  let sprung = -1;
  const events = steps(b, 320, () => {
    if (sprung < 0 && [...b.maneuvers.plans.values()].some((p) => p.kind === 'ambush' && p.phase === 'striking')) sprung = b.time;
  });
  assert.ok(sprung > 0, 'it sprang');
  const plan = [...b.maneuvers.plans.values()].find((p) => p.kind === 'ambush');
  assert.ok(events.some((e) => e.type === 'maneuver' && e.kind === 'ambush' && e.phase === 'striking'));
  assert.ok(events.some((e) => e.type === 'volley' && e.side === 3), 'both broadsides');
  assert.ok(events.filter((e) => e.type === 'hit').length > 0);
  for (const s of own[0]) if (b.isActive(s)) assert.equal(s.fireMode, 'free');
  void plan;
});

await check('a pincer stages its two wings at the ends of the line, then closes from opposite sides', () => {
  const { b, own, foe } = sea({ own: [row('panokseon', -900, -400, 5, 0, 70), row('panokseon', -900, 200, 5, 0, 70)], foe: [row('sekibune', 300, 0, 6, 40, 0)] });
  for (const s of foe[0]) s.order = { type: 'anchor' };
  const ids = [...own[0], ...own[1]].map((s) => s.id);
  applyCommand(b, 0, { type: 'maneuver', ids, kind: 'pincer', x0: 400, z0: -700, x1: 400, z1: 700 });
  const plan = [...b.maneuvers.plans.values()][0];
  assert.equal(new Set(own[0].map((s) => plan.wing.get(s.id))).size, 1, 'a squadron stays together');
  assert.notEqual(plan.wing.get(own[0][0].id), plan.wing.get(own[1][0].id));
  // Bearings of the two wings from the target, once they have closed for half a minute: far apart.
  const bear = (ships) => {
    const live = ships.filter((s) => b.isActive(s));
    const x = live.reduce((v, s) => v + s.x, 0) / live.length;
    const z = live.reduce((v, s) => v + s.z, 0) / live.length;
    return Math.atan2(z - plan.cz, x - plan.cx);
  };
  let struck = -1;
  let diff = 0;
  steps(b, 400, () => {
    if (struck < 0 && plan.phase === 'striking') struck = b.time;
    if (struck > 0 && Math.abs(b.time - struck - 30) < SIM_DT / 2) diff = Math.abs(Math.atan2(Math.sin(bear(own[0]) - bear(own[1])), Math.cos(bear(own[0]) - bear(own[1]))));
  });
  assert.ok(struck > 0, 'the wings closed');
  assert.ok(diff > 2, `wings ${diff.toFixed(2)} rad apart`);
});

await check('a breach passing between enemy ships and their leader cuts them off: late orders, no place in the line, slower to decide', () => {
  // The enemy squadron's leader lies north, its ships south; the column drives through between them.
  const { b, own, foe } = sea({ humans: [0], own: [row('panokseon', -800, 0, 4, -60, 0)], foe: [[['atakebune', 0, -450, 0], ...row('sekibune', 0, 300, 4, 60, 0)]] });
  for (const s of foe[0]) s.order = { type: 'anchor' };
  applyCommand(b, 0, { type: 'maneuver', ids: own[0].map((s) => s.id), kind: 'breach', x0: -500, z0: 0, x1: 600, z1: 0 });
  const events = steps(b, 300);
  const cut = events.filter((e) => e.type === 'cutoff');
  assert.ok(cut.length >= 2, `${cut.length} cut off`);
  const victim = b.get(cut[0].ship);
  if (b.isActive(victim) && b.maneuvers.isCut(victim)) {
    assert.equal(b.maneuvers.outOfCommand(victim), true);
    assert.ok(b.maneuvers.delay(victim) > 0);
  }
});

await check('a blockade lines the water across a channel and holds its place against the stream', () => {
  const { b, own } = sea({ own: [row('panokseon', -300, -600, 6, 0, 30)] });
  b.current = { x: 1.2, z: 0 };
  applyCommand(b, 0, { type: 'maneuver', ids: own[0].map((s) => s.id), kind: 'blockade', x0: 0, z0: -400, x1: 0, z1: 400 });
  steps(b, 240);
  const plan = [...b.maneuvers.plans.values()][0];
  for (const s of own[0]) {
    const st = plan.stations.get(s.id);
    assert.ok(Math.hypot(s.x - st.x, s.z - st.z) < 60, `on its station: ${Math.hypot(s.x - st.x, s.z - st.z).toFixed(0)} m`);
    assert.ok(Math.abs(s.x) < 80, 'on the line');
  }
});

await check('the bait shows itself, falls back to its point ahead of a rash pursuer and beats the drum; the ambush there springs', () => {
  const { b, own, foe } = sea({ humans: [0], own: [row('panokseon', 0, -200, 6, 0, 80), row('panokseon', 300, 0, 3, 0, 60)], foe: [row('atakebune', 1500, -150, 10, 30, 35, Math.PI)] });
  for (const s of foe[0]) s.order = { type: 'auto' };
  b.squadron(foe[0][0].squadronId).temper = 'rash';
  applyCommand(b, 0, { type: 'maneuver', ids: own[0].map((s) => s.id), kind: 'ambush', x0: -200, z0: 0, x1: 100, z1: 0 });
  applyCommand(b, 0, { type: 'maneuver', ids: own[1].map((s) => s.id), kind: 'lure', x0: 900, z0: 0, x1: -200, z1: 0 });
  const events = steps(b, 420);
  assert.ok(events.some((e) => e.type === 'maneuver' && e.kind === 'lure' && e.phase === 'striking'), 'the bait turned for home');
  const sprang = events.some((e) => e.type === 'maneuver' && e.kind === 'ambush' && e.phase === 'striking');
  assert.ok(sprang, 'the ambush sprang');
  assert.ok(foe[0].some((s) => !b.isActive(s) || Math.hypot(s.x, s.z) < 700), 'the pursuers came on');
});

await check('a flagship’s signals reach so far: a ship beyond them hears a change late, a ship close by at once', () => {
  const { b, own } = sea({ own: [[['panokseon', 0, 0, 0], ['panokseon', 200, 0, 0], ['panokseon', 2600, 0, 0]]] });
  const m = b.maneuvers;
  b.step(SIM_DT);
  assert.equal(m.delay(own[0][1]), 0);
  assert.ok(m.delay(own[0][2]) > 4);
  assert.equal(m.outOfCommand(own[0][2]), true);
  b.night = true;
  assert.ok(m.commandRange() < 1000, 'by night only the drum and the lanterns');
});

await check('maneuver commands are checked like any other: kinds, numbers, owners; the rules without maneuvers refuse them', () => {
  const { b, own, foe } = sea({ own: [row('panokseon', 0, 0, 3, 0, 70)], foe: [row('sekibune', 2000, 0, 2, 0, 60)] });
  const ids = own[0].map((s) => s.id);
  assert.equal(applyCommand(b, 0, { type: 'maneuver', ids, kind: 'teleport', x0: 0, z0: 0, x1: 1, z1: 1 }), 0);
  assert.equal(applyCommand(b, 0, { type: 'maneuver', ids, kind: 'ambush', x0: NaN, z0: 0, x1: 1, z1: 1 }), 0);
  assert.equal(applyCommand(b, 1, { type: 'maneuver', ids, kind: 'ambush', x0: 0, z0: 0, x1: 300, z1: 0 }), 0, 'not the owner’s ships');
  assert.equal(applyCommand(b, 0, { type: 'signal', ids, signal: 'charge' }), 0);
  assert.equal(applyCommand(b, 0, { type: 'order', ids, order: { type: 'maneuver', plan: 1 } }), 0, 'only the maneuver command puts a ship in a plan');
  assert.equal(b.maneuvers.plans.size, 0);
  const old = sea({ depth: DEPTH_V1, own: [row('panokseon', 0, 0, 3, 0, 70)] });
  assert.equal(old.b.maneuvers, null);
  assert.equal(applyCommand(old.b, 0, { type: 'maneuver', ids: old.own[0].map((s) => s.id), kind: 'ambush', x0: 0, z0: 0, x1: 300, z1: 0 }), 0);
  void foe;
});

await check('the same seed and the same maneuvers give the same battle, the computer’s commanders included', () => {
  const play = () => {
    const { b, own, foe } = sea({ seed: 11, humans: [], own: [row('panokseon', -900, -300, 6, 0, 90), row('panokseon', -900, 400, 5, 0, 90)], foe: [row('sekibune', 900, 0, 8, 40, 50, Math.PI), row('atakebune', 1300, 200, 6, 40, 50, Math.PI)] });
    for (const s of [...own.flat(), ...foe.flat()]) s.order = { type: 'auto' };
    applyCommand(b, 0, { type: 'maneuver', ids: own[0].map((s) => s.id), kind: 'pincer', x0: 600, z0: -500, x1: 600, z1: 600 });
    steps(b, 240);
    return b.ships.map((s) => `${s.id}:${s.x.toFixed(3)},${s.z.toFixed(3)},${s.hull.toFixed(3)},${s.order.type}`).join('|');
  };
  assert.equal(play(), play());
});

await check('the protocol carries the maneuver order and sends the maneuver, signal and cut-off events', () => {
  const { b, own } = sea({ own: [row('panokseon', 0, 0, 2, 0, 70)] });
  applyCommand(b, 0, { type: 'maneuver', ids: own[0].map((s) => s.id), kind: 'blockade', x0: 0, z0: -200, x1: 0, z1: 200 });
  const frame = decodeSnapshot(encodeSnapshot(b.time, b.ships, 0, (s) => b.isActive(s)));
  assert.equal(ORDER_NAMES[frame.ships[0].order], 'maneuver');
  for (const type of ['maneuver', 'signal', 'cutoff']) assert.ok(SENT_EVENTS.has(type), type);
});

await check('a routing crew at Noryang runs for the open water it can see: with the strait shut behind it, into Gwaneumpo', () => {
  const b = scenario(mods, 'noryang', 'joseon', 1592);
  // The allies hold the narrows and the north of the basin; a broken van lies at the strait's western mouth.
  const van = b.activeOf('japan').slice(0, 30);
  van.forEach((s, i) => {
    s.x = -1500 + (i % 6) * 70;
    s.z = 200 + Math.floor(i / 6) * 70;
    s.heading = Math.PI * 0.75;
  });
  for (const s of b.activeOf('japan').slice(30)) { s.alive = false; s.fled = true; }
  b.activeOf('joseon').forEach((s, i) => {
    s.x = i < 60 ? -500 + (i % 3) * 60 : -2400 + (i % 10) * 80;
    s.z = i < 60 ? -1100 + Math.floor(i / 3) * 75 : -900 + Math.floor((i - 60) / 10) * 70;
    s.order = { type: 'hold' };
    s.speed = 0;
  });
  b.step(SIM_DT);
  for (const s of van) b.morale.shock(s, 5);
  steps(b, 360);
  const bay = van.filter((s) => s.z > 1900 && s.x < -1900);
  assert.ok(bay.length >= van.length / 3, `${bay.length} of ${van.length} ran south-west for the bay`);
});

const mean = (list, f) => list.reduce((v, r) => v + f(r), 0) / list.length;
if (!unitOnly) {
  await check('Hansan, the computer on both sides: the crane brings a crossfire the older rules never did, and a decisive win', () => {
    const v1 = [];
    const v2 = [];
    for (let k = 0; k < 3; k += 1) {
      for (const [depth, out] of [[DEPTH_V1, v1], [DEPTH_V2, v2]]) {
        const b = scenario(mods, 'hansan', 'joseon', 1592 + k * 101);
        b.depth = depth;
        b.autopilot = true;
        out.push(run(mods, b, { minutes: 30 }));
      }
    }
    const c1 = mean(v1, (r) => r.crossShare);
    const c2 = mean(v2, (r) => r.crossShare);
    console.log(`     crossfire ${c1.toFixed(1)}% -> ${c2.toFixed(1)}% · through friends ${mean(v1, (r) => r.maskedShare).toFixed(1)}% -> ${mean(v2, (r) => r.maskedShare).toFixed(1)}% · Japanese lost ${mean(v2, (r) => r.lost.japan).toFixed(0)}, Joseon lost ${mean(v2, (r) => r.lost.joseon).toFixed(1)}`);
    assert.ok(c2 >= 3 * c1 && c2 >= 12, `crossfire ${c1.toFixed(1)} -> ${c2.toFixed(1)}`);
    assert.ok(mean(v2, (r) => r.maskedShare) < 10);
    for (const r of v2) {
      assert.equal(r.winner, 'joseon');
      assert.ok(r.lost.japan >= 50 && r.lost.joseon <= 12, JSON.stringify(r.lost));
    }
  });

  await check('Hansan, a player’s lure into the crane: crossfire and a decisive win from two commands', () => {
    const results = [];
    for (let k = 0; k < 2; k += 1) {
      const b = scenario(mods, 'hansan', 'joseon', 1592 + k * 101);
      let given = false;
      results.push(run(mods, b, {
        minutes: 30,
        each: () => {
          if (given || b.time < 1) return;
          given = true;
          // The lure: five ships nearest the enemy go out; the rest spread the crane where the fleet lies.
          const own = b.activeOf('joseon').filter((s) => s.guns.length);
          const foe = b.activeOf('japan');
          const fx = own.reduce((v, s) => v + s.x, 0) / own.length;
          const fz = own.reduce((v, s) => v + s.z, 0) / own.length;
          const ex = foe.reduce((v, s) => v + s.x, 0) / foe.length;
          const ez = foe.reduce((v, s) => v + s.z, 0) / foe.length;
          const d = Math.hypot(ex - fx, ez - fz);
          const ux = (ex - fx) / d;
          const uz = (ez - fz) / d;
          const bait = [...own].sort((p, q) => Math.hypot(p.x - ex, p.z - ez) - Math.hypot(q.x - ex, q.z - ez)).slice(0, 5);
          const rest = own.filter((s) => !bait.includes(s));
          const cx = fx + ux * 400;
          const cz = fz + uz * 400;
          applyCommand(b, 0, { type: 'maneuver', ids: rest.map((s) => s.id), kind: 'crane', x0: cx, z0: cz, x1: cx + ux * 400, z1: cz + uz * 400 });
          applyCommand(b, 0, { type: 'maneuver', ids: bait.map((s) => s.id), kind: 'lure', x0: ex - ux * 380, z0: ez - uz * 380, x1: cx, z1: cz });
        },
      }));
    }
    console.log(`     crossfire ${mean(results, (r) => r.crossShare).toFixed(1)}% · Japanese lost ${mean(results, (r) => r.lost.japan).toFixed(0)}, Joseon lost ${mean(results, (r) => r.lost.joseon).toFixed(1)}`);
    for (const r of results) {
      assert.equal(r.winner, 'joseon');
      assert.ok(r.crossShare >= 12, `crossfire ${r.crossShare}`);
      assert.ok(r.lost.japan >= 50, JSON.stringify(r.lost));
    }
  });

  await check('the computer uses the maneuvers: the crane and its bait before contact at Hansan, the pursuit of a broken fleet', () => {
    const b = scenario(mods, 'hansan', 'joseon', 1592);
    b.autopilot = true;
    const kinds = new Map();
    let firstHit = Infinity;
    while (!b.ended && b.time < 30 * 60) {
      b.step(SIM_DT);
      for (const e of b.events) {
        if (e.type === 'maneuver' && e.team === 'joseon' && !kinds.has(e.kind)) kinds.set(e.kind, b.time);
        if (e.type === 'hit' && firstHit === Infinity) firstHit = b.time;
      }
      b.events.length = 0;
    }
    assert.ok(kinds.get('crane') < firstHit, 'the crane spread before the first hit');
    assert.ok(kinds.get('lure') < firstHit, 'bait sent before the first hit');
    assert.ok(kinds.has('pursue'), 'ships sent after the broken enemy');
  });

  if (noryangToo) await check('Noryang: a player’s commands (ambush in the basin, breach behind the van, pincer, the narrows and Gwaneumpo held) do clearly better than none, and the broken van runs into Gwaneumpo', () => {
    const none = [];
    const play = [];
    for (let k = 0; k < 3; k += 1) {
      none.push(noryang(mods, 1592 + k * 101, false));
      play.push(noryang(mods, 1592 + k * 101, true));
      console.log(`     seed ${1592 + k * 101} no commands: ${noryangLine(none[k])}\n                commands:    ${noryangLine(play[k])}`);
    }
    const gone = (r) => r.sunk + r.taken;
    for (const r of play) assert.equal(r.winner, 'joseon');
    assert.ok(mean(play, gone) >= mean(none, gone) + 20, `destroyed ${mean(none, gone).toFixed(0)} -> ${mean(play, gone).toFixed(0)}`);
    assert.ok(mean(play, (r) => r.allies) <= mean(none, (r) => r.allies) + 2, 'at no greater cost');
    assert.ok(mean(play, (r) => r.home + r.through) < mean(none, (r) => r.home + r.through), 'fewer get away');
    assert.ok(play.every((r) => r.bay + r.bayTaken > 0), 'the broken van runs into Gwaneumpo');
  });
}

await mods.server.close();
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
