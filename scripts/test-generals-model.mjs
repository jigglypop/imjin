
// Production CPU checks for one complete character plus one replaceable weapon.
// Fixtures verify runtime behavior and ownership, never provider quality or visual fit.
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
// Runtime binaries may be pruned to S3 (npm run assets -- prune-local): runtimePath reads them through the cache.
import { runtimePath } from './lib/remote-assets.mjs';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('..', import.meta.url));
const built = await build({
  stdin: {
    contents: `export * from './src/ui/generals/GeneralModel.tsx';
      export { WEAPONS } from './src/meta/catalog.ts';
      export { AnimationClip, Bone, Box3, BoxGeometry, Group, Mesh, MeshBasicMaterial,
        NumberKeyframeTrack, Skeleton, SkinnedMesh, Texture, Vector3 } from 'three/webgpu';`,
    resolveDir: root,
  },
  bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent',
  define: { 'import.meta.env.BASE_URL': '"/"' },
  plugins: [{ name: 'cpu-general', setup(api) {
    api.onLoad({ filter: /GeneralModel\.tsx$/ }, async ({ path }) => ({
      contents: `${await readFile(path, 'utf8')}\nexport { singleModelFile, normalizeFigure,
        availableMotions, free, movementClips,
        FigureStage, MOVES, ATTACK_LABEL };`, loader: 'tsx',
    }));
    api.onLoad({ filter: /game[\\/]quality\.ts$/ }, () => ({
      contents: `export const equipment = { tier: 'high', select: { dprCap: 2 } }; export const forceWebGL = false;`, loader: 'ts',
    }));
    api.onLoad({ filter: /i18n[\\/]index\.ts$/ }, () => ({ contents: `export const useT = () => value => value;`, loader: 'ts' }));
  } }],
});
const M = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].contents).toString('base64')}`);
const { AnimationClip, Bone, Box3, BoxGeometry, Group, Mesh, MeshBasicMaterial, NumberKeyframeTrack, Skeleton, SkinnedMesh, Texture, Vector3 } = M;
let passed = 0;
async function check(name, fn) { await fn(); passed++; console.log(`ok - ${name}`); }
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);
const tick = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function character() {
  const scene = new Group();
  const mesh = new Mesh(new BoxGeometry(.6, 2, .4), new MeshBasicMaterial());
  mesh.position.y = 1;
  const pivot = new Group(); pivot.name = 'Pose'; scene.add(pivot, mesh);
  for (const side of ['Right', 'Left']) {
    const fore = new Bone(); fore.name = `${side}ForeArm`; fore.position.set(side === 'Right' ? -.3 : .3, 1.5, 0);
    const hand = new Bone(); hand.name = `${side}Hand`; hand.position.x = side === 'Right' ? -.2 : .2;
    const socket = new Group(); socket.name = `socket_grip_${side.toLowerCase()}`;
    socket.position.x = side === 'Right' ? -.05 : .05;
    socket.rotation.z = side === 'Right' ? Math.PI / 2 : -Math.PI / 2;
    hand.add(socket); fore.add(hand); scene.add(fore);
  }
  return { scene, mesh, animations: motions() };
}
function motions() {
  return ['idle', 'command', 'slash'].map((name, i) => new AnimationClip(name, .5, [
    new NumberKeyframeTrack('Pose.position[x]', [0, .5], [i, i]),
  ]));
}
function weapon() { return { scene: new Mesh(new BoxGeometry(.02, 1, .03), new MeshBasicMaterial()), animations: [] }; }
const definition = (id, kind = 'sword') => ({ id, kind, faction: 'joseon', name: id, hanja: '', line: '' });

// Exercise the production stage with only its GPU/host boundary replaced.
function stage() {
  const events = { state: [], moves: [], weapon: [], disposed: 0, removed: 0, disconnected: 0 };
  const value = Object.assign(Object.create(M.FigureStage.prototype), {
    started: Promise.resolve(), figure: null, request: 0, weaponRequest: 0, disposed: false,
    weaponDefinition: undefined, turn: new Group(), raf: 0,
    onState: (v) => events.state.push(v), onMoves: (v) => events.moves.push(v),
    onWeaponState: (v) => events.weapon.push(v),
    canvas: { removeEventListener() {}, remove() { events.removed++; } },
    observer: { disconnect() { events.disconnected++; } },
    renderer: { dispose() { events.disposed++; } }, environment: { dispose() { events.disposed++; } },
  });
  return { value, events };
}
globalThis.cancelAnimationFrame = () => {};
const originalLoad = M.loader.loadAsync;

await check('only one complete base file can load; unsafe paths and outfit part lists fail before fetch', async () => {
  assert.equal(M.singleModelFile(['representative/general']), 'representative/general');
  assert.equal(M.modelUrl('representative/general'), '/models/generals/representative/general.glb');
  for (const files of [[], ['a', 'b'], [''], ['../outside'], ['/absolute'], ['a.glb'], ['a?x=1']]) assert.throws(() => M.singleModelFile(files));
  let requests = 0; M.loader.loadAsync = async () => { requests++; return character(); };
  const { value, events } = stage(); await value.show(['parts/body', 'parts/armor']);
  assert.equal(requests, 0); assert.equal(events.state.at(-1), 'failed');
  await value.show(null); assert.equal(events.state.at(-1), 'loading'); assert.equal(value.figure, null); value.dispose();
});

await check('the three controls select real clips and never invent missing motions', () => {
  assert.deepEqual(M.MOVES.map((v) => v.label), ['서있기', '지휘', '검술']);
  const actual = motions();
  const clips = M.movementClips([new AnimationClip('Sword_Shout', 1, []), ...actual, new AnimationClip('Triple_Combo', 1, [])]);
  assert.equal(clips.idle, actual[0]); assert.equal(clips.moves.get('command'), actual[1]); assert.equal(clips.moves.get('slash'), actual[2]);
  const aliases = M.movementClips(['Idle_11', 'Sword_Shout', 'Right_Hand_Sword_Slash'].map((n) => new AnimationClip(n, 1, [])));
  assert.ok(aliases.idle); assert.deepEqual([...aliases.moves.keys()], ['command', 'slash']);
  const empty = M.movementClips([new AnimationClip('parry', 1, []), new AnimationClip('dance', 1, [])]);
  assert.equal(empty.idle, undefined); assert.equal(empty.moves.size, 0);
  const sets = ['idle_sword', 'command_sword', 'attack_sword', 'idle_spear', 'attack_spear', 'idle_bow', 'command_bow', 'attack_bow'].map((n) => new AnimationClip(n, 1, []));
  const bow = M.movementClips(sets, 'bow'), spear = M.movementClips(sets, 'spear');
  assert.equal(bow.idle.name, 'idle_bow'); assert.equal(bow.moves.get('command').name, 'command_bow'); assert.equal(bow.moves.get('slash').name, 'attack_bow');
  assert.equal(spear.idle.name, 'idle_spear'); assert.equal(spear.moves.get('command').name, 'command_sword'); assert.equal(spear.moves.get('slash').name, 'attack_spear');
  assert.deepEqual(Object.values(M.ATTACK_LABEL), ['검술', '창술', '궁술']);
});

await check('whole-model normalization preserves authored transforms and defaults to +Z without bone-name guesses', () => {
  const { scene } = character(); scene.position.set(3, -4, 7); scene.scale.setScalar(1.7);
  const namedHand = new Bone(); namedHand.name = 'R_Hand'; scene.add(namedHand);
  scene.updateMatrix(); const saved = scene.matrix.clone();
  const normalized = M.normalizeFigure(scene); const box = new Box3().setFromObject(normalized);
  near(box.min.y, 0); near(box.getSize(new Vector3()).y, 1.8);
  near(box.getCenter(new Vector3()).x, 0); near(box.getCenter(new Vector3()).z, 0); near(normalized.rotation.y, 0);
  scene.updateMatrix(); assert.deepEqual(scene.matrix.elements, saved.elements); assert.equal(scene.parent, normalized);
  assert.equal(scene.children.every((v) => !v.frustumCulled), true); M.free(normalized);
  for (const [axis, angle] of [['+X', -Math.PI / 2], ['-X', Math.PI / 2], ['-Z', Math.PI]]) {
    const { scene } = character(); scene.userData.frontAxis = axis;
    const normalized = M.normalizeFigure(scene); near(normalized.rotation.y, angle); M.free(normalized);
  }
  assert.throws(() => M.normalizeFigure(new Group()), /finite geometry/);
  const { scene: invalid } = character(); invalid.userData.frontAxis = 'guessed';
  assert.throws(() => M.normalizeFigure(invalid), /front axis/); M.free(invalid);
});

await check('actual mixer transitions command and slash back to standing and permits manual standing', () => {
  const asset = character(); const f = M.createFigure(asset.scene, asset.animations);
  assert.deepEqual(M.availableMotions(f), ['stand', 'command', 'slash']); assert.ok(f.idle.isRunning());
  assert.equal(M.playFigure(f, 'command'), true); f.mixer.update(.25);
  assert.equal(f.playing, f.moves.get('command')); near(asset.scene.getObjectByName('Pose').position.x, 1);
  for (let i = 0; i < 20; i++) f.mixer.update(.05);
  assert.equal(f.playing, null); assert.ok(f.idle.isRunning()); near(asset.scene.getObjectByName('Pose').position.x, 0);
  assert.equal(M.playFigure(f, 'slash'), true); f.mixer.update(.25); near(asset.scene.getObjectByName('Pose').position.x, 2);
  assert.equal(M.standFigure(f), true); for (let i = 0; i < 5; i++) f.mixer.update(.05);
  assert.equal(f.playing, null); near(asset.scene.getObjectByName('Pose').position.x, 0); assert.equal(M.playFigure(f, 'parry'), false);
  M.releaseFigure(f); assert.equal(f.mixer.stats.actions.inUse, 0); assert.equal(f.mixer.stats.bindings.total, 0);
  assert.equal(f.mixer.hasEventListener('finished', f.finished), false);
  const missing = M.createFigure(character().scene, []); assert.deepEqual(M.availableMotions(missing), []);
  assert.equal(M.playFigure(missing, 'command'), false); assert.equal(M.standFigure(missing), false); M.releaseFigure(missing);
});

await check('release deduplicates resources and protects retained textures and bitmap sources', () => {
  const bitmap = { closed: 0, close() { this.closed++; } };
  const map = new Texture(bitmap), secondMap = new Texture(bitmap);
  const material = new MeshBasicMaterial({ map }), second = new MeshBasicMaterial({ map: secondMap });
  const geometry = new BoxGeometry(1, 1, 1); const a = new Group(), b = new Group();
  const mesh = new SkinnedMesh(geometry, [material, second]); const bone = new Bone(); mesh.bind(new Skeleton([bone]));
  a.add(mesh, bone, new Mesh(geometry, material)); b.add(new Mesh(geometry, material));
  let geometries = 0, materials = 0, textures = 0, skeletons = 0;
  geometry.addEventListener('dispose', () => geometries++);
  for (const m of [material, second]) m.addEventListener('dispose', () => materials++);
  for (const t of [map, secondMap]) t.addEventListener('dispose', () => textures++);
  mesh.skeleton.dispose = () => skeletons++;
  M.free(a, b); assert.deepEqual([geometries, materials, textures, skeletons, bitmap.closed], [0, 1, 1, 1, 0]);
  M.free(b); assert.deepEqual([geometries, materials, textures, skeletons, bitmap.closed], [1, 2, 2, 1, 1]);
});

await check('swords and spears attach right and bows left, with metre dimensions under body scaling', () => {
  for (const scale of [.8, 1, 1.8, 2.2]) for (const kind of ['sword', 'spear', 'bow']) {
    const { scene } = character(); scene.scale.setScalar(scale); const asset = weapon().scene;
    const held = M.holdWeapon(scene, asset, definition(`test_${kind}`, kind));
    assert.equal(held.parent.name, `socket_grip_${kind === 'bow' ? 'left' : 'right'}`); scene.updateMatrixWorld(true);
    const a = asset.localToWorld(new Vector3(0, -.5, 0)), b = asset.localToWorld(new Vector3(0, .5, 0)); near(a.distanceTo(b), 1);
    if (kind !== 'sword') near(b.clone().sub(a).normalize().y, 1); M.free(scene);
  }
  const loose = weapon().scene; assert.throws(() => M.holdWeapon(new Group(), loose, definition('unfitted')), /hand socket/); M.free(loose);
});

await check('A to B to A loads discard stale scenes even when names match again', async () => {
  const loads = []; M.loader.loadAsync = (url) => { const pending = deferred(); loads.push({ url, ...pending }); return pending.promise; };
  const { value, events } = stage();
  const a1 = value.show(['representative/general']); await tick(); const b = value.show(['representative/other']); await tick();
  const a2 = value.show(['representative/general']); await tick();
  const staleA = character(), staleB = character(), current = character(); let freed = 0;
  staleA.mesh.geometry.addEventListener('dispose', () => freed++); staleB.mesh.geometry.addEventListener('dispose', () => freed++);
  loads[2].resolve(current); await a2; loads[0].resolve(staleA); loads[1].resolve(staleB); await Promise.all([a1, b]);
  assert.equal(value.figure.asset, current.scene); assert.equal(value.turn.children.length, 1); assert.equal(freed, 2);
  assert.equal(events.state.filter((v) => v === 'ready').length, 1); assert.deepEqual(events.moves.at(-1), ['stand', 'command', 'slash']);
  value.dispose(); value.dispose(); assert.deepEqual([events.disposed, events.removed, events.disconnected], [2, 1, 1]);
});

await check('base or renderer failures clear state and late loads after disposal free their scene', async () => {
  M.loader.loadAsync = async () => character(); const first = stage(); await first.value.show(['representative/general']);
  let disposed = 0; first.value.figure.asset.children.find((o) => o.isMesh).geometry.addEventListener('dispose', () => disposed++);
  M.loader.loadAsync = async () => { throw new Error('404'); }; await first.value.show(['representative/missing']);
  assert.equal(first.value.figure, null); assert.equal(first.value.turn.children.length, 0); assert.equal(first.events.state.at(-1), 'failed');
  assert.equal(disposed, 1); first.value.dispose();
  const failed = stage(); failed.value.started = Promise.reject(new Error('GPU init'));
  await failed.value.show(['representative/general']); assert.equal(failed.events.state.at(-1), 'failed'); failed.value.dispose();
  const pending = deferred(); M.loader.loadAsync = () => pending.promise;
  const late = stage(); const loading = late.value.show(['representative/general']); await tick(); late.value.dispose();
  const asset = character(); let freed = 0; asset.mesh.geometry.addEventListener('dispose', () => freed++); pending.resolve(asset); await loading;
  assert.equal(freed, 1); assert.equal(late.events.state.includes('ready'), false);
});

await check('weapon swaps retain the body and motion, discard stale weapons and report attachment or fetch failure', async () => {
  const calls = [], pending = [];
  M.loader.loadAsync = (url) => {
    calls.push(url); if (!url.includes('/weapon_')) return Promise.resolve(character());
    const load = deferred(); pending.push(load); return load.promise;
  };
  const { value, events } = stage(); await value.show(['representative/general']); const body = value.figure, mixer = body.mixer; value.play('slash');
  const one = value.setWeapon(definition('one')), two = value.setWeapon(definition('two', 'bow'));
  const old = weapon(), chosen = weapon(); let discarded = 0, removed = 0;
  old.scene.geometry.addEventListener('dispose', () => discarded++); chosen.scene.geometry.addEventListener('dispose', () => removed++);
  pending[1].resolve(chosen); await two; pending[0].resolve(old); await one;
  assert.equal(discarded, 1); assert.equal(value.figure, body); assert.equal(body.mixer, mixer);
  assert.equal(body.weapon.parent.name, 'socket_grip_left'); assert.equal(events.weapon.at(-1), 'ready');
  assert.equal(body.playing, body.moves.get('slash')); assert.equal(calls.filter((v) => !v.includes('/weapon_')).length, 1);
  const broken = value.setWeapon(definition('missing', 'spear')); assert.equal(removed, 1); assert.equal(body.weapon, null);
  pending[2].reject(new Error('404')); await broken; assert.equal(events.weapon.at(-1), 'failed'); assert.equal(events.state.at(-1), 'ready');
  const late = value.setWeapon(definition('late')); value.dispose(); const after = weapon(); let freed = 0;
  after.scene.geometry.addEventListener('dispose', () => freed++); pending[3].resolve(after); await late; assert.equal(freed, 1);
});

M.loader.loadAsync = originalLoad;
const models = new Set(JSON.parse(await readFile(new URL('../public/models/generals/index.json', import.meta.url), 'utf8')));
await check('all 18 selectable weapons have indexed desktop/mobile files and thumbnails', async () => {
  assert.equal(M.WEAPONS.length, 18);
  for (const weapon of M.WEAPONS) {
    const file = `parts/weapon_${weapon.id}`; assert.ok(models.has(file), file);
    for (const suffix of ['', '_lod1']) await runtimePath(`public/models/generals/${file}${suffix}.glb`);
    await runtimePath(`public/ui/weapons/${weapon.id}.webp`);
  }
});
const cast = [...models].filter((f) => /^[a-z]+__[a-z_]+$/.test(f));
if (cast.length) {
  const { io } = await import('./lib/figure.mjs');
  await check(`indexed general figures (${cast.length}) have three levels with only the standing clip (owner 2026-10-17: no command or attack buttons) on a hand bone`, async () => {
    for (const file of cast) for (const suffix of ['', '_lod1', '_lod2']) {
      const doc = await io.read(await runtimePath(`public/models/generals/${file}${suffix}.glb`));
      for (const kind of ['sword', 'spear', 'bow']) {
        const clips = M.movementClips(doc.getRoot().listAnimations().map((a) => new AnimationClip(a.getName(), 1, [])), kind);
        assert.ok(clips.idle, `${file}${suffix} ${kind} idle`); assert.deepEqual([...clips.moves.keys()], [], `${file}${suffix} ${kind} moves`);
        assert.deepEqual(doc.getRoot().listAnimations().map((a) => a.getName()), ['idle_sword'], `${file}${suffix} clips`);
      }
      assert.ok(doc.getRoot().listNodes().some((n) => n.getName() === 'RightHand'), `${file}${suffix} RightHand`);
    }
  });
}
await check('index.json lists no staged or candidate files', async () => {
  for (const f of models) assert.ok(!/(^|\/)_(stage|cand)(\/|$)/.test(f), `index.json lists ${f}`);
});
// Sword files: metres, +Y along the blade, grip at the origin, and a single-edged blade's EDGE on -X (the thin side
// across the blade's width; the spine is the thick side on +X). Every figure's socket_grip_right has +X from the
// wrist toward the closed fingers and +Y out of the thumb side, so holdWeapon must turn the file's -X onto the
// socket's +X: edge on the fingers' side, toward the target, spine to the thumb ("역날" is the opposite).
await check('curved swords are held edge on the fingers side (hwando, katana, tachi, dao)', async () => {
  const { io } = await import('./lib/figure.mjs');
  for (const id of ['joseon_hwando', 'japan_katana', 'japan_tachi', 'ming_dao']) {
    for (const suffix of ['', '_lod1']) {
      const doc = await io.read(await runtimePath(`public/models/generals/parts/weapon_${id}${suffix}.glb`));
      const pts = [];
      for (const node of doc.getRoot().listNodes()) {
        const mesh = node.getMesh(); if (!mesh) continue; const W = node.getWorldMatrix();
        for (const prim of mesh.listPrimitives()) {
          const P = prim.getAttribute('POSITION'); const v = [0, 0, 0];
          for (let i = 0; i < P.getCount(); i++) { P.getElement(i, v); pts.push([W[0] * v[0] + W[4] * v[1] + W[8] * v[2] + W[12], W[1] * v[0] + W[5] * v[1] + W[9] * v[2] + W[13], W[2] * v[0] + W[6] * v[1] + W[10] * v[2] + W[14]]); }
        }
      }
      let y0 = Infinity, y1 = -Infinity; for (const p of pts) { y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
      // the blade between 60 % and 85 % of its length: the z thickness of its two long sides
      const band = pts.filter((p) => p[1] > y0 + (y1 - y0) * 0.6 && p[1] < y0 + (y1 - y0) * 0.85);
      let lo = Infinity, hi = -Infinity; for (const p of band) { lo = Math.min(lo, p[0]); hi = Math.max(hi, p[0]); }
      const thick = (keep) => { const z = band.filter(keep).map((p) => p[2]); return Math.max(...z) - Math.min(...z); };
      const minus = thick((p) => p[0] < lo + (hi - lo) * 0.2), plus = thick((p) => p[0] > hi - (hi - lo) * 0.2);
      assert.ok(minus < plus * 0.85, `weapon_${id}${suffix}: the edge (thin side) must be on -X, thickness -X ${minus.toFixed(4)} vs +X ${plus.toFixed(4)}`);
    }
    const body = new Group(); const socket = new Group(); socket.name = 'socket_grip_right'; body.add(socket);
    const blade = new Group(); M.holdWeapon(body, blade, M.WEAPONS.find((w) => w.id === id)); blade.updateMatrixWorld(true);
    const edge = new Vector3(-1, 0, 0).transformDirection(blade.matrixWorld), up = new Vector3(0, 1, 0).transformDirection(blade.matrixWorld);
    assert.ok(edge.x > 0.999, `${id}: edge must map to the socket's finger side (+X), got ${edge.toArray()}`);
    assert.ok(up.y > 0.999, `${id}: blade must leave the thumb side (+Y)`);
  }
});
if (cast.length) {
  const { io } = await import('./lib/figure.mjs');
  const { readdirSync, existsSync } = await import('node:fs');
  const { createHash } = await import('node:crypto');
  const pkg = fileURLToPath(new URL('../assets-src/generals-cast-2026-10-17/', import.meta.url));
  const trianglesOf = (doc) => doc.getRoot().listMeshes().reduce((t, m) => t + m.listPrimitives().reduce((u, p) => u + p.getIndices().getCount() / 3, 0), 0);
  await check(`indexed general figures (${cast.length}) have LOD1/LOD2, both grip sockets and an undecimated LOD0`, async () => {
    for (const file of cast) {
      for (const suffix of ['', '_lod1', '_lod2']) {
        const path = await runtimePath(`public/models/generals/${file}${suffix}.glb`);
        await access(path).catch(() => assert.fail(`${file}${suffix}.glb missing`));
        const names = (await io.read(path)).getRoot().listNodes().map((n) => n.getName());
        for (const s of ['socket_grip_right', 'socket_grip_left']) assert.ok(names.includes(s), `${file}${suffix} has no ${s}`);
      }
      // LOD0 is the full rigged mesh (it goes on the card); a decimated LOD0 smears the face. Sources come from the
      // asset store (npm run assets -- pull); without them this part is skipped.
      if (!existsSync(pkg)) continue;
      const lod0 = await runtimePath(`public/models/generals/${file}.glb`);
      const sha = createHash('sha256').update(await readFile(lod0)).digest('hex');
      const dirs = readdirSync(pkg).filter((d) => (d === file || d.startsWith(`${file}_`)) && existsSync(`${pkg}${d}/rig.glb`));
      if (!dirs.length) continue;
      const packOf = (d) => { try { return JSON.parse(readFileSync(`${pkg}${d}/pack.json`, 'utf8')); } catch { return null; } };
      const exact = dirs.find((d) => packOf(d)?.levels?._lod0?.check?.sha256 === sha);
      const tris = trianglesOf(await io.read(lod0));
      const rigs = await Promise.all((exact ? [exact] : dirs).map(async (d) => trianglesOf(await io.read(`${pkg}${d}/rig.glb`))));
      const need = Math.min(...rigs) * 0.98;
      assert.ok(tris >= need, `${file}: LOD0 has ${tris} triangles, its rig mesh ${Math.min(...rigs)} (LOD0 must not be decimated)`);
    }
  });
}
if (models.has('representative/general')) {
  const { io } = await import('./lib/figure.mjs');
  await check('indexed representative GLBs contain the three real motions', async () => {
    for (const suffix of ['', '_lod1']) {
      const path = await runtimePath(`public/models/generals/representative/general${suffix}.glb`); const doc = await io.read(path);
      const clips = M.movementClips(doc.getRoot().listAnimations().map((a) => new AnimationClip(a.getName(), 1, [])));
      assert.ok(clips.idle); assert.deepEqual([...clips.moves.keys()], ['command', 'slash']);
    }
  });
} else console.log('PENDING - representative/general is unpublished; actual character geometry, sockets and motions remain unverified.');
console.log(`generals-model: ${passed} CPU/file regressions passed; no provider or visual acceptance claim`);
