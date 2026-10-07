import { bandVariance, GRAVITY, jonswap, mulberry32, peakOmega, spreading, type SpectrumParams } from './spectrum';

export const WAVE_COUNT = 16;
export const SWELL_CUTOFF = 34;

export type SeaStateName = 'calm' | 'moderate' | 'rough';

export type SeaState = {
  windAngle: number;
  wind: number;
  fetch: number;
  spread: number;
  choppiness: number;
  detail: number;
  whitecaps: number;
};

export const SEA_STATES: Record<SeaStateName, SeaState> = {
  calm: { windAngle: 0.6, wind: 6.5, fetch: 60000, spread: 1, choppiness: 0.85, detail: 0.7, whitecaps: 0.12 },
  moderate: { windAngle: 0.6, wind: 10.5, fetch: 120000, spread: 1, choppiness: 1.05, detail: 1, whitecaps: 0.55 },
  rough: { windAngle: 0.6, wind: 14.5, fetch: 220000, spread: 0.85, choppiness: 1.2, detail: 1.25, whitecaps: 1 },
};

export function spectrumOf(state: SeaState): SpectrumParams {
  return { wind: state.wind, fetch: state.fetch, angle: state.windAngle, spread: state.spread, swell: 0 };
}

export type Vec3Like = { x: number; y: number; z: number };

export class WaveField {
  readonly dirK = new Float32Array(WAVE_COUNT * 4);
  readonly ampQ = new Float32Array(WAVE_COUNT * 4);
  state: SeaState = SEA_STATES.rough;
  time = 0;
  version = 0;
  private readonly seed: number;
  private readonly scratch = { x: 0, y: 0, z: 0 };

  constructor(seed = 1592) {
    this.seed = seed;
    this.setState(SEA_STATES.rough);
  }

  setState(state: SeaState) {
    this.state = state;
    const rand = mulberry32(this.seed);
    const params = spectrumOf(state);
    const kp = peakOmega(params) ** 2 / GRAVITY;
    const kMax = (2 * Math.PI) / SWELL_CUTOFF;
    const kMin = Math.min(kMax * 0.5, kp * 0.35);
    const steps = 512;
    const cdf = new Float64Array(steps + 1);
    const dk = (kMax - kMin) / steps;
    for (let i = 0; i < steps; i += 1) {
      const k = kMin + (i + 0.5) * dk;
      const omega = Math.sqrt(GRAVITY * k);
      cdf[i + 1] = cdf[i]! + jonswap(omega, params) * (GRAVITY / (2 * omega)) * dk;
    }
    const total = Math.max(1e-9, cdf[steps]!);
    const variance = bandVariance(kMin, kMax, params);
    const amp = Math.sqrt((2 * variance) / WAVE_COUNT);
    for (let i = 0; i < WAVE_COUNT; i += 1) {
      const u = ((i + 0.15 + rand() * 0.7) / WAVE_COUNT) * total;
      let lo = 0;
      let hi = steps;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (cdf[mid]! < u) lo = mid;
        else hi = mid;
      }
      const k = kMin + (lo + rand()) * dk;
      const omega = Math.sqrt(GRAVITY * k);
      let theta = 0;
      for (let tries = 0; tries < 64; tries += 1) {
        const cand = (rand() * 2 - 1) * Math.PI;
        if (rand() * 1.2 < spreading(cand, omega, params)) {
          theta = cand;
          break;
        }
      }
      const angle = state.windAngle + theta;
      const a = amp * (0.85 + rand() * 0.3);
      const qa = Math.min(a * state.choppiness, 0.85 / (k * WAVE_COUNT));
      const o = i * 4;
      this.dirK[o] = Math.cos(angle);
      this.dirK[o + 1] = Math.sin(angle);
      this.dirK[o + 2] = k;
      this.dirK[o + 3] = omega;
      this.ampQ[o] = a;
      this.ampQ[o + 1] = qa;
      this.ampQ[o + 2] = rand() * Math.PI * 2;
      this.ampQ[o + 3] = (2 * Math.PI) / k;
    }
    this.version += 1;
  }

  displacement(x0: number, z0: number, t: number, out: Vec3Like, minLambda = 0) {
    let dx = 0;
    let dy = 0;
    let dz = 0;
    for (let i = 0; i < WAVE_COUNT; i += 1) {
      const o = i * 4;
      if (this.ampQ[o + 3]! < minLambda) continue;
      const Dx = this.dirK[o]!;
      const Dz = this.dirK[o + 1]!;
      const k = this.dirK[o + 2]!;
      const w = this.dirK[o + 3]!;
      const theta = k * (Dx * x0 + Dz * z0) - w * t + this.ampQ[o + 2]!;
      const c = Math.cos(theta);
      const qa = this.ampQ[o + 1]!;
      dx += qa * Dx * c;
      dz += qa * Dz * c;
      dy += this.ampQ[o]! * Math.sin(theta);
    }
    out.x = dx;
    out.y = dy;
    out.z = dz;
    return out;
  }

  heightAt(x: number, z: number, t = this.time, minLambda = 0) {
    const d = this.scratch;
    let px = x;
    let pz = z;
    for (let it = 0; it < 4; it += 1) {
      this.displacement(px, pz, t, d, minLambda);
      px = x - d.x;
      pz = z - d.z;
    }
    this.displacement(px, pz, t, d, minLambda);
    return d.y;
  }

  significantHeight() {
    let sum = 0;
    for (let i = 0; i < WAVE_COUNT; i += 1) sum += this.ampQ[i * 4]! ** 2;
    return 4 * Math.sqrt(sum / 2);
  }
}

export const waveField = new WaveField();
