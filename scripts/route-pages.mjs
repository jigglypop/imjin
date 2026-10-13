// The pages the build writes (one per address in src/routes.ts) and the storage keys each is uploaded under, one
// "<file under dist/> <key>" pair per line. The deploy (.github/workflows/deploy.yml, scripts/deploy.sh) uploads each
// pair as an HTML page and keeps the keys out of its sync --delete.
//   node scripts/route-pages.mjs
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';

// src/routes.ts has no imports, so stripping its types is all it takes to run it here.
const source = transformSync(readFileSync(new URL('../src/routes.ts', import.meta.url), 'utf8'), { loader: 'ts', format: 'esm' }).code;
const { routePages } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

for (const page of routePages()) for (const key of page.keys) console.log(`${page.file} ${key}`);
