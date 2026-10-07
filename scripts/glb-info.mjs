import { readFileSync } from 'node:fs';
for (const file of process.argv.slice(2)) {
  const buf = readFileSync(file);
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  const tris = (json.meshes ?? []).reduce((s, m) => s + m.primitives.reduce((t, p) => {
    const idx = p.indices !== undefined ? json.accessors[p.indices].count : json.accessors[p.attributes.POSITION].count;
    return t + idx / 3;
  }, 0), 0);
  const pos = json.meshes?.[0]?.primitives?.[0]?.attributes?.POSITION;
  const acc = pos !== undefined ? json.accessors[pos] : null;
  const imgs = (json.images ?? []).map((im) => `${im.mimeType}:${json.bufferViews[im.bufferView]?.byteLength}`);
  console.log(file.split('/').pop(), '| meshes', json.meshes?.length, '| nodes', json.nodes?.length, '| tris', Math.round(tris),
    '| mats', json.materials?.length, '| imgs', imgs.join(','), '| min', acc?.min?.map((v) => v.toFixed(2)).join(','), 'max', acc?.max?.map((v) => v.toFixed(2)).join(','),
    '| node0', JSON.stringify(json.nodes?.[0] ?? {}).slice(0, 160), '| ext', (json.extensionsUsed ?? []).join(','));
  const mat = json.materials?.[0];
  console.log('   mat0', JSON.stringify(mat).slice(0, 300));
}
