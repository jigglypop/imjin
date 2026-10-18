// The main menu's first-paint pictures, one per chapter: stills of the chapter's own live menu scene (src/ui/menuBattleScene.ts)
// with every piece of UI hidden, so the poster the page shows at once and the 3D scene that cross-fades in over it show
// the same flagship in the same light and framing.
//   node scripts/build-menu-splash.mjs [--only=imjin,armada] [--url=http://127.0.0.1:5291] [--at=6]
// writes public/ui/art/menu_battle[_<chapter>]_wide.webp (1920x1080) and _tall.webp (390x844 at 2x), and records them
// in scripts/menu-art-provenance.json under "splash".
import { chromium } from 'playwright-core';
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, '').split('=');
    return [k, v.join('=') || 'true'];
  }),
);
const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const ART = join(ROOT, 'public', 'ui', 'art');
const PROVENANCE = join(ROOT, 'scripts', 'menu-art-provenance.json');
const base = (args.url ?? 'http://127.0.0.1:5291').replace(/\/$/, '');
const chapters = (args.only ?? 'imjin,armada,lepanto,trafalgar').split(',');
/** Seconds of the scene after it is ready: the guns have opened and the smoke stands in the air. */
const at = Number(args.at ?? 6);
const FORMATS = [
  { name: 'wide', viewport: { width: 1920, height: 1080 }, scale: 1, quality: 86 },
  { name: 'tall', viewport: { width: 390, height: 844 }, scale: 2, quality: 84 },
];

const browser = await chromium.launch({
  channel: process.platform === 'win32' ? 'msedge' : 'chrome',
  headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', process.platform === 'win32' ? '--use-angle=d3d11' : '--use-angle=metal'],
});
const record = [];
try {
  for (const chapter of chapters) {
    for (const f of FORMATS) {
      const page = await browser.newPage({ viewport: f.viewport, deviceScaleFactor: f.scale });
      const path = chapter === 'imjin' ? '/' : `/${chapter}`;
      await page.goto(`${base}${path}?menuqa=1`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.menu-battle--ready', { timeout: 180000 });
      await page.waitForFunction((s) => (window.__menuScene?.info().elapsed ?? 0) >= s, at, { timeout: 120000 });
      // Only the canvas paints: hidden elements draw neither their text nor their backgrounds.
      await page.addStyleTag({ content: '* { visibility: hidden !important; } .menu-battle, .menu-battle * { visibility: visible !important; } .menu-battle { opacity: 1 !important; transition: none !important; }' });
      await page.waitForTimeout(300);
      const png = await page.screenshot({ type: 'png' });
      const info = await page.evaluate(() => window.__menuScene.info());
      const file = join(ART, `${chapter === 'imjin' ? 'menu_battle' : `menu_battle_${chapter}`}_${f.name}.webp`);
      await sharp(png).webp({ quality: f.quality, effort: 6 }).toFile(file);
      record.push({ chapter, file: file.slice(ROOT.length + 1).replace(/\\/g, '/'), size: [f.viewport.width * f.scale, f.viewport.height * f.scale], elapsed: +info.elapsed.toFixed(2), shots: info.shots, backend: info.backend, sha256: createHash('sha256').update(readFileSync(file)).digest('hex') });
      console.log(`${chapter} ${f.name}: ${file}`);
      await page.close();
    }
  }
} finally {
  await browser.close();
}
const provenance = JSON.parse(readFileSync(PROVENANCE, 'utf8'));
const keep = (provenance.splash ?? []).filter((r) => !chapters.includes(r.chapter));
provenance.splash = [...keep, ...record].map((r) => ({ ...r, captured: r.captured ?? new Date().toISOString().slice(0, 10), renderer: 'the game itself (src/ui/menuBattleScene.ts), UI hidden; no image generation' }));
writeFileSync(PROVENANCE, `${JSON.stringify(provenance, null, 2)}\n`);
