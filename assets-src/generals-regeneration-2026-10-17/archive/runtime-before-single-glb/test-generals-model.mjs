// CPU checks for the wardrobe's asset selection, shared skeleton/resource ownership and final sword dimensions.
// These exercise the production functions without creating a renderer; visual fit is checked separately in-browser.
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { io } from './lib/figure.mjs';
import { setWardrobeIdle } from './lib/general-stance.mjs';
import { Matrix4, Quaternion } from 'three';

const root = fileURLToPath(new URL('..', import.meta.url));
const built = await build({
  stdin: {
    contents: `export * from './src/ui/generals/GeneralModel.tsx';
      export { ARMORS } from './src/meta/catalog.ts';
      export { AnimationClip, Bone, Box3, BoxGeometry, BufferGeometry, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial, Skeleton, SkinnedMesh, Texture, Uint16BufferAttribute, Vector3 } from 'three/webgpu';`,
    resolveDir: root,
  },
  bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent',
  define: { 'import.meta.env.BASE_URL': '"/"' },
  plugins: [{ name: 'cpu-wardrobe', setup(api) {
    api.onLoad({ filter: /GeneralModel\.tsx$/ }, async ({ path }) => ({
      contents: `${await readFile(path, 'utf8')}\nexport { dressIn, grip, holdWeapon, free, movementClips };`, loader: 'tsx',
    }));
    api.onLoad({ filter: /game[\\/]quality\.ts$/ }, () => ({
      contents: `export const equipment = { tier: 'high', select: { dprCap: 2 } }; export const forceWebGL = false;`, loader: 'ts',
    }));
    api.onLoad({ filter: /i18n[\\/]index\.ts$/ }, () => ({ contents: `export const useT = () => value => value;`, loader: 'ts' }));
  } }],
});
const M = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].contents).toString('base64')}`);
const { AnimationClip, Bone, Box3, BoxGeometry, BufferGeometry, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial, Skeleton, SkinnedMesh, Texture, Uint16BufferAttribute, Vector3 } = M;
let passed = 0;
async function check(name, fn) { await fn(); passed++; console.log(`ok - ${name}`); }
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);
const models = new Set(JSON.parse(await readFile(new URL('../public/models/generals/index.json', import.meta.url), 'utf8')));

await check('the selected armor is the actual outfit, and unavailable armor keeps its portrait', async () => {
  const pilot = models.has('parts/v2/body_yi') && models.has('parts/v2/armor_joseon_dujeong');
  assert.deepEqual(M.figureFor(models, 'yi', 'joseon_dujeong'), pilot ? ['parts/v2/body_yi', 'parts/v2/armor_joseon_dujeong', 'parts/v2/helmet_joseon_dujeong'].filter(n => models.has(n)) : ['parts/body_yi', 'parts/armor_joseon_dujeong', 'parts/weapon_hwando']);
  assert.deepEqual(M.figureFor(models, 'yi', 'yi_tongjesa'), ['parts/body_yi', 'parts/armor_yi_tongjesa', 'parts/weapon_hwando']);
  for (const armor of M.ARMORS.filter((a) => a.faction === 'joseon')) {
    const figure = M.figureFor(models, 'yi', armor.id);
    if (!models.has(`parts/armor_${armor.id}`) && !models.has(`yi_${armor.id}`)) assert.equal(figure, null, armor.id);
    for (const name of figure ?? []) for (const suffix of ['', '_lod1']) await access(new URL(`../public/models/generals/${name}${suffix}.glb`, import.meta.url));
  }
  assert.deepEqual(M.figureFor(models, 'wakisaka', 'japan_nanbando'), ['wakisaka_japan_nanbando']);
  assert.equal(M.figureFor(new Set(['parts/body_yi', 'parts/armor_joseon_dujeong']), 'won', 'joseon_dujeong'), null);
});

await check('action availability follows the real clips, including providers with no command motion', async () => {
  const doc = await io.read(fileURLToPath(new URL('../public/models/generals/parts/body_yi.glb', import.meta.url)));
  const actual = doc.getRoot().listAnimations().map((a) => new AnimationClip(a.getName(), 1, []));
  const clips = M.movementClips(actual);
  assert.equal(clips.idle.name, 'idle');
  assert.deepEqual([...clips.moves.keys()], ['slash']);
  assert.deepEqual([...M.movementClips([new AnimationClip('Sword_Shout', 1, [])]).moves.keys()], ['command']);
  assert.deepEqual([...M.movementClips([]).moves.keys()], []);
});

await check('the authored wardrobe idle leaves rest geometry intact and keeps the slash', async () => {
  const doc = await io.read(fileURLToPath(new URL('../public/models/generals/parts/body_yi.glb', import.meta.url)));
  const joints = doc.getRoot().listSkins()[0].listJoints();
  const rest = joints.map((n) => JSON.stringify([n.getTranslation(), n.getRotation(), n.getScale()]));
  const slash = doc.getRoot().listAnimations().find((a) => a.getName() === 'slash');
  assert.ok(slash);
  setWardrobeIdle(doc);
  assert.ok(doc.getRoot().listAnimations().includes(slash));
  assert.deepEqual(joints.map((n) => JSON.stringify([n.getTranslation(), n.getRotation(), n.getScale()])), rest);
  const idle = doc.getRoot().listAnimations().find((a) => a.getName() === 'idle');
  assert.ok(idle);
  applyFirstPose(doc, idle);
  const byName = new Map(joints.map((n) => [n.getName(), n]));
  for (const side of ['L', 'R']) {
    const upper = new Vector3(...byName.get(`${side}_Upperarm`).getWorldTranslation());
    const fore = new Vector3(...byName.get(`${side}_Forearm`).getWorldTranslation());
    assert.ok(fore.sub(upper).normalize().y < -0.85, `${side} arm hangs down`);
  }
});

function applyFirstPose(doc, animation) {
  const byName = new Map(doc.getRoot().listNodes().map((n) => [n.getName(), n]));
  for (const channel of animation.listChannels()) {
    const node = byName.get(channel.getTargetNode().getName());
    if (!node) continue;
    const value = channel.getSampler().getOutput().getElement(0, []);
    if (channel.getTargetPath() === 'translation') node.setTranslation(value);
    if (channel.getTargetPath() === 'rotation') node.setRotation(value);
    if (channel.getTargetPath() === 'scale') node.setScale(value);
  }
}

function restSkin(doc) {
  const skin = doc.getRoot().listSkins()[0];
  const joints = skin.listJoints();
  const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
  const transforms = joints.map((n, i) => new Matrix4().fromArray(n.getWorldMatrix())
    .multiply(new Matrix4().fromArray(skin.getInverseBindMatrices().getElement(i, []))));
  const position = prim.getAttribute('POSITION');
  const joint = prim.getAttribute('JOINTS_0');
  const weight = prim.getAttribute('WEIGHTS_0');
  const points = [];
  for (let v = 0; v < position.getCount(); v++) {
    const p = new Vector3(...position.getElement(v, []));
    const indices = joint.getElement(v, []), weights = weight.getElement(v, []);
    const at = new Vector3();
    for (let k = 0; k < 4; k++) if (weights[k]) at.addScaledVector(p.clone().applyMatrix4(transforms[indices[k]]), weights[k]);
    points.push(at);
  }
  return { joints, joint, weight, points };
}

await check('the packed idle keeps legs in bind, and fitted boots have finite normalized skinning with no hip influence', async () => {
  const body = await io.read(fileURLToPath(new URL('../public/models/generals/parts/body_yi.glb', import.meta.url)));
  const idle = body.getRoot().listAnimations().find((a) => a.getName() === 'idle');
  assert.ok(idle);
  for (const channel of idle.listChannels()) {
    const node = channel.getTargetNode();
    if (!/^(Root|Hip|Pelvis|[LR]_(Thigh|Calf|Foot|ToeBase|ToeEnd))$/.test(node.getName())) continue;
    const path = channel.getTargetPath(), output = channel.getSampler().getOutput();
    const rest = path === 'rotation' ? node.getRotation() : path === 'translation' ? node.getTranslation() : node.getScale();
    for (let k = 0; k < output.getCount(); k++) {
      const value = output.getElement(k, []);
      if (path === 'rotation') assert.ok(new Quaternion(...value).normalize().angleTo(new Quaternion(...rest).normalize()) < 1e-4, `${node.getName()} is upright`);
      else assert.ok(new Vector3(...value).distanceTo(new Vector3(...rest)) < 1e-5, `${node.getName()} keeps rest ${path}`);
    }
  }
  for (const name of [...models].filter((n) => n.startsWith('parts/armor_'))) for (const suffix of ['', '_lod1']) {
    const doc = await io.read(fileURLToPath(new URL(`../public/models/generals/${name}${suffix}.glb`, import.meta.url)));
    const skin = restSkin(doc);
    let boots = 0;
    for (let v = 0; v < skin.points.length; v++) {
      const weights = skin.weight.getElement(v, []);
      assert.ok(weights.every(Number.isFinite), `${name}: finite weights`);
      assert.ok(Math.abs(weights.reduce((a, b) => a + b, 0) - 1) < 2e-4, `${name}: normalized weights`);
      assert.ok(skin.points[v].toArray().every(Number.isFinite), `${name}: finite vertex`);
      if (skin.points[v].y < 0.17) {
        boots++;
        const indices = skin.joint.getElement(v, []);
        assert.ok(indices.every((j, k) => skin.joints[j].getName() !== 'Hip' || weights[k] < 1e-4), `${name}: boot follows leg`);
      }
    }
    assert.ok(boots > 0, `${name}: footwear exists`);
    applyFirstPose(doc, idle);
    const posed = restSkin(doc).points;
    for (let v = 0; v < skin.points.length; v++) if (skin.points[v].y < 0.17) assert.ok(posed[v].distanceTo(skin.points[v]) < 1e-4, `${name}: idle does not flip the sole`);
  }
});

function triangle(z = 0) {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute([0, 0, z, 1, 0, z, 0, 1, z], 3));
  geometry.setAttribute('skinIndex', new Uint16BufferAttribute(new Array(12).fill(0), 4));
  geometry.setAttribute('skinWeight', new Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4));
  return geometry;
}
function figure(material, z = 0) {
  const root = new Group();
  const bone = new Bone(); bone.name = 'Hip';
  const mesh = new SkinnedMesh(triangle(z), material);
  root.add(bone, mesh); root.updateMatrixWorld(true);
  mesh.bind(new Skeleton([bone]));
  return { root, mesh, bone };
}

await check('clothing follows the wearer skeleton, removes ghost bones, and preserves shared materials until release', () => {
  const bitmap = { closed: 0, close() { this.closed++; } };
  const texture = new Texture(bitmap);
  const first = new MeshBasicMaterial({ map: texture });
  const second = new MeshBasicMaterial({ color: 0x777777 });
  const wearer = figure(new MeshBasicMaterial());
  const armor = figure([first, second], 0.1);
  const orphan = new Mesh(armor.mesh.geometry, first);
  armor.root.add(orphan);
  const oldSkeleton = armor.mesh.skeleton;
  let disposedOld = 0, disposedGeometry = 0, disposedFirst = 0, disposedSecond = 0, disposedTexture = 0;
  oldSkeleton.dispose = () => { disposedOld++; };
  armor.mesh.geometry.addEventListener('dispose', () => disposedGeometry++);
  first.addEventListener('dispose', () => disposedFirst++);
  second.addEventListener('dispose', () => disposedSecond++);
  texture.addEventListener('dispose', () => disposedTexture++);
  M.dressIn(wearer.root, armor.root);
  assert.equal(armor.mesh.skeleton.bones[0], wearer.bone);
  assert.equal(wearer.root.children.filter((o) => o.isBone).length, 1);
  assert.equal(disposedOld, 1);
  assert.equal(disposedGeometry + disposedFirst + disposedSecond + disposedTexture + bitmap.closed, 0);
  wearer.bone.position.y = 0.25;
  wearer.root.updateMatrixWorld(true);
  const point = armor.mesh.getVertexPosition(0, new Vector3());
  near(point.y, 0.25); near(point.z, 0.1);
  M.free(wearer.root);
  assert.equal(disposedGeometry, 1); assert.equal(disposedFirst, 1); assert.equal(disposedSecond, 1);
  assert.equal(disposedTexture, 1); assert.equal(bitmap.closed, 1);
});

await check('multi-material clothing retains its parent decode transform when rebound', () => {
  const wearer = figure(new MeshBasicMaterial());
  const armor = figure(new MeshBasicMaterial());
  const decode = new Group();
  decode.position.set(0.12, 0.3, -0.08);
  decode.scale.set(0.4, 0.6, 0.5);
  armor.root.add(decode); decode.add(armor.mesh);
  armor.root.updateMatrixWorld(true);
  const before = armor.mesh.matrixWorld.clone();
  M.dressIn(wearer.root, armor.root);
  wearer.root.updateMatrixWorld(true);
  before.elements.forEach((value, index) => near(armor.mesh.matrixWorld.elements[index], value));
  assert.equal(armor.mesh.skeleton.bones[0], wearer.bone);
  M.free(wearer.root);
});

await check('a skeleton mismatch is rejected instead of mixing animated and orphan joints', () => {
  const wearer = figure(new MeshBasicMaterial());
  const armor = figure(new MeshBasicMaterial());
  armor.bone.name = 'OtherSkeleton';
  assert.throws(() => M.dressIn(wearer.root, armor.root), /OtherSkeleton/);
  assert.equal(armor.mesh.parent, armor.root);
  M.free(wearer.root); M.free(armor.root);
});

await check('the hwando stays 95 cm long after every body normalization scale', () => {
  for (const scale of [0.8, 1, 1.8, 2.2]) {
    const body = new Group(); body.scale.setScalar(scale);
    const forearm = new Bone(); forearm.name = 'R_Forearm';
    const hand = new Bone(); hand.name = 'R_Hand'; hand.position.x = 0.2;
    forearm.add(hand); body.add(forearm);
    const weapon = new Mesh(new BoxGeometry(1, 0.02, 0.03), new MeshBasicMaterial());
    M.grip(body, weapon);
    body.updateMatrixWorld(true);
    near(new Box3().setFromObject(weapon).getSize(new Vector3()).x, 0.95);
    M.free(body);
  }
});

await check('new weapon sockets preserve metre dimensions and select the actual bow hand', () => {
  for (const scale of [.8, 1, 1.8, 2.2]) for (const kind of ['sword', 'spear', 'bow']) {
    const body = new Group(); body.scale.setScalar(scale);
    for (const side of ['Right', 'Left']) {
      const fore = new Bone(); fore.name = `${side}ForeArm`;
      const hand = new Bone(); hand.name = `${side}Hand`; hand.position.x = side === 'Right' ? -.2 : .2;
      const socket = new Group(); socket.name = `socket_grip_${side.toLowerCase()}`;
      socket.position.x = side === 'Right' ? -.05 : .05;
      hand.add(socket); fore.add(hand); body.add(fore);
    }
    const weapon = new Mesh(new BoxGeometry(.02, 1, .03), new MeshBasicMaterial());
    M.holdWeapon(body, weapon, { id: `test_${kind}`, kind });
    body.updateMatrixWorld(true);
    const a = weapon.localToWorld(new Vector3(0, -.5, 0));
    const b = weapon.localToWorld(new Vector3(0, .5, 0));
    near(a.distanceTo(b), 1);
    assert.equal(weapon.parent.parent.name, `socket_grip_${kind === 'bow' ? 'left' : 'right'}`);
    M.free(body);
  }
});

console.log(`generals-model: ${passed} CPU regressions passed; no visual fit claim`);
