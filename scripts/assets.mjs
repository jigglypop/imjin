// Binary assets live in S3 by content hash instead of in git. assets.json at the repository root (committed) names
// every managed file, a binary under public/ or assets-src/, with its sha256 and size, and keeps the versions each one
// replaced. Blobs are immutable and never deleted, so every version of every generated model stays retrievable next to
// its provenance record: that is the model vault (`models`). A cache outside the repository keeps one copy of each blob
// for all worktrees. Run it without a command for the usage.
import { spawnSync } from 'node:child_process';
import { createHash, createHmac } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const USAGE = `node scripts/assets.mjs <command>   (or npm run assets -- <command>)
  status [--remote]             what differs from assets.json; --remote: whether the bucket holds every blob it names
  push [paths...] [--dry-run]   upload new and changed files and record them; a named file that is gone is dropped
  pull [paths...] [--dry-run] [--all]   make the tree match assets.json, from the cache or S3; --all also brings
                                back the files prune-local left in S3
  verify                        the bucket holds every blob assets.json names, history included, at its size
  restore <path> [--previous | --sha=<prefix>]   bring back an earlier version (the previous one by default)
  models [--json]               the model vault: every .glb with its triangles, versions and provenance records
  setup [--apply]               the private bucket and the deploy role's read access, through the aws CLI
  untrack [--apply]             the cut-over: managed files out of git, their patterns into .gitignore
  archive <paths...> [--from=<list>] [--dry-run]   generation sources to the cold archive (archive/ in the bucket,
                                assets-archive.json), each local copy deleted once the bucket holds it; CI never pulls it
  archive-pull <path|glob...> [--dry-run] [--force]   bring archived files back on demand
  archive-status [--remote]     what the archive holds per folder; --remote: the bucket holds every archived blob
  prune-local [paths...] [--min-size=<n[K|M|G]>] [--dry-run]   delete local copies of public/ runtime files the bucket
                                holds (checked), recorded in .assets-remote.json; the dev server fetches them from S3
                                (default: public/models); pull skips them until pull --all
Environment: IMJIN_ASSET_CACHE (the shared cache), IMJIN_ASSET_CACHE_MAX (its cap, default 2G), IMJIN_ASSET_ENDPOINT (an S3-compatible endpoint, path-style),
AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_SESSION_TOKEN (else the aws CLI's credentials).`;

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MANIFEST = join(ROOT, 'assets.json');
// This tree's runtime files kept only in S3 (prune-local): local, never committed; pull leaves them out until --all.
const REMOTE = join(ROOT, '.assets-remote.json');
const REMOTE_SCHEMA = 'imjin.assets-remote.v1';
const SCHEMA = 'imjin.assets.v1';
const STORE = { bucket: 'imjin1592-assets', region: 'ap-northeast-2', prefix: 'sha256/' };
const DEPLOY_ROLE = 'imjin1592-github-deploy';
const ROOTS = ['public', 'assets-src'];
// The managed extensions, each with the Content-Type its blobs are stored under. Everything else under ROOTS (json,
// md, txt, svg, webmanifest) stays an ordinary git file.
const TYPES = {
  avif: 'image/avif',
  bin: 'application/octet-stream',
  dem: 'application/octet-stream',
  exr: 'image/x-exr',
  glb: 'model/gltf-binary',
  hdr: 'image/vnd.radiance',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  ktx2: 'image/ktx2',
  mp3: 'audio/mpeg',
  mp4: 'video/mp4',
  ogg: 'audio/ogg',
  png: 'image/png',
  wav: 'audio/wav',
  webm: 'video/webm',
  webp: 'image/webp',
  woff: 'font/woff',
  woff2: 'font/woff2',
  zip: 'application/zip',
};
// The records in assets-src/<pack>/ that the model vault reads to say where a model came from.
const RECORDS = ['provenance.json', 'runtime-assets.json', 'README.md'];
// The fields of a record that say what made a model: tools and models by name, credits by number.
const TOOL_FIELD = /^(provider|tool|model|apiModel|modelRequested)$/;
const CONCURRENCY = 8;
const ATTEMPTS = 5;
const SHA = /^[0-9a-f]{64}$/;
const EMPTY_SHA = createHash('sha256').digest('hex');
const CACHE = process.env.IMJIN_ASSET_CACHE
  ? resolve(process.env.IMJIN_ASSET_CACHE)
  : process.platform === 'win32'
    ? join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'imjin-assets')
    : join(homedir(), '.cache', 'imjin-assets');
// The .gitignore block the cut-over writes, one pattern per root and extension. It goes first because git lets the
// last matching rule decide: the rules after it that keep local scratch (Meshy originals, rejected candidates) out of
// git then keep that scratch out of the store as well.
const IGNORE_HEAD = '# Binary assets live in S3 by content hash';
const IGNORE_PATTERNS = ROOTS.flatMap((root) => Object.keys(TYPES).map((ext) => `/${root}/**/*.${ext}`));

/** An expected failure (a missing bucket, a bad argument): printed as one line, not as a stack trace. */
class Fail extends Error {}
const fail = (message) => {
  throw new Fail(message);
};

const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const extension = (path) => /\.([^./]+)$/.exec(path)?.[1].toLowerCase() ?? '';
const managed = (path) => Object.hasOwn(TYPES, extension(path));
const blobKey = (store, hash) => `${store.prefix}${hash.slice(0, 2)}/${hash}`;
const cachePath = (hash) => join(CACHE, 'sha256', hash.slice(0, 2), hash);
const exists = (path) => stat(path).then(() => true, () => false);
const versionsOf = (entry) => [entry, ...(entry.history ?? [])];
const recordedHashes = (manifest) => new Set(Object.values(manifest.files).flatMap((entry) => versionsOf(entry).map((v) => v.sha256)));
const parseJson = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};
const now = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
// RFC 3986 percent-encoding, the form SigV4 signs: everything but letters, digits and -._~ is escaped.
const encode = (text) => encodeURIComponent(text).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

function size(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function list(title, paths, detail) {
  if (!paths.length) return;
  console.log(`${title} (${paths.length}):`);
  for (const path of paths) console.log(`  ${path}  ${detail(path)}`);
}

/** Runs `task` over `items`, CONCURRENCY at a time. The first failure stops new work and is thrown once the rest settle. */
async function pool(items, task) {
  const results = [];
  let next = 0;
  let failure = null;
  const worker = async () => {
    while (!failure && next < items.length) {
      const i = next++;
      try {
        results[i] = await task(items[i]);
      } catch (error) {
        failure ??= error;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));
  if (failure) throw failure;
  return results;
}

// ---- assets.json

async function readManifest() {
  let text;
  try {
    text = await readFile(MANIFEST, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return { schema: SCHEMA, store: { ...STORE }, files: {} };
    throw error;
  }
  let manifest;
  try {
    manifest = JSON.parse(text);
  } catch (error) {
    fail(`assets.json is not valid JSON (${error.message}); after a merge conflict keep one line per file`);
  }
  if (manifest?.schema !== SCHEMA) fail(`assets.json: the schema is not ${SCHEMA}`);
  const { bucket, region, prefix } = manifest.store ?? {};
  if (![bucket, region, prefix].every((value) => typeof value === 'string' && value)) fail('assets.json: the store needs a bucket, a region and a prefix');
  manifest.files ??= {};
  // Its paths become file names and its hashes cache paths and store keys, so none of them may point anywhere else.
  for (const [path, entry] of Object.entries(manifest.files)) {
    const parts = path.split('/');
    const inside = ROOTS.includes(parts[0]) && parts.length > 1 && parts.every((part) => part && part !== '.' && part !== '..') && !/[\\:]/.test(path);
    const history = entry?.history ?? [];
    const sound = Array.isArray(history) && history.every((v) => typeof v?.until === 'string') && [entry ?? {}, ...history].every((v) => SHA.test(v?.sha256) && Number.isSafeInteger(v.size) && v.size >= 0);
    if (!inside || !managed(path) || !sound) fail(`assets.json: bad entry ${JSON.stringify(path)}`);
  }
  return manifest;
}

// One line per file, sorted by path, so that a change to one file is a one-line diff.
function formatManifest({ schema, store, files }) {
  const version = (v) => `"sha256": ${JSON.stringify(v.sha256)}, "size": ${v.size}`;
  const history = (entry) => (entry.history?.length ? `, "history": [${entry.history.map((h) => `{ ${version(h)}, "until": ${JSON.stringify(h.until)} }`).join(', ')}]` : '');
  const lines = Object.keys(files).sort().map((path) => `    ${JSON.stringify(path)}: { ${version(files[path])}${history(files[path])} }`);
  return `{
  "schema": ${JSON.stringify(schema)},
  "store": { "bucket": ${JSON.stringify(store.bucket)}, "region": ${JSON.stringify(store.region)}, "prefix": ${JSON.stringify(store.prefix)} },
  "files": {${lines.length ? `\n${lines.join(',\n')}\n  ` : ''}}
}
`;
}

const writeManifest = (manifest) => writeAtomic(MANIFEST, formatManifest(manifest));
const readRemote = async () => new Set((await readFile(REMOTE, 'utf8').then(JSON.parse).catch(() => null))?.paths ?? []);
async function writeRemote(paths) {
  if (!paths.size) return rm(REMOTE, { force: true });
  const note = 'runtime files this tree keeps only in S3 (npm run assets -- prune-local); pull --all brings them back';
  await writeAtomic(REMOTE, `${JSON.stringify({ schema: REMOTE_SCHEMA, note, paths: [...paths].sort() }, null, 2)}\n`);
}

// ---- the tree

let writes = 0;
/** Writes through a temporary file beside the target, so that an interrupted run never leaves half a file. */
async function writeAtomic(path, data) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}-${++writes}.assets-tmp`;
  try {
    await writeFile(temporary, data);
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

/** A command-line path as a repository-relative POSIX path under one of ROOTS. */
function repoPath(arg) {
  const path = relative(ROOT, resolve(arg)).split(sep).join('/');
  if (!ROOTS.some((root) => path === root || path.startsWith(`${root}/`))) fail(`${arg}: managed files live under ${ROOTS.map((root) => `${root}/`).join(' and ')}`);
  return path;
}

/** The candidates the command-line paths name, each a file itself or everything under a directory; no paths name all. */
function pick(args, candidates, nothing) {
  const all = [...candidates];
  if (!args.length) return all.sort();
  const picked = new Set();
  for (const arg of args) {
    const path = repoPath(arg);
    const hits = all.filter((candidate) => candidate === path || candidate.startsWith(`${path}/`));
    if (!hits.length) fail(`${arg}: ${nothing}`);
    for (const hit of hits) picked.add(hit);
  }
  return [...picked].sort();
}

/**
 * Every file under ROOTS with a managed extension that git does not ignore by a rule of its own: the local scratch
 * .gitignore keeps out of git stays out of the store too, while a file ignored only by the asset block is managed.
 */
async function scan() {
  const found = [];
  const walk = async (dir) => {
    const entries = await readdir(join(ROOT, dir), { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && managed(path)) found.push(path);
    }
  };
  for (const root of ROOTS) await walk(root);
  if (!found.length) return found;
  const run = spawnSync('git', ['check-ignore', '--verbose', '--non-matching', '-z', '--stdin'], { cwd: ROOT, input: found.join('\0'), encoding: 'utf8', maxBuffer: 1 << 28 });
  // Outside a git checkout nothing is ignored; status 1 only says that no path matched.
  if (run.error || (run.status !== 0 && run.status !== 1)) return found;
  const fields = run.stdout.split('\0');
  const ours = new Set(IGNORE_PATTERNS);
  const kept = [];
  for (let i = 0; i + 3 < fields.length; i += 4) {
    const [source, , pattern, path] = fields.slice(i, i + 4);
    if (!source || pattern.startsWith('!') || ours.has(pattern)) kept.push(path);
  }
  return kept;
}

/**
 * The sha256 of every file this tree hashed or wrote, by path, size and mtime, so that an unchanged tree is checked
 * without reading it. It lives in the cache, one file per tree, so that worktrees never write each other's.
 */
async function openIndex() {
  const path = join(CACHE, 'index', `${sha256(ROOT).slice(0, 16)}.json`);
  const files = await readFile(path, 'utf8').then(JSON.parse).then((index) => index.files ?? {}).catch(() => ({}));
  let dirty = false;
  return {
    get(rel, st) {
      const known = files[rel];
      return known?.[0] === st.size && known[1] === st.mtimeMs ? known[2] : null;
    },
    set(rel, st, hash) {
      files[rel] = [st.size, st.mtimeMs, hash];
      dirty = true;
    },
    // The index only saves work, so failing to write it is harmless.
    save: async () => {
      if (dirty) await writeAtomic(path, JSON.stringify({ root: ROOT, files })).catch(() => {});
    },
  };
}

const hashed = { files: 0, bytes: 0 };

/** { sha256, size } of a tree file, from the index while its size and mtime are unchanged; null when it is absent. */
async function localHash(index, path) {
  const file = join(ROOT, path);
  const st = await stat(file).catch(() => null);
  if (!st?.isFile()) return null;
  let hash = index.get(path, st);
  if (!hash) {
    hash = await new Promise((done, reject) => {
      const digest = createHash('sha256');
      createReadStream(file).on('error', reject).on('data', (chunk) => digest.update(chunk)).on('end', () => done(digest.digest('hex')));
    });
    index.set(path, st, hash);
    hashed.files++;
    hashed.bytes += st.size;
  }
  return { sha256: hash, size: st.size };
}

function reportHashing() {
  if (hashed.files) console.log(`hashed ${hashed.files} files (${size(hashed.bytes)}); they are not read again until they change`);
}

/** Keeps a verified blob in the cache. The cache only saves downloads, so a copy it cannot take is no failure. */
const keep = (hash, data) => writeAtomic(cachePath(hash), data).catch(() => {});

/** Whether content is work nobody has pushed: neither the store (through assets.json) nor the cache could give it back. */
async function unpushed(recorded, hash) {
  return !recorded.has(hash) && !(await exists(cachePath(hash)));
}

// ---- S3

let identity = null;
/** Forgets the credentials, so that a long-running dev server asks the aws CLI again after a session expires. */
const resetCredentials = () => {
  identity = null;
};
/** AWS credentials from the environment (as CI's configure-aws-credentials sets them), else from the aws CLI. */
function awsCredentials() {
  if (identity) return identity;
  const env = process.env;
  if (env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY) {
    identity = { accessKeyId: env.AWS_ACCESS_KEY_ID, secretAccessKey: env.AWS_SECRET_ACCESS_KEY, sessionToken: env.AWS_SESSION_TOKEN };
    return identity;
  }
  // The CLI resolves profiles, SSO and `aws login` sessions; it is asked once a run, and only when S3 is needed.
  const run = spawnSync('aws', ['configure', 'export-credentials', '--format', 'process'], { encoding: 'utf8' });
  const exported = run.status === 0 ? parseJson(run.stdout) : null;
  if (!exported?.AccessKeyId || !exported.SecretAccessKey) {
    const why = run.error?.message ?? (run.stderr.trim().split('\n').pop() || 'it printed no credentials');
    fail(`no AWS credentials: set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY or log in to the aws CLI (${why})`);
  }
  identity = { accessKeyId: exported.AccessKeyId, secretAccessKey: exported.SecretAccessKey, sessionToken: exported.SessionToken };
  return identity;
}

/**
 * The headers that sign one S3 request with AWS Signature Version 4. `url` must already be percent-encoded the way
 * SigV4 canonicalises it (`encode` on every path segment and query part), as storeUrl builds it.
 */
export function signV4({ method, url, headers = {}, payloadHash, credentials, region, date = new Date() }) {
  const { host, pathname, search } = new URL(url);
  const time = date.toISOString().replace(/[-:]|\.\d{3}/g, '');
  const day = time.slice(0, 8);
  const signed = Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), String(value).trim().replace(/\s+/g, ' ')]));
  Object.assign(signed, { host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': time });
  if (credentials.sessionToken) signed['x-amz-security-token'] = credentials.sessionToken;
  const names = Object.keys(signed).sort();
  const query = search
    .slice(1)
    .split('&')
    .filter(Boolean)
    .map((pair) => {
      const at = pair.indexOf('=');
      return at < 0 ? [pair, ''] : [pair.slice(0, at), pair.slice(at + 1)];
    })
    .sort(([a, x], [b, y]) => (a === b ? (x < y ? -1 : x > y ? 1 : 0) : a < b ? -1 : 1))
    .map(([name, value]) => `${name}=${value}`)
    .join('&');
  const canonical = [method, pathname, query, ...names.map((name) => `${name}:${signed[name]}`), '', names.join(';'), payloadHash].join('\n');
  const scope = `${day}/${region}/s3/aws4_request`;
  const hmac = (key, data) => createHmac('sha256', key).update(data).digest();
  const key = hmac(hmac(hmac(hmac(`AWS4${credentials.secretAccessKey}`, day), region), 's3'), 'aws4_request');
  const signature = hmac(key, ['AWS4-HMAC-SHA256', time, scope, sha256(canonical)].join('\n')).toString('hex');
  // fetch sends the same host from the URL.
  delete signed.host;
  return { ...signed, authorization: `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}` };
}

function storeUrl(store, key, query) {
  const endpoint = process.env.IMJIN_ASSET_ENDPOINT?.replace(/\/+$/, '');
  // S3 itself is addressed virtual-hosted; another endpoint (a test server) takes the bucket as the first path segment.
  const base = endpoint ? `${endpoint}/${encode(store.bucket)}` : `https://${store.bucket}.s3.${store.region}.amazonaws.com`;
  const search = Object.entries(query).map(([name, value]) => `${encode(name)}=${encode(String(value))}`).join('&');
  return `${base}/${key.split('/').map(encode).join('/')}${search ? `?${search}` : ''}`;
}

async function request(store, method, key, { query = {}, body, payloadHash = EMPTY_SHA, headers = {} } = {}) {
  const url = storeUrl(store, key, query);
  const credentials = awsCredentials();
  for (let attempt = 1; ; attempt++) {
    let response = null;
    try {
      const signed = signV4({ method, url, headers, payloadHash, credentials, region: store.region });
      response = await fetch(url, { method, body, headers: signed, signal: AbortSignal.timeout(300_000) });
    } catch (error) {
      if (attempt === ATTEMPTS) fail(`cannot reach ${new URL(url).host}: ${error.cause?.code ?? error.cause?.message ?? error.message}`);
    }
    if (response && (response.status < 500 || attempt === ATTEMPTS)) return response;
    // Server errors and dropped connections are retried after growing, jittered pauses, as S3 asks of its clients.
    await response?.body?.cancel();
    await new Promise((done) => setTimeout(done, 150 * 2 ** attempt * (0.5 + Math.random())));
  }
}

/** A failed answer from S3 as one clear line. */
async function storeError(response, store, what) {
  const code = /<Code>([^<]+)<\/Code>/.exec(await response.text().catch(() => ''))?.[1] ?? '';
  const bucket = `s3://${store.bucket}`;
  if (code === 'NoSuchBucket') return new Fail(`${bucket} does not exist in ${store.region}: node scripts/assets.mjs setup --apply creates it`);
  if (response.status === 403) return new Fail(`${bucket} refused ${what}${code ? ` (${code})` : ''}: check the AWS identity in use (aws sts get-caller-identity) and its access to the bucket`);
  if (response.status === 301 || code === 'PermanentRedirect' || code === 'AuthorizationHeaderMalformed') return new Fail(`${bucket} is not in ${store.region} (${code || response.status})`);
  if (response.status === 404) return new Fail(`${what} is not in ${bucket}${code ? ` (${code})` : ''}`);
  return new Fail(`${bucket} answered ${response.status}${code ? ` ${code}` : ''} to ${what}`);
}

/** A one-key listing first, so that a missing bucket or a refused identity reads as one line before any file is sent. */
async function checkStore(store) {
  const response = await request(store, 'GET', '', { query: { 'list-type': 2, 'max-keys': 1, prefix: store.prefix } });
  if (!response.ok) throw await storeError(response, store, 'a listing');
  await response.body?.cancel();
}

/** Every key under the store's prefix with its size (ListObjectsV2, a thousand to a page). */
async function listBlobs(store) {
  const held = new Map();
  let token = null;
  do {
    const query = { 'list-type': 2, prefix: store.prefix, ...(token && { 'continuation-token': token }) };
    const response = await request(store, 'GET', '', { query });
    if (!response.ok) throw await storeError(response, store, 'a listing');
    const xml = await response.text();
    for (const [, item] of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) held.set(/<Key>([^<]*)<\/Key>/.exec(item)?.[1], Number(/<Size>(\d+)<\/Size>/.exec(item)?.[1]));
    token = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? /<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(xml)?.[1] : null;
  } while (token);
  return held;
}

async function headBlob(store, hash) {
  const response = await request(store, 'HEAD', blobKey(store, hash));
  if (response.status === 404) return null;
  if (!response.ok) throw await storeError(response, store, `HEAD ${blobKey(store, hash)}`);
  return Number(response.headers.get('content-length'));
}

async function putBlob(store, hash, data, path) {
  // The key is the content's sha256, which is also the payload hash S3 checks the upload against.
  const response = await request(store, 'PUT', blobKey(store, hash), { body: data, payloadHash: hash, headers: { 'content-type': TYPES[extension(path)] } });
  if (!response.ok) throw await storeError(response, store, `the upload of ${path}`);
  await response.body?.cancel();
}

/** A version's bytes, checked against its sha256: the cache's copy when it is sound (a corrupt one is replaced), else S3's. */
async function blobBytes(store, version, path, from) {
  const cached = cachePath(version.sha256);
  const copy = await readFile(cached).catch(() => null);
  if (copy && sha256(copy) === version.sha256) {
    from.cache++;
    return copy;
  }
  if (copy) console.warn(`the cached copy of ${path} is corrupt; fetching it again (${cached})`);
  const response = await request(store, 'GET', blobKey(store, version.sha256));
  if (!response.ok) throw await storeError(response, store, `the blob of ${path} (${version.sha256})`);
  const data = Buffer.from(await response.arrayBuffer());
  if (sha256(data) !== version.sha256) fail(`s3://${store.bucket}/${blobKey(store, version.sha256)} does not match its sha256, so ${path} was not written`);
  await keep(version.sha256, data);
  from.store++;
  return data;
}

// ---- commands

async function status(args, flags) {
  const manifest = await readManifest();
  const { files, store } = manifest;
  const index = await openIndex();
  const paths = [...new Set([...(await scan()), ...Object.keys(files)])].sort();
  const here = new Map(await pool(paths, async (path) => [path, await localHash(index, path)]));
  await index.save();
  reportHashing();
  const added = paths.filter((path) => !files[path] && here.get(path));
  const changed = paths.filter((path) => files[path] && here.get(path) && here.get(path).sha256 !== files[path].sha256);
  const remote = await readRemote();
  const pruned = paths.filter((path) => files[path] && !here.get(path) && remote.has(path));
  const missing = paths.filter((path) => files[path] && !here.get(path) && !remote.has(path));
  const total = Object.values(files).reduce((sum, entry) => sum + entry.size, 0);
  console.log(`assets.json: ${Object.keys(files).length} files, ${size(total)}`);
  list('new, not in assets.json', added, (path) => size(here.get(path).size));
  list('changed here', changed, (path) => `${size(here.get(path).size)}, assets.json has ${size(files[path].size)}`);
  list('missing here', missing, (path) => size(files[path].size));
  if (pruned.length) console.log(`remote-only (prune-local): ${pruned.length} files, ${size(pruned.reduce((sum, path) => sum + files[path].size, 0))}; the dev server fetches them from S3`);
  if (added.length || changed.length) console.log('npm run assets -- push uploads the new and changed files and records them');
  if (missing.length) console.log('npm run assets -- pull brings the missing ones');
  if (!added.length && !changed.length && !missing.length) console.log('the tree matches assets.json');
  if (!flags.remote) return;
  const held = await listBlobs(store);
  const absent = Object.keys(files).sort().filter((path) => held.get(blobKey(store, files[path].sha256)) !== files[path].size);
  if (!absent.length) {
    console.log(`s3://${store.bucket} holds the blob of every file`);
    return;
  }
  list(`not in s3://${store.bucket} at the recorded size`, absent, (path) => files[path].sha256);
  process.exitCode = 1;
}

async function push(args, flags) {
  const dry = Boolean(flags['dry-run']);
  const manifest = await readManifest();
  const { files, store } = manifest;
  const index = await openIndex();
  const candidates = new Set([...(await scan()), ...Object.keys(files)]);
  // A file named outright is taken even where .gitignore keeps it local, so that a Meshy original can go into the vault.
  for (const arg of args) {
    const path = repoPath(arg);
    if (managed(path) && (await stat(join(ROOT, path)).then((st) => st.isFile(), () => false))) candidates.add(path);
  }
  const targets = pick(args, candidates, 'no binary file there (text files stay in git)');
  const named = new Set(args.map(repoPath));
  const here = new Map(await pool(targets, async (path) => [path, await localHash(index, path)]));
  await index.save();
  reportHashing();
  const added = targets.filter((path) => !files[path] && here.get(path));
  const changed = targets.filter((path) => files[path] && here.get(path) && here.get(path).sha256 !== files[path].sha256);
  // A file pruned to S3 is not gone: it is never dropped by being absent.
  const remote = await readRemote();
  const dropped = targets.filter((path) => files[path] && !here.get(path) && named.has(path) && !remote.has(path));
  const absent = targets.filter((path) => files[path] && !here.get(path) && !named.has(path) && !remote.has(path)).length;
  list('add', added, (path) => size(here.get(path).size));
  list('change', changed, (path) => `${size(here.get(path).size)}, was ${size(files[path].size)}`);
  list('drop (its blobs stay in the store, its record in the history of assets.json)', dropped, (path) => size(files[path].size));
  if (absent) console.log(`${absent} files in assets.json are not here and stay in it: pull brings them back, push <path> drops one`);
  if (!added.length && !changed.length && !dropped.length) {
    console.log(`nothing to push: assets.json matches the ${targets.length - absent} files here`);
    return;
  }
  const blobs = new Map([...added, ...changed].map((path) => [here.get(path).sha256, path]));
  let lacking = [];
  if (blobs.size) {
    await checkStore(store);
    const stored = await pool([...blobs], async ([hash, path]) => ((await headBlob(store, hash)) === here.get(path).size ? null : path));
    lacking = stored.filter(Boolean);
    const bytes = lacking.reduce((sum, path) => sum + here.get(path).size, 0);
    console.log(`${dry ? 'would upload' : 'uploading'} ${lacking.length} blobs (${size(bytes)}) to s3://${store.bucket}; ${blobs.size - lacking.length} are there already`);
  }
  if (dry) {
    console.log('dry run: nothing uploaded, assets.json unchanged');
    return;
  }
  await pool(lacking, async (path) => {
    const hash = here.get(path).sha256;
    const data = await readFile(join(ROOT, path));
    if (sha256(data) !== hash) fail(`${path} changed while it was being pushed: push again`);
    await putBlob(store, hash, data, path);
    if (!(await exists(cachePath(hash)))) await keep(hash, data);
  });
  const until = now();
  for (const path of added) files[path] = { ...here.get(path) };
  for (const path of changed) {
    const old = files[path];
    files[path] = { ...here.get(path), history: [...(old.history ?? []), { sha256: old.sha256, size: old.size, until }] };
  }
  for (const path of dropped) delete files[path];
  await writeManifest(manifest);
  console.log(`assets.json: ${added.length} added, ${changed.length} changed, ${dropped.length} dropped; commit it`);
}

async function pull(args, flags) {
  const manifest = await readManifest();
  const { files, store } = manifest;
  const targets = pick(args, Object.keys(files), 'not in assets.json');
  if (!targets.length) {
    console.log('assets.json names no files: nothing to pull');
    return;
  }
  const index = await openIndex();
  const here = new Map(await pool(targets, async (path) => [path, await localHash(index, path)]));
  reportHashing();
  const recorded = recordedHashes(manifest);
  const remote = await readRemote();
  const all = Boolean(flags.all);
  const wanted = [];
  const kept = [];
  let skipped = 0;
  for (const path of targets) {
    const local = here.get(path);
    if (local?.sha256 === files[path].sha256) continue;
    // A file pruned to S3 stays there; the dev server fetches it on demand.
    if (!local && remote.has(path) && !all) {
      skipped++;
      continue;
    }
    // What the store or the cache can give back may be replaced; anything else is work nobody has pushed yet.
    if (local && (await unpushed(recorded, local.sha256))) kept.push(path);
    else wanted.push(path);
  }
  list('kept: changed here and not in assets.json (push them, or delete them and pull again)', kept, (path) => size(here.get(path).size));
  if (skipped) console.log(`${skipped} files stay remote-only (prune-local): the dev server fetches them from S3; pull --all brings them here`);
  const clearRemote = async () => {
    if (!all || flags['dry-run'] || !remote.size) return;
    for (const path of targets) remote.delete(path);
    await writeRemote(remote);
  };
  if (!wanted.length) {
    await clearRemote();
    await index.save();
    console.log(`up to date: ${targets.length - kept.length} files match assets.json`);
    return;
  }
  if (flags['dry-run']) {
    const source = new Map(await pool(wanted, async (path) => [path, (await exists(cachePath(files[path].sha256))) ? 'the cache' : 'S3']));
    list('would fetch', wanted, (path) => `${size(files[path].size)} from ${source.get(path)}`);
    await index.save();
    return;
  }
  const from = { cache: 0, store: 0 };
  try {
    await pool(wanted, async (path) => {
      const data = await blobBytes(store, files[path], path, from);
      await writeAtomic(join(ROOT, path), data);
      index.set(path, await stat(join(ROOT, path)), files[path].sha256);
    });
  } finally {
    await index.save();
  }
  await clearRemote();
  const bytes = wanted.reduce((sum, path) => sum + files[path].size, 0);
  console.log(`pulled ${wanted.length} files (${size(bytes)}): ${from.cache} from the cache, ${from.store} from s3://${store.bucket}`);
}

async function verify() {
  const { files, store } = await readManifest();
  const held = await listBlobs(store);
  const problems = [];
  const blobs = new Set();
  for (const path of Object.keys(files).sort()) {
    for (const version of versionsOf(files[path])) {
      blobs.add(version.sha256);
      const stored = held.get(blobKey(store, version.sha256));
      if (stored === version.size) continue;
      const when = version.until ? `in use until ${version.until}` : 'current';
      problems.push(`  ${path}  ${when}  ${version.sha256}  ${stored === undefined ? 'missing' : `${stored} bytes, not ${version.size}`}`);
    }
  }
  if (problems.length) {
    console.log(`s3://${store.bucket} lacks ${problems.length} versions that assets.json names:\n${problems.join('\n')}`);
    process.exitCode = 1;
    return;
  }
  console.log(`s3://${store.bucket} holds all ${blobs.size} blobs of the ${Object.keys(files).length} files in assets.json, history included`);
}

async function restore(args, flags) {
  if (args.length !== 1) fail('restore takes one path');
  if (flags.previous && flags.sha) fail('restore takes --previous or --sha, not both');
  const manifest = await readManifest();
  const path = repoPath(args[0]);
  const entry = manifest.files[path] ?? fail(`${path} is not in assets.json`);
  const history = entry.history ?? [];
  let target;
  if (flags.sha) {
    if (!/^[0-9a-f]+$/i.test(flags.sha)) fail('--sha takes a hex prefix of a version\'s sha256');
    const prefix = flags.sha.toLowerCase();
    const matches = new Map(versionsOf(entry).filter((v) => v.sha256.startsWith(prefix)).map((v) => [v.sha256, v]));
    if (matches.size !== 1) fail(matches.size ? `--sha=${prefix} fits ${matches.size} versions of ${path}: give more of it` : `${path} has no version ${prefix}`);
    target = [...matches.values()][0];
  } else {
    target = history.at(-1) ?? fail(`${path} has no earlier version`);
  }
  if (target.sha256 === entry.sha256) {
    console.log(`${path} is that version already`);
    return;
  }
  const index = await openIndex();
  const local = await localHash(index, path);
  if (local && local.sha256 !== entry.sha256 && (await unpushed(recordedHashes(manifest), local.sha256))) {
    fail(`${path} has changes that are not in assets.json: push them, or delete the file, first`);
  }
  const data = await blobBytes(manifest.store, target, path, { cache: 0, store: 0 });
  await writeAtomic(join(ROOT, path), data);
  index.set(path, await stat(join(ROOT, path)), target.sha256);
  await index.save();
  manifest.files[path] = { sha256: target.sha256, size: target.size, history: [...history, { sha256: entry.sha256, size: entry.size, until: now() }] };
  await writeManifest(manifest);
  const used = target.until ? `, in use until ${target.until}` : '';
  console.log(`restored ${path} to ${target.sha256.slice(0, 12)} (${size(target.size)}${used}); the version it replaced is in its history. Commit assets.json`);
}

/** Triangles of a binary glTF, read from its JSON chunk alone: index counts, or vertex counts where there are no indices. */
async function triangles(file) {
  let handle;
  try {
    handle = await open(file);
    const head = Buffer.alloc(20);
    await handle.read(head, 0, 20, 0);
    if (head.toString('latin1', 0, 4) !== 'glTF' || head.readUInt32LE(16) !== 0x4e4f534a) return null;
    const chunk = Buffer.alloc(head.readUInt32LE(12));
    await handle.read(chunk, 0, chunk.length, 20);
    const gltf = JSON.parse(chunk.toString('utf8'));
    let count = 0;
    for (const mesh of gltf.meshes ?? []) {
      for (const primitive of mesh.primitives ?? []) {
        const n = gltf.accessors?.[primitive.indices ?? primitive.attributes?.POSITION]?.count ?? 0;
        const mode = primitive.mode ?? 4;
        // Lists take three corners a triangle; strips and fans one more corner each after the first two.
        if (mode === 4) count += n / 3;
        else if (mode === 5 || mode === 6) count += Math.max(0, n - 2);
      }
    }
    return Math.round(count);
  } catch {
    return null;
  } finally {
    await handle?.close();
  }
}

async function readRecords() {
  const packs = await readdir(join(ROOT, 'assets-src'), { withFileTypes: true }).catch(() => []);
  const records = [];
  for (const pack of packs.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()) {
    for (const name of RECORDS) {
      const path = `assets-src/${pack}/${name}`;
      const text = await readFile(join(ROOT, path), 'utf8').catch(() => null);
      // A record that is not valid JSON is still searched as text.
      if (text !== null) records.push({ path, text, json: name.endsWith('.json') ? parseJson(text) : null });
    }
  }
  return records;
}

/** Whether a record names a model: by one of its hashes, or by its file name with whatever path comes before it fitting. */
function mentions({ text }, path, hashes) {
  if (hashes.some((hash) => text.includes(hash))) return true;
  const name = path.slice(path.lastIndexOf('/') + 1);
  for (let at = text.indexOf(name); at >= 0; at = text.indexOf(name, at + 1)) {
    // Not the end of a longer name (ship.glb in ship.glb-old), and whatever path leads to it must be this file's.
    if (/[\w-]/.test(text[at + name.length] ?? '')) continue;
    let start = at;
    while (start > 0 && /[\w./-]/.test(text[start - 1])) start--;
    const tail = text.slice(start, at + name.length).replace(/^(\.{0,2}\/)+/, '');
    if (path === tail || path.endsWith(`/${tail}`)) return true;
  }
  return false;
}

/** The tool, model and credits fields of a record, at its top or up to two levels down (meshy.apiModel, outcome.spent.meshyCredits). */
function fields(record) {
  const found = {};
  const walk = (node, prefix, depth) => {
    for (const [key, value] of Object.entries(node)) {
      if (value && typeof value === 'object') {
        if (!Array.isArray(value) && depth < 2) walk(value, `${prefix}${key}.`, depth + 1);
      } else if ((TOOL_FIELD.test(key) && typeof value === 'string') || (/credits/i.test(key) && typeof value === 'number')) {
        found[`${prefix}${key}`] = value;
      }
    }
  };
  if (record && typeof record === 'object' && !Array.isArray(record)) walk(record, '', 0);
  return found;
}

async function models(args, flags) {
  const manifest = await readManifest();
  const { files } = manifest;
  const index = await openIndex();
  const paths = [...new Set([...Object.keys(files), ...(await scan())])].filter((path) => extension(path) === 'glb').sort();
  const records = await readRecords();
  const rows = await pool(paths, async (path) => {
    const entry = files[path];
    const local = await localHash(index, path);
    const current = entry ?? local;
    const versions = entry ? versionsOf(entry) : [];
    // The triangles are counted on the version assets.json names: the tree's copy when it is that one, else the cache's.
    const file = local?.sha256 === current.sha256 ? join(ROOT, path) : (await exists(cachePath(current.sha256))) ? cachePath(current.sha256) : null;
    const hashes = [...new Set([current.sha256, ...versions.map((v) => v.sha256)])];
    return {
      path,
      sha256: current.sha256,
      size: current.size,
      triangles: file && (await triangles(file)),
      inAssetsJson: Boolean(entry),
      versions,
      provenance: records.filter((record) => mentions(record, path, hashes)).map((record) => ({ record: record.path, ...(record.json && { fields: fields(record.json) }) })),
    };
  });
  await index.save();
  if (flags.json) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }
  const short = (value) => (typeof value === 'string' && value.length > 48 ? `${value.slice(0, 45)}...` : value);
  for (const row of rows) {
    const count = new Set(row.versions.map((v) => v.sha256)).size;
    const tris = row.triangles === null ? 'triangles unknown (pull it)' : `${row.triangles.toLocaleString('en-US')} triangles`;
    console.log(`${row.path}  ${size(row.size)}  ${tris}  ${row.inAssetsJson ? `${count} version${count === 1 ? '' : 's'}` : 'not in assets.json yet'}`);
    for (const { record, fields: found } of row.provenance) {
      const detail = Object.entries(found ?? {}).map(([key, value]) => `${key} ${short(value)}`);
      console.log(`    ${record}${detail.length ? `: ${detail.join(', ')}` : ''}`);
    }
    if (!row.provenance.length) console.log('    no provenance record');
  }
  const total = rows.reduce((sum, row) => sum + row.size, 0);
  const versions = rows.reduce((sum, row) => sum + new Set(row.versions.map((v) => v.sha256)).size, 0);
  console.log(`${rows.length} models, ${size(total)}, ${versions} versions in assets.json; ${rows.filter((row) => row.provenance.length).length} with a provenance record`);
}

// Shell quoting for the printed commands, so that they can be pasted into bash or zsh as they are.
const quote = (arg) => (/^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", "'\\''")}'`);

async function setup(args, flags) {
  const { bucket, region } = (await readManifest()).store;
  const policy = {
    Version: '2012-10-17',
    Statement: [
      { Effect: 'Allow', Action: 's3:GetObject', Resource: `arn:aws:s3:::${bucket}/*` },
      { Effect: 'Allow', Action: 's3:ListBucket', Resource: `arn:aws:s3:::${bucket}` },
    ],
  };
  const encryption = { Rules: [{ ApplyServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } }] };
  const steps = [
    ['the private bucket; the account owns every object in it', ['s3api', 'create-bucket', '--bucket', bucket, '--region', region, '--create-bucket-configuration', `LocationConstraint=${region}`, '--object-ownership', 'BucketOwnerEnforced']],
    ['no public access of any kind', ['s3api', 'put-public-access-block', '--bucket', bucket, '--region', region, '--public-access-block-configuration', 'BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true']],
    ['SSE-S3 encryption by default', ['s3api', 'put-bucket-encryption', '--bucket', bucket, '--region', region, '--server-side-encryption-configuration', JSON.stringify(encryption)]],
    ['read access for the deploy role, which pulls in CI (pushing takes your own credentials)', ['iam', 'put-role-policy', '--role-name', DEPLOY_ROLE, '--policy-name', 'assets-read', '--policy-document', JSON.stringify(policy)]],
  ];
  for (const [what, command] of steps) {
    console.log(`# ${what}\naws ${command.map(quote).join(' ')}`);
    if (!flags.apply) continue;
    const run = spawnSync('aws', command, { encoding: 'utf8' });
    if (run.status === 0) continue;
    if (/BucketAlreadyOwnedByYou/.test(run.stderr)) {
      console.log('# the bucket exists in this account already');
      continue;
    }
    fail(`aws ${command[0]} ${command[1]} failed: ${run.error?.message ?? run.stderr.trim()}`);
  }
  if (!flags.apply) console.log('# node scripts/assets.mjs setup --apply runs these as the current AWS identity');
}

/** Runs git in the tree and returns what it printed; a failure is fatal. */
function git(args, input) {
  const run = spawnSync('git', args, { cwd: ROOT, input, encoding: 'utf8', maxBuffer: 1 << 28 });
  if (run.error || run.status !== 0) fail(`git ${args.find((arg) => !arg.startsWith('-'))} failed: ${run.error?.message ?? run.stderr.trim()}`);
  return run.stdout;
}

const ignoreBlock = () =>
  [
    `${IGNORE_HEAD} (assets.json, scripts/assets.mjs): npm run assets -- pull after a checkout.`,
    '# Keep this block first: git lets the last matching rule decide, so the rules below that keep local scratch out of',
    '# git keep it out of the store as well.',
    ...IGNORE_PATTERNS,
    '',
  ].join('\n');

async function untrack(args, flags) {
  const tracked = git(['ls-files', '-z', '--', ...ROOTS]).split('\0').filter((path) => path && managed(path)).sort();
  const sizes = await Promise.all(tracked.map((path) => stat(join(ROOT, path)).then((st) => st.size, () => 0)));
  for (const path of tracked) console.log(`  ${path}`);
  console.log(`${tracked.length} binary files (${size(sizes.reduce((sum, n) => sum + n, 0))}) under ${ROOTS.join(' and ')} are tracked by git.`);
  console.log(`The cut-over untracks them (they stay on disk) and puts this block at the top of .gitignore:\n${ignoreBlock()}`);
  if (!flags.apply) {
    console.log('node scripts/assets.mjs untrack --apply does it once assets.json and the bucket hold every one of them');
    return;
  }
  const manifest = await readManifest();
  const { files, store } = manifest;
  // Every file is hashed afresh rather than taken from the index: nothing may leave git that the store does not hold.
  const fresh = { get: () => null, set: () => {} };
  const local = await pool(tracked, (path) => localHash(fresh, path));
  const unrecorded = tracked.filter((path, i) => !local[i] || local[i].sha256 !== files[path]?.sha256);
  if (unrecorded.length) fail(`${unrecorded.length} of them differ from assets.json (${unrecorded[0]} first): npm run assets -- push, then try again`);
  const held = await listBlobs(store);
  const unstored = tracked.filter((path) => held.get(blobKey(store, files[path].sha256)) !== files[path].size);
  if (unstored.length) fail(`s3://${store.bucket} lacks ${unstored.length} of their blobs (${unstored[0]} first): npm run assets -- push`);
  if (tracked.length) git(['--literal-pathspecs', 'rm', '--cached', '--quiet', '--pathspec-from-file=-', '--pathspec-file-nul'], tracked.join('\0'));
  const gitignore = await readFile(join(ROOT, '.gitignore'), 'utf8').catch(() => '');
  if (!gitignore.includes(IGNORE_HEAD)) await writeFile(join(ROOT, '.gitignore'), `${ignoreBlock()}\n${gitignore}`);
  git(['add', '--', '.gitignore', 'assets.json']);
  console.log(`untracked ${tracked.length} files; the removals, .gitignore and assets.json are staged for one commit. From then on every checkout needs npm run assets -- pull`);
}

// ---- the cold archive
// Generation sources (concepts, raw/rig/anim GLBs, rejected candidates) are kept off the local disk and out of
// assets.json, which CI pulls whole: `archive` uploads them under archive/sha256/ in the same bucket, records them in
// the committed assets-archive.json and deletes each local copy once the bucket holds it at its size. Nothing pulls
// the archive except archive-pull, on demand.
const ARCHIVE_MANIFEST = join(ROOT, 'assets-archive.json');
const ARCHIVE_SCHEMA = 'imjin.assets-archive.v1';
const ARCHIVE_STORE = { ...STORE, prefix: 'archive/sha256/' };
const ARCHIVE_EXTRA = { blend: 'application/octet-stream', blend1: 'application/octet-stream', fbx: 'application/octet-stream', psd: 'image/vnd.adobe.photoshop', tif: 'image/tiff', tiff: 'image/tiff' };
const archiveType = (path) => TYPES[extension(path)] ?? ARCHIVE_EXTRA[extension(path)];

async function readArchive() {
  const text = await readFile(ARCHIVE_MANIFEST, 'utf8').catch((error) => (error.code === 'ENOENT' ? null : Promise.reject(error)));
  if (text === null) return { schema: ARCHIVE_SCHEMA, store: { ...ARCHIVE_STORE }, files: {} };
  const manifest = parseJson(text);
  if (manifest?.schema !== ARCHIVE_SCHEMA) fail(`${ARCHIVE_MANIFEST} is not an ${ARCHIVE_SCHEMA} manifest`);
  return manifest;
}

async function writeArchive(manifest) {
  const lines = Object.keys(manifest.files).sort().map((path) => `    ${JSON.stringify(path)}: ${JSON.stringify(manifest.files[path])}`);
  await writeAtomic(ARCHIVE_MANIFEST, `{\n  "schema": ${JSON.stringify(manifest.schema)},\n  "store": ${JSON.stringify(manifest.store)},\n  "files": {\n${lines.join(',\n')}\n  }\n}\n`);
}

/** Every archivable file a command-line path names: the file itself, or each one under a directory. */
async function archivable(arg) {
  const path = repoPath(arg);
  const full = join(ROOT, path);
  const info = await stat(full).catch(() => null);
  if (!info) fail(`${arg}: no such file or directory`);
  if (info.isFile()) return archiveType(path) ? [path] : [];
  const found = [];
  for (const entry of await readdir(full, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const child = relative(ROOT, join(entry.parentPath, entry.name)).split(sep).join('/');
    if (archiveType(child)) found.push(child);
  }
  return found;
}

async function archive(args, flags) {
  if (flags.from) args = [...args, ...(await readFile(resolve(flags.from), 'utf8')).split(/\r?\n/).map((line) => line.trim()).filter(Boolean)];
  if (!args.length) fail('archive needs paths (or --from=<list file>)');
  const live = new Set(Object.keys((await readManifest()).files));
  const paths = [...new Set((await Promise.all(args.map(archivable))).flat())].sort();
  const skipped = paths.filter((path) => live.has(path));
  if (skipped.length) console.log(`kept ${skipped.length} file(s) that assets.json manages (the archive is for sources, not shipped assets)`);
  const todo = paths.filter((path) => !live.has(path));
  const manifest = await readArchive();
  let bytes = 0;
  if (flags['dry-run']) {
    for (const path of todo) bytes += (await stat(join(ROOT, path))).size;
    console.log(`would archive ${todo.length} file(s), ${size(bytes)}`);
    return;
  }
  let done = 0;
  let writing = Promise.resolve();
  await pool(todo, async (path) => {
    const full = join(ROOT, path);
    const data = await readFile(full);
    const hash = sha256(data);
    if ((await headBlob(ARCHIVE_STORE, hash)) !== data.length) {
      // S3 checks the body against the signed sha256, so a stored blob is the file's exact bytes.
      const response = await request(ARCHIVE_STORE, 'PUT', blobKey(ARCHIVE_STORE, hash), { body: data, payloadHash: hash, headers: { 'content-type': archiveType(path) } });
      if (!response.ok) throw await storeError(response, ARCHIVE_STORE, `the upload of ${path}`);
      await response.body?.cancel();
    }
    if ((await headBlob(ARCHIVE_STORE, hash)) !== data.length) fail(`s3://${ARCHIVE_STORE.bucket}/${blobKey(ARCHIVE_STORE, hash)} is missing or the wrong size after upload; ${path} was kept`);
    const previous = manifest.files[path];
    const history = previous && previous.sha256 !== hash ? [{ sha256: previous.sha256, size: previous.size, uploadedAt: previous.uploadedAt }, ...(previous.history ?? [])] : previous?.history;
    manifest.files[path] = { sha256: hash, size: data.length, uploadedAt: now(), ...(history ? { history } : {}) };
    // The record is on disk before the local copy goes, so a crash never loses a file's only trace.
    writing = writing.then(() => writeArchive(manifest));
    await writing;
    await rm(full);
    bytes += data.length;
    if (++done % 50 === 0) console.log(`  ${done}/${todo.length}`);
  });
  await writeArchive(manifest);
  console.log(`archived ${done} file(s), ${size(bytes)} freed; recorded in assets-archive.json (commit it)`);
}

/** A path or glob (* within a segment, ** across them) as a regex; a directory also matches everything under it. */
function globRegex(glob) {
  const body = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*\/?/g, '\0').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]').replace(/\0/g, '.*');
  return new RegExp(`^${body}(/.*)?$`);
}

async function archivePull(args, flags) {
  if (!args.length) fail('archive-pull needs a path or glob, e.g. "assets-src/generals-cast-2026-10-17/**/*.png"');
  const manifest = await readArchive();
  const patterns = args.map((arg) => globRegex(arg.replace(/\\/g, '/').replace(/^\.\//, '')));
  const paths = Object.keys(manifest.files).filter((path) => patterns.some((re) => re.test(path)));
  if (!paths.length) fail(`nothing in assets-archive.json matches ${args.join(' ')}`);
  let fetched = 0;
  await pool(paths, async (path) => {
    const entry = manifest.files[path];
    const full = join(ROOT, path);
    if (!flags.force && (await readFile(full).then((data) => sha256(data) === entry.sha256, () => false))) return;
    if (flags['dry-run']) return void console.log(`  ${path}  ${size(entry.size)}`);
    const response = await request(manifest.store, 'GET', blobKey(manifest.store, entry.sha256));
    if (!response.ok) throw await storeError(response, manifest.store, `the archived ${path}`);
    const data = Buffer.from(await response.arrayBuffer());
    if (sha256(data) !== entry.sha256) fail(`the archived blob of ${path} does not match its sha256`);
    await writeAtomic(full, data);
    fetched++;
  });
  console.log(flags['dry-run'] ? `${paths.length} file(s) match` : `restored ${fetched} of ${paths.length} matching file(s)`);
}

async function archiveStatus(args, flags) {
  const manifest = await readArchive();
  const entries = Object.entries(manifest.files);
  const groups = new Map();
  let local = 0;
  for (const [path, entry] of entries) {
    const dir = path.split('/').slice(0, 2).join('/');
    const group = groups.get(dir) ?? { count: 0, bytes: 0 };
    group.count++;
    group.bytes += entry.size;
    groups.set(dir, group);
    if (await exists(join(ROOT, path))) local++;
  }
  for (const [dir, { count, bytes }] of [...groups].sort()) console.log(`  ${dir}  ${count} file(s)  ${size(bytes)}`);
  console.log(`${entries.length} archived file(s), ${size(entries.reduce((sum, [, entry]) => sum + entry.size, 0))}; ${local} also on disk`);
  if (flags.remote) {
    const missing = (await pool(entries, async ([path, entry]) => ((await headBlob(manifest.store, entry.sha256)) === entry.size ? null : path))).filter(Boolean);
    console.log(missing.length ? `missing from the bucket (${missing.length}):\n  ${missing.join('\n  ')}` : 'the bucket holds every archived blob at its size');
    if (missing.length) process.exitCode = 1;
  }
}

// ---- runtime files kept only in S3

async function pruneLocal(args, flags) {
  const dry = Boolean(flags['dry-run']);
  const { files, store } = await readManifest();
  const minSize = flags['min-size'] === undefined ? 0 : parseSizeFlag(flags['min-size']);
  // Generation sources go to the cold archive instead; only runtime files are served back by the dev server.
  // The server and the Node tests read public/terrain straight from disk, so it never goes remote-only.
  const runtime = Object.keys(files).filter((path) => path.startsWith('public/') && !path.startsWith('public/terrain/'));
  const targets = pick(args.length ? args : ['public/models'], runtime, 'no runtime file of assets.json there (only public/ is pruned)');
  const index = await openIndex();
  const here = new Map(await pool(targets, async (path) => [path, await localHash(index, path)]));
  await index.save();
  reportHashing();
  const differ = targets.filter((path) => here.get(path) && here.get(path).sha256 !== files[path].sha256);
  if (differ.length) fail(`${differ.length} of them differ from assets.json (${differ[0]} first): npm run assets -- push, then try again`);
  // A file git still tracks (a branch from before the cut-over) would read as deleted in git: it stays.
  const listed = spawnSync('git', ['ls-files', '-z', '--', ...new Set(targets.map((path) => path.split('/').slice(0, 2).join('/')))], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 });
  const tracked = new Set(listed.status === 0 ? listed.stdout.split('\0').filter(Boolean) : []);
  const chosen = targets.filter((path) => here.get(path) && files[path].size >= minSize && !tracked.has(path));
  const inGit = targets.filter((path) => here.get(path) && tracked.has(path)).length;
  if (inGit) console.log(`${inGit} of them stay: git tracks them on this branch (npm run assets -- untrack takes them out of git)`);
  if (!chosen.length) {
    console.log('nothing to prune: no local copy there that assets.json names');
    return;
  }
  await checkStore(store);
  const held = await pool(chosen, async (path) => ((await headBlob(store, files[path].sha256)) === files[path].size ? null : path));
  const lacking = held.filter(Boolean);
  if (lacking.length) fail(`s3://${store.bucket} lacks ${lacking.length} of them at their size (${lacking[0]} first): nothing deleted`);
  const bytes = chosen.reduce((sum, path) => sum + files[path].size, 0);
  if (chosen.length <= 40) list(dry ? 'would delete (the bucket holds each)' : 'deleting (the bucket holds each)', chosen, (path) => size(files[path].size));
  if (dry) {
    console.log(`dry run: ${chosen.length} files, ${size(bytes)} would be freed here`);
    return;
  }
  const remote = await readRemote();
  for (const path of chosen) remote.add(path);
  // The record goes first: an interrupted run leaves a file both here and listed, which pull and the dev server handle.
  await writeRemote(remote);
  await pool(chosen, (path) => rm(join(ROOT, path), { force: true }));
  const cache = await evictCache();
  console.log(`pruned ${chosen.length} files (${size(bytes)}) to s3://${store.bucket}; ${remote.size} files are remote-only here (.assets-remote.json)`);
  console.log(`the shared cache holds ${size(cache.after)} (cap ${size(CACHE_CAP)}${cache.freed ? `, ${size(cache.freed)} evicted` : ''})`);
}

/** A size such as 2G, 500M or 1048576 in bytes; null when it reads as none. */
function parseSize(text) {
  const m = /^\s*(\d+(?:\.\d+)?)\s*([KMGT]?)i?B?\s*$/i.exec(String(text ?? ''));
  return m ? Math.round(Number(m[1]) * 1024 ** ' KMGT'.indexOf((m[2] || ' ').toUpperCase())) : null;
}

function parseSizeFlag(text) {
  return parseSize(text) ?? fail(`--min-size=${text}: a number of bytes, or with K, M or G`);
}

/** The shared cache's cap (IMJIN_ASSET_CACHE_MAX, default 2G): the dev server and prune-local keep it under it. */
const CACHE_CAP = parseSize(process.env.IMJIN_ASSET_CACHE_MAX) ?? 2 * 1024 ** 3;

/** Deletes the least recently used blobs until the cache holds at most `cap` bytes (a hit stamps a blob's mtime). */
async function evictCache(cap = CACHE_CAP) {
  const found = [];
  for (const top of ['sha256', 'named']) {
    for (const dir of await readdir(join(CACHE, top)).catch(() => [])) {
      for (const name of await readdir(join(CACHE, top, dir)).catch(() => [])) {
        if (name.endsWith('.assets-tmp')) continue;
        const path = join(CACHE, top, dir, name);
        const st = await stat(path).catch(() => null);
        if (st?.isFile()) found.push({ path, size: st.size, used: st.mtimeMs });
      }
    }
  }
  const before = found.reduce((sum, f) => sum + f.size, 0);
  let total = before;
  found.sort((a, b) => a.used - b.used);
  for (const f of found) {
    if (total <= cap) break;
    await rm(f.path, { force: true });
    total -= f.size;
  }
  return { before, after: total, freed: before - total };
}

const COMMANDS = { status, push, pull, verify, restore, models, setup, untrack, archive, 'archive-pull': archivePull, 'archive-status': archiveStatus, 'prune-local': pruneLocal };
const FLAGS = { status: ['remote'], push: ['dry-run'], pull: ['dry-run', 'all'], verify: [], restore: ['previous', 'sha'], models: ['json'], setup: ['apply'], untrack: ['apply'], archive: ['dry-run', 'from'], 'archive-pull': ['dry-run', 'force'], 'archive-status': ['remote'], 'prune-local': ['dry-run', 'min-size'] };
const TAKES_PATHS = ['push', 'pull', 'restore', 'archive', 'archive-pull', 'prune-local'];

async function main(argv) {
  const [command, ...args] = argv.filter((arg) => !arg.startsWith('--'));
  const flags = Object.fromEntries(
    argv
      .filter((arg) => arg.startsWith('--'))
      .map((arg) => {
        const [key, ...value] = arg.slice(2).split('=');
        return [key, value.length ? value.join('=') : true];
      }),
  );
  if (!Object.hasOwn(COMMANDS, command ?? '')) {
    console.log(USAGE);
    if (command && command !== 'help') process.exitCode = 1;
    return;
  }
  for (const key of Object.keys(flags)) if (!FLAGS[command].includes(key)) fail(`${command} takes no --${key}`);
  if (args.length && !TAKES_PATHS.includes(command)) fail(`${command} takes no paths`);
  await COMMANDS[command](args, flags);
}

// The test imports signV4 from here; run as a script, this is the command line.
if (import.meta.main) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    if (!(error instanceof Fail)) throw error;
    console.error(`assets: ${error.message}`);
    process.exitCode = 1;
  }
}

// scripts/lib/remote-assets.mjs (the dev server's S3 middleware and the tests' runtimePath) shares the store code.
export { CACHE, CACHE_CAP, STORE, TYPES, Fail, blobKey, cachePath, evictCache, extension, parseSize, readManifest, request, resetCredentials, sha256, storeError, writeAtomic };
