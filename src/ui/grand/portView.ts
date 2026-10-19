import type { TheatreFleet, TheatrePort, TheatreSetup } from '../../game/theatre';
import { dateOf } from '../../sim/grand/economy';
import { REGIONS } from '../../sim/grand/regions';
import { factionsOf } from '../../sim/grand/theatre';
import type { Grand, RegionId } from '../../sim/grand/types';
import { atWar } from '../../sim/grand/world';

// The campaign as the battle's 3D shows it (game/theatre.ts): every port on the map with its holder and works, and every
// fleet where it lies or along its lane. Light (no three.js): the campaign page builds it before the battle chunk loads.

const WORKS = new Set(['shipyard', 'battery', 'dock', 'beacon'] as const);

export function theatreSetupOf(g: Grand, title: string, onPick?: (id: string) => void): TheatreSetup {
  const me = g.player ?? factionsOf(g)[0]!;
  const ports: TheatrePort[] = (Object.entries(g.regions) as [RegionId, Grand['regions'][RegionId]][]).flatMap(([id, r]) => {
    const def = REGIONS[id];
    if (!def || def.edge) return [];
    const level = (k: string) => r.buildings.find((b) => b.kind === k)?.level ?? 0;
    return [{
      id,
      name: def.name,
      lon: def.lon,
      lat: def.lat,
      owner: r.owner,
      camp: level('camp'),
      works: r.buildings.filter((b) => b.level > 0 && WORKS.has(b.kind as never)).map((b) => b.kind as TheatrePort['works'][number]),
    }];
  });
  const fleets: TheatreFleet[] = g.fleets.flatMap((f) => {
    if (!f.ships.length) return [];
    let at = f.at ? REGIONS[f.at] : null;
    let lon = at?.lon ?? 0, lat = at?.lat ?? 0;
    if (!at && f.transit) {
      const a = REGIONS[f.transit.from], b = REGIONS[f.transit.to];
      if (!a || !b) return [];
      lon = (a.lon + b.lon) / 2;
      lat = (a.lat + b.lat) / 2;
      at = a;
    }
    if (!at || at.edge) return [];
    const kinds = f.ships.map((s) => s.kind);
    return [{ id: f.id, faction: f.faction, lon, lat, kinds }];
  });
  return {
    title,
    me,
    foes: factionsOf(g).filter((f) => atWar(g, f, me)),
    month: dateOf(g.turn, g).month,
    ports,
    fleets,
    onPick,
  };
}


/** The campaign as the map's 3D (TheatreCanvas) stages it: set by the campaign page whenever the campaign changes. */
let current: TheatreSetup | null = null;
export const theatreListeners = new Set<(s: TheatreSetup) => void>();
export const theatreNow = () => current;
export function setTheatreSetup(setup: TheatreSetup) {
  current = setup;
  for (const f of theatreListeners) f(setup);
}
