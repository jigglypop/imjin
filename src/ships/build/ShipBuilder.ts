import type { ShipKind } from '../../sim/types';
import { SHIP_SPECS } from '../../sim/catalog';
import { anchorsFor, PROCEDURAL_KINDS, type ShipAnchors } from '../anchors';
import type { Faction } from './atlas';
import type { Lod } from './common';
import { buildAtakebune } from './atakebune';
import { buildMingsmall } from './mingsmall';
import { buildMingship } from './mingship';
import { buildKobaya } from './kobaya';
import { buildSekibune } from './sekibune';
import { buildGeobukseon } from './geobukseon';
import { buildHyeopseon } from './hyeopseon';
import { bakeGrime } from './bake';
import type { MeshData } from './parts';
import { buildPanokseon } from './panokseon';

export const LOD_LEVELS: Lod[] = [0, 1, 2];

/** Kinds whose procedural model is finished and replaces the legacy GLB. */
export const isProcedural = (kind: ShipKind) => PROCEDURAL_KINDS.includes(kind);

export type BuiltShip = { lods: MeshData[]; anchors: ShipAnchors; faction: Faction };

function buildLod(kind: ShipKind, variant: number, lod: Lod): MeshData {
  switch (kind) {
    case 'panokseon':
      return buildPanokseon(variant, lod);
    case 'geobukseon':
      return buildGeobukseon(lod);
    case 'hyeopseon':
      return buildHyeopseon(lod);
    case 'atakebune':
      return buildAtakebune(variant, lod);
    case 'sekibune':
      return buildSekibune(variant, lod);
    case 'kobaya':
      return buildKobaya(lod);
    case 'mingship':
      return buildMingship(lod);
    case 'mingsmall':
      return buildMingsmall(lod);
    default:
      throw new Error(`no procedural model for ${kind}`);
  }
}

/** All three LODs of a model plus its anchors. Pure CPU work: runs in Node as well as in the browser. */
export function buildShip(kind: ShipKind, variant: number): BuiltShip {
  const anchors = anchorsFor(`${kind}#${variant}`);
  if (!anchors) throw new Error(`no anchors for ${kind}#${variant}`);
  const lods = LOD_LEVELS.map((l) => buildLod(kind, variant, l));
  bakeGrime(lods, anchors);
  return { lods, anchors, faction: SHIP_SPECS[kind].faction };
}
