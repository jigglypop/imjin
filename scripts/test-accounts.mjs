// Accounts regression on the store kept in memory (ACCOUNTS_STORE=memory), which needs no database: the same suite
// test-accounts-pg.mjs runs on a real PostgreSQL.
import { runAccountsSuite } from './accounts-suite.mjs';

await runAccountsSuite({ name: 'memory', serverEnv: { ACCOUNTS_STORE: 'memory' }, openStore: (m) => new m.MemoryAccountStore(), shared: false });
