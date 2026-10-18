import { useSyncExternalStore } from 'react';

// Background download progress for the thin bar at the top edge (AssetBar.tsx): the 3D models, textures and terrain
// the menu scene, /generals and a chapter switch stream in while the page is already usable. Two sources feed it:
//  - fetch() of asset files (GLB, KTX2, bin, terrain, sky), counted byte by byte on a clone of the response;
//  - images loaded from script (three.js TextureLoader decodes through <img>, which fetch never sees), counted per
//    file from the moment their src is set to their load or error event; three.js loading managers likewise.
// One entry per URL, so a GLTFLoader file that passes through both is counted once. No three.js import here: the
// modules that own a loader hand their manager over (watchManager).

type Entry = { loaded: number; total: number; done: boolean };

/** What a file without a known size weighs in the sum: about a texture's worth. */
const GUESS = 400_000;
const ASSET = /\.(glb|gltf|bin|ktx2|basis|dem|f32|ter|hdr|exr|webp|png|jpe?g|avif)(\?|#|$)/i;
/** Files under these roots are UI art the page shows by itself; they are not background loading. */
const SKIP = /\/(ui|og|audio)\//;

const entries = new Map<string, Entry>();
let state = { active: false, progress: 0 };
const listeners = new Set<() => void>();
let idleTimer = 0;

function emit() {
  let loaded = 0;
  let total = 0;
  let open = 0;
  for (const e of entries.values()) {
    const size = e.total > 0 ? e.total : GUESS;
    total += size;
    loaded += e.done ? size : Math.min(e.loaded, size);
    if (!e.done) open++;
  }
  const progress = total > 0 ? loaded / total : 1;
  window.clearTimeout(idleTimer);
  if (open === 0 && entries.size) {
    state = { active: true, progress: 1 };
    // A batch is over once nothing new starts for a moment; the next batch starts from zero.
    idleTimer = window.setTimeout(() => {
      entries.clear();
      state = { active: false, progress: 1 };
      listeners.forEach((l) => l());
    }, 450);
  } else state = { active: open > 0, progress };
  notify();
}

let frame = 0;
/** At most one update a frame: a large file reports hundreds of chunks. */
function notify() {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    listeners.forEach((l) => l());
  });
}

const key = (url: string) => {
  try {
    return new URL(url, location.href).href;
  } catch {
    return url;
  }
};
const wanted = (url: string) => ASSET.test(url) && !SKIP.test(new URL(url, location.href).pathname);

function start(url: string) {
  const k = key(url);
  const e = entries.get(k);
  if (e && !e.done) return e;
  const fresh = { loaded: 0, total: 0, done: false };
  entries.set(k, fresh);
  emit();
  return fresh;
}
function finish(url: string) {
  const e = entries.get(key(url));
  if (!e || e.done) return;
  e.done = true;
  emit();
}

let installed = false;
/** Wraps window.fetch once, at startup, to count asset downloads. */
export function installAssetProgress() {
  if (installed || typeof window === 'undefined' || !window.fetch) return;
  installed = true;
  const original = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!wanted(url)) return original(input, init);
    const e = start(url);
    try {
      const res = await original(input, init);
      e.total = Number(res.headers.get('content-length')) || 0;
      const body = res.ok ? res.clone().body : null;
      if (!body) finish(url);
      else {
        // The clone is read alongside the caller's copy: only the counting happens here.
        void (async () => {
          const reader = body.getReader();
          try {
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              e.loaded += value.byteLength;
              emit();
            }
          } catch {
            /* aborted: counted as done */
          } finally {
            finish(url);
          }
        })();
      }
      return res;
    } catch (err) {
      finish(url);
      throw err;
    }
  };
  // Images: the src setter is wrapped, so every texture decoded through an <img> is seen whoever creates it.
  const desc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
  if (desc?.set && desc.get) {
    const set = desc.set;
    Object.defineProperty(HTMLImageElement.prototype, 'src', {
      ...desc,
      set(this: HTMLImageElement, value: string) {
        if (typeof value === 'string' && wanted(value)) {
          start(value);
          const done = () => finish(value);
          this.addEventListener('load', done, { once: true });
          this.addEventListener('error', done, { once: true });
        }
        set.call(this, value);
      },
    });
  }
}

let tasks = 0;
/**
 * Work that is not a download but keeps a screen waiting on its 3D scene (building ships, compiling shaders): it
 * counts as `weight` bytes, creeping toward 90% over about `expectMs` until `done()`; `set(f)` moves it on.
 */
export function trackTask(weight = 3_000_000, expectMs = 6000) {
  const url = `task:${++tasks}`;
  const e = start(url);
  e.total = weight;
  const t0 = performance.now();
  let floor = 0;
  const tick = window.setInterval(() => {
    if (e.done) return window.clearInterval(tick);
    const creep = 0.9 * (1 - Math.exp(-(performance.now() - t0) / expectMs));
    e.loaded = weight * Math.max(floor, creep);
    emit();
  }, 200);
  return {
    set(f: number) {
      floor = Math.max(floor, Math.min(0.95, f));
      e.loaded = Math.max(e.loaded, weight * floor);
      emit();
    },
    done() {
      window.clearInterval(tick);
      finish(url);
    },
  };
}

type Manager = { onStart?: unknown; itemStart: (url: string) => void; itemEnd: (url: string) => void; itemError: (url: string) => void };
const watched = new WeakSet<object>();
/** Counts a three.js LoadingManager's files (DefaultLoadingManager covers every loader made without one). */
export function watchManager(manager: Manager) {
  if (watched.has(manager)) return;
  watched.add(manager);
  const { itemStart, itemEnd, itemError } = manager;
  manager.itemStart = function (url: string) {
    if (wanted(url)) start(url);
    itemStart.call(this, url);
  };
  manager.itemEnd = function (url: string) {
    itemEnd.call(this, url);
    if (wanted(url)) finish(url);
  };
  manager.itemError = function (url: string) {
    itemError.call(this, url);
    if (wanted(url)) finish(url);
  };
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const snapshot = () => state;
export const useAssetProgress = () => useSyncExternalStore(subscribe, snapshot, snapshot);
