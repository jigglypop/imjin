import type { AccountUser } from './wire';

// The account this browser is signed in as: the session token and the user it was issued for, so the menu can name
// the player before the server has answered. In-app browsers (KakaoTalk's among them) lose or refuse storage: the
// session then lasts as long as the page, and the account itself stays on the server.

const KEY = 'imjin.session.v1';
export type SavedSession = { token: string; user: AccountUser };

function read(): SavedSession | null {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? 'null') as SavedSession | null;
    return value && typeof value.token === 'string' && value.user && typeof value.user.id === 'string' ? value : null;
  } catch {
    return null;
  }
}

let current = read();
const listeners = new Set<() => void>();
const notify = () => {
  for (const listener of listeners) listener();
};

export const savedSession = (): SavedSession | null => current;

/** Keeps the session (null signs this browser out) and tells whoever listens. */
export function saveSession(next: SavedSession | null) {
  current = next;
  try {
    if (next) localStorage.setItem(KEY, JSON.stringify(next));
    else localStorage.removeItem(KEY);
  } catch {
    // kept for this page only
  }
  notify();
}

/** Called after every change of the session, in this tab or another one. Returns the unsubscribe. */
export function onSessionChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Another tab signed in or out: this one follows.
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('storage', (event) => {
    if (event.key !== KEY && event.key !== null) return;
    current = read();
    notify();
  });
}
