import { demMeta } from '../mapTheatre';
import { DEM_RECT } from '../mapMath';
import { LAYOUTS } from './layouts';
import { outside, inside, Plan, type Ground, type Pad } from './plan';
import { ELEVATION_MODEL, HERO_SITES, MODEL_METRE, siteUV, type HeroSite } from './site';
import { MAP_ASPECT } from '../projection';

// The land under the hero camps, shaped before the land is drawn (groundLand.ts calls `shapeLand` for every vertex of
// its facets): the ground is cut down to each levelled pad and to banks that climb from its edge, so no hill rises
// through a terrace; a fill pad keeps the land under it and stands on its retaining skirt. The camps' own ground (the
// smooth textured patch of ground.ts) lies over the drawn land, so inside a patch the facets also sink a little under it.
// The pads come from the layouts run on the DEM as loaded, kept here with the DEM round each site, so the camps built
// later stand on exactly the ground the land was cut to.

/** The steepest a cut bank climbs from a pad's edge (rise over run, model metres), after a level berm this wide. */
const BANK = { slope: 1.1, berm: 1.0 };
/** How far under a pad or bank the cut leaves the drawn land, model metres. */
const UNDER = 0.25;
/** How far the drawn land sinks under a camp's patch, model metres, and over what border it comes back up. */
const SINK = 0.35;
const SINK_EDGE = { inner: 26, outer: 8 };

interface Prepared {
  site: HeroSite;
  /** The DEM's metres round the site, as loaded: x0, y0 its first texel, w by h texels. */
  dem: { x0: number; y0: number; w: number; h: number; m: Float32Array };
  pads: Pad[];
}

const prepared = new Map<string, Prepared>();

/** The DEM texel coordinates of a frame point. */
const texel = (u: number, v: number) => ({ x: ((u - DEM_RECT.u) / DEM_RECT.w) * (demMeta.width - 1), y: ((v - DEM_RECT.v) / DEM_RECT.h) * (demMeta.height - 1) });

/** The natural ground round a prepared site in model metres at a point of its frame (bilinear over the DEM as loaded). */
function naturalOf(p: Prepared) {
  const { x0, y0, w, h, m } = p.dem;
  return (x: number, z: number) => {
    const { u, v } = siteUV(p.site, x, z);
    const t = texel(u, v);
    const fx = Math.max(0, Math.min(w - 1.001, t.x - x0)), fy = Math.max(0, Math.min(h - 1.001, t.y - y0));
    const i = Math.floor(fx), j = Math.floor(fy), a = fx - i, b = fy - j;
    const at = (ii: number, jj: number) => m[jj * w + ii]!;
    const top = at(i, j) + (at(i + 1, j) - at(i, j)) * a, bottom = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * a;
    return (top + (bottom - top) * b) * ELEVATION_MODEL;
  };
}

/**
 * Keeps the DEM round every hero site and lays its camp out on it for the pads. `heights` is the DEM's metres as loaded,
 * before the land's facets are drawn into it.
 */
export function prepareHeroGround(heights: Float32Array) {
  prepared.clear();
  const W = demMeta.width, H = demMeta.height;
  for (const site of HERO_SITES) {
    const margin = site.reach + 40;
    const lo = siteUV(site, -margin, -margin), hi = siteUV(site, margin, margin);
    const a = texel(lo.u, lo.v), b = texel(hi.u, hi.v);
    const x0 = Math.max(0, Math.floor(a.x)), y0 = Math.max(0, Math.floor(a.y));
    const x1 = Math.min(W - 1, Math.ceil(b.x)), y1 = Math.min(H - 1, Math.ceil(b.y));
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    const m = new Float32Array(w * h);
    for (let j = 0; j < h; j += 1) m.set(heights.subarray((y0 + j) * W + x0, (y0 + j) * W + x0 + w), j * w);
    const p: Prepared = { site, dem: { x0, y0, w, h, m }, pads: [] };
    const plan = new Plan(heroGround(p), site.navy);
    LAYOUTS[site.id]!(plan);
    p.pads = plan.pads;
    prepared.set(site.id, p);
  }
}

/** The ground a site's plans are laid out on: the DEM as loaded, water where it lies under the sea plane. */
function heroGround(p: Prepared): Ground {
  const natural = naturalOf(p);
  return { natural, water: (x, z) => natural(x, z) <= 0.02 };
}

/** The natural ground of a prepared hero site, or null before the land has loaded. */
export function heroGroundOf(id: string): Ground | null {
  const p = prepared.get(id);
  return p ? heroGround(p) : null;
}

/** The pads the land was cut to at a hero site. */
export const heroPads = (id: string) => prepared.get(id)?.pads ?? [];

/** How much the drawn land sinks under a site's patch at a point of its frame (model metres). */
export function sinkAt(site: HeroSite, x: number, z: number) {
  const d = site.reach - Math.max(Math.abs(x), Math.abs(z));
  if (d <= SINK_EDGE.outer) return 0;
  const t = Math.min(1, (d - SINK_EDGE.outer) / (SINK_EDGE.inner - SINK_EDGE.outer));
  return SINK * t * t * (3 - 2 * t);
}

/** The highest the cut leaves the ground at a point of a site's frame: a pad's level inside it, its banks round it. */
export function cutAt(pads: readonly Pad[], x: number, z: number) {
  for (let i = pads.length - 1; i >= 0; i -= 1) if (inside(pads[i]!.poly, x, z)) return pads[i]!.h0;
  let limit = Infinity;
  for (const pad of pads) {
    const d = outside(pad.poly, x, z);
    limit = Math.min(limit, pad.h0 + Math.max(0, d - BANK.berm) * BANK.slope);
  }
  return limit;
}

/**
 * A vertex of the land at frame point (u, v) standing `metres` high, as the hero camps want it drawn: its height cut to
 * the pads and banks (both the drawn land and the heights everything stands on), and how far the drawn facet sinks under
 * the camp's own ground besides (the facets only). Both in metres of the DEM.
 */
export function shapeLand(u: number, v: number, metres: number): { metres: number; sink: number } {
  let sink = 0;
  for (const p of prepared.values()) {
    const x = (u - p.site.u) / MODEL_METRE, z = (v - p.site.v) / (MODEL_METRE * MAP_ASPECT);
    if (Math.abs(x) > p.site.reach + 40 || Math.abs(z) > p.site.reach + 40) continue;
    const h = metres * ELEVATION_MODEL;
    const limit = cutAt(p.pads, x, z) - UNDER;
    if (h > limit) metres = limit / ELEVATION_MODEL;
    sink = Math.max(sink, sinkAt(p.site, x, z) / ELEVATION_MODEL);
  }
  return { metres, sink };
}

/** Whether any hero site is prepared: the land is shaped only then. */
export const heroGroundReady = () => prepared.size > 0;
