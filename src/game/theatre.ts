import { Battle } from '../sim/battle';
import type { Faction, ShipKind } from '../sim/types';
import type { TerrainSpec } from '../terrain/generate';
import { DEFAULT_BIOME } from '../terrain/region';
import type { RegionDem } from '../terrain/regionDem';
import { loadDem } from '../select/terrain';
import { demMeta, MAP } from '../ui/grand/mapTheatre';
import { DEM_RECT } from '../ui/grand/mapMath';
import { project } from '../ui/grand/projection';
import type { BattleInfo } from '../sim/info';
import { SEASON_FOLIAGE, viewSeason } from './campaignSeason';

// The faction campaign's whole theatre as a battle scene, made the way a scenario's is: a TerrainSpec for the battle
// terrain pipeline (here a region ground cut from the theatre's DEM, scaled down to a battle map's size like a
// Civilization map), a Battle holding the ships the engine draws (one model for every five ships, drawn large as
// tokens), and the ports' works on the shore. Nothing is simulated (Engine.frozen).

/** World metres across the theatre's square terrain: a battle map's size. */
export const THEATRE_SIZE = 20000;
/** Heightmap texels per side: a quarter of a battle's, well inside a phone's budget. */
const RES = 1024;
/** Samples per side of the square ground cut from the DEM. */
const N = 768;
/** Metres of world per frame unit east-west (x) and north-south (v), and the frame point at the world's origin. */
const SPAN_ = Math.max(demMeta.width, demMeta.height);
export const METRES_PER_U = ((demMeta.width / SPAN_) * THEATRE_SIZE) / DEM_RECT.w;
export const METRES_PER_V = ((demMeta.height / SPAN_) * THEATRE_SIZE) / DEM_RECT.h;
export const ORIGIN_U = DEM_RECT.u + DEM_RECT.w / 2;
export const ORIGIN_V = DEM_RECT.v + DEM_RECT.h / 2;
/**
 * The relief, raised as the campaign map raises it (its exaggeration over the map's scale), so the strategic map's
 * markers, placed on its own ground, stand on this ground too.
 */
const RELIEF = (MAP.exaggeration * THEATRE_SIZE) / (SPAN_ * demMeta.metersPerPixel);
/** Ship models are drawn this many times their size, as tokens. */
export const TOKEN_SCALE = 4;
/** Historical ships each drawn ship stands for: 25 ships are drawn as 5. */
export const SHIPS_PER_MODEL = 5;

export type TheatrePort = {
  id: string;
  name: string;
  lon: number;
  lat: number;
  owner: Faction | null;
  /** Camp level (0 none) and the other works standing, for the models on the shore. */
  camp: number;
  works: ('shipyard' | 'battery' | 'magazine' | 'dock' | 'beacon')[];
};

export type TheatreFleet = {
  id: string;
  faction: Faction;
  /** Where it lies (lon, lat): a port, or along its lane. */
  lon: number;
  lat: number;
  kinds: ShipKind[];
};

/** The campaign seen in the battle's 3D. `onPick` hears a port picked in the view. */
export type TheatreSetup = {
  title: string;
  /** The player's navy: its fleets and its allies' are drawn as the battle's own side. */
  me: Faction;
  /** Navies at war with the player's. */
  foes: Faction[];
  month: number;
  ports: TheatrePort[];
  fleets: TheatreFleet[];
  onPick?: (portId: string) => void;
  /** 턴 종료 pressed in the view; the view closes after. */
  onEndTurn?: () => void;
};

const SPAN = Math.max(demMeta.width, demMeta.height);

/** World x, z of a frame point (projection.ts u east, v south): the DEM is centred in the square terrain. */
export function frameToWorld(u: number, v: number) {
  const fx = (u - DEM_RECT.u) / DEM_RECT.w, fz = (v - DEM_RECT.v) / DEM_RECT.h;
  return { x: (fx - 0.5) * (demMeta.width / SPAN) * THEATRE_SIZE, z: (fz - 0.5) * (demMeta.height / SPAN) * THEATRE_SIZE };
}

export const lonLatToWorld = (lon: number, lat: number) => {
  const p = project(lon, lat);
  return frameToWorld(p.u, p.v);
};

/** The theatre's ground: its DEM resampled into a square window, sea round the DEM, heights scaled to the map. */
export async function theatreSpec(signal: AbortSignal): Promise<TerrainSpec> {
  const { heights } = await loadDem(signal, { texture: false, url: MAP.dem, size: demMeta });
  const W = demMeta.width, H = demMeta.height;
  const out = new Float32Array(N * N);
  const ox = (SPAN - W) / 2, oy = (SPAN - H) / 2;
  // Bilinear, so the coast is a smooth line rather than nearest-texel stairs; land is lifted a few metres clear of the
  // sea so the shore reads as a beach edge instead of a wide tidal smear at this scale.
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= W || y >= H ? -20 : heights[y * W + x]!);
  for (let j = 0; j < N; j += 1) {
    for (let i = 0; i < N; i += 1) {
      const fx = ((i + 0.5) / N) * SPAN - ox - 0.5, fy = ((j + 0.5) / N) * SPAN - oy - 0.5;
      const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
      const h = (at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx) * (1 - ty) + (at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx) * ty;
      out[j * N + i] = h > 0 ? 4 + h * RELIEF : Math.max(-30, h * 0.5 - 6);
    }
  }
  // The DEM has lone spikes (a mast, a bad sample) that the raised relief turns into needles: a sample standing well
  // above all eight neighbours, or a lone dip below them, takes their mean. Two passes catch two-sample spikes.
  for (let pass = 0; pass < 2; pass += 1) {
    const src = out.slice();
    for (let j = 1; j < N - 1; j += 1) {
      for (let i = 1; i < N - 1; i += 1) {
        let hi = -Infinity, lo = Infinity, sum = 0;
        for (let dj = -1; dj <= 1; dj += 1) for (let di = -1; di <= 1; di += 1) {
          if (!di && !dj) continue;
          const v = src[(j + dj) * N + i + di]!;
          hi = Math.max(hi, v);
          lo = Math.min(lo, v);
          sum += v;
        }
        const v = src[j * N + i]!;
        if (v > hi + 12 || v < lo - 12) out[j * N + i] = sum / 8;
      }
    }
  }
  const dem: RegionDem = { n: N, cell: THEATRE_SIZE / N, heights: out };
  return { size: THEATRE_SIZE, res: RES, seed: 1592, shapes: [], channels: [], region: { id: `theatre-${MAP.id}`, biome: DEFAULT_BIOME, dem } };
}

/** What the engine stages: a scenario-like description with the sunset sky and the turn's season. */
export function theatreInfo(setup: TheatreSetup, terrain: TerrainSpec): BattleInfo {
  return {
    mode: 'conquest',
    id: `theatre-${MAP.id}`,
    title: setup.title,
    hanja: '',
    date: '',
    place: setup.title,
    season: '',
    sky: 'sunset',
    sea: 'calm',
    night: false,
    terrain,
    view: { tx: 0, tz: 0, dir: -Math.PI / 2, dist: 14000, pitch: 0.75 },
    foliage: SEASON_FOLIAGE[viewSeason(setup.month)],
  };
}

const MAIN_SHIP: Record<Faction, ShipKind> = { joseon: 'panokseon', japan: 'atakebune', ming: 'mingship', england: 'racegalleon', spain: 'spgalleon', holyleague: 'galea', ottoman: 'kadirga', britain: 'gb74', france: 'fr74', spain1805: 'es74' };

/**
 * The fleets as ships at rest: one model for every five ships (largest kinds first), in rows off their place, each on
 * water (`land` is the terrain's height, under 0 at sea).
 */
export function theatreBattle(setup: TheatreSetup, land: (x: number, z: number) => number, has: (kind: ShipKind) => boolean = () => true): Battle {
  const b = new Battle(1592, 'historical');
  b.humans.clear();
  const gap = 34 * TOKEN_SCALE * 0.55;
  for (const f of setup.fleets) {
    const at = lonLatToWorld(f.lon, f.lat);
    const kinds = f.kinds.length ? f.kinds : [MAIN_SHIP[f.faction]];
    const count = Math.max(1, Math.ceil(kinds.length / SHIPS_PER_MODEL));
    const loaded = kinds.filter(has);
    const pool = loaded.length ? loaded : has(MAIN_SHIP[f.faction]) ? [MAIN_SHIP[f.faction]] : [];
    if (!pool.length) continue;
    const drawn = Array.from({ length: count }, (_, i) => pool[Math.floor((i * pool.length) / count)]!);
    // The nearest open water off the place, out to a few kilometres.
    let best = at;
    if (land(at.x, at.z) > -2) {
      search: for (let r = 200; r <= 3000; r += 200) {
        for (let k = 0; k < 16; k += 1) {
          const a = (k / 16) * Math.PI * 2, x = at.x + Math.cos(a) * r, z = at.z + Math.sin(a) * r;
          if (land(x, z) < -3) { best = { x, z }; break search; }
        }
      }
    }
    const sq = b.addSquadron(setup.foes.includes(f.faction) ? 'japan' : 'joseon', f.id, '', '', '', 0);
    sq.faction = f.faction;
    const heading = Math.atan2(-best.x, -best.z);
    drawn.forEach((kind, i) => {
      const row = Math.floor(i / 4), col = (i % 4) - 1.5;
      const x = best.x + Math.cos(heading) * col * gap - Math.sin(heading) * row * gap;
      const z = best.z - Math.sin(heading) * col * gap - Math.cos(heading) * row * gap;
      const ship = b.addShip(kind, x, z, heading, '', sq, i === 0);
      ship.order = { type: 'hold' };
      ship.speed = 0;
    });
  }
  return b;
}
