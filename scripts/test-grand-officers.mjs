// The faction campaign's officers (src/sim/grand/officers.ts): the roster and its dates, lieutenants and their seats,
// the skill tree's rules, recruits, recommendations and men raised from the ranks, what the officers do to a settled
// fight, the 3D battle hand-off and the march, the migration of an old save, and determinism (the same seed and the same
// orders give the same save).
//   node scripts/test-grand-officers.mjs
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const server = await createServer({ root, configFile: false, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false }, optimizeDeps: { noDiscovery: true, include: [] } });
try {
  const turn = await server.ssrLoadModule('/src/sim/grand/turn.ts');
  const officers = await server.ssrLoadModule('/src/sim/grand/officers.ts');
  const effects = await server.ssrLoadModule('/src/sim/grand/officerEffects.ts');
  const data = await server.ssrLoadModule('/src/sim/grand/officerData.ts');
  const { autoResolve } = await server.ssrLoadModule('/src/sim/grand/autoresolve.ts');
  const { describeContact } = await server.ssrLoadModule('/src/sim/grand/bridge.ts');
  const { fleetReach } = await server.ssrLoadModule('/src/sim/grand/march.ts');
  const { migrateGrandOfficers } = await server.ssrLoadModule('/src/sim/grand/migration.ts');
  const { orderCommander, orderMerge } = await server.ssrLoadModule('/src/sim/grand/orders.ts');
  const { newGrand, endTurn, autoResolveContact } = turn;
  const { FIGURES, SKILLS, TRAITS, OFFICERS, BATTLE_ABILITY } = data;

  // The roster: many named figures per navy, each with a bio, an ability and real traits.
  {
    const per = (f) => FIGURES.filter((x) => x.faction === f).length;
    assert.ok(per('joseon') >= 25 && per('japan') >= 20 && per('ming') >= 12, `roster ${per('joseon')}/${per('japan')}/${per('ming')}`);
    const ids = new Set();
    for (const fig of FIGURES) {
      assert.ok(!ids.has(fig.id), `duplicate figure ${fig.id}`);
      ids.add(fig.id);
      assert.ok(fig.bio && fig.hanja && fig.ability.name && fig.ability.line, `${fig.id} is described`);
      for (const t of fig.traits) assert.ok(TRAITS.some((x) => x.id === t), `${fig.id}: trait ${t}`);
      if (fig.ability.battle) assert.ok(BATTLE_ABILITY[fig.ability.battle], `${fig.id}: battle ability ${fig.ability.battle}`);
    }
    const abilities = new Set(FIGURES.map((f) => f.ability.id));
    assert.equal(abilities.size, FIGURES.length, 'every figure has his own ability');
    for (const b of ['lead', 'war', 'admin']) for (let tier = 1; tier <= 5; tier += 1) assert.ok(SKILLS.some((s) => s.branch === b && s.tier === tier), `${b} tier ${tier}`);
  }

  // A new war: every commander carries an officer record, the start figures wait at a port, Joseon's cards are dealt.
  {
    const g = newGrand('joseon', 7);
    assert.ok(g.officers, 'board');
    for (const f of ['joseon', 'japan', 'ming']) for (const c of g.factions[f].commanders) assert.ok(c.officer, `${c.id} has an officer record`);
    assert.ok(g.factions.joseon.commanders.length >= 12, `Joseon starts with ${g.factions.joseon.commanders.length} officers`);
    assert.ok(g.factions.joseon.commanders.some((c) => c.id === 'eo' && c.officer.at), 'Eo Yeong-dam waits at a port');
    assert.ok(g.officers.offers.some((o) => o.kind === 'trust' && o.who === 'yi'), 'the court asks about Yi Sun-sin');
    assert.ok(g.officers.offers.some((o) => o.kind === 'recommend' && o.who === 'nadaeyong' && o.by === 'yi'), 'Yi recommends Na Dae-yong');
    assert.ok(!g.factions.ming.commanders.some((c) => c.id === 'chencan'), 'Chen Can is not there in 1592');
  }

  // Skills: one point per level, a node needs the tier below in its branch and the level of its tier.
  {
    const g = newGrand('joseon', 8);
    const yi = g.factions.joseon.commanders.find((c) => c.id === 'yi');
    assert.equal(officers.pointsOf(yi), 3);
    assert.ok(officers.skillProblem(yi, 'aim'), 'tier 2 needs tier 1');
    assert.ok(officers.orderSkill(g, 'joseon', 'yi', 'gunnery').ok);
    assert.ok(officers.orderSkill(g, 'joseon', 'yi', 'aim').ok);
    assert.ok(officers.orderSkill(g, 'joseon', 'yi', 'fireships').ok);
    assert.equal(officers.pointsOf(yi), 0);
    assert.ok(officers.skillProblem(yi, 'command'), 'no point left');
    yi.level = 4;
    assert.ok(officers.skillProblem(yi, 'victory'), 'tier 5 needs level 5');
  }

  // Lieutenants: seats grow with the commander's level, a full fleet refuses more, they go ashore with a lower commander.
  {
    const g = newGrand('joseon', 9);
    const fleet = g.fleets.find((f) => f.faction === 'joseon' && f.commanderId === 'yi');
    assert.ok(fleet, 'Yi leads a fleet');
    const yi = g.factions.joseon.commanders.find((c) => c.id === 'yi');
    assert.equal(effects.lieutenantSlots(yi), 2, 'level 3: two seats');
    const free = g.factions.joseon.commanders.filter((c) => !effects.postOf(g, c));
    assert.ok(officers.orderLieutenant(g, fleet.id, free[0].id, true).ok);
    assert.ok(officers.orderLieutenant(g, fleet.id, free[1].id, true).ok);
    assert.ok(!officers.orderLieutenant(g, fleet.id, free[2].id, true).ok, 'no third seat');
    const before = effects.fleetBonus(g, fleet);
    assert.ok(officers.orderSkill(g, 'joseon', free[0].id, 'gunnery').ok);
    const after = effects.fleetBonus(g, fleet);
    assert.ok(Math.abs(after.gun - before.gun - 0.03 * OFFICERS.lieutenantShare) < 1e-9, 'a lieutenant adds half his skill');
    // A commander who loses rank keeps only the seats he has: the second lieutenant goes ashore at the fleet's port.
    yi.level = 1;
    officers.fitLieutenants(g, fleet);
    assert.equal(fleet.lieutenants.length, 1);
    assert.equal(free[1].officer.at, fleet.at);
    // A lieutenant taken to command his own fleet leaves his seat.
    const other = g.fleets.find((f) => f.faction === 'joseon' && f.at === fleet.at && f !== fleet);
    if (other) {
      assert.ok(orderCommander(g, other.id, free[0].id).ok);
      assert.ok(!fleet.lieutenants.includes(free[0].id), 'promoted to command');
    }
  }

  // Effects: the settled fight, the 3D battle hand-off and the march read the officers.
  {
    const ship = (id, kind) => ({ id, kind, name: id, hull: 1, crew: 1, supply: 1, kills: 0 });
    const side = (p, bonus) => ({ ships: Array.from({ length: 8 }, (_, i) => ship(`${p}${i}`, 'panokseon')), leader: 1, bonus });
    let plain = 0;
    let led = 0;
    for (let s = 0; s < 60; s += 1) {
      if (autoResolve({ attacker: side('a'), defender: side('d'), seed: s, tags: [1] }).outcome.winner === 'attacker') plain += 1;
      if (autoResolve({ attacker: side('a', { power: 0.08, gun: 0.06, melee: 0, pursuit: 0 }), defender: side('d'), seed: s, tags: [1] }).outcome.winner === 'attacker') led += 1;
    }
    assert.ok(led > plain, `officers win more settled fights (${plain} -> ${led} of 60)`);

    const g = newGrand('joseon', 10);
    const fleet = g.fleets.find((f) => f.commanderId === 'yi');
    const reach0 = fleetReach(g, fleet);
    officers.orderSkill(g, 'joseon', 'yi', 'seamanship');
    assert.ok(fleetReach(g, fleet) > reach0, 'seamanship sails farther');
    const enemy = g.fleets.find((f) => f.faction === 'japan');
    const c = { id: 'x1', regionId: fleet.at, attacker: 'japan', defender: 'joseon', attackerFleets: [enemy.id], defenderFleets: [fleet.id], player: true };
    const rb = describeContact(g, c);
    const mine = rb.defender.ships.find((s) => s.fleetId === fleet.id);
    assert.ok(mine.mods.reload > 1 && mine.mods.accuracy > 1, 'the crane wing and his traits reach the 3D ships');
    assert.equal(rb.defender.leader.ability, 'crane_wing', 'Yi brings the crane wing into battle');
    for (const k of Object.keys(mine.mods)) assert.ok(mine.mods[k] < 1.6, `mod ${k} stays modest (${mine.mods[k]})`);
  }

  // Recruits, recommendations and a captain raised from the ranks.
  {
    const g = newGrand('joseon', 11);
    g.factions.joseon.gold = 5000;
    const offer = g.officers.offers.find((o) => o.who === 'nadaeyong');
    const n = g.factions.joseon.commanders.length;
    assert.ok(officers.answerOffer(g, offer.id, true).ok);
    assert.equal(g.factions.joseon.commanders.length, n + 1, 'Na Dae-yong joins');
    const trust = g.officers.offers.find((o) => o.kind === 'trust');
    const xp = g.factions.joseon.commanders.find((c) => c.id === 'yi').xp;
    officers.answerOffer(g, trust.id, true);
    assert.ok(g.factions.joseon.commanders.find((c) => c.id === 'yi').xp > xp, 'trusting Yi');
    // A declined recommendation of a named man leaves him among the recruits.
    const jeongun = g.officers.offers.find((o) => o.who === 'jeongun');
    if (jeongun) {
      officers.answerOffer(g, jeongun.id, false);
      assert.ok(g.officers.candidates.joseon.some((c) => c.officer.id === 'jeongun'), 'Jeong Un waits as a recruit');
    }
    const cand = g.officers.candidates.joseon[0];
    assert.ok(cand, 'the camps offer recruits');
    assert.ok(officers.orderHire(g, 'joseon', cand.id).ok);
    const fl = g.fleets.find((f) => f.faction === 'joseon' && f.at);
    fl.ships[0].kills = 7;
    const before = g.factions.joseon.commanders.length;
    assert.ok(officers.orderPromote(g, fl.id, fl.ships[0].id).ok);
    const raised = g.factions.joseon.commanders[before];
    assert.equal(raised.officer.origin, 'ranks');
    assert.ok(raised.level >= 2 && raised.officer.traits.includes('veteran') && raised.officer.nameEn, 'a veteran captain with a name');
    assert.equal(fl.ships[0].kills, 3, 'he takes half the tally');
    // Na Dae-yong at a port makes turtle ships cheaper there.
    const nd = g.factions.joseon.commanders.find((c) => c.id === 'nadaeyong');
    assert.ok(effects.shipPriceCut(g, nd.officer.at, 'geobukseon') > 0, 'turtle ships are cheaper where Na Dae-yong is');
  }

  // Battles: experience for the commander and his lieutenants, a fleet destroyed sends its officers ashore.
  {
    const g = newGrand('joseon', 12);
    const fleet = g.fleets.find((f) => f.commanderId === 'yi');
    const lt = g.factions.joseon.commanders.find((c) => !effects.postOf(g, c));
    officers.orderLieutenant(g, fleet.id, lt.id, true);
    const xp0 = lt.xp;
    officers.officersAfterBattle(g, [fleet], { sizes: new Map([[fleet.id, fleet.ships.length]]), kills: new Map([[fleet.id, 3]]), winners: [fleet], grade: 'clear' });
    assert.ok(lt.xp > xp0, 'the lieutenant learns');
    assert.equal(lt.officer.record.battles, 1);
    const gone = g.fleets.find((f) => f.faction === 'joseon' && f.commanderId && f !== fleet);
    const cmd = g.factions.joseon.commanders.find((c) => c.id === gone.commanderId);
    const size = gone.ships.length;
    gone.ships = [];
    officers.officersAfterBattle(g, [gone], { sizes: new Map([[gone.id, size]]), kills: new Map(), winners: [], grade: 'decisive' });
    assert.ok(!cmd.alive || cmd.officer.captive > 0 || cmd.officer.at, 'a commander whose fleet is lost dies, is taken or goes ashore');
  }

  // An old save without officers gets them on load and goes on.
  {
    const g = newGrand('joseon', 13);
    delete g.officers;
    for (const f of ['joseon', 'japan', 'ming']) {
      g.factions[f].commanders = g.factions[f].commanders.filter((c) => ['yi', 'won', 'eokgi', 'kwon', 'wakisaka', 'kuki', 'kato', 'kurushima', 'chenlin', 'deng'].includes(c.id));
      for (const c of g.factions[f].commanders) delete c.officer;
    }
    for (const fl of g.fleets) delete fl.lieutenants;
    g.events.pending = null;
    assert.ok(migrateGrandOfficers(g));
    assert.ok(!migrateGrandOfficers(g), 'once');
    assert.ok(g.factions.joseon.commanders.every((c) => c.officer));
    endTurn(g);
    for (const c of [...g.pending]) autoResolveContact(g, c.id);
    assert.ok(g.turn >= 2, 'the war goes on');
  }

  // Determinism: the same seed and the same orders give the same save, through recruits, battles and dates.
  {
    const play = (seed) => {
      const g = newGrand('joseon', seed);
      for (let t = 0; t < 30 && g.phase !== 'over'; t += 1) {
        for (const o of [...(g.officers?.offers ?? [])]) officers.answerOffer(g, o.id, true);
        for (const c of g.factions.joseon.commanders) for (const s of SKILLS) if (c.alive && !officers.skillProblem(c, s.id)) officers.orderSkill(g, 'joseon', c.id, s.id);
        const cand = g.officers.candidates.joseon[0];
        if (cand) officers.orderHire(g, 'joseon', cand.id);
        const vet = officers.promotable(g, 'joseon')[0];
        if (vet) officers.orderPromote(g, vet.fleet.id, vet.shipId);
        for (const fl of g.fleets.filter((f) => f.faction === 'joseon' && f.at && f.commanderId)) {
          const free = g.factions.joseon.commanders.find((c) => c.alive && effects.officerReady(c) && !effects.postOf(g, c));
          if (free) officers.orderLieutenant(g, fl.id, free.id, true);
        }
        g.events.pending = null;
        endTurn(g);
        for (const c of [...g.pending]) autoResolveContact(g, c.id);
      }
      return g;
    };
    const a = play(1597);
    const b = play(1597);
    assert.equal(JSON.stringify(a), JSON.stringify(b), 'same seed, same orders, same save');
    const all = (g) => ['joseon', 'japan', 'ming'].reduce((n, f) => n + g.factions[f].commanders.length, 0);
    assert.ok(all(a) > 40, `the war fills with officers (${all(a)})`);
    assert.ok(a.factions.joseon.commanders.some((c) => c.officer.record.battles > 0), 'officers fight');
    // Dates: by 1598 the Ming navy has its admirals of that year.
    const late = play(1598);
    if (late.turn >= 25 && late.factions.ming.alive) assert.ok(late.factions.ming.commanders.some((c) => c.id === 'chencan'), 'Chen Can arrives in 1598');
    // Computer navies use the system: points spent, lieutenants seated.
    const cpu = newGrand(null, 77);
    for (let t = 0; t < 12; t += 1) endTurn(cpu);
    for (const f of ['japan', 'ming']) {
      assert.ok(cpu.factions[f].commanders.some((c) => c.officer.skills.length > 0), `${f} spends points`);
    }
    assert.ok(cpu.fleets.some((f) => f.lieutenants?.length), 'computer fleets have lieutenants');
  }
  // A merge hands the second fleet's lieutenants to the survivor as far as the seats go.
  {
    const g = newGrand('joseon', 14);
    const [a, b] = g.fleets.filter((f) => f.faction === 'joseon' && f.at === g.fleets.find((x) => x.commanderId === 'yi').at);
    if (a && b) {
      const res = orderMerge(g, a.id, b.id);
      if (res.ok) assert.ok((a.lieutenants?.length ?? 0) <= 3);
    }
  }
  console.log('grand officers: ok');
} finally {
  await server.close();
}
