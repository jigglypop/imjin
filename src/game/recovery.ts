// Crash recovery for phones. iOS kills a tab that uses too much memory and quietly reloads it, so the page cannot see
// the kill happen. A marker is written when a battle starts loading and removed when the battle is ready or the player
// leaves; a marker found at startup means the previous load died. Storage can be blocked (private mode), so every
// access is guarded and the game works without it.

import type { Faction } from '../sim/types';
import type { ScenarioId } from '../sim/scenarios';
import type { ConquestSetup } from './Engine';

const MARKER_KEY = 'imjin.loading';
const CRASHES_KEY = 'imjin.crashes';
/** A marker older than this belongs to a tab that was abandoned, not one that died while loading. */
const MARKER_MAX_AGE_MS = 30 * 60 * 1000;

/** What a crashed battle was, when it can be started again from a saved description. */
export type ResumeLaunch = { kind: 'scenario'; id: ScenarioId; faction: Faction } | { kind: 'conquest'; setup: ConquestSetup };

const stores: Storage[] = [];
for (const name of ['localStorage', 'sessionStorage'] as const) {
  try {
    stores.push(window[name]);
  } catch {
    // Reaching the storage object itself can throw when site data is blocked.
  }
}

// The loading marker is per tab: sessionStorage survives the reload iOS does after killing a tab, and a second tab
// opened mid-load never sees it. localStorage is shared by every tab, so it is only a fallback when sessionStorage is
// unavailable.
let sessionStore: Storage | null = null;
try {
  sessionStore = window.sessionStorage;
  sessionStore.getItem(MARKER_KEY);
} catch {
  sessionStore = null;
}
const markerStores: Storage[] = sessionStore ? [sessionStore] : stores;

function read(key: string, list: Storage[] = stores): string | null {
  for (const store of list) {
    try {
      const value = store.getItem(key);
      if (value !== null) return value;
    } catch {
      // Try the next store.
    }
  }
  return null;
}

function write(key: string, value: string, list: Storage[] = stores) {
  for (const store of list) {
    try {
      store.setItem(key, value);
    } catch {
      // Quota or blocked: the marker is best effort.
    }
  }
}

function remove(key: string, list: Storage[] = stores) {
  for (const store of list) {
    try {
      store.removeItem(key);
    } catch {
      // Nothing to clean up.
    }
  }
}

type Marker = { t: number; launch?: ResumeLaunch };

function parseMarker(raw: string | null): Marker | null {
  if (!raw) return null;
  try {
    const m = JSON.parse(raw) as Marker;
    return typeof m.t === 'number' ? m : null;
  } catch {
    return null;
  }
}

export type Recovery = {
  /** 0 normal; 1 the previous load died (lowest tier and level, WebGL2); 2 it died again (also lower resolution, fewer full-detail ships, no clouds). */
  step: 0 | 1 | 2;
  /** The battle that died, when it can be started again. */
  resume: ResumeLaunch | null;
};

function resolve(): Recovery {
  const marker = parseMarker(read(MARKER_KEY, markerStores));
  remove(MARKER_KEY, markerStores);
  if (!marker || Date.now() - marker.t > MARKER_MAX_AGE_MS) return { step: 0, resume: null };
  const crashes = (Number(read(CRASHES_KEY)) || 0) + 1;
  write(CRASHES_KEY, String(crashes));
  return { step: crashes >= 2 ? 2 : 1, resume: marker.launch ?? null };
}

/** Resolved once at startup, before the quality tier is chosen. */
export const recovery: Recovery = resolve();

/** A battle starts loading: if the page dies before `battleReady`, the next startup knows. */
export function markLoading(launch?: ResumeLaunch) {
  write(MARKER_KEY, JSON.stringify({ t: Date.now(), launch } satisfies Marker), markerStores);
}

/** The player left, or the load failed with an error the page handled: not a memory kill. */
export function clearLoading() {
  remove(MARKER_KEY, markerStores);
}

/** The battle reached ready, so the settings it ran with hold. */
export function battleReady() {
  remove(MARKER_KEY, markerStores);
  remove(CRASHES_KEY);
}

// A tab that unloads normally (closed, reloaded, navigated away) fires pagehide. A killed one does not.
window.addEventListener('pagehide', clearLoading);
