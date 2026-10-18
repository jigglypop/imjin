// Reads and writes the crew format (public/models/crew/<key>.bin, written by scripts/bake-crew.mjs) and draws a level
// of detail in its bind pose, front or side on, for pose references and reviews.
import sharp from 'sharp';

export function readCrew(buf) {
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const jl = new DataView(ab).getUint32(8, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(ab, 12, jl)));
  let off = 12 + jl;
  const take = (C, n, b) => {
    const o = new C(ab, off, n);
    off += n * b;
    off = (off + 3) & ~3;
    return o.slice();
  };
  const lods = header.lods.map((l) => ({
    pos: take(Float32Array, l.verts * 3, 4),
    nor: take(Int8Array, l.verts * 4, 1),
    uv: take(Float32Array, l.verts * 2, 4),
    jw: take(Uint8Array, l.verts * 8, 1),
    tint: take(Uint8Array, l.verts * 4, 1),
    index: take(Uint16Array, l.tris * 3 + ((l.tris * 3) % 2), 2).subarray(0, l.tris * 3),
  }));
  const anim = new Uint16Array(ab, off, header.frames * header.joints * 12).slice();
  return { header, lods, anim };
}

export function writeCrew({ header, lods, anim }) {
  const h = { ...header, lods: lods.map((l) => ({ verts: l.pos.length / 3, tris: l.index.length / 3 })) };
  const parts = [];
  for (const l of lods) {
    const index = new Uint16Array(l.index.length + (l.index.length % 2));
    index.set(l.index);
    parts.push(l.pos, l.nor, l.uv, l.jw, l.tint, index);
  }
  parts.push(anim);
  const json = Buffer.from(JSON.stringify(h));
  const pad = (4 - (json.length % 4)) % 4;
  const head = Buffer.alloc(12);
  head.write('CREW', 0, 'ascii');
  head.writeUInt32LE(1, 4);
  head.writeUInt32LE(json.length + pad, 8);
  // Every section is padded to four bytes, as readCrew and the game expect.
  const chunks = [head, json, Buffer.alloc(pad, 0x20)];
  for (const a of parts) {
    const b = Buffer.from(a.buffer, a.byteOffset, a.byteLength);
    chunks.push(b, Buffer.alloc((4 - (b.length % 4)) % 4));
  }
  return Buffer.concat(chunks);
}

/** Software render of a level in bind pose: view 'front' (from +Z), 'back' or 'side' (from +X); texture is raw RGBA. */
export async function renderLod(lod, tex, { view = 'front', size = 1024, background = [207, 208, 210], weapons = false } = {}) {
  const img = Buffer.alloc(size * size * 3);
  for (let i = 0; i < size * size; i += 1) img.set(background, i * 3);
  const zb = new Float32Array(size * size).fill(-Infinity);
  const n = lod.pos.length / 3;
  const scale = size / 1.9;
  const proj = (i) => {
    const x = lod.pos[i * 3], y = lod.pos[i * 3 + 1], z = lod.pos[i * 3 + 2];
    const [sx, sz] = view === 'front' ? [x, z] : view === 'back' ? [-x, -z] : [-z, x];
    return [size / 2 + sx * scale, size - (y + 0.1) * scale, sz];
  };
  const P = Array.from({ length: n }, (_, i) => proj(i));
  const light = view === 'side' ? [0.6, 0.5, 0.0] : [0.3, 0.5, 0.8];
  for (let t = 0; t < lod.index.length; t += 3) {
    const [a, b, c] = [lod.index[t], lod.index[t + 1], lod.index[t + 2]];
    if (!weapons && (lod.nor[a * 4 + 3] || lod.nor[b * 4 + 3])) continue;
    const [A, B, C] = [P[a], P[b], P[c]];
    const area = (B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0]);
    if (Math.abs(area) < 1e-9) continue;
    const x0 = Math.max(0, Math.floor(Math.min(A[0], B[0], C[0]))), x1 = Math.min(size - 1, Math.ceil(Math.max(A[0], B[0], C[0])));
    const y0 = Math.max(0, Math.floor(Math.min(A[1], B[1], C[1]))), y1 = Math.min(size - 1, Math.ceil(Math.max(A[1], B[1], C[1])));
    for (let y = y0; y <= y1; y += 1)
      for (let x = x0; x <= x1; x += 1) {
        const px = x + 0.5, py = y + 0.5;
        const w0 = ((B[0] - px) * (C[1] - py) - (B[1] - py) * (C[0] - px)) / area;
        const w1 = ((C[0] - px) * (A[1] - py) - (C[1] - py) * (A[0] - px)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const z = w0 * A[2] + w1 * B[2] + w2 * C[2];
        const k = y * size + x;
        if (z <= zb[k]) continue;
        zb[k] = z;
        let col = [180, 180, 180];
        if (tex) {
          const u = w0 * lod.uv[a * 2] + w1 * lod.uv[b * 2] + w2 * lod.uv[c * 2];
          const v = w0 * lod.uv[a * 2 + 1] + w1 * lod.uv[b * 2 + 1] + w2 * lod.uv[c * 2 + 1];
          const tx = Math.min(tex.w - 1, Math.max(0, Math.floor((u - Math.floor(u)) * tex.w)));
          const ty = Math.min(tex.h - 1, Math.max(0, Math.floor((v - Math.floor(v)) * tex.h)));
          const o = (ty * tex.w + tx) * tex.c;
          col = [tex.data[o], tex.data[o + 1], tex.data[o + 2]];
        }
        const nn = [0, 1, 2].map((q) => (w0 * lod.nor[a * 4 + q] + w1 * lod.nor[b * 4 + q] + w2 * lod.nor[c * 4 + q]) / 127);
        const nl = Math.hypot(...nn) || 1;
        const sh = view === 'back' ? [-nn[0], nn[1], -nn[2]] : nn;
        const d = Math.max(0, (sh[0] * light[0] + sh[1] * light[1] + sh[2] * light[2]) / nl);
        const f = 0.55 + 0.6 * d;
        img.set(col.map((v) => Math.min(255, v * f)), k * 3);
      }
  }
  return sharp(img, { raw: { width: size, height: size, channels: 3 } }).png().toBuffer();
}

export async function loadTexture(file) {
  const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height, c: info.channels };
}
