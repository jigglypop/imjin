// Cuts the shots recorded by scripts/promo-capture.mjs into a vertical promo reel: captions in the game's own type
// (rendered in the browser as transparent PNGs), an end card taken from the title screen, the battle soundtrack from
// scripts/render-sounds.mjs (--only=battle) with a gun or a blast on the cuts, loudness for social video (-14 LUFS).
//   node scripts/promo-edit.mjs --dir=shots/promo [--url=http://127.0.0.1:5291/] [--out=shots/promo/imjin_reel.mp4]
import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, '').split('=');
    return [k, v.join('=') || 'true'];
  }),
);
const ROOT = new URL('..', import.meta.url).pathname;
const dir = resolve(args.dir ?? 'shots/promo');
const base = args.url ?? 'http://127.0.0.1:5291/';
const outFile = resolve(args.out ?? join(dir, 'imjin_reel.mp4'));
const W = 1080;
const H = 1920;
const FPS = 30;

/**
 * The cut: clip, in and out points (s), and the caption over it. Captions are labels, not slogans: a place and a year, a
 * ship or a weapon, a mode. Most cuts carry none.
 */
const CUTS = [
  { clip: 'myeong_wide', from: 0.0, to: 3.2, kicker: 'MYEONGNYANG 1597', title: '13 : 133', note: '조선 수군 13척 · 일본 수군 133척', big: true },
  { clip: 'myeong_fight', from: 2.6, to: 4.6 },
  { clip: 'broadside', from: 0.2, to: 2.6, hit: 'broadside_1' },
  { clip: 'myeong_fight', from: 4.8, to: 7.4, hit: 'explosion_2' },
  { clip: 'rockets', from: 1.6, to: 4.6, kicker: 'SINGIJEON', title: '신기전', hit: 'whoosh_1' },
  { clip: 'turtle', from: 3.8, to: 7.4, kicker: 'GEOBUKSEON', title: '거북선', hit: 'drum_1' },
  { clip: 'boarding', from: 0.8, to: 3.6, hit: 'musket_volley_1' },
  { clip: 'night', from: 6.0, to: 9.0, kicker: 'NORYANG 1598', title: '노량', fadeIn: true, grade: 'eq=gamma=1.35:brightness=0.035:contrast=1.04:saturation=1.1' },
  { clip: 'ui', from: 7.4, to: 10.0, kicker: 'HISTORICAL BATTLES', title: '역사 전투', note: '옥포에서 노량까지, 실제 해전 아홉 곳' },
  { clip: 'ui', from: 12.8, to: 15.0, kicker: 'FACTION CAMPAIGN', title: '진영 전역', note: '조선 · 일본 · 명' },
  { end: true, seconds: 3.4, hit: 'cannon_heavy_1' },
];

const CAPTION_CSS = `
  @import url('https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css');
  html, body { margin: 0; width: ${W}px; height: ${H}px; background: transparent; }
  .wrap { position: absolute; left: 0; right: 0; top: 270px; display: flex; flex-direction: column; align-items: center; gap: 18px;
    font-family: 'Pretendard Variable', Pretendard, sans-serif; color: #fff; text-align: center;
    text-shadow: 0 1px 18px rgba(0, 0, 0, 0.5), 0 0 2px rgba(0, 0, 0, 0.35); }
  .kicker { font-weight: 600; font-size: 26px; letter-spacing: 0.46em; padding-left: 0.46em; color: rgba(255, 255, 255, 0.78); }
  .title { font-weight: 300; font-size: 132px; line-height: 1.05; letter-spacing: -0.01em; }
  .title.big { font-weight: 200; font-size: 190px; letter-spacing: 0.02em; font-variant-numeric: tabular-nums; }
  .note { margin-top: 6px; font-weight: 500; font-size: 32px; letter-spacing: 0.02em; color: rgba(255, 255, 255, 0.84); }
`;

function captionHtml({ kicker, title, note, big }) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${CAPTION_CSS}</style></head><body><div class="wrap">
    ${kicker ? `<div class="kicker">${kicker}</div>` : ''}<div class="title${big ? ' big' : ''}">${title}</div>${note ? `<div class="note">${note}</div>` : ''}
    </div></body></html>`;
}

async function renderOverlays(browser) {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const files = [];
  for (let i = 0; i < CUTS.length; i += 1) {
    const c = CUTS[i];
    if (!c.title) {
      files.push(null);
      continue;
    }
    await page.setContent(captionHtml(c), { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    const file = join(dir, `cap_${i}.png`);
    await page.screenshot({ path: file, omitBackground: true });
    files.push(file);
  }
  await page.close();
  return files;
}

/** The end card: the title screen without its mode cards, with the call to action under the wordmark. */
async function renderEndCard(browser) {
  const page = await browser.newPage({ viewport: { width: 540, height: 960 }, deviceScaleFactor: 2 });
  await page.goto(`${base}?lang=ko`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.wordmark-title');
  await page.evaluate(() => document.fonts.ready);
  await page.addStyleTag({
    content: `.mode-grid, .screen-top { display: none !important; }
      .menu-inner { justify-content: center !important; padding-top: 0 !important; }
      .promo-cta { margin-top: 64px; display: flex; flex-direction: column; align-items: center; gap: 14px; }
      .promo-cta b { font-size: 22px; font-weight: 600; letter-spacing: 0.04em; color: var(--ink); text-shadow: 0 1px 12px rgba(4, 8, 14, 0.8); }
      .promo-cta span { padding: 12px 26px; border-radius: 999px; background: var(--accent); color: var(--accent-ink); font-size: 24px;
        font-weight: 700; letter-spacing: 0.02em; box-shadow: 0 8px 30px rgba(0, 0, 0, 0.45); }
      .promo-cta small { font-size: 15px; color: var(--ink-2); letter-spacing: 0.08em; text-shadow: 0 1px 10px rgba(4, 8, 14, 0.8); }`,
  });
  await page.evaluate(() => {
    const cta = document.createElement('div');
    cta.className = 'promo-cta';
    cta.innerHTML = '<b>브라우저에서 바로 플레이</b><span>imjin1592.com</span><small>PC · 모바일 · 무료</small>';
    document.querySelector('.wordmark')?.after(cta);
  });
  await page.waitForTimeout(800);
  const file = join(dir, 'endcard.png');
  await page.screenshot({ path: file });
  await page.close();
  return file;
}

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=metal'] });
await mkdir(dir, { recursive: true });
const overlays = await renderOverlays(browser);
const endCard = await renderEndCard(browser);
await browser.close();

// ---- the edit ----
const inputs = [];
const filters = [];
const segs = [];
let t = 0;
const starts = [];
const clipInput = new Map();
const addInput = (argv) => {
  inputs.push(...argv);
  return inputs.filter((a) => a === '-i').length - 1;
};
for (const c of CUTS) {
  const start = t;
  starts.push(start);
  const k = segs.length;
  if (c.end) {
    const idx = addInput(['-loop', '1', '-framerate', String(FPS), '-t', String(c.seconds), '-i', endCard]);
    const frames = Math.round(c.seconds * FPS);
    filters.push(
      `[${idx}:v]scale=${W * 2}:${H * 2},zoompan=z='1+0.05*on/${frames}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${W}x${H}:fps=${FPS},trim=duration=${c.seconds},setpts=PTS-STARTPTS,fade=t=in:st=0:d=0.35,format=yuv420p[s${k}]`,
    );
    t += c.seconds;
  } else {
    if (!clipInput.has(c.clip)) clipInput.set(c.clip, addInput(['-i', join(dir, `${c.clip}.mp4`)]));
    const idx = clipInput.get(c.clip);
    const d = c.to - c.from;
    filters.push(
      `[${idx}:v]trim=start=${c.from}:end=${c.to},setpts=PTS-STARTPTS,fps=${FPS},scale=${W}:${H},${c.grade ?? 'eq=contrast=1.06:saturation=1.08'}${c.fadeIn ? ',fade=t=in:st=0:d=0.3' : ''},format=yuv420p[s${k}]`,
    );
    t += d;
  }
  segs.push(`[s${k}]`);
}
const total = t;
filters.push(`${segs.join('')}concat=n=${segs.length}:v=1:a=0[base]`);
// captions: in over 0.3 s, out over 0.25 s, a little inside each cut
let last = '[base]';
CUTS.forEach((c, i) => {
  if (!overlays[i]) return;
  const a = starts[i] + 0.2;
  const b = (starts[i + 1] ?? total) - 0.15;
  const idx = addInput(['-loop', '1', '-framerate', String(FPS), '-t', String(total), '-i', overlays[i]]);
  filters.push(`[${idx}:v]format=rgba,fade=t=in:st=${a.toFixed(2)}:d=0.3:alpha=1,fade=t=out:st=${(b - 0.25).toFixed(2)}:d=0.25:alpha=1[o${i}]`);
  filters.push(`${last}[o${i}]overlay=0:0:enable='between(t,${a.toFixed(2)},${b.toFixed(2)})'[v${i}]`);
  last = `[v${i}]`;
});
filters.push(`${last}fade=t=out:st=${(total - 0.5).toFixed(2)}:d=0.5,format=yuv420p[vout]`);

// sound: the battle bed, a gun or a blast on the cuts that carry one, the whole at -14 LUFS
const bedIdx = addInput(['-ss', '6', '-t', String(total + 0.5), '-i', join(dir, 'audio2_battle.wav')]);
filters.push(`[${bedIdx}:a]volume=0.85,afade=t=in:st=0:d=0.4,afade=t=out:st=${(total - 1.6).toFixed(2)}:d=1.6[bed]`);
const hits = [];
CUTS.forEach((c, i) => {
  if (!c.hit) return;
  const idx = addInput(['-i', join(ROOT, 'public', 'audio', `${c.hit}.mp3`)]);
  const ms = Math.round(starts[i] * 1000);
  filters.push(`[${idx}:a]aformat=channel_layouts=stereo,volume=1.1,adelay=${ms}|${ms}[h${i}]`);
  hits.push(`[h${i}]`);
});
filters.push(`[bed]${hits.join('')}amix=inputs=${hits.length + 1}:duration=first:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=11,atrim=duration=${total.toFixed(2)}[aout]`);

execFileSync(
  'ffmpeg',
  ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', filters.join(';'), '-map', '[vout]', '-map', '[aout]', '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-maxrate', '12M', '-bufsize', '24M', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart', outFile],
  { stdio: 'inherit' },
);
console.log(`wrote ${outFile} (${total.toFixed(1)} s)`);
