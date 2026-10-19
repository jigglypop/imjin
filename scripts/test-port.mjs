// Regression checks for the home port (본진, src/meta/port.ts): building levels and their prerequisites, the shipyard's
// unlocks, the arsenal's discount, the fortress's reward bonus, the stored levels surviving normalizeProfile, the route
// and the English of every rule message.
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
  const P = await load('/src/meta/port.ts');
  const D = await load('/src/meta/portDefs.ts');
  const { RANKED_ROSTER, ROSTER } = await load('/src/sim/conquest.ts');
  const { shipPoints } = await load('/src/sim/points.ts');
  const routes = await load('/src/routes.ts');
  const { EN } = await load('/src/i18n/en/index.ts');
  const navy = (nation = 'joseon', coins = 100000) => ({ ...F.chooseNation({ ...R.newProfile(), coins }, nation) });

  check('a new port starts with the shipyard at 1 and nothing else built', () => {
    const p = navy();
    assert.deepEqual(p.port, {});
    assert.equal(D.buildingLevel(p.port, 'shipyard'), 1);
    assert.equal(D.buildingLevel(p.port, 'arsenal'), 0);
    assert.equal(D.buildingLevel(p.port, 'fortress'), 0);
  });

  check('upgrading costs the next level and raises it by one; the top level refuses', () => {
    let p = navy();
    p = P.upgrade(p, 'arsenal');
    assert.equal(p.coins, 100000 - D.BUILDINGS.arsenal.cost[1]);
    assert.equal(p.port.arsenal, 1);
    p = P.upgrade(P.upgrade(p, 'arsenal'), 'arsenal');
    assert.equal(P.upgradeCost(p, 'arsenal'), null);
    assert.equal(P.upgradeProblem(p, 'arsenal'), '이미 가장 높은 레벨입니다');
    assert.throws(() => P.upgrade(p, 'arsenal'), R.RuleError);
  });

  check('prerequisites: shipyard 2 needs arsenal 1, fortress 2 needs shipyard 2', () => {
    let p = navy();
    assert.equal(P.upgradeProblem(p, 'shipyard'), '병기창 1레벨이 필요합니다');
    p = P.upgrade(p, 'arsenal');
    assert.equal(P.upgradeProblem(p, 'shipyard'), null);
    p = P.upgrade(p, 'fortress');
    assert.equal(P.upgradeProblem(p, 'fortress'), '조선소 2레벨이 필요합니다');
    p = P.upgrade(p, 'shipyard');
    assert.equal(P.upgradeProblem(p, 'fortress'), null);
  });

  check('refusals: no nation, unknown building, too few coins', () => {
    assert.equal(P.upgradeProblem(R.newProfile(), 'arsenal'), '먼저 나라를 고르세요');
    assert.equal(P.upgradeProblem(navy(), 'castle'), '없는 건물입니다');
    assert.equal(P.upgradeProblem(navy(), 'toString'), '없는 건물입니다');
    assert.equal(P.upgradeProblem(navy('joseon', 10), 'arsenal'), '엽전이 모자랍니다');
  });

  check('the shipyard unlocks every navy\'s roster in three steps, the ranked roster at once', () => {
    for (const [nation, kinds] of Object.entries(ROSTER)) {
      const top = Math.max(...RANKED_ROSTER[nation].map(shipPoints));
      for (const k of kinds) {
        const need = P.shipyardNeeded(nation, k);
        if (RANKED_ROSTER[nation].includes(k)) assert.equal(need, 1, k);
        else assert.equal(need, shipPoints(k) <= top ? 2 : 3, k);
      }
    }
    let p = navy();
    const locked = ROSTER.joseon.filter((k) => P.shipyardNeeded('joseon', k) > 1);
    assert.ok(locked.length > 0);
    for (const k of locked) assert.match(F.buyShipProblem(p, k), /^조선소 \d레벨이 필요합니다$/);
    p = P.upgrade(P.upgrade(P.upgrade(P.upgrade(p, 'arsenal'), 'shipyard'), 'arsenal'), 'shipyard');
    for (const k of locked) assert.equal(F.buyShipProblem(p, k), null, k);
  });

  check('the arsenal takes 5% off a hull per level, and buying pays that price', () => {
    let p = navy();
    const full = shipPoints('panokseon');
    assert.equal(P.shipCost(p, 'panokseon'), full);
    p = P.upgrade(P.upgrade(p, 'arsenal'), 'arsenal');
    assert.equal(P.shipCost(p, 'panokseon'), Math.round(full * 0.9));
    const before = p.coins;
    const q = F.buyShip(p, 'panokseon', 2);
    assert.equal(q.coins, before - 2 * Math.round(full * 0.9));
    assert.equal(q.ships.panokseon, (p.ships.panokseon ?? 0) + 2);
  });

  check('the fortress raises a battle\'s coins by 10% per level, not the first-win bonus', () => {
    const report = { mode: 'history', scenario: 'hansan', side: 'joseon', result: 'win', stars: 1, sunk: 10, lost: 0, simSeconds: 600, generals: [] };
    const base = navy();
    const plain = R.rewardFor({ ...base, firsts: ['win:history:hansan:joseon'] }, report, '2026-10-19', true).reward.coins;
    let p = P.upgrade(P.upgrade(P.upgrade(base, 'fortress'), 'arsenal'), 'shipyard');
    p = P.upgrade(p, 'fortress');
    const raised = R.rewardFor({ ...p, firsts: ['win:history:hansan:joseon'] }, report, '2026-10-19', true).reward.coins;
    assert.equal(raised, Math.round(plain * 1.2));
    const loss = R.rewardFor(base, { ...report, result: 'loss' }, '2026-10-19', true).reward.coins;
    assert.ok(loss < plain, 'a loss pays less than a win');
  });

  check('levels survive normalizeProfile, clamped to each building\'s range', () => {
    const p = P.upgrade(navy(), 'arsenal');
    assert.deepEqual(R.normalizeProfile(JSON.parse(JSON.stringify(p))).port, { arsenal: 1 });
    assert.deepEqual(R.normalizeProfile({ ...p, port: { arsenal: 99, shipyard: -4, fortress: 'x', moat: 2 } }).port, { arsenal: 3 });
  });

  check('the port has its own address in both editions', () => {
    assert.equal(routes.routePath('port', 'ko'), '/port');
    assert.equal(routes.routePath('port', 'en'), '/en/port');
    assert.equal(routes.parseRoute('/en/port').screen, 'port');
  });

  check('every building and rule message of the port has English', () => {
    const msgs = ['본진', '없는 건물입니다', '이미 가장 높은 레벨입니다', ...Object.values(D.BUILDINGS).flatMap((b) => [b.name, b.line])];
    for (const n of Object.keys(ROSTER)) for (const k of ROSTER[n]) msgs.push(`조선소 ${P.shipyardNeeded(n, k)}레벨이 필요합니다`);
    for (const id of D.BUILDING_IDS) for (let l = 0; l <= D.BUILDINGS[id].max; l++) { const m = P.upgradeProblem({ ...navy(), port: { [id]: l } }, id); if (m && m !== '엽전이 모자랍니다') msgs.push(m); }
    for (const m of msgs) assert.ok(EN[m], m);
  });
} finally {
  await server.close();
}
if (failed) { console.error(`${failed} failed`); process.exit(1); }
console.log('all passed');
