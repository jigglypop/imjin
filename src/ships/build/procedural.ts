import type { BufferGeometry, MeshStandardMaterial } from 'three/webgpu';
import type { ShipKind } from '../../sim/types';
import type { ShipAnchors } from '../anchors';
import { atlasMaterial } from './atlasMaterial';
import { toGeometry } from './pack';
import { buildShip } from './ShipBuilder';

export type ProceduralModel = { lods: { geometry: BufferGeometry; source: MeshStandardMaterial }[]; anchors: ShipAnchors };

/** Builds the three LODs of a procedural ship and loads its atlas (its own, or its navy's). The vertex format is in pack.ts. */
export async function loadProcedural(kind: ShipKind, variant: number, omitDragonHead = false): Promise<ProceduralModel> {
  const built = buildShip(kind, variant, omitDragonHead);
  const source = await atlasMaterial(built.faction, kind);
  return { lods: built.lods.map((d) => ({ geometry: toGeometry(d), source })), anchors: built.anchors };
}
