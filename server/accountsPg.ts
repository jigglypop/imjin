// Accounts in PostgreSQL (the RDS instance in production) through one small pool. Each change is a transaction that
// locks the rows it reads (SELECT ... FOR UPDATE); the user's profile row is the lock that puts their currency changes,
// claims and profile writes in one order. Times are epoch milliseconds in bigint columns, the profile a jsonb object.
import { readFileSync } from 'node:fs';
import { DatabaseError, Pool, TypeOverrides, types, type PoolClient, type PoolConfig } from 'pg';
import { SESSION_RULE } from '../src/account/wire';
import {
  AccountError,
  SESSION_MAX_MS,
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
import type { CommanderRow, EquipmentRow, ItemRow, MetaRecord } from './metaRecord';

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
  // Schema 2: the growth profile (talents, loot, what is worn) in tables of its own instead of profiles.data.meta. The
  // JSON is moved over per user in the transaction of the user's next change, and by the server's start-up sweep
  // (meta.ts migrateJsonMeta). IF NOT EXISTS lets a database rolled back to schema 1 (docs/dev.md) come forward again.
  `CREATE TABLE IF NOT EXISTS meta_accounts (
     user_id text PRIMARY KEY REFERENCES users (id),
     version integer NOT NULL,
     stats jsonb NOT NULL CHECK (jsonb_typeof(stats) = 'object'),
     firsts jsonb NOT NULL CHECK (jsonb_typeof(firsts) = 'array'),
     day text NOT NULL,
     earned bigint NOT NULL CHECK (earned >= 0),
     drops bigint NOT NULL CHECK (drops >= 0),
     dropped bigint NOT NULL CHECK (dropped >= 0),
     created_at bigint NOT NULL,
     updated_at bigint NOT NULL
   );
   CREATE TABLE IF NOT EXISTS owned_armor (
     user_id text NOT NULL REFERENCES meta_accounts (user_id),
     armor_id text NOT NULL,
     rerolls integer NOT NULL CHECK (rerolls >= 0),
     PRIMARY KEY (user_id, armor_id)
   );
   CREATE TABLE IF NOT EXISTS commander_progress (
     user_id text NOT NULL REFERENCES meta_accounts (user_id),
     commander_id text NOT NULL,
     xp bigint NOT NULL CHECK (xp >= 0),
     level integer NOT NULL CHECK (level >= 1),
     keystone text,
     respecs integer NOT NULL CHECK (respecs >= 0),
     armor_id text,
     weapon_id text,
     talents jsonb NOT NULL CHECK (jsonb_typeof(talents) = 'object'),
     updated_at bigint NOT NULL,
     PRIMARY KEY (user_id, commander_id)
   );
   CREATE INDEX IF NOT EXISTS commander_progress_level ON commander_progress (commander_id, level DESC);
   CREATE TABLE IF NOT EXISTS items (
     user_id text NOT NULL REFERENCES meta_accounts (user_id),
     item_uid text NOT NULL CHECK (char_length(item_uid) BETWEEN 1 AND 24),
     def_id text NOT NULL,
     rarity text NOT NULL CHECK (rarity IN ('common', 'fine', 'rare', 'epic', 'legendary')),
     seed bigint NOT NULL,
     reforge_count integer NOT NULL CHECK (reforge_count >= 0),
     src text NOT NULL,
     pos integer NOT NULL,
     created_at bigint NOT NULL,
     salvaged_at bigint,
     PRIMARY KEY (user_id, item_uid)
   );
   CREATE INDEX IF NOT EXISTS items_held ON items (user_id, pos) WHERE salvaged_at IS NULL;
   CREATE INDEX IF NOT EXISTS items_def ON items (def_id, rarity);
   CREATE TABLE IF NOT EXISTS equipment (
     user_id text NOT NULL,
     commander_id text NOT NULL,
     slot text NOT NULL CHECK (slot IN ('weapon', 'armor', 'trinket', 'book', 'seal')),
     item_uid text NOT NULL,
     PRIMARY KEY (user_id, commander_id, slot),
     CONSTRAINT equipment_worn_once UNIQUE (user_id, item_uid),
     FOREIGN KEY (user_id, commander_id) REFERENCES commander_progress (user_id, commander_id),
     FOREIGN KEY (user_id, item_uid) REFERENCES items (user_id, item_uid)
   );
   CREATE INDEX IF NOT EXISTS profiles_json_meta ON profiles (user_id) WHERE data ? 'meta';`,
];
/** The tables of the growth profile, children first: what a rollback to schema 1 empties (docs/dev.md). */
export const META_TABLES = ['equipment', 'items', 'commander_progress', 'owned_armor', 'meta_accounts'] as const;
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
      `WITH used AS (UPDATE sessions SET last_used = $2, expires = $3 WHERE hash = $1 AND expires > $2 AND created > $2 - $4 RETURNING user_id)
       UPDATE users SET last_seen = $2 FROM used WHERE users.id = used.user_id RETURNING users.*`,
      [hash, now, now + this.sessionMs, SESSION_MAX_MS],
    );
    if (row) return { user: record(row), hash };
    await this.run('DELETE FROM sessions WHERE hash = $1 AND (expires <= $2 OR created <= $2 - $3)', [hash, now, SESSION_MAX_MS]);
    return null;
  }

  async endSessions(userId: string, keepSession: string | null) {
    const [row] = await this.run<{ ended: number }>('WITH gone AS (DELETE FROM sessions WHERE user_id = $1 AND hash IS DISTINCT FROM $2 RETURNING 1) SELECT count(*)::integer AS ended FROM gone', [userId, keepSession]);
    return row?.ended ?? 0;
  }

  async userByNickname(nickname: string, exceptId: string | null = null) {
    const [row] = await this.run<UserRow>('SELECT * FROM users WHERE login IS NOT NULL AND lower(nickname) = lower($1) AND id IS DISTINCT FROM $2 LIMIT 1', [nickname, exceptId]);
    return row ? record(row) : null;
  }

  async endSession(token: string) {
    if (SESSION_RULE.test(token)) await this.run('DELETE FROM sessions WHERE hash = $1', [hashSession(token)]);
  }

  async sweep(now = Date.now()) {
    const [row] = await this.run<{ removed: number }>('WITH gone AS (DELETE FROM sessions WHERE expires <= $1 OR created <= $1 - $2 RETURNING 1) SELECT count(*)::integer AS removed FROM gone', [now, SESSION_MAX_MS]);
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

  private async readMeta(run: Run, userId: string): Promise<MetaRecord | null> {
    type AccountRow = { version: number; stats: MetaRecord['account']['stats']; firsts: string[]; day: string; earned: number; drops: number; dropped: number };
    const [account] = await run<AccountRow>('SELECT version, stats, firsts, day, earned, drops, dropped FROM meta_accounts WHERE user_id = $1', [userId]);
    if (!account) return null;
    const armor = await run<{ armorId: string; rerolls: number }>('SELECT armor_id AS "armorId", rerolls FROM owned_armor WHERE user_id = $1 ORDER BY armor_id', [userId]);
    const commanders = await run<CommanderRow>(
      'SELECT commander_id AS "commanderId", xp, level, keystone, respecs, armor_id AS "armorId", weapon_id AS "weaponId", talents FROM commander_progress WHERE user_id = $1 ORDER BY commander_id',
      [userId],
    );
    const items = await run<ItemRow>(
      'SELECT item_uid AS uid, def_id AS "defId", rarity, seed, reforge_count AS "reforgeCount", src, pos FROM items WHERE user_id = $1 AND salvaged_at IS NULL ORDER BY pos',
      [userId],
    );
    const equipment = await run<EquipmentRow>('SELECT commander_id AS "commanderId", slot, item_uid AS uid FROM equipment WHERE user_id = $1', [userId]);
    return { account, armor, commanders, items, equipment };
  }

  /** Inside the transaction that holds the user's profile row. */
  private async writeMeta(run: Run, userId: string, rec: MetaRecord, now: number) {
    const a = rec.account;
    await run(
      `INSERT INTO meta_accounts (user_id, version, stats, firsts, day, earned, drops, dropped, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
       ON CONFLICT (user_id) DO UPDATE SET version = $2, stats = $3, firsts = $4, day = $5, earned = $6, drops = $7, dropped = $8, updated_at = $9`,
      [userId, a.version, JSON.stringify(a.stats), JSON.stringify(a.firsts), a.day, a.earned, a.drops, a.dropped, now],
    );
    // What is worn goes first and comes back last, so no row ever points at a piece or a commander that is gone.
    await run('DELETE FROM equipment WHERE user_id = $1', [userId]);
    await run('DELETE FROM owned_armor WHERE user_id = $1 AND NOT (armor_id = ANY($2::text[]))', [userId, rec.armor.map((r) => r.armorId)]);
    await run(
      `INSERT INTO owned_armor (user_id, armor_id, rerolls) SELECT $1, * FROM unnest($2::text[], $3::integer[])
       ON CONFLICT (user_id, armor_id) DO UPDATE SET rerolls = excluded.rerolls`,
      [userId, rec.armor.map((r) => r.armorId), rec.armor.map((r) => r.rerolls)],
    );
    const c = rec.commanders;
    await run('DELETE FROM commander_progress WHERE user_id = $1 AND NOT (commander_id = ANY($2::text[]))', [userId, c.map((r) => r.commanderId)]);
    await run(
      `INSERT INTO commander_progress (user_id, commander_id, xp, level, keystone, respecs, armor_id, weapon_id, talents, updated_at)
       SELECT $1, t.id, t.xp, t.level, t.keystone, t.respecs, t.armor, t.weapon, t.talents::jsonb, $10
       FROM unnest($2::text[], $3::bigint[], $4::integer[], $5::text[], $6::integer[], $7::text[], $8::text[], $9::text[]) AS t (id, xp, level, keystone, respecs, armor, weapon, talents)
       ON CONFLICT (user_id, commander_id) DO UPDATE SET xp = excluded.xp, level = excluded.level, keystone = excluded.keystone, respecs = excluded.respecs,
         armor_id = excluded.armor_id, weapon_id = excluded.weapon_id, talents = excluded.talents,
         updated_at = CASE WHEN (commander_progress.xp, commander_progress.respecs, commander_progress.armor_id, commander_progress.weapon_id, commander_progress.talents)
           IS NOT DISTINCT FROM (excluded.xp, excluded.respecs, excluded.armor_id, excluded.weapon_id, excluded.talents) THEN commander_progress.updated_at ELSE excluded.updated_at END`,
      [userId, c.map((r) => r.commanderId), c.map((r) => r.xp), c.map((r) => r.level), c.map((r) => r.keystone), c.map((r) => r.respecs), c.map((r) => r.armorId), c.map((r) => r.weaponId), c.map((r) => JSON.stringify(r.talents)), now],
    );
    const i = rec.items;
    await run('UPDATE items SET salvaged_at = $3 WHERE user_id = $1 AND salvaged_at IS NULL AND NOT (item_uid = ANY($2::text[]))', [userId, i.map((r) => r.uid), now]);
    await run(
      `INSERT INTO items (user_id, item_uid, def_id, rarity, seed, reforge_count, src, pos, created_at)
       SELECT $1, *, $9 FROM unnest($2::text[], $3::text[], $4::text[], $5::bigint[], $6::integer[], $7::text[], $8::integer[])
       ON CONFLICT (user_id, item_uid) DO UPDATE SET def_id = excluded.def_id, rarity = excluded.rarity, seed = excluded.seed, reforge_count = excluded.reforge_count,
         src = excluded.src, pos = excluded.pos, salvaged_at = NULL`,
      [userId, i.map((r) => r.uid), i.map((r) => r.defId), i.map((r) => r.rarity), i.map((r) => r.seed), i.map((r) => r.reforgeCount), i.map((r) => r.src), i.map((r) => r.pos), now],
    );
    const e = rec.equipment;
    await run('INSERT INTO equipment (user_id, commander_id, slot, item_uid) SELECT $1, * FROM unnest($2::text[], $3::text[], $4::text[])', [userId, e.map((r) => r.commanderId), e.map((r) => r.slot), e.map((r) => r.uid)]);
  }

  async jsonMetaUsers(limit: number) {
    return (await this.run<{ user_id: string }>("SELECT user_id FROM profiles WHERE data ? 'meta' ORDER BY user_id LIMIT $1", [limit])).map((r) => r.user_id);
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
        meta: () => this.readMeta(run, userId),
        saveMeta: (record) => this.writeMeta(run, userId, record, Date.now()),
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
