import { createNoise2D } from './noise';
import type { TerrainSpec } from './generate';

export type StructureType = 'choga' | 'giwa' | 'fortgate' | 'bongsu';
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
  const maxVillages = 7;
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
    const count = 9 + Math.floor(rand() * 16);
    const radius = 70 + Math.sqrt(count) * 18;
    v.r = radius;
    let placed = 0;
    for (let tries = 0; tries < count * 14 && placed < count; tries += 1) {
      const a = rand() * Math.PI * 2;
      const r = Math.sqrt(rand()) * radius;
      const x = v.x + Math.cos(a) * r;
      const z = v.z + Math.sin(a) * r;
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
      const giwa = rand() < 0.2;
      structures.push({ type: giwa ? 'giwa' : 'choga', x, z, y: h, rot: Math.round((downhill + (rand() - 0.5) * 0.6) / (Math.PI / 2)) * (Math.PI / 2) + (rand() - 0.5) * 0.25, s: 0.9 + rand() * 0.2 });
      placed += 1;
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
    if (beacons.length >= 3) break;
    const w = toWorld(p.i, p.j);
    if (beacons.some((b) => Math.hypot(b.x - w.x, b.z - w.z) < 3500)) continue;
    beacons.push(w);
    structures.push({ type: 'bongsu', x: w.x, z: w.z, y: p.h, rot: rand() * Math.PI * 2, s: 1 });
  }

  if (villages.length) {
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
      let forest = smooth(3.5, 11, h) * (1 - smooth(0.5, 0.95, g)) * (1 - smooth(400, 520, h)) * smooth(-0.42, -0.12, patch);
      const shore = h > -3.5 && h < 3.5 ? 1 - Math.abs(h) / 3.5 : 0;
      const rocky = Math.max(shore * (0.25 + 0.75 * smooth(0.06, 0.35, g)) * smooth(-0.3, 0.4, noise(i * 0.08, j * 0.08)), smooth(0.85, 1.4, g) * (h > 0 ? 0.55 : 0));
      let field = 0;
      if (h > 1.5 && h < 42 && g < 0.11) {
        const w = toWorld(i, j);
        for (const vil of villages) {
          const d = Math.hypot(w.x - vil.x, w.z - vil.z);
          if (d < vil.r + 330) field = Math.max(field, 1 - smooth(vil.r + 120, vil.r + 330, d));
          if (d < vil.r + 30) forest = 0;
        }
      }
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
