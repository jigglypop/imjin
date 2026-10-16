// The hanja faces of the captions, titles and names (public/ui/fonts/README.md): every hanja the game sets in that face
// (the `hanja:` and `native:` fields across src/, the navies' seals), cut from Shippori Mincho B1 at two weights, and
// the few characters that face lacks from Noto Serif TC, which the stylesheets list after it.
//
//   node scripts/hanja-fonts.mjs --src=<folder with ShipporiMinchoB1-Regular.ttf, ShipporiMinchoB1-SemiBold.ttf, NotoSerifTC[wght].ttf>
//
// Needs Python with fontTools and brotli (pip install fonttools brotli). Rerun after adding a caption, a region or a ship
// whose hanja is new: a missing character would fall back to the page's other faces.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.join('=')]; }));
if (!args.src) throw new Error('--src=<folder with the source fonts>');
const OUT = join(ROOT, 'public', 'ui', 'fonts');

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* files(p);
    else if (/\.(ts|tsx)$/.test(name)) yield p;
  }
}

const HAN = /[㐀-鿿豈-﫿]/gu;
const chars = new Set();
for (const file of files(join(ROOT, 'src'))) {
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(/\b(?:hanja|native)\s*:\s*'([^']*)'/g)) for (const c of m[1].match(HAN) ?? []) chars.add(c);
  const seal = text.match(/NAVY_SEAL[^=]*=\s*\{([^}]*)\}/);
  if (seal) for (const c of seal[1].match(HAN) ?? []) chars.add(c);
}
const text = [...chars].sort().join('');
console.log(`${chars.size} hanja`);

const py = (code, ...rest) => execFileSync('python', ['-I', '-c', code, ...rest], { encoding: 'utf8' });
const missing = py(
  'import sys\nfrom fontTools.ttLib import TTFont\ncmap = TTFont(sys.argv[1], lazy=True).getBestCmap()\nsys.stdout.reconfigure(encoding="utf-8")\nprint("".join(c for c in sys.argv[2] if ord(c) not in cmap), end="")',
  join(args.src, 'ShipporiMinchoB1-Regular.ttf'),
  text,
);
const subset = (font, glyphs, out) => {
  execFileSync('python', ['-m', 'fontTools.subset', join(args.src, font), `--text=${glyphs}`, '--flavor=woff2', "--layout-features=*", '--name-IDs=*', '--name-languages=*', `--output-file=${join(OUT, out)}`], { stdio: 'inherit' });
  console.log(`${out}: ${statSync(join(OUT, out)).size} bytes`);
};
subset('ShipporiMinchoB1-Regular.ttf', text, 'imjin-hanja-shippori-400.woff2');
subset('ShipporiMinchoB1-SemiBold.ttf', text, 'imjin-hanja-shippori-600.woff2');
console.log(`not in Shippori Mincho B1: ${missing || '(none)'}`);
if (missing) subset('NotoSerifTC[wght].ttf', missing, 'imjin-hanja-notoseriftc.woff2');
