// Browser regression: current campaign controls, casualties, total-wipe recovery and a second launch.
// Start npm run preview -- --host 127.0.0.1 --port 5291, then node scripts/test-campaign.mjs.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Browsers, fatalProblems, openPage, parseArgs } from './e2e/util.mjs';

const args = parseArgs(process.argv.slice(2));
const base = args.url ?? 'http://127.0.0.1:5291';
const out = args.out ?? fileURLToPath(new URL('../shots/campaign-regression/', import.meta.url));
await mkdir(out, { recursive: true });
const browsers = new Browsers(args);
const results = [];
let session;
try {
  session = await openPage(browsers, 'chrome', { width: 1440, height: 900 }, null, new URL('/?lang=ko&map=static&paused=1', base).toString());
  const { page } = session;
  const campaign = () => page.evaluate(() => JSON.parse(localStorage.getItem('imjin.campaign.v1')));
  const count = c => c.squads.reduce((n, q) => n + q.ships.length, 0);
  await page.locator('.mode-card').filter({ hasText: '역사 전투' }).click();
  await page.getByRole('tab', { name: '연속 전투', exact: true }).click();
  const initial = await campaign();
  assert.equal(initial.step, 0);
  assert.equal(count(initial), 43);
  await page.getByRole('button', { name: '군영', exact: true }).click();
  await page.locator('.camp-build').getByRole('button', { name: /^판옥선 건조/ }).click();
  assert.equal(count(await campaign()), 44, 'actual build button adds a ship');
  await page.screenshot({ path: join(out, 'camp-build.png') });
  await page.locator('.camp-head').getByRole('button', { name: '닫기' }).click();
  await page.locator('.select-foot').getByRole('button', { name: '전투 시작', exact: true }).click();
  await page.waitForFunction(() => window.__ready === true, null, { timeout: Number(args['ready-timeout'] ?? 150000) });
  const fleet = await page.evaluate(() => {
    const engine = window.__engine;
    return engine.battle.ships.filter(s => s.team === engine.team).map(s => ({ crew: s.crew, roles: s.roles.reduce((a, b) => a + b, 0) }));
  });
  assert.equal(fleet.length, 44);
  assert.ok(fleet.every(s => Math.abs(s.crew - s.roles) < 1e-6));
  // Keep the fixture deterministic: wipe only the campaign ships, then use the real withdrawal/report flow.
  await page.evaluate(() => {
    const engine = window.__engine;
    for (const s of engine.battle.ships) if (s.team === engine.team) s.alive = false;
    engine.endBattle();
  });
  await page.locator('.result--loss').waitFor();
  await page.locator('.result').evaluate(async el => { await Promise.all(el.getAnimations().map(a => a.finished)); });
  const wiped = await campaign();
  assert.equal(count(wiped), 0);
  assert.equal(wiped.step, 0, 'a loss keeps the current battle retryable');
  assert.equal(wiped.history.at(-1).lost, 44);
  await page.screenshot({ path: join(out, 'camp-total-wipe.png') });
  await page.locator('.result-actions').getByRole('button', { name: '군영으로', exact: true }).click();
  await page.getByRole('button', { name: '군영', exact: true }).click();
  await page.locator('.camp-build').getByRole('button', { name: /^협선 건조/ }).click();
  const recovered = await campaign();
  assert.equal(count(recovered), 1, 'empty fleet can recover through the actual build button');
  assert.equal(recovered.resources.timber, wiped.resources.timber - 8);
  assert.equal(recovered.resources.grain, wiped.resources.grain - 6);
  assert.equal(recovered.resources.powder, wiped.resources.powder - 1);
  await page.screenshot({ path: join(out, 'camp-recovered.png') });
  await page.locator('.camp-head').getByRole('button', { name: '닫기' }).click();
  await page.locator('.select-foot').getByRole('button', { name: '전투 시작', exact: true }).click();
  await page.waitForFunction(() => {
    const e = window.__engine;
    return e?.ready && !e.battle.ended && e.battle.ships.filter(s => s.team === e.team).length === 1;
  }, null, { timeout: 150000 });
  await page.locator('.hud').waitFor();
  assert.equal(await page.locator('.result').count(), 0, 'previous result is cleared on retry');
  await page.screenshot({ path: join(out, 'camp-retry.png') });
  // The simulation regression checks tie rules; here the real result state drives the neutral HUD.
  await page.evaluate(() => { window.__engine.battle.draw = true; });
  await page.locator('.result--draw .result-title').waitFor();
  assert.equal(await page.locator('.result--draw .result-title').textContent(), '무승부');
  const drawn = await campaign();
  assert.equal(drawn.history.at(-1).draw, true);
  assert.equal(drawn.history.at(-1).win, false);
  assert.ok((await page.locator('.result-camp').textContent()).includes('무승부입니다.'));
  assert.ok(!(await page.locator('.result-camp').textContent()).includes('패전했습니다.'));
  await page.locator('.result').evaluate(async el => { await Promise.all(el.getAnimations().map(a => a.finished)); });
  await page.screenshot({ path: join(out, 'draw-result.png') });
  await page.locator('.result-actions').getByRole('button', { name: '군영으로', exact: true }).click();
  await page.getByRole('img', { name: '무승부', exact: true }).waitFor();
  assert.deepEqual(fatalProblems(session.problems), []);
  results.push({ status: 'PASS', built: 44, lost: 44, recovered: 1, retry: true, drawResult: true, problems: session.problems });
  console.log('PASS campaign UI: build -> launch -> total wipe -> report -> rebuild -> retry; neutral draw result');
} catch (error) {
  results.push({ status: 'FAIL', error: String(error.stack ?? error), problems: session?.problems });
  console.error(error);
  process.exitCode = 1;
} finally {
  await session?.close();
  await browsers.closeAll();
  await writeFile(join(out, 'report.json'), JSON.stringify(results, null, 2));
}
