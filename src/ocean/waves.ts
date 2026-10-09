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
  rough: { windAngle: 0.6, wind: 13.5, fetch: 200000, spread: 0.85, choppiness: 1.2, detail: 1.25, whitecaps: 1 },
};

export function spectrumOf(state: SeaState): SpectrumParams {
  return { wind: state.wind, fetch: state.fetch, angle: state.windAngle, spread: state.spread, swell: 0 };
}

export class WaveField {
  readonly dirK = new Float32Array(WAVE_COUNT * 4);
  readonly ampQ = new Float32Array(WAVE_COUNT * 4);
  state: SeaState = SEA_STATES.rough;
  time = 0;
  version = 0;
  /** No point of the surface is higher than this: the sum of every wave's amplitude. */
  crest = 0;
  private readonly seed: number;

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
    let crest = 0;
    for (let i = 0; i < WAVE_COUNT; i += 1) crest += this.ampQ[i * 4]!;
    this.crest = crest;
    this.version += 1;
  }

  /**
   * The surface height under the point (x, z): the horizontal displacement of every wave is undone by fixed-point
   * iteration, then the height is summed there. Written as one loop with no inner calls: this runs thousands
   * of times a frame, and a call with number arguments allocates in V8.
   */
  heightAt(x: number, z: number, t = this.time, minLambda = 0) {
    const dirK = this.dirK;
    const ampQ = this.ampQ;
    let px = x;
    let pz = z;
    let dy = 0;
    for (let it = 0; it < 5; it += 1) {
      let dx = 0;
      let dz = 0;
      dy = 0;
      for (let i = 0; i < WAVE_COUNT; i += 1) {
        const o = i * 4;
        if (ampQ[o + 3]! < minLambda) continue;
        const Dx = dirK[o]!;
        const Dz = dirK[o + 1]!;
        const theta = dirK[o + 2]! * (Dx * px + Dz * pz) - dirK[o + 3]! * t + ampQ[o + 2]!;
        const c = Math.cos(theta);
        const qa = ampQ[o + 1]!;
        dx += qa * Dx * c;
        dz += qa * Dz * c;
        dy += ampQ[o]! * Math.sin(theta);
      }
      px = x - dx;
      pz = z - dz;
    }
    return dy;
  }

  significantHeight() {
    let sum = 0;
    for (let i = 0; i < WAVE_COUNT; i += 1) sum += this.ampQ[i * 4]! ** 2;
    return 4 * Math.sqrt(sum / 2);
  }
}

export const waveField = new WaveField();
