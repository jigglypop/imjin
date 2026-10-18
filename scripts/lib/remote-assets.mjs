// Runtime binaries straight from the asset store, for a tree that keeps no local copy of them (`assets prune-local`).
// The dev server serves a public/ file that assets.json names but the tree lacks from the shared cache, fetching the
// blob from S3 on first use; tests and scripts that read a binary from Node ask runtimePath for a file on disk. The
// cache is content-addressed (the same one pull and push fill) and kept under a size cap, least recently used out first.
//   IMJIN_ASSET_CACHE_MAX  the cap, in bytes or with K/M/G (default 2G; scripts/assets.mjs reads it)
import { createReadStream } from 'node:fs';
import { copyFile, link, mkdir, stat, utimes } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CACHE, CACHE_CAP, TYPES, Fail, blobKey, cachePath, evictCache, extension, readManifest, request, resetCredentials, sha256, storeError, writeAtomic } from '../assets.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const MANIFEST = join(ROOT, 'assets.json');

export { CACHE_CAP, evictCache };

let memo = { mtime: -1, manifest: null };
/** assets.json, read again only when it changes (a pull or a checkout under a running dev server). */
async function manifest() {
  const mtime = (await stat(MANIFEST).catch(() => null))?.mtimeMs ?? 0;
  if (mtime !== memo.mtime) memo = { mtime, manifest: await readManifest() };
  return memo.manifest;
}

const exists = (path) => stat(path).then((st) => st.isFile(), () => false);
const inflight = new Map();

/** The cache's file of one version: a hit only stamps it as recently used; a miss fetches and checks the blob. */
export async function cachedBlob(store, version, path) {
  const file = cachePath(version.sha256);
  const st = await stat(file).catch(() => null);
  if (st?.size === version.size) {
    const t = new Date();
    await utimes(file, t, t).catch(() => {});
    return file;
  }
  if (!inflight.has(version.sha256)) {
    const job = (async () => {
      let response = await request(store, 'GET', blobKey(store, version.sha256));
      if (response.status === 403) {
        // A dev server outlives an SSO session: ask the aws CLI once more before giving up.
        await response.body?.cancel();
        resetCredentials();
        response = await request(store, 'GET', blobKey(store, version.sha256));
      }
      if (!response.ok) throw await storeError(response, store, `the blob of ${path} (${version.sha256})`);
      const data = Buffer.from(await response.arrayBuffer());
      if (sha256(data) !== version.sha256) throw new Fail(`the blob of ${path} does not match its sha256`);
      await writeAtomic(file, data);
      scheduleEvict();
      return file;
    })().finally(() => inflight.delete(version.sha256));
    inflight.set(version.sha256, job);
  }
  return inflight.get(version.sha256);
}

let evictTimer = null;
function scheduleEvict() {
  if (evictTimer) return;
  evictTimer = setTimeout(() => {
    evictTimer = null;
    evictCache().catch((error) => console.warn(`asset cache: ${error.message}`));
  }, 2000);
  evictTimer.unref?.();
}

/**
 * A path on disk holding the runtime file `rel` (repository-relative, such as public/models/x.glb): the tree's own
 * copy when it has one, else a copy in the cache with the file's extension (loaders such as gltf-transform's go by it).
 */
export async function runtimePath(rel) {
  const local = join(ROOT, rel);
  if (await exists(local)) return local;
  const { files, store } = await manifest();
  const entry = files[rel];
  if (!entry) throw new Fail(`${rel} is neither here nor in assets.json`);
  const blob = await cachedBlob(store, entry, rel);
  const named = join(CACHE, 'named', entry.sha256.slice(0, 2), `${entry.sha256}.${extension(rel)}`);
  if (!(await exists(named))) {
    await mkdir(join(named, '..'), { recursive: true });
    // A hard link costs no space; where the file system refuses one, a copy.
    await link(blob, named).catch(() => copyFile(blob, named));
  }
  return named;
}

/**
 * Connect middleware for the Vite dev server: a GET or HEAD for a public/ file that assets.json names and the tree
 * lacks is answered from the cache (fetched from S3 on first use). Everything else goes on to Vite.
 */
export function remoteAssetsMiddleware({ log = console } = {}) {
  return async (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    } catch {
      return next();
    }
    const ext = extension(pathname);
    if (!Object.hasOwn(TYPES, ext) || pathname.includes('..')) return next();
    const rel = `public${pathname}`;
    try {
      const { files, store } = await manifest();
      const entry = files[rel];
      if (!entry || (await exists(join(ROOT, rel)))) return next();
      const file = await cachedBlob(store, entry, rel);
      res.statusCode = 200;
      res.setHeader('Content-Type', TYPES[ext]);
      res.setHeader('Content-Length', String(entry.size));
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('X-Imjin-Asset', 'remote');
      if (req.method === 'HEAD') return res.end();
      createReadStream(file).on('error', (error) => res.destroy(error)).pipe(res);
    } catch (error) {
      log.warn?.(`remote asset ${rel}: ${error.message}`);
      res.statusCode = 502;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end(`${rel}: not here and not fetched from the asset store (${error.message})\n`);
    }
  };
}
