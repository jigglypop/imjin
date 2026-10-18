import { create } from 'zustand';
import { net, useNet } from '../net/NetClient';
import { AccountApiError, accountCall } from './api';
import { onSessionChange, saveSession, savedSession } from './session';
import { ACCOUNT_TEXT, loginProblem, nicknameProblem, passwordProblem, type AccountUser, type AuthReply, type MeReply, type UserReply } from './wire';

// The account this browser is signed in as, and what can be done with it. A guest is made only when there is first
// something worth keeping on the server (ensureAccount), never when the page loads. The actions resolve true when the
// server agreed; otherwise `error` holds its reason as Korean source text.

type AccountState = {
  /** Whom this browser is signed in as: a guest until it signs up, null when signed out. */
  user: AccountUser | null;
  status: 'idle' | 'busy' | 'error';
  error: string | null;
  /** The refusal code behind `error` ('network' when unreachable), so a form can mark the field it is about. */
  errorCode: string | null;
};

export const useAccount = create<AccountState>(() => ({ user: savedSession()?.user ?? null, status: 'idle', error: null, errorCode: null }));
onSessionChange(() => useAccount.setState({ user: savedSession()?.user ?? null }));

/** One request: busy while it lasts, its reason in `error` when it fails. A session the server no longer knows signs this browser out. */
async function attempt<T>(work: () => Promise<T>): Promise<T | null> {
  useAccount.setState({ status: 'busy', error: null, errorCode: null });
  try {
    const result = await work();
    useAccount.setState({ status: 'idle' });
    return result;
  } catch (error) {
    const failure = error instanceof AccountApiError ? error : new AccountApiError('server', ACCOUNT_TEXT.server);
    if (failure.code === 'session') saveSession(null);
    useAccount.setState({ status: 'error', error: failure.text, errorCode: failure.code });
    return null;
  }
}

const fail = (text: string, code: string | null = null) => {
  useAccount.setState({ status: 'error', error: text, errorCode: code });
  return false;
};
const keep = (reply: AuthReply) => {
  saveSession({ token: reply.token, user: reply.user });
  return reply.user;
};

export const clearAccountError = () => useAccount.setState({ status: 'idle', error: null, errorCode: null });

export type AuthField = 'login' | 'password' | 'nickname';

/** Per field, the Korean reason the server would refuse a sign-up form with; empty when it would pass these checks. */
export function signUpProblems(login: string, password: string, nickname: string): Partial<Record<AuthField, string>> {
  const problems: Partial<Record<AuthField, string>> = {};
  const loginCode = loginProblem(login);
  const passwordCode = passwordProblem(password, loginCode ? null : login);
  const nicknameCode = nicknameProblem(nickname);
  if (loginCode) problems.login = ACCOUNT_TEXT[loginCode];
  if (passwordCode) problems.password = ACCOUNT_TEXT[passwordCode];
  if (nicknameCode) problems.nickname = ACCOUNT_TEXT[nicknameCode];
  return problems;
}

/** The first reason the server would refuse a sign-up form with, found before sending it; null when it is fine. */
export function signUpProblem(login: string, password: string, nickname: string): string | null {
  const problems = signUpProblems(login, password, nickname);
  return problems.login ?? problems.password ?? problems.nickname ?? null;
}

/** Which field a refusal code is about, so a form can mark it; null for a refusal of the whole form. */
export function fieldOfCode(code: string): AuthField | null {
  if (code === 'login' || code === 'login-reserved' || code === 'login-taken') return 'login';
  if (code === 'password' || code === 'password-login' || code === 'password-weak') return 'password';
  if (code === 'nickname' || code === 'nickname-taken') return 'nickname';
  return null;
}

/** A guest account for this browser, named after its online name. */
export function guest(): Promise<AccountUser | null> {
  return attempt(async () => keep(await accountCall<AuthReply>('POST', '/auth/guest', { nickname: useNet.getState().name || undefined }, savedSession()?.token)));
}

/** A guest of this browser signs up in place (the same id and progress); the browser's ranked record goes with it. */
export async function signUp(login: string, password: string, nickname: string): Promise<boolean> {
  const problem = signUpProblem(login, password, nickname);
  if (problem) return fail(problem);
  const body = { login, password, nickname, ...(net.rankedToken ? { rankedToken: net.rankedToken } : {}) };
  const held = savedSession()?.token;
  const user = await attempt(async () => {
    try {
      return keep(await accountCall<AuthReply>('POST', '/auth/signup', body, held));
    } catch (error) {
      // The guest's session ended on the server and its progress with it: sign up afresh.
      if (!held || !(error instanceof AccountApiError) || error.code !== 'session') throw error;
      saveSession(null);
      return keep(await accountCall<AuthReply>('POST', '/auth/signup', body));
    }
  });
  return !!user;
}

export async function logIn(login: string, password: string): Promise<boolean> {
  return !!(await attempt(async () => keep(await accountCall<AuthReply>('POST', '/auth/login', { login, password }))));
}

/** Signs this browser out at once; the server forgets the session when it can be reached. The account stays. */
export async function logOut(): Promise<void> {
  const held = savedSession()?.token;
  saveSession(null);
  clearAccountError();
  if (held) await accountCall('POST', '/auth/logout', undefined, held).catch(() => undefined);
}

/** Ends every session of this account on every device, this one included, then signs this browser out. */
export async function logOutEverywhere(): Promise<boolean> {
  const held = savedSession()?.token;
  if (!held) return false;
  const done = await attempt(() => accountCall<{ ok: true; ended: number }>('POST', '/auth/logout-all', undefined, held));
  if (!done) return false;
  if (savedSession()?.token === held) saveSession(null);
  return true;
}

export async function rename(nickname: string): Promise<boolean> {
  const held = savedSession();
  const name = nickname.trim();
  if (!held) return false;
  if (nicknameProblem(name)) return fail(ACCOUNT_TEXT.nickname, 'nickname');
  const user = await attempt(async () => (await accountCall<UserReply>('POST', '/me/nickname', { nickname: name }, held.token)).user);
  if (user && savedSession()?.token === held.token) saveSession({ token: held.token, user });
  return !!user;
}

/** The other devices are signed out by it; this one stays. */
export async function changePassword(current: string, next: string): Promise<boolean> {
  const held = savedSession()?.token;
  if (!held) return false;
  const problem = passwordProblem(next, useAccount.getState().user?.login ?? null);
  if (problem) return fail(ACCOUNT_TEXT[problem], problem);
  return !!(await attempt(() => accountCall<{ ok: true }>('POST', '/me/password', { current, next }, held)));
}

/** The server's copy of the signed-in user: renamed or signed out elsewhere. Quiet: an unreachable server changes nothing. */
export async function refreshAccount(): Promise<void> {
  const held = savedSession();
  if (!held) return;
  try {
    const { user } = await accountCall<MeReply>('GET', '/me', undefined, held.token);
    if (savedSession()?.token === held.token) saveSession({ token: held.token, user });
  } catch (error) {
    if (error instanceof AccountApiError && error.code === 'session' && savedSession()?.token === held.token) saveSession(null);
  }
}

let making: Promise<AccountUser | null> | null = null;

/**
 * The account progress is kept in: the signed-in one, else a guest made now. Called when something is first worth
 * keeping (a battle's reward), never on page load. Null when the server cannot be reached.
 */
export function ensureAccount(): Promise<AccountUser | null> {
  const user = useAccount.getState().user;
  if (user) return Promise.resolve(user);
  making ??= guest().finally(() => {
    making = null;
  });
  return making;
}
