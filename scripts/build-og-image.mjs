// Renders the link-preview image (Open Graph, used by KakaoTalk, iMessage, Slack, X...) from the title screen:
// public/og.jpg, 1200x630, the wordmark over the menu art with the mode cards hidden. Rerun after changing the title.
//   node scripts/build-og-image.mjs [--url=http://127.0.0.1:5291/]
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, '').split('=');
    return [k, v.join('=') || 'true'];
  }),
);
const ROOT = new URL('..', import.meta.url).pathname;
const base = args.url ?? 'http://127.0.0.1:5291/';
const png = join(ROOT, 'shots', 'og.png');
const out = join(ROOT, 'public', 'og.jpg');

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 2 });
await page.goto(`${base}?lang=ko`, { waitUntil: 'networkidle' });
await page.waitForSelector('.wordmark-title');
await page.evaluate(() => document.fonts.ready);
// A preview is a card, not the menu: no buttons, the wordmark centred, one line of where to play it.
await page.addStyleTag({
  content: `.mode-grid, .screen-top { display: none !important; }
    .menu-inner { justify-content: center !important; padding-top: 0 !important; }
    .wordmark-title { font-size: 104px !important; }
    .wordmark-kicker { font-size: 15px !important; }
    .wordmark-en { font-size: 14px !important; }
    .og-line { align-self: center; text-align: center; margin-top: 30px; font-size: 19px; font-weight: 500; letter-spacing: 0.06em; color: var(--ink-2);
      text-shadow: 0 1px 12px rgba(4, 8, 14, 0.85); }`,
});
await page.evaluate(() => {
  const line = document.createElement('div');
  line.className = 'og-line';
  line.textContent = '브라우저에서 바로 플레이 · imjin1592.com';
  document.querySelector('.wordmark')?.after(line);
});
await page.waitForTimeout(600);
await page.screenshot({ path: png });
await browser.close();
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', png, '-vf', 'scale=1200:630:flags=lanczos', '-q:v', '3', out]);
console.log(`wrote ${out}`);
