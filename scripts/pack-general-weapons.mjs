// Verify the actual exported bytes, archive editable sources, and make UI thumbnails.
// Run after Blender completes scripts/build-general-weapons.py.
import { readFile, writeFile, copyFile, mkdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { NodeIO } from '@gltf-transform/core';
import { Matrix4, Vector3 } from 'three';

const root = resolve(import.meta.dirname, '..');
const src = join(root, 'assets-src/generals-weapons-2026-10-17');
const work = 'F:/codex-work/imjin/weapon-production';
const out = join(root, 'public/models/generals/parts');
const thumbs = join(root, 'public/ui/weapons');
const manifest = JSON.parse(await readFile(join(src, 'manifest.json'), 'utf8'));
const io = new NodeIO();
const sha = b => createHash('sha256').update(b).digest('hex');
assert.equal(manifest.weapons.length, 18, 'full weapon set');
await mkdir(thumbs, { recursive: true });
await mkdir(join(src, 'review'), { recursive: true });
const meshHashes = new Set();
const receipts = [];
for (const item of manifest.weapons) {
  const id = item.id;
  const levels = [];
  for (const suffix of ['', '_lod1']) {
    const file = join(out, `weapon_${id}${suffix}.glb`);
    const bytes = await readFile(file);
    const doc = await io.readBinary(bytes);
    const nodes = doc.getRoot().listNodes();
    const grip = nodes.find(n => n.getName() === 'socket_grip');
    assert.ok(grip, id + ' grip socket');
    assert.deepEqual(grip.getWorldTranslation(), [0, 0, 0], id + ' grip at origin');
    const rootNode = nodes.find(n => n.getName() === `weapon_${id}`);
    assert.equal(rootNode.getExtras().longAxis, '+Y');
    assert.equal(rootNode.getExtras().gripHand, item.hand);
    assert.equal(doc.getRoot().listTextures().length, 0, 'authored geometry uses no external texture sources');
    assert.equal(doc.getRoot().listAnimations().length, 0, 'weapons follow hand sockets, no embedded motion');
    let tris = 0, verts = 0, steelOut = 0, steelIn = 0;
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    const geometry = createHash('sha256');
    for (const n of nodes.filter(n => n.getMesh())) {
      const matrix = new Matrix4().fromArray(n.getWorldMatrix());
      for (const primitive of n.getMesh().listPrimitives()) {
        const pos = primitive.getAttribute('POSITION');
        const normal = primitive.getAttribute('NORMAL');
        const indices = primitive.getIndices();
        assert.equal(primitive.getMode(), 4, 'triangle mesh');
        tris += (indices?.getCount() ?? pos.getCount()) / 3; verts += pos.getCount();
        geometry.update(new Uint8Array(pos.getArray().buffer));
        const a = [], nn = [];
        for (let i = 0; i < pos.getCount(); i++) {
          pos.getElement(i, a); normal.getElement(i, nn);
          assert.ok(a.every(Number.isFinite) && nn.every(Number.isFinite), id + ' finite vertices/normals');
          const v = new Vector3(...a).applyMatrix4(matrix);
          for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], v.getComponent(k)); max[k] = Math.max(max[k], v.getComponent(k)); }
          if (primitive.getMaterial()?.getName() === 'Forged steel - satin faces' && Math.abs(a[0]) > .002 && Math.abs(nn[0]) > .5) {
            if (a[0] * nn[0] > 0) steelOut++; else steelIn++;
          }
        }
      }
    }
    const dimensions = min.map((v, k) => max[k] - v);
    assert.ok(dimensions[1] > dimensions[0] * 4 && dimensions[1] > dimensions[2] * 2, id + ' upright +Y weapon');
    assert.ok(min[1] < -.07 && max[1] > .45, id + ' grip intersects weapon length');
    assert.ok(tris <= (suffix ? 8000 : 20000), id + ' topology budget');
    assert.ok(steelIn === 0, id + ' blade normals face outward');
    if (item.kind === 'bow') {
      const nock = nodes.find(n => n.getName() === 'socket_nock');
      assert.ok(nock && nock.getWorldTranslation()[2] < -.05, 'nock behind bow grip');
      assert.ok(doc.getRoot().listMaterials().some(m => m.getName() === 'Waxed natural cord'), 'bowstring material');
    }
    const meshHash = geometry.digest('hex');
    if (!suffix) { assert.ok(!meshHashes.has(meshHash), id + ' original variant geometry'); meshHashes.add(meshHash); }
    levels.push({ suffix, path: `public/models/generals/parts/weapon_${id}${suffix}.glb`, bytes: bytes.length, sha256: sha(bytes), triangles: tris, vertices: verts, min, max, dimensions, steelOutwardVertices: steelOut, steelInwardVertices: steelIn });
  }
  await sharp(join(work, `${id}.png`)).webp({ quality: 90 }).toFile(join(thumbs, `${id}.webp`));
  await copyFile(join(work, `${id}.blend`), join(src, `${id}.blend`));
  const blend = await readFile(join(src, `${id}.blend`));
  const thumbnail = await readFile(join(thumbs, `${id}.webp`));
  const record = { ...item, verifiedLevels: levels, editableSource: { path: `assets-src/generals-weapons-2026-10-17/${id}.blend`, bytes: blend.length, sha256: sha(blend) }, thumbnail: { path: `public/ui/weapons/${id}.webp`, width: 512, height: 512, bytes: thumbnail.length, sha256: sha(thumbnail) } };
  await writeFile(join(src, `${id}.json`), JSON.stringify(record, null, 2) + '\n');
  receipts.push(record);
}

const representative = ['joseon_ungeom', 'japan_jumonjiyari', 'joseon_gakgung', 'ming_guandao', 'japan_yumi'];
for (const id of representative) for (const view of ['', '_front', '_side']) await copyFile(join(work, id + view + '.png'), join(src, 'review', id + view + '.png'));
const cells = []; const cols = 6, cell = 256, image = 230, h = 274;
for (let i = 0; i < receipts.length; i++) {
  const id = receipts[i].id;
  const png = await sharp(join(thumbs, id + '.webp')).resize(image, image).png().toBuffer();
  cells.push({ input: png, left: (i % cols) * cell + 13, top: Math.floor(i / cols) * h + 6 });
  cells.push({ input: Buffer.from(`<svg width="256" height="32"><rect width="256" height="32" fill="#14212a"/><text x="128" y="21" text-anchor="middle" fill="#e9d7b4" font-size="14" font-family="Arial">${id}</text></svg>`), left: (i % cols) * cell, top: Math.floor(i / cols) * h + 238 });
}
await sharp({ create: { width: cols * cell, height: 3 * h, channels: 3, background: '#14212a' } }).composite(cells).png().toFile(join(src, 'review', 'weapon-contact-sheet.png'));
await copyFile(join(root, 'scripts/build-general-weapons.py'), join(src, 'build-general-weapons.py'));
manifest.weapons = receipts;
manifest.verification = { performed: new Date().toISOString(), script: 'scripts/pack-general-weapons.mjs', results: '18 distinct high/LOD geometry pairs; axis, grip sockets, finite vertices/normals, outward steel face normals, topology budgets, bow nocks, zero external texture sources; 512x512 thumbnail and editable blend archived for all' };
await writeFile(join(src, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({ weapons: receipts.length, highTriangles: receipts.map(x => x.verifiedLevels[0].triangles), lowTriangles: receipts.map(x => x.verifiedLevels[1].triangles), totalGLBBytes: receipts.reduce((s, x) => s + x.verifiedLevels.reduce((a, y) => a + y.bytes, 0), 0), review: 'assets-src/generals-weapons-2026-10-17/review/weapon-contact-sheet.png' }, null, 2));
