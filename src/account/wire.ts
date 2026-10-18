// The account API between the multiplayer host (server/auth.ts) and the page (src/account): what it sends, and the
// rules a login, a password and a nickname follow. Both sides import it, so the page can check a form before sending.

/** Logins are kept in lower case, so two logins never differ by case alone. */
export const LOGIN_RULE = /^[a-z0-9_]{4,16}$/;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 72;
export const NICKNAME_MAX = 16;
/** A session token: 32 random bytes in base64url. */
export const SESSION_RULE = /^[A-Za-z0-9_-]{43}$/;

/** The same password typed on any device: one Unicode composition, counted in characters rather than UTF-16 units. */
export const passwordText = (password: string) => password.normalize('NFC');
export const passwordFits = (password: string) => {
  const length = [...passwordText(password)].length;
  return length >= PASSWORD_MIN && length <= PASSWORD_MAX;
};

/** The player as the API shows them. A guest has no login yet; signing up gives it one and keeps everything else. */
export type AccountUser = { id: string; login: string | null; nickname: string; guest: boolean; rankedId: string | null; created: number };
/** Progress kept on the server: one JSON object, and the revision every write moves on by one. */
export type AccountProfile = { data: Record<string, unknown>; rev: number };
export type AuthReply = { token: string; user: AccountUser; profile: AccountProfile };
export type MeReply = { user: AccountUser; profile: AccountProfile };
export type UserReply = { user: AccountUser };
export type ApiFailure = { error: { code: string; text: string } };

/**
 * What a refusal says, by its code: short Korean the page shows as it is (src/i18n/en/account.ts has the English).
 * `network` is the page's own, for a server it cannot reach.
 */
export const ACCOUNT_TEXT = {
  origin: '이 주소에서는 쓸 수 없습니다.',
  'not-found': '없는 요청입니다.',
  method: '지원하지 않는 요청입니다.',
  json: '요청 형식이 맞지 않습니다.',
  'too-large': '요청이 너무 큽니다.',
  unavailable: '계정 서버를 쓸 수 없습니다. 잠시 후 다시 시도해 주세요.',
  session: '로그인이 만료되었습니다. 다시 로그인해 주세요.',
  rate: '시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.',
  busy: '서버가 바쁩니다. 잠시 후 다시 시도해 주세요.',
  server: '서버 오류가 났습니다. 잠시 후 다시 시도해 주세요.',
  network: '서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주시기 바랍니다.',
  login: '아이디는 영문 소문자·숫자·_ 4~16자입니다.',
  password: '비밀번호는 8~72자입니다.',
  nickname: '닉네임은 1~16자입니다.',
  'login-taken': '이미 쓰는 아이디입니다.',
  credentials: '아이디나 비밀번호가 맞지 않습니다.',
  current: '지금 비밀번호가 맞지 않습니다.',
  registered: '이미 가입한 계정입니다.',
  guest: '가입한 계정만 할 수 있습니다.',
  ranked: '지금은 랭크 기록을 확인할 수 없습니다.',
  'ranked-code': '복구코드를 확인할 수 없습니다.',
  'ranked-taken': '다른 계정에 연결된 전적입니다.',
  'ranked-other': '이 계정에는 이미 다른 전적이 있습니다.',
  conflict: '다른 곳에서 먼저 바뀌었습니다. 다시 시도해 주세요.',
  insufficient: '잔액이 모자랍니다.',
  rule: '지금은 할 수 없습니다.',
} as const;
export type AccountErrorCode = keyof typeof ACCOUNT_TEXT;
