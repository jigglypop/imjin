import type { ShipKind } from '../../sim/types';
import { PROCEDURAL_KINDS } from '../anchors';

const legacy = typeof location !== 'undefined' && new URLSearchParams(location.search).get('ships') === 'legacy';

/** Procedural model in use for this kind: finished kinds unless ?ships=legacy asks for the old GLB models. */
export const useProcedural = (kind: ShipKind) => !legacy && PROCEDURAL_KINDS.includes(kind);
