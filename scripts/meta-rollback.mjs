// Rolls the accounts database back from schema 2 to schema 1, for going back to a server built before the growth
// tables: every user's rows (meta_accounts, commander_progress, items, equipment, owned_armor) are written back as the
// JSON of schema 1 (profiles.data.meta), each in its own transaction, and schema_version is set to 1. The tables stay
// (a server of schema 1 never reads them); a later server of schema 2 finds the JSON, which wins over the rows, and
// moves it again. Stop the multiplayer server first: a server of schema 2 still running would move the JSON back.
//   node --env-file=.env.development scripts/meta-rollback.mjs [--dry-run]     (production: DATABASE_URL of the RDS)
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const dry = process.argv.includes('--dry-run');
const root = fileURLToPath(new URL('..', import.meta.url));
const directory = await mkdtemp(join(tmpdir(), 'imjin-rollback-'));
try {
  const file = join(directory, 'rollback.cjs');
  await build({
    stdin: { contents: "export * from './server/accountsPg.ts'; export { exportJsonMeta } from './server/meta.ts';", resolveDir: root, loader: 'ts' },
    outfile: file, platform: 'node', format: 'cjs', bundle: true, external: ['pg-native'], logLevel: 'silent',
  });
  const m = createRequire(import.meta.url)(file);
  const config = m.databaseConfig(process.env);
  if (!config) throw new Error('set DATABASE_URL (or PGHOST and the rest)');
  const store = new m.PgAccountStore(config);
  try {
    if (!(await store.connected)) throw new Error('the database is not reachable or is newer than this checkout');
    const pg = (await import('pg')).default;
    const client = new pg.Client(config);
    await client.connect();
    try {
      const users = (await client.query('SELECT user_id FROM meta_accounts ORDER BY user_id')).rows.map((r) => r.user_id);
      console.log(`${users.length} growth profiles in tables${dry ? ' (dry run: nothing written)' : ''}`);
      if (!dry) {
        let wrote = 0;
        for (const id of users) if (await m.exportJsonMeta(store, id)) wrote++;
        await client.query('UPDATE schema_version SET version = 1');
        console.log(`wrote ${wrote} profiles back as JSON; schema_version is 1. Deploy the older server now.`);
      }
    } finally {
      await client.end();
    }
  } finally {
    await store.close();
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}
