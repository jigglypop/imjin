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
  outfile: 'server/dist/server.cjs',
  logLevel: 'warning',
});
await mkdir(new URL('../server/dist/', import.meta.url), { recursive: true });
await writeFile(new URL('../server/dist/build.json', import.meta.url), JSON.stringify({ revision }) + '\n');
