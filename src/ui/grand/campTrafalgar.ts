import { bannerPaint } from './buildingAtlas';
import type { PieceKind } from './campPieces';
import { banner, standard } from './campBuildings';
import type { Kit } from './kitParts';
import type { FactionId } from './types';

// The camps of the Trafalgar theatre are the kits already made: Britain's and France's on the European set of the Armada
// theatre (campEurope.ts: stone curtains, keeps and gun towers, slate and tile), Spain's on the Mediterranean set of the
// Lepanto theatre (campMediterranean.ts: whitewashed houses under clay tiles round a church). Only their flags are new.
//
// The European atlas's flag sheet (buildingAtlas.json, 'england') holds St George's cross, the Tudor colours, the cross
// of Burgundy and the arms of Castile; it has no Union flag of 1801, no tricolour and no Spanish ensign of 1785. Until it
// has them: Britain flies St George's red cross on white (the field of the White Ensign Nelson's fleet wore at
// Trafalgar), Spain the arms of Castile (the centre of its red and gold naval ensign), France the cross cloth dyed
// towards blue as a plain stand-in.

/** A navy of the Trafalgar theatre's flag in the European atlas's sheet (see the note above). */
export function trafalgarFlag(navy: Extract<FactionId, 'britain' | 'france' | 'spain1805'>) {
  if (navy === 'britain') return bannerPaint('england', 'england');
  if (navy === 'spain1805') return bannerPaint('england', 'castile');
  return bannerPaint('england', 'england', [0.5, 0.62, 1]);
}

/** The kits of the Trafalgar theatre's own pieces, merged into campBuildings.ts's catalogue. */
export const TRAFALGAR_KITS: Partial<Record<PieceKind, (k: Kit) => void>> = {
  gb_banner: (k) => banner(k, k.P('timber'), trafalgarFlag('britain'), 0, 6.4, 1.6, 1.1),
  fr_banner: (k) => banner(k, k.P('timber'), trafalgarFlag('france'), 0, 6.4, 1.6, 1.1),
  es_banner: (k) => banner(k, k.P('timber'), trafalgarFlag('spain1805'), 0, 6.4, 1.6, 1.1),
  gb_standard: (k) => standard(k, trafalgarFlag('britain'), k.P('stone')),
  fr_standard: (k) => standard(k, trafalgarFlag('france'), k.P('stone')),
  es_standard: (k) => standard(k, trafalgarFlag('spain1805'), k.P('stone')),
};
