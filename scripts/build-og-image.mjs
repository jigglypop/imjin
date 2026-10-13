// The link-preview cards (Open Graph and X, used by KakaoTalk, iMessage, Slack, Discord...): the game's turtle ship
// at sunset, captured in the game's own renderer, with the menu's wordmark beside it.
//   node scripts/build-og-image.mjs --capture [--url=http://127.0.0.1:5291/]   renders the still into assets-src
//   node scripts/build-og-image.mjs                                            composes public/og-geobukseon.jpg and -en.jpg
// The capture needs a dev server and a WebGPU browser; composing needs neither. The card names change with the picture
// so link-preview caches (KakaoTalk keeps one for days) fetch the new image: rename them, and the tags in index.html
// and vite.config.ts, if the picture changes again.
import { chromium } from 'playwright-core';
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, '').split('=');
    return [k, v.join('=') || 'true'];
  }),
);
const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const SOURCE_DIR = join(ROOT, 'assets-src', 'og-geobukseon-2026-10-14');
const STILL = join(SOURCE_DIR, 'geobukseon-sunset.jpg');
const W = 1200;
const H = 630;

const launch = () =>
  chromium.launch({
    channel: process.platform === 'win32' ? 'msedge' : 'chrome',
    headless: true,
    args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', process.platform === 'win32' ? '--use-angle=d3d11' : '--use-angle=metal'],
  });

/**
 * Hansan at sunset, paused before the first shot. The three turtle ships are turned so the low sun falls on the side
 * the camera sees from behind its right shoulder, which lights the dragon head and puts the warm sky behind the ship;
 * the camera sits just above the waves off the port bow with a 32 degree lens, the ship on the right of the frame.
 */
const POSE = { stage: 2.4, yaw: -0.6, pitch: 0.05, distance: 60, ahead: 10, shift: -9, fov: 32 };

async function capture() {
  const base = args.url ?? 'http://127.0.0.1:5291/';
  const url = `${base}?scenario=hansan&hud=0&lv=4&q=high&dpr=2&paused=1&sky=sunset&clouds=0`;
  const browser = await launch();
  try {
    const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 240000 });
    const scene = await page.evaluate((p) => {
      const e = window.__engine;
      e.paused = true;
      e.fastForward = false;
      e.autoFast = false;
      e.showLabels = false;
      e.rts.followId = 0;
      e.rts.cinematic = false;
      const sun = e.sun.position;
      const aim = e.sun.target.position;
      const sunAz = Math.atan2(sun.z - aim.z, sun.x - aim.x);
      const turtles = e.battle.ships.filter((s) => s.spec.kind === 'geobukseon');
      for (const t of turtles) t.heading = sunAz + p.stage;
      const s = turtles[0];
      const az = s.heading + p.yaw;
      // The look-at point moves along the camera's right-hand axis; a negative shift puts the ship right of centre.
      const tx = s.x + p.ahead * Math.cos(s.heading) + p.shift * Math.sin(az);
      const tz = s.z + p.ahead * Math.sin(s.heading) - p.shift * Math.cos(az);
      e.rts.setPose({ tx, tz, yaw: az, pitch: p.pitch, distance: p.distance }, true);
      e.camera.fov = p.fov;
      e.camera.updateProjectionMatrix();
      return { ship: s.id, x: s.x, z: s.z, heading: s.heading, sunAz, backend: e.info().backend };
    }, POSE);
    await page.waitForTimeout(1500);
    const png = await page.screenshot();
    if (errors.length) throw new Error(errors.join('\n'));
    mkdirSync(SOURCE_DIR, { recursive: true });
    await sharp(png).jpeg({ quality: 94, mozjpeg: true, chromaSubsampling: '4:4:4' }).toFile(STILL);
    const provenance = {
      created: new Date().toISOString(),
      renderer: 'the game itself (src/game/Engine.ts), no image generation or painting',
      url,
      pose: POSE,
      scene,
      size: [W * 2, H * 2],
      sha256: createHash('sha256').update(readFileSync(STILL)).digest('hex'),
    };
    writeFileSync(join(SOURCE_DIR, 'provenance.json'), `${JSON.stringify(provenance, null, 2)}\n`);
    console.log(`wrote ${STILL}`);
  } finally {
    await browser.close();
  }
}

const CARDS = {
  ko: {
    out: 'og-geobukseon.jpg',
    title: `<div class="kicker">壬 辰 倭 亂</div>
      <div class="lockup"><h1 class="poster">임진왜란</h1><span class="seal">海<br>戰</span></div>
      <div class="sub">THE IMJIN WAR</div>`,
    line: '브라우저에서 바로 플레이 · imjin1592.com',
  },
  en: {
    out: 'og-geobukseon-en.jpg',
    title: `<div class="kicker">NAVAL STRATEGY</div>
      <img class="art" src="/menu_title_en.webp" alt="">
      <div class="sub">1592 — 1598</div>`,
    line: 'Free in your browser · imjin1592.com/en',
  },
};

/** The menu's wordmark (src/ui/Screens.tsx, menu-cinematic.css) at card size, over the left of the still. */
const page = (card) => `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css">
<style>
@font-face { font-family:'Imjin Title'; src:url('/imjin-title-dohyeon.woff2') format('woff2'); font-display:block; }
html,body { margin:0; width:${W}px; height:${H}px; overflow:hidden; background:#07121b; }
body { position:relative; font-family:'Pretendard Variable',Pretendard,'Malgun Gothic','Apple SD Gothic Neo',sans-serif; }
.still { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; }
/* The title side darkens so the cream type reads at thumbnail size; the ship side keeps its light. */
.shade { position:absolute; inset:0; background:
  linear-gradient(90deg,rgba(4,9,15,.78) 0%,rgba(4,9,15,.6) 28%,rgba(4,9,15,.22) 50%,rgba(4,9,15,0) 64%),
  linear-gradient(180deg,rgba(4,9,15,.18) 0%,rgba(4,9,15,0) 30%,rgba(4,9,15,0) 66%,rgba(4,9,15,.42) 100%); }
.mark { position:absolute; left:70px; top:0; bottom:0; width:470px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:14px; }
.kicker { font-size:17px; letter-spacing:.3em; padding-left:.3em; color:#d8d0bb; text-shadow:0 1px 10px rgba(3,8,13,.9); }
.lockup { position:relative; }
.poster { margin:0; font-family:'Imjin Title',sans-serif; font-weight:400; font-size:126px; line-height:.95; letter-spacing:-.04em;
  padding:0 .04em 0 0; white-space:nowrap; color:#f1ead6; -webkit-text-stroke:.036em #f1ead6; paint-order:stroke fill;
  filter:drop-shadow(0 3px 0 #08121a) drop-shadow(0 12px 30px rgba(3,8,13,.8)); }
.seal { position:absolute; right:-46px; bottom:16px; width:36px; height:50px; display:grid; place-content:center; background:#863a30;
  color:#e8cfb2; font-family:'Noto Serif KR','Batang',serif; font-size:16px; line-height:1.2; text-align:center; transform:rotate(5deg);
  clip-path:polygon(3% 2%,94% 0,100% 7%,97% 96%,6% 100%,0 94%); box-shadow:0 0 0 2px #863a30; }
.art { width:300px; height:auto; filter:drop-shadow(0 8px 24px rgba(3,8,13,.75)); }
.sub { font-size:16px; letter-spacing:.44em; padding-left:.44em; color:#e2dccb; text-shadow:0 1px 10px rgba(3,8,13,.9); }
.line { margin-top:22px; font-size:22px; font-weight:600; letter-spacing:.02em; color:#f4efe2; white-space:nowrap;
  padding:9px 20px; border-top:1px solid rgba(214,196,154,.45); border-bottom:1px solid rgba(214,196,154,.3);
  text-shadow:0 1px 12px rgba(3,8,13,.95); }
</style></head><body>
<img class="still" src="/still.jpg" alt="">
<div class="shade"></div>
<div class="mark">${card.title}<div class="line">${card.line}</div></div>
</body></html>`;

async function compose() {
  const files = {
    '/still.jpg': [STILL, 'image/jpeg'],
    '/imjin-title-dohyeon.woff2': [join(ROOT, 'public', 'ui', 'fonts', 'imjin-title-dohyeon.woff2'), 'font/woff2'],
    '/menu_title_en.webp': [join(ROOT, 'public', 'ui', 'art', 'menu_title_en.webp'), 'image/webp'],
  };
  const browser = await launch();
  try {
    for (const [lang, card] of Object.entries(CARDS)) {
      const tab = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
      // A made-up origin serves the card and its local files; the Pretendard stylesheet still comes from its CDN.
      await tab.route('https://og.card/**', (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path === '/') return route.fulfill({ body: page(card), contentType: 'text/html; charset=utf-8' });
        const file = files[path];
        return file ? route.fulfill({ body: readFileSync(file[0]), contentType: file[1] }) : route.fulfill({ status: 404 });
      });
      await tab.goto('https://og.card/', { waitUntil: 'networkidle' });
      await tab.evaluate(() => document.fonts.ready);
      const png = await tab.screenshot();
      const out = join(ROOT, 'public', card.out);
      await sharp(png).resize(W, H, { kernel: 'lanczos3' }).jpeg({ quality: 84, mozjpeg: true }).toFile(out);
      console.log(`wrote ${out} (${lang})`);
      await tab.close();
    }
  } finally {
    await browser.close();
  }
}

if (args.capture) await capture();
else await compose();
