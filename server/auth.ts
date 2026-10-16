// The account routes: a guest made when a page first has something to keep, sign-up (a guest's in place, so its
// progress stays), log-in and log-out, the signed-in player's nickname and password, and the tie to a ranked account
// that lets a signed-in player keep one rating on every device.
import { LOGIN_RULE, NICKNAME_MAX, passwordFits, type AccountUser, type AuthReply, type MeReply, type UserReply } from '../src/account/wire';
import type { AccountStore, UserRecord } from './accounts';
import { ApiError, Limiter, type ApiRouter } from './api';
import { clean } from './messages';
import { hashPassword, staleHash, verifyPassword } from './password';
import type { RankedStore } from './ranked';

const MINUTE = 60000;
const HOUR = 60 * MINUTE;
const RECOVERY_PREFIX = 'imjin-rank-v1:';

/** What a page may see of a user: everything but the password hash and the bookkeeping. */
export const publicUser = (user: UserRecord): AccountUser => ({ id: user.id, login: user.login, nickname: user.nickname, guest: user.login === null, rankedId: user.rankedId, created: user.created });

function loginOf(value: unknown): string {
  const login = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!LOGIN_RULE.test(login)) throw new ApiError('login');
  return login;
}

function passwordOf(value: unknown): string {
  if (typeof value !== 'string' || !passwordFits(value)) throw new ApiError('password');
  return value;
}

/** Nicknames go through the same clean() as the names players give the multiplayer lobby. */
function nicknameOf(value: unknown): string {
  const nickname = typeof value === 'string' && value.length <= 256 ? clean(value, NICKNAME_MAX) : '';
  if (!nickname) throw new ApiError('nickname');
  return nickname;
}

/** A ranked recovery code, as the online screen shows it (with its prefix) or bare. */
function recoveryOf(value: unknown): string {
  const code = typeof value === 'string' ? value.trim().replace(RECOVERY_PREFIX, '').toLowerCase() : '';
  if (!/^[a-f0-9]{64}$/.test(code)) throw new ApiError('ranked-code');
  return code;
}

export function authRoutes(api: ApiRouter, ranked: RankedStore | null) {
  // New users per address and hour (guests and sign-ups alike), the same allowance as new ranked accounts.
  const creations = new Limiter(24, HOUR);
  const loginsByAddress = new Limiter(10, MINUTE);
  const loginsByName = new Limiter(5, MINUTE);

  const reply = (accounts: AccountStore, user: UserRecord, token: string): AuthReply => ({ token, user: publicUser(user), profile: accounts.profile(user.id)! });

  /** Ties the ranked account of a recovery code to `user` when nobody has it, for a page whose own record should carry over. */
  const adopt = (accounts: AccountStore, user: UserRecord, code: string | null) => {
    const rankedId = code && ranked?.ready ? ranked.verify(code) : null;
    if (rankedId) accounts.linkRanked(user.id, rankedId);
  };

  // A page makes a guest only when it first has progress to keep. A page that already holds a session gets its own
  // user back instead of a second one. The nickname is the page's online name, if it has one; nobody typed it here.
  api.route('POST', '/api/auth/guest', ({ accounts, body, token, address, now }) => {
    const signedIn = token ? accounts.session(token, now) : null;
    if (signedIn) return reply(accounts, signedIn.user, token!);
    const nickname = (typeof body.nickname === 'string' && clean(body.nickname.slice(0, 256), NICKNAME_MAX)) || '무명';
    if (!creations.take(address, now)) throw new ApiError('rate');
    const user = accounts.createGuest(nickname, now);
    return reply(accounts, user, accounts.startSession(user.id, now));
  });

  // With a guest's session the guest itself signs up: the same id, the same progress. `rankedToken` is the recovery code
  // the page holds; its ranked record carries over when the account has none and nobody else has it.
  api.route('POST', '/api/auth/signup', async ({ accounts, body, token, address, now }) => {
    const login = loginOf(body.login);
    const password = passwordOf(body.password);
    const nickname = nicknameOf(body.nickname);
    const code = body.rankedToken === undefined ? null : recoveryOf(body.rankedToken);
    let guest: UserRecord | null = null;
    if (token) {
      guest = accounts.session(token, now)?.user ?? null;
      if (!guest) throw new ApiError('session');
      if (guest.login !== null) throw new ApiError('registered');
    } else if (!creations.take(address, now)) throw new ApiError('rate');
    // Checked before the hash is paid for; the transaction checks again for a sign-up that raced this one.
    if (accounts.userByLogin(login)) throw new ApiError('login-taken');
    const hash = await hashPassword(password);
    const user = guest ? accounts.register(guest.id, login, hash, nickname) : accounts.createUser(login, hash, nickname, now);
    adopt(accounts, user, code);
    return reply(accounts, accounts.user(user.id)!, guest ? token! : accounts.startSession(user.id, now));
  });

  // Attempts are limited per address and per login, before the password is checked. An unknown login costs as much
  // time as a wrong password and is refused with the same words.
  api.route('POST', '/api/auth/login', async ({ accounts, body, address, now }) => {
    const login = typeof body.login === 'string' ? body.login.trim().toLowerCase().slice(0, 32) : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (!loginsByAddress.take(address, now) || !loginsByName.take(login, now)) throw new ApiError('rate');
    const user = LOGIN_RULE.test(login) ? accounts.userByLogin(login) : null;
    const ok = await verifyPassword(password, user?.password ?? null);
    if (!user || !ok) throw new ApiError('credentials');
    if (staleHash(user.password!)) accounts.rehash(user.id, await hashPassword(password));
    return reply(accounts, user, accounts.startSession(user.id, Date.now()));
  });

  api.route('POST', '/api/auth/logout', ({ accounts, token }) => {
    if (token) accounts.endSession(token);
    return { ok: true };
  });

  api.user('GET', '/api/me', ({ accounts, user }): MeReply => ({ user: publicUser(user), profile: accounts.profile(user.id)! }));

  api.user('POST', '/api/me/nickname', ({ accounts, user, body }): UserReply => ({ user: publicUser(accounts.rename(user.id, nicknameOf(body.nickname))) }));

  // The current password proves it is the player at the keyboard. The other sessions end; this one stays.
  api.user('POST', '/api/me/password', async ({ accounts, user, body, session, now }) => {
    if (user.login === null || user.password === null) throw new ApiError('guest');
    const next = passwordOf(body.next);
    if (!loginsByName.take(user.login, now)) throw new ApiError('rate');
    if (!(await verifyPassword(typeof body.current === 'string' ? body.current : '', user.password))) throw new ApiError('current');
    accounts.setPassword(user.id, await hashPassword(next), session);
    return { ok: true };
  });

  // An explicit tie of a ranked record (by its recovery code) to the signed-in account.
  api.user('POST', '/api/auth/link-ranked', ({ accounts, user, body }): UserReply => {
    const code = recoveryOf(body.rankedToken);
    if (!ranked?.ready) throw new ApiError('ranked');
    const rankedId = ranked.verify(code);
    if (!rankedId) throw new ApiError('ranked-code');
    const linked = accounts.linkRanked(user.id, rankedId);
    if (linked === 'taken') throw new ApiError('ranked-taken');
    if (linked === 'other') throw new ApiError('ranked-other');
    return { user: publicUser(accounts.user(user.id)!) };
  });
}
