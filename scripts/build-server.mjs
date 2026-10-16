// Embed the source revision in the server bundle so deployment can verify what the host runs.
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('..', import.meta.url));
const revision = process.env.GITHUB_SHA || execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
await build({
  absWorkingDir: root,
  entryPoints: ['server/main.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  define: { IMJIN_BUILD_REVISION: JSON.stringify(revision) },
  // The host gets this one file and no node_modules, so pg goes inside it. Its optional native binding is only loaded
  // when asked for (pg.native, NODE_PG_FORCE_NATIVE), which the server never does.
  external: ['pg-native'],
  outfile: 'server/dist/server.cjs',
  logLevel: 'warning',
});
await mkdir(new URL('../server/dist/', import.meta.url), { recursive: true });
await writeFile(new URL('../server/dist/build.json', import.meta.url), JSON.stringify({ revision }) + '\n');
