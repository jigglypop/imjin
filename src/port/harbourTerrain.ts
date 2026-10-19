import type { TerrainSpec } from '../terrain/generate';
import type { BattleInfo } from '../sim/info';
import type { Faction, ShipKind } from '../sim/types';
import type { BuildingId } from '../meta/portDefs';

/**
 * The home port's ground, authored like a battle map (src/terrain/generate.ts ANGOLPO_TERRAIN): a sheltered bay with
 * the mainland behind the quay and a headland to either side. Small, so the heightmap is quick and cheap on a phone.
 */
export const HARBOUR_TERRAIN: TerrainSpec = {
  size: 7000,
  res: 1024,
  seed: 1604,
  shapes: [
    { x: 0, z: -2300, rx: 3600, rz: 2000, rot: 0, peak: 240, rough: 0.8 },
    { x: -1500, z: -250, rx: 650, rz: 1000, rot: 0.3, peak: 150, rough: 0.7 },
    { x: 1600, z: -150, rx: 750, rz: 1050, rot: -0.25, peak: 170, rough: 0.7 },
  ],
  channels: [],
  bays: [{ x: 0, z: 300, rx: 900, rz: 700, rot: 0 }],
};

/** How far along the quay (x, metres, from its middle) the port's works and moorings reach. */
export const QUAY_HALF = 170;

/**
 * The quay line: the most seaward land met when walking north from open water at points along the quay, so the
 * stone wall stands on the shore everywhere it runs.
 */
export function shoreLine(height: (x: number, z: number) => number): number {
  let shore = -Infinity;
  for (let x = -QUAY_HALF; x <= QUAY_HALF; x += 10) {
    for (let z = 600; z > -2000; z -= 4) {
      if (height(x, z) > 1.5) { shore = Math.max(shore, z); break; }
    }
  }
  return Number.isFinite(shore) ? shore : 0;
}

/** What the harbour shows: the navy's buildings at their levels and the hulls it owns, moored at the arsenal's quay. */
export type PortView = { nation: Faction; port: Record<BuildingId, number>; ships: Partial<Record<ShipKind, number>> };

/** The port as the Engine stages it: the harbour map under a sunset sky on a calm sea. */
export function portInfo(): BattleInfo {
  return {
    mode: 'conquest', id: 'port', art: 'angolpo', title: '본진', hanja: '本陣', date: '', place: '본진', season: '',
    sky: 'sunset', sea: 'calm', night: false, terrain: HARBOUR_TERRAIN,
    view: { tx: 0, tz: 0, dir: 0, dist: 340, pitch: 0.3 }, foliage: 0,
  };
}
