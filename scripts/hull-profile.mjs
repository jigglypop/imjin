import { readFileSync } from 'node:fs';

function positions(file) {
  const buf = readFileSync(file);
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  const binStart = 20 + jsonLen + 8;
  const out = [];
  for (const mesh of json.meshes) {
    for (const prim of mesh.primitives) {
      const acc = json.accessors[prim.attributes.POSITION];
      const view = json.bufferViews[acc.bufferView];
      const offset = binStart + (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
      const stride = view.byteStride ?? 12;
      for (let i = 0; i < acc.count; i += 1) {
        const o = offset + i * stride;
        out.push([buf.readFloatLE(o), buf.readFloatLE(o + 4), buf.readFloatLE(o + 8)]);
      }
    }
  }
  const node = json.nodes.find((n) => n.mesh !== undefined);
  return { pts: out, node };
}

const pct = (arr, p) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};

for (const file of process.argv.slice(2)) {
  const { pts, node } = positions(file);
  let [minY, maxY] = [Infinity, -Infinity];
  for (const p of pts) {
    minY = Math.min(minY, p[1]);
    maxY = Math.max(maxY, p[1]);
  }
  const bins = 24;
  const rows = Array.from({ length: bins }, () => ({ x: [], z: [], n: 0 }));
  for (const p of pts) {
    const b = Math.min(bins - 1, Math.floor(((p[1] - minY) / (maxY - minY)) * bins));
    rows[b].x.push(p[0]);
    rows[b].z.push(p[2]);
    rows[b].n += 1;
  }
  console.log(file.split(/[\\/]/).pop(), 'rot', JSON.stringify(node?.rotation ?? null), 'h', (maxY - minY).toFixed(3));
  for (let b = 0; b < bins; b += 1) {
    const r = rows[b];
    const ex = (pct(r.x, 0.99) - pct(r.x, 0.01)).toFixed(3);
    const ez = (pct(r.z, 0.99) - pct(r.z, 0.01)).toFixed(3);
    console.log(`  ${(b / bins).toFixed(2)} n=${String(r.n).padStart(5)} x=${ex} z=${ez}`);
  }
}
