// Player accounts on the multiplayer host, in one SQLite file through node:sqlite (built into Node 22.13 and later):
// users (a guest has no login yet), their sessions, each user's progress, an append-only ledger of every change of a
// currency, and keys that can be claimed once. Statements are synchronous and the server is one process, so a
// transaction never interleaves with another request. The rules of progression belong to the routes that apply them;
// this file keeps the records.
import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { SESSION_RULE, type AccountErrorCode } from '../src/account/wire';

/** A refusal the routes answer with its code. `invalid` is a caller's mistake (bad arguments), never the player's. */
export class AccountError extends Error {
  constructor(readonly code: AccountErrorCode | 'invalid') {
    super(code);
  }
}

/** A user as stored. The password hash never leaves the server; routes send what server/auth.ts makes of it. */
export type UserRecord = { id: string; login: string | null; password: string | null; nickname: string; rankedId: string | null; created: number; lastSeen: number };
export type ProfileData = Record<string, unknown>;
export type Profile = { data: ProfileData; rev: number };
/** One change of a currency (`kind`, such as 'coin'): what it was for, and the balance it left. */
export type LedgerEntry = { id: number; at: number; kind: string; amount: number; item: string | null; reason: string; balanceAfter: number };
export type LedgerChange = { kind: string; amount: number; item?: string | null; reason: string };
/** What a profile change can do in the same transaction, so a purchase pays and receives in one step or not at all. */
export type ProfileTx = {
  balance(kind: string): number;
  ledger(change: LedgerChange): LedgerEntry;
  claimOnce(key: string): boolean;
};

export const SESSION_MS = 90 * 24 * 3600 * 1000;
/** A profile is one JSON object; this keeps a runaway one from filling the disk. */
const PROFILE_BYTES = 256 * 1024;
const BACKUPS_KEPT = 7;
const KIND = /^[a-z][a-z0-9_]{0,31}$/;
const label = (value: unknown) => typeof value === 'string' && value.length > 0 && value.length <= 64;
/** What is stored of a session token, and what the WebSocket keeps to know a session again. */
export const hashSession = (token: string) => createHash('sha256').update(token).digest('hex');
const plain = (value: unknown): value is ProfileData => !!value && typeof value === 'object' && !Array.isArray(value);

/**
 * Forward migrations: entry i takes the schema from version i to i + 1 (PRAGMA user_version). A shipped entry is never
 * edited; a change is a new entry. No table cascades a delete, and the ledger refuses updates and deletes outright.
 */
const MIGRATIONS = [
  `CREATE TABLE users (
     id TEXT PRIMARY KEY,
     login TEXT UNIQUE COLLATE NOCASE,
     password TEXT,
     nickname TEXT NOT NULL,
     ranked_id TEXT UNIQUE,
     created INTEGER NOT NULL,
     last_seen INTEGER NOT NULL
   ) STRICT;
   CREATE TABLE sessions (
     hash TEXT PRIMARY KEY,
     user_id TEXT NOT NULL REFERENCES users (id),
     created INTEGER NOT NULL,
     expires INTEGER NOT NULL,
     last_used INTEGER NOT NULL
   ) STRICT;
   CREATE INDEX sessions_user ON sessions (user_id);
   CREATE INDEX sessions_expires ON sessions (expires);
   CREATE TABLE profiles (
     user_id TEXT PRIMARY KEY REFERENCES users (id),
     data TEXT NOT NULL,
     rev INTEGER NOT NULL
   ) STRICT;
   CREATE TABLE ledger (
     id INTEGER PRIMARY KEY,
     user_id TEXT NOT NULL REFERENCES users (id),
     at INTEGER NOT NULL,
     kind TEXT NOT NULL,
     amount INTEGER NOT NULL,
     item TEXT,
     reason TEXT NOT NULL,
     balance_after INTEGER NOT NULL CHECK (balance_after >= 0)
   ) STRICT;
   CREATE INDEX ledger_balance ON ledger (user_id, kind, id);
   CREATE TRIGGER ledger_no_update BEFORE UPDATE ON ledger BEGIN SELECT RAISE(ABORT, 'the ledger is append-only'); END;
   CREATE TRIGGER ledger_no_delete BEFORE DELETE ON ledger BEGIN SELECT RAISE(ABORT, 'the ledger is append-only'); END;
   CREATE TABLE claims (
     key TEXT PRIMARY KEY,
     user_id TEXT NOT NULL REFERENCES users (id),
     at INTEGER NOT NULL
   ) STRICT;`,
];

type UserRow = { id: string; login: string | null; password: string | null; nickname: string; ranked_id: string | null; created: number; last_seen: number };
const record = (row: UserRow): UserRecord => ({ id: row.id, login: row.login, password: row.password, nickname: row.nickname, rankedId: row.ranked_id, created: row.created, lastSeen: row.last_seen });

export class AccountStore {
  ready = false;
  error: string | null = null;
  private db: DatabaseSync | null = null;
  private statements = new Map<string, StatementSync>();
  /** Open transactions: the outermost is BEGIN ... COMMIT, the ones inside it savepoints. */
  private depth = 0;

  constructor(readonly path: string, readonly sessionMs = SESSION_MS) {
    try {
      // Loaded here rather than imported, so a Node without SQLite disables accounts instead of the whole server.
      const sqlite = process.getBuiltinModule('node:sqlite') as typeof import('node:sqlite') | undefined;
      if (!sqlite) throw new Error('this Node has no node:sqlite');
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      this.db = new sqlite.DatabaseSync(path);
      chmodSync(path, 0o600);
      // WAL lets the daily copy read while the game writes; FULL syncs every commit, as the ranked journal does.
      this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
      this.migrate();
      this.ready = true;
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
      this.close();
      throw new Error(`accounts unavailable: ${this.error}`);
    }
  }

  private migrate() {
    const version = Number(this.sql('PRAGMA user_version').get()?.user_version ?? 0);
    // A database written by a newer server is left alone: an older one could not keep its rules.
    if (version > MIGRATIONS.length) throw new Error(`accounts database is schema ${version}, this server knows ${MIGRATIONS.length}`);
    for (let v = version; v < MIGRATIONS.length; v++) {
      this.transaction(() => {
        this.db!.exec(MIGRATIONS[v]!);
        this.db!.exec(`PRAGMA user_version = ${v + 1}`);
      });
    }
  }

  private sql(text: string): StatementSync {
    if (!this.db) throw new Error('accounts storage is closed');
    let statement = this.statements.get(text);
    if (!statement) {
      statement = this.db.prepare(text);
      this.statements.set(text, statement);
    }
    return statement;
  }

  /**
   * Runs `work` as one transaction (a savepoint inside another one), undone whole when it throws. `work` must be
   * synchronous: anything it awaited would run after the commit.
   */
  transaction<T>(work: () => T): T {
    if (!this.db) throw new Error('accounts storage is closed');
    const db = this.db;
    const savepoint = `nested_${this.depth}`;
    db.exec(this.depth ? `SAVEPOINT ${savepoint}` : 'BEGIN IMMEDIATE');
    this.depth += 1;
    try {
      const result = work();
      if (result && typeof (result as { then?: unknown }).then === 'function') throw new Error('an account transaction cannot wait');
      db.exec(this.depth > 1 ? `RELEASE ${savepoint}` : 'COMMIT');
      this.depth -= 1;
      return result;
    } catch (error) {
      this.depth -= 1;
      try {
        db.exec(this.depth ? `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}` : 'ROLLBACK');
      } catch {
        // SQLite already rolled back after a failed commit; the original error says why.
      }
      throw error;
    }
  }

  user(id: string): UserRecord | null {
    const row = this.sql('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
    return row ? record(row) : null;
  }

  userByLogin(login: string): UserRecord | null {
    const row = this.sql('SELECT * FROM users WHERE login = ?').get(login) as UserRow | undefined;
    return row ? record(row) : null;
  }

  userByRanked(rankedId: string): UserRecord | null {
    const row = this.sql('SELECT * FROM users WHERE ranked_id = ?').get(rankedId) as UserRow | undefined;
    return row ? record(row) : null;
  }

  private insertUser(login: string | null, password: string | null, nickname: string, now: number): UserRecord {
    const id = randomBytes(12).toString('hex');
    this.sql('INSERT INTO users (id, login, password, nickname, ranked_id, created, last_seen) VALUES (?, ?, ?, ?, NULL, ?, ?)').run(id, login, password, nickname, now, now);
    this.sql('INSERT INTO profiles (user_id, data, rev) VALUES (?, ?, 0)').run(id, '{}');
    return this.user(id)!;
  }

  createGuest(nickname: string, now = Date.now()): UserRecord {
    return this.transaction(() => this.insertUser(null, null, nickname, now));
  }

  /** A new user with a login. `password` is the stored hash (server/password.ts). */
  createUser(login: string, password: string, nickname: string, now = Date.now()): UserRecord {
    return this.transaction(() => {
      if (this.userByLogin(login)) throw new AccountError('login-taken');
      return this.insertUser(login, password, nickname, now);
    });
  }

  /** A guest signs up: the same user, now with a login, so everything it has stays where it is. */
  register(id: string, login: string, password: string, nickname: string): UserRecord {
    return this.transaction(() => {
      const user = this.user(id);
      if (!user) throw new AccountError('invalid');
      if (user.login !== null) throw new AccountError('registered');
      if (this.userByLogin(login)) throw new AccountError('login-taken');
      this.sql('UPDATE users SET login = ?, password = ?, nickname = ? WHERE id = ?').run(login, password, nickname, id);
      return this.user(id)!;
    });
  }

  rename(id: string, nickname: string): UserRecord {
    this.sql('UPDATE users SET nickname = ? WHERE id = ?').run(nickname, id);
    const user = this.user(id);
    if (!user) throw new AccountError('invalid');
    return user;
  }

  /** A new password ends every other session of the user: a changed password signs out whoever else held one. */
  setPassword(id: string, password: string, keepSession: string | null) {
    this.transaction(() => {
      this.rehash(id, password);
      this.sql('DELETE FROM sessions WHERE user_id = ? AND hash IS NOT ?').run(id, keepSession);
    });
  }

  /** The same password under a new hash (made with today's parameters); every session stays. */
  rehash(id: string, password: string) {
    this.sql('UPDATE users SET password = ? WHERE id = ?').run(password, id);
  }

  /**
   * Ties a ranked account to the user, so a sign-in on any device plays with it. 'same' when it already is, 'taken'
   * when another user has it, 'other' when this user already has a different one; only 'linked' changes anything.
   */
  linkRanked(id: string, rankedId: string): 'linked' | 'same' | 'taken' | 'other' {
    return this.transaction(() => {
      const user = this.user(id);
      if (!user) throw new AccountError('invalid');
      if (user.rankedId === rankedId) return 'same';
      if (user.rankedId) return 'other';
      if (this.userByRanked(rankedId)) return 'taken';
      this.sql('UPDATE users SET ranked_id = ? WHERE id = ?').run(rankedId, id);
      return 'linked';
    });
  }

  /** A new session for the user; only its hash is stored, so the database alone signs nobody in. */
  startSession(userId: string, now = Date.now()): string {
    const token = randomBytes(32).toString('base64url');
    this.sql('INSERT INTO sessions (hash, user_id, created, expires, last_used) VALUES (?, ?, ?, ?, ?)').run(hashSession(token), userId, now, now + this.sessionMs, now);
    return token;
  }

  /** The user a token signs in, or null. Every use moves the expiry on: a session ends after 90 days without one. */
  session(token: string, now = Date.now()): { user: UserRecord; hash: string } | null {
    if (!SESSION_RULE.test(token)) return null;
    const hash = hashSession(token);
    const row = this.sql('SELECT user_id, expires FROM sessions WHERE hash = ?').get(hash) as { user_id: string; expires: number } | undefined;
    if (!row) return null;
    if (row.expires <= now) {
      this.sql('DELETE FROM sessions WHERE hash = ?').run(hash);
      return null;
    }
    this.transaction(() => {
      this.sql('UPDATE sessions SET last_used = ?, expires = ? WHERE hash = ?').run(now, now + this.sessionMs, hash);
      this.sql('UPDATE users SET last_seen = ? WHERE id = ?').run(now, row.user_id);
    });
    return { user: this.user(row.user_id)!, hash };
  }

  endSession(token: string) {
    if (SESSION_RULE.test(token)) this.sql('DELETE FROM sessions WHERE hash = ?').run(hashSession(token));
  }

  profile(userId: string): Profile | null {
    const row = this.sql('SELECT data, rev FROM profiles WHERE user_id = ?').get(userId) as { data: string; rev: number } | undefined;
    return row ? { data: JSON.parse(row.data) as ProfileData, rev: row.rev } : null;
  }

  /**
   * Changes a user's progress. `rev` is the revision the change was made against (the copy a page showed); null skips
   * that check, for the server's own changes such as a battle's reward. `change` gets a fresh copy of the data to edit
   * in place, or to replace by returning a new object, and the transaction, to move currency and claim keys in the same
   * step. Throws AccountError 'conflict' when the stored revision has moved on, and undoes everything when `change`
   * throws.
   */
  updateProfile(userId: string, rev: number | null, change: (data: ProfileData, tx: ProfileTx) => ProfileData | void): Profile {
    return this.transaction(() => {
      const current = this.profile(userId);
      if (!current) throw new AccountError('invalid');
      if (rev !== null && rev !== current.rev) throw new AccountError('conflict');
      const tx: ProfileTx = {
        balance: (kind) => this.balance(userId, kind),
        ledger: (entry) => this.appendLedger(userId, entry),
        claimOnce: (key) => this.claimOnce(key, userId),
      };
      const next = change(current.data, tx) ?? current.data;
      const text = plain(next) ? JSON.stringify(next) : '';
      if (!text || Buffer.byteLength(text) > PROFILE_BYTES) throw new AccountError('invalid');
      this.sql('UPDATE profiles SET data = ?, rev = rev + 1 WHERE user_id = ?').run(text, userId);
      return { data: JSON.parse(text) as ProfileData, rev: current.rev + 1 };
    });
  }

  balance(userId: string, kind: string): number {
    const row = this.sql('SELECT balance_after FROM ledger WHERE user_id = ? AND kind = ? ORDER BY id DESC LIMIT 1').get(userId, kind) as { balance_after: number } | undefined;
    return row?.balance_after ?? 0;
  }

  /** Records a change of a currency and returns it with the balance it leaves. Throws 'insufficient' rather than go below zero. */
  appendLedger(userId: string, change: LedgerChange, at = Date.now()): LedgerEntry {
    const item = change.item ?? null;
    if (!KIND.test(change.kind) || !Number.isSafeInteger(change.amount) || change.amount === 0 || !label(change.reason) || (item !== null && !label(item))) throw new AccountError('invalid');
    return this.transaction(() => {
      if (!this.user(userId)) throw new AccountError('invalid');
      const balanceAfter = this.balance(userId, change.kind) + change.amount;
      if (balanceAfter < 0) throw new AccountError('insufficient');
      if (!Number.isSafeInteger(balanceAfter)) throw new AccountError('invalid');
      const { lastInsertRowid } = this.sql('INSERT INTO ledger (user_id, at, kind, amount, item, reason, balance_after) VALUES (?, ?, ?, ?, ?, ?, ?)').run(userId, at, change.kind, change.amount, item, change.reason, balanceAfter);
      return { id: Number(lastInsertRowid), at, kind: change.kind, amount: change.amount, item, reason: change.reason, balanceAfter };
    });
  }

  /** The user's newest ledger entries first, of one currency or of all. */
  ledger(userId: string, kind?: string, limit = 50): LedgerEntry[] {
    const rows = (kind === undefined
      ? this.sql('SELECT * FROM ledger WHERE user_id = ? ORDER BY id DESC LIMIT ?').all(userId, limit)
      : this.sql('SELECT * FROM ledger WHERE user_id = ? AND kind = ? ORDER BY id DESC LIMIT ?').all(userId, kind, limit)) as { id: number; at: number; kind: string; amount: number; item: string | null; reason: string; balance_after: number }[];
    return rows.map((r) => ({ id: r.id, at: r.at, kind: r.kind, amount: r.amount, item: r.item, reason: r.reason, balanceAfter: r.balance_after }));
  }

  /** True the first time `key` is claimed (by anyone: put the user in the key when it is per user), false ever after. */
  claimOnce(key: string, userId: string, at = Date.now()): boolean {
    if (typeof key !== 'string' || !key || key.length > 128) throw new AccountError('invalid');
    return Number(this.sql('INSERT INTO claims (key, user_id, at) VALUES (?, ?, ?) ON CONFLICT (key) DO NOTHING').run(key, userId, at).changes) === 1;
  }

  /** Sessions past their expiry: they no longer sign anyone in, and are forgotten here. */
  sweep(now = Date.now()): number {
    return Number(this.sql('DELETE FROM sessions WHERE expires <= ?').run(now).changes);
  }

  /**
   * Copies the database to backups/accounts-YYYY-MM-DD.db beside it (today's copy is replaced by a newer one) and keeps
   * the newest seven days. The copy is written under another name first, so a crash never leaves half a backup.
   */
  backup(now = Date.now()): string {
    const directory = join(dirname(this.path), 'backups');
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const file = join(directory, `accounts-${new Date(now).toISOString().slice(0, 10)}.db`);
    const partial = `${file}.partial`;
    rmSync(partial, { force: true });
    this.sql('VACUUM INTO ?').run(partial);
    chmodSync(partial, 0o600);
    renameSync(partial, file);
    const copies = readdirSync(directory).filter((name) => /^accounts-\d{4}-\d{2}-\d{2}\.db$/.test(name)).sort();
    for (const name of copies.slice(0, -BACKUPS_KEPT)) rmSync(join(directory, name), { force: true });
    return file;
  }

  close() {
    this.ready = false;
    this.statements.clear();
    this.db?.close();
    this.db = null;
  }
}
