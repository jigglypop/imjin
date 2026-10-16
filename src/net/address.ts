/** Where the multiplayer server listens. A local dev server is used when the page itself is local. */
export const MP_URL: string =
  (import.meta.env.VITE_MP_URL as string | undefined) ?? (/^(127\.0\.0\.1|localhost)$/.test(location.hostname) ? 'ws://127.0.0.1:8787/ws' : 'wss://mp.imjin1592.com/ws');

/** The account API on the same server: ws becomes http, wss https, and /ws /api. */
export const API_URL = MP_URL.replace(/^ws/, 'http').replace(/\/ws$/, '/api');
