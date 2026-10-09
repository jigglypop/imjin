// Translation coverage. Lists
//   1. t('...') keys (static first arguments) that have no English entry in src/i18n/en/*.ts, and
//   2. Korean string literals and JSX text that are not passed through t() and have no English entry either
//      (data in src/sim is fine as long as it has an entry: the UI translates it where it is shown).
//   node scripts/i18n-check.mjs [--area=src/ui/grand] [--list] [--strict]
// --strict exits 1 when anything is missing. Comments are ignored; console messages and tests are not player-facing.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.join('=') || 'true']; }));
const area = args.area ? join(ROOT, args.area) : join(ROOT, 'src');
const HANGUL = /[\uac00-\ud7a3]/;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

/** The English dictionary: Korean keys from every src/i18n/en/*.ts object literal. */
function dictionary() {
  const keys = new Set();
  for (const f of walk(join(ROOT, 'src/i18n/en'))) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/^\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")\s*:/gm)) keys.add(unescape(m[1] ?? m[2]));
  }
  return keys;
}

function unescape(s) {
  return s.replace(/\\(['"\\])/g, '$1').replace(/\\n/g, '\n');
}

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:'"`])\/\/[^\n]*/g, (m, p) => p + ' '.repeat(m.length - p.length));
}

const dict = dictionary();
const missingKeys = new Map();
const unwrapped = new Map();
const LITERAL = /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g;

for (const file of walk(area)) {
  if (file.includes('/src/i18n/')) continue;
  const rel = relative(ROOT, file);
  const src = stripComments(readFileSync(file, 'utf8'));
  const lineOf = (i) => src.slice(0, i).split('\n').length;
  // 1. t('...') calls with a static first argument.
  for (const m of src.matchAll(/\bt\(\s*('(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*")/g)) {
    const key = unescape(m[1].slice(1, -1));
    if (HANGUL.test(key) && !dict.has(key)) missingKeys.set(key, `${rel}:${lineOf(m.index)}`);
  }
  // 2. Other Korean literals and JSX text.
  for (const m of src.matchAll(LITERAL)) {
    const lit = m[0];
    if (!HANGUL.test(lit)) continue;
    const before = src.slice(Math.max(0, m.index - 4), m.index);
    if (/\bt\(\s*$/.test(before)) continue; // already t('...')
    if (/console\.\w+\(\s*$/.test(src.slice(Math.max(0, m.index - 16), m.index))) continue;
    const text = lit.slice(1, -1);
    if (lit[0] !== '`' && dict.has(unescape(text))) continue; // data with an entry
    unwrapped.set(`${rel}:${lineOf(m.index)}`, text.slice(0, 80));
  }
  if (file.endsWith('.tsx')) {
    for (const m of src.matchAll(/>([^<>{}]*[\uac00-\ud7a3][^<>{}]*)</g)) {
      const text = m[1].trim();
      if (!text || dict.has(text)) continue;
      unwrapped.set(`${rel}:${lineOf(m.index)}`, `JSX ${text.slice(0, 76)}`);
    }
  }
}

console.log(`dictionary entries: ${dict.size}`);
console.log(`t() keys without English: ${missingKeys.size}`);
console.log(`Korean text not passed through t() and without an entry: ${unwrapped.size}`);
if (args.list) {
  for (const [k, where] of missingKeys) console.log(`  missing  ${where}  ${k}`);
  for (const [where, text] of unwrapped) console.log(`  unwrapped  ${where}  ${text}`);
} else {
  const byFile = new Map();
  for (const where of [...missingKeys.values(), ...unwrapped.keys()]) {
    const f = where.split(':')[0];
    byFile.set(f, (byFile.get(f) ?? 0) + 1);
  }
  for (const [f, n] of [...byFile].sort((a, b) => b[1] - a[1]).slice(0, 40)) console.log(`  ${String(n).padStart(4)}  ${f}`);
}
if (args.strict && (missingKeys.size || unwrapped.size)) process.exit(1);
