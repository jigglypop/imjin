import type { FactionId, RegionView } from './types';

/**
 * Which commander's camp art a port shows (public/ui/camps/<id>-L<level>.webp, scripts/generate-camp-art.mjs). A seat
 * keeps its own picture only while its own navy holds it; any other owner gets that navy's shared camp.
 */
const CAMP_SEAT: Record<string, [art: string, faction: FactionId]> = {
  yeosu: ['yi', 'joseon'], geoje: ['won', 'joseon'], myeongnyang: ['eokgi', 'joseon'], hansan: ['kwon', 'joseon'],
  nokdo: ['jeongun', 'joseon'], bangdap: ['eo', 'joseon'], mokpo: ['anwi', 'joseon'],
  busan: ['wakisaka', 'japan'], angolpo: ['kuki', 'japan'], nagoya: ['kato', 'japan'], tsushima: ['konishi', 'japan'],
  dadaepo: ['todo', 'japan'], cheonseongpo: ['kurushima', 'japan'], jepo: ['shimazu', 'japan'],
  liaodong: ['chenlin', 'ming'], shandong: ['deng', 'ming'],
};
const SHARED_CAMP: Record<FactionId, string> = { joseon: 'admiral', japan: 'japan', ming: 'deng', england: 'england', spain: 'spain', holyleague: 'holyleague', ottoman: 'ottoman' };

export const campArt = (regionId: string, owner: FactionId) => {
  const seat = CAMP_SEAT[regionId];
  return seat && seat[1] === owner ? seat[0] : SHARED_CAMP[owner];
};

/** The camp's built level (0 when none stands), clamped to the pictures that exist. */
export function campLevel(region: RegionView) {
  const camp = region.buildings.find((b) => b.kind === 'camp');
  return camp ? Math.min(camp.level, camp.maxLevel) : 0;
}

export const campImage = (art: string, level: number) => `/ui/camps/${art}-L${level}.webp`;
