import { BufferGeometry, InterleavedBuffer, InterleavedBufferAttribute, Uint16BufferAttribute, Uint32BufferAttribute } from 'three/webgpu';
import type { MeshData } from './parts';
import { SOOT_STEP } from './bake';

/**
 * A procedural model's vertex is 32 bytes in three buffers (it was 60, all float32). WebGPU allows 8 vertex buffers and
 * the ships' section-cut batch already spends 3 on instance data, so each buffer interleaves several attributes:
 *   float32  position (3), uv (2)           uv is in tile space and reaches +-25: it needs the precision
 *   snorm8   normal xyz, reef (a set sail's drop below its yard over REEF_RANGE; 0 for everything else)
 *   unorm8   color xyz, sway weight         tint x AO, sqrt-coded so dark vertices keep their steps
 *            mat: atlas cell * 16 + surface class, sway phase (16 bit over PHASE_RANGE), soot (the baked grime amount, 0..1)
 * The ships' material (ShipRenderer.createMaterial) and the campaign map's (mapLayer.ts, campMaterial.ts) read them back
 * with the same constants. Kept apart from the ship builder so the map can pack its buildings without loading it.
 */
export const TINT_RANGE = 4;
export const SWAY_RANGE = 1.5;
/** The sway phase is stored as 16 bits over [-PHASE_RANGE / 2, PHASE_RANGE / 2]. It cannot be wrapped to 2 pi: the shader uses it at two frequencies. */
export const PHASE_RANGE = 40;
/** Metres the reef byte spans: the tallest sail hangs about 20 m below its yard. */
export const REEF_RANGE = 24;

const unorm = (x: number) => Math.max(0, Math.min(255, Math.round(x * 255)));
const snorm = (x: number) => Math.max(-127, Math.min(127, Math.round(x * 127)));

export function toGeometry(d: MeshData) {
  const count = d.position.length / 3;
  const geo = new Float32Array(count * 5);
  const nrm = new Int8Array(count * 4);
  const col = new Uint8Array(count * 8);
  for (let i = 0; i < count; i += 1) {
    geo.set(d.position.subarray(i * 3, i * 3 + 3), i * 5);
    geo.set(d.uv.subarray(i * 2, i * 2 + 2), i * 5 + 3);
    // bakeGrime stores the soot as a fraction of SOOT_STEP on top of the whole-number surface class.
    const surf = Math.round(d.mat[i * 2 + 1]!);
    nrm[i * 4] = snorm(d.normal[i * 3]!);
    nrm[i * 4 + 1] = snorm(d.normal[i * 3 + 1]!);
    nrm[i * 4 + 2] = snorm(d.normal[i * 3 + 2]!);
    nrm[i * 4 + 3] = d.reef ? snorm(d.reef[i]! / REEF_RANGE) : 0;
    for (let k = 0; k < 3; k += 1) col[i * 8 + k] = unorm(Math.sqrt(d.color[i * 3 + k]! / TINT_RANGE));
    col[i * 8 + 3] = unorm(d.sway[i * 2]! / SWAY_RANGE);
    col[i * 8 + 4] = Math.round(d.mat[i * 2]!) * 16 + surf;
    const phase = Math.max(0, Math.min(65535, Math.round((d.sway[i * 2 + 1]! / PHASE_RANGE + 0.5) * 65535)));
    col[i * 8 + 5] = phase >> 8;
    col[i * 8 + 6] = phase & 255;
    col[i * 8 + 7] = unorm((d.mat[i * 2 + 1]! - surf) / SOOT_STEP);
  }
  const g = new BufferGeometry();
  const shape = new InterleavedBuffer(geo, 5);
  g.setAttribute('position', new InterleavedBufferAttribute(shape, 3, 0));
  g.setAttribute('uv', new InterleavedBufferAttribute(shape, 2, 3));
  const normals = new InterleavedBuffer(nrm, 4);
  g.setAttribute('normal', new InterleavedBufferAttribute(normals, 4, 0, true));
  // The same four bytes under a name of their own, read for the reef in w: the normal reaches the shader as a vec3.
  g.setAttribute('reef', new InterleavedBufferAttribute(normals, 4, 0, true));
  const bytes = new InterleavedBuffer(col, 8);
  g.setAttribute('color', new InterleavedBufferAttribute(bytes, 4, 0, true));
  g.setAttribute('mat', new InterleavedBufferAttribute(bytes, 4, 4, true));
  g.setIndex(count < 65535 ? new Uint16BufferAttribute(Uint16Array.from(d.index), 1) : new Uint32BufferAttribute(d.index, 1));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}
