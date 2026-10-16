import { API_URL } from '../net/address';
import { ACCOUNT_TEXT, type ApiFailure } from './wire';

/** A refusal from the account server, or no answer at all (`network`). `text` is Korean source text, translated where shown. */
export class AccountApiError extends Error {
  constructor(readonly code: string, readonly text: string) {
    super(code);
  }
}

/** A phone on a weak line still gets an answer, or this, in reasonable time. */
const TIMEOUT_MS = 15000;

/** One call to the account API (`path` below /api). The session goes as a Bearer token; no cookies are involved. */
export async function accountCall<T>(method: 'GET' | 'POST', path: string, body?: object, token?: string): Promise<T> {
  const abort = new AbortController();
  const timer = window.setTimeout(() => abort.abort(), TIMEOUT_MS);
  let response: Response;
  let json: T | ApiFailure | null;
  try {
    response = await fetch(API_URL + path, {
      method,
      headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
      credentials: 'omit',
      signal: abort.signal,
    });
    json = (await response.json().catch(() => null)) as T | ApiFailure | null;
  } catch {
    throw new AccountApiError('network', ACCOUNT_TEXT.network);
  } finally {
    window.clearTimeout(timer);
  }
  if (response.ok && json) return json as T;
  const failure = (json as ApiFailure | null)?.error;
  throw new AccountApiError(failure?.code ?? 'server', failure?.text ?? ACCOUNT_TEXT.server);
}
