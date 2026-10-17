// Accounts kept in this process, for the tests and for local runs without a database (ACCOUNTS_STORE=memory). All of
// it is lost when the server stops. Changes run one at a time, as the database's row locks order them, and a profile
// change keeps what its `tx` did aside until `change` has finished, so a refusal leaves nothing behind.
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
import type { ItemRow, MetaRecord } from './metaRecord';

type Entry = LedgerEntry & { userId: string };

export class MemoryAccountStore implements AccountStore {
  readonly ready = true;
  private users = new Map<string, UserRecord>();
  private sessions = new Map<string, { userId: string; expires: number; lastUsed: number }>();
  /** Profiles as JSON text, so no caller ever holds the stored object. */
  private profiles = new Map<string, { text: string; rev: number }>();
  private entries: Entry[] = [];
  private claims = new Map<string, string>();
  /** The growth profile's rows as the tables of schema 2 keep them; loot no longer held stays, marked salvaged. */
  private metas = new Map<string, { record: MetaRecord; salvaged: Map<string, ItemRow & { salvagedAt: number }> }>();
  private lastEntry = 0;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(readonly sessionMs = SESSION_MS) {}

  /** One change at a time. */
  private serial<T>(work: () => T | Promise<T>): Promise<T> {
    const result = this.queue.then(work);
    this.queue = result.catch(() => undefined);
    return result;
  }

  private find(predicate: (user: UserRecord) => boolean): UserRecord | null {
    for (const user of this.users.values()) if (predicate(user)) return { ...user };
    return null;
  }

  async user(id: string) {
    const user = this.users.get(id);
    return user ? { ...user } : null;
  }

  async userByLogin(login: string) {
    return this.find((user) => user.login?.toLowerCase() === login.toLowerCase());
  }

  private insert(login: string | null, password: string | null, nickname: string, now: number): UserRecord {
    const user: UserRecord = { id: newUserId(), login, password, nickname, rankedId: null, created: now, lastSeen: now };
    this.users.set(user.id, user);
    this.profiles.set(user.id, { text: '{}', rev: 0 });
    return { ...user };
  }

  createGuest(nickname: string, now = Date.now()) {
    return this.serial(() => this.insert(null, null, nickname, now));
  }

  createUser(login: string, password: string, nickname: string, now = Date.now()) {
    return this.serial(() => {
      if (this.find((user) => user.login?.toLowerCase() === login.toLowerCase())) throw new AccountError('login-taken');
      return this.insert(login, password, nickname, now);
    });
  }

  register(id: string, login: string, password: string, nickname: string) {
    return this.serial(() => {
      const user = this.users.get(id);
      if (!user) throw new AccountError('invalid');
      if (user.login !== null) throw new AccountError('registered');
      if (this.find((other) => other.login?.toLowerCase() === login.toLowerCase())) throw new AccountError('login-taken');
      Object.assign(user, { login, password, nickname });
      return { ...user };
    });
  }

  rename(id: string, nickname: string) {
    return this.serial(() => {
      const user = this.users.get(id);
      if (!user) throw new AccountError('invalid');
      user.nickname = nickname;
      return { ...user };
    });
  }

  setPassword(id: string, password: string, keepSession: string | null) {
    return this.serial(() => {
      const user = this.users.get(id);
      if (!user) throw new AccountError('invalid');
      user.password = password;
      for (const [hash, session] of this.sessions) if (session.userId === id && hash !== keepSession) this.sessions.delete(hash);
    });
  }

  rehash(id: string, password: string) {
    return this.serial(() => {
      const user = this.users.get(id);
      if (user) user.password = password;
    });
  }

  linkRanked(id: string, rankedId: string) {
    return this.serial((): LinkOutcome => {
      const user = this.users.get(id);
      if (!user) throw new AccountError('invalid');
      if (user.rankedId === rankedId) return 'same';
      if (user.rankedId) return 'other';
      if (this.find((other) => other.rankedId === rankedId)) return 'taken';
      user.rankedId = rankedId;
      return 'linked';
    });
  }

  startSession(userId: string, now = Date.now()) {
    return this.serial(() => {
      if (!this.users.has(userId)) throw new AccountError('invalid');
      const token = newSessionToken();
      this.sessions.set(hashSession(token), { userId, expires: now + this.sessionMs, lastUsed: now });
      return token;
    });
  }

  async session(token: string, now = Date.now()): Promise<SignedIn | null> {
    if (!SESSION_RULE.test(token)) return null;
    const hash = hashSession(token);
    const session = this.sessions.get(hash);
    if (!session) return null;
    if (session.expires <= now) {
      this.sessions.delete(hash);
      return null;
    }
    session.lastUsed = now;
    session.expires = now + this.sessionMs;
    const user = this.users.get(session.userId)!;
    user.lastSeen = now;
    return { user: { ...user }, hash };
  }

  async endSession(token: string) {
    if (SESSION_RULE.test(token)) this.sessions.delete(hashSession(token));
  }

  async sweep(now = Date.now()) {
    let removed = 0;
    for (const [hash, session] of this.sessions) {
      if (session.expires > now) continue;
      this.sessions.delete(hash);
      removed += 1;
    }
    return removed;
  }

  async profile(userId: string): Promise<Profile | null> {
    const stored = this.profiles.get(userId);
    return stored ? { data: JSON.parse(stored.text) as ProfileData, rev: stored.rev } : null;
  }

  private balanceOf(userId: string, kind: string, pending: Entry[] = []) {
    for (const list of [pending, this.entries]) {
      for (let i = list.length - 1; i >= 0; i--) if (list[i]!.userId === userId && list[i]!.kind === kind) return list[i]!.balanceAfter;
    }
    return 0;
  }

  private entry(userId: string, change: LedgerChange, at: number, pending: Entry[] = []): Entry {
    checkLedgerChange(change);
    if (!this.users.has(userId)) throw new AccountError('invalid');
    const after = balanceAfter(this.balanceOf(userId, change.kind, pending), change);
    return { id: ++this.lastEntry, userId, at, kind: change.kind, amount: change.amount, item: change.item ?? null, reason: change.reason, balanceAfter: after };
  }

  /** An entry as callers see it, without the owner it is kept under. */
  private shown(entry: Entry): LedgerEntry {
    return { id: entry.id, at: entry.at, kind: entry.kind, amount: entry.amount, item: entry.item, reason: entry.reason, balanceAfter: entry.balanceAfter };
  }

  updateProfile(userId: string, rev: number | null, change: (data: ProfileData, tx: ProfileTx) => ProfileData | void | Promise<ProfileData | void>) {
    return this.serial(async (): Promise<Profile> => {
      const stored = this.profiles.get(userId);
      if (!stored) throw new AccountError('invalid');
      if (rev !== null && rev !== stored.rev) throw new AccountError('conflict');
      const pending: Entry[] = [];
      const claimed = new Set<string>();
      let meta = null as MetaRecord | null;
      const tx: ProfileTx = {
        balance: async (kind) => this.balanceOf(userId, kind, pending),
        ledger: async (entry) => {
          const made = this.entry(userId, entry, Date.now(), pending);
          pending.push(made);
          return this.shown(made);
        },
        claimOnce: async (key) => {
          checkClaimKey(key);
          if (this.claims.has(key) || claimed.has(key)) return false;
          claimed.add(key);
          return true;
        },
        meta: async () => {
          const kept = meta ?? this.metas.get(userId)?.record;
          return kept ? structuredClone(kept) : null;
        },
        saveMeta: async (record) => {
          const uids = new Set(record.items.map((i) => i.uid));
          const worn = new Set<string>();
          for (const e of record.equipment) {
            // The constraints of the tables: a piece worn once, held, by a commander with a row.
            if (!uids.has(e.uid) || worn.has(e.uid) || !record.commanders.some((c) => c.commanderId === e.commanderId)) throw new AccountError('invalid');
            worn.add(e.uid);
          }
          meta = structuredClone(record);
        },
      };
      const data = JSON.parse(stored.text) as ProfileData;
      const text = profileText((await change(data, tx)) ?? data);
      this.entries.push(...pending);
      for (const key of claimed) this.claims.set(key, userId);
      this.profiles.set(userId, { text, rev: stored.rev + 1 });
      if (meta) {
        const now = Date.now();
        const before = this.metas.get(userId);
        const salvaged = before?.salvaged ?? new Map();
        const held = new Set(meta.items.map((i) => i.uid));
        for (const i of before?.record.items ?? []) if (!held.has(i.uid)) salvaged.set(i.uid, { ...i, salvagedAt: now });
        for (const uid of held) salvaged.delete(uid);
        this.metas.set(userId, { record: meta, salvaged });
      }
      return { data: JSON.parse(text) as ProfileData, rev: stored.rev + 1 };
    });
  }

  async balance(userId: string, kind: string) {
    return this.balanceOf(userId, kind);
  }

  appendLedger(userId: string, change: LedgerChange, at = Date.now()) {
    return this.serial(() => {
      const made = this.entry(userId, change, at);
      this.entries.push(made);
      return this.shown(made);
    });
  }

  async ledger(userId: string, kind?: string, limit = 50) {
    return this.entries.filter((e) => e.userId === userId && (kind === undefined || e.kind === kind)).slice(-limit).reverse().map((e) => this.shown(e));
  }

  claimOnce(key: string, userId: string) {
    return this.serial(() => {
      checkClaimKey(key);
      if (!this.users.has(userId)) throw new AccountError('invalid');
      if (this.claims.has(key)) return false;
      this.claims.set(key, userId);
      return true;
    });
  }

  async jsonMetaUsers(limit: number) {
    const out: string[] = [];
    for (const [userId, stored] of this.profiles) {
      if (out.length >= limit) break;
      if (Object.hasOwn(JSON.parse(stored.text) as object, 'meta')) out.push(userId);
    }
    return out.sort();
  }

  async close() {}
}
