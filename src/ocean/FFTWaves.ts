import { HalfFloatType, LinearFilter, LinearMipmapLinearFilter, RepeatWrapping, StorageTexture, type WebGPURenderer } from 'three/webgpu';
import { Fn, cos, float, instanceIndex, instancedArray, max, select, sin, sqrt, textureStore, uniform, uvec2, vec2, vec4 } from 'three/tsl';
import { directionalSpectrum, gaussian, GRAVITY, mulberry32, type SpectrumParams } from './spectrum';

const TWO_PI = Math.PI * 2;

export type Cascade = { size: number; kLow: number; kHigh: number; minWave: number };

export const CASCADES: Cascade[] = [
  { size: 233, kLow: TWO_PI / 34, kHigh: TWO_PI / 5.6, minWave: 5.6 },
  { size: 41.3, kLow: TWO_PI / 5.6, kHigh: TWO_PI / 1.05, minWave: 1.05 },
  { size: 9.73, kLow: TWO_PI / 1.05, kHigh: TWO_PI / 0.16, minWave: 0.16 },
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Buf = any;

const COUNT = CASCADES.length;

function makeTexture(n: number) {
  const t = new StorageTexture(n, n);
  t.type = HalfFloatType;
  t.wrapS = RepeatWrapping;
  t.wrapT = RepeatWrapping;
  t.magFilter = LinearFilter;
  t.minFilter = LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  return t;
}

/**
 * Ocean displacement and slope maps, evolved on the GPU each frame.
 * `n` is the grid size per cascade (a power of two). 256 on desktop, 128 on mobile.
 */
export class FFTWaves {
  readonly displacement: StorageTexture[];
  readonly derivatives: StorageTexture[];
  readonly time = uniform(0);
  readonly choppiness = uniform(1.1);
  readonly slopeVariance = [0, 0, 0];
  private readonly area: number;
  private readonly total: number;
  private readonly logN: number;
  private readonly h0Data: Float32Array;
  private readonly h0: Buf;
  private readonly passes: any[] = [];

  constructor(params: SpectrumParams, readonly n = 256, seed = 1592) {
    if (n < 16 || (n & (n - 1)) !== 0) throw new Error(`FFT size must be a power of two, got ${n}`);
    this.area = n * n;
    this.total = COUNT * this.area;
    this.logN = Math.round(Math.log2(n));
    this.displacement = CASCADES.map(() => makeTexture(n));
    this.derivatives = CASCADES.map(() => makeTexture(n));
    this.h0Data = new Float32Array(this.total * 4);
    this.h0 = instancedArray(this.h0Data, 'vec4');
    this.setSpectrum(params, seed);
    const a: Buf[] = [instancedArray(this.total, 'vec4'), instancedArray(this.total, 'vec4')];
    const b: Buf[] = [instancedArray(this.total, 'vec4'), instancedArray(this.total, 'vec4')];
    this.passes.push(this.evolvePass(a[0]!, b[0]!));
    let src = 0;
    for (const dir of [0, 1]) {
      for (let s = 0; s < this.logN; s += 1) {
        const size = 2 << s;
        this.passes.push(this.butterflyPass(dir, size, a[src]!, b[src]!, a[1 - src]!, b[1 - src]!));
        src = 1 - src;
      }
    }
    for (let c = 0; c < COUNT; c += 1) this.passes.push(this.assemblePass(c, a[src]!, b[src]!));
  }

  setSpectrum(params: SpectrumParams, seed = 1592) {
    const n = this.n;
    const rand = mulberry32(seed);
    const data = this.h0Data;
    const amp = new Float32Array(this.area * 2);
    for (let c = 0; c < COUNT; c += 1) {
      const cas = CASCADES[c]!;
      const dk = TWO_PI / cas.size;
      let slope = 0;
      for (let y = 0; y < n; y += 1) {
        const m = y < n / 2 ? y : y - n;
        for (let x = 0; x < n; x += 1) {
          const kn = x < n / 2 ? x : x - n;
          const kx = kn * dk;
          const kz = m * dk;
          const k = Math.hypot(kx, kz);
          const i = y * n + x;
          const g1 = gaussian(rand);
          const g2 = gaussian(rand);
          if (k < cas.kLow || k >= cas.kHigh) {
            amp[i * 2] = 0;
            amp[i * 2 + 1] = 0;
            continue;
          }
          const damp = Math.exp(-k * k * 0.0004);
          const variance = directionalSpectrum(kx, kz, params) * dk * dk * damp;
          const s = Math.sqrt(variance / 2);
          amp[i * 2] = g1 * s;
          amp[i * 2 + 1] = g2 * s;
          slope += variance * k * k;
        }
      }
      this.slopeVariance[c] = slope;
      const base = c * this.area;
      for (let y = 0; y < n; y += 1) {
        const my = (n - y) % n;
        for (let x = 0; x < n; x += 1) {
          const mx = (n - x) % n;
          const i = y * n + x;
          const j = my * n + mx;
          const o = (base + i) * 4;
          data[o] = amp[i * 2]!;
          data[o + 1] = amp[i * 2 + 1]!;
          data[o + 2] = amp[j * 2]!;
          data[o + 3] = -amp[j * 2 + 1]!;
        }
      }
    }
    const attr = this.h0.value as unknown as { needsUpdate: boolean };
    attr.needsUpdate = true;
  }

  private indices() {
    const idx = instanceIndex;
    const c = idx.div(this.area);
    const rem = idx.mod(this.area);
    const y = rem.div(this.n);
    const x = rem.mod(this.n);
    return { idx, c, y, x };
  }

  private evolvePass(outA: Buf, outB: Buf) {
    const h0 = this.h0;
    const time = this.time;
    const n = this.n;
    const fn = Fn(() => {
      const { idx, c, y, x } = this.indices();
      const half = n / 2;
      const kn = select(x.lessThan(half), float(x), float(x).sub(n));
      const m = select(y.lessThan(half), float(y), float(y).sub(n));
      const size = select(c.equal(0), float(CASCADES[0]!.size), select(c.equal(1), float(CASCADES[1]!.size), float(CASCADES[2]!.size)));
      const dk = float(TWO_PI).div(size);
      const kx: any = kn.mul(dk);
      const kz: any = m.mul(dk);
      const k: any = max(sqrt(kx.mul(kx).add(kz.mul(kz))), 1e-5);
      const omega = sqrt(k.mul(GRAVITY));
      const phase = omega.mul(time);
      const cp = cos(phase);
      const sp = sin(phase);
      const v: any = h0.element(idx);
      const hr = v.x.mul(cp).sub(v.y.mul(sp)).add(v.z.mul(cp)).add(v.w.mul(sp));
      const hi = v.x.mul(sp).add(v.y.mul(cp)).sub(v.z.mul(sp)).add(v.w.mul(cp));
      const invK: any = float(1).div(k);
      const ikxR = kx.mul(hi).negate();
      const ikxI = kx.mul(hr);
      const ikzR = kz.mul(hi).negate();
      const ikzI = kz.mul(hr);
      const dxR = ikxR.mul(invK);
      const dxI = ikxI.mul(invK);
      const dzR = ikzR.mul(invK);
      const dzI = ikzI.mul(invK);
      const fxz = kx.mul(kz).mul(invK).negate();
      const dxzR = hr.mul(fxz);
      const dxzI = hi.mul(fxz);
      const fxx = kx.mul(kx).mul(invK).negate();
      const fzz = kz.mul(kz).mul(invK).negate();
      const dxxR = hr.mul(fxx);
      const dxxI = hi.mul(fxx);
      const dzzR = hr.mul(fzz);
      const dzzI = hi.mul(fzz);
      outA.element(idx).assign(vec4(dxR.sub(dzI), dxI.add(dzR), hr.sub(dxzI), hi.add(dxzR)));
      outB.element(idx).assign(vec4(ikxR.sub(ikzI), ikxI.add(ikzR), dxxR.sub(dzzI), dxxI.add(dzzR)));
    });
    return (fn() as any).compute(this.total, [64]);
  }

  private butterflyPass(dir: number, size: number, srcA: Buf, srcB: Buf, dstA: Buf, dstB: Buf) {
    const n = this.n;
    const area = this.area;
    const fn = Fn(() => {
      const { idx, c, y, x } = this.indices();
      const i = dir === 0 ? x : y;
      const evenIndex = i.div(size).mul(size / 2).add(i.mod(size / 2));
      const oddIndex = evenIndex.add(n / 2);
      const base = c.mul(area);
      const evenAddr = dir === 0 ? base.add(y.mul(n)).add(evenIndex) : base.add(evenIndex.mul(n)).add(x);
      const oddAddr = dir === 0 ? base.add(y.mul(n)).add(oddIndex) : base.add(oddIndex.mul(n)).add(x);
      const angle = float(i).mul(TWO_PI / size);
      const tw = vec2(cos(angle), sin(angle));
      const mix4 = (src: Buf, dst: Buf) => {
        const e: any = src.element(evenAddr);
        const o: any = src.element(oddAddr);
        const ax = tw.x.mul(o.x).sub(tw.y.mul(o.y));
        const ay = tw.x.mul(o.y).add(tw.y.mul(o.x));
        const bx = tw.x.mul(o.z).sub(tw.y.mul(o.w));
        const by = tw.x.mul(o.w).add(tw.y.mul(o.z));
        dst.element(idx).assign(vec4(e.x.add(ax), e.y.add(ay), e.z.add(bx), e.w.add(by)));
      };
      mix4(srcA, dstA);
      mix4(srcB, dstB);
    });
    return (fn() as any).compute(this.total, [64]);
  }

  private assemblePass(cascade: number, srcA: Buf, srcB: Buf) {
    const chop = this.choppiness;
    const disp = this.displacement[cascade]!;
    const deriv = this.derivatives[cascade]!;
    const n = this.n;
    const area = this.area;
    const fn = Fn(() => {
      const idx = instanceIndex;
      const y = idx.div(n);
      const x = idx.mod(n);
      const addr = idx.add(cascade * area);
      const a: any = srcA.element(addr);
      const b: any = srcB.element(addr);
      const coord = uvec2(x, y);
      textureStore(disp, coord, vec4(a.x.mul(chop), a.z, a.y.mul(chop), a.w.mul(chop))).toWriteOnly();
      textureStore(deriv, coord, vec4(b.x, b.y, b.z.mul(chop), b.w.mul(chop))).toWriteOnly();
    });
    return (fn() as any).compute(area, [64]);
  }

  update(renderer: WebGPURenderer, time: number) {
    this.time.value = time;
    renderer.compute(this.passes as never);
  }
}
