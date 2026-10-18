// Every historical battle of every chapter has its own pictures: the loading picture in its three cuts
// (public/ui/art/loading_<id>.webp, _sm, _tall) that the loading screen shows, and its own link card in both editions
// (public/og/<id>-<ko|en>-v<n>.jpg, src/routes.ts cardFile) instead of the front card. The binaries live in the asset
// store, so this checks the committed manifest (assets.json), which holds in CI without a pull, and the files themselves
// where a checkout has them. scripts/build-battle-art.mjs makes them.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { transformSync } from 'esbuild';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const code = transformSync(readFileSync(join(ROOT, 'src/routes.ts'), 'utf8'), { loader: 'ts', format: 'esm' }).code;
const { CHAPTER_IDS, battlesOf, cardFile } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const manifest = JSON.parse(readFileSync(join(ROOT, 'assets.json'), 'utf8'));
const files = manifest.files ?? manifest;

let failures = 0;
const check = (name, fn) => {
  try {
    fn();
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${name}: ${error.message}`);
  }
};
const present = (rel) => {
  assert.ok(rel in files, `${rel} is not in assets.json`);
  const abs = join(ROOT, rel);
  if (existsSync(abs)) assert.ok(statSync(abs).size > 1000, `${rel} is empty`);
};

// Battles whose stills are not captured yet (they share the front card meanwhile): remove each as it lands.
const PENDING = new Set(['wight', 'nile', 'finisterre']);
let battles = 0;
for (const chapter of CHAPTER_IDS) {
  for (const id of battlesOf(chapter)) {
    if (PENDING.has(id)) continue;
    battles += 1;
    check(`${chapter}/${id} loading picture`, () => {
      for (const cut of ['', '_sm', '_tall']) present(`public/ui/art/loading_${id}${cut}.webp`);
    });
    check(`${chapter}/${id} link card`, () => {
      for (const edition of ['ko', 'en']) {
        const card = cardFile(id, edition);
        assert.ok(!card.startsWith('og/front-'), `${id} shares the front card (${card}): give it its own in CARD_VERSION`);
        present(`public/${card}`);
      }
    });
  }
}
if (failures) {
  console.error(`test-battle-art: ${failures} failing`);
  process.exit(1);
}
console.log(`test-battle-art: ${battles} battles each have their loading picture and link cards`);
