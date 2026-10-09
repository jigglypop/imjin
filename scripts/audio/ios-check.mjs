// The iPhone path of the sound: on iOS the sample bank decodes only once the first battle is ready (allowSamples), the
// context starts from a tap, and a phone keeps two files per kind and no drums. Runs the real page in WebKit with the
// iPhone 15 Pro emulation and prints what is loaded when, so a regression to the synthesised fallback shows.
//   node scripts/audio/ios-check.mjs [--url=http://127.0.0.1:5291/?scenario=hansan]
import { webkit, devices } from 'playwright-core';

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.join('=') || 'true']; }));
const url = args.url ?? 'http://127.0.0.1:5291/?scenario=hansan';
const browser = await webkit.launch({ headless: true });
const ctx = await browser.newContext({ ...devices['iPhone 15 Pro'] });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
const t0 = Date.now();
const secs = () => ((Date.now() - t0) / 1000).toFixed(1);
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
console.log(`battle ready at ${secs()}s`);

const state = () =>
  page.evaluate(() => {
    const s = window.__engine.sound;
    const samples = s.field?.samples;
    const kinds = ['cannon_heavy', 'cannon_medium', 'cannon_small', 'broadside', 'splash', 'impact_wood', 'whoosh', 'sink', 'drum'];
    return {
      isIOS: /iPhone|iPad|iPod/i.test(navigator.userAgent),
      ctx: s.ctx ? s.ctx.state : 'none (no gesture yet)',
      samplesAllowed: s.samplesAllowed,
      requested: s.samplesRequested,
      loaded: samples ? Object.fromEntries(kinds.map((k) => [k, samples.buffers[k]?.length ?? 0])) : null,
    };
  });
console.log('before a tap:', JSON.stringify(await state()));
await page.touchscreen.tap(6, 6);
await page.waitForTimeout(600);
console.log('after a tap :', JSON.stringify(await state()));
let ok = false;
for (let i = 0; i < 60; i += 1) {
  const s = await state();
  if (s.loaded?.cannon_heavy) {
    console.log(`bank decoded at ${secs()}s:`, JSON.stringify(s));
    ok = !!s.loaded.broadside && !!s.loaded.splash && !s.loaded.drum;
    break;
  }
  await page.waitForTimeout(1000);
}
await page.evaluate(() => window.__engine.sound.click());
console.log(ok ? 'PASS: samples decoded after the first battle was ready, lean bank (no drums)' : 'FAIL: the bank did not decode (the game would stay on the synthesised guns)');
await browser.close();
process.exit(ok ? 0 : 1);
