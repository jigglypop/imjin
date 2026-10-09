import { deviceMemoryGB, isIOS, isPhone, isTouchOnly } from './device';
import { recovery } from './recovery';

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
export type ParticleQuality = { keep: number; sort: boolean };
export type TerrainQuality = { mesh: number; triplanar: boolean; anisotropy: number; noise: number; texSize: 1024 | 2048 };
export type VegetationQuality = { grids: [number, number, number]; shadows: boolean };
export type OceanQuality = { segments: number; lights: number };
/**
 * `skipLod0` leaves out the full-detail GLB model and `baseColorOnly` the normal and roughness maps: the 2048 px textures
 * alone cost more memory than a phone has to spare. A model without its near level draws the 1024 px one up close.
 */
export type ShipLodQuality = { maxLod0: number; near: number; mid: number; skipLod0: boolean; baseColorOnly: boolean };

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
  /** Which prebuilt sky file to load. A phone screen is about 400 CSS px wide, so 2k shows the same sky there. */
  hdriSize: '2k' | '4k';
  /** Side length of the terrain ground textures: the 1k files hold a quarter of the memory. */
  terrainTexSize: 1024 | 2048;
  vegetationShadows: boolean;
  /** FFT waves need WebGPU compute. Cheap enough on tablets and PCs, left out on phones. */
  fft: boolean;
  /** The highest run-time level the frame-rate controller may climb to. Levels above it are for a manual pick only. */
  maxLevel: number;
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
    hdriSize: '4k',
    terrainTexSize: 2048,
    vegetationShadows: true,
    fft: true,
    maxLevel: 4,
    ships: { maxLod0: 28, near: 560, mid: 1900, skipLod0: false, baseColorOnly: false },
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
    hdriSize: '2k',
    terrainTexSize: 2048,
    vegetationShadows: true,
    fft: true,
    maxLevel: 3,
    ships: { maxLod0: 22, near: 480, mid: 1500, skipLod0: false, baseColorOnly: false },
    select: { dprCap: 1.5, antialias: true, mapSegments: 900 },
  },
  low: {
    terrainMesh: 640,
    oceanSegments: 240,
    fftN: 128,
    vegetationGrids: [100, 120, 140],
    shadowMap: 2048,
    msaa: 0,
    lights: 4,
    wakeResolution: 1024,
    anisotropy: 8,
    triplanar: true,
    noise: 0.75,
    hdriSize: '2k',
    terrainTexSize: 1024,
    vegetationShadows: false,
    fft: false,
    maxLevel: 2,
    ships: { maxLod0: 16, near: 420, mid: 1200, skipLod0: true, baseColorOnly: true },
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
const BASE_LEVELS: Level[] = [
  { label: '절전', dprCap: 0.8, cloud: { steps: 16, lightSteps: 2, divisor: 4, every: 3 }, particleKeep: 0.4, vegetationLite: true, shadowEvery: 8, refraction: false, bloomResolution: 0.25, bloomStrength: 0.18 },
  { label: '낮음', dprCap: 1, cloud: { steps: 24, lightSteps: 2, divisor: 4, every: 2 }, particleKeep: 0.6, vegetationLite: true, shadowEvery: 4, refraction: false, bloomResolution: 0.25, bloomStrength: 0.2 },
  { label: '보통', dprCap: 1.25, cloud: { steps: 32, lightSteps: 3, divisor: 3, every: 1 }, particleKeep: 0.8, vegetationLite: true, shadowEvery: 2, refraction: false, bloomResolution: 0.35, bloomStrength: 0.22 },
  { label: '높음', dprCap: 1.5, cloud: { steps: 48, lightSteps: 4, divisor: 2, every: 1 }, particleKeep: 1, vegetationLite: false, shadowEvery: 1, refraction: true, bloomResolution: 0.5, bloomStrength: 0.22 },
  { label: '화려', dprCap: 2, cloud: { steps: 64, lightSteps: 4, divisor: 2, every: 1 }, particleKeep: 1.25, vegetationLite: false, shadowEvery: 1, refraction: true, bloomResolution: 0.5, bloomStrength: 0.26 },
];
// After a second crash in a row the resolution drops below every level's own cap.
const RECOVERY_DPR_CAP = 0.6;
export const LEVELS: Level[] = recovery.step >= 2 ? BASE_LEVELS.map((l) => ({ ...l, dprCap: Math.min(l.dprCap, RECOVERY_DPR_CAP) })) : BASE_LEVELS;
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
// A battle that killed the previous page load starts at the lowest tier whatever the setting says.
const tier: EquipmentTier = recovery.step > 0 ? 'low' : equipmentSetting === 'auto' ? autoTier() : equipmentSetting;

// The second crash also cuts the number of ships drawn with the full model and turns the clouds off.
const RECOVERY_LOD0 = 4;
const baseEquipment = EQUIPMENT[tier];
const recovered = recovery.step >= 2;

/** Equipment for this page load. Resolved once at startup. */
export const equipment: Equipment & { tier: EquipmentTier; setting: EquipmentSetting; clouds: boolean } = {
  ...baseEquipment,
  ships: recovered ? { ...baseEquipment.ships, maxLod0: Math.min(baseEquipment.ships.maxLod0, RECOVERY_LOD0) } : baseEquipment.ships,
  clouds: !recovered,
  tier,
  setting: equipmentSetting,
};

/** Level setting for this page load. A recovering page pins the lowest level so the frame-rate controller cannot climb back into the memory it ran out of. */
export const levelSetting: LevelSetting = recovery.step > 0 ? 0 : readLevelSetting();

/** Where the frame-rate controller starts. PCs start at the top level and let it drop if needed. Others climb from the middle. */
export const startLevel = recovery.step > 0 ? 0 : tier === 'high' ? LEVEL_MAX : 2;

const WEBGPU_STORAGE_KEY = 'imjin.webgpu';

/** The player chose WebGPU in the settings (iOS only, where WebGL2 is the default). */
export function webgpuOptIn(): boolean {
  return readStored(WEBGPU_STORAGE_KEY) === '1';
}

export function saveWebgpuOptIn(on: boolean) {
  writeStored(WEBGPU_STORAGE_KEY, on ? '1' : '0');
}

function resolveWebGL(): boolean {
  const fromUrl = new URLSearchParams(location.search).get('webgl');
  if (fromUrl === '1') return true;
  if (fromUrl === '0') return false;
  if (recovery.step > 0) return true;
  // iOS Safari: WebGL2 is the path every WebKit test ran on. WebGPU there stays opt-in.
  return isIOS && !webgpuOptIn();
}

/** Whether the renderer is forced onto its WebGL2 backend. Desktop and Android keep WebGPU unless ?webgl=1 says otherwise. */
export const forceWebGL: boolean = resolveWebGL();
