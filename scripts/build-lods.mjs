import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const SRC = join(ROOT, 'assets-src', 'models');
const OUT = join(ROOT, 'public', 'models');

const LODS = [
  { suffix: '', args: ['--texture-size', process.env.LOD0_TEX ?? '2048'] },
  { suffix: '_lod1', args: ['--simplify', 'true', '--simplify-ratio', '0.12', '--simplify-error', '0.004', '--texture-size', '1024'] },
  { suffix: '_lod2', args: ['--simplify', 'true', '--simplify-ratio', '0.015', '--simplify-error', '0.03', '--texture-size', '512'] },
];

const names = process.argv.slice(2);
if (!names.length) {
  console.log('usage: node scripts/build-lods.mjs <source-name-without-ext>... [OUT_NAME=alias]');
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });
const cli = join(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'gltf-transform.cmd' : 'gltf-transform');
const useNpx = !existsSync(cli);

for (const entry of names) {
  const [source, alias] = entry.split('=');
  const input = join(SRC, `${source}.glb`);
  if (!existsSync(input)) {
    console.error('missing', input);
    continue;
  }
  for (const lod of LODS) {
    const output = join(OUT, `${alias ?? source}${lod.suffix}.glb`);
    const args = ['optimize', input, output, '--compress', 'meshopt', '--texture-compress', 'webp', ...lod.args];
    if (useNpx) execFileSync('npx', ['-y', '@gltf-transform/cli', ...args], { stdio: 'pipe', shell: true });
    else execFileSync(cli, args, { stdio: 'pipe', shell: true });
    console.log(output, Math.round(statSync(output).size / 1024), 'KB');
  }
}
