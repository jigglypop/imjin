import {
  DataTexture,
  DataUtils,
  EquirectangularReflectionMapping,
  HalfFloatType,
  LinearFilter,
  RGBAFormat,
  Vector3,
} from 'three/webgpu';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import type { SkyInfo } from './atmosphere';

export type SkyPresetName = 'afternoon' | 'day' | 'sunset' | 'overcast' | 'night';

export type SkyPreset = {
  label: string;
  /** File name without size and extension: public/hdri/<file>_4k.hdr, and _2k.hdr from scripts/build-hdri.mjs. */
  file: string;
  exposure: number;
  brightness: number;
  fogDensity: number;
  minSunRatio: number;
  axisOffset: number;
  night: number;
};

export const SKY_PRESETS: Record<SkyPresetName, SkyPreset> = {
  afternoon: { label: '오후', file: 'table_mountain_1_puresky', exposure: 0.95, brightness: 1, fogDensity: 0.00007, minSunRatio: 12, axisOffset: 1.15, night: 0 },
  day: { label: '한낮', file: 'kloofendal_48d_partly_cloudy_puresky', exposure: 0.95, brightness: 1.05, fogDensity: 0.00006, minSunRatio: 12, axisOffset: 1.3, night: 0 },
  sunset: { label: '노을', file: 'kloppenheim_06_puresky', exposure: 1.0, brightness: 0.8, fogDensity: 0.00009, minSunRatio: 9, axisOffset: 0.5, night: 0 },
  overcast: { label: '흐림', file: 'kloofendal_overcast_puresky', exposure: 1.0, brightness: 0.85, fogDensity: 0.00018, minSunRatio: 0, axisOffset: 1.15, night: 0 },
  night: { label: '달밤', file: 'qwantani_moonrise_puresky', exposure: 1.0, brightness: 0.085, fogDensity: 0.00011, minSunRatio: 5, axisOffset: 0.4, night: 1 },
};

const ENV_W = 1024;
const ENV_H = 512;
const SUN_CLIP_RADIUS = 0.16;

let halfTable: Float32Array | null = null;

function decodeTable() {
  if (halfTable) return halfTable;
  halfTable = new Float32Array(65536);
  for (let i = 0; i < 65536; i += 1) halfTable[i] = DataUtils.fromHalfFloat(i);
  return halfTable;
}

function dirFromUV(u: number, v: number, out: Vector3) {
  const phi = (u - 0.5) * Math.PI * 2;
  const theta = (v - 0.5) * Math.PI;
  return out.set(Math.cos(theta) * Math.cos(phi), Math.sin(theta), Math.cos(theta) * Math.sin(phi));
}

export type LoadedSky = {
  background: DataTexture;
  environment: DataTexture;
  info: SkyInfo;
};

/**
 * `size` picks the prebuilt file: the background is the file itself, the lighting is computed from a 1024x512 filter of it.
 * With `reuse` the new sky is written into the textures of the previous one instead of making new ones. The renderer
 * builds its filtered reflection maps (and the objects that hold them) per texture and never frees the ones of a
 * texture it has dropped, so a battle's sky must stay the same texture objects to leave nothing behind.
 */
export async function loadSky(preset: SkyPreset, size: '2k' | '4k' = '4k', reuse?: LoadedSky): Promise<LoadedSky> {
  const loader = new HDRLoader();
  loader.setDataType(HalfFloatType);
  const source = await loader.loadAsync(`/hdri/${preset.file}_${size}.hdr`);
  source.mapping = EquirectangularReflectionMapping;
  source.needsUpdate = true;
  const img = source.image as { data: Uint16Array; width: number; height: number };
  const table = decodeTable();
  const srcW = img.width;
  const srcH = img.height;
  const channels = img.data.length / (srcW * srcH);
  const fx = srcW / ENV_W;
  const fy = srcH / ENV_H;
  // Every other source pixel is enough from a 4k file. A 2k file has half as many to spare.
  const stride = Math.max(1, Math.floor(fx / 2));
  const env = new Float32Array(ENV_W * ENV_H * 4);
  for (let y = 0; y < ENV_H; y += 1) {
    const sy0 = Math.floor(y * fy);
    const sy1 = Math.max(sy0 + 1, Math.floor((y + 1) * fy));
    for (let x = 0; x < ENV_W; x += 1) {
      const sx0 = Math.floor(x * fx);
      const sx1 = Math.max(sx0 + 1, Math.floor((x + 1) * fx));
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let sy = sy0; sy < sy1; sy += stride) {
        for (let sx = sx0; sx < sx1; sx += stride) {
          const i = (sy * srcW + sx) * channels;
          r += table[img.data[i]!]!;
          g += table[img.data[i + 1]!]!;
          b += table[img.data[i + 2]!]!;
          n += 1;
        }
      }
      const o = (y * ENV_W + x) * 4;
      env[o] = r / n;
      env[o + 1] = g / n;
      env[o + 2] = b / n;
      env[o + 3] = 1;
    }
  }
  const dir = new Vector3();
  let maxL = 0;
  let maxIdx = 0;
  let ambR = 0;
  let ambG = 0;
  let ambB = 0;
  let ambW = 0;
  let horR = 0;
  let horG = 0;
  let horB = 0;
  let horW = 0;
  for (let y = 0; y < ENV_H; y += 1) {
    const v = 1 - (y + 0.5) / ENV_H;
    if (v < 0.5) continue;
    const lat = (v - 0.5) * Math.PI;
    const w = Math.cos(lat);
    for (let x = 0; x < ENV_W; x += 1) {
      const o = (y * ENV_W + x) * 4;
      const L = 0.2126 * env[o]! + 0.7152 * env[o + 1]! + 0.0722 * env[o + 2]!;
      if (L > maxL) {
        maxL = L;
        maxIdx = y * ENV_W + x;
      }
      const clamped = Math.min(L, 8);
      const s = L > 0 ? clamped / L : 0;
      ambR += env[o]! * s * w * Math.sin(lat + 0.05);
      ambG += env[o + 1]! * s * w * Math.sin(lat + 0.05);
      ambB += env[o + 2]! * s * w * Math.sin(lat + 0.05);
      ambW += w * Math.sin(lat + 0.05);
      if (v < 0.53) {
        horR += env[o]! * s;
        horG += env[o + 1]! * s;
        horB += env[o + 2]! * s;
        horW += 1;
      }
    }
  }
  const sunX = maxIdx % ENV_W;
  const sunY = Math.floor(maxIdx / ENV_W);
  const sunDir = dirFromUV((sunX + 0.5) / ENV_W, 1 - (sunY + 0.5) / ENV_H, new Vector3()).normalize();
  const skyAmbient = new Vector3(ambR / ambW, ambG / ambW, ambB / ambW);
  const horizon = new Vector3(horR / horW, horG / horW, horB / horW);
  const ambL = 0.2126 * skyAmbient.x + 0.7152 * skyAmbient.y + 0.0722 * skyAmbient.z;
  const clipL = Math.max(ambL * 3, 1e-3);
  const irr = new Vector3(0, 0, 0);
  const cosClip = Math.cos(SUN_CLIP_RADIUS);
  for (let y = 0; y < ENV_H; y += 1) {
    const v = 1 - (y + 0.5) / ENV_H;
    const lat = (v - 0.5) * Math.PI;
    const solid = (2 * Math.PI / ENV_W) * (Math.PI / ENV_H) * Math.cos(lat);
    for (let x = 0; x < ENV_W; x += 1) {
      dirFromUV((x + 0.5) / ENV_W, v, dir);
      if (dir.dot(sunDir) < cosClip) continue;
      const o = (y * ENV_W + x) * 4;
      const L = 0.2126 * env[o]! + 0.7152 * env[o + 1]! + 0.0722 * env[o + 2]!;
      if (L <= clipL) continue;
      const k = clipL / L;
      irr.x += env[o]! * (1 - k) * solid;
      irr.y += env[o + 1]! * (1 - k) * solid;
      irr.z += env[o + 2]! * (1 - k) * solid;
      env[o] = env[o]! * k;
      env[o + 1] = env[o + 1]! * k;
      env[o + 2] = env[o + 2]! * k;
    }
  }
  const sunPix = maxIdx * 4;
  const sunColor = new Vector3(env[sunPix]!, env[sunPix + 1]!, env[sunPix + 2]!);
  sunColor.divideScalar(Math.max(1e-6, 0.2126 * sunColor.x + 0.7152 * sunColor.y + 0.0722 * sunColor.z));
  const irrLum = 0.2126 * irr.x + 0.7152 * irr.y + 0.0722 * irr.z;
  const minLum = ambL * preset.minSunRatio;
  if (irrLum < minLum) irr.copy(sunColor).multiplyScalar(minLum);
  const half = new Uint16Array(ENV_W * ENV_H * 4);
  for (let y = 0; y < ENV_H; y += 1) {
    const src = y * ENV_W * 4;
    const dst = (ENV_H - 1 - y) * ENV_W * 4;
    for (let i = 0; i < ENV_W * 4; i += 1) half[dst + i] = DataUtils.toHalfFloat(env[src + i]!);
  }
  let environment: DataTexture;
  let background: DataTexture = source;
  const old = reuse?.background.image as { width: number; height: number } | undefined;
  if (reuse && old && old.width === srcW && old.height === srcH) {
    environment = reuse.environment;
    environment.image.data = half;
    environment.needsUpdate = true;
    environment.needsPMREMUpdate = true;
    background = reuse.background;
    background.image = source.image;
    background.needsUpdate = true;
  } else {
    environment = new DataTexture(half, ENV_W, ENV_H, RGBAFormat, HalfFloatType);
    environment.mapping = EquirectangularReflectionMapping;
    environment.magFilter = LinearFilter;
    environment.minFilter = LinearFilter;
    environment.flipY = false;
    environment.generateMipmaps = false;
    environment.needsUpdate = true;
  }
  return { background, environment, info: { sunDir, sunIrradiance: irr, skyAmbient, horizon, ambientLum: ambL } };
}
