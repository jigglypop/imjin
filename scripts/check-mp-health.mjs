// Exit successfully only when the endpoint runs the protocol and bundle about to serve this site.
import { readFileSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [key, ...value] = arg.replace(/^--/, '').split('=');
  return [key, value.join('=')];
}));
const protocol = Number(/export const PROTOCOL = (\d+)/.exec(readFileSync(new URL('../src/net/protocol.ts', import.meta.url), 'utf8'))?.[1]);
const protocolOnly = Object.hasOwn(args, 'protocol-only');
const revision = protocolOnly ? null : args.revision || JSON.parse(readFileSync(new URL('../server/dist/build.json', import.meta.url), 'utf8')).revision;
if (!protocol || (!protocolOnly && !revision) || !args.url) throw new Error('health check requires --url and a built revision');

try {
  const response = await fetch(args.url, { signal: AbortSignal.timeout(10000), cache: 'no-store' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const health = await response.json();
  if (health.ok !== true || health.protocol !== protocol || (!protocolOnly && health.revision !== revision)) {
    throw new Error(`expected protocol ${protocol} revision ${revision}; received protocol ${health.protocol} revision ${health.revision}`);
  }
  console.log(`multiplayer health verified: protocol ${protocol}${protocolOnly ? ' (server deployment is not configured)' : `, revision ${revision}`}`);
} catch (error) {
  console.error(`multiplayer health failed: ${error.message}`);
  process.exitCode = 1;
}
