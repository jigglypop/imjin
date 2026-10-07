import {
  BufferGeometry,
  DataTexture,
  DataUtils,
  Float32BufferAttribute,
  Group,
  HalfFloatType,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  MeshStandardNodeMaterial,
  RedFormat,
  RepeatWrapping,
  SRGBColorSpace,
  TextureLoader,
  Uint32BufferAttribute,
  Vector2,
  type Texture,
} from 'three/webgpu';
import {
  abs,
  float,
  max,
  mix,
  mx_fractal_noise_float,
  normalWorld,
  pow,
  positionWorld,
  smoothstep,
  texture,
  uniform,
  vec2,
  vec3,
} from 'three/tsl';
import { HANSAN_TERRAIN, type TerrainSpec } from './generate';

const MESH_RES = 1024;

function loadTex(url: string, srgb: boolean) {
  const t = new TextureLoader().load(url);
  t.wrapS = RepeatWrapping;
  t.wrapT = RepeatWrapping;
  t.anisotropy = 16;
  t.minFilter = LinearMipmapLinearFilter;
  t.magFilter = LinearFilter;
  if (srgb) t.colorSpace = SRGBColorSpace;
  return t;
}

export class Terrain {
  readonly group = new Group();
  readonly rotation = uniform(new Vector2(1, 0));
  readonly sizeU = uniform(0);
  readonly heightTexture: DataTexture;
  private phi = 0;
  private cos = 1;
  private sin = 0;

  private constructor(readonly spec: TerrainSpec, readonly heights: Float32Array) {
    this.sizeU.value = spec.size;
    const half = new Uint16Array(heights.length);
    for (let i = 0; i < heights.length; i += 1) half[i] = DataUtils.toHalfFloat(heights[i]!);
    const tex = new DataTexture(half, spec.res, spec.res, RedFormat, HalfFloatType);
    tex.magFilter = LinearFilter;
    tex.minFilter = LinearFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    this.heightTexture = tex;
    this.group.add(this.buildMesh());
  }

  static async load(spec: TerrainSpec = HANSAN_TERRAIN) {
    const worker = new Worker(new URL('./terrain.worker.ts', import.meta.url), { type: 'module' });
    const heights = await new Promise<Float32Array>((resolve, reject) => {
      worker.onmessage = (e: MessageEvent<Float32Array>) => resolve(e.data);
      worker.onerror = (e) => reject(e);
      worker.postMessage(spec);
    });
    worker.terminate();
    return new Terrain(spec, heights);
  }

  setRotation(phi: number) {
    this.phi = phi;
    this.cos = Math.cos(phi);
    this.sin = Math.sin(phi);
    this.group.rotation.y = -phi;
    this.group.updateMatrixWorld(true);
    this.rotation.value.set(this.cos, this.sin);
  }

  get angle() {
    return this.phi;
  }

  toWorld(sx: number, sz: number) {
    return { x: sx * this.cos - sz * this.sin, z: sx * this.sin + sz * this.cos };
  }

  toScenario(wx: number, wz: number) {
    return { x: wx * this.cos + wz * this.sin, z: -wx * this.sin + wz * this.cos };
  }

  heightAtScenario(sx: number, sz: number) {
    const { size, res } = this.spec;
    const fx = ((sx + size / 2) / size) * res - 0.5;
    const fz = ((sz + size / 2) / size) * res - 0.5;
    const x0 = Math.max(0, Math.min(res - 2, Math.floor(fx)));
    const z0 = Math.max(0, Math.min(res - 2, Math.floor(fz)));
    const tx = Math.max(0, Math.min(1, fx - x0));
    const tz = Math.max(0, Math.min(1, fz - z0));
    const h = this.heights;
    const a = h[z0 * res + x0]!;
    const b = h[z0 * res + x0 + 1]!;
    const c = h[(z0 + 1) * res + x0]!;
    const d = h[(z0 + 1) * res + x0 + 1]!;
    return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
  }

  heightAt(wx: number, wz: number) {
    const sx = wx * this.cos + wz * this.sin;
    const sz = -wx * this.sin + wz * this.cos;
    return this.heightAtScenario(sx, sz);
  }

  private buildMesh() {
    const { size, res } = this.spec;
    const n = MESH_RES;
    const step = size / (n - 1);
    const positions = new Float32Array(n * n * 3);
    const normals = new Float32Array(n * n * 3);
    const hs = new Float32Array(n * n);
    for (let j = 0; j < n; j += 1) {
      for (let i = 0; i < n; i += 1) {
        const x = -size / 2 + i * step;
        const z = -size / 2 + j * step;
        const h = this.heightAtScenario(x, z);
        const k = j * n + i;
        hs[k] = h;
        positions[k * 3] = x;
        positions[k * 3 + 1] = h;
        positions[k * 3 + 2] = z;
      }
    }
    for (let j = 0; j < n; j += 1) {
      for (let i = 0; i < n; i += 1) {
        const k = j * n + i;
        const hl = hs[j * n + Math.max(0, i - 1)]!;
        const hr = hs[j * n + Math.min(n - 1, i + 1)]!;
        const hd = hs[Math.max(0, j - 1) * n + i]!;
        const hu = hs[Math.min(n - 1, j + 1) * n + i]!;
        const nx = (hl - hr) / (2 * step);
        const nz = (hd - hu) / (2 * step);
        const len = Math.hypot(nx, 1, nz);
        normals[k * 3] = nx / len;
        normals[k * 3 + 1] = 1 / len;
        normals[k * 3 + 2] = nz / len;
      }
    }
    const indices: number[] = [];
    const deep = -14;
    for (let j = 0; j < n - 1; j += 1) {
      for (let i = 0; i < n - 1; i += 1) {
        const a = j * n + i;
        const b = a + 1;
        const c = a + n;
        const d = c + 1;
        if (Math.max(hs[a]!, hs[b]!, hs[c]!, hs[d]!) < deep) continue;
        indices.push(a, c, b, b, c, d);
      }
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geo.setAttribute('normal', new Float32BufferAttribute(normals, 3));
    geo.setIndex(new Uint32BufferAttribute(new Uint32Array(indices), 1));
    geo.computeBoundingSphere();
    void res;
    const mesh = new Mesh(geo, this.buildMaterial());
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    return mesh;
  }

  private buildMaterial() {
    const rock = loadTex('/textures/aerial_rocks_02/diff.jpg', true);
    const cliff = loadTex('/textures/cliff_side/diff.jpg', true);
    const coastRocks = loadTex('/textures/coast_land_rocks_01/diff.jpg', true);
    const grass = loadTex('/textures/aerial_grass_rock/diff.jpg', true);
    const sand = loadTex('/textures/coast_sand_01/diff.jpg', true);
    const leaves = loadTex('/textures/forest_leaves_02/diff.jpg', true);
    const m = new MeshStandardNodeMaterial();
    const p = positionWorld;
    const n = normalWorld;
    const slope = float(1).sub(n.y);
    const h = p.y;
    const tri = (tex: Texture, scale: number) => {
      const w = pow(abs(n), vec3(4));
      const ws = w.div(w.x.add(w.y).add(w.z));
      const a = texture(tex, p.zy.mul(scale)).rgb;
      const b = texture(tex, p.xz.mul(scale)).rgb;
      const c = texture(tex, p.xy.mul(scale)).rgb;
      return a.mul(ws.x).add(b.mul(ws.y)).add(c.mul(ws.z));
    };
    const canopyNoise = mx_fractal_noise_float(vec3(p.x.mul(0.045), p.z.mul(0.045), float(0.3)), 4, 2.1, 0.55, 1.0);
    const crowns = mx_fractal_noise_float(vec3(p.x.mul(0.21), p.z.mul(0.21), float(1.7)), 3, 2.0, 0.5, 1.0);
    const dark = vec3(0.022, 0.04, 0.02);
    const mid = vec3(0.05, 0.075, 0.032);
    const light = vec3(0.09, 0.105, 0.045);
    const forestBase = mix(mix(dark, mid, smoothstep(-0.6, 0.4, canopyNoise)), light, smoothstep(0.25, 0.85, crowns).mul(0.6));
    const leafDetail = texture(leaves, p.xz.mul(1 / 9)).rgb;
    const forest = forestBase.mul(leafDetail.mul(1.6).add(0.45));
    const grassCol = texture(grass, p.xz.mul(1 / 160)).rgb.mul(0.85);
    const rockCol = tri(rock, 1 / 70).mul(0.9);
    const cliffCol = tri(cliff, 1 / 30);
    const coastCol = tri(coastRocks, 1 / 14);
    const sandCol = texture(sand, p.xz.mul(1 / 12)).rgb.mul(vec3(1.0, 0.96, 0.88));
    const beachW = float(1).sub(smoothstep(1.2, 5.5, h)).mul(float(1).sub(smoothstep(0.18, 0.4, slope)));
    const coastW = float(1).sub(smoothstep(3, 14, h)).mul(smoothstep(0.12, 0.35, slope));
    const cliffW = smoothstep(0.42, 0.68, slope);
    const peakW = smoothstep(330, 470, h).mul(float(1).sub(cliffW));
    const forestW = smoothstep(3, 12, h).mul(float(1).sub(smoothstep(0.32, 0.55, slope))).mul(float(1).sub(peakW));
    const grassW = smoothstep(0.2, 0.42, slope).mul(float(1).sub(cliffW)).mul(smoothstep(4, 16, h)).mul(0.8);
    const underwater = float(1).sub(smoothstep(-2.5, 0.6, h));
    let col = forest;
    col = mix(col, grassCol.mul(0.55).add(forest.mul(0.4)), grassW);
    col = mix(col, rockCol, peakW);
    col = mix(col, cliffCol, cliffW);
    col = mix(col, coastCol, coastW);
    col = mix(col, sandCol, beachW);
    col = mix(col, sandCol.mul(vec3(0.55, 0.62, 0.55)), underwater);
    const wet = float(1).sub(smoothstep(0.2, 2.5, h)).mul(float(1).sub(underwater));
    m.colorNode = col.mul(mix(float(1), float(0.6), wet));
    m.roughnessNode = mix(float(0.92), float(0.35), wet).sub(forestW.mul(0.05));
    m.metalness = 0;
    const bump = crowns.mul(forestW).mul(0.6).add(canopyNoise.mul(0.3).mul(forestW));
    m.normalNode = null;
    m.positionNode = null;
    void max;
    void vec2;
    void bump;
    return m;
  }
}
