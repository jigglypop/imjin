import { createNoise2D } from './noise';

export type LandShape = {
  x: number;
  z: number;
  rx: number;
  rz: number;
  rot: number;
  peak: number;
  rough: number;
};

export type TerrainSpec = {
  size: number;
  res: number;
  seed: number;
  shapes: LandShape[];
  channels: { x0: number; z0: number; x1: number; z1: number; width: number }[];
  bays?: { x: number; z: number; rx: number; rz: number; rot: number }[];
};

export const HANSAN_TERRAIN: TerrainSpec = {
  size: 20000,
  res: 2048,
  seed: 1592,
  shapes: [
    { x: -2600, z: -8600, rx: 8200, rz: 5200, rot: 0.08, peak: 540, rough: 1 },
    { x: 6200, z: -5200, rx: 3600, rz: 3400, rot: -0.3, peak: 470, rough: 1 },
    { x: 7600, z: 2600, rx: 3900, rz: 6200, rot: 0.15, peak: 560, rough: 1 },
    { x: -3300, z: 3300, rx: 1700, rz: 1050, rot: 0.35, peak: 290, rough: 0.9 },
    { x: -5600, z: 1200, rx: 1100, rz: 700, rot: -0.5, peak: 180, rough: 0.8 },
    { x: 1450, z: 2050, rx: 300, rz: 230, rot: 0.4, peak: 70, rough: 0.6 },
    { x: -1900, z: -1700, rx: 230, rz: 170, rot: 0.9, peak: 55, rough: 0.6 },
    { x: 2900, z: 3700, rx: 420, rz: 300, rot: -0.2, peak: 95, rough: 0.7 },
    { x: -4600, z: -600, rx: 520, rz: 380, rot: 0.2, peak: 130, rough: 0.7 },
    { x: 600, z: 4700, rx: 260, rz: 200, rot: 0.1, peak: 45, rough: 0.6 },
    { x: -800, z: -3300, rx: 380, rz: 260, rot: -0.6, peak: 80, rough: 0.7 },
  ],
  channels: [{ x0: 3000, z0: -2400, x1: 4400, z1: -9800, width: 900 }],
};

export const BUSAN_TERRAIN: TerrainSpec = {
  size: 18000,
  res: 2048,
  seed: 1593,
  shapes: [
    { x: 200, z: -6800, rx: 9800, rz: 5600, rot: 0.04, peak: 620, rough: 1 },
    { x: -6200, z: 1300, rx: 3000, rz: 3900, rot: -0.2, peak: 360, rough: 1 },
    { x: 2000, z: 2100, rx: 1750, rz: 1250, rot: 0.25, peak: 395, rough: 0.95 },
    { x: 6400, z: -1400, rx: 2400, rz: 2600, rot: 0.3, peak: 420, rough: 1 },
    { x: 5600, z: 2700, rx: 260, rz: 200, rot: 0, peak: 60, rough: 0.6 },
    { x: 6200, z: 3100, rx: 220, rz: 170, rot: 0.3, peak: 50, rough: 0.6 },
    { x: -2600, z: 3600, rx: 380, rz: 260, rot: 0.5, peak: 70, rough: 0.6 },
  ],
  channels: [],
};

export const MYEONGNYANG_TERRAIN: TerrainSpec = {
  size: 18000,
  res: 2048,
  seed: 1597,
  shapes: [
    { x: -600, z: -4650, rx: 8200, rz: 4400, rot: 0.05, peak: 380, rough: 1 },
    { x: 600, z: 4650, rx: 8200, rz: 4400, rot: 0.05, peak: 420, rough: 1 },
    { x: -7400, z: -900, rx: 900, rz: 600, rot: 0.3, peak: 90, rough: 0.7 },
    { x: 7600, z: 1200, rx: 800, rz: 500, rot: -0.4, peak: 80, rough: 0.7 },
  ],
  channels: [{ x0: -9000, z0: 0, x1: 9000, z1: 0, width: 330 }],
};

export const OKPO_TERRAIN: TerrainSpec = {
  size: 16000,
  res: 2048,
  seed: 1594,
  shapes: [
    { x: -5600, z: 0, rx: 5000, rz: 7800, rot: 0, peak: 520, rough: 1 },
    { x: -500, z: -1900, rx: 1400, rz: 800, rot: 0.15, peak: 230, rough: 0.9 },
    { x: -400, z: 2300, rx: 1500, rz: 760, rot: -0.12, peak: 210, rough: 0.9 },
    { x: 2600, z: -1500, rx: 280, rz: 190, rot: 0.4, peak: 60, rough: 0.6 },
    { x: 3500, z: 2100, rx: 330, rz: 230, rot: -0.3, peak: 75, rough: 0.6 },
    { x: 1700, z: 3600, rx: 520, rz: 360, rot: 0.2, peak: 110, rough: 0.7 },
  ],
  channels: [],
  bays: [{ x: -1300, z: 250, rx: 1500, rz: 950, rot: 0.1 }],
};

export const SACHEON_TERRAIN: TerrainSpec = {
  size: 16000,
  res: 2048,
  seed: 1595,
  shapes: [
    { x: 0, z: -6400, rx: 9200, rz: 4500, rot: 0.03, peak: 480, rough: 1 },
    { x: -3800, z: -1000, rx: 1700, rz: 1400, rot: 0.3, peak: 260, rough: 0.9 },
    { x: 3400, z: -1500, rx: 1800, rz: 1150, rot: -0.25, peak: 300, rough: 0.9 },
    { x: -1700, z: 3200, rx: 1150, rz: 700, rot: 0.2, peak: 180, rough: 0.8 },
    { x: 2600, z: 3500, rx: 820, rz: 520, rot: -0.4, peak: 140, rough: 0.7 },
    { x: 800, z: 1500, rx: 240, rz: 170, rot: 0.6, peak: 50, rough: 0.6 },
  ],
  channels: [],
  bays: [{ x: -300, z: -2700, rx: 1000, rz: 1500, rot: 0.05 }],
};

export const DANGPO_TERRAIN: TerrainSpec = {
  size: 16000,
  res: 2048,
  seed: 1596,
  shapes: [
    { x: -3400, z: -5400, rx: 7000, rz: 4300, rot: 0.15, peak: 420, rough: 1 },
    { x: 4300, z: -1300, rx: 2700, rz: 1900, rot: -0.2, peak: 430, rough: 1 },
    { x: 200, z: 3700, rx: 1400, rz: 820, rot: 0.1, peak: 220, rough: 0.8 },
    { x: -3600, z: 2300, rx: 900, rz: 600, rot: -0.3, peak: 150, rough: 0.8 },
    { x: 1700, z: 900, rx: 260, rz: 180, rot: 0.5, peak: 55, rough: 0.6 },
  ],
  channels: [],
  bays: [{ x: -1300, z: -2000, rx: 950, rz: 850, rot: 0.3 }],
};

export const ANGOLPO_TERRAIN: TerrainSpec = {
  size: 16000,
  res: 2048,
  seed: 1598,
  shapes: [
    { x: 0, z: -5800, rx: 9600, rz: 4300, rot: -0.04, peak: 520, rough: 1 },
    { x: -2500, z: -1500, rx: 1500, rz: 950, rot: 0.25, peak: 240, rough: 0.9 },
    { x: 2800, z: -1400, rx: 1600, rz: 1050, rot: -0.2, peak: 260, rough: 0.9 },
    { x: 5600, z: 1900, rx: 2400, rz: 2300, rot: 0.1, peak: 460, rough: 1 },
    { x: -3300, z: 2600, rx: 700, rz: 450, rot: 0.4, peak: 110, rough: 0.7 },
  ],
  channels: [],
  bays: [{ x: 200, z: -2100, rx: 820, rz: 1100, rot: 0 }],
};

export const CHILCHEON_TERRAIN: TerrainSpec = {
  size: 18000,
  res: 2048,
  seed: 1599,
  shapes: [
    { x: 5600, z: 0, rx: 4500, rz: 8400, rot: 0.04, peak: 560, rough: 1 },
    { x: -2700, z: -300, rx: 2300, rz: 3400, rot: -0.08, peak: 300, rough: 0.9 },
    { x: -6800, z: -5200, rx: 2600, rz: 2200, rot: 0.3, peak: 360, rough: 1 },
    { x: -1200, z: 5600, rx: 900, rz: 600, rot: 0.2, peak: 130, rough: 0.7 },
    { x: -800, z: -5800, rx: 700, rz: 520, rot: -0.2, peak: 120, rough: 0.7 },
  ],
  channels: [{ x0: 650, z0: -9000, x1: 650, z1: 9000, width: 620 }],
};

export const NORYANG_TERRAIN: TerrainSpec = {
  size: 18000,
  res: 2048,
  seed: 1600,
  shapes: [
    { x: 600, z: -5300, rx: 9800, rz: 4500, rot: 0.02, peak: 480, rough: 1 },
    { x: 0, z: 5200, rx: 9400, rz: 4400, rot: -0.03, peak: 540, rough: 1 },
    { x: -6800, z: -400, rx: 900, rz: 600, rot: 0.3, peak: 110, rough: 0.7 },
  ],
  channels: [{ x0: -9000, z0: 0, x1: 9000, z1: 0, width: 480 }],
  bays: [
    { x: -3600, z: 700, rx: 2500, rz: 1500, rot: 0.1 },
    { x: 5200, z: -300, rx: 2600, rz: 1300, rot: -0.1 },
  ],
};

function smoothMax(a: number, b: number, k: number) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.max(a, b) + h * h * k * 0.25;
}

function segmentDistance(px: number, pz: number, x0: number, z0: number, x1: number, z1: number) {
  const dx = x1 - x0;
  const dz = z1 - z0;
  const t = Math.max(0, Math.min(1, ((px - x0) * dx + (pz - z0) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(px - (x0 + dx * t), pz - (z0 + dz * t));
}

export function generateHeightmap(spec: TerrainSpec) {
  const { size, res } = spec;
  const noise = createNoise2D(spec.seed);
  const noiseB = createNoise2D(spec.seed + 101);
  const noiseC = createNoise2D(spec.seed + 977);
  const heights = new Float32Array(res * res);
  const fbm = (x: number, z: number, octaves: number) => {
    let a = 0.5;
    let f = 1;
    let sum = 0;
    for (let o = 0; o < octaves; o += 1) {
      sum += a * noise(x * f, z * f);
      f *= 2.03;
      a *= 0.5;
    }
    return sum;
  };
  const ridged = (x: number, z: number, octaves: number) => {
    let a = 0.55;
    let f = 1;
    let sum = 0;
    let weight = 1;
    for (let o = 0; o < octaves; o += 1) {
      const n = 1 - Math.abs(noiseB(x * f, z * f));
      const v = n * n * weight;
      weight = Math.min(1, v * 2);
      sum += v * a;
      f *= 2.1;
      a *= 0.5;
    }
    return sum;
  };
  const shapes = spec.shapes.map((s) => ({ ...s, c: Math.cos(s.rot), n: Math.sin(s.rot) }));
  const bays = (spec.bays ?? []).map((b) => ({ ...b, c: Math.cos(b.rot), n: Math.sin(b.rot) }));
  const half = size / 2;
  for (let j = 0; j < res; j += 1) {
    const z = -half + ((j + 0.5) / res) * size;
    for (let i = 0; i < res; i += 1) {
      const x = -half + ((i + 0.5) / res) * size;
      const wx = x + 520 * noiseC(x / 3400, z / 3400);
      const wz = z + 520 * noiseC(x / 3400 + 17.3, z / 3400 - 9.1);
      const coast = fbm(wx / 1100, wz / 1100, 5);
      let land = -1.5;
      let peak = 0;
      let rough = 1;
      for (const s of shapes) {
        const dx = wx - s.x;
        const dz = wz - s.z;
        const lx = (dx * s.c + dz * s.n) / s.rx;
        const lz = (-dx * s.n + dz * s.c) / s.rz;
        const d = Math.sqrt(lx * lx + lz * lz) + coast * 0.22 * (s.rx > 1500 ? 1 : 0.6);
        const v = 1 - d;
        if (v > land - 0.3) {
          const w = Math.max(0, Math.min(1, (v + 0.25) * 2));
          if (v > land) {
            peak = peak * (1 - w) + s.peak * w;
            rough = s.rough;
          }
        }
        land = smoothMax(land, v, 0.12);
      }
      for (const bay of bays) {
        const dx = wx - bay.x;
        const dz = wz - bay.z;
        const lx = (dx * bay.c + dz * bay.n) / bay.rx;
        const lz = (-dx * bay.n + dz * bay.c) / bay.rz;
        const d = Math.sqrt(lx * lx + lz * lz) + coast * 0.12;
        const carved = (d - 1) * 0.55;
        if (carved < land + 0.2) land = -smoothMax(-land, -carved, 0.16);
      }
      for (const ch of spec.channels) {
        const d = segmentDistance(wx, wz, ch.x0, ch.z0, ch.x1, ch.z1);
        const valley = ((d - ch.width) / (ch.width * 2.4)) * 0.55;
        if (valley < land + 0.2) land = -smoothMax(-land, -valley, 0.18);
      }
      let h: number;
      if (land > 0) {
        const inland = Math.min(1, land / 0.55);
        const ridge = ridged(wx / 2600, wz / 2600, 4);
        const swell = fbm(wx / 1500, wz / 1500, 5) * 0.5 + 0.5;
        const hills = fbm(wx / 520, wz / 520, 4);
        const base = Math.min(14, land * 120);
        const shape = Math.pow(inland, 1.15);
        const rise = shape * peak * 0.78 * (0.35 + 0.45 * swell + 0.3 * ridge * rough);
        h = base + rise + hills * 16 * Math.sqrt(inland);
        const cliff = Math.max(0, noise(wx / 700, wz / 700)) * Math.min(1, land * 10);
        h += cliff * 22 * (1 - inland);
      } else {
        const depth = Math.min(1, -land / 0.5);
        h = -1 - depth * 52 + fbm(wx / 500, wz / 500, 3) * 6 * depth;
        h = Math.min(h, land * 160);
      }
      heights[j * res + i] = h;
    }
  }
  return heights;
}
