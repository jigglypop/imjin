#!/usr/bin/env node
// Runs every check `npm test` covers, several at a time, and keeps going past a failure so one broken check does not
// hide the rest. Prints each failing check's output and exits 1 if any failed.
//   node scripts/run-tests.mjs [name-filter ...]   (--serial runs one at a time; TEST_JOBS sets the parallelism)
import { spawn } from 'node:child_process';
import { availableParallelism } from 'node:os';

// The checks of `npm test`, in their old order. Scripts left out (test-accounts-pg, test-campaign, the general-motion
// probes) need a database, the GPU or long runs and are started by hand.
const TESTS = [
  'sim', 'render', 'net', 'server', 'ranked', 'accounts', 'grand', 'grand-support', 'balance', 'conquest-depth',
  'controls', 'visibility', 'kinds', 'chapters', 'tender', 'observation', 'dispatch', 'grand-intel', 'grand-rules',
  'grand-ports', 'grand-merge', 'grand-box', 'grand-auto', 'grand-march', 'grand-growth', 'grand-armada',
  'grand-lepanto', 'grand-trafalgar', 'region-terrain', 'environment', 'damage', 'depth', 'coastal-tactics', 'map',
  'map-world', 'camp-kits', 'world-camera', 'world-trees', 'screen-path', 'dragonhead', 'router', 'hero-camps',
  'maneuvers', 'meta', 'meta-server', 'meta-fleet', 'port', 'generals-model', 'idle-blade', 'assets', 'battle-art',
];

const args = process.argv.slice(2);
const serial = args.includes('--serial');
const filters = args.filter((arg) => !arg.startsWith('--'));
const tests = filters.length ? TESTS.filter((name) => filters.some((f) => name.includes(f))) : TESTS;
const jobs = serial ? 1 : Math.max(1, Number(process.env.TEST_JOBS) || Math.min(8, availableParallelism() - 1));

function run(name) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, [`scripts/test-${name}.mjs`], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', (chunk) => (output += chunk));
    child.on('close', (code) => {
      const seconds = ((Date.now() - started) / 1000).toFixed(1);
      console.log(`${code === 0 ? 'ok  ' : 'FAIL'} ${name} (${seconds}s)`);
      resolve({ name, code, output });
    });
  });
}

const queue = [...tests];
const results = [];
await Promise.all(
  Array.from({ length: Math.min(jobs, queue.length) }, async () => {
    while (queue.length) results.push(await run(queue.shift()));
  }),
);

const failed = results.filter((r) => r.code !== 0);
for (const { name, output } of failed) console.log(`\n===== test-${name}.mjs =====\n${output.trimEnd()}`);
console.log(`\n${results.length - failed.length}/${results.length} checks passed${failed.length ? `; failed: ${failed.map((r) => r.name).join(', ')}` : ''}`);
process.exit(failed.length ? 1 : 0);
