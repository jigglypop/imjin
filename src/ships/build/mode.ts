import type { ShipKind } from '../../sim/types';
import { modelKind, PROCEDURAL_KINDS } from '../anchors';

const legacy = typeof location !== 'undefined' && new URLSearchParams(location.search).get('ships') === 'legacy';

/** Procedural model in use for this kind (or the kind it is drawn with): finished kinds unless ?ships=legacy asks for the old GLB models. */
export const useProcedural = (kind: ShipKind) => !legacy && PROCEDURAL_KINDS.includes(modelKind(kind));
