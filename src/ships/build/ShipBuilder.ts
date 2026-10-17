import type { ShipKind } from '../../sim/types';
import { SHIP_SPECS } from '../../sim/catalog';
import { anchorsFor, buildAnchorsFor, GEOBUK_SCALE, PROCEDURAL_KINDS, type ShipAnchors } from '../anchors';
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
import { buildSailShip } from './galleon';
import { buildGalleass } from './galleass';

export const LOD_LEVELS: Lod[] = [0, 1, 2];

/** Kinds whose procedural model is finished and replaces the legacy GLB. */
export const isProcedural = (kind: ShipKind) => (PROCEDURAL_KINDS as readonly ShipKind[]).includes(kind);

export type BuiltShip = { lods: MeshData[]; anchors: ShipAnchors; faction: Faction };

function buildLod(kind: ShipKind, variant: number, lod: Lod, omitDragonHead: boolean): MeshData {
  switch (kind) {
    case 'panokseon':
      return buildPanokseon(variant, lod);
    case 'geobukseon':
      return buildGeobukseon(lod, omitDragonHead);
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
    case 'racegalleon':
    case 'spgalleon':
    case 'urca':
    case 'pinnace':
    case 'fireship':
      return buildSailShip(kind, variant, lod);
    case 'galleass':
    case 'vgalleass':
    case 'reale':
    case 'galea':
    case 'sultana':
    case 'kadirga':
    case 'kalyata':
      return buildGalleass(lod, kind);
    default:
      throw new Error(`no procedural model for ${kind}`);
  }
}

/** All three LODs of a model plus its anchors. Pure CPU work: runs in Node as well as in the browser. */
export function buildShip(kind: ShipKind, variant: number, omitDragonHead = false): BuiltShip {
  const anchors = anchorsFor(`${kind}#${variant}`);
  if (!anchors) throw new Error(`no anchors for ${kind}#${variant}`);
  const lods = LOD_LEVELS.map((l) => buildLod(kind, variant, l, omitDragonHead));
  bakeGrime(lods, buildAnchorsFor(`${kind}#${variant}`)!);
  if (kind === 'geobukseon') for (const lod of lods) for (let i = 0; i < lod.position.length; i++) lod.position[i]! *= GEOBUK_SCALE;
  return { lods, anchors, faction: SHIP_SPECS[kind].faction as Faction };
}
