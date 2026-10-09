import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Float32BufferAttribute,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  MeshStandardNodeMaterial,
  Vector3,
  type Texture,
} from 'three/webgpu';
import {
  Discard,
  dot,
  float,
  Fn,
  frontFacing,
  If,
  instancedDynamicBufferAttribute,
  mix,
  mx_noise_float,
  positionWorld,
  select,
  smoothstep,
  texture,
  uv,
  vec3,
} from 'three/tsl';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import type { ShipKind } from '../sim/types';
import { SHIP_SPECS } from '../sim/catalog';

export type ShipModelSpec = {
  kind: ShipKind;
  variant: number;
  base: string;
  axis: 'x' | 'z';
  bow: 1 | -1;
  waterline: number;
};

export const SHIP_MODELS: ShipModelSpec[] = [
  { kind: 'panokseon', variant: 0, base: '/models/panokseon_a', axis: 'x', bow: -1, waterline: 0.155 },
  { kind: 'panokseon', variant: 1, base: '/models/panokseon_b', axis: 'x', bow: -1, waterline: 0.15 },
  { kind: 'panokseon', variant: 2, base: '/models/panokseon_c', axis: 'x', bow: 1, waterline: 0.13 },
  { kind: 'geobukseon', variant: 0, base: '/models/geobukseon_v2', axis: 'z', bow: 1, waterline: 0.22 },
  { kind: 'atakebune', variant: 0, base: '/models/atakebune_v2', axis: 'z', bow: 1, waterline: 0.12 },
  { kind: 'sekibune', variant: 0, base: '/models/sekibune_v2', axis: 'z', bow: 1, waterline: 0.11 },
  { kind: 'hyeopseon', variant: 0, base: '/models/hyeopseon', axis: 'z', bow: 1, waterline: 0.1 },
  { kind: 'kobaya', variant: 0, base: '/models/kobaya', axis: 'z', bow: 1, waterline: 0.11 },
  { kind: 'mingship', variant: 0, base: '/models/mingship', axis: 'z', bow: 1, waterline: 0.15 },
  { kind: 'mingsmall', variant: 0, base: '/models/mingsmall', axis: 'z', bow: 1, waterline: 0.1 },
];

export const FALLBACK_MODEL: Partial<Record<ShipKind, string>> = {
  hyeopseon: '/models/sekibune_v2',
  kobaya: '/models/sekibune_v2',
  mingship: '/models/atakebune_v2',
  mingsmall: '/models/sekibune_v2',
};

/** Detail levels a full model set has: near, mid, far. A model loaded without its near level has fewer. */
export const LOD_COUNT = 3;

/** What a phone can afford. `skipLod0` leaves the 2048 px near model out, `baseColorOnly` drops the normal and roughness maps. */
export type ShipAssetOptions = { skipLod0: boolean; baseColorOnly: boolean; anisotropy: number };
let assetOptions: ShipAssetOptions = { skipLod0: false, baseColorOnly: false, anisotropy: 16 };

export type LodAsset = { geometry: BufferGeometry; source: MeshStandardMaterial };
export type ModelAsset = { key: string; kind: ShipKind; variant: number; lods: LodAsset[]; bounds: Box3 };

export const modelKey = (kind: ShipKind, variant: number) => `${kind}#${variant}`;

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

function findMesh(root: Group) {
  let found: Mesh | null = null;
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (!found && (o as Mesh).isMesh) found = o as Mesh;
  });
  if (!found) throw new Error('model has no mesh');
  return found as Mesh;
}

function toFloat(attr: BufferAttribute, itemSize: number) {
  const out = new Float32Array(attr.count * itemSize);
  for (let i = 0; i < attr.count; i += 1) {
    out[i * itemSize] = attr.getX(i);
    if (itemSize > 1) out[i * itemSize + 1] = attr.getY(i);
    if (itemSize > 2) out[i * itemSize + 2] = attr.getZ(i);
  }
  return new Float32BufferAttribute(out, itemSize);
}

function bake(mesh: Mesh, matrix: Matrix4) {
  const src = mesh.geometry;
  const geo = new BufferGeometry();
  geo.setAttribute('position', toFloat(src.getAttribute('position') as BufferAttribute, 3));
  if (src.getAttribute('normal')) geo.setAttribute('normal', toFloat(src.getAttribute('normal') as BufferAttribute, 3));
  if (src.getAttribute('uv')) geo.setAttribute('uv', toFloat(src.getAttribute('uv') as BufferAttribute, 2));
  if (src.index) geo.setIndex(src.index);
  geo.applyMatrix4(matrix);
  if (!geo.getAttribute('normal')) geo.computeVertexNormals();
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  return geo;
}

async function loadGltf(url: string) {
  const gltf = await loader.loadAsync(url);
  return gltf.scene as Group;
}

/** The mesh files of one model, nearest level first. Without LOD0 the first file is the 1024 px level. */
async function loadScenes(base: string) {
  if (!assetOptions.skipLod0) return Promise.all([loadGltf(`${base}.glb`), loadGltf(`${base}_lod1.glb`).catch(() => null), loadGltf(`${base}_lod2.glb`).catch(() => null)]);
  const [lod1, lod2] = await Promise.all([loadGltf(`${base}_lod1.glb`).catch(() => null), loadGltf(`${base}_lod2.glb`).catch(() => null)]);
  if (lod1) return [lod1, lod2];
  return [await loadGltf(`${base}.glb`), lod2];
}

/** Phones draw the base colour map only: the normal and roughness maps would double the texture memory of every hull. */
function trimMaterial(mat: MeshStandardMaterial) {
  for (const key of ['normalMap', 'roughnessMap', 'metalnessMap', 'aoMap'] as const) {
    const t = mat[key];
    if (!t) continue;
    (t.image as { close?: () => void } | null)?.close?.();
    t.dispose();
    mat[key] = null;
  }
}

async function loadModel(spec: ShipModelSpec): Promise<ModelAsset> {
  let base = spec.base;
  let scenes: (Group | null)[];
  try {
    scenes = await loadScenes(base);
  } catch (err) {
    const fallback = FALLBACK_MODEL[spec.kind];
    if (!fallback) throw err;
    base = fallback;
    scenes = await loadScenes(base);
    spec = { ...spec, axis: 'z', bow: 1, waterline: 0.27 };
  }
  const lod0 = findMesh(scenes[0]!);
  const orient = new Matrix4().makeRotationY(spec.axis === 'z' ? (spec.bow > 0 ? Math.PI / 2 : -Math.PI / 2) : spec.bow > 0 ? 0 : Math.PI);
  const probe = bake(lod0, new Matrix4().multiplyMatrices(orient, lod0.matrixWorld));
  const box = probe.boundingBox!.clone();
  const length = SHIP_SPECS[spec.kind].length;
  const scale = length / (box.max.x - box.min.x);
  const center = box.getCenter(new Vector3());
  const height = box.max.y - box.min.y;
  const fix = new Matrix4()
    .makeTranslation(-center.x * scale, -(box.min.y + height * spec.waterline) * scale, -center.z * scale)
    .multiply(new Matrix4().makeScale(scale, scale, scale));
  const lods: LodAsset[] = [];
  for (let i = 0; i < scenes.length; i += 1) {
    const scene = scenes[i] ?? scenes[0]!;
    const mesh = findMesh(scene);
    const m = new Matrix4().multiplyMatrices(fix, new Matrix4().multiplyMatrices(orient, mesh.matrixWorld));
    const source = mesh.material as MeshStandardMaterial;
    if (assetOptions.baseColorOnly) trimMaterial(source);
    lods.push({ geometry: bake(mesh, m), source });
  }
  if (assetOptions.baseColorOnly) {
    // The levels are simplified copies of one model with the same UVs, so the first one's colour map serves them all.
    // One texture and one shader program per model instead of one per level.
    const shared = lods[0]!.source.map;
    for (const lod of lods.slice(1)) {
      if (!shared || lod.source.map === shared) continue;
      (lod.source.map?.image as { close?: () => void } | null)?.close?.();
      lod.source.map?.dispose();
      lod.source.map = shared;
    }
  }
  return { key: modelKey(spec.kind, spec.variant), kind: spec.kind, variant: spec.variant, lods, bounds: lods[0]!.geometry.boundingBox!.clone() };
}

// Loaded models are shared by every battle of the page. A later battle only loads the kinds it adds.
const modelCache = new Map<string, Promise<ModelAsset>>();

export async function loadShipAssets(kinds: ShipKind[], options: ShipAssetOptions, onProgress?: (fraction: number) => void) {
  assetOptions = options;
  const specs = SHIP_MODELS.filter((m) => kinds.includes(m.kind));
  let loaded = 0;
  const list = await Promise.all(
    specs.map((s) => {
      let model = modelCache.get(modelKey(s.kind, s.variant));
      if (!model) {
        model = loadModel(s);
        modelCache.set(modelKey(s.kind, s.variant), model);
        model.catch(() => modelCache.delete(modelKey(s.kind, s.variant)));
      }
      return model.then((a) => {
        loaded += 1;
        onProgress?.(loaded / specs.length);
        return a;
      });
    }),
  );
  return Object.fromEntries(list.map((a) => [a.key, a])) as Record<string, ModelAsset>;
}

/** Frees the models no longer in `keep`: their geometry and textures. Call once the batches that drew them are gone. */
export async function releaseShipAssets(keep: Set<string>) {
  for (const [key, pending] of [...modelCache]) {
    if (keep.has(key)) continue;
    modelCache.delete(key);
    const asset = await pending.catch(() => null);
    if (!asset) continue;
    for (const lod of asset.lods) {
      lod.geometry.dispose();
      for (const value of Object.values(lod.source)) if (value && (value as Texture).isTexture) (value as Texture).dispose();
      lod.source.dispose();
    }
  }
}

/**
 * Hull material. With a cut attribute the hull is drawn as a section: everything above the cut height (in ship space)
 * is discarded and the inside faces show as raw timber, so the decks below can be seen.
 */
function createMaterial(src: MeshStandardMaterial, a: InstancedBufferAttribute, b: InstancedBufferAttribute, c?: InstancedBufferAttribute) {
  const m = new MeshStandardNodeMaterial();
  m.side = c ? DoubleSide : src.side;
  if (src.normalMap) {
    m.normalMap = src.normalMap;
    m.normalScale.copy(src.normalScale);
    src.normalMap.anisotropy = assetOptions.anisotropy;
  }
  m.metalness = 0;
  m.roughness = 1;
  const map = src.map as Texture | null;
  if (map) map.anisotropy = assetOptions.anisotropy;
  const A: any = instancedDynamicBufferAttribute(a, 'vec4');
  const B: any = instancedDynamicBufferAttribute(b, 'vec4');
  const origin = A.xyz;
  const burn = A.w;
  const up = B.xyz;
  const flash = B.w;
  const baseColor = map ? texture(map, uv()).rgb : vec3(src.color.r, src.color.g, src.color.b);
  const rough = src.roughnessMap ? texture(src.roughnessMap, uv()).g : float(0.85);
  const shipY = dot(positionWorld.sub(origin), up);
  const wet = float(1).sub(smoothstep(-0.1, 0.9, shipY));
  const under = float(1).sub(smoothstep(-0.9, -0.05, shipY));
  const noise = mx_noise_float(positionWorld.mul(0.35)).mul(0.5).add(0.5);
  const charAmount = smoothstep(0.35, 0.75, noise.add(burn.mul(0.9)).sub(0.45)).mul(burn);
  const ember = smoothstep(0.62, 0.95, mx_noise_float(positionWorld.mul(1.3).add(vec3(0, burn.mul(4), 0))).mul(0.5).add(0.5));
  const wetColor = baseColor.mul(mix(float(1), float(0.55), wet));
  const algae = mix(wetColor, wetColor.mul(vec3(0.42, 0.52, 0.36)), under.mul(0.85));
  const charred = mix(algae, vec3(0.025, 0.02, 0.018), charAmount.mul(0.9));
  const lit = charred.mul(float(1).add(flash.mul(2)));
  if (c) {
    const C: any = instancedDynamicBufferAttribute(c, 'vec4');
    const grain = mx_noise_float(positionWorld.mul(vec3(0.8, 6, 0.8))).mul(0.5).add(0.5);
    const timber = mix(vec3(0.16, 0.1, 0.055), vec3(0.3, 0.2, 0.11), grain);
    m.colorNode = Fn(() => {
      If(shipY.greaterThan(C.x), () => {
        Discard();
      });
      return select(frontFacing, lit, timber);
    })();
  } else m.colorNode = lit;
  m.roughnessNode = mix(rough.mul(0.95).add(0.05), float(0.25), wet.mul(0.8)).max(0.05);
  m.emissiveNode = vec3(1.0, 0.32, 0.06).mul(charAmount.mul(burn).mul(ember).mul(4));
  return m;
}

type Batch = { mesh: InstancedMesh; a: InstancedBufferAttribute; b: InstancedBufferAttribute; c?: InstancedBufferAttribute; count: number };
const CUT_CAP = 12;

export class ShipRenderer {
  readonly group = new Group();
  private batches = new Map<string, Batch[]>();
  /** Section-cut copies of the near model, for the few ships shown in cutaway. Made on first use. */
  private cuts = new Map<string, Batch>();
  private capacity = new Map<string, number>();

  constructor(private assets: Record<string, ModelAsset>, capacity: Map<string, number>) {
    this.capacity = capacity;
    this.build();
  }

  has(key: string) {
    return this.batches.has(key);
  }

  private build() {
    for (const child of [...this.group.children]) this.group.remove(child);
    this.batches.clear();
    for (const key of Object.keys(this.assets)) this.buildKey(key);
  }

  /** Room for at least count ships of a model. Ships launched mid-battle can outgrow what the battle started with. */
  ensure(key: string, count: number) {
    const cap = this.capacity.get(key) ?? 0;
    if (count <= cap || !this.assets[key]) return;
    this.capacity.set(key, Math.max(count, cap * 2, 4));
    for (const batch of this.batches.get(key) ?? []) {
      this.group.remove(batch.mesh);
      (batch.mesh.material as MeshStandardNodeMaterial).dispose();
    }
    this.buildKey(key);
  }

  private buildKey(key: string) {
    const asset = this.assets[key]!;
    const cap = Math.max(1, this.capacity.get(key) ?? 0);
    if (!this.capacity.get(key)) return;
    {
      this.batches.set(
        key,
        asset.lods.map((lod, level) => {
          const a = new InstancedBufferAttribute(new Float32Array(cap * 4), 4);
          const b = new InstancedBufferAttribute(new Float32Array(cap * 4), 4);
          a.setUsage(DynamicDrawUsage);
          b.setUsage(DynamicDrawUsage);
          const mesh = new InstancedMesh(lod.geometry, createMaterial(lod.source, a, b), cap);
          mesh.instanceMatrix.setUsage(DynamicDrawUsage);
          mesh.count = 0;
          mesh.frustumCulled = false;
          // Shadows and shading from the two nearest of the three levels, counted as if the full set were there.
          const nominal = level + LOD_COUNT - asset.lods.length;
          mesh.castShadow = nominal < 2;
          mesh.receiveShadow = nominal < 2;
          this.group.add(mesh);
          return { mesh, a, b, count: 0 };
        }),
      );
    }
  }

  /** Frees the hull materials of every batch. The geometry and textures belong to the shared models. */
  dispose() {
    for (const batch of [...[...this.batches.values()].flat(), ...this.cuts.values()]) (batch.mesh.material as MeshStandardNodeMaterial).dispose();
    this.batches.clear();
    this.cuts.clear();
    this.group.removeFromParent();
  }

  begin() {
    for (const list of this.batches.values()) for (const batch of list) batch.count = 0;
    for (const batch of this.cuts.values()) batch.count = 0;
  }

  private cutBatch(key: string) {
    let batch = this.cuts.get(key);
    if (batch || !this.assets[key]) return batch;
    const lod = this.assets[key]!.lods[0]!;
    const mk = () => {
      const attr = new InstancedBufferAttribute(new Float32Array(CUT_CAP * 4), 4);
      attr.setUsage(DynamicDrawUsage);
      return attr;
    };
    const a = mk();
    const b = mk();
    const c = mk();
    const mesh = new InstancedMesh(lod.geometry, createMaterial(lod.source, a, b, c), CUT_CAP);
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    batch = { mesh, a, b, c, count: 0 };
    this.cuts.set(key, batch);
    return batch;
  }

  /** cut: height in ship space above which the hull is cut away, or undefined for the whole ship. */
  add(key: string, lod: number, matrix: Matrix4, origin: Vector3, up: Vector3, burn: number, flash: number, cut?: number) {
    const batch = cut === undefined ? this.batches.get(key)?.[lod] : this.cutBatch(key);
    if (!batch || batch.count >= batch.mesh.instanceMatrix.count) return;
    if (batch.c) (batch.c.array as Float32Array)[batch.count * 4] = cut!;
    const i = batch.count++;
    batch.mesh.setMatrixAt(i, matrix);
    const A = batch.a.array as Float32Array;
    const B = batch.b.array as Float32Array;
    A[i * 4] = origin.x;
    A[i * 4 + 1] = origin.y;
    A[i * 4 + 2] = origin.z;
    A[i * 4 + 3] = burn;
    B[i * 4] = up.x;
    B[i * 4 + 1] = up.y;
    B[i * 4 + 2] = up.z;
    B[i * 4 + 3] = flash;
  }

  end() {
    for (const batch of [...[...this.batches.values()].flat(), ...this.cuts.values()]) {
      batch.mesh.count = batch.count;
      if (batch.count === 0) continue;
      batch.mesh.instanceMatrix.clearUpdateRanges();
      batch.mesh.instanceMatrix.addUpdateRange(0, batch.count * 16);
      batch.mesh.instanceMatrix.needsUpdate = true;
      for (const attr of batch.c ? [batch.a, batch.b, batch.c] : [batch.a, batch.b]) {
        attr.clearUpdateRanges();
        attr.addUpdateRange(0, batch.count * 4);
        attr.needsUpdate = true;
      }
    }
  }

  stats() {
    const out: Record<string, number[]> = {};
    for (const [k, list] of this.batches) out[k] = list.map((b) => b.count);
    return out;
  }
}
