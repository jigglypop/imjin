export const WAVE_COUNT = 16;
const GRAVITY = 9.81;

export type SeaStateName = 'calm' | 'moderate' | 'rough';

export type SeaState = {
  windAngle: number;
  scale: number;
  choppiness: number;
  longest: number;
  shortest: number;
  detail: number;
  whitecaps: number;
};

export const SEA_STATES: Record<SeaStateName, SeaState> = {
  calm: { windAngle: 0.6, scale: 0.22, choppiness: 0.55, longest: 60, shortest: 3.5, detail: 0.6, whitecaps: 0.15 },
  moderate: { windAngle: 0.6, scale: 0.5, choppiness: 0.78, longest: 85, shortest: 4, detail: 1, whitecaps: 0.55 },
  rough: { windAngle: 0.6, scale: 1.05, choppiness: 0.92, longest: 120, shortest: 5, detail: 1.35, whitecaps: 1 },
};

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

export type Vec3Like = { x: number; y: number; z: number };

export class WaveField {
  readonly dirK = new Float32Array(WAVE_COUNT * 4);
  readonly ampQ = new Float32Array(WAVE_COUNT * 4);
  state: SeaState = SEA_STATES.moderate;
  time = 0;
  version = 0;
  private readonly seed: number;
  private readonly scratch = { x: 0, y: 0, z: 0 };

  constructor(seed = 1592) {
    this.seed = seed;
    this.setState(SEA_STATES.moderate);
  }

  setState(state: SeaState) {
    this.state = state;
    const rand = mulberry32(this.seed);
    for (let i = 0; i < WAVE_COUNT; i += 1) {
      const f = i / (WAVE_COUNT - 1);
      const lambda = state.longest * Math.pow(state.shortest / state.longest, f);
      const k = (2 * Math.PI) / lambda;
      const omega = Math.sqrt(GRAVITY * k);
      const spread = 0.22 + 0.95 * f;
      const angle = state.windAngle + (rand() * 2 - 1) * spread;
      const steep = (0.04 + 0.075 * f) * (0.75 + rand() * 0.5);
      const amp = (steep / k) * state.scale;
      const qa = state.choppiness / (k * WAVE_COUNT);
      const o = i * 4;
      this.dirK[o] = Math.cos(angle);
      this.dirK[o + 1] = Math.sin(angle);
      this.dirK[o + 2] = k;
      this.dirK[o + 3] = omega;
      this.ampQ[o] = amp;
      this.ampQ[o + 1] = qa;
      this.ampQ[o + 2] = rand() * Math.PI * 2;
      this.ampQ[o + 3] = lambda;
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
