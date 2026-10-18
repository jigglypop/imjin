// The asset store (scripts/assets.mjs) against an in-memory S3 on 127.0.0.1: push, a second push that changes nothing,
// pulls into empty trees from S3 and from the shared cache, a change going into the history, restore, verify, a corrupt
// cache copy and a damaged download being refused, local work kept, the no-op pull, the model vault, a missing bucket,
// the git cut-over, and the request signing against the examples in the AWS documentation. Everything happens in
// temporary trees that carry a copy of the script, never in the real public/ or the real bucket.
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { signV4 } from './assets.mjs';

const SCRIPT = fileURLToPath(new URL('./assets.mjs', import.meta.url));
const BUCKET = 'imjin1592-assets';
let failures = 0;
const check = async (name, fn) => {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${name}`, error);
  }
};

const sha = (data) => createHash('sha256').update(data).digest('hex');
const key = (data) => `sha256/${sha(data).slice(0, 2)}/${sha(data)}`;

/** Path-style HEAD, GET, PUT and ListObjectsV2 in memory. Signatures are not checked, only that every request has one. */
async function fakeS3() {
  const s3 = { objects: new Map(), seen: { HEAD: 0, GET: 0, PUT: 0, LIST: 0 }, failNext: 0 };
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    const url = new URL(req.url, 'http://fake');
    const [bucket, ...parts] = url.pathname.slice(1).split('/');
    const name = parts.map(decodeURIComponent).join('/');
    const error = (status, code) => {
      res.writeHead(status, { 'content-type': 'application/xml' });
      res.end(req.method === 'HEAD' ? undefined : `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code></Error>`);
    };
    if (!/^AWS4-HMAC-SHA256 Credential=\S+\/\d{8}\/[\w-]+\/s3\/aws4_request, SignedHeaders=[\w;-]+, Signature=[0-9a-f]{64}$/.test(req.headers.authorization ?? '')) return error(403, 'AccessDenied');
    if (s3.failNext > 0) {
      s3.failNext -= 1;
      return error(503, 'SlowDown');
    }
    if (bucket !== BUCKET) return error(404, 'NoSuchBucket');
    if (!name && req.method === 'GET') {
      s3.seen.LIST += 1;
      const prefix = url.searchParams.get('prefix') ?? '';
      // Three keys to a page, and tokens with + / = in them as S3's have, so that paging and encoding are exercised.
      const page = Math.min(Number(url.searchParams.get('max-keys') ?? 1000), 3);
      const token = url.searchParams.get('continuation-token');
      if (token !== null && !token.endsWith('+/=')) return error(400, 'InvalidArgument');
      const after = token === null ? '' : Buffer.from(token.slice(0, -3), 'base64').toString();
      const keys = [...s3.objects.keys()].filter((k) => k.startsWith(prefix) && k > after).sort();
      const shown = keys.slice(0, page);
      const truncated = keys.length > page;
      const next = truncated ? `<NextContinuationToken>${Buffer.from(shown.at(-1)).toString('base64')}+/=</NextContinuationToken>` : '';
      const contents = shown.map((k) => `<Contents><Key>${k}</Key><Size>${s3.objects.get(k).data.length}</Size></Contents>`).join('');
      res.writeHead(200, { 'content-type': 'application/xml' });
      return res.end(`<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><Name>${BUCKET}</Name><IsTruncated>${truncated}</IsTruncated>${next}${contents}</ListBucketResult>`);
    }
    if (req.method === 'PUT') {
      s3.seen.PUT += 1;
      if (req.headers['x-amz-content-sha256'] !== sha(body)) return error(400, 'XAmzContentSHA256Mismatch');
      s3.objects.set(name, { data: body, type: req.headers['content-type'] });
      res.writeHead(200);
      return res.end();
    }
    if (req.method !== 'HEAD' && req.method !== 'GET') return error(405, 'MethodNotAllowed');
    s3.seen[req.method] += 1;
    const object = s3.objects.get(name);
    if (!object) return error(404, 'NoSuchKey');
    res.writeHead(200, { 'content-length': object.data.length, 'content-type': object.type });
    res.end(req.method === 'GET' ? object.data : undefined);
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  return Object.assign(s3, { server, port: server.address().port, requests: () => Object.values(s3.seen).reduce((a, b) => a + b, 0) });
}

/** A binary glTF with only its JSON chunk: one primitive drawing `indices` indices, a third of them triangles. */
function glb(indices) {
  const json = Buffer.from(JSON.stringify({ asset: { version: '2.0' }, meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }], accessors: [{ count: 8, componentType: 5126, type: 'VEC3' }, { count: indices, componentType: 5123, type: 'SCALAR' }] }));
  const chunk = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
  const head = Buffer.alloc(20);
  head.write('glTF', 0, 'latin1');
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(20 + chunk.length, 8);
  head.writeUInt32LE(chunk.length, 12);
  head.writeUInt32LE(0x4e4f534a, 16);
  return Buffer.concat([head, chunk]);
}

const s3 = await fakeS3();
const tmp = await mkdtemp(join(tmpdir(), 'imjin-assets-'));
const ENV = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^(AWS_|IMJIN_ASSET_)/i.test(name)));
Object.assign(ENV, { AWS_ACCESS_KEY_ID: 'AKIDTEST', AWS_SECRET_ACCESS_KEY: 'test-secret', IMJIN_ASSET_ENDPOINT: `http://127.0.0.1:${s3.port}`, IMJIN_ASSET_CACHE: join(tmp, 'cache') });

/** Runs the copy of the script in `tree`; the in-memory S3 has to keep answering meanwhile, so this never blocks. */
function run(tree, args, env = {}) {
  const started = performance.now();
  return new Promise((done) => {
    execFile(process.execPath, [join(tree, 'scripts', 'assets.mjs'), ...args], { cwd: tree, env: { ...ENV, ...env } }, (error, stdout, stderr) => {
      done({ code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, stdout, stderr, ms: performance.now() - started });
    });
  });
}

const put = async (tree, path, data) => {
  await mkdir(dirname(join(tree, path)), { recursive: true });
  await writeFile(join(tree, path), data);
};
async function tree(name, files = {}) {
  const dir = join(tmp, name);
  await put(dir, 'scripts/assets.mjs', await readFile(SCRIPT));
  for (const [path, data] of Object.entries(files)) await put(dir, path, data);
  return dir;
}
const read = (dir, path) => readFile(join(dir, path));
const manifestOf = async (dir) => JSON.parse(await readFile(join(dir, 'assets.json'), 'utf8'));
const git = (dir, ...args) => execFileSync('git', ['-c', 'core.autocrlf=false', ...args], { cwd: dir, encoding: 'utf8' });

const SHIP = 'public/models/ship.glb';
const BANNER = 'public/ui/banner.webp';
const DRUM = 'public/audio/drum.mp3';
const binaries = { [SHIP]: glb(36), [BANNER]: randomBytes(3000), [DRUM]: randomBytes(5000), 'assets-src/pack-2026-10-16/concept.png': randomBytes(2000) };
const provenance = { provider: 'Meshy', model: 'meshy-7.1', consumedCredits: 30, shipped: [SHIP] };
const A = await tree('a', {
  ...binaries,
  'public/ui/art/manifest.json': '{ "text": true }\n',
  'assets-src/pack-2026-10-16/provenance.json': JSON.stringify(provenance, null, 2),
  'assets-src/pack-2026-10-16/originals/raw.glb': randomBytes(1000),
  'assets-src/pack-2026-10-16/draft-1.png': randomBytes(1000),
  '.gitignore': 'assets-src/*/originals/\nassets-src/*/draft-*.png\n',
});
git(A, 'init', '-q');

try {
  await check('requests are signed as in the AWS Signature Version 4 examples for S3', () => {
    const credentials = { accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY' };
    const date = new Date('2013-05-24T00:00:00Z');
    const signature = (request) => /Signature=([0-9a-f]{64})$/.exec(signV4({ credentials, date, region: 'us-east-1', payloadHash: sha(''), ...request }).authorization)[1];
    assert.equal(signature({ method: 'GET', url: 'https://examplebucket.s3.amazonaws.com/test.txt', headers: { Range: 'bytes=0-9' } }), 'f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41');
    assert.equal(
      signature({ method: 'PUT', url: 'https://examplebucket.s3.amazonaws.com/test%24file.text', headers: { Date: 'Fri, 24 May 2013 00:00:00 GMT', 'x-amz-storage-class': 'REDUCED_REDUNDANCY' }, payloadHash: sha('Welcome to Amazon S3.') }),
      '98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd',
    );
    assert.equal(signature({ method: 'GET', url: 'https://examplebucket.s3.amazonaws.com/?max-keys=2&prefix=J' }), '34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7');
  });

  await check('status lists the new binaries, not text files or the scratch .gitignore keeps local', async () => {
    const { code, stdout } = await run(A, ['status']);
    assert.equal(code, 0);
    for (const path of Object.keys(binaries)) assert.ok(stdout.includes(`  ${path}  `), path);
    assert.doesNotMatch(stdout, /raw\.glb|draft-1\.png|manifest\.json|provenance\.json/);
  });

  await check('push uploads every blob under its hash and writes a sorted assets.json ending in a newline', async () => {
    const { code, stderr } = await run(A, ['push']);
    assert.equal(code, 0, stderr);
    const text = await readFile(join(A, 'assets.json'), 'utf8');
    assert.ok(text.endsWith('}\n'));
    const manifest = JSON.parse(text);
    assert.equal(manifest.schema, 'imjin.assets.v1');
    assert.deepEqual(manifest.store, { bucket: BUCKET, region: 'ap-northeast-2', prefix: 'sha256/' });
    assert.deepEqual(Object.keys(manifest.files), Object.keys(binaries).sort());
    for (const [path, data] of Object.entries(binaries)) {
      assert.deepEqual(manifest.files[path], { sha256: sha(data), size: data.length });
      assert.ok(s3.objects.get(key(data))?.data.equals(data), path);
    }
    assert.equal(s3.objects.get(key(binaries[SHIP])).type, 'model/gltf-binary');
    assert.equal(s3.seen.PUT, 4);
  });

  await check('a second push uploads nothing and leaves assets.json byte for byte', async () => {
    const before = await readFile(join(A, 'assets.json'), 'utf8');
    const { code, stdout } = await run(A, ['push']);
    assert.equal(code, 0);
    assert.match(stdout, /nothing to push/);
    assert.equal(s3.seen.PUT, 4);
    assert.equal(await readFile(join(A, 'assets.json'), 'utf8'), before);
  });

  const cacheB = join(tmp, 'cache-b');
  const B = await tree('b');
  const C = await tree('c');
  await check('pull fills an empty tree from S3, and another one from the shared cache without a download', async () => {
    await copyFile(join(A, 'assets.json'), join(B, 'assets.json'));
    await copyFile(join(A, 'assets.json'), join(C, 'assets.json'));
    const gets = s3.seen.GET;
    const first = await run(B, ['pull'], { IMJIN_ASSET_CACHE: cacheB });
    assert.equal(first.code, 0, first.stderr);
    assert.match(first.stdout, /pulled 4 files .*0 from the cache, 4 from s3/);
    assert.equal(s3.seen.GET, gets + 4);
    const second = await run(C, ['pull'], { IMJIN_ASSET_CACHE: cacheB });
    assert.equal(second.code, 0, second.stderr);
    assert.match(second.stdout, /4 from the cache, 0 from s3/);
    assert.equal(s3.seen.GET, gets + 4);
    for (const [path, data] of Object.entries(binaries)) {
      assert.ok((await read(B, path)).equals(data), path);
      assert.ok((await read(C, path)).equals(data), path);
    }
  });

  const ship2 = glb(1200);
  await check('a changed file keeps its old version in the history, through two 503 answers', async () => {
    const old = (await manifestOf(A)).files[SHIP];
    await put(A, SHIP, ship2);
    s3.failNext = 2;
    const { code, stderr } = await run(A, ['push']);
    assert.equal(code, 0, stderr);
    assert.equal(s3.failNext, 0);
    const entry = (await manifestOf(A)).files[SHIP];
    assert.equal(entry.sha256, sha(ship2));
    assert.equal(entry.history.length, 1);
    assert.equal(entry.history[0].sha256, old.sha256);
    assert.equal(entry.history[0].size, old.size);
    assert.match(entry.history[0].until, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
    assert.ok(s3.objects.has(key(ship2)));
  });

  await check('restore --previous brings the old version back and records the swap in the history', async () => {
    const { code, stderr } = await run(A, ['restore', SHIP, '--previous']);
    assert.equal(code, 0, stderr);
    assert.ok((await read(A, SHIP)).equals(binaries[SHIP]));
    const entry = (await manifestOf(A)).files[SHIP];
    assert.equal(entry.sha256, sha(binaries[SHIP]));
    assert.deepEqual(entry.history.map((h) => h.sha256), [sha(binaries[SHIP]), sha(ship2)]);
  });

  await check('models lists each model with its triangles, versions and provenance record', async () => {
    const json = await run(A, ['models', '--json']);
    assert.equal(json.code, 0, json.stderr);
    const rows = JSON.parse(json.stdout);
    assert.deepEqual(rows.map((row) => row.path), [SHIP]);
    assert.equal(rows[0].triangles, 12);
    assert.equal(new Set(rows[0].versions.map((v) => v.sha256)).size, 2);
    assert.deepEqual(rows[0].provenance, [{ record: 'assets-src/pack-2026-10-16/provenance.json', fields: { provider: 'Meshy', model: 'meshy-7.1', consumedCredits: 30 } }]);
    const text = await run(A, ['models']);
    assert.match(text.stdout, /public\/models\/ship\.glb .*12 triangles .*2 versions/);
    assert.match(text.stdout, /provenance\.json: provider Meshy, model meshy-7\.1, consumedCredits 30/);
  });

  await check('verify passes, then names the version whose blob is gone', async () => {
    const pass = await run(A, ['verify']);
    assert.equal(pass.code, 0, pass.stdout + pass.stderr);
    assert.match(pass.stdout, /holds all 5 blobs of the 4 files/);
    const saved = s3.objects.get(key(ship2));
    s3.objects.delete(key(ship2));
    const failing = await run(A, ['verify']);
    s3.objects.set(key(ship2), saved);
    assert.equal(failing.code, 1);
    assert.match(failing.stdout, new RegExp(`public/models/ship\\.glb +in use until \\S+ +${sha(ship2)} +missing`));
  });

  await check('a corrupt copy in the cache is refused and fetched again', async () => {
    const cached = join(cacheB, 'sha256', sha(binaries[BANNER]).slice(0, 2), sha(binaries[BANNER]));
    await writeFile(cached, randomBytes(binaries[BANNER].length));
    await rm(join(C, BANNER));
    const gets = s3.seen.GET;
    const { code, stderr } = await run(C, ['pull'], { IMJIN_ASSET_CACHE: cacheB });
    assert.equal(code, 0, stderr);
    assert.match(stderr, /cached copy of public\/ui\/banner\.webp is corrupt/);
    assert.equal(s3.seen.GET, gets + 1);
    assert.ok((await read(C, BANNER)).equals(binaries[BANNER]));
    assert.ok((await readFile(cached)).equals(binaries[BANNER]));
  });

  await check('a blob that S3 returns damaged is never written', async () => {
    const D = await tree('d');
    await copyFile(join(A, 'assets.json'), join(D, 'assets.json'));
    const saved = s3.objects.get(key(binaries[DRUM]));
    s3.objects.set(key(binaries[DRUM]), { ...saved, data: randomBytes(saved.data.length) });
    const { code, stderr } = await run(D, ['pull', 'public/audio'], { IMJIN_ASSET_CACHE: join(tmp, 'cache-d') });
    s3.objects.set(key(binaries[DRUM]), saved);
    assert.equal(code, 1);
    assert.match(stderr, /^assets: .*does not match its sha256, so public\/audio\/drum\.mp3 was not written/);
    await assert.rejects(read(D, DRUM));
    await assert.rejects(read(D, BANNER), 'only the named directory is pulled');
  });

  await check('a pull with nothing to do reads no file and asks S3 nothing', async () => {
    const requests = s3.requests();
    const { code, stdout, ms } = await run(B, ['pull'], { IMJIN_ASSET_CACHE: cacheB });
    assert.equal(code, 0);
    assert.match(stdout, /up to date: 4 files/);
    assert.doesNotMatch(stdout, /hashed/);
    assert.equal(s3.requests(), requests);
    assert.ok(ms < 3000, `${Math.round(ms)} ms`);
  });

  await check('pull keeps a local change nobody pushed, and replaces it once the file is deleted', async () => {
    const mine = randomBytes(3100);
    await put(B, BANNER, mine);
    const kept = await run(B, ['pull'], { IMJIN_ASSET_CACHE: cacheB });
    assert.equal(kept.code, 0, kept.stderr);
    assert.match(kept.stdout, /kept: changed here[^\n]*\n {2}public\/ui\/banner\.webp/);
    assert.ok((await read(B, BANNER)).equals(mine));
    await rm(join(B, BANNER));
    assert.equal((await run(B, ['pull'], { IMJIN_ASSET_CACHE: cacheB })).code, 0);
    assert.ok((await read(B, BANNER)).equals(binaries[BANNER]));
  });

  const F = await tree('f', { '.gitignore': 'assets-src/*/originals/\n', 'assets-src/pack-2026-10-16/originals/a1.glb': glb(30), 'assets-src/pack-2026-10-16/originals/a2.glb': glb(33) });
  await check('push drops a file only when it is named, and takes a file .gitignore keeps local only when it is named', async () => {
    git(F, 'init', '-q');
    await copyFile(join(A, 'assets.json'), join(F, 'assets.json'));
    assert.equal((await run(F, ['pull'])).code, 0);
    await rm(join(F, DRUM));
    const unnamed = await run(F, ['push']);
    assert.equal(unnamed.code, 0, unnamed.stderr);
    assert.match(unnamed.stdout, /1 files in assets\.json are not here and stay in it/);
    assert.ok((await manifestOf(F)).files[DRUM]);
    const named = await run(F, ['push', DRUM]);
    assert.equal(named.code, 0, named.stderr);
    assert.equal((await manifestOf(F)).files[DRUM], undefined);
    const original = 'assets-src/pack-2026-10-16/originals/a1.glb';
    assert.match((await run(F, ['push', 'assets-src'])).stdout, /nothing to push/);
    assert.equal((await run(F, ['push', original])).code, 0);
    const files = (await manifestOf(F)).files;
    assert.ok(files[original] && !files['assets-src/pack-2026-10-16/originals/a2.glb']);
  });

  await check('restore --sha picks any recorded version, and bad arguments are refused in one line', async () => {
    const { history } = (await manifestOf(F)).files[SHIP];
    const restored = await run(F, ['restore', SHIP, `--sha=${sha(ship2).slice(0, 8)}`]);
    assert.equal(restored.code, 0, restored.stderr);
    assert.ok((await read(F, SHIP)).equals(ship2));
    const entry = (await manifestOf(F)).files[SHIP];
    assert.equal(entry.sha256, sha(ship2));
    assert.equal(entry.history.length, history.length + 1);
    for (const [args, message] of [
      [['restore', SHIP, '--sha=ffff0000'], `${SHIP} has no version ffff0000`],
      [['pull', '--force'], 'pull takes no --force'],
      [['verify', 'public'], 'verify takes no paths'],
      [['push', 'public/ui/art/manifest.json'], 'public/ui/art/manifest.json: no binary file there (text files stay in git)'],
      [['push', 'scripts/assets.mjs'], 'scripts/assets.mjs: managed files live under public/ and assets-src/'],
    ]) {
      const { code, stderr } = await run(F, args);
      assert.equal(code, 1, args.join(' '));
      assert.equal(stderr, `assets: ${message}\n`);
    }
  });

  await check('a missing bucket is reported in one line, not with a stack trace', async () => {
    const E = await tree('e');
    const manifest = await manifestOf(A);
    manifest.store.bucket = 'no-such-bucket';
    await writeFile(join(E, 'assets.json'), JSON.stringify(manifest));
    const { code, stderr } = await run(E, ['status', '--remote']);
    assert.equal(code, 1);
    assert.equal(stderr, 'assets: s3://no-such-bucket does not exist in ap-northeast-2: node scripts/assets.mjs setup --apply creates it\n');
  });

  await check('prune-local leaves a runtime file in S3 only: pull skips it, push keeps it, the dev middleware serves it', async () => {
    const G = await tree('g');
    await put(G, 'scripts/lib/remote-assets.mjs', await readFile(fileURLToPath(new URL('./lib/remote-assets.mjs', import.meta.url))));
    await copyFile(join(A, 'assets.json'), join(G, 'assets.json'));
    const cacheG = join(tmp, 'cache-g');
    assert.equal((await run(G, ['pull'], { IMJIN_ASSET_CACHE: cacheG })).code, 0);
    const want = await read(G, SHIP);
    const dry = await run(G, ['prune-local', '--dry-run'], { IMJIN_ASSET_CACHE: cacheG });
    assert.equal(dry.code, 0, dry.stderr);
    assert.ok(await read(G, SHIP));
    const pruned = await run(G, ['prune-local'], { IMJIN_ASSET_CACHE: cacheG });
    assert.equal(pruned.code, 0, pruned.stderr);
    await assert.rejects(read(G, SHIP));
    assert.deepEqual(JSON.parse(await readFile(join(G, '.assets-remote.json'), 'utf8')).paths, [SHIP]);
    assert.match((await run(G, ['status'], { IMJIN_ASSET_CACHE: cacheG })).stdout, /remote-only \(prune-local\): 1 files/);
    assert.match((await run(G, ['pull'], { IMJIN_ASSET_CACHE: cacheG })).stdout, /1 files stay remote-only/);
    await assert.rejects(read(G, SHIP));
    const push = await run(G, ['push', SHIP], { IMJIN_ASSET_CACHE: cacheG });
    assert.equal(push.code, 0, push.stderr);
    assert.ok((await manifestOf(G)).files[SHIP], 'a pruned file is not dropped');
    // The dev server's middleware, with an empty cache: the blob comes from S3, checked, and is then cached.
    const serve = `import { createServer } from 'node:http';
      const { remoteAssetsMiddleware } = await import(process.argv[1]);
      const mw = remoteAssetsMiddleware({ log: { warn() {} } });
      const server = createServer((req, res) => mw(req, res, () => { res.statusCode = 404; res.end(); })).listen(0, '127.0.0.1', async () => {
        const base = 'http://127.0.0.1:' + server.address().port;
        const a = await fetch(base + '/models/ship.glb');
        const bytes = Buffer.from(await a.arrayBuffer());
        const b = await fetch(base + '/ui/banner.webp');
        console.log(JSON.stringify({ status: a.status, type: a.headers.get('content-type'), hex: bytes.toString('hex'), local: b.status }));
        server.close();
      });`;
    const out = await new Promise((done, fail) =>
      execFile(process.execPath, ['--input-type=module', '-e', serve, pathToFileURL(join(G, 'scripts/lib/remote-assets.mjs')).href], { cwd: G, env: { ...ENV, IMJIN_ASSET_CACHE: join(tmp, 'cache-g2') } }, (error, stdout, stderr) => (error ? fail(new Error(stderr)) : done(JSON.parse(stdout)))),
    );
    assert.equal(out.status, 200);
    assert.equal(out.type, 'model/gltf-binary');
    assert.equal(out.hex, want.toString('hex'));
    assert.equal(out.local, 404, 'a file the tree has goes on to Vite');
    const back = await run(G, ['pull', '--all'], { IMJIN_ASSET_CACHE: cacheG });
    assert.equal(back.code, 0, back.stderr);
    assert.deepEqual(await read(G, SHIP), want);
    await assert.rejects(readFile(join(G, '.assets-remote.json')));
  });

  await check('untrack takes the binaries out of git, and status still sees them and nothing else', async () => {
    git(A, 'add', '-A');
    const listing = await run(A, ['untrack']);
    assert.equal(listing.code, 0, listing.stderr);
    assert.ok(listing.stdout.includes(`  ${SHIP}\n`));
    assert.ok(git(A, 'ls-files').split('\n').includes(SHIP), 'listing alone changes nothing');
    // Other content of the same size under the same mtime fools the index, but not the cut-over.
    const when = new Date('2026-01-01T00:00:00Z');
    await utimes(join(A, SHIP), when, when);
    await run(A, ['status']);
    await put(A, SHIP, glb(37));
    await utimes(join(A, SHIP), when, when);
    const refused = await run(A, ['untrack', '--apply']);
    assert.equal(refused.code, 1);
    assert.equal(refused.stderr, 'assets: 1 of them differ from assets.json (public/models/ship.glb first): npm run assets -- push, then try again\n');
    await put(A, SHIP, binaries[SHIP]);
    const applied = await run(A, ['untrack', '--apply']);
    assert.equal(applied.code, 0, applied.stderr);
    const tracked = git(A, 'ls-files').split('\n');
    for (const path of Object.keys(binaries)) assert.ok(!tracked.includes(path), path);
    assert.ok(tracked.includes('assets-src/pack-2026-10-16/provenance.json') && tracked.includes('assets.json'));
    const gitignore = await readFile(join(A, '.gitignore'), 'utf8');
    assert.ok(gitignore.startsWith('# Binary assets live in S3 by content hash'));
    assert.ok(gitignore.endsWith('\nassets-src/*/originals/\nassets-src/*/draft-*.png\n'));
    assert.doesNotMatch(git(A, 'status', '--porcelain', '--untracked-files=all'), /^\?\?/m);
    assert.match((await run(A, ['status'])).stdout, /the tree matches assets\.json/);
    await put(A, 'public/ui/new.webp', randomBytes(100));
    const after = await run(A, ['status']);
    assert.ok(after.stdout.includes('  public/ui/new.webp  '));
    assert.doesNotMatch(after.stdout, /raw\.glb|draft-1\.png/, 'the scratch rules after the asset block still win');
  });
} finally {
  s3.server.close();
  await rm(tmp, { recursive: true, force: true });
}

if (failures) {
  console.error(`${failures} asset store check(s) failed`);
  process.exit(1);
}
console.log('asset store: all checks passed');
