// Read back the original candidate GLBs; archive their actual QA evidence.
import { NodeIO } from '@gltf-transform/core';
import { Matrix4, Vector3, Ray } from 'three';
import { readFile, writeFile, copyFile, mkdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import sharp from 'sharp';
import assert from 'node:assert/strict';

const root = resolve(import.meta.dirname, '..'), src = join(root, 'assets-src/generals-helmets-2026-10-17');
const dir = join(root, 'public/models/generals/parts/v2'), work = 'F:/codex-work/imjin/helmet-production';
const review = join(src, 'review'); await mkdir(review, { recursive: true });
const provenance = JSON.parse(await readFile(join(src, 'provenance.json'), 'utf8'));
const hash = b => createHash('sha256').update(b).digest('hex');
const sourceBody = join(root, 'assets-src/generals-regeneration-2026-10-17/raw/body/glb.glb');
const bodyHash = hash(await readFile(sourceBody));
assert.equal(bodyHash, '8c00ed3037e33c84ce3b1547ef9f4b216493e12c688abd33cb5f3ca46bf5da9c', 'new body source is byte-identical');
const levels = [];
for (const suffix of ['', '_lod1']) {
  const path = join(dir, `helmet_joseon_dujeong${suffix}.glb`), bytes = await readFile(path);
  const doc = await new NodeIO().readBinary(bytes), r = doc.getRoot();
  assert.equal(r.listSkins().length, 0); assert.equal(r.listAnimations().length, 0);
  assert.equal(r.listMeshes().length, 1, 'one batched mesh, rather than one draw call per rivet');
  const socket = r.listNodes().find(n => n.getName() === 'socket_helmet_brow');
  assert.deepEqual(socket.getWorldTranslation(), [0, 0, 0]);
  const helmet = r.listNodes().find(n => n.getName() === 'helmet_joseon_dujeong');
  assert.equal(helmet.getExtras().front, '+Z'); assert.equal(helmet.getExtras().up, '+Y');
  let triangles = 0, vertices = 0, frontOpeningVertices = 0, degenerateTriangles = 0;
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity], clothTriangles = [];
  for (const node of r.listNodes().filter(n => n.getMesh())) {
    const matrix = new Matrix4().fromArray(node.getWorldMatrix());
    for (const primitive of node.getMesh().listPrimitives()) {
      const pos = primitive.getAttribute('POSITION'), normal = primitive.getAttribute('NORMAL'), index = primitive.getIndices();
      assert.ok(pos && normal && primitive.getAttribute('TEXCOORD_0'));
      const world = [], temp = [];
      for (let i = 0; i < pos.getCount(); i++) {
        const v = new Vector3(...pos.getElement(i, temp)).applyMatrix4(matrix); world.push(v);
        assert.ok(v.toArray().every(Number.isFinite));
        normal.getElement(i, temp); assert.ok(temp.every(Number.isFinite)); assert.ok(Math.hypot(...temp) > .8 && Math.hypot(...temp) < 1.2, 'valid unit surface normals');
        for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], v.getComponent(k)); max[k] = Math.max(max[k], v.getComponent(k)); }
        if (Math.abs(v.x) < .065 && v.y > -.18 && v.y < -.06 && v.z > .025) frontOpeningVertices++;
      }
      triangles += index.getCount() / 3; vertices += pos.getCount();
      const indices = index.getArray();
      for (let i = 0; i < indices.length; i += 3) {
        const a = world[indices[i]], b = world[indices[i + 1]], c = world[indices[i + 2]];
        assert.ok(a && b && c, 'indices stay inside the actual vertex buffer');
        if (b.clone().sub(a).cross(c.clone().sub(a)).lengthSq() < 1e-20) degenerateTriangles++;
      }
      if (primitive.getMaterial().getName().includes('cotton brigandine')) {
        const a = index.getArray();
        for (let i = 0; i < a.length; i += 3) clothTriangles.push([world[a[i]], world[a[i + 1]], world[a[i + 2]]]);
        assert.equal(primitive.getMaterial().getAlphaMode(), 'OPAQUE');
      }
    }
  }
  assert.equal(frontOpeningVertices, 0, 'no curtain or plume occupies the central face opening');
  assert.equal(degenerateTriangles, 0, 'no collapsed cap/pole triangles');
  const cast = direction => {
    const ray = new Ray(new Vector3(0, -.12, 0), direction), hit = new Vector3();
    return clothTriangles.reduce((n, t) => n + (ray.intersectTriangle(...t, false, hit) ? 1 : 0), 0);
  };
  assert.equal(cast(new Vector3(0, 0, 1)), 0, 'face opening is open');
  const rearHits = cast(new Vector3(0, 0, -1)); assert.ok(rearHits > 0, 'rear curtain is real, opaque and closed behind the neck');
  assert.ok(triangles <= (suffix ? 11000 : 40000));
  const textures = [];
  for (const texture of r.listTextures()) {
    const metadata = await sharp(texture.getImage()).metadata();
    assert.ok(metadata.width <= 512 && metadata.height <= 512, 'small authored PBR maps');
    textures.push({ name: texture.getName(), width: metadata.width, height: metadata.height, bytes: texture.getImage().length });
  }
  levels.push({ path: `public/models/generals/parts/v2/helmet_joseon_dujeong${suffix}.glb`, bytes: bytes.length, sha256: hash(bytes), triangles, vertices, meshes: 1,
    materialPrimitives: r.listMeshes()[0].listPrimitives().length, min, max, dimensionsMeters: min.map((v, k) => max[k] - v), frontOpeningVertices, degenerateTriangles, rearClothRayHits: rearHits, textures });
}
const frames = ['helmet-front', 'helmet-left', 'helmet-back', 'helmet-right', 'helmet-three-quarter', 'fit-front', 'fit-left', 'fit-back', 'fit-right', 'fit-upper-body'];
for (const frame of frames) await copyFile(join(work, frame + '.png'), join(review, frame + '.png'));
for (const kind of ['helmet', 'fit']) {
  const cells = [];
  for (const [i, view] of ['front', 'left', 'back', 'right'].entries()) {
    const input = await sharp(join(review, `${kind}-${view}.png`)).resize(512, 512).png().toBuffer(); cells.push({ input, left: (i % 2) * 512, top: Math.floor(i / 2) * 512 });
  }
  await sharp({ create: { width: 1024, height: 1024, channels: 3, background: '#59616a' } }).composite(cells).png().toFile(join(review, `${kind}-four-view.png`));
}
await copyFile(join(root, 'scripts/build-general-joseon-helmet.py'), join(src, 'build-general-joseon-helmet.py'));
provenance.validation = { originalBodySha256After: bodyHash, levels, reviewFiles: frames.map(f => `assets-src/generals-helmets-2026-10-17/review/${f}.png`),
  validationBoundary: 'Static geometry/texture/socket checks and four-view standalone plus body-fit visual review. Preview uses temporary head scaling. Final rig attachment, cloth movement and browser acceptance remain required.' };
await writeFile(join(src, 'provenance.json'), JSON.stringify(provenance, null, 2) + '\n');
console.log(JSON.stringify({ candidate: true, levels: levels.map(({ path, bytes, triangles, materialPrimitives, dimensionsMeters }) => ({ path, bytes, triangles, materialPrimitives, dimensionsMeters })), originalBodyUnchanged: true, review: 'assets-src/generals-helmets-2026-10-17/review/fit-four-view.png' }, null, 2));
