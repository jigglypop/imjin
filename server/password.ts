// Password hashes: scrypt from node:crypto with a salt per user, written with the parameters that made them
// ($scrypt$ln=15,r=8,p=3$salt$key) so the cost can be raised later; a log-in with an older hash rewrites it.
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { passwordText } from '../src/account/wire';
import { AccountError } from './accounts';

type Cost = { N: number; r: number; p: number };
/** OWASP's scrypt setting for a 32 MiB block, about 0.2 s of one core. */
const COST: Cost = { N: 2 ** 15, r: 8, p: 3 };
const KEY_BYTES = 32;
const STORED = /^\$scrypt\$ln=(\d{1,2}),r=(\d{1,2}),p=(\d{1,2})\$([A-Za-z0-9+/]{22})\$([A-Za-z0-9+/]{43})$/;
/** Hashed against when a login does not exist, so an unknown login takes as long to refuse as a wrong password. */
const NOBODY = randomBytes(16);
/** Hashes waiting beyond this are refused as busy rather than queued for ever. */
const MAX_WAITING = 32;

let tail: Promise<unknown> = Promise.resolve();
let waiting = 0;

/**
 * Hashes run one at a time on the thread pool. scrypt keeps a core busy; on the two-core host a burst of log-ins
 * then takes one core and never the one that steps the battles.
 */
function derive(password: string, salt: Buffer, cost: Cost): Promise<Buffer> {
  if (waiting >= MAX_WAITING) return Promise.reject(new AccountError('busy'));
  waiting += 1;
  const key = tail.then(
    () => new Promise<Buffer>((resolve, reject) => scrypt(passwordText(password), salt, KEY_BYTES, { ...cost, maxmem: 256 * cost.N * cost.r }, (error, derived) => (error ? reject(error) : resolve(derived)))),
  );
  tail = key.catch(() => undefined);
  return key.finally(() => {
    waiting -= 1;
  });
}

const encode = (bytes: Buffer) => bytes.toString('base64').replace(/=+$/, '');

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, COST);
  return `$scrypt$ln=${Math.log2(COST.N)},r=${COST.r},p=${COST.p}$${encode(salt)}$${encode(key)}`;
}

/** Whether `password` matches the stored hash; with no hash (no such login) it costs the same and is false. */
export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  const parts = stored ? STORED.exec(stored) : null;
  if (!parts) {
    await derive(password, NOBODY, COST);
    return false;
  }
  const key = Buffer.from(parts[5]!, 'base64');
  const derived = await derive(password, Buffer.from(parts[4]!, 'base64'), { N: 2 ** Number(parts[1]), r: Number(parts[2]), p: Number(parts[3]) });
  return timingSafeEqual(derived, key);
}

/** A hash made with other parameters than today's, to be rewritten at the next log-in. */
export function staleHash(stored: string): boolean {
  return !stored.startsWith(`$scrypt$ln=${Math.log2(COST.N)},r=${COST.r},p=${COST.p}$`);
}
