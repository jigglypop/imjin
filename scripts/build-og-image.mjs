// The link-preview cards (Open Graph and X, read by KakaoTalk, iMessage, Slack, Discord...) and the loading art of every
// address: the menu (/), /campaign, /conquest, /battles, /online and /settings, in Korean and under /en in English. Every
// picture is a still of the game itself, staged in its own renderer; the cards set the menu's film-poster title over it.
//   node scripts/build-og-image.mjs --capture [--only=menu,campaign] [--url=http://127.0.0.1:5291/]
//       renders the stills into assets-src/og-routes-2026-10-15 (the menu's turtle ship into og-geobukseon-2026-10-14);
//       needs a dev server and a WebGPU browser
//   node scripts/build-og-image.mjs
//       composes public/og-<route>.jpg and -en.jpg (1200x630; the menu's are og-menu*.jpg) and the loading art
//       public/ui/art/route_<route>.webp and _sm.webp from those stills
// KakaoTalk keeps a preview image by its URL for days: if a picture changes, give its cards new file names here
// (CARD_FILE) and in vite.config.ts and index.html.
import { chromium } from 'playwright-core';
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, '').split('=');
    return [k, v.join('=') || 'true'];
  }),
);
const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const SOURCE_DIR = join(ROOT, 'assets-src', 'og-routes-2026-10-15');
const MENU_STILL = join(ROOT, 'assets-src', 'og-geobukseon-2026-10-14', 'geobukseon-sunset.jpg');
const W = 1200;
const H = 630;
const still = (name) => (name === 'menu' ? MENU_STILL : join(SOURCE_DIR, `${name}.jpg`));

const launch = () =>
  chromium.launch({
    channel: process.platform === 'win32' ? 'msedge' : 'chrome',
    headless: true,
    args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', process.platform === 'win32' ? '--use-angle=d3d11' : '--use-angle=metal'],
  });

/** The HUD, squad tags and order marks go; a scene that wants the ports' labels keeps `.cpoints`. */
const HIDE_HUD = '.hud, .banners, .move-orders, .toasts, .selection-dock, .bottom, .minimap { display: none !important; }';

/** Every battle scene starts here: the approach's fast-forward off, the player's camera free. */
function calm() {
  const e = window.__engine;
  e.fastForward = false;
  e.autoFast = false;
  e.speed = 1;
  e.rts.followId = 0;
  e.rts.cinematic = false;
}

/**
 * In the page: two lines of ships set across the water, bows toward each other, `sep` metres apart, centred on (cx, cz)
 * and facing along `axis`. Ships of a team beyond `count` are sent far away so the frame stays readable.
 */
function lines({ cx, cz, axis, sep, count, spacing = 36 }) {
  const b = window.__engine.battle;
  const place = (list, ox, oz, heading) =>
    list.forEach((s, i) => {
      const row = Math.floor(i / 6);
      const col = i % 6;
      s.x = ox + (col - 2.5) * spacing * Math.sin(heading) - row * (spacing + 2) * Math.cos(heading);
      s.z = oz - (col - 2.5) * spacing * Math.cos(heading) - row * (spacing + 2) * Math.sin(heading);
      s.heading = heading;
    });
  const teams = [...new Set(b.ships.map((s) => s.team))];
  teams.forEach((team, k) => {
    const list = b.ships.filter((s) => s.team === team && s.alive);
    const dir = k === 0 ? -1 : 1;
    place(list.slice(0, count), cx + dir * Math.cos(axis) * sep * 0.5, cz + dir * Math.sin(axis) * sep * 0.5, k === 0 ? axis : axis + Math.PI);
    for (const s of list.slice(count)) s.x += 8000;
  });
}

const SCENES = {
  /**
   * The menu's card: Hansan at sunset, paused before the first shot. The three turtle ships are turned so the low sun
   * falls on the side the camera sees from behind its right shoulder, which lights the dragon head and puts the warm sky
   * behind the ship; the camera sits just above the waves off the port bow with a 32 degree lens, the ship on the right.
   */
  menu: {
    path: '',
    query: 'scenario=hansan&hud=0&paused=1&sky=sunset&clouds=0',
    async stage(page) {
      const pose = { stage: 2.4, yaw: -0.6, pitch: 0.05, distance: 60, ahead: 10, shift: -9, fov: 32 };
      await page.evaluate((p) => {
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
      }, pose);
      await page.waitForTimeout(1500);
      return { pose };
    },
  },
  /**
   * The campaign's 3D map in a war under way: camps of every navy along the coast, fleets at sea, seen low over the
   * strait west of Busan with the islands behind.
   */
  campaign: {
    path: 'campaign',
    query: 'lang=ko',
    grand: true,
    async stage(page) {
      await page.locator('.g-hub__actions .g-btn--primary').click();
      await page.locator('.gm[data-relief="ready"]').waitFor({ timeout: 120000 });
      await page.waitForTimeout(3000);
      await page.addStyleTag({ content: '.g-top, .g-side, .g-dock, .g-panel, .g-bar, .gm__zoom, .gm__credits, .gm__hint, .g-toast, .g-guide { display: none !important; }' });
      const node = page.locator('.gm-node[data-region="geoje"] .gm-node__disc');
      const box = await node.boundingBox();
      if (box) {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        for (let i = 0; i < 14; i += 1) {
          await page.mouse.wheel(0, -60);
          await page.waitForTimeout(25);
        }
      }
      for (let i = 0; i < 4; i += 1) {
        await page.keyboard.press('KeyF');
        await page.waitForTimeout(30);
      }
      await page.mouse.move(5, 5);
      await page.waitForTimeout(2500);
    },
  },
  /** A conquest battle off the western home port: the two fleets trading fire across the strait, the ports labelled. */
  conquest: {
    path: '',
    query: 'conquest=hallyeo&me=joseon&foe=japan&size=2&sky=afternoon&sea=moderate',
    async stage(page) {
      await page.addStyleTag({ content: HIDE_HUD });
      await page.evaluate(calm);
      const p = await page.evaluate(() => {
        const pt = window.__engine.conquest.points[0];
        return { x: pt.x, z: pt.z };
      });
      // Out from the port toward the middle of the map, where the strait opens.
      const ang = Math.atan2(-p.z, -p.x);
      const cx = p.x + Math.cos(ang) * 420;
      const cz = p.z + Math.sin(ang) * 420;
      await page.evaluate(lines, { cx, cz, axis: ang + Math.PI / 2, sep: 190, count: 24 });
      // From the sea side, the fight in the middle distance and the port's coast behind it.
      const pose = { tx: cx + Math.cos(ang) * 60, tz: cz + Math.sin(ang) * 60, yaw: ang, pitch: 0.24, distance: 330 };
      await page.evaluate((pose) => window.__engine.rts.setPose(pose, true), pose);
      await page.waitForTimeout(9000);
      await page.evaluate((pose) => window.__engine.rts.setPose(pose, true), pose);
      await page.waitForTimeout(1200);
      return { pose };
    },
  },
  /**
   * Myeongnyang at sunset, 13 against 133: from above and behind the Joseon line, the whole Japanese fleet filling the
   * strait ahead of it.
   */
  battles: {
    path: '',
    query: 'scenario=myeongnyang&sky=sunset&sea=moderate&hud=0',
    async stage(page) {
      await page.evaluate(calm);
      const pose = await page.evaluate((gap) => {
        const b = window.__engine.battle;
        const mean = (team) => {
          const s = b.ships.filter((x) => x.alive && x.team === team);
          return { x: s.reduce((a, v) => a + v.x, 0) / s.length, z: s.reduce((a, v) => a + v.z, 0) / s.length };
        };
        const j = mean('joseon');
        const e = mean('japan');
        // The Japanese fleet is brought up the strait to the given distance, so both fleets fit one frame.
        const len = Math.hypot(e.x - j.x, e.z - j.z);
        const k = Math.max(0, len - gap) / len;
        for (const s of b.ships) {
          if (s.team !== 'japan') continue;
          s.x -= (e.x - j.x) * k;
          s.z -= (e.z - j.z) * k;
        }
        const ex = e.x - (e.x - j.x) * k;
        const ez = e.z - (e.z - j.z) * k;
        const yaw = Math.atan2(j.z - ez, j.x - ex);
        // Shifted along the camera's right-hand axis so the fleets stand right of the title.
        const a = yaw + 0.12;
        const tx = j.x * 0.66 + ex * 0.34 - 90 * Math.sin(a);
        const tz = j.z * 0.66 + ez * 0.34 + 90 * Math.cos(a);
        return { tx, tz, yaw: a, pitch: 0.22, distance: 500 };
      }, Number(args.gap ?? 520));
      await page.evaluate((pose) => window.__engine.rts.setPose(pose, true), pose);
      await page.waitForTimeout(3000);
      return { pose };
    },
  },
  /** Two lines trading broadsides at close range in the afternoon: smoke, flashes and shot in the air between them. */
  online: {
    path: '',
    query: 'scenario=hansan&sky=afternoon&sea=moderate&hud=0',
    async stage(page) {
      await page.evaluate(calm);
      const c = await page.evaluate(() => {
        const s = window.__engine.battle.ships.find((x) => x.team === 'joseon');
        return { x: s.x, z: s.z };
      });
      await page.evaluate(lines, { cx: c.x, cz: c.z, axis: 0, sep: 150, count: 12, spacing: 40 });
      await page.waitForTimeout(7000);
      // Low on the beam of the gap between the lines, both fleets in frame.
      const pose = { tx: c.x, tz: c.z, yaw: 1.25, pitch: 0.1, distance: 210 };
      await page.evaluate((pose) => window.__engine.rts.setPose(pose, true), pose);
      await page.waitForTimeout(1500);
      return { pose };
    },
  },
  /** The calm one: a single panokseon under sail on a quiet sea among the islands, the afternoon clouds above. */
  settings: {
    path: '',
    query: 'scenario=hansan&sky=afternoon&sea=calm&hud=0',
    async stage(page) {
      await page.evaluate(calm);
      const staged = await page.evaluate(() => {
        const e = window.__engine;
        const b = e.battle;
        const a = b.ships.find((s) => s.alive && s.spec.kind === 'panokseon' && s.team === 'joseon');
        for (const s of b.ships) {
          if (s === a) continue;
          s.x += 8000;
          s.speed = 0;
          s.fireMode = 'hold';
        }
        const x0 = a.x;
        const z0 = a.z;
        const t0 = performance.now();
        // Held on a straight course at an easy speed, so the wake trails behind it.
        window.__hold = setInterval(() => {
          const t = (performance.now() - t0) / 1000;
          a.x = x0 + 3 * t;
          a.z = z0;
          a.heading = 0;
          a.speed = 3;
          a.throttle = 0.5;
          a.order = { type: 'auto' };
          a.fireMode = 'hold';
        }, 16);
        return { id: a.id, x0, z0 };
      });
      await page.waitForTimeout(5000);
      const pose = await page.evaluate(({ id }) => {
        const e = window.__engine;
        const a = e.battle.ships.find((s) => s.id === id);
        // The look-at point moves along the camera's right-hand axis, so the ship sits right of centre (the title's side
        // is the left).
        const yaw = 2.5;
        const pose = { tx: a.x - 22 * Math.sin(yaw), tz: a.z + 22 * Math.cos(yaw), yaw, pitch: 0.08, distance: 90 };
        e.rts.setPose(pose, true);
        return pose;
      }, staged);
      await page.waitForTimeout(1500);
      return { pose };
    },
  },
};

async function captureOne(browser, name, scene) {
  const base = args.url ?? 'http://127.0.0.1:5291/';
  const quality = 'hud=1&lv=4&q=high&dpr=2';
  const url = `${base}${scene.path}?${scene.query}&${quality}`;
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  if (scene.grand) await page.addInitScript((save) => {
    localStorage.setItem('imjin.grand.v1', JSON.stringify(save));
    localStorage.setItem('imjin.grand.guide.v1', '1');
  }, await grandSave());
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  if (!scene.grand) await page.waitForFunction(() => window.__ready === true, null, { timeout: 240000 });
  const staged = await scene.stage(page);
  const png = await page.screenshot();
  await page.close();
  if (errors.length) throw new Error(`${name}: ${errors.join('\n')}`);
  mkdirSync(dirname(still(name)), { recursive: true });
  await sharp(png).jpeg({ quality: 94, mozjpeg: true, chromaSubsampling: '4:4:4' }).toFile(still(name));
  console.log(`wrote ${still(name)}`);
  return { url, staged: staged ?? null, sha256: createHash('sha256').update(readFileSync(still(name))).digest('hex') };
}

/** A war in progress (the save scripts/probe-grand.mjs builds): camps of every navy and tier along the coast. */
let saved = null;
async function grandSave() {
  if (saved) return saved;
  const { createServer } = await import('vite');
  const vite = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), configFile: false, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false }, optimizeDeps: { noDiscovery: true, include: [] } });
  try {
    const { newGrand } = await vite.ssrLoadModule('/src/sim/grand/turn.ts');
    const save = newGrand('joseon', 551);
    save.phase = 'orders';
    save.events.pending = null;
    for (const [id, level, owner] of [['yeosu', 3], ['noryang', 2], ['bangdap', 1], ['busan', 3], ['angolpo', 2], ['geoje', 2], ['sacheon', 3, 'japan'], ['ungcheon', 2, 'ming']]) {
      const r = save.regions[id];
      if (!r) continue;
      if (owner) r.owner = owner;
      const camp = r.buildings.find((b) => b.kind === 'camp');
      if (camp) camp.level = level;
      else r.buildings.push({ kind: 'camp', level, upgradeLeft: 0, hp: 1 });
    }
    saved = save;
    return save;
  } finally {
    await vite.close();
  }
}

async function capture() {
  const only = args.only ? args.only.split(',') : Object.keys(SCENES);
  const file = join(SOURCE_DIR, 'provenance.json');
  const provenance = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { renderer: 'the game itself (src/game/Engine.ts, src/ui/grand), no image generation or painting', stills: {} };
  const browser = await launch();
  try {
    for (const name of only) {
      const scene = SCENES[name];
      if (!scene) throw new Error(`no scene ${name}`);
      provenance.stills[name] = { created: new Date().toISOString(), size: [W * 2, H * 2], ...(await captureOne(browser, name, scene)) };
      writeFileSync(file, `${JSON.stringify(provenance, null, 2)}\n`);
    }
  } finally {
    await browser.close();
  }
}

/** A TypeScript module without imports (src/routes.ts, the English dictionary), run with its types stripped. */
async function tsModule(path) {
  const { transformSync } = await import('esbuild');
  const source = transformSync(readFileSync(join(ROOT, path), 'utf8'), { loader: 'ts', format: 'esm' }).code;
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

/**
 * The lettering of the menu's film-poster title (src/ui/Screens.tsx, menu-cinematic.css), at card size. The menu's card
 * is that lockup itself; a screen's card sets the screen's name as the title in the same faces (Do Hyeon for Korean,
 * Cinzel for English), with the small 壬辰倭亂 | 임진왜란 mark above it, its line and its address below.
 */
const lockup = (card) => {
  const dates = '<div class="dates"><i></i><span>1592 — 1598</span><i></i></div>';
  if (card.menu) {
    return card.lang === 'ko'
      ? `<p class="tagline">나라를 지킨 바다</p>
         <div class="title-lockup"><span class="hanja">壬辰倭亂</span><h1 class="title">임진왜란</h1><span class="seal">海<br>戰</span></div>
         ${dates}`
      : `<p class="tagline">The sea that held a kingdom</p>
         <h1 class="roman"><span class="the">The</span><span class="roman-name">Imjin War</span></h1>
         ${dates}
         <div class="mark"><span>壬辰倭亂</span><b>임진왜란</b></div>`;
  }
  const mark = card.lang === 'ko' ? '<div class="mark"><span>壬辰倭亂</span><b>임진왜란</b></div>' : '<div class="the the--small">The Imjin War</div>';
  const name = card.lang === 'ko' ? `<h1 class="title title--route">${card.name}</h1>` : `<h1 class="roman"><span class="roman-name roman-name--route">${card.name}</span></h1>`;
  return `${mark}${name}<p class="line">${card.line}</p>${dates}`;
};

const cardPage = (card) => `<!doctype html><html lang="${card.lang}"><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Serif+KR:wght@400;500&display=block">
<style>
@font-face { font-family:'Imjin Title'; src:url('/fonts/imjin-title-dohyeon.woff2') format('woff2'); font-display:block; unicode-range:U+C784,U+C9C4,U+C65C,U+B780; }
@font-face { font-family:'Imjin Title'; src:url('/fonts/imjin-routes-dohyeon.woff2') format('woff2'); font-display:block; }
@font-face { font-family:'Imjin Roman'; src:url('/fonts/imjin-title-cinzel.woff2') format('woff2'); font-weight:400 900; font-display:block; }
@font-face { font-family:'Imjin Serif'; src:url('/fonts/imjin-serif-notoserifkr.woff2') format('woff2'); font-weight:200 900; font-display:block; }
html,body { margin:0; width:${W}px; height:${H}px; overflow:hidden; background:#07121b; }
body { position:relative; --t:${card.menu ? 132 : 150}px; --brass:#bba77e; }
.still { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; }
/* The title's side darkens so the white type reads at thumbnail size; the subject keeps its light on the right. */
.shade { position:absolute; inset:0; background:
  linear-gradient(90deg,rgba(4,9,15,.86) 0%,rgba(4,9,15,.7) 32%,rgba(4,9,15,.26) 54%,rgba(4,9,15,0) 68%),
  linear-gradient(180deg,rgba(4,9,15,.2) 0%,rgba(4,9,15,0) 26%,rgba(4,9,15,0) 70%,rgba(4,9,15,.4) 100%); }
/* Kakao and the others crop toward the centre: the lockup keeps 70 px from the edges. */
.poster { position:absolute; top:0; bottom:0; left:70px; width:500px; display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; color:#fff; }
.tagline { margin:0 -.5em calc(var(--t)*.17) 0; font-family:'Imjin Serif',serif; font-weight:300; font-size:calc(var(--t)*.135); line-height:1; letter-spacing:.5em; white-space:nowrap; color:rgba(255,255,255,.8); text-shadow:0 1px 14px rgba(3,8,13,.85); }
[lang=en] .tagline { margin-right:-.42em; font-family:'Imjin Roman',serif; font-weight:500; font-size:calc(var(--t)*.11); letter-spacing:.42em; text-transform:uppercase; }
.title-lockup { position:relative; }
/* Do Hyeon has one weight; a stroke in its own colour thickens it, the syllables pulled together, translucent white. */
.title { margin:0; font-family:'Imjin Title',sans-serif; font-weight:400; font-size:var(--t); line-height:.9; letter-spacing:-.04em; padding:0 .04em 0 0; white-space:nowrap;
  -webkit-text-stroke:.022em #fff; paint-order:stroke fill; opacity:.82; filter:drop-shadow(0 2px 14px rgba(3,8,13,.6)); }
.hanja { position:absolute; right:100%; top:50%; margin-right:calc(var(--t)*.17); transform:translateY(-50%); writing-mode:vertical-rl; white-space:nowrap; font-family:'Imjin Serif',serif; font-size:calc(var(--t)*.13); line-height:1; letter-spacing:.34em; color:rgba(255,255,255,.7); text-shadow:0 1px 12px rgba(3,8,13,.8); }
.seal { position:absolute; right:calc(var(--t)*-.29); bottom:calc(var(--t)*.13); width:calc(var(--t)*.2); height:calc(var(--t)*.28); display:grid; place-content:center; background:#863a30; color:#e0c2a4;
  font-family:'Imjin Serif',serif; font-weight:600; font-size:calc(var(--t)*.088); line-height:1.2; transform:rotate(5deg); clip-path:polygon(3% 2%,94% 0,100% 7%,97% 96%,6% 100%,0 94%); box-shadow:0 0 0 2px #863a30; }
.roman { margin:0; display:flex; flex-direction:column; align-items:center; font-family:'Imjin Roman',serif; font-weight:400; line-height:1; text-transform:uppercase; opacity:.86; filter:drop-shadow(0 2px 14px rgba(3,8,13,.6)); }
.the { display:flex; align-items:center; gap:.9em; margin-bottom:calc(var(--t)*.07); font-family:'Imjin Roman',serif; font-size:calc(var(--t)*.125); font-weight:500; letter-spacing:.62em; text-transform:uppercase; }
.the::before, .the::after { content:''; width:2.4em; height:1px; background:currentColor; opacity:.7; }
.the::after { margin-left:-.62em; }
.the--small { margin-bottom:calc(var(--t)*.16); font-size:calc(var(--t)*.1); letter-spacing:.42em; color:rgba(255,255,255,.78); text-shadow:0 1px 12px rgba(3,8,13,.85); }
.the--small::after { margin-left:-.42em; }
.roman-name { margin-right:-.07em; font-size:calc(var(--t)*.5); font-weight:600; letter-spacing:.07em; white-space:nowrap; }
.roman-name--route { font-size:calc(var(--t)*.52); }
.dates { display:flex; align-items:center; gap:calc(var(--t)*.13); margin-top:calc(var(--t)*.2); font-family:'Imjin Roman',serif; font-weight:500; font-size:calc(var(--t)*.1); line-height:1;
  color:var(--brass); white-space:nowrap; text-shadow:0 1px 10px rgba(3,8,13,.8); }
.dates span { letter-spacing:.32em; margin-right:-.32em; }
.dates i { width:calc(var(--t)*.62); height:1px; background:linear-gradient(90deg,transparent,rgba(187,167,126,.8)); }
.dates i:last-child { transform:scaleX(-1); }
.mark { display:flex; align-items:center; gap:calc(var(--t)*.11); line-height:1; color:#fff; opacity:.72; }
.title--route + .line, .roman + .line { margin-top:calc(var(--t)*.2); }
.mark:first-child { margin-bottom:calc(var(--t)*.2); }
.poster > .mark:last-child { margin-top:calc(var(--t)*.16); }
.mark span { font-family:'Imjin Serif',serif; font-size:calc(var(--t)*.11); letter-spacing:.3em; }
.mark span::after { content:''; display:inline-block; width:1px; height:1.1em; margin-left:calc(var(--t)*.11 - .3em); vertical-align:middle; background:currentColor; opacity:.5; }
.mark b { font-family:'Imjin Title',sans-serif; font-weight:400; font-size:calc(var(--t)*.17); letter-spacing:-.04em; }
.line { margin:0; max-width:480px; text-wrap:balance; word-break:keep-all; font-family:'Noto Serif KR',serif; font-weight:500; font-size:25px; line-height:1.45; letter-spacing:.04em; color:rgba(255,255,255,.88); text-shadow:0 1px 12px rgba(3,8,13,.95); }
[lang=en] .line { font-family:'Imjin Roman',serif; font-weight:600; font-size:19px; letter-spacing:.14em; text-transform:uppercase; }
.addr { position:absolute; left:70px; width:500px; bottom:44px; text-align:center; font-family:'Imjin Roman',serif; font-weight:500; font-size:15px; letter-spacing:.24em; color:rgba(214,203,170,.82); text-shadow:0 1px 10px rgba(3,8,13,.95); }
</style></head><body>
<img class="still" src="/still.jpg" alt="">
<div class="shade"></div>
<div class="poster">${lockup(card)}</div>
<div class="addr">${card.address}</div>
<script>
  // A long English name shrinks until it fits the column.
  for (const el of document.querySelectorAll('.roman-name--route, .title--route')) {
    let size = parseFloat(getComputedStyle(el).fontSize);
    while (el.scrollWidth > 500 && size > 30) el.style.fontSize = (size -= 2) + 'px';
  }
</script>
</body></html>`;

/** Each card's file. A new picture needs a new name: KakaoTalk keeps a preview image by its URL for days. */
const CARD_FILE = (slug, lang) => `og-${slug || 'menu'}${lang === 'ko' ? '' : '-en'}.jpg`;

async function compose() {
  const { ROUTES } = await tsModule('src/routes.ts');
  const { EN_COMMON } = await tsModule('src/i18n/en/common.ts');
  const english = (ko) => {
    if (!EN_COMMON[ko]) throw new Error(`no English for ${ko}`);
    return EN_COMMON[ko];
  };
  const art = join(ROOT, 'public', 'ui', 'art');
  // The loading art: the stills without type, a size for desktops and a small one for phones.
  for (const { slug } of ROUTES) {
    const name = `route_${slug || 'menu'}`;
    const source = readFileSync(still(slug || 'menu'));
    await sharp(source).resize(1600, 840, { kernel: 'lanczos3' }).webp({ quality: 70, effort: 6 }).toFile(join(art, `${name}.webp`));
    await sharp(source).resize(1024, 538, { kernel: 'lanczos3' }).webp({ quality: 66, effort: 6 }).toFile(join(art, `${name}_sm.webp`));
    console.log(`wrote ${name}.webp, ${name}_sm.webp`);
  }
  const fonts = join(ROOT, 'public', 'ui', 'fonts');
  const browser = await launch();
  try {
    for (const route of ROUTES) {
      const stillJpg = readFileSync(still(route.slug || 'menu'));
      for (const lang of ['ko', 'en']) {
        const card = {
          menu: !route.slug,
          lang,
          name: lang === 'ko' ? route.name : english(route.name),
          line: lang === 'ko' ? route.line : english(route.line),
          address: `imjin1592.com${lang === 'ko' ? '' : '/en'}${route.slug ? `/${route.slug}` : ''}`,
        };
        const tab = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
        // A made-up origin serves the card, the still and the game's own title fonts; Noto Serif KR for the line
        // still comes from Google Fonts.
        await tab.route('https://og.card/**', (r) => {
          const path = new URL(r.request().url()).pathname;
          if (path === '/') return r.fulfill({ body: cardPage(card), contentType: 'text/html; charset=utf-8' });
          if (path === '/still.jpg') return r.fulfill({ body: stillJpg, contentType: 'image/jpeg' });
          if (path.startsWith('/fonts/')) return r.fulfill({ body: readFileSync(join(fonts, path.slice(7))), contentType: 'font/woff2' });
          return r.fulfill({ status: 404 });
        });
        await tab.goto('https://og.card/', { waitUntil: 'networkidle' });
        const missing = await tab.evaluate(async () => {
          await document.fonts.ready;
          return [...document.fonts].filter((f) => f.status !== 'loaded' && f.status !== 'unloaded').map((f) => f.family);
        });
        if (missing.length) throw new Error(`${route.slug || 'menu'} ${lang}: fonts did not load: ${missing.join(', ')}`);
        const png = await tab.screenshot();
        const out = join(ROOT, 'public', CARD_FILE(route.slug, lang));
        await sharp(png).resize(W, H, { kernel: 'lanczos3' }).jpeg({ quality: 86, mozjpeg: true }).toFile(out);
        console.log(`wrote ${out}`);
        await tab.close();
      }
    }
  } finally {
    await browser.close();
  }
}

if (args.capture) await capture();
else await compose();
