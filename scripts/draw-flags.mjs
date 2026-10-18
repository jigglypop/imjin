// Vector flags of the later chapters' navies (1571, 1588, 1805), drawn from their patterns instead of image-model output
// (which framed them in white borders and blurred them). Each design is drawn in its own proportions and squeezed into
// its square sheet slot; src/ships/build/flagAspect.json carries the aspect so the cloth in the game is cut to the same proportions
// and the squeeze undoes itself. Writes the ship-textures cache, then patch the flag sheets into the published atlases:
//   node scripts/draw-flags.mjs [--faction=britain,...]
//   node scripts/ship-textures.mjs patch --faction=<f> --only=flags_a,flags_b
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const CACHE = join(ROOT, 'assets-src/textures-ships');
const LAYOUT = join(ROOT, 'src/ships/build/atlasLayout.json');
const ASPECT = join(ROOT, 'src/ships/build/flagAspect.json');
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const S = 1024;

// Colours of the period cloths: madder red, woad blue, weld yellow, unbleached white.
const R = '#b3202a', B = '#1f3a78', NB = '#14285a', W = '#f2eee2', Y = '#e8b623', G = '#2e6b3a', GD = '#c9962a', K = '#1b1b1b';

const svg = (w, h, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">${body}</svg>`;
const rect = (x, y, w, h, c) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${c}"/>`;
const cross = (w, h, c, t) => rect(0, (h - t) / 2, w, t, c) + rect((w - t) / 2, 0, t, h, c);
// The union of 1801 (60x30 pattern) scaled into a box.
const union = (x, y, w, h) => `<svg x="${x}" y="${y}" width="${w}" height="${h}" viewBox="0 0 60 30" preserveAspectRatio="none">
<clipPath id="u${x}${y}"><path d="M30,15 h30 v15 z v15 h-30 z h-30 v-15 z v-15 h30 z"/></clipPath>
<rect width="60" height="30" fill="${NB}"/><path d="M0,0 L60,30 M60,0 L0,30" stroke="${W}" stroke-width="6"/>
<path d="M0,0 L60,30 M60,0 L0,30" clip-path="url(#u${x}${y})" stroke="${R}" stroke-width="4"/>
<path d="M30,0 v30 M0,15 h60" stroke="${W}" stroke-width="10"/><path d="M30,0 v30 M0,15 h60" stroke="${R}" stroke-width="6"/></svg>`;
const fleur = (x, y, s, c) => `<g transform="translate(${x},${y}) scale(${s})" fill="${c}"><path d="M0,-10 C4,-6 4,-2 1.5,2 L-1.5,2 C-4,-2 -4,-6 0,-10Z M-1.5,2 C-6,0 -9,-4 -7,-7 C-5,-3 -3,-1 -1,1Z M1.5,2 C6,0 9,-4 7,-7 C5,-3 3,-1 1,1Z"/><rect x="-5" y="2.5" width="10" height="2"/><path d="M-1.2,4.5 h2.4 l-1.2,5z"/></g>`;
const lion = (x, y, s, c) => `<g transform="translate(${x},${y}) scale(${s})" fill="${c}"><path d="M-9,2 C-8,-2 -4,-3 2,-2 L5,-5 L8,-4 L7,-1 L9,0 L6,1 L5,3 L7,6 L5,6 L3,3 L-4,3 L-5,6 L-7,6 L-7,3 C-10,3 -12,0 -11,-3 C-10,0 -10,1 -9,2Z"/></g>`;
const castle = (x, y, s, c) => `<g transform="translate(${x},${y}) scale(${s})" fill="${c}"><path d="M-8,8 V-1 H-6 V-4 H-4 V-1 H-1 V-8 H1 V-1 H4 V-4 H6 V-1 H8 V8Z"/><rect x="-1.5" y="3" width="3" height="5" fill="#2a1a10"/></g>`;
const crescent = (x, y, r, c, bg, dx = 0.28) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${c}"/><circle cx="${x + r * dx}" cy="${y}" r="${r * 0.8}" fill="${bg}"/>`;
const star = (x, y, r, c) => {
  const p = [];
  for (let i = 0; i < 10; i += 1) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const q = i % 2 ? r * 0.42 : r;
    p.push(`${(x + Math.cos(a) * q).toFixed(2)},${(y + Math.sin(a) * q).toFixed(2)}`);
  }
  return `<polygon points="${p.join(' ')}" fill="${c}"/>`;
};
const crown = (x, y, s) => `<g transform="translate(${x},${y}) scale(${s})"><path d="M-10,4 L-10,-4 L-6,0 L-3,-6 L0,-1 L3,-6 L6,0 L10,-4 L10,4Z" fill="${GD}" stroke="#6b4a10" stroke-width="0.8"/></g>`;
const burgundy = (w, h) => `<path d="M${w * 0.12},${h * 0.1} L${w * 0.88},${h * 0.9} M${w * 0.88},${h * 0.1} L${w * 0.12},${h * 0.9}" stroke="${R}" stroke-width="${h * 0.12}" stroke-dasharray="${h * 0.16} ${h * 0.03}"/>`;
const stripes = (w, h, cols, horizontal = true) => cols.map((c, i) => (horizontal ? rect(0, (i * h) / cols.length, w, h / cols.length + 0.5, c) : rect((i * w) / cols.length, 0, w / cols.length + 0.5, h, c))).join('');
// Spanish arms of 1785, simplified: crowned oval of Castile and Leon quarters.
const spanishArms = (x, y, s) => `<g transform="translate(${x},${y}) scale(${s})"><ellipse rx="9" ry="11" fill="${W}" stroke="#6b4a10" stroke-width="1"/>
<path d="M-9,0 A9,11 0 0 1 0,-11 V0Z" fill="${R}"/><path d="M9,0 A9,11 0 0 1 0,11 V0Z" fill="${R}"/>${castle(-4.5, -5, 0.45, Y)}${castle(4.5, 5, 0.45, Y)}${lion(4.5, -5, 0.35, '#7a2a8a')}${lion(-4.5, 5, 0.35, '#7a2a8a')}${crown(0, -14, 0.6)}</g>`;
const rojigualda = (w, h) => rect(0, 0, w, h, R) + rect(0, h / 4, w, h / 2, Y) + spanishArms(w * 0.3, h * 0.54, h / 40);
const tricolore = (w, h) => stripes(w, h, ['#1f3a8a', W, '#c8202f'], false);
const quartered = (w, h, a, b) => rect(0, 0, w / 2, h / 2, a[0]) + rect(w / 2, h / 2, w / 2, h / 2, a[0]) + rect(w / 2, 0, w / 2, h / 2, b[0]) + rect(0, h / 2, w / 2, h / 2, b[0]) + a[1](w / 4, h / 4) + a[1]((3 * w) / 4, (3 * h) / 4) + b[1]((3 * w) / 4, h / 4) + b[1](w / 4, (3 * h) / 4);
const tudorRose = (x, y, r) => [0, 1, 2, 3, 4].map((i) => `<circle cx="${x + Math.cos(-Math.PI / 2 + (i * 2 * Math.PI) / 5) * r * 0.55}" cy="${y + Math.sin(-Math.PI / 2 + (i * 2 * Math.PI) / 5) * r * 0.55}" r="${r * 0.5}" fill="${R}"/>`).join('') + `<circle cx="${x}" cy="${y}" r="${r * 0.42}" fill="${W}"/><circle cx="${x}" cy="${y}" r="${r * 0.15}" fill="${GD}"/>`;
const keys = (x, y, s) => `<g transform="translate(${x},${y}) scale(${s})" stroke-width="2.4" fill="none"><g stroke="${GD}" transform="rotate(40)"><path d="M0,-12 V10 M0,6 h4 M0,9 h4"/><circle cy="-15" r="3.5"/></g><g stroke="#e8e8e8" transform="rotate(-40)"><path d="M0,-12 V10 M0,6 h-4 M0,9 h-4"/><circle cy="-15" r="3.5"/></g></g>`;
const crucifix = (x, y, s, c) => `<g transform="translate(${x},${y}) scale(${s})" fill="${c}"><rect x="-1.4" y="-14" width="2.8" height="28"/><rect x="-8" y="-8" width="16" height="2.8"/></g>`;
const winged = (x, y, s) => `<g transform="translate(${x},${y}) scale(${s})">${lion(0, 3, 1, GD)}<path d="M-2,-2 C-6,-12 4,-14 6,-8 C3,-9 1,-6 0,-2Z" fill="${GD}"/><circle cx="7" cy="-5.5" r="2.6" fill="none" stroke="${GD}" stroke-width="0.8"/></g>`;
const sword = (x, y, s, c) => `<g transform="translate(${x},${y}) scale(${s})" fill="${c}"><path d="M-14,-1.5 H8 L12,-4 L14,-1.5 L14,1.5 L12,4 L8,1.5 H-14Z"/><rect x="-16" y="-4" width="2" height="8"/><rect x="-21" y="-1" width="5" height="2"/></g>`;
const santiago = (x, y, s) => `<g transform="translate(${x},${y}) scale(${s})" fill="${R}"><rect x="-1.4" y="-6" width="2.8" height="20"/><path d="M0,14 L-2.5,10 H2.5Z"/><rect x="-8" y="-3" width="16" height="2.6"/><circle cx="-8.5" cy="-1.7" r="2"/><circle cx="8.5" cy="-1.7" r="2"/><circle cy="-8" r="2"/></g>`;

// [aspect w:h, svg] per faction/sheet/flag.
const D = {
  england: {
    flags_a: {
      stgeorge: [1.5, svg(30, 20, rect(0, 0, 30, 20, W) + cross(30, 20, R, 4))],
      royal: [1.5, svg(30, 20, quartered(30, 20, [B, (x, y) => fleur(x - 3.5, y, 0.32, GD) + fleur(x + 3.5, y, 0.32, GD) + fleur(x, y + 3, 0.32, GD)], [R, (x, y) => lion(x, y - 3, 0.38, GD) + lion(x, y, 0.38, GD) + lion(x, y + 3, 0.38, GD)]))],
      ensign: [1.5, svg(30, 20, stripes(30, 20, [G, W, G, W, G, W, G, W]) + rect(0, 0, 12, 10, W) + cross(12, 10, R, 2.2))],
      admiral: [1.5, svg(30, 20, stripes(30, 20, [W, G], true) + cross(30, 20, R, 4) + tudorRose(15, 10, 3))],
    },
    flags_b: {
      greenwhite: [1.5, svg(30, 20, stripes(30, 20, [W, G]))],
      red: [1.5, svg(30, 20, rect(0, 0, 30, 20, R))],
      rose: [1.5, svg(30, 20, rect(0, 0, 30, 20, W) + tudorRose(15, 10, 5.5))],
      white: [1.5, svg(30, 20, rect(0, 0, 30, 20, W))],
    },
  },
  spain: {
    flags_a: {
      burgundy: [1.5, svg(30, 20, rect(0, 0, 30, 20, W) + burgundy(30, 20))],
      royal: [1.5, svg(30, 20, rect(0, 0, 30, 20, '#8e1a22') + spanishArms(15, 11, 0.62) + `<rect x="0.6" y="0.6" width="28.8" height="18.8" fill="none" stroke="${GD}" stroke-width="0.8"/>`)],
      virgin: [1.5, svg(30, 20, rect(0, 0, 30, 20, '#7d1420') + `<ellipse cx="15" cy="10" rx="5" ry="7" fill="${B}" stroke="${GD}" stroke-width="0.8"/><path d="M15,4.5 C17.5,6 17.5,13 18,15.5 H12 C12.5,13 12.5,6 15,4.5Z" fill="${W}"/><circle cx="15" cy="5" r="1.2" fill="#e8c9a0"/>` + crucifix(5, 10, 0.4, GD) + crucifix(25, 10, 0.4, GD))],
      castile: [1.5, svg(30, 20, quartered(30, 20, [R, (x, y) => castle(x, y, 0.5, Y)], [W, (x, y) => lion(x, y, 0.5, '#7a2a8a')]))],
    },
    flags_b: {
      santiago: [1.5, svg(30, 20, rect(0, 0, 30, 20, W) + santiago(15, 8, 0.7))],
      redgold: [1.5, svg(30, 20, stripes(30, 20, [R, Y]))],
      red: [1.5, svg(30, 20, rect(0, 0, 30, 20, R))],
      white: [1.5, svg(30, 20, rect(0, 0, 30, 20, W))],
    },
  },
  holyleague: {
    flags_a: {
      holyleague: [1.5, svg(30, 20, rect(0, 0, 30, 20, '#1e3a7a') + crucifix(15, 10, 0.6, GD) + `<rect x="0.6" y="0.6" width="28.8" height="18.8" fill="none" stroke="${GD}" stroke-width="0.8"/>`)],
      stmark: [1.5, svg(30, 20, rect(0, 0, 30, 20, '#9c1b22') + winged(14, 10, 0.8))],
      burgundy: [1.5, svg(30, 20, rect(0, 0, 30, 20, W) + burgundy(30, 20))],
      papal: [1.5, svg(30, 20, stripes(30, 20, [R, GD], false) + keys(15, 11, 0.5))],
    },
    flags_b: {
      genoa: [1.5, svg(30, 20, rect(0, 0, 30, 20, W) + cross(30, 20, R, 4))],
      redgold: [1.5, svg(30, 20, stripes(30, 20, [R, Y]))],
      red: [1.5, svg(30, 20, rect(0, 0, 30, 20, R))],
      white: [1.5, svg(30, 20, rect(0, 0, 30, 20, W))],
    },
  },
  ottoman: {
    flags_a: {
      kapudan: [1.5, svg(30, 20, rect(0, 0, 30, 20, R) + crescent(9, 10, 3, W, R) + crescent(17, 6, 2.5, W, R) + crescent(17, 14, 2.5, W, R))],
      crescent: [1.5, svg(30, 20, rect(0, 0, 30, 20, R) + crescent(13, 10, 5, W, R) + star(17.5, 10, 2, W))],
      zulfikar: [1.5, svg(30, 20, rect(0, 0, 30, 20, G) + sword(15, 10, 0.75, W) + `<path d="M24,7 L28,10 L24,13Z" fill="${G}"/>`)],
      sultan: [1.5, svg(30, 20, rect(0, 0, 30, 20, G) + crescent(14, 10, 5, GD, G) + star(18.5, 10, 2, GD))],
    },
    flags_b: {
      redgreen: [1.5, svg(30, 20, stripes(30, 20, [R, G]))],
      red: [1.5, svg(30, 20, rect(0, 0, 30, 20, R))],
      green: [1.5, svg(30, 20, rect(0, 0, 30, 20, G))],
      white: [1.5, svg(30, 20, rect(0, 0, 30, 20, W))],
    },
  },
  britain: {
    flags_a: {
      white: [2, svg(60, 30, rect(0, 0, 60, 30, W) + cross(60, 30, R, 6) + union(0, 0, 30, 15))],
      union: [2, svg(60, 30, union(0, 0, 60, 30))],
      vice: [1.5, svg(30, 20, rect(0, 0, 30, 20, W) + cross(30, 20, R, 4))],
      blue: [2, svg(60, 30, rect(0, 0, 60, 30, NB) + union(0, 0, 30, 15))],
    },
    flags_b: {
      pendant: [1.5, svg(30, 20, rect(0, 0, 30, 20, W) + rect(0, 0, 3, 20, R))],
      red: [1.5, svg(30, 20, rect(0, 0, 30, 20, R))],
      white: [1.5, svg(30, 20, rect(0, 0, 30, 20, W))],
      signal: [1.5, svg(30, 20, rect(0, 0, 30, 20, Y) + rect(0, 0, 15, 10, B) + rect(15, 10, 15, 10, B))],
    },
  },
  france: {
    flags_a: {
      tricolore: [1.5, svg(30, 20, tricolore(30, 20))],
      admiral: [1, svg(20, 20, tricolore(20, 20))],
      jack: [1.5, svg(30, 20, tricolore(30, 20) + `<rect x="0.6" y="0.6" width="28.8" height="18.8" fill="none" stroke="${W}" stroke-width="1.2"/>`)],
      blue: [1.5, svg(30, 20, rect(0, 0, 30, 20, '#1f3a8a'))],
    },
    flags_b: {
      pendant: [1.5, svg(30, 20, stripes(30, 20, ['#1f3a8a', W, '#c8202f']))],
      red: [1.5, svg(30, 20, rect(0, 0, 30, 20, '#c8202f'))],
      white: [1.5, svg(30, 20, rect(0, 0, 30, 20, W))],
      signal: [1.5, svg(30, 20, rect(0, 0, 30, 20, W) + rect(0, 0, 30, 6.7, '#c8202f') + rect(0, 13.3, 30, 6.7, '#1f3a8a'))],
    },
  },
  spain1805: {
    flags_a: {
      rojigualda: [1.5, svg(30, 20, rojigualda(30, 20))],
      admiral: [1, svg(20, 20, rojigualda(20, 20))],
      jack: [1.5, svg(30, 20, quartered(30, 20, [R, (x, y) => castle(x, y, 0.5, Y)], [W, (x, y) => lion(x, y, 0.5, '#7a2a8a')]) + `<rect x="0.6" y="0.6" width="28.8" height="18.8" fill="none" stroke="${Y}" stroke-width="1.2"/>`)],
      yellow: [1.5, svg(30, 20, rect(0, 0, 30, 20, Y))],
    },
    flags_b: {
      pendant: [1.5, svg(30, 20, stripes(30, 20, [R, Y, R]))],
      red: [1.5, svg(30, 20, rect(0, 0, 30, 20, R))],
      white: [1.5, svg(30, 20, rect(0, 0, 30, 20, W))],
      signal: [1.5, svg(30, 20, rect(0, 0, 30, 20, Y) + cross(30, 20, R, 5))],
    },
  },
};

// The navies with a spare cell (their unused saint's sail) fly their ensign and command flag from it at twice the
// pixels: a 1x2 sheet of two wide slots.
for (const [faction, names] of Object.entries({ holyleague: ['holyleague', 'stmark'], britain: ['white', 'vice'], france: ['tricolore', 'admiral'], spain1805: ['rojigualda', 'admiral'] })) {
  D[faction].flags_c = Object.fromEntries(names.map((n) => [n, D[faction].flags_a[n]]));
}

// A faint weave and a light hoist-to-fly fade so the cloth reads as cloth, not a decal.
const weave = await sharp({ create: { width: S, height: S, channels: 3, background: '#808080' } })
  .composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}"><defs><pattern id="p" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="4" height="4" fill="#808080"/><rect width="2" height="2" fill="#8a8a8a"/><rect x="2" y="2" width="2" height="2" fill="#767676"/></pattern><linearGradient id="g"><stop offset="0" stop-color="#848484"/><stop offset="1" stop-color="#787878"/></linearGradient></defs><rect width="${S}" height="${S}" fill="url(#g)"/><rect width="${S}" height="${S}" fill="url(#p)" opacity="0.6"/></svg>`) }])
  .png()
  .toBuffer();

const layout = JSON.parse(await readFile(LAYOUT, 'utf8'));
const aspect = {};
const only = args.faction ? new Set(args.faction.split(',')) : null;
for (const [faction, sheets] of Object.entries(D)) {
  if (only && !only.has(faction)) continue;
  await mkdir(join(CACHE, faction), { recursive: true });
  for (const [sheet, flags] of Object.entries(sheets)) {
    const slot = layout.factions[faction].find((s) => s.name === sheet);
    for (const f of slot.flags) {
      const d = flags[f.name];
      if (!d) throw new Error(`no design for ${faction}/${sheet}/${f.name}`);
      aspect[`${faction}/${sheet}/${f.name}`] = d[0];
      await sharp(Buffer.from(d[1])).composite([{ input: weave, blend: 'soft-light' }]).removeAlpha().png().toFile(join(CACHE, faction, `${sheet}__${f.name}_1.png`));
    }
  }
  console.log(`drew ${faction}`);
}
if (!only) await writeFile(ASPECT, `${JSON.stringify(aspect, null, 1)}
`);
