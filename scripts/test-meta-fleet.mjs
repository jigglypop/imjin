// Regression checks for the account's own navy (src/meta/fleet.ts): the nation pick and its one change, admirals taken
// into service, hulls owned by kind, the conquest muster cap, the stored shape surviving normalizeProfile, the 제독
// naming and the /admirals alias.
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
  const R = await load('/src/meta/rules.ts');
  const F = await load('/src/meta/fleet.ts');
  const C = await load('/src/meta/catalog.ts');
  const { MUSTER_BUDGET } = await load('/src/sim/maps.ts');
  const { ROSTER } = await load('/src/sim/conquest.ts');
  const routes = await load('/src/routes.ts');
  const { EN } = await load('/src/i18n/en/index.ts');
  const rich = () => ({ ...R.newProfile(), coins: 100000 });

  check('every 1592 navy can be chosen, starts with its famous admirals and a full conquest muster of its own roster', () => {
    for (const n of F.NATIONS) {
      const p = F.chooseNation(rich(), n.id);
      assert.equal(p.nation, n.id);
      assert.deepEqual(p.recruited, C.GENERALS.filter((g) => g.faction === n.id && g.famous).map((g) => g.id).sort());
      const value = F.fleetValue(p);
      assert.ok(value > MUSTER_BUDGET * 0.85 && value <= MUSTER_BUDGET, `${n.id} fleet ${value}`);
      for (const k of Object.keys(p.ships)) assert.ok(ROSTER[n.id].includes(k), k);
      assert.equal(p.coins, 100000, 'the first choice is free');
    }
  });

  check('a nation can be changed exactly once: old hulls sold back at half, old admirals kept but out of service', () => {
    let p = F.chooseNation(rich(), 'joseon');
    p = F.recruit(p, 'kwon');
    p = R.learn({ ...p, generals: { ...p.generals, yi: { xp: 600, talents: {} } } }, 'yi', 'gunnery.rapid');
    const value = F.fleetValue(p);
    const q = F.chooseNation(p, 'ming');
    assert.equal(q.coins, p.coins + Math.floor(value * F.SELLBACK));
    assert.deepEqual(q.generals.yi, p.generals.yi, 'levels and talents stay');
    assert.equal(R.serviceProblem(q, 'yi'), '다른 나라의 제독입니다');
    assert.equal(R.serviceProblem(q, 'chenlin'), null);
    assert.equal(F.nationProblem(q, 'japan'), '나라는 한 번만 바꿀 수 있습니다');
    assert.equal(F.nationProblem(q, 'ming'), '이미 섬기는 나라입니다');
    assert.throws(() => F.chooseNation(q, 'japan'), R.RuleError);
  });

  check('recruiting and building pay coins and follow the navy', () => {
    const p = F.chooseNation({ ...R.newProfile(), coins: F.RECRUIT_PRICE + F.shipPrice('panokseon') }, 'joseon');
    assert.equal(F.recruitProblem(p, 'yi'), '이미 맞이한 제독입니다');
    assert.equal(F.recruitProblem(p, 'wakisaka'), '다른 나라의 제독입니다');
    assert.equal(R.learnProblem(p, 'kwon', 'gunnery.rapid'), '아직 맞이하지 않은 제독입니다');
    const q = F.recruit(p, 'kwon');
    assert.equal(q.coins, F.shipPrice('panokseon'));
    assert.equal(F.buyShipProblem(q, 'atakebune'), '이 나라가 지을 수 없는 배입니다');
    assert.equal(F.buyShipProblem(q, 'panokseon', 2), '엽전이 모자랍니다');
    assert.equal(F.buyShipProblem(q, 'panokseon', 0), '한 번에 1~10척을 지을 수 있습니다');
    const r = F.buyShip(q, 'panokseon');
    assert.equal(r.ships.panokseon, (q.ships.panokseon ?? 0) + 1);
    assert.equal(r.coins, 0);
    assert.equal(F.buyShipProblem({ ...r, coins: 1e9, ships: { ...r.ships, panokseon: R.MAX_SHIPS_PER_KIND } }, 'panokseon'), `한 종류는 ${R.MAX_SHIPS_PER_KIND}척까지 가질 수 있습니다`);
  });

  check('a profile without a nation keeps every general open (older accounts) and asks to choose first', () => {
    const p = rich();
    assert.equal(R.serviceProblem(p, 'kwon'), null);
    assert.equal(F.recruitProblem(p, 'kwon'), '먼저 나라를 고르세요');
    assert.equal(F.buyShipProblem(p, 'panokseon'), '먼저 나라를 고르세요');
  });

  check('the stored navy survives normalizeProfile, and forged shapes are cleaned', () => {
    const p = F.buyShip(F.recruit(F.chooseNation(rich(), 'japan'), 'kurushima'), 'kobaya', 3);
    const back = R.normalizeProfile(JSON.parse(JSON.stringify(p)));
    for (const k of ['nation', 'nationChanges', 'recruited', 'ships']) assert.deepEqual(back[k], p[k], k);
    const forged = R.normalizeProfile({ nation: 'atlantis', recruited: ['nobody', 'yi', 'yi'], ships: { panokseon: 5 } });
    assert.equal(forged.nation, null);
    assert.deepEqual(forged.recruited, ['yi']);
    assert.deepEqual(forged.ships, {}, 'no hulls without a navy');
    const wrong = R.normalizeProfile({ nation: 'joseon', ships: { atakebune: 4, panokseon: -2, geobukseon: 1e9, hyeopseon: 2.7 } });
    assert.deepEqual(wrong.ships, { geobukseon: R.MAX_SHIPS_PER_KIND, hyeopseon: 2 });
  });

  check('the conquest muster is capped by owned hulls only for the account navy', () => {
    const p = F.chooseNation(rich(), 'joseon');
    assert.equal(F.musterCap(p, 'joseon', 'panokseon'), p.ships.panokseon ?? 0);
    assert.equal(F.musterCap(p, 'joseon', 'sahuseon'), p.ships.sahuseon ?? 0);
    assert.equal(F.musterCap(p, 'japan', 'atakebune'), null);
    assert.equal(F.musterCap(rich(), 'joseon', 'panokseon'), null);
  });

  check('the screen is named 제독; /generals stays and /admirals opens it in both editions', () => {
    assert.equal(routes.routeName('generals'), '제독');
    assert.equal(routes.routePath('generals', 'ko'), '/generals');
    for (const path of ['/admirals', '/en/admirals', '/generals', '/en/generals']) {
      const r = routes.parseRoute(path);
      assert.equal(r.screen, 'generals', path);
      assert.equal(r.known, true, path);
    }
  });

  check('every rule message of the navy has English', () => {
    const msgs = [
      F.nationProblem(rich(), 'x'), F.recruitProblem(rich(), 'yi'), F.buyShipProblem(rich(), 'panokseon'),
      '다른 나라의 제독입니다', '아직 맞이하지 않은 제독입니다', '이미 맞이한 제독입니다', '이미 섬기는 나라입니다', '나라는 한 번만 바꿀 수 있습니다',
      '이 나라가 지을 수 없는 배입니다', '한 번에 1~10척을 지을 수 있습니다', `한 종류는 ${R.MAX_SHIPS_PER_KIND}척까지 가질 수 있습니다`, '없는 제독입니다',
      ...F.NATIONS.flatMap((n) => [n.name, n.line]),
    ];
    for (const m of msgs) assert.ok(EN[m], m);
  });
} finally {
  await server.close();
}
if (failed) { console.error(`${failed} failed`); process.exit(1); }
console.log('all passed');
