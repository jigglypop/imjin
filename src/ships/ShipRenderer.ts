import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
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
  type WebGPURenderer,
} from 'three/webgpu';
import {
  atan,
  attribute,
  Discard,
  dFdx,
  dFdy,
  dot,
  float,
  floor,
  Fn,
  fract,
  frontFacing,
  If,
  instancedBufferAttribute,
  length,
  mix,
  mx_noise_float,
  normalLocal,
  normalMap,
  positionGeometry,
  positionLocal,
  positionWorld,
  select,
  sin,
  smoothstep,
  texture,
  time,
  uv,
  varying,
  vec2,
  vec3,
} from 'three/tsl';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import type { ShipKind } from '../sim/types';
import { SHIP_SPECS } from '../sim/catalog';
import { modelKind, type ShipAnchors } from './anchors';
import { useProcedural } from './build/mode';
import { SURF } from './build/surf';
import { loadProcedural } from './build/procedural';
import { equipment } from '../game/quality';
import { emberGlow, weather } from './weather';
import { charShading } from '../fx/fire/char';
import { disposeTree, freeAfterDraw } from '../render/dispose';
import { PHASE_RANGE, SWAY_RANGE, TINT_RANGE } from './build/pack';

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
  { kind: 'atakebune', variant: 1, base: '/models/atakebune_v2', axis: 'z', bow: 1, waterline: 0.12 },
  { kind: 'sekibune', variant: 0, base: '/models/sekibune_v2', axis: 'z', bow: 1, waterline: 0.11 },
  { kind: 'sekibune', variant: 1, base: '/models/sekibune_v2', axis: 'z', bow: 1, waterline: 0.11 },
  { kind: 'hyeopseon', variant: 0, base: '/models/hyeopseon', axis: 'z', bow: 1, waterline: 0.1 },
  { kind: 'kobaya', variant: 0, base: '/models/kobaya', axis: 'z', bow: 1, waterline: 0.11 },
  { kind: 'mingship', variant: 0, base: '/models/mingship', axis: 'z', bow: 1, waterline: 0.15 },
  { kind: 'mingsmall', variant: 0, base: '/models/mingsmall', axis: 'z', bow: 1, waterline: 0.1 },
  // The 1588 ships are procedural only; under ?ships=legacy they fall back to a Ming model (FALLBACK_MODEL).
  { kind: 'racegalleon', variant: 0, base: '', axis: 'z', bow: 1, waterline: 0.15 },
  { kind: 'racegalleon', variant: 1, base: '', axis: 'z', bow: 1, waterline: 0.15 },
  { kind: 'spgalleon', variant: 0, base: '', axis: 'z', bow: 1, waterline: 0.15 },
  { kind: 'spgalleon', variant: 1, base: '', axis: 'z', bow: 1, waterline: 0.15 },
  { kind: 'galleass', variant: 0, base: '', axis: 'z', bow: 1, waterline: 0.15 },
  { kind: 'urca', variant: 0, base: '', axis: 'z', bow: 1, waterline: 0.15 },
  { kind: 'pinnace', variant: 0, base: '', axis: 'z', bow: 1, waterline: 0.1 },
  { kind: 'fireship', variant: 0, base: '', axis: 'z', bow: 1, waterline: 0.1 },
];

export const FALLBACK_MODEL: Partial<Record<ShipKind, string>> = {
  hyeopseon: '/models/sekibune_v2',
  kobaya: '/models/sekibune_v2',
  mingship: '/models/atakebune_v2',
  mingsmall: '/models/sekibune_v2',
  racegalleon: '/models/mingship',
  spgalleon: '/models/mingship',
  galleass: '/models/mingship',
  urca: '/models/mingship',
  pinnace: '/models/mingsmall',
  fireship: '/models/mingsmall',
};

/** Detail levels a full model set has: near, mid, far. A model loaded without its near level has fewer. */
export const LOD_COUNT = 3;

/** What a phone can afford. `skipLod0` leaves the 2048 px near model out, `baseColorOnly` drops the normal and roughness maps. */
export type ShipAssetOptions = { skipLod0: boolean; baseColorOnly: boolean; anisotropy: number };

type ModelPart = { geometry: BufferGeometry; source: MeshStandardMaterial };
export type LodAsset = ModelPart & { parts?: ModelPart[] };
export type ModelAsset = { key: string; kind: ShipKind; variant: number; lods: LodAsset[]; bounds: Box3; anchors?: ShipAnchors };

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
async function loadScenes(base: string, options: ShipAssetOptions) {
  if (!options.skipLod0) return Promise.all([loadGltf(`${base}.glb`), loadGltf(`${base}_lod1.glb`).catch(() => null), loadGltf(`${base}_lod2.glb`).catch(() => null)]);
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

/** Exported in ship coordinates in Blender. Loading every required level first keeps the old head as a safe fallback. */
async function loadDragonHead(options: ShipAssetOptions): Promise<LodAsset[] | null> {
  const base = '/models/geobukseon_dragonhead_71';
  const suffixes = options.skipLod0 ? ['_lod1', '_lod2'] : ['', '_lod1', '_lod2'];
  try {
    const loaded = await Promise.allSettled(suffixes.map((suffix) => loadGltf(`${base}${suffix}.glb`)));
    const failed = loaded.find((result) => result.status === 'rejected');
    if (failed) {
      for (const result of loaded) if (result.status === 'fulfilled') disposeTree(result.value, true);
      throw failed.reason;
    }
    const scenes = loaded.map((result) => (result as PromiseFulfilledResult<Group>).value);
    const levels = scenes.map((scene) => {
      const mesh = findMesh(scene);
      const source = mesh.material as MeshStandardMaterial;
      source.userData.shipAttachment = true;
      source.userData.shipAnisotropy = options.anisotropy;
      if (options.baseColorOnly) trimMaterial(source);
      return { geometry: bake(mesh, mesh.matrixWorld), source };
    });
    return [0, 1, 2].map((level) => levels[options.skipLod0 ? Math.max(0, level - 1) : level]!);
  } catch (error) {
    console.warn('Dragon head unavailable; keeping the original complete ship.', error);
    return null;
  }
}

async function loadModel(spec: ShipModelSpec, options: ShipAssetOptions, isolated = false): Promise<ModelAsset> {
  if (useProcedural(spec.kind)) {
    // Built to SHIP_SPECS dimensions in ship space already: no orient/scale/waterline fit.
    const head = spec.kind === 'geobukseon' ? await loadDragonHead(options) : null;
    const p = await loadProcedural(spec.kind, spec.variant, !!head);
    if (isolated) {
      // Atlas textures outlive this scene; only a private material clone belongs to it.
      const source = p.lods[0]!.source.clone();
      source.userData.shipAnisotropy = options.anisotropy;
      for (const lod of p.lods) lod.source = source;
    }
    const bounds = p.lods[0]!.geometry.boundingBox!.clone();
    if (head) {
      for (let level = 0; level < p.lods.length; level++) (p.lods[level] as LodAsset).parts = [head[level]!];
      bounds.union(head[0]!.geometry.boundingBox!);
    }
    return { key: modelKey(spec.kind, spec.variant), kind: spec.kind, variant: spec.variant, lods: p.lods, bounds, anchors: p.anchors };
  }
  let base = spec.base;
  let scenes: (Group | null)[];
  try {
    scenes = await loadScenes(base, options);
  } catch (err) {
    const fallback = FALLBACK_MODEL[spec.kind];
    if (!fallback) throw err;
    base = fallback;
    scenes = await loadScenes(base, options);
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
    source.userData.shipAnisotropy = options.anisotropy;
    if (options.baseColorOnly) trimMaterial(source);
    lods.push({ geometry: bake(mesh, m), source });
  }
  if (options.baseColorOnly) {
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

/** The models a set of kinds is drawn with: a kind drawn with another's model loads that one, once. */
const modelsFor = (kinds: ShipKind[]) => {
  const models = new Set(kinds.map(modelKind));
  return SHIP_MODELS.filter((m) => models.has(modelKind(m.kind)));
};

export async function loadShipAssets(kinds: ShipKind[], options: ShipAssetOptions, onProgress?: (fraction: number) => void) {
  const specs = modelsFor(kinds);
  let loaded = 0;
  const list = await Promise.all(
    specs.map((s) => {
      let model = modelCache.get(modelKey(s.kind, s.variant));
      if (!model) {
        model = loadModel(s, options);
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

/** Separate renderers need fresh CPU geometry: uploading a battle asset may detach its arrays. */
export async function loadSceneShipAssets(kinds: ShipKind[], options: ShipAssetOptions) {
  const results = await Promise.allSettled(modelsFor(kinds).map(s => loadModel(s, options, true)));
  const assets = Object.fromEntries(results.flatMap(r => r.status === 'fulfilled' ? [[r.value.key, r.value]] : [])) as Record<string, ModelAsset>;
  const failed = results.find(r => r.status === 'rejected');
  if (failed) { disposeSceneShipAssets(assets); throw failed.reason; }
  return assets;
}

/** Scene-owned model geometry and GLTF textures, leaving the shared faction atlas untouched. */
export function disposeSceneShipAssets(assets: Record<string, ModelAsset>) {
  const levels = Object.values(assets).flatMap(a => a.lods.flatMap(l => [l, ...(l.parts ?? [])]));
  for (const geometry of new Set(levels.map(l => l.geometry))) geometry.dispose();
  const textures = new Set<Texture>();
  for (const source of new Set(levels.map(l => l.source))) {
    if (!source.userData.atlas) for (const value of Object.values(source)) if (value && (value as Texture).isTexture) textures.add(value as Texture);
    source.dispose();
  }
  for (const texture of textures) texture.dispose();
}

/** Frees the models no longer in `keep`: their geometry and textures. Call once the batches that drew them are gone. */
export async function releaseShipAssets(keep: Set<string>) {
  // Every dropped model leaves the cache at once: one that stayed in it while an earlier one was awaited could be
  // picked up by the next battle after its buffers were freed.
  const dropped = [...modelCache].filter(([key]) => !keep.has(key));
  for (const [key] of dropped) modelCache.delete(key);
  for (const [, pending] of dropped) {
    const asset = await pending.catch(() => null);
    if (!asset) continue;
    const levels = asset.lods.flatMap((lod) => [lod, ...(lod.parts ?? [])]);
    for (const geometry of new Set(levels.map((lod) => lod.geometry))) geometry.dispose();
    for (const source of new Set(levels.map((lod) => lod.source))) {
      for (const value of new Set(Object.values(source))) if (value && (value as Texture).isTexture) (value as Texture).dispose();
      source.dispose();
    }
  }
}

/** Steps the sail damage is kept in, in the whole part of the flash attribute (see packFlash). */
const TEAR_STEPS = 15;

/**
 * The flash attribute carries three things: the brief lift of a struck hull (the fraction), how torn and burnt the
 * ship's sails are (fx/Scars.ts, 0..1 in TEAR_STEPS steps) and a seed from the ship's id so that no two ships' sails
 * are holed alike (the whole part, tear x 16 + seed).
 */
export function packFlash(flash: number, tear: number, id: number) {
  return Math.round(Math.min(1, Math.max(0, tear)) * TEAR_STEPS) * 16 + (id % 16) + Math.min(0.999, Math.max(0, flash));
}

/**
 * Holes in a ship's sails and flags (cloth that sways): shot and arrow holes a hand or two across, more as the sails
 * are torn, and burnt-out patches up to a couple of metres with a charred rim, more as the ship's char grows. Cells in
 * model space each hold at most one hole, placed and sized from a hash of the cell and the ship's seed, so a hole
 * stays put and a ship's sails keep their own pattern. Returns how much a pixel is hole (1) and how much charred rim.
 */
function clothHoles(P: any, tear: any, char: any, seed: any) {
  const hash = (v: any, k: number) => fract(sin(dot(v, vec3(12.9898, 78.233, 37.719)).add(seed.mul(17.3).add(k))).mul(43758.5453));
  const layer = (size: number, r0: number, r1: number, density: any) => {
    const c = floor(P.div(size));
    const f = fract(P.div(size)).sub(0.5);
    const o = vec3(hash(c, 1), hash(c, 2), hash(c, 3)).sub(0.5).mul(0.3);
    const r = mix(float(r0), float(r1), hash(c, 4)).div(size);
    const d = f.sub(o);
    // A ragged edge: the radius wavers round the hole.
    const wave = sin(atan(d.y, d.z.add(d.x)).mul(7).add(hash(c, 5).mul(40))).mul(0.18).add(1);
    const at = length(d).div(r.mul(wave));
    const on = hash(c, 6).lessThan(density);
    return { at, on };
  };
  const shot = layer(0.9, 0.06, 0.2, tear.mul(0.75));
  const burnt = layer(2.6, 0.35, 0.95, smoothstep(0.08, 0.7, char).mul(0.7).add(tear.mul(0.25)));
  const hole = select(shot.on.and(shot.at.lessThan(1)), float(1), select(burnt.on.and(burnt.at.lessThan(1)), float(1), float(0)));
  const rim = select(burnt.on, float(1).sub(smoothstep(1, 1.45, burnt.at)), float(0)).max(select(shot.on, float(1).sub(smoothstep(1, 1.25, shot.at)), float(0)).mul(0.7));
  return { hole, rim };
}

/**
 * Hull material. With a cut attribute the hull is drawn as a section: everything above the cut height (in ship space)
 * is discarded and the inside faces show as raw timber, so the decks below can be seen.
 */
function createMaterial(src: MeshStandardMaterial, a: InstancedBufferAttribute, b: InstancedBufferAttribute, c?: InstancedBufferAttribute) {
  const m = new MeshStandardNodeMaterial();
  m.side = c ? DoubleSide : src.side;
  const atlas = src.userData.atlas as { grid: number; cell: number; pad: number } | undefined;
  if (src.normalMap && !atlas) {
    m.normalMap = src.normalMap;
    m.normalScale.copy(src.normalScale);
    src.normalMap.anisotropy = src.userData.shipAnisotropy ?? equipment.anisotropy;
  }
  m.metalness = 0;
  if (src.userData.shipAttachment) m.metalnessNode = src.metalnessMap ? texture(src.metalnessMap, uv()).b.mul(src.metalness) : float(src.metalness);
  m.roughness = 1;
  const map = src.map as Texture | null;
  if (map) map.anisotropy = src.userData.shipAnisotropy ?? equipment.anisotropy;
  const A: any = instancedBufferAttribute(a, 'vec4');
  const B: any = instancedBufferAttribute(b, 'vec4');
  const origin = A.xyz;
  const burn = A.w;
  const up = B.xyz;
  // Unpacked per vertex, where the instance's value is exact: interpolated to the pixels the packed number (up to 255)
  // comes out a hair off, so its fraction jumped between 0 and 1 from one triangle to the next and lit the cloth and
  // the roofs of a damaged ship in a checker of bright triangles.
  const flash: any = varying(fract(B.w));
  const packedWhole: any = varying(floor(B.w));
  const shipY = dot(positionWorld.sub(origin), up);
  let holeMask: any = null;
  let baseColor: any = map ? texture(map, uv()).rgb : vec3(src.color.r, src.color.g, src.color.b);
  let rough: any = src.roughnessMap ? texture(src.roughnessMap, uv()).g : float(0.85);
  let glow: any = vec3(0);
  if (atlas) {
    // Procedural ships: uv is in tile space (repeats per atlas cell, wrapped in the shader). The vertex attributes are
    // packed bytes, see procedural.ts: mat = (cell * 16 + surface class, sway phase high and low byte, soot), color = (tint, sway weight).
    // Each cell is a tile with a wrapped gutter, so the repeat happens here with explicit gradients to keep mip
    // selection seamless.
    const U: any = uv();
    const mat: any = attribute('mat', 'vec4');
    const packedColor: any = attribute('color', 'vec4');
    const cellSurf = mat.x.mul(255).add(0.5).floor();
    const cell = cellSurf.div(16).floor();
    const origin = vec2(cell.mod(atlas.grid), cell.div(atlas.grid).floor());
    const usable = (atlas.cell - atlas.pad * 2) / atlas.cell;
    const local = vec2(fract(U.x), float(1).sub(fract(U.y))).mul(usable).add(atlas.pad / atlas.cell);
    const auv = origin.add(local).div(atlas.grid);
    const k = usable / atlas.grid;
    const gx = dFdx(U).mul(k);
    const gy = dFdy(U).mul(k);
    const sample = (t: Texture) => texture(t, auv).grad(gx, gy);
    // The tint is sqrt-coded: it is decoded per vertex, so the interpolation across a triangle stays linear.
    const tint: any = varying(packedColor.xyz.mul(packedColor.xyz).mul(TINT_RANGE));
    const surf = cellSurf.sub(cell.mul(16));
    const soot: any = mat.w;
    const isCloth = surf.equal(1).or(surf.equal(4));
    const isMetal = surf.equal(2);
    rough = select(isCloth, float(0.95), sample(src.roughnessMap!).g);
    m.metalnessNode = select(isMetal, float(0.55), float(0));
    m.normalNode = normalMap(sample(src.normalMap!).rgb, vec2(1, 1));
    // Flags and sails flutter along their own normal; hull vertices have weight 0.
    const phase = mat.y.mul(255 * 256).add(mat.z.mul(255)).div(65535).sub(0.5).mul(PHASE_RANGE).add(positionGeometry.x.mul(0.9));
    const wave = sin(time.mul(3.1).add(phase)).add(sin(time.mul(5.3).add(phase.mul(1.7))).mul(0.4));
    m.positionNode = positionLocal.add(normalLocal.mul(wave.mul(packedColor.w.mul(SWAY_RANGE)).mul(0.2)));
    const worn = weather({ color: sample(map!).rgb.mul(tint), surf, soot, shipY, rough, detail: equipment.tier !== 'low' });
    baseColor = worn.color;
    rough = worn.rough;
    glow = emberGlow(surf, tint);
    // Shot-through and burnt sails (fx/Scars.ts): not on phones, where the cloth keeps its plain shading.
    if (equipment.tier !== 'low') {
      const whole = packedWhole.add(0.5).floor();
      const tear = floor(whole.div(16)).div(TEAR_STEPS);
      const seed = whole.mod(16);
      const holes = clothHoles(positionGeometry, tear, burn, seed);
      // Sails only: a flag or a pennant is too small for a hole a hand across, and cut up it hung in rags like scraps.
      const sails = surf.equal(SURF.cloth).and(packedColor.w.greaterThan(0.001));
      holeMask = select(sails, holes.hole, float(0));
      baseColor = mix(baseColor, vec3(0.035, 0.026, 0.02), select(sails, holes.rim, float(0)));
    }
  }
  const wet = float(1).sub(smoothstep(-0.1, 0.9, shipY));
  const under = float(1).sub(smoothstep(-0.9, -0.05, shipY));
  // Atlas ships get their waterline in weather(); the legacy models still need it here.
  const wetColor = atlas ? baseColor : baseColor.mul(mix(float(1), float(0.55), wet));
  const algae = atlas ? wetColor : mix(wetColor, wetColor.mul(vec3(0.42, 0.52, 0.36)), under.mul(0.85));
  const lit = charShading(burn, algae).mul(float(1).add(flash.mul(2)));
  if (c) {
    const C: any = instancedBufferAttribute(c, 'vec4');
    const grain = mx_noise_float(positionWorld.mul(vec3(0.8, 6, 0.8))).mul(0.5).add(0.5);
    const timber = mix(vec3(0.16, 0.1, 0.055), vec3(0.3, 0.2, 0.11), grain);
    m.colorNode = Fn(() => {
      If(shipY.greaterThan(C.x), () => {
        Discard();
      });
      if (holeMask) {
        If(holeMask.greaterThan(0.5), () => {
          Discard();
        });
      }
      return select(frontFacing, lit, timber);
    })();
  } else if (holeMask) {
    const mask = holeMask;
    m.colorNode = Fn(() => {
      If(mask.greaterThan(0.5), () => {
        Discard();
      });
      return lit;
    })();
  } else m.colorNode = lit;
  const wetRough = mix(rough.mul(0.95).add(0.05), float(0.25), wet.mul(0.8)).max(0.05);
  // Inside a section-cut hull the raw timber never got wet: without this the scoop of the hull bottom mirrors the sky.
  m.roughnessNode = c ? select(frontFacing, wetRough, float(0.9)) : wetRough;
  m.emissiveNode = glow;
  return m;
}

type Batch = { mesh: InstancedMesh; a: InstancedBufferAttribute; b: InstancedBufferAttribute; c?: InstancedBufferAttribute; count: number; parts?: Batch[]; renderer?: WebGPURenderer; released?: boolean };
const batchParts = (batch: Batch) => [batch, ...(batch.parts ?? [])];
/** Most ships one model can show in cutaway; the engine picks no more than this many in all. */
export const CUT_CAP = 12;

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
    const previous = this.batches.get(key) ?? [];
    this.buildKey(key);
    const next = this.batches.get(key)!;
    for (let level = 0; level < previous.length; level++) {
      const old = previous[level]!;
      const batch = next[level]!;
      // add() can grow a batch midway through a frame, after other ships have already submitted their poses.
      const nextParts = batchParts(batch);
      for (const [part, prior] of batchParts(old).entries()) {
        const target = nextParts[part]!;
        (target.mesh.instanceMatrix.array as Float32Array).set(prior.mesh.instanceMatrix.array);
        (target.a.array as Float32Array).set(prior.a.array);
        (target.b.array as Float32Array).set(prior.b.array);
        target.count = prior.count;
        target.mesh.count = prior.mesh.count;
      }
      this.release(old);
    }
  }

  private own(batch: Batch) {
    const uploaded = batch.mesh.onAfterRender;
    batch.mesh.onAfterRender = (...args) => {
      batch.renderer = args[0] as unknown as WebGPURenderer;
      uploaded.apply(batch.mesh, args);
    };
    (batch.mesh.material as MeshStandardNodeMaterial).addEventListener('dispose', () => {
      if (batch.released) return;
      batch.released = true;
      // Model geometry is shared and its CPU arrays may already be detached. Only this batch's buffers may die here.
      const attributes = (batch.renderer as unknown as { _attributes?: { delete(attribute: unknown): void } } | undefined)?._attributes;
      for (const attribute of [batch.mesh.instanceMatrix, batch.a, batch.b, ...(batch.c ? [batch.c] : [])]) attributes?.delete(attribute);
      batch.mesh.dispose();
    });
    return batch;
  }

  private release(batch: Batch) {
    for (const part of batchParts(batch)) {
      this.group.remove(part.mesh);
      if (!part.released) (part.mesh.material as MeshStandardNodeMaterial).dispose();
    }
  }

  private makeBatch(lod: LodAsset, cap: number, nominal: number, cut = false): Batch {
    // Static buffers, which end() marks changed over the range in use: sent once a frame. A dynamic buffer is sent
    // again by every pass that draws it (the shadow map, then the scene), and whole after the first.
    const mk = () => new InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    const a = mk();
    const b = mk();
    const c = cut ? mk() : undefined;
    const mesh = new InstancedMesh(lod.geometry, createMaterial(lod.source, a, b, c), cap);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.castShadow = nominal < 2;
    mesh.receiveShadow = nominal < 2;
    freeAfterDraw(mesh);
    this.group.add(mesh);
    const batch = this.own({ mesh, a, b, c, count: 0 });
    batch.parts = lod.parts?.map((part) => this.makeBatch(part, cap, nominal, cut));
    return batch;
  }

  private buildKey(key: string) {
    const asset = this.assets[key]!;
    const cap = Math.max(1, this.capacity.get(key) ?? 0);
    if (!this.capacity.get(key)) return;
    {
      this.batches.set(
        key,
        asset.lods.map((lod, level) => {
          // Shadows and shading from the two nearest of the three levels, counted as if the full set were there.
          const nominal = level + LOD_COUNT - asset.lods.length;
          return this.makeBatch(lod, cap, nominal);
        }),
      );
    }
  }

  /** Frees the hull materials of every batch. The geometry and textures belong to the shared models. */
  dispose() {
    for (const batch of [...[...this.batches.values()].flat(), ...this.cuts.values()]) this.release(batch);
    this.batches.clear();
    this.cuts.clear();
    this.group.removeFromParent();
  }

  begin() {
    for (const batch of [...[...this.batches.values()].flat(), ...this.cuts.values()]) for (const part of batchParts(batch)) part.count = 0;
  }

  private cutBatch(key: string) {
    let batch = this.cuts.get(key);
    if (batch || !this.assets[key]) return batch;
    const lod = this.assets[key]!.lods[0]!;
    batch = this.makeBatch(lod, CUT_CAP, 0, true);
    this.cuts.set(key, batch);
    return batch;
  }

  /** cut: height in ship space above which the hull is cut away, or undefined for the whole ship. */
  add(key: string, lod: number, matrix: Matrix4, origin: Vector3, up: Vector3, burn: number, flash: number, cut?: number) {
    let batch = cut === undefined ? this.batches.get(key)?.[lod] : this.cutBatch(key);
    if (cut === undefined && (!batch || batch.count >= batch.mesh.instanceMatrix.count)) {
      this.ensure(key, (batch?.count ?? 0) + 1);
      batch = this.batches.get(key)?.[lod];
    }
    if (!batch || batch.count >= batch.mesh.instanceMatrix.count) return;
    for (const part of batchParts(batch)) {
      if (part.c) (part.c.array as Float32Array)[part.count * 4] = cut!;
      const i = part.count++;
      part.mesh.setMatrixAt(i, matrix);
      const A = part.a.array as Float32Array;
      const B = part.b.array as Float32Array;
      A[i * 4] = origin.x;
      A[i * 4 + 1] = origin.y;
      A[i * 4 + 2] = origin.z;
      A[i * 4 + 3] = burn;
      B[i * 4] = up.x;
      B[i * 4 + 1] = up.y;
      B[i * 4 + 2] = up.z;
      B[i * 4 + 3] = flash;
    }
  }

  end() {
    for (const batch of [...[...this.batches.values()].flat(), ...this.cuts.values()].flatMap(batchParts)) {
      batch.mesh.count = batch.count;
      // Most batches hold no ship in a given frame (a model at the levels nobody is near or far enough for). Hidden, three
      // skips them; shown, it prepared each one and sent its buffers in every pass for nothing.
      batch.mesh.visible = batch.count > 0;
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
