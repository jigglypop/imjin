import type { FactionId } from './types';

// The pieces the campaign map's settlements are made of, by kind: which navy's atlas each is built with, how much ground
// it covers and whether it is a stretch of wall or stands in the water. Light on purpose: the map's layout (mapWorld.ts,
// on phones too) reads it without the builders (campBuildings.ts).

/**
 * Unprefixed kinds are Joseon's or the Korean towns' (every port's town is Korean, whoever holds it), `wa_` Japanese,
 * `mg_` Ming; `pier` is every navy's landing. A camp is built from its navy's walls, gate and buildings; a region's works
 * (battery, shipyard, dock, granary, beacon) stand round it as districts in the style of whoever holds it.
 */
export type PieceKind =
  // Joseon camps
  | 'palisade' | 'stone' | 'jo_gate' | 'fortgate' | 'hall' | 'giwa' | 'choga' | 'magazine' | 'jo_tower' | 'jo_banner'
  // Japanese camps (wajo)
  | 'wa_fence' | 'wa_wall' | 'wa_gate' | 'wa_tower' | 'wa_keep3' | 'wa_tent' | 'wa_banner' | 'wa_hall'
  // Ming forts
  | 'mg_palisade' | 'mg_brick' | 'mg_gate' | 'mg_corner' | 'mg_watch' | 'mg_barracks' | 'mg_hall' | 'mg_flag' | 'mg_tent'
  | 'pier'
  // works, one of each per navy
  | 'jo_battery' | 'wa_battery' | 'mg_battery' | 'jo_yard' | 'wa_yard' | 'mg_yard' | 'jo_dock' | 'wa_dock' | 'mg_dock'
  | 'jo_granary' | 'wa_granary' | 'mg_granary' | 'jo_beacon' | 'wa_beacon' | 'mg_beacon'
  // the standard a navy flies over every camp and town it holds
  | 'jo_standard' | 'wa_standard' | 'mg_standard'
  // towns
  | 'doldam' | 'tree' | 'jeongja' | 'wa_house'
  // The Armada theatre (campEurope.ts): English and Spanish camps, works and towns on the European atlas, with each
  // navy's own banners and standard
  | 'eu_palisade' | 'eu_wall' | 'eu_gate' | 'eu_gatehouse' | 'eu_keep' | 'eu_bastion' | 'eu_hall' | 'eu_house' | 'eu_cottage'
  | 'eu_tent' | 'eu_church' | 'eu_hedge' | 'en_banner' | 'sp_banner'
  | 'eu_battery' | 'eu_yard' | 'eu_dock' | 'eu_granary' | 'eu_beacon' | 'en_standard' | 'sp_standard'
  // The Lepanto theatre (campMediterranean.ts): the European forts with Mediterranean towns, a church or a mosque, and
  // the Holy League's and the Ottomans' banners and standards
  | 'md_house' | 'md_cottage' | 'md_church' | 'ot_mosque' | 'md_granary' | 'hl_banner' | 'ot_banner' | 'hl_standard' | 'ot_standard'
  // The Trafalgar theatre (campTrafalgar.ts): the European and Mediterranean kits under Britain's, France's and Spain's
  // banners and standards
  | 'gb_banner' | 'fr_banner' | 'es_banner' | 'gb_standard' | 'fr_standard' | 'es_standard';

/** Metres of the world one settlement radius stands for: a house is about a quarter of a radius long. */
export const METRES_PER_RADIUS = 40;
/** The length a wall kind is modelled at; the map stretches each segment along its run to fit. */
export const WALL_METRES = 10;

/** The kinds that are one stretch of wall: they ring a camp or a yard and do not count as buildings. */
export const WALL_KINDS: ReadonlySet<PieceKind> = new Set<PieceKind>(['palisade', 'stone', 'wa_fence', 'wa_wall', 'mg_palisade', 'mg_brick', 'doldam', 'eu_palisade', 'eu_wall', 'eu_hedge']);
/** The kinds that stand in the water at sea level, their landward end on the shore. */
export const WATER_KINDS: ReadonlySet<PieceKind> = new Set<PieceKind>(['pier', 'jo_dock', 'wa_dock', 'mg_dock', 'jo_yard', 'wa_yard', 'mg_yard', 'eu_dock', 'eu_yard']);

/** The navy whose atlas a kind is built with. England's (the European set) serves both navies of the Armada theatre. */
export const navyOf = (kind: PieceKind): FactionId =>
  kind.startsWith('wa_') ? 'japan' : kind.startsWith('mg_') ? 'ming' : /^(eu|en|sp|md|hl|ot|gb|fr|es)_/.test(kind) ? 'england' : 'joseon';

/** Each navy's standard: a tall pole flying the navy's colour over what it holds, so whose a place is reads from afar. */
export const STANDARD: Record<FactionId, PieceKind> = { joseon: 'jo_standard', japan: 'wa_standard', ming: 'mg_standard', england: 'en_standard', spain: 'sp_standard', holyleague: 'hl_standard', ottoman: 'ot_standard', britain: 'gb_standard', france: 'fr_standard', spain1805: 'es_standard' };
export const STANDARD_KINDS: ReadonlySet<PieceKind> = new Set(Object.values(STANDARD));

/**
 * Half the ground each kind covers along x and z, in metres, eaves and steps included (a wall's x is half its modelled
 * length): the layout keeps buildings apart by these, and every kit stays inside its own.
 */
export const FOOTPRINT: Record<PieceKind, readonly [number, number]> = {
  palisade: [5, 1.9], stone: [5, 1.9], jo_gate: [3.9, 1.9], fortgate: [7.5, 4.9], hall: [10.6, 7.0], giwa: [6.5, 4.2], choga: [4.5, 3.0],
  magazine: [4.1, 3.5], jo_tower: [3.2, 3.5], jo_banner: [1.8, 0.2],
  wa_fence: [5, 0.2], wa_wall: [5, 2.6], wa_gate: [8.6, 4.6], wa_tower: [4.7, 4.7], wa_keep3: [6.9, 6.2], wa_tent: [2.4, 2.1],
  wa_banner: [1.4, 0.2], wa_hall: [8.6, 4.8],
  mg_palisade: [5, 0.7], mg_brick: [5, 2.1], mg_gate: [8.2, 5.4], mg_corner: [4.6, 4.6], mg_watch: [3.1, 3.1], mg_barracks: [8.0, 4.3],
  mg_hall: [9.9, 6.6], mg_flag: [1.8, 0.2], mg_tent: [2.4, 2.4],
  pier: [1.7, 7.1],
  jo_battery: [7.0, 4.6], wa_battery: [7.0, 4.6], mg_battery: [7.0, 4.6], jo_yard: [7.0, 11.8], wa_yard: [7.0, 11.8], mg_yard: [7.0, 11.8],
  jo_dock: [4.3, 9.6], wa_dock: [4.3, 9.6], mg_dock: [4.3, 9.6], jo_granary: [5.6, 3.8], wa_granary: [5.3, 3.6], mg_granary: [5.6, 4.1],
  jo_beacon: [4.5, 4.5], wa_beacon: [3.5, 3.5], mg_beacon: [3.5, 3.5],
  jo_standard: [2.7, 0.7], wa_standard: [2.0, 0.7], mg_standard: [2.7, 0.7],
  doldam: [5, 0.6], tree: [3.4, 3.4], jeongja: [3.8, 3.5], wa_house: [5.9, 4.1],
  eu_palisade: [5, 1.9], eu_wall: [5, 2.0], eu_gate: [3.9, 1.9], eu_gatehouse: [7.5, 4.9], eu_keep: [5.4, 5.4], eu_bastion: [5.0, 5.0],
  eu_hall: [9.4, 6.0], eu_house: [5.6, 3.8], eu_cottage: [4.6, 3.3], eu_tent: [2.4, 2.1], eu_church: [10.2, 4.0], eu_hedge: [5, 0.6],
  en_banner: [1.8, 0.2], sp_banner: [1.8, 0.2],
  eu_battery: [7.0, 4.6], eu_yard: [7.0, 11.8], eu_dock: [4.3, 9.6], eu_granary: [5.8, 3.9], eu_beacon: [3.5, 3.5],
  en_standard: [2.7, 0.7], sp_standard: [2.7, 0.7],
  md_house: [4.8, 3.5], md_cottage: [4.3, 3.2], md_church: [10.0, 4.0], ot_mosque: [6.6, 5.6], md_granary: [6.0, 4.0],
  hl_banner: [1.8, 0.2], ot_banner: [1.8, 0.2], hl_standard: [2.7, 0.7], ot_standard: [2.7, 0.7],
  gb_banner: [1.8, 0.2], fr_banner: [1.8, 0.2], es_banner: [1.8, 0.2], gb_standard: [2.7, 0.7], fr_standard: [2.7, 0.7], es_standard: [2.7, 0.7],
};
