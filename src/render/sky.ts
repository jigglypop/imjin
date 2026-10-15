import { ClampToEdgeWrapping, DataTexture, DataUtils, EquirectangularReflectionMapping, HalfFloatType, LinearFilter, RepeatWrapping, RGBAFormat, Vector3 } from 'three/webgpu';
import type { SkyInfo } from './atmosphere';
import { Atmosphere, buildSkyView, DECK_TINT, hazeForFog, sampleSkyView, type Rgb } from './atmosphereModel';
import { coverAt, sampleWeather } from './cloudNoise';

export type SkyPresetName = 'afternoon' | 'day' | 'sunset' | 'overcast' | 'night';

/** The cloud layer a sky is drawn with. Heights in metres above the sea. */
export type CloudSpec = {
  /** Share of the sky the layer covers, before the weather map breaks it into masses and gaps. */
  coverage: number;
  base: number;
  top: number;
  /** Extinction per metre at full density: thin fair-weather cloud low, a rain-heavy deck high. */
  density: number;
};

export type SkyPreset = {
  label: string;
  /**
   * Bearing and height of the sun (of the moon at night) in radians, bearing 0 along +x turning toward +z. The bearings
   * are those of the photographed skies the battles were first laid out under, so every battle's map turns as before.
   */
  azimuth: number;
  elevation: number;
  exposure: number;
  brightness: number;
  fogDensity: number;
  /** The most the direct light may outshine the sky's average radiance; the game's materials were tuned to these ratios. */
  sunRatio: number;
  /** Share of the direct light the clouds let through on average: an overcast deck keeps most of it. */
  sunThrough: number;
  axisOffset: number;
  night: number;
  clouds: CloudSpec;
};

const deg = Math.PI / 180;

export const SKY_PRESETS: Record<SkyPresetName, SkyPreset> = {
  afternoon: { label: '오후', azimuth: 49.39 * deg, elevation: 15 * deg, exposure: 0.95, brightness: 1, fogDensity: 0.00007, sunRatio: 17, sunThrough: 1, axisOffset: 1.15, night: 0, clouds: { coverage: 0.42, base: 1300, top: 3500, density: 0.03 } },
  day: { label: '한낮', azimuth: 34.28 * deg, elevation: 48 * deg, exposure: 0.95, brightness: 1.05, fogDensity: 0.00006, sunRatio: 12, sunThrough: 1, axisOffset: 1.3, night: 0, clouds: { coverage: 0.38, base: 1500, top: 3800, density: 0.03 } },
  sunset: { label: '노을', azimuth: 38.5 * deg, elevation: 5 * deg, exposure: 1.0, brightness: 0.6, fogDensity: 0.00009, sunRatio: 9, sunThrough: 1, axisOffset: 0.5, night: 0, clouds: { coverage: 0.44, base: 1600, top: 3400, density: 0.03 } },
  overcast: { label: '흐림', azimuth: 29.71 * deg, elevation: 23 * deg, exposure: 1.0, brightness: 0.85, fogDensity: 0.00018, sunRatio: 0.9, sunThrough: 0.12, axisOffset: 1.15, night: 0, clouds: { coverage: 0.92, base: 1100, top: 2500, density: 0.045 } },
  night: { label: '달밤', azimuth: 36.04 * deg, elevation: 14 * deg, exposure: 1.0, brightness: 0.085, fogDensity: 0.00011, sunRatio: 14, sunThrough: 1, axisOffset: 0.4, night: 1, clouds: { coverage: 0.36, base: 1500, top: 3300, density: 0.03 } },
};

/** Texture sizes of a sky: the view behind everything and the environment the reflections and ambient light come from. */
export type SkySize = 'small' | 'large';
const SIZES: Record<SkySize, { view: [number, number]; env: [number, number] }> = {
  small: { view: [128, 96], env: [256, 128] },
  large: { view: [256, 128], env: [512, 256] },
};

export type LoadedSky = {
  /** The sky's radiance by direction, in the layout of atmosphereModel's sky view. */
  view: DataTexture;
  /** The same sky with its clouds and the sea below, as an equirectangular map for reflections and ambient light. */
  environment: DataTexture;
  info: SkyInfo;
};

export function lightDirection(preset: SkyPreset) {
  const c = Math.cos(preset.elevation);
  return new Vector3(c * Math.cos(preset.azimuth), Math.sin(preset.elevation), c * Math.sin(preset.azimuth));
}

const lum = (c: Rgb) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

/**
 * The clouds as the environment sees them: one sheet at the layer's middle height, opaque where the weather map gives
 * the layer cover, lit from above and fading into the air with distance. Close enough to the marched clouds for the
 * ambient light and the blurred reflections on the sea to agree with them.
 */
function cloudSheet(preset: SkyPreset, atmosphere: Atmosphere, sky: Rgb, dir: Rgb, zenith: Rgb, sun: Rgb, out: Rgb) {
  const c = preset.clouds;
  const mid = (c.base + c.top) * 0.5;
  const up = Math.max(dir[1], 0.012);
  const d = Math.min(90000, mid / up);
  const x = dir[0] * d;
  const z = dir[2] * d;
  const cover = coverAt(c.coverage, sampleWeather(x, z, 0));
  const alpha = Math.min(1, Math.max(0, (cover - 0.3) / 0.35)) * Math.min(1, (c.top - c.base) * c.density / 30);
  const L = atmosphere.light;
  const cosT = dir[0] * L[0] + dir[1] * L[1] + dir[2] * L[2];
  // The underside passes a third of the sunlight down diffusely, thin parts more; edges toward the sun glow with
  // forward scattering.
  const g = 0.6;
  const hg = (1 - g * g) / (4 * Math.PI * Math.pow(1 + g * g - 2 * g * cosT, 1.5));
  const diffuse = (Math.max(0.05, L[1]) * (0.3 + 0.3 * (1 - cover))) / Math.PI;
  const glow = hg * 0.35 * (1 - cover * 0.7);
  const haze = Math.exp(-d * preset.fogDensity * 0.45);
  const sunLum = lum(sun);
  for (let k = 0; k < 3; k += 1) {
    // What the droplets pass down has the clear sky's blue light on the layer's top mixed into the sunlight.
    const under = sun[k]! * 0.8 + sunLum * DECK_TINT[k]! * 0.2;
    const base = under * diffuse + sun[k]! * glow + zenith[k]! * 0.6;
    const seen = sky[k]! + (base - sky[k]!) * haze;
    out[k] = sky[k]! + (seen - sky[k]!) * alpha;
  }
  return out;
}

type BuiltSky = { view: Uint16Array; env: Uint16Array; viewSize: [number, number]; envSize: [number, number]; info: SkyInfo };

/** Integrates the preset's sky on the CPU: the view, the environment map and the light the scene is lit with. */
export function buildSky(preset: SkyPreset, size: SkySize): BuiltSky {
  const light = lightDirection(preset);
  const atmosphere = new Atmosphere({ light: [light.x, light.y, light.z], haze: hazeForFog(preset.fogDensity), direct: preset.sunThrough });
  const [vw, vh] = SIZES[size].view;
  const [ew, eh] = SIZES[size].env;
  const view = buildSkyView(atmosphere, vw, vh);
  const sun = atmosphere.lightAtSea([0, 0, 0]);
  // The clouds are lit above the sea haze, by a whiter sun.
  const cloudSun = atmosphere.lightAt((preset.clouds.base + preset.clouds.top) * 0.5, [0, 0, 0]);
  const zenith = sampleSkyView(view, vw, vh, 0, 1, 0, [0, 0, 0]);
  const env = new Float32Array(ew * eh * 4);
  const dir: Rgb = [0, 0, 0];
  const sky: Rgb = [0, 0, 0];
  const c: Rgb = [0, 0, 0];
  const horizon: Rgb = [0, 0, 0];
  let ambR = 0;
  let ambG = 0;
  let ambB = 0;
  let ambW = 0;
  let horR = 0;
  let horG = 0;
  let horB = 0;
  let horW = 0;
  for (let y = 0; y < eh; y += 1) {
    // Row 0 is straight down, as three samples an equirectangular map that is not flipped.
    const lat = ((y + 0.5) / eh - 0.5) * Math.PI;
    const cl = Math.cos(lat);
    for (let x = 0; x < ew; x += 1) {
      const phi = ((x + 0.5) / ew - 0.5) * Math.PI * 2;
      dir[0] = cl * Math.cos(phi);
      dir[1] = Math.sin(lat);
      dir[2] = cl * Math.sin(phi);
      const o = (y * ew + x) * 4;
      if (dir[1] >= 0) {
        sampleSkyView(view, vw, vh, dir[0], dir[1], dir[2], sky);
        cloudSheet(preset, atmosphere, sky, dir, zenith, cloudSun, c);
        const w = cl * Math.sin(lat + 0.05);
        ambR += c[0] * w;
        ambG += c[1] * w;
        ambB += c[2] * w;
        ambW += w;
        if (lat < 0.09) {
          horR += c[0];
          horG += c[1];
          horB += c[2];
          horW += 1;
        }
      } else {
        // The sea: the far water is lost in the haze at the horizon, the near water gives back little but its own blue-green.
        sampleSkyView(view, vw, vh, dir[0], 0.004, dir[2], horizon);
        const k = Math.exp(dir[1] * 24);
        c[0] = horizon[0] * (0.07 + 0.93 * k) + zenith[0] * 0.05;
        c[1] = horizon[1] * (0.07 + 0.93 * k) + zenith[1] * 0.09;
        c[2] = horizon[2] * (0.07 + 0.93 * k) + zenith[2] * 0.1;
      }
      env[o] = c[0];
      env[o + 1] = c[1];
      env[o + 2] = c[2];
      env[o + 3] = 1;
    }
  }
  const tint = preset.night > 0 ? MOONLIGHT : DAYLIGHT;
  const skyAmbient = new Vector3(ambR / ambW, ambG / ambW, ambB / ambW).multiply(new Vector3(...tint));
  const ambientLum = Math.max(1e-6, 0.2126 * skyAmbient.x + 0.7152 * skyAmbient.y + 0.0722 * skyAmbient.z);
  const through = [sun[0] * preset.sunThrough * tint[0], sun[1] * preset.sunThrough * tint[1], sun[2] * preset.sunThrough * tint[2]] as Rgb;
  const ratio = lum(through) / ambientLum;
  const k = ratio > preset.sunRatio ? preset.sunRatio / ratio : 1;
  const sunIrradiance = new Vector3(through[0] * k, through[1] * k, through[2] * k);
  const horizonColor = new Vector3(horR / horW, horG / horW, horB / horW).multiply(new Vector3(...tint));
  return {
    view: toHalf(view, tint),
    env: toHalf(env, tint),
    viewSize: [vw, vh],
    envSize: [ew, eh],
    info: { sunDir: light, sunIrradiance, skyAmbient, horizon: horizonColor, ambientLum },
  };
}

const DAYLIGHT: Rgb = [1, 1, 1];
/** Moonlight is only sunlight dimmed, but a night scene looks blue to the eye: the films grade it so, and so does the sky. */
const MOONLIGHT: Rgb = [0.886, 1.01, 1.236];

function toHalf(data: Float32Array, tint: Rgb) {
  const out = new Uint16Array(data.length);
  for (let i = 0; i < data.length; i += 4) {
    out[i] = DataUtils.toHalfFloat(data[i]! * tint[0]);
    out[i + 1] = DataUtils.toHalfFloat(data[i + 1]! * tint[1]);
    out[i + 2] = DataUtils.toHalfFloat(data[i + 2]! * tint[2]);
    out[i + 3] = DataUtils.toHalfFloat(data[i + 3]!);
  }
  return out;
}

/**
 * A sky view texture. A stand-in made before the battle's sky (a plain grey one) must be made here too: the nodes that
 * read it keep its sampler when the real sky is swapped in.
 */
export function viewTexture(data: Uint16Array = new Uint16Array(8 * 8 * 4).fill(0x2000), [w, h]: [number, number] = [8, 8]) {
  const tex = new DataTexture(data, w, h, RGBAFormat, HalfFloatType);
  // Azimuth wraps around; elevation stops at the poles.
  tex.wrapS = RepeatWrapping;
  tex.wrapT = ClampToEdgeWrapping;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

function envTexture(data: Uint16Array, [w, h]: [number, number]) {
  const tex = new DataTexture(data, w, h, RGBAFormat, HalfFloatType);
  tex.mapping = EquirectangularReflectionMapping;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearFilter;
  tex.flipY = false;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

/** Yields to the browser, so the loading bar paints before the sky takes the main thread for a few dozen milliseconds. */
const yieldFrame = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * Builds the preset's sky. With `reuse` the new sky is written into the textures of the previous one instead of making
 * new ones: the renderer builds its filtered reflection maps (and the objects that hold them) per texture and never
 * frees the ones of a texture it has dropped, so a battle's sky must stay the same texture objects to leave nothing behind.
 */
export async function loadSky(preset: SkyPreset, size: SkySize, reuse?: LoadedSky, signal?: AbortSignal): Promise<LoadedSky> {
  signal?.throwIfAborted();
  await yieldFrame();
  signal?.throwIfAborted();
  const built = buildSky(preset, size);
  // A cancelled request must never write into the running sky's reused textures.
  signal?.throwIfAborted();
  const fits = (tex: DataTexture | undefined, [w, h]: [number, number]) => !!tex && tex.image.width === w && tex.image.height === h;
  if (reuse && fits(reuse.view, built.viewSize) && fits(reuse.environment, built.envSize)) {
    reuse.view.image.data = built.view;
    reuse.view.needsUpdate = true;
    reuse.environment.image.data = built.env;
    reuse.environment.needsUpdate = true;
    reuse.environment.needsPMREMUpdate = true;
    return { view: reuse.view, environment: reuse.environment, info: built.info };
  }
  return { view: viewTexture(built.view, built.viewSize), environment: envTexture(built.env, built.envSize), info: built.info };
}
