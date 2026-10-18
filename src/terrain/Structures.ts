import { Box3, Group, InstancedMesh, Matrix4, Quaternion, Vector3, type BufferGeometry, type Camera, type Material, type Mesh, type Object3D } from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import type { Structure, StructureType } from './features';
import type { Terrain } from './Terrain';
import { equipment } from '../game/quality';

const SIZE: Record<StructureType, number> = { choga: 13, giwa: 17, fortgate: 48, bongsu: 24 };
const NEAR = 420;

type Model = { geometry: BufferGeometry; material: Material; base: Matrix4 };
type Item = { m: Matrix4; fm: Matrix4; x: number; z: number };
/** `isNear` says which items the near model drew when the batch was last placed; `placed` is false until the first time. */
type Batch = { near: InstancedMesh; far: InstancedMesh; items: Item[]; isNear: Uint8Array; placed: boolean };

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

function firstMesh(root: Object3D) {
  let found: Mesh | null = null;
  root.traverse((o) => {
    if (!found && (o as Mesh).isMesh) found = o as Mesh;
  });
  return found as Mesh | null;
}

// Shared by every battle: the village models are the same wherever they stand.
const models = new Map<string, Promise<Model | null>>();

function loadModel(type: StructureType, suffix: string) {
  const key = type + suffix;
  let model = models.get(key);
  if (!model) {
    model = fetchModel(type, suffix);
    models.set(key, model);
  }
  return model;
}

async function fetchModel(type: StructureType, suffix: string): Promise<Model | null> {
  try {
    const gltf = await loader.loadAsync(`/models/env/${type}${suffix}.glb`);
    const mesh = firstMesh(gltf.scene);
    if (!mesh) return null;
    gltf.scene.updateMatrixWorld(true);
    const geometry = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
    geometry.computeBoundingBox();
    const box = geometry.boundingBox as Box3;
    const size = box.getSize(new Vector3());
    const center = box.getCenter(new Vector3());
    const scale = SIZE[type] / Math.max(size.x, size.z);
    const base = new Matrix4().makeScale(scale, scale, scale).multiply(new Matrix4().makeTranslation(-center.x, -box.min.y - size.y * 0.04, -center.z));
    return { geometry, material: mesh.material as Material, base };
  } catch {
    return null;
  }
}

/** Fetches every village model into the cache, so a battle's own load finds them there instead of waiting for the terrain first. */
export async function preloadStructures() {
  await Promise.all((Object.keys(SIZE) as StructureType[]).map((type) => Promise.all([equipment.ships.skipLod0 ? null : loadModel(type, ''), loadModel(type, '_lod1')])));
}

export class Structures {
  readonly group = new Group();
  private readonly batches: Batch[] = [];
  private disposed = false;
  ready = false;

  constructor(private readonly terrain: Terrain) {}

  async load() {
    if (this.disposed) return;
    const byType = new Map<StructureType, Structure[]>();
    for (const s of this.terrain.structures) {
      const list = byType.get(s.type) ?? [];
      list.push(s);
      byType.set(s.type, list);
    }
    await Promise.all(
      [...byType.entries()].map(async ([type, list]) => {
        // Phones skip the 1024 px near model: the low level is built for 30 m and more, and small on a phone screen.
        const [full, lod1] = await Promise.all([equipment.ships.skipLod0 ? null : loadModel(type, ''), loadModel(type, '_lod1')]);
        const lod0 = full ?? lod1 ?? (await loadModel(type, ''));
        if (this.disposed || !lod0) return;
        const far = lod1 ?? lod0;
        const near = new InstancedMesh(lod0.geometry, lod0.material, list.length);
        const farMesh = new InstancedMesh(far.geometry, far.material, list.length);
        const items: Item[] = list.map((s) => {
          const place = new Matrix4().compose(new Vector3(s.x, s.y - 0.4, s.z), new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), s.rot), new Vector3(s.s, s.s, s.s));
          return { m: place.clone().multiply(lod0.base), fm: place.clone().multiply(far.base), x: s.x, z: s.z };
        });
        for (const mesh of [near, farMesh]) {
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          // Culled by the sphere around the houses it holds (recomputed whenever they change), in the main and the shadow pass.
          mesh.count = 0;
          this.group.add(mesh);
        }
        this.batches.push({ near, far: farMesh, items, isNear: new Uint8Array(items.length), placed: false });
      }),
    );
    this.ready = !this.disposed;
  }

  /** Frees the instance buffers. The models themselves stay cached for the next battle. */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.ready = false;
    for (const b of this.batches) {
      b.near.dispose();
      b.far.dispose();
    }
    this.batches.length = 0;
    this.group.removeFromParent();
    this.group.clear();
  }

  update(camera: Camera) {
    if (!this.ready) return;
    const s = this.terrain.toScenario(camera.position.x, camera.position.z);
    const camY = camera.position.y;
    for (const b of this.batches) {
      // The houses do not move: their matrices are only rewritten, and sent, when one crosses between the two models.
      let changed = !b.placed;
      for (let i = 0; i < b.items.length; i += 1) {
        const it = b.items[i]!;
        const near = Math.hypot(it.x - s.x, it.z - s.z, camY) < NEAR ? 1 : 0;
        if (b.isNear[i] !== near) changed = true;
        b.isNear[i] = near;
      }
      if (!changed) continue;
      b.placed = true;
      let n = 0;
      let f = 0;
      for (let i = 0; i < b.items.length; i += 1) {
        const it = b.items[i]!;
        if (b.isNear[i]) b.near.setMatrixAt(n++, it.m);
        else b.far.setMatrixAt(f++, it.fm);
      }
      b.near.count = n;
      b.far.count = f;
      // A model with no house at its range is not drawn at all.
      b.near.visible = n > 0;
      b.far.visible = f > 0;
      b.near.instanceMatrix.needsUpdate = true;
      b.far.instanceMatrix.needsUpdate = true;
      if (n > 0) b.near.computeBoundingSphere();
      if (f > 0) b.far.computeBoundingSphere();
    }
  }
}
