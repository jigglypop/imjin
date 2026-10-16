// Accounts in PostgreSQL (the RDS instance in production) through one small pool. Each change is a transaction that
// locks the rows it reads (SELECT ... FOR UPDATE); the user's profile row is the lock that puts their currency changes,
// claims and profile writes in one order. Times are epoch milliseconds in bigint columns, the profile a jsonb object.
import { readFileSync } from 'node:fs';
import { DatabaseError, Pool, TypeOverrides, types, type PoolClient, type PoolConfig } from 'pg';
import { SESSION_RULE } from '../src/account/wire';
import {
  AccountError,
  SESSION_MS,
  balanceAfter,
  checkClaimKey,
  checkLedgerChange,
  hashSession,
  newSessionToken,
  newUserId,
  profileText,
  type AccountStore,
  type LedgerChange,
  type LedgerEntry,
  type LinkOutcome,
  type Profile,
  type ProfileData,
  type ProfileTx,
  type SignedIn,
  type UserRecord,
} from './accounts';

/**
 * Forward migrations: entry i takes the schema from version i to i + 1, each in one transaction with the version it
 * reaches (schema_version). A shipped entry is never edited; a change is a new entry. Nothing cascades a delete, and a
 * trigger refuses to update or delete a ledger entry.
 */
export const MIGRATIONS = [
  `CREATE TABLE users (
     id text PRIMARY KEY CHECK (id ~ '^[a-f0-9]{24}$'),
     login text CHECK (login ~ '^[a-z0-9_]{4,16}$'),
     password text,
     nickname text NOT NULL CHECK (char_length(nickname) BETWEEN 1 AND 16),
     ranked_id text CONSTRAINT users_ranked UNIQUE,
     created bigint NOT NULL,
     last_seen bigint NOT NULL
   );
   CREATE UNIQUE INDEX users_login ON users (lower(login));
   CREATE TABLE sessions (
     hash text PRIMARY KEY,
     user_id text NOT NULL REFERENCES users (id),
     created bigint NOT NULL,
     expires bigint NOT NULL,
     last_used bigint NOT NULL
   );
   CREATE INDEX sessions_user ON sessions (user_id);
   CREATE INDEX sessions_expires ON sessions (expires);
   CREATE TABLE profiles (
     user_id text PRIMARY KEY REFERENCES users (id),
     data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object'),
     rev integer NOT NULL
   );
   CREATE TABLE ledger (
     id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
     user_id text NOT NULL REFERENCES users (id),
     at bigint NOT NULL,
     kind text NOT NULL,
     amount bigint NOT NULL,
     item text,
     reason text NOT NULL,
     balance_after bigint NOT NULL CHECK (balance_after >= 0)
   );
   CREATE INDEX ledger_balance ON ledger (user_id, kind, id);
   CREATE FUNCTION ledger_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
   BEGIN
     RAISE EXCEPTION 'the ledger is append-only';
   END $$;
   CREATE TRIGGER ledger_append_only BEFORE UPDATE OR DELETE ON ledger FOR EACH ROW EXECUTE FUNCTION ledger_append_only();
   CREATE TABLE claims (
     key text PRIMARY KEY,
     user_id text NOT NULL REFERENCES users (id),
     at bigint NOT NULL
   );`,
];
/** pg_advisory_lock key: two servers starting at once take turns to migrate. */
const SCHEMA_LOCK = 1592_0001;
/** Reconnection waits: a second at first, doubling to half a minute. */
const FIRST_RETRY_MS = 1000;
const RETRY_MS = 30000;
/** SQLSTATE classes of a database that cannot answer now (connection lost, shutting down, locks), not of a bad request. */
const UNAVAILABLE = /^(08|53|57P)/;
const BUSY = new Set(['40001', '40P01', '55P03', '57014']);

export type DatabaseConfig = Pick<PoolConfig, 'host' | 'port' | 'user' | 'password' | 'database' | 'ssl' | 'connectionTimeoutMillis'>;

/**
 * The database the environment names: DATABASE_URL (postgres://user:pass@host:5432/imjin, its query may carry sslmode
 * and sslrootcert) or the libpq variables PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE, PGSSLMODE and PGSSLROOTCERT.
 * sslmode is verify-full unless told otherwise: TLS whose certificate must chain to the CA in sslrootcert (for RDS,
 * AWS's bundle from https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem) or to one Node trusts, and name
 * the host. verify-ca skips the name, require encrypts without checking the certificate, and disable (no TLS) is only
 * for a database on this machine. connect_timeout (PGCONNECT_TIMEOUT) gives a new connection that many seconds, 10 by
 * default. Null when nothing is configured.
 */
export function databaseConfig(env: NodeJS.ProcessEnv): DatabaseConfig | null {
  const url = env.DATABASE_URL ? new URL(env.DATABASE_URL) : null;
  if (!url && !env.PGHOST) return null;
  const decode = (value: string | undefined) => (value ? decodeURIComponent(value) : undefined);
  const mode = url?.searchParams.get('sslmode') ?? env.PGSSLMODE ?? 'verify-full';
  const rootCert = url?.searchParams.get('sslrootcert') ?? env.PGSSLROOTCERT;
  const ca = rootCert ? readFileSync(rootCert, 'utf8') : undefined;
  const seconds = Number(url?.searchParams.get('connect_timeout') ?? env.PGCONNECT_TIMEOUT ?? 10);
  let ssl: DatabaseConfig['ssl'];
  if (mode === 'disable') ssl = false;
  else if (mode === 'require') ssl = { rejectUnauthorized: false };
  else if (mode === 'verify-ca') ssl = { ca, rejectUnauthorized: true, checkServerIdentity: () => undefined };
  else if (mode === 'verify-full') ssl = { ca, rejectUnauthorized: true };
  else throw new Error(`sslmode ${mode} is not one of disable, require, verify-ca, verify-full`);
  return {
    host: url ? url.hostname.replace(/^\[|\]$/g, '') : env.PGHOST,
    port: Number(url?.port || env.PGPORT || 5432),
    user: decode(url?.username) ?? env.PGUSER,
    password: decode(url?.password) ?? env.PGPASSWORD,
    database: decode(url?.pathname.slice(1)) ?? env.PGDATABASE,
    ssl,
    connectionTimeoutMillis: (seconds > 0 ? seconds : 10) * 1000,
  };
}

/** What can be said of a database failure in a log: its code and message, which never carry the password. */
export function describeFailure(error: unknown) {
  if (!(error instanceof Error)) return 'unknown error';
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? `${code} ${error.message}` : error.message;
}


/** A unique index or constraint that refused a row. */
const refused = (error: unknown, constraint: string) => error instanceof DatabaseError && error.code === '23505' && error.constraint === constraint;

type UserRow = { id: string; login: string | null; password: string | null; nickname: string; ranked_id: string | null; created: number; last_seen: number };
const record = (row: UserRow): UserRecord => ({ id: row.id, login: row.login, password: row.password, nickname: row.nickname, rankedId: row.ranked_id, created: row.created, lastSeen: row.last_seen });
type EntryRow = { id: number; at: number; kind: string; amount: number; item: string | null; reason: string; balance_after: number };
const entryOf = (row: EntryRow): LedgerEntry => ({ id: row.id, at: row.at, kind: row.kind, amount: row.amount, item: row.item, reason: row.reason, balanceAfter: row.balance_after });

/** bigint arrives as a string by default; every bigint here (times, amounts, ids) fits a number exactly. */
const parsers = new TypeOverrides();
parsers.setTypeParser(types.builtins.INT8, (value: string) => Number(value));

/** One statement and its rows, on the pool or on a transaction's connection. */
type Run = <R extends object>(text: string, values?: unknown[]) => Promise<R[]>;

/**
 * What a failed database call means to the routes: a database that cannot answer now is 'unavailable' (logged), a lock
 * it gave up on 'busy'; a statement the database refused (a constraint) stays as it is for the caller to read. Only
 * errors from database calls come here, never one thrown by a caller's own code.
 */
function failed(error: unknown): unknown {
  const code = (error as { code?: unknown } | null)?.code;
  if (error instanceof DatabaseError) {
    if (typeof code === 'string' && BUSY.has(code)) return new AccountError('busy');
    if (!(typeof code === 'string' && UNAVAILABLE.test(code))) return error;
  }
  console.error('accounts database failed:', describeFailure(error));
  return new AccountError('unavailable');
}

const runner = (db: Pool | PoolClient): Run => async (text, values = []) => {
  try {
    return (await db.query(text, values)).rows;
  } catch (error) {
    throw failed(error);
  }
};

export class PgAccountStore implements AccountStore {
  ready = false;
  /** Settles after the first attempt to connect and migrate: true when the store serves. */
  readonly connected: Promise<boolean>;
  private pool: Pool;
  private run: Run;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private wait = FIRST_RETRY_MS;
  private closed = false;

  constructor(config: DatabaseConfig, readonly sessionMs = SESSION_MS) {
    this.pool = new Pool({ connectionTimeoutMillis: 10000, ...config, max: 5, idleTimeoutMillis: 30000, statement_timeout: 10000, application_name: 'imjin', types: parsers });
    // A connection that breaks while idle (the database restarting, say) is reported here; without a listener it
    // would end the process.
    this.pool.on('error', (error) => console.error('accounts database connection lost:', describeFailure(error)));
    this.run = runner(this.pool);
    this.connected = this.connect();
  }

  /**
   * Migrates, then serves. A database that cannot be reached is tried again, soon at first and then every 30 s, so a
   * server that starts while it is briefly away soon has accounts; one newer than this server is left alone.
   */
  private async connect(): Promise<boolean> {
    try {
      const version = await this.migrate();
      this.ready = true;
      console.log(`accounts: PostgreSQL ready at schema ${version}`);
      return true;
    } catch (error) {
      const newer = error instanceof Error && error.message.startsWith('accounts database is schema');
      const again = !newer && !this.closed;
      console.error(`accounts: PostgreSQL unavailable (${describeFailure(error)})${again ? `, trying again in ${this.wait / 1000} s` : ''}`);
      if (again) {
        this.retry = setTimeout(() => void this.connect(), this.wait);
        this.wait = Math.min(RETRY_MS, this.wait * 2);
        this.retry.unref();
      }
      return false;
    }
  }

  private async migrate(): Promise<number> {
    const client = await this.pool.connect();
    try {
      await client.query('SELECT pg_advisory_lock($1)', [SCHEMA_LOCK]);
      await client.query('CREATE TABLE IF NOT EXISTS schema_version (version integer NOT NULL)');
      let version = (await client.query<{ version: number }>('SELECT version FROM schema_version')).rows[0]?.version;
      if (version === undefined) {
        await client.query('INSERT INTO schema_version (version) VALUES (0)');
        version = 0;
      }
      if (version > MIGRATIONS.length) throw new Error(`accounts database is schema ${version}, this server knows ${MIGRATIONS.length}`);
      for (; version < MIGRATIONS.length; version++) {
        await client.query('BEGIN');
        try {
          await client.query(MIGRATIONS[version]!);
          await client.query('UPDATE schema_version SET version = $1', [version + 1]);
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }
      }
      return version;
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [SCHEMA_LOCK]).catch(() => undefined);
      client.release();
    }
  }

  /** Runs `work` on one connection between BEGIN and COMMIT; rolled back when anything in it throws. */
  private async transaction<T>(work: (run: Run) => Promise<T>): Promise<T> {
    let client: PoolClient;
    try {
      client = await this.pool.connect();
    } catch (error) {
      throw failed(error);
    }
    const run = runner(client);
    let broken = false;
    try {
      await run('BEGIN');
      const result = await work(run);
      await run('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {
        broken = true;
      });
      throw error;
    } finally {
      // A connection that could not even roll back is not handed to the next caller.
      client.release(broken);
    }
  }

  async user(id: string) {
    const [row] = await this.run<UserRow>('SELECT * FROM users WHERE id = $1', [id]);
    return row ? record(row) : null;
  }

  async userByLogin(login: string) {
    const [row] = await this.run<UserRow>('SELECT * FROM users WHERE lower(login) = lower($1)', [login]);
    return row ? record(row) : null;
  }

  private async insertUser(run: Run, login: string | null, password: string | null, nickname: string, now: number) {
    const [row] = await run<UserRow>('INSERT INTO users (id, login, password, nickname, created, last_seen) VALUES ($1, $2, $3, $4, $5, $5) RETURNING *', [newUserId(), login, password, nickname, now]);
    await run("INSERT INTO profiles (user_id, data, rev) VALUES ($1, '{}', 0)", [row!.id]);
    return record(row!);
  }

  createGuest(nickname: string, now = Date.now()) {
    return this.transaction((run) => this.insertUser(run, null, null, nickname, now));
  }

  async createUser(login: string, password: string, nickname: string, now = Date.now()) {
    try {
      return await this.transaction((run) => this.insertUser(run, login, password, nickname, now));
    } catch (error) {
      throw refused(error, 'users_login') ? new AccountError('login-taken') : error;
    }
  }

  async register(id: string, login: string, password: string, nickname: string) {
    try {
      return await this.transaction(async (run) => {
        const [user] = await run<{ login: string | null }>('SELECT login FROM users WHERE id = $1 FOR UPDATE', [id]);
        if (!user) throw new AccountError('invalid');
        if (user.login !== null) throw new AccountError('registered');
        const [row] = await run<UserRow>('UPDATE users SET login = $2, password = $3, nickname = $4 WHERE id = $1 RETURNING *', [id, login, password, nickname]);
        return record(row!);
      });
    } catch (error) {
      throw refused(error, 'users_login') ? new AccountError('login-taken') : error;
    }
  }

  async rename(id: string, nickname: string) {
    const [row] = await this.run<UserRow>('UPDATE users SET nickname = $2 WHERE id = $1 RETURNING *', [id, nickname]);
    if (!row) throw new AccountError('invalid');
    return record(row);
  }

  setPassword(id: string, password: string, keepSession: string | null) {
    return this.transaction(async (run) => {
      await run('UPDATE users SET password = $2 WHERE id = $1', [id, password]);
      await run('DELETE FROM sessions WHERE user_id = $1 AND hash IS DISTINCT FROM $2', [id, keepSession]);
    });
  }

  async rehash(id: string, password: string) {
    await this.run('UPDATE users SET password = $2 WHERE id = $1', [id, password]);
  }

  async linkRanked(id: string, rankedId: string): Promise<LinkOutcome> {
    try {
      return await this.transaction(async (run): Promise<LinkOutcome> => {
        const [user] = await run<{ ranked_id: string | null }>('SELECT ranked_id FROM users WHERE id = $1 FOR UPDATE', [id]);
        if (!user) throw new AccountError('invalid');
        if (user.ranked_id === rankedId) return 'same';
        if (user.ranked_id) return 'other';
        await run('UPDATE users SET ranked_id = $2 WHERE id = $1', [id, rankedId]);
        return 'linked';
      });
    } catch (error) {
      if (refused(error, 'users_ranked')) return 'taken';
      throw error;
    }
  }

  async startSession(userId: string, now = Date.now()) {
    const token = newSessionToken();
    await this.run('INSERT INTO sessions (hash, user_id, created, expires, last_used) VALUES ($1, $2, $3, $4, $3)', [hashSession(token), userId, now, now + this.sessionMs]);
    return token;
  }

  async session(token: string, now = Date.now()): Promise<SignedIn | null> {
    if (!SESSION_RULE.test(token)) return null;
    const hash = hashSession(token);
    const [row] = await this.run<UserRow>(
      `WITH used AS (UPDATE sessions SET last_used = $2, expires = $3 WHERE hash = $1 AND expires > $2 RETURNING user_id)
       UPDATE users SET last_seen = $2 FROM used WHERE users.id = used.user_id RETURNING users.*`,
      [hash, now, now + this.sessionMs],
    );
    if (row) return { user: record(row), hash };
    await this.run('DELETE FROM sessions WHERE hash = $1 AND expires <= $2', [hash, now]);
    return null;
  }

  async endSession(token: string) {
    if (SESSION_RULE.test(token)) await this.run('DELETE FROM sessions WHERE hash = $1', [hashSession(token)]);
  }

  async sweep(now = Date.now()) {
    const [row] = await this.run<{ removed: number }>('WITH gone AS (DELETE FROM sessions WHERE expires <= $1 RETURNING 1) SELECT count(*)::integer AS removed FROM gone', [now]);
    return row?.removed ?? 0;
  }

  async profile(userId: string): Promise<Profile | null> {
    const [row] = await this.run<Profile>('SELECT data, rev FROM profiles WHERE user_id = $1', [userId]);
    return row ? { data: row.data, rev: row.rev } : null;
  }

  private async balanceOn(run: Run, userId: string, kind: string): Promise<number> {
    const [row] = await run<{ balance_after: number }>('SELECT balance_after FROM ledger WHERE user_id = $1 AND kind = $2 ORDER BY id DESC LIMIT 1', [userId, kind]);
    return row?.balance_after ?? 0;
  }

  /** Inside a transaction that holds the user's profile row, so no other change of their balance comes between. */
  private async entry(run: Run, userId: string, change: LedgerChange, at: number): Promise<LedgerEntry> {
    checkLedgerChange(change);
    const after = balanceAfter(await this.balanceOn(run, userId, change.kind), change);
    const [row] = await run<EntryRow>(
      'INSERT INTO ledger (user_id, at, kind, amount, item, reason, balance_after) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
      [userId, at, change.kind, change.amount, change.item ?? null, change.reason, after],
    );
    return entryOf(row!);
  }

  private async claim(run: Run, key: string, userId: string, at: number) {
    checkClaimKey(key);
    return (await run('INSERT INTO claims (key, user_id, at) VALUES ($1, $2, $3) ON CONFLICT (key) DO NOTHING RETURNING key', [key, userId, at])).length === 1;
  }

  updateProfile(userId: string, rev: number | null, change: (data: ProfileData, tx: ProfileTx) => ProfileData | void | Promise<ProfileData | void>) {
    return this.transaction(async (run): Promise<Profile> => {
      const [current] = await run<Profile>('SELECT data, rev FROM profiles WHERE user_id = $1 FOR UPDATE', [userId]);
      if (!current) throw new AccountError('invalid');
      if (rev !== null && rev !== current.rev) throw new AccountError('conflict');
      const tx: ProfileTx = {
        balance: (kind) => this.balanceOn(run, userId, kind),
        ledger: (entry) => this.entry(run, userId, entry, Date.now()),
        claimOnce: (key) => this.claim(run, key, userId, Date.now()),
      };
      const text = profileText((await change(current.data, tx)) ?? current.data);
      const [row] = await run<Profile>('UPDATE profiles SET data = $2, rev = rev + 1 WHERE user_id = $1 RETURNING data, rev', [userId, text]);
      return { data: row!.data, rev: row!.rev };
    });
  }

  balance(userId: string, kind: string) {
    return this.balanceOn(this.run, userId, kind);
  }

  async appendLedger(userId: string, change: LedgerChange, at = Date.now()) {
    checkLedgerChange(change);
    return this.transaction(async (run) => {
      if (!(await run('SELECT 1 FROM profiles WHERE user_id = $1 FOR UPDATE', [userId])).length) throw new AccountError('invalid');
      return this.entry(run, userId, change, at);
    });
  }

  async ledger(userId: string, kind?: string, limit = 50) {
    const rows = kind === undefined
      ? await this.run<EntryRow>('SELECT * FROM ledger WHERE user_id = $1 ORDER BY id DESC LIMIT $2', [userId, limit])
      : await this.run<EntryRow>('SELECT * FROM ledger WHERE user_id = $1 AND kind = $2 ORDER BY id DESC LIMIT $3', [userId, kind, limit]);
    return rows.map(entryOf);
  }

  claimOnce(key: string, userId: string, at = Date.now()) {
    return this.claim(this.run, key, userId, at);
  }

  async close() {
    this.closed = true;
    this.ready = false;
    if (this.retry) clearTimeout(this.retry);
    await this.pool.end();
  }
}
