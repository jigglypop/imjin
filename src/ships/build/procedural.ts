import { BufferGeometry, InterleavedBuffer, InterleavedBufferAttribute, Uint16BufferAttribute, Uint32BufferAttribute, type MeshStandardMaterial } from 'three/webgpu';
import type { ShipKind } from '../../sim/types';
import type { ShipAnchors } from '../anchors';
import { atlasMaterial } from './atlasMaterial';
import type { MeshData } from './parts';
import { buildShip } from './ShipBuilder';

/**
 * WebGPU allows 8 vertex buffers and the section-cut batch already spends 4 on instance data, so all per-vertex
 * attributes share one interleaved buffer: position, normal, uv, color, mat, sway.
 */
const LAYOUT = [
  ['position', 3],
  ['normal', 3],
  ['uv', 2],
  ['color', 3],
  ['mat', 2],
  ['sway', 2],
] as const;

function toGeometry(d: MeshData) {
  const stride = LAYOUT.reduce((n, [, size]) => n + size, 0);
  const count = d.position.length / 3;
  const data = new Float32Array(count * stride);
  for (let i = 0; i < count; i += 1) {
    let o = i * stride;
    for (const [name, size] of LAYOUT) {
      const src = d[name];
      for (let k = 0; k < size; k += 1) data[o++] = src[i * size + k]!;
    }
  }
  const buffer = new InterleavedBuffer(data, stride);
  const g = new BufferGeometry();
  let offset = 0;
  for (const [name, size] of LAYOUT) {
    g.setAttribute(name, new InterleavedBufferAttribute(buffer, size, offset));
    offset += size;
  }
  g.setIndex(count < 65535 ? new Uint16BufferAttribute(Uint16Array.from(d.index), 1) : new Uint32BufferAttribute(d.index, 1));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

export type ProceduralModel = { lods: { geometry: BufferGeometry; source: MeshStandardMaterial }[]; anchors: ShipAnchors };

/** Builds the three LODs of a procedural ship and loads its faction atlas. */
export async function loadProcedural(kind: ShipKind, variant: number): Promise<ProceduralModel> {
  const built = buildShip(kind, variant);
  const source = await atlasMaterial(built.faction);
  return { lods: built.lods.map((d) => ({ geometry: toGeometry(d), source })), anchors: built.anchors };
}
