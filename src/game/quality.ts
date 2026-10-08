import { deviceMemoryGB, isPhone, isTouchOnly } from './device';

// Two kinds of quality settings.
//
//  1. Equipment (build time). Terrain mesh, ocean grid, FFT size, vegetation density, shadow map and MSAA are built
//     once when a battle loads. The equipment class follows the device. Changing it reloads the page.
//  2. Level (run time). Resolution, clouds, particles, vegetation detail, shadow refresh, refraction and bloom change
//     while the battle runs. A frame-rate controller (adaptive.ts) moves between the five levels.
//
// The simulation never reads any of these values. Every equipment class and level plays the same battle.

export type EquipmentTier = 'high' | 'medium' | 'low'; // high = PC, medium = tablet, low = phone
export type EquipmentSetting = 'auto' | EquipmentTier;

export type CloudQuality = { steps: number; lightSteps: number; divisor: number; every: number };
export type ParticleQuality = { keep: number; sort: boolean; noise: number };
export type TerrainQuality = { mesh: number; triplanar: boolean; anisotropy: number; noise: number };
export type VegetationQuality = { grids: [number, number, number]; shadows: boolean };
export type OceanQuality = { segments: number; lights: number };
export type ShipLodQuality = { maxLod0: number; near: number; mid: number };

export type Equipment = {
  terrainMesh: number;
  oceanSegments: number;
  fftN: number;
  vegetationGrids: [number, number, number];
  shadowMap: number;
  msaa: number;
  lights: number;
  wakeResolution: number;
  anisotropy: number;
  triplanar: boolean;
  noise: number;
  hdriDownscale: number;
  ships: ShipLodQuality;
  select: { dprCap: number; antialias: boolean; mapSegments: number };
};

const EQUIPMENT: Record<EquipmentTier, Equipment> = {
  high: {
    terrainMesh: 1024,
    oceanSegments: 400,
    fftN: 256,
    vegetationGrids: [200, 260, 300],
    shadowMap: 4096,
    msaa: 4,
    lights: 8,
    wakeResolution: 2048,
    anisotropy: 16,
    triplanar: true,
    noise: 1,
    hdriDownscale: 1,
    ships: { maxLod0: 28, near: 560, mid: 1900 },
    select: { dprCap: 2, antialias: true, mapSegments: 900 },
  },
  medium: {
    terrainMesh: 768,
    oceanSegments: 300,
    fftN: 256,
    vegetationGrids: [170, 220, 260],
    shadowMap: 2048,
    msaa: 2,
    lights: 6,
    wakeResolution: 2048,
    anisotropy: 8,
    triplanar: true,
    noise: 0.75,
    hdriDownscale: 1,
    ships: { maxLod0: 22, near: 480, mid: 1500 },
    select: { dprCap: 1.5, antialias: true, mapSegments: 900 },
  },
  low: {
    terrainMesh: 640,
    oceanSegments: 240,
    fftN: 128,
    vegetationGrids: [140, 160, 180],
    shadowMap: 2048,
    msaa: 0,
    lights: 4,
    wakeResolution: 1024,
    anisotropy: 8,
    triplanar: true,
    noise: 0.75,
    // A phone screen is about 400 CSS px wide. A half-resolution HDRI shows the same sky there.
    hdriDownscale: 2,
    ships: { maxLod0: 16, near: 420, mid: 1200 },
    select: { dprCap: 1.5, antialias: false, mapSegments: 450 },
  },
};

export type Level = {
  label: string;
  dprCap: number;
  cloud: CloudQuality;
  particleKeep: number;
  vegetationLite: boolean;
  shadowEvery: number;
  refraction: boolean;
  bloomResolution: number;
  bloomStrength: number;
};

// Level 3 matches the settings the game shipped with on PCs. Level 4 pushes resolution, cloud detail, particle density
// and bloom further. Anything that is built into the scene (terrain, ocean, vegetation density) stays at the equipment
// values, because it cannot be switched off at run time.
export const LEVELS: Level[] = [
  { label: '절전', dprCap: 0.8, cloud: { steps: 16, lightSteps: 2, divisor: 4, every: 3 }, particleKeep: 0.4, vegetationLite: true, shadowEvery: 8, refraction: false, bloomResolution: 0.25, bloomStrength: 0.18 },
  { label: '낮음', dprCap: 1, cloud: { steps: 24, lightSteps: 2, divisor: 4, every: 2 }, particleKeep: 0.6, vegetationLite: true, shadowEvery: 4, refraction: false, bloomResolution: 0.25, bloomStrength: 0.2 },
  { label: '보통', dprCap: 1.25, cloud: { steps: 32, lightSteps: 3, divisor: 3, every: 1 }, particleKeep: 0.8, vegetationLite: true, shadowEvery: 2, refraction: false, bloomResolution: 0.35, bloomStrength: 0.22 },
  { label: '높음', dprCap: 1.5, cloud: { steps: 48, lightSteps: 4, divisor: 2, every: 1 }, particleKeep: 1, vegetationLite: false, shadowEvery: 1, refraction: true, bloomResolution: 0.5, bloomStrength: 0.22 },
  { label: '화려', dprCap: 2, cloud: { steps: 64, lightSteps: 4, divisor: 2, every: 1 }, particleKeep: 1.25, vegetationLite: false, shadowEvery: 1, refraction: true, bloomResolution: 0.5, bloomStrength: 0.26 },
];
export const LEVEL_MAX = LEVELS.length - 1;

const EQUIPMENT_STORAGE_KEY = 'imjin.quality';
const LEVEL_STORAGE_KEY = 'imjin.level';
const EQUIPMENT_SETTINGS: readonly EquipmentSetting[] = ['auto', 'high', 'medium', 'low'];

export const EQUIPMENT_LABEL: Record<EquipmentSetting, string> = { auto: '자동', high: 'PC급', medium: '태블릿급', low: '폰급' };

function isEquipmentSetting(value: string | null): value is EquipmentSetting {
  return value !== null && (EQUIPMENT_SETTINGS as readonly string[]).includes(value);
}

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    // Storage can be blocked (private mode, site data disabled). Fall back to the defaults.
    return null;
  }
}

function writeStored(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Not persisted. The choice still applies to this page load.
  }
}

// `?q=` and `?lv=` win over the saved choices so a setting can be tested from a link.
function readEquipmentSetting(): EquipmentSetting {
  const fromUrl = new URLSearchParams(location.search).get('q');
  if (isEquipmentSetting(fromUrl)) return fromUrl;
  const stored = readStored(EQUIPMENT_STORAGE_KEY);
  return isEquipmentSetting(stored) ? stored : 'auto';
}

/** 'auto' lets the frame-rate controller choose. A number pins that level. */
export type LevelSetting = 'auto' | number;

function parseLevel(value: string | null): LevelSetting | null {
  if (value === 'auto') return 'auto';
  if (value === null || value === '') return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= LEVEL_MAX ? n : null;
}

function readLevelSetting(): LevelSetting {
  const fromUrl = parseLevel(new URLSearchParams(location.search).get('lv'));
  if (fromUrl !== null) return fromUrl;
  return parseLevel(readStored(LEVEL_STORAGE_KEY)) ?? 'auto';
}

export function saveEquipmentSetting(setting: EquipmentSetting) {
  writeStored(EQUIPMENT_STORAGE_KEY, setting);
}

export function saveLevelSetting(setting: LevelSetting) {
  writeStored(LEVEL_STORAGE_KEY, String(setting));
}

function autoTier(): EquipmentTier {
  if (isPhone) return 'low';
  if (isTouchOnly) return 'medium';
  return deviceMemoryGB !== undefined && deviceMemoryGB <= 4 ? 'medium' : 'high';
}

const equipmentSetting = readEquipmentSetting();
const tier: EquipmentTier = equipmentSetting === 'auto' ? autoTier() : equipmentSetting;

/** Equipment for this page load. Resolved once at startup. */
export const equipment: Equipment & { tier: EquipmentTier; setting: EquipmentSetting } = { ...EQUIPMENT[tier], tier, setting: equipmentSetting };

/** Level setting for this page load. */
export const levelSetting: LevelSetting = readLevelSetting();

/** Where the frame-rate controller starts. PCs start at the top level and let it drop if needed. Others climb from the middle. */
export const startLevel = tier === 'high' ? LEVEL_MAX : 2;
