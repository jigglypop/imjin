import { DataTexture, DataUtils, HalfFloatType, LinearFilter, RGBAFormat } from 'three/webgpu';

/** A designed tidal eddy on the adapted map, not an observed real-world whirlpool location. */
export type CurrentVortex = { x: number; z: number; r: number; spin: number; strength: number };

export type CurrentSpec = {
  cx: number;
  cz: number;
  angle: number;
  peak: number;
  reach: number;
  narrows: number;
  turnAt: number;
  slack: number;
  floodFirst: boolean;
  /** Up to four explicit eddies per tide; the spin reverses when the tide reverses. Historical presets omit this. */
  vortices?: readonly CurrentVortex[];
};

type Vortex = { x: number; z: number; r: number; spin: number; strength: number };

const SAMPLE = 36;

export class CurrentField {
  readonly texture: DataTexture;
  readonly size = 192;
  readonly extent: number;
  readonly centerWorld: { x: number; z: number };
  private readonly widths: Float32Array;
  private readonly offsets: Float32Array;
  private readonly bins: number;
  private readonly binSize: number;
  private readonly flood: Vortex[] = [];
  private readonly ebb: Vortex[] = [];
  private readonly ca: number;
  private readonly sa: number;
  private readonly fa: number;
  private readonly fs: number;
  private minWidth = 300;

  constructor(
    readonly spec: CurrentSpec,
    private readonly land: (sx: number, sz: number) => number,
    axis: number,
  ) {
    this.ca = Math.cos(axis);
    this.sa = Math.sin(axis);
    this.fa = Math.cos(spec.angle);
    this.fs = Math.sin(spec.angle);
    this.extent = spec.reach * 2.2;
    this.bins = Math.ceil((spec.reach * 2) / 40);
    this.binSize = (spec.reach * 2) / this.bins;
    this.widths = new Float32Array(this.bins);
    this.offsets = new Float32Array(this.bins);
    this.measure();
    this.placeVortices();
    const c = this.toWorld(spec.cx, spec.cz);
    this.centerWorld = c;
    this.texture = this.bake();
  }

  private toWorld(sx: number, sz: number) {
    return { x: sx * this.ca - sz * this.sa, z: sx * this.sa + sz * this.ca };
  }

  private toScenario(wx: number, wz: number) {
    return { x: wx * this.ca + wz * this.sa, z: -wx * this.sa + wz * this.ca };
  }

  private measure() {
    const { spec } = this;
    for (let i = 0; i < this.bins; i += 1) {
      const along = -spec.reach + (i + 0.5) * this.binSize;
      const ax = spec.cx + this.fa * along;
      const az = spec.cz + this.fs * along;
      let lo = 0;
      let hi = 0;
      const nx = -this.fs;
      const nz = this.fa;
      while (lo < 3000 && this.land(ax - nx * lo, az - nz * lo) < -2) lo += SAMPLE;
      while (hi < 3000 && this.land(ax + nx * hi, az + nz * hi) < -2) hi += SAMPLE;
      this.widths[i] = Math.max(spec.narrows, lo + hi);
      this.offsets[i] = (hi - lo) / 2;
    }
    let minW = Infinity;
    for (const w of this.widths) minW = Math.min(minW, w);
    this.minWidth = minW;
  }

  private placeVortices() {
    if (this.spec.vortices) {
      for (const dir of [-1, 1]) {
        const list = dir < 0 ? this.flood : this.ebb;
        for (const v of this.spec.vortices.slice(0, 4)) {
          if (![v.x, v.z, v.r, v.spin, v.strength].every(Number.isFinite) || v.r <= 0 || v.spin === 0 || v.strength <= 0 || this.land(v.x, v.z) >= -2) continue;
          list.push({ x: v.x, z: v.z, r: Math.max(30, Math.min(300, v.r)), spin: Math.sign(v.spin) * dir, strength: Math.min(1.5, v.strength) });
        }
      }
      return;
    }
    let narrowest = 0;
    for (let i = 1; i < this.bins; i += 1) if (this.widths[i]! < this.widths[narrowest]!) narrowest = i;
    const alongN = -this.spec.reach + (narrowest + 0.5) * this.binSize;
    const w = this.widths[narrowest]!;
    for (const dir of [-1, 1]) {
      const list = dir < 0 ? this.flood : this.ebb;
      for (let k = 0; k < 4; k += 1) {
        const along = alongN + dir * (w * 0.9 + k * w * 0.85);
        const side = k % 2 === 0 ? 1 : -1;
        const bin = Math.max(0, Math.min(this.bins - 1, Math.floor((along + this.spec.reach) / this.binSize)));
        const width = this.widths[bin]!;
        const off = this.offsets[bin]!;
        const across = off + side * width * 0.28;
        list.push({
          x: this.spec.cx + this.fa * along - this.fs * across,
          z: this.spec.cz + this.fs * along + this.fa * across,
          r: Math.min(220, width * 0.32),
          spin: side * dir,
          strength: 0.75 - k * 0.14,
        });
      }
    }
  }

  private fieldScenario(sx: number, sz: number, direction: number) {
    const { spec } = this;
    const dx = sx - spec.cx;
    const dz = sz - spec.cz;
    const along = dx * this.fa + dz * this.fs;
    const across = -dx * this.fs + dz * this.fa;
    if (Math.abs(along) > spec.reach) return { x: 0, z: 0 };
    const bin = Math.max(0, Math.min(this.bins - 1, Math.floor((along + spec.reach) / this.binSize)));
    const width = this.widths[bin]!;
    const rel = (across - this.offsets[bin]!) / (width * 0.5);
    const profile = Math.max(0.12, 1 - rel * rel);
    const fade = Math.min(1, (spec.reach - Math.abs(along)) / (spec.reach * 0.25));
    const speed = Math.min(spec.peak * 1.15, (spec.peak * this.minWidth) / width) * profile * fade * direction;
    let vx = this.fa * speed;
    let vz = this.fs * speed;
    for (const v of direction < 0 ? this.flood : this.ebb) {
      const ox = sx - v.x;
      const oz = sz - v.z;
      const d = Math.hypot(ox, oz);
      if (d > v.r * 2.4 || d < 1) continue;
      const t = d / v.r;
      const mag = (t < 1 ? t : Math.exp(1 - t * t)) * spec.peak * v.strength;
      vx += (-oz / d) * mag * v.spin;
      vz += (ox / d) * mag * v.spin;
    }
    return { x: vx, z: vz };
  }

  velocity(wx: number, wz: number, tide: number) {
    if (Math.abs(tide) < 1e-3) return { x: 0, z: 0 };
    const s = this.toScenario(wx, wz);
    const f = this.fieldScenario(s.x, s.z, Math.sign(tide));
    const k = Math.abs(tide);
    const w = { x: f.x * k, z: f.z * k };
    return { x: w.x * this.ca - w.z * this.sa, z: w.x * this.sa + w.z * this.ca };
  }

  vortexData(): number[] {
    const out: number[] = [];
    for (const list of [this.flood, this.ebb]) {
      // Ocean.ts addresses exactly four flood and four ebb records. Missing designed eddies are harmless zeroes.
      for (let i = 0; i < 4; i += 1) {
        const v = list[i];
        if (!v) { out.push(0, 0, 1, 0); continue; }
        const w = this.toWorld(v.x, v.z);
        out.push(w.x, w.z, v.r, v.spin * v.strength);
      }
    }
    return out;
  }

  peakSpeed(tide: number) {
    return this.spec.peak * Math.abs(tide);
  }

  tideAt(time: number) {
    const { turnAt, slack, floodFirst } = this.spec;
    const k = Math.max(-1, Math.min(1, (time - turnAt) / slack));
    const shaped = Math.sign(k) * Math.pow(Math.abs(k), 0.6);
    return floodFirst ? shaped : -shaped;
  }

  private bake() {
    const n = this.size;
    const data = new Uint16Array(n * n * 4);
    for (let j = 0; j < n; j += 1) {
      for (let i = 0; i < n; i += 1) {
        const wx = this.centerWorld.x + ((i + 0.5) / n - 0.5) * this.extent;
        const wz = this.centerWorld.z + ((j + 0.5) / n - 0.5) * this.extent;
        const s = this.toScenario(wx, wz);
        const a = this.fieldScenario(s.x, s.z, -1);
        const b = this.fieldScenario(s.x, s.z, 1);
        const aw = { x: a.x * this.ca - a.z * this.sa, z: a.x * this.sa + a.z * this.ca };
        const bw = { x: b.x * this.ca - b.z * this.sa, z: b.x * this.sa + b.z * this.ca };
        const o = (j * n + i) * 4;
        data[o] = DataUtils.toHalfFloat(aw.x);
        data[o + 1] = DataUtils.toHalfFloat(aw.z);
        data[o + 2] = DataUtils.toHalfFloat(bw.x);
        data[o + 3] = DataUtils.toHalfFloat(bw.z);
      }
    }
    const tex = new DataTexture(data, n, n, RGBAFormat, HalfFloatType);
    tex.magFilter = LinearFilter;
    tex.minFilter = LinearFilter;
    tex.needsUpdate = true;
    return tex;
  }
}
