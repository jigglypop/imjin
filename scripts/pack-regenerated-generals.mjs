// Package the NEW pilot only after local fitting; keep old/raw files intact.
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { io, simplify, LODS } from './lib/figure.mjs';
import { dedup, prune, textureCompress, quantize, meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';

const dest = 'public/models/generals/parts/v2';
const work = 'F:/codex-work/imjin-regeneration-fit';
mkdirSync(dest, { recursive: true });
const levels = {};
const selected = process.argv.slice(2);
for (const name of selected.length ? selected : ['body_yi', 'armor_joseon_dujeong']) {
  const input = join(work, `${name}.glb`);
  if (!existsSync(input)) throw new Error(`The new fitted source is missing: ${input}`);
  levels[name] = {};
  for (const lod of LODS) {
    const doc = await io.read(input);
    simplify(doc, lod.triangles, lod.error, lod.flags, lod.uv);
    await doc.transform(dedup(), prune({ keepLeaves: true }),
      textureCompress({ encoder: sharp, targetFormat: 'webp', slots: /^baseColor/, resize: [lod.base, lod.base], quality: 92 }),
      textureCompress({ encoder: sharp, targetFormat: 'webp', slots: /^(normal|metallicRoughness)/, resize: [lod.other, lod.other], quality: 90 }),
      quantize(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
    const path = join(dest, `${name}${lod.suffix}.glb`);
    await io.write(path, doc);
    const bytes = readFileSync(path);
    const triangles = doc.getRoot().listMeshes().reduce((n, m) => n + m.listPrimitives().reduce((s, p) => s + p.getIndices().getCount() / 3, 0), 0);
    levels[name][lod.suffix || 'high'] = { path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), triangles };
    console.log(JSON.stringify({ name, lod: lod.suffix || 'high', triangles, bytes: bytes.length }));
  }
}
const indexPath = 'public/models/generals/index.json';
const names = new Set(JSON.parse(readFileSync(indexPath, 'utf8')));
const catalog = JSON.parse(readFileSync('assets-src/generals-weapons-2026-10-17/manifest.json', 'utf8'));
for (const weapon of catalog.weapons) {
  const name = `parts/weapon_${weapon.id}`;
  if (!existsSync(`public/models/generals/${name}.glb`) || !existsSync(`public/models/generals/${name}_lod1.glb`)) throw new Error(`Weapon level missing: ${weapon.id}`);
  names.add(name);
}
for (const name of ['body_yi', 'armor_joseon_dujeong', 'helmet_joseon_dujeong']) {
  if (existsSync(join(dest, `${name}.glb`)) && existsSync(join(dest, `${name}_lod1.glb`))) names.add(`parts/v2/${name}`);
}
writeFileSync(indexPath, JSON.stringify([...names].sort()) + '\n');
const receiptPath = join(dest, 'provenance.json');
const previous = existsSync(receiptPath) ? JSON.parse(readFileSync(receiptPath, 'utf8')) : {};
writeFileSync(receiptPath, JSON.stringify({ ...previous, schema: 'imjin.regenerated-pilot-runtime.v1', model: 'meshy-7.1', providerCredits: 75, pilotOnly: true, fullWardrobeAccepted: false, levels: { ...previous.levels, ...levels } }, null, 2) + '\n');
