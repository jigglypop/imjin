// The HTTP API beside the WebSocket on the multiplayer server: routes under /api/, CORS for the game's own pages,
// JSON bodies up to 16 KB, Bearer sessions in the Authorization header (no cookies), and errors as
// { error: { code, text } } with a short Korean text the page can show. server/auth.ts adds the account routes; a
// later feature adds its own with route() or user(), which hands its handler the signed-in user.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { ACCOUNT_TEXT, type AccountErrorCode } from '../src/account/wire';
import { AccountError, type AccountStore, type SignedIn, type UserRecord } from './accounts';

/** Browsers send their page's origin; only the game's own pages (and local or LAN ones) may call. Other clients send none. */
const ORIGINS = ['https://imjin1592.com', 'https://www.imjin1592.com', ...(process.env.ALLOWED_ORIGINS ?? '').split(',').filter(Boolean)];
export const originAllowed = (origin: string | undefined) => !origin || ORIGINS.includes(origin) || /^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?$/.test(origin);

/** The caller's address. Only the local TLS proxy may supply the original one; a direct client cannot spoof the header. */
export function addressOf(request: IncomingMessage): string {
  const remote = request.socket.remoteAddress ?? 'unknown';
  const forwarded = request.headers['x-forwarded-for'];
  return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote) && typeof forwarded === 'string' ? forwarded.split(',').at(-1)!.trim() : remote;
}

/** HTTP status of each refusal. */
const STATUS: Record<AccountErrorCode, number> = {
  origin: 403,
  'not-found': 404,
  method: 405,
  json: 400,
  'too-large': 413,
  unavailable: 503,
  session: 401,
  rate: 429,
  busy: 503,
  server: 500,
  network: 503,
  login: 400,
  password: 400,
  nickname: 400,
  'login-taken': 409,
  credentials: 401,
  current: 403,
  registered: 409,
  guest: 403,
  ranked: 503,
  'ranked-code': 400,
  'ranked-taken': 409,
  'ranked-other': 409,
  conflict: 409,
  insufficient: 409,
  rule: 409,
};

/** A refusal with its code; the status and the text come from the tables, unless given. */
export class ApiError extends Error {
  constructor(readonly code: AccountErrorCode, readonly status = STATUS[code], readonly text: string = ACCOUNT_TEXT[code]) {
    super(code);
  }
}

/** At most `max` attempts per key in a fixed window of `windowMs`, kept in memory like the ranked account creation limit. */
export class Limiter {
  private windows = new Map<string, { since: number; count: number }>();
  private swept = 0;
  constructor(readonly max: number, readonly windowMs: number) {}

  /** Counts an attempt; false when this key has used up its window. */
  take(key: string, now = Date.now()): boolean {
    if (now - this.swept >= this.windowMs) {
      for (const [k, w] of this.windows) if (now - w.since >= this.windowMs) this.windows.delete(k);
      this.swept = now;
    }
    let window = this.windows.get(key);
    if (!window || now - window.since >= this.windowMs) {
      window = { since: now, count: 0 };
      this.windows.set(key, window);
    }
    if (window.count >= this.max) return false;
    window.count += 1;
    return true;
  }
}

const MAX_BODY = 16 * 1024;
const BEARER = /^Bearer ([A-Za-z0-9_-]{43})$/;

export type ApiRequest = {
  method: 'GET' | 'POST';
  path: string;
  address: string;
  /** The Bearer session token as sent (well formed, not yet checked), or null. */
  token: string | null;
  /** The JSON object of a POST; {} for a GET or an empty body. */
  body: Record<string, unknown>;
  now: number;
  accounts: AccountStore;
};
/** A request whose session was checked: the user it signs in and the stored hash of that session. */
export type ApiUserRequest = ApiRequest & { user: UserRecord; session: string };
type Route = { method: 'GET' | 'POST'; signedIn: boolean; handler: (request: ApiUserRequest) => unknown };

async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  if (Number(request.headers['content-length'] ?? 0) > MAX_BODY) throw new ApiError('too-large');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY) throw new ApiError('too-large');
    chunks.push(chunk);
  }
  if (!size) return {};
  if (!/^application\/json\s*(;|$)/i.test(request.headers['content-type'] ?? '')) throw new ApiError('json', 415);
  let value: unknown;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new ApiError('json');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError('json');
  return value as Record<string, unknown>;
}

export class ApiRouter {
  private routes = new Map<string, Route>();
  /** Every request from one address, whatever it asks: a ceiling well above what a page sends. */
  private requests = new Limiter(240, 60000);

  /** `accounts` is null when the store could not open: every route then answers 503 and the game goes on without it. */
  constructor(private readonly accounts: AccountStore | null) {}

  /** A route anyone may call; it reads `token` itself when a session matters to it. */
  route(method: 'GET' | 'POST', path: string, handler: (request: ApiRequest) => unknown) {
    this.add(path, { method, signedIn: false, handler });
  }

  /** A route for a signed-in user: a missing, expired or ended session is refused with 401 before it runs. */
  user(method: 'GET' | 'POST', path: string, handler: (request: ApiUserRequest) => unknown) {
    this.add(path, { method, signedIn: true, handler });
  }

  private add(path: string, route: Route) {
    if (!path.startsWith('/api/') || this.routes.has(path)) throw new Error(`api route ${path} is taken or outside /api/`);
    this.routes.set(path, route);
  }

  /** Answers a request under /api/ and returns true; anything else is left to the caller. */
  handle(request: IncomingMessage, response: ServerResponse): boolean {
    const path = (request.url ?? '/').split('?')[0]!;
    if (!path.startsWith('/api/')) return false;
    void this.serve(request, response, path);
    return true;
  }

  private async serve(request: IncomingMessage, response: ServerResponse, path: string) {
    const origin = typeof request.headers.origin === 'string' ? request.headers.origin : undefined;
    const headers: Record<string, string> = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', vary: 'Origin' };
    const send = (status: number, body: unknown) => {
      if (response.headersSent) return;
      response.writeHead(status, headers);
      response.end(body === undefined ? undefined : JSON.stringify(body));
    };
    try {
      if (!originAllowed(origin)) throw new ApiError('origin');
      if (origin) headers['access-control-allow-origin'] = origin;
      if (request.method === 'OPTIONS') {
        Object.assign(headers, { 'access-control-allow-methods': 'GET, POST', 'access-control-allow-headers': 'authorization, content-type', 'access-control-max-age': '600' });
        send(204, undefined);
        return;
      }
      const route = this.routes.get(path);
      if (!route) throw new ApiError('not-found');
      if (request.method !== route.method) {
        headers.allow = route.method;
        throw new ApiError('method');
      }
      const address = addressOf(request);
      if (!this.requests.take(address)) throw new ApiError('rate');
      const accounts = this.accounts;
      if (!accounts?.ready) throw new ApiError('unavailable');
      const body = route.method === 'POST' ? await readBody(request) : {};
      const token = BEARER.exec(request.headers.authorization ?? '')?.[1] ?? null;
      const now = Date.now();
      const base: ApiRequest = { method: route.method, path, address, token, body, now, accounts };
      let signedIn: SignedIn | null = null;
      if (route.signedIn) {
        signedIn = token ? await accounts.session(token, now) : null;
        if (!signedIn) throw new ApiError('session');
      }
      // A plain route never reads `user` or `session`; the cast only lets both kinds share one handler type.
      const result = await route.handler(signedIn ? { ...base, user: signedIn.user, session: signedIn.hash } : (base as ApiUserRequest));
      send(200, result ?? { ok: true });
    } catch (error) {
      const failure = error instanceof ApiError ? error : error instanceof AccountError && error.code !== 'invalid' ? new ApiError(error.code) : null;
      if (!failure) console.error(`api ${path} failed:`, error instanceof Error ? error.message : 'unknown error');
      const answer = failure ?? new ApiError('server');
      if (answer.status === 429) headers['retry-after'] = '60';
      // A body that was too large is not read to its end: the connection closes instead of waiting for the rest.
      if (answer.status === 413) headers.connection = 'close';
      send(answer.status, { error: { code: answer.code, text: answer.text } });
    }
  }
}
