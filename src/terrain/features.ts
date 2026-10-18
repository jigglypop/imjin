import { createNoise2D } from './noise';
import type { TerrainSpec } from './generate';
import { DEFAULT_BIOME, type RegionBiome } from './region';

export type StructureType = 'choga' | 'giwa' | 'fortgate' | 'bongsu' | EuropeanStructure;
/** The procedural buildings of the 1588 coasts (src/terrain/europeKits.ts): English cottages and church, Flemish brick houses and church, hedgerows. */
export type EuropeanStructure = 'cottage' | 'tudor' | 'church' | 'gable' | 'spire' | 'hedge' | 'medhouse' | 'chapel' | 'flathouse' | 'mosque' | 'drywall';
/** The kits each coast style builds: its church (or mosque), its two kinds of house, its field boundary. */
export const STYLE_KITS: Record<NonNullable<RegionBiome['style']>, { temple: EuropeanStructure; house: [EuropeanStructure, EuropeanStructure]; bound: EuropeanStructure }> = {
  english: { temple: 'church', house: ['cottage', 'tudor'], bound: 'hedge' },
  flemish: { temple: 'spire', house: ['gable', 'gable'], bound: 'hedge' },
  greek: { temple: 'chapel', house: ['medhouse', 'medhouse'], bound: 'drywall' },
  maghreb: { temple: 'mosque', house: ['flathouse', 'flathouse'], bound: 'drywall' },
};
export type Structure = { type: StructureType; x: number; z: number; y: number; rot: number; s: number };
export type FeatureResult = { mask: Uint8Array; structures: Structure[] };

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function computeFeatures(spec: TerrainSpec, heights: Float32Array): FeatureResult {
  const { size, res } = spec;
  const biome = spec.region?.biome ?? spec.biome ?? DEFAULT_BIOME;
  const cell = size / res;
  const rand = mulberry32(spec.seed * 31 + 7);
  const noise = createNoise2D(spec.seed + 4242);
  const H = (i: number, j: number) => heights[Math.max(0, Math.min(res - 1, j)) * res + Math.max(0, Math.min(res - 1, i))]!;
  const grad = (i: number, j: number) => {
    const gx = (H(i + 1, j) - H(i - 1, j)) / (2 * cell);
    const gz = (H(i, j + 1) - H(i, j - 1)) / (2 * cell);
    return { gx, gz, g: Math.hypot(gx, gz) };
  };
  const toWorld = (i: number, j: number) => ({ x: -size / 2 + ((i + 0.5) / res) * size, z: -size / 2 + ((j + 0.5) / res) * size });
  const toCell = (x: number, z: number) => ({ i: Math.round(((x + size / 2) / size) * res - 0.5), j: Math.round(((z + size / 2) / size) * res - 0.5) });

  const S = 512;
  const step = res / S;
  const coast = new Float32Array(S * S);
  for (let j = 0; j < S; j += 1) for (let i = 0; i < S; i += 1) coast[j * S + i] = H(i * step, j * step) > 0.5 ? 1e9 : 0;
  const d1 = step * cell;
  const d2 = d1 * Math.SQRT2;
  for (let j = 0; j < S; j += 1)
    for (let i = 0; i < S; i += 1) {
      let v = coast[j * S + i]!;
      if (i > 0) v = Math.min(v, coast[j * S + i - 1]! + d1);
      if (j > 0) v = Math.min(v, coast[(j - 1) * S + i]! + d1);
      if (i > 0 && j > 0) v = Math.min(v, coast[(j - 1) * S + i - 1]! + d2);
      if (i < S - 1 && j > 0) v = Math.min(v, coast[(j - 1) * S + i + 1]! + d2);
      coast[j * S + i] = v;
    }
  for (let j = S - 1; j >= 0; j -= 1)
    for (let i = S - 1; i >= 0; i -= 1) {
      let v = coast[j * S + i]!;
      if (i < S - 1) v = Math.min(v, coast[j * S + i + 1]! + d1);
      if (j < S - 1) v = Math.min(v, coast[(j + 1) * S + i]! + d1);
      if (i < S - 1 && j < S - 1) v = Math.min(v, coast[(j + 1) * S + i + 1]! + d2);
      if (i > 0 && j < S - 1) v = Math.min(v, coast[(j + 1) * S + i - 1]! + d2);
      coast[j * S + i] = v;
    }
  const coastAt = (i: number, j: number) => coast[Math.max(0, Math.min(S - 1, Math.round(j / step))) * S + Math.max(0, Math.min(S - 1, Math.round(i / step)))]!;

  const reserve = spec.reserve ?? [];
  const reserved = (x: number, z: number, margin = 0) => reserve.some((r) => (r.x - x) ** 2 + (r.z - z) ** 2 < (r.r + margin) ** 2);
  const candidates: { i: number; j: number; score: number }[] = [];
  for (let j = 8; j < res - 8; j += 6) {
    for (let i = 8; i < res - 8; i += 6) {
      const h = H(i, j);
      if (h < 2.5 || h > 32) continue;
      const g = grad(i, j).g;
      if (g > 0.085) continue;
      const cd = coastAt(i, j);
      if (cd < 40 || cd > 520) continue;
      candidates.push({ i, j, score: (1 - g / 0.085) + rand() * 0.6 - Math.abs(cd - 170) / 700 });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const villages: { x: number; z: number; r: number }[] = [];
  const maxVillages = biome.villages;
  for (const c of candidates) {
    if (villages.length >= maxVillages) break;
    const w = toWorld(c.i, c.j);
    if (villages.some((v) => Math.hypot(v.x - w.x, v.z - w.z) < 1400)) continue;
    if (reserved(w.x, w.z, 450)) continue;
    villages.push({ x: w.x, z: w.z, r: 0 });
  }

  const structures: Structure[] = [];
  const houses: { x: number; z: number }[] = [];
  for (const v of villages) {
    const count = Math.round((9 + Math.floor(rand() * 16)) * biome.houses);
    const radius = 70 + Math.sqrt(count) * 18;
    v.r = radius;
    // A row of houses runs along the shore, so it needs the line the coast takes here.
    const { i: vi, j: vj } = toCell(v.x, v.z);
    const shoreA = Math.atan2(coastAt(vi, vj + 6) - coastAt(vi, vj - 6), coastAt(vi + 6, vj) - coastAt(vi - 6, vj)) + Math.PI / 2;
    const style = biome.style;
    if (style) {
      // A European village is gathered round its church: it stands on the flattest ground near the middle, the houses keep off it.
      let best: { x: number; z: number; g: number } | null = null;
      for (let k = 0; k < 12; k += 1) {
        const a = rand() * Math.PI * 2;
        const r = rand() * radius * 0.4;
        const x = v.x + Math.cos(a) * r;
        const z = v.z + Math.sin(a) * r;
        const { i, j } = toCell(x, z);
        const h = H(i, j);
        if (h < 2.5 || h > 48 || coastAt(i, j) < 40 || reserved(x, z)) continue;
        const g = grad(i, j).g;
        if (!best || g < best.g) best = { x, z, g };
      }
      if (best && best.g < 0.14) {
        const { i, j } = toCell(best.x, best.z);
        const g = grad(i, j);
        for (let k = 0; k < 4; k += 1) houses.push({ x: best.x + Math.cos(k * 1.57) * 12, z: best.z + Math.sin(k * 1.57) * 12 });
        houses.push({ x: best.x, z: best.z });
        structures.push({ type: STYLE_KITS[style].temple, x: best.x, z: best.z, y: H(i, j), rot: Math.round(Math.atan2(-g.gz, -g.gx) / (Math.PI / 2)) * (Math.PI / 2), s: 1 });
      }
    }
    let placed = 0;
    for (let tries = 0; tries < count * 14 && placed < count; tries += 1) {
      const a = rand() * Math.PI * 2;
      const r = Math.sqrt(rand()) * radius;
      let x = v.x + Math.cos(a) * r;
      let z = v.z + Math.sin(a) * r;
      if (biome.layout === 'row') {
        // The scatter stretched along the shore and squeezed across it.
        const along = Math.cos(a) * r * 1.8;
        const across = Math.sin(a) * r * 0.35;
        x = v.x + Math.cos(shoreA) * along - Math.sin(shoreA) * across;
        z = v.z + Math.sin(shoreA) * along + Math.cos(shoreA) * across;
      } else if (biome.layout === 'grid') {
        // Streets on a square grid, 22 m apart.
        x = v.x + Math.round((x - v.x) / 22) * 22;
        z = v.z + Math.round((z - v.z) / 22) * 22;
      }
      const { i, j } = toCell(x, z);
      const h = H(i, j);
      if (h < 2 || h > 48) continue;
      const g = grad(i, j);
      if (g.g > 0.16) continue;
      if (coastAt(i, j) < 22) continue;
      if (houses.some((p) => Math.hypot(p.x - x, p.z - z) < 17)) continue;
      if (reserved(x, z)) continue;
      houses.push({ x, z });
      const downhill = Math.atan2(-g.gz, -g.gx);
      const giwa = rand() < biome.tiled;
      const rot = Math.round((downhill + (rand() - 0.5) * 0.6) / (Math.PI / 2)) * (Math.PI / 2) + (rand() - 0.5) * 0.25;
      // The houses of a gridded town all face the street.
      const type: StructureType = style ? STYLE_KITS[style].house[giwa ? 0 : 1] : giwa ? 'giwa' : 'choga';
      structures.push({ type, x, z, y: h, rot: biome.layout === 'grid' ? Math.round(rot / (Math.PI / 2)) * (Math.PI / 2) : rot, s: 0.9 + rand() * 0.2 });
      placed += 1;
    }
    if (style) {
      // Hedgerows round the fields beyond the houses, each about 40 m of scrub along the slope's contour or across it.
      const hedges = Math.round(10 + rand() * 8);
      let made = 0;
      for (let k = 0; k < hedges * 4 && made < hedges; k += 1) {
        const a = rand() * Math.PI * 2;
        const r = radius + 50 + rand() * 260 * biome.fields * 0.5;
        const x = v.x + Math.cos(a) * r;
        const z = v.z + Math.sin(a) * r;
        const { i, j } = toCell(x, z);
        const h = H(i, j);
        if (h < 2 || h > 42 || coastAt(i, j) < 30 || reserved(x, z)) continue;
        const g = grad(i, j);
        if (g.g > 0.11) continue;
        // Field boundaries run on a grid of their own, turned to the village's shore.
        const rot = shoreA + (rand() < 0.5 ? 0 : Math.PI / 2) + (rand() - 0.5) * 0.2;
        structures.push({ type: STYLE_KITS[style].bound, x, z, y: h, rot: -rot, s: 0.8 + rand() * 0.5 });
        made += 1;
      }
    }
  }

  const peaks: { i: number; j: number; h: number }[] = [];
  for (let j = 16; j < res - 16; j += 8) {
    for (let i = 16; i < res - 16; i += 8) {
      const h = H(i, j);
      if (h < 90) continue;
      let top = true;
      for (let dj = -12; dj <= 12 && top; dj += 4) for (let di = -12; di <= 12; di += 4) if (H(i + di, j + dj) > h) top = false;
      if (top && coastAt(i, j) < 2600) peaks.push({ i, j, h });
    }
  }
  peaks.sort((a, b) => b.h - a.h);
  const beacons: { x: number; z: number }[] = [];
  for (const p of peaks) {
    if (beacons.length >= biome.beacons) break;
    const w = toWorld(p.i, p.j);
    if (beacons.some((b) => Math.hypot(b.x - w.x, b.z - w.z) < 3500)) continue;
    beacons.push(w);
    structures.push({ type: 'bongsu', x: w.x, z: w.z, y: p.h, rot: rand() * Math.PI * 2, s: 1 });
  }

  if (villages.length && !biome.style) {
    const main = villages[0]!;
    let best: { x: number; z: number; d: number } | null = null;
    for (let k = 0; k < 24; k += 1) {
      const a = (k / 24) * Math.PI * 2;
      const x = main.x + Math.cos(a) * (main.r + 90);
      const z = main.z + Math.sin(a) * (main.r + 90);
      const { i, j } = toCell(x, z);
      const h = H(i, j);
      if (h < 3 || h > 40 || grad(i, j).g > 0.12) continue;
      const d = coastAt(i, j);
      if (!best || d < best.d) best = { x, z, d };
    }
    if (best) {
      const { i, j } = toCell(best.x, best.z);
      const ang = Math.atan2(best.z - main.z, best.x - main.x);
      structures.push({ type: 'fortgate', x: best.x, z: best.z, y: H(i, j), rot: -ang, s: 1 });
    }
  }

  const N = 256;
  const patches = new Float32Array(N * N);
  for (let j = 0; j < N; j += 1)
    for (let i = 0; i < N; i += 1) {
      const x = ((i + 0.5) / N - 0.5) * size;
      const z = ((j + 0.5) / N - 0.5) * size;
      patches[j * N + i] = noise(x / 900, z / 900) * 0.65 + noise(x / 330, z / 330) * 0.35;
    }
  const patchAt = (u: number, v: number) => {
    const fx = u * N - 0.5;
    const fy = v * N - 0.5;
    const x0 = Math.max(0, Math.min(N - 2, Math.floor(fx)));
    const y0 = Math.max(0, Math.min(N - 2, Math.floor(fy)));
    const tx = Math.max(0, Math.min(1, fx - x0));
    const ty = Math.max(0, Math.min(1, fy - y0));
    const a = patches[y0 * N + x0]!;
    const b = patches[y0 * N + x0 + 1]!;
    const c = patches[(y0 + 1) * N + x0]!;
    const d = patches[(y0 + 1) * N + x0 + 1]!;
    return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
  };

  const mask = new Uint8Array(res * res * 4);
  for (let j = 0; j < res; j += 1) {
    for (let i = 0; i < res; i += 1) {
      const h = heights[j * res + i]!;
      const k = (j * res + i) * 4;
      if (h < -6) continue;
      const g = grad(i, j).g;
      const u = (i + 0.5) / res;
      const v = (j + 0.5) / res;
      const patch = patchAt(u, v);
      const sparse = (1 - biome.forest) * 0.8;
      let forest = smooth(3.5, 11, h) * (1 - smooth(0.5, 0.95, g)) * (1 - smooth(biome.canopyLine, biome.canopyLine + 120, h)) * smooth(-0.42 + sparse, -0.12 + sparse, patch);
      const shore = h > -3.5 && h < 3.5 ? 1 - Math.abs(h) / 3.5 : 0;
      const rocky = Math.min(1, biome.rocky * Math.max(shore * (0.25 + 0.75 * smooth(0.06, 0.35, g)) * smooth(-0.3, 0.4, noise(i * 0.08, j * 0.08)), smooth(0.85, 1.4, g) * (h > 0 ? 0.55 : 0)));
      // Stone shows through the woods.
      forest *= 1 - rocky * 0.7 * biome.rockLook;
      let field = 0;
      if (h > 1.5 && h < 42 && g < 0.11) {
        const w = toWorld(i, j);
        for (const vil of villages) {
          const d = Math.hypot(w.x - vil.x, w.z - vil.z);
          if (d < vil.r + 330 * biome.fields) field = Math.max(field, 1 - smooth(vil.r + 120 * biome.fields, vil.r + 330 * biome.fields, d));
          if (d < vil.r + 30) forest = 0;
        }
      }
      // Plains and tidal land are farmed well beyond the villages, wherever the ground is flat and a little above the water.
      // A European village keeps its woods off the houses on any slope, the churchyard and gardens included.
      if (biome.style && forest > 0) {
        const w = toWorld(i, j);
        for (const vil of villages) if (Math.hypot(w.x - vil.x, w.z - vil.z) < vil.r + 40) forest = 0;
      }
      if (biome.plain > 0 && h > 1.5 && h < 30 && g < 0.06 && coastAt(i, j) > 50) field = Math.max(field, biome.plain * smooth(-0.55, -0.05, patch) * (1 - smooth(18, 30, h)));
      if (field > 0) forest *= Math.max(0, 1 - field * 2.6);
      if (beacons.length) {
        const w = toWorld(i, j);
        for (const b of beacons) if (Math.hypot(w.x - b.x, w.z - b.z) < 45) forest = 0;
      }
      if (reserve.length && forest > 0) {
        const w = toWorld(i, j);
        if (reserved(w.x, w.z)) forest = 0;
      }
      mask[k] = Math.round(forest * 255);
      mask[k + 1] = Math.round(Math.max(0, Math.min(1, rocky)) * 255);
      mask[k + 2] = Math.round(field * 255);
      mask[k + 3] = 255;
    }
  }
  return { mask, structures };
}
