// The accounts regression on a real PostgreSQL. Opt-in, as it needs a throwaway server:
//   DATABASE_TEST_URL=postgres://user:password@127.0.0.1:55432/postgres?sslmode=disable node scripts/test-accounts-pg.mjs
// The user must be allowed to create databases: the run makes one of its own on that server and drops it at the end,
// so nothing already there is touched. Never point it at a database in use.
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { runAccountsSuite } from './accounts-suite.mjs';

const given = process.env.DATABASE_TEST_URL;
if (!given) {
  console.log('test-accounts-pg skipped: set DATABASE_TEST_URL to a throwaway PostgreSQL');
  process.exit(0);
}
const database = `imjin_accounts_${randomBytes(4).toString('hex')}`;
const target = new URL(given);
target.pathname = `/${database}`;
const url = target.toString();
const admin = new pg.Client({ connectionString: given });
await admin.connect();
await admin.query(`CREATE DATABASE ${database}`);
const raw = new pg.Client({ connectionString: url });
try {
  await raw.connect();
  const password = decodeURIComponent(target.password);
  await runAccountsSuite({
    name: 'postgres',
    serverEnv: { DATABASE_URL: url },
    openStore: (m) => new m.PgAccountStore(m.databaseConfig({ DATABASE_URL: url })),
    shared: true,
    sql: async (text, values) => (await raw.query(text, values)).rows,
    // A short password could turn up inside a random token by chance.
    secrets: password.length >= 12 ? [password] : [],
  });
} finally {
  await raw.end().catch(() => undefined);
  await admin.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
  await admin.end();
}
