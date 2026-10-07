import { readFileSync } from 'node:fs';
function positions(file) {
  const buf = readFileSync(file);
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  const binStart = 20 + jsonLen + 8;
  const out = [];
  for (const mesh of json.meshes) for (const prim of mesh.primitives) {
    const acc = json.accessors[prim.attributes.POSITION];
    const view = json.bufferViews[acc.bufferView];
    const offset = binStart + (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
    const stride = view.byteStride ?? 12;
    for (let i = 0; i < acc.count; i += 1) {
      const o = offset + i * stride;
      out.push([buf.readFloatLE(o), buf.readFloatLE(o + 4), buf.readFloatLE(o + 8)]);
    }
  }
  return out;
}
const [file, axis, waterline] = process.argv.slice(2);
const pts = positions(file);
let minY = Infinity, maxY = -Infinity, minL = Infinity, maxL = -Infinity, minB = Infinity, maxB = -Infinity;
const L = (p) => (axis === 'x' ? p[0] : p[2]);
const B = (p) => (axis === 'x' ? p[2] : p[0]);
for (const p of pts) { minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); minL = Math.min(minL, L(p)); maxL = Math.max(maxL, L(p)); minB = Math.min(minB, B(p)); maxB = Math.max(maxB, B(p)); }
const H = maxY - minY, len = maxL - minL, beam = maxB - minB;
const cl = (minL + maxL) / 2, cb = (minB + maxB) / 2;
const bins = new Array(40).fill(0);
for (const p of pts) {
  const l = (L(p) - cl) / len, b = (B(p) - cb) / beam;
  if (Math.abs(b) > 0.22) continue;
  if (Math.abs(l) < 0.22 || Math.abs(l) > 0.44) continue;
  const yb = Math.floor(((p[1] - minY) / H) * 40);
  bins[Math.min(39, yb)] += 1;
}
const wl = Number(waterline);
const meters = (frac) => ((frac - wl) * H) / len;
console.log(file.split(/[\/]/).pop(), 'H/len', (H / len).toFixed(3));
bins.forEach((n, i) => { if (n > 0) console.log(`  ${(i / 40).toFixed(3)} n=${n} m/len=${meters(i / 40).toFixed(3)}`); });
