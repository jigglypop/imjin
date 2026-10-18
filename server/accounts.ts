// Player accounts: users (a guest has no login yet), their sessions, each user's progress, an append-only ledger of
// every change of a currency, and keys that can be claimed once. They live in PostgreSQL (accountsPg.ts), or in this
// process for tests and local runs without a database (accountsMemory.ts). The rules of progression belong to the
// routes that apply them; a store only keeps the records.
import { createHash, randomBytes } from 'node:crypto';
import type { AccountErrorCode } from '../src/account/wire';
import type { MetaRecord } from './metaRecord';

/**
 * A refusal the routes answer with its code. `invalid` is a caller's mistake (bad arguments), never the player's;
 * `unavailable` and `busy` come from a database that cannot answer now.
 */
export class AccountError extends Error {
  constructor(readonly code: AccountErrorCode | 'invalid') {
    super(code);
  }
}

/** A user as stored. The password hash never leaves the server: routes send what auth.ts makes of it. */
export type UserRecord = { id: string; login: string | null; password: string | null; nickname: string; rankedId: string | null; created: number; lastSeen: number };
export type ProfileData = Record<string, unknown>;
export type Profile = { data: ProfileData; rev: number };
/** One change of a currency (`kind`, such as 'coin'): what it was for, and the balance it left. */
export type LedgerEntry = { id: number; at: number; kind: string; amount: number; item: string | null; reason: string; balanceAfter: number };
export type LedgerChange = { kind: string; amount: number; item?: string | null; reason: string };
/** What a profile change can do in its own transaction, so a purchase pays and receives in one step or not at all. */
export type ProfileTx = {
  balance(kind: string): Promise<number>;
  ledger(change: LedgerChange): Promise<LedgerEntry>;
  claimOnce(key: string): Promise<boolean>;
  /** The growth profile's rows (metaRecord.ts), or null before they were first written. */
  meta(): Promise<MetaRecord | null>;
  /** Replaces the growth profile's rows: a piece of loot no longer held is kept as salvaged, never deleted. */
  saveMeta(record: MetaRecord): Promise<void>;
};
/** 'same' when the user already has that ranked account, 'taken' when another user has it, 'other' when this user has another one. */
export type LinkOutcome = 'linked' | 'same' | 'taken' | 'other';
export type SignedIn = { user: UserRecord; hash: string };

/**
 * What every store does. A method resolves once its change is durable and rejects with an AccountError for a refusal.
 * updateProfile holds the user's records until it resolves (a row lock in the database): inside `change`, go through
 * its `tx`, never back through the store, and do nothing slow.
 */
export interface AccountStore {
  /** False while a database is still connecting or migrating, or when it could not. */
  readonly ready: boolean;
  user(id: string): Promise<UserRecord | null>;
  userByLogin(login: string): Promise<UserRecord | null>;
  /** A signed-up user (not a guest) other than `exceptId` whose nickname matches ignoring case, or null. */
  userByNickname(nickname: string, exceptId?: string | null): Promise<UserRecord | null>;
  createGuest(nickname: string, now?: number): Promise<UserRecord>;
  /** A new user with a login; `password` is the stored hash (password.ts). Rejects with 'login-taken'. */
  createUser(login: string, password: string, nickname: string, now?: number): Promise<UserRecord>;
  /** A guest signs up: the same user, now with a login, so everything it has stays. Rejects with 'registered' or 'login-taken'. */
  register(id: string, login: string, password: string, nickname: string): Promise<UserRecord>;
  rename(id: string, nickname: string): Promise<UserRecord>;
  /** A new password ends every other session of the user; `keepSession` is the hash of the one that stays. */
  setPassword(id: string, password: string, keepSession: string | null): Promise<void>;
  /** The same password under a new hash made with today's parameters; every session stays. */
  rehash(id: string, password: string): Promise<void>;
  /** Ties a ranked account to the user, so a sign-in on any device plays with it. Only 'linked' changes anything. */
  linkRanked(id: string, rankedId: string): Promise<LinkOutcome>;
  /** A new session; only its hash is stored, so the records alone sign nobody in. */
  startSession(userId: string, now?: number): Promise<string>;
  /** The user a token signs in, or null. Every use moves the expiry on; a session ends after SESSION_MS without one. */
  session(token: string, now?: number): Promise<SignedIn | null>;
  endSession(token: string): Promise<void>;
  /** Ends every session of the user but `keepSession` (a stored hash; null ends all); returns how many ended. */
  endSessions(userId: string, keepSession: string | null): Promise<number>;
  /** Forgets sessions past their expiry; returns how many. */
  sweep(now?: number): Promise<number>;
  profile(userId: string): Promise<Profile | null>;
  /**
   * Changes a user's progress. `rev` is the revision the change was made against (the copy a page showed); null skips
   * that check, for the server's own changes such as a battle's reward. `change` gets a fresh copy of the data to edit
   * in place, or to replace by returning a new object. Rejects with 'conflict' when the stored revision has moved on;
   * nothing is kept when `change` throws.
   */
  updateProfile(userId: string, rev: number | null, change: (data: ProfileData, tx: ProfileTx) => ProfileData | void | Promise<ProfileData | void>): Promise<Profile>;
  balance(userId: string, kind: string): Promise<number>;
  /** Records a change of a currency with the balance it leaves; rejects with 'insufficient' rather than go below zero. */
  appendLedger(userId: string, change: LedgerChange, at?: number): Promise<LedgerEntry>;
  /** The user's newest ledger entries first, of one currency or of all. */
  ledger(userId: string, kind?: string, limit?: number): Promise<LedgerEntry[]>;
  /** True the first time `key` is claimed (by anyone: put the user in the key when it is per user), false ever after. */
  claimOnce(key: string, userId: string, at?: number): Promise<boolean>;
  /** Users whose growth profile is still the JSON of schema 1 (profiles.data.meta), at most `limit` of them. */
  jsonMetaUsers(limit: number): Promise<string[]>;
  close(): Promise<void>;
}

/** A session ends after this long unused; every use moves its expiry on (sliding refresh). */
export const SESSION_MS = 90 * 24 * 3600 * 1000;
/** And this long after it began, however often it was used: a stolen token cannot live for ever. */
export const SESSION_MAX_MS = 365 * 24 * 3600 * 1000;
/** A profile is one JSON object; this keeps a runaway one from filling the database. */
const PROFILE_BYTES = 256 * 1024;
const KIND = /^[a-z][a-z0-9_]{0,31}$/;
const label = (value: unknown) => typeof value === 'string' && value.length > 0 && value.length <= 64;

/** What is stored of a session token, and what the WebSocket keeps to know a session again. */
export const hashSession = (token: string) => createHash('sha256').update(token).digest('hex');
export const newSessionToken = () => randomBytes(32).toString('base64url');
export const newUserId = () => randomBytes(12).toString('hex');

export function checkLedgerChange(change: LedgerChange) {
  const item = change.item ?? null;
  if (!KIND.test(change.kind) || !Number.isSafeInteger(change.amount) || change.amount === 0 || !label(change.reason) || (item !== null && !label(item))) throw new AccountError('invalid');
}

/** The balance a change leaves, refused below zero or beyond what a number holds exactly. */
export function balanceAfter(balance: number, change: LedgerChange): number {
  const after = balance + change.amount;
  if (after < 0) throw new AccountError('insufficient');
  if (!Number.isSafeInteger(after)) throw new AccountError('invalid');
  return after;
}

/** The JSON a profile is stored as; anything but a plain object within the size limit is refused. */
export function profileText(data: unknown): string {
  const text = data && typeof data === 'object' && !Array.isArray(data) ? JSON.stringify(data) : '';
  if (!text || Buffer.byteLength(text) > PROFILE_BYTES) throw new AccountError('invalid');
  return text;
}

export function checkClaimKey(key: string) {
  if (typeof key !== 'string' || !key || key.length > 128) throw new AccountError('invalid');
}
