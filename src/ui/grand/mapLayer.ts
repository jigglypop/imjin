import {
  AmbientLight, BoxGeometry, BufferAttribute, BufferGeometry, Color, DirectionalLight, Float32BufferAttribute, Group, HemisphereLight,
  InstancedMesh, Material, Matrix4, MeshBasicMaterial, MeshStandardMaterial, Quaternion, Vector3, type Mesh, type Object3D, type Texture,
} from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { disposeTree } from '../../render/dispose';
import { MAP_ASPECT } from './projection';
import { anchorage, faceSea, SETTLEMENT_RADIUS, settlementPieces, type FleetSpec, type MapWorld, type Piece, type PieceKind, type SettlementSpec } from './mapWorld';
import type { FactionId } from './types';

// The 3D layer of the campaign map: camps built from the battle terrain's village models (their low level, about 800
// triangles each) and a few hulls where a fleet lies, all instanced, so the whole layer is about a dozen draw calls.

const R = SETTLEMENT_RADIUS;
/** Longest hull dimension in frame units. */
const SHIP_LENGTH = R * 0.9;
/** At most this many hulls over the whole map, whatever the fleets. */
const SHIP_CAP = 140;
/** Frame units of a flag pole above the ground, by camp level (a higher camp flies from a taller mast). */
const poleHeight = (level: number) => R * (0.42 + 0.1 * Math.min(level, 4));

type ModelKind = Exclude<PieceKind, 'palisade' | 'stone'>;
const ENV_KINDS: ModelKind[] = ['choga', 'giwa', 'fortgate', 'bongsu', 'battery', 'dock', 'magazine', 'shipyard'];
/** One hull per navy: their lowest level, the same files the battle uses far away. */
const SHIP_FILES: Record<FactionId, string> = { joseon: 'panokseon_a_lod2', japan: 'sekibune_v2_lod2', ming: 'mingsmall_lod2' };
/** Banner cloth and a faint tint on the roofs, by owner; the Joseon kits are the only ones the game has, so the others lean on this. */
const BANNER: Record<FactionId, string> = { joseon: '#3f78bd', japan: '#c2402c', ming: '#d6a02e' };
const TINT: Record<FactionId, string> = { joseon: '#ffffff', japan: '#d9b9ae', ming: '#e6cf9c' };
const WALL_TONE: Record<'palisade' | 'stone', string> = { palisade: '#6b5238', stone: '#a9a49a' };
const WALL_SHAPE: Record<'palisade' | 'stone', { height: number; thickness: number }> = { palisade: { height: 0.06, thickness: 0.035 }, stone: { height: 0.11, thickness: 0.055 } };

type Model = { geometry: BufferGeometry; material: Material; height: number };

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

const toFloat = (attr: BufferAttribute, size: number) => {
  const out = new Float32Array(attr.count * size);
  for (let i = 0; i < attr.count; i += 1) {
    out[i * size] = attr.getX(i);
    if (size > 1) out[i * size + 1] = attr.getY(i);
    if (size > 2) out[i * size + 2] = attr.getZ(i);
  }
  return new Float32BufferAttribute(out, size);
};

/** The first mesh of a file, as float geometry standing on y = 0, centred, its longer horizontal side along z and one unit long. */
async function loadModel(url: string): Promise<Model | null> {
  try {
    const gltf = await loader.loadAsync(url);
    let mesh: Mesh | null = null;
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((o: Object3D) => { if (!mesh && (o as Mesh).isMesh) mesh = o as Mesh; });
    const found = mesh as Mesh | null;
    if (!found) return null;
    const src = found.geometry;
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', toFloat(src.getAttribute('position') as BufferAttribute, 3));
    if (src.getAttribute('normal')) geometry.setAttribute('normal', toFloat(src.getAttribute('normal') as BufferAttribute, 3));
    if (src.getAttribute('uv')) geometry.setAttribute('uv', toFloat(src.getAttribute('uv') as BufferAttribute, 2));
    if (src.index) geometry.setIndex(src.index);
    geometry.applyMatrix4(found.matrixWorld);
    geometry.computeBoundingBox();
    const box = geometry.boundingBox!;
    const size = box.getSize(new Vector3()), centre = box.getCenter(new Vector3());
    const turn = size.x > size.z ? Math.PI / 2 : 0;
    const longest = Math.max(size.x, size.z);
    geometry.translate(-centre.x, -box.min.y, -centre.z);
    geometry.rotateY(turn);
    geometry.scale(1 / longest, 1 / longest, 1 / longest);
    src.dispose();
    return { geometry, material: found.material as Material, height: size.y / longest };
  } catch {
    return null;
  }
}

const disposeMaterial = (m: Material) => {
  for (const value of Object.values(m)) if (value && (value as Texture).isTexture) (value as Texture).dispose();
  m.dispose();
};

/** Camps and ships standing on the map terrain; `ground` gives the terrain height in frame units at a frame point. */
export class MapLayer {
  readonly group = new Group();
  private readonly lights = { sun: new DirectionalLight('#ffe9cf', 2.1), sky: new HemisphereLight('#cfdcec', '#2b3036', 1.5), fill: new AmbientLight('#ffffff', 0.35) };
  private readonly models = new Map<string, Promise<Model | null>>();
  private readonly loaded = new Map<string, Model>();
  private readonly built: InstancedMesh[] = [];
  private flags: { mesh: InstancedMesh; spots: { x: number; y: number; z: number; w: number; h: number }[] } | null = null;
  private owned: { dispose(): void }[] = [];
  private world: MapWorld | null = null;
  private generation = 0;
  private yaw = 0;
  private stale = false;
  private disposed = false;

  constructor(private readonly ground: (u: number, v: number) => number, private readonly onChange: () => void) {
    this.group.add(this.lights.sun, this.lights.sky, this.lights.fill);
    this.lights.sun.position.set(-0.55, 0.9, 0.5);
  }

  /** Keeps the light where it is on screen while the map turns, and every flag's cloth facing the camera. */
  setYaw(yaw: number) {
    if (Math.abs(yaw - this.yaw) < 1e-4 && !this.stale) return;
    this.yaw = yaw;
    this.stale = false;
    this.lights.sun.position.set(-0.55, 0.9, 0.5).applyAxisAngle(new Vector3(0, 1, 0), -yaw);
    const flags = this.flags;
    if (!flags) return;
    const turn = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -yaw);
    const m = new Matrix4();
    flags.spots.forEach((s, i) => flags.mesh.setMatrixAt(i, m.compose(new Vector3(s.x, s.y, s.z), turn, new Vector3(s.w, s.h, R * 0.02))));
    flags.mesh.instanceMatrix.needsUpdate = true;
  }

  set(world: MapWorld) {
    this.world = world;
    void this.rebuild();
  }

  private model(key: string, url: string) {
    let p = this.models.get(key);
    if (!p) {
      p = loadModel(url).then((m) => { if (m) this.loaded.set(key, m); return m; });
      this.models.set(key, p);
    }
    return p;
  }

  private async rebuild() {
    const world = this.world;
    if (!world || this.disposed) return;
    const mine = ++this.generation;
    const wanted = new Map<string, string>();
    for (const s of world.settlements) for (const p of settlementPieces(s.level)) if (p.kind !== 'palisade' && p.kind !== 'stone') wanted.set(p.kind, `/models/env/${p.kind}_lod1.glb`);
    for (const f of world.fleets) wanted.set(f.faction, `/models/${SHIP_FILES[f.faction]}.glb`);
    await Promise.all([...wanted].map(([key, url]) => this.model(key, url)));
    // A newer set() or a dispose while the models were arriving makes this build stale.
    if (this.disposed || mine !== this.generation) return;
    this.clear();
    this.buildSettlements(world.settlements);
    this.buildShips(world.fleets);
    this.stale = true;
    this.setYaw(this.yaw);
    this.onChange();
  }

  private clear() {
    for (const mesh of this.built) { mesh.removeFromParent(); mesh.dispose(); }
    this.built.length = 0;
    this.flags = null;
    for (const m of this.owned) m.dispose();
    this.owned = [];
  }

  private add(geometry: BufferGeometry, material: Material, matrices: Matrix4[], colors?: Color[]) {
    if (!matrices.length) return null;
    const mesh = new InstancedMesh(geometry, material, matrices.length);
    matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
    colors?.forEach((c, i) => mesh.setColorAt(i, c));
    mesh.frustumCulled = false;
    this.group.add(mesh);
    this.built.push(mesh);
    return mesh;
  }

  private buildSettlements(list: SettlementSpec[]) {
    const byKind = new Map<string, { m: Matrix4[]; c: Color[] }>();
    const up = new Vector3(0, 1, 0);
    const flagSpots: { x: number; y: number; z: number; w: number; h: number }[] = [];
    const flagColors: Color[] = [];
    const poleM: Matrix4[] = [];
    const bucket = (key: string) => {
      let b = byKind.get(key);
      if (!b) byKind.set(key, (b = { m: [], c: [] }));
      return b;
    };
    for (const s of list) {
      const cx = s.u - 0.5, cz = (s.v - 0.5) / MAP_ASPECT;
      const groundAt = (x: number, z: number) => this.ground(x + 0.5, z * MAP_ASPECT + 0.5);
      const seaAt = (x: number, z: number) => groundAt(cx + x * R, cz + z * R) <= 0;
      let base = groundAt(cx, cz);
      for (const [dx, dz] of [[0.5, 0], [-0.5, 0], [0, 0.5], [0, -0.5]] as const) base = Math.max(base, groundAt(cx + dx * R, cz + dz * R));
      const seed = [...s.id].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);
      const { pieces } = faceSea(settlementPieces(s.level), seed, seaAt);
      const tint = new Color(TINT[s.owner]);
      for (const p of pieces) placePiece(p);
      const flagBase = new Vector3(cx, base - R * 0.02, cz);
      const pole = poleHeight(s.level);
      poleM.push(new Matrix4().compose(new Vector3(flagBase.x, flagBase.y + pole / 2, flagBase.z), new Quaternion(), new Vector3(R * 0.026, pole, R * 0.026)));
      flagSpots.push({ x: flagBase.x + R * (0.12 + 0.01 * s.level), y: flagBase.y + pole - R * 0.13, z: flagBase.z, w: R * (0.24 + 0.02 * s.level), h: R * (0.15 + 0.01 * s.level) });
      flagColors.push(new Color(BANNER[s.owner]));

      function placePiece(p: Piece) {
        const x = cx + p.x * R, z = cz + p.z * R;
        const water = p.kind === 'dock' || p.kind === 'shipyard';
        const here = groundAt(x, z);
        const y = water ? 0 : here > 0 ? here : base;
        const q = new Quaternion().setFromAxisAngle(up, p.rot);
        if (p.kind === 'palisade' || p.kind === 'stone') {
          const shape = WALL_SHAPE[p.kind];
          const h = shape.height * R;
          const b = bucket(p.kind);
          b.m.push(new Matrix4().compose(new Vector3(x, y + h / 2 - R * 0.02, z), q, new Vector3(p.size * R, h, shape.thickness * R)));
          return;
        }
        const b = bucket(p.kind);
        const size = p.size * R;
        b.m.push(new Matrix4().compose(new Vector3(x, y - R * 0.02, z), q, new Vector3(size, size, size)));
        b.c.push(tint);
      }
    }
    for (const kind of ENV_KINDS) {
      const model = this.loaded.get(kind), b = byKind.get(kind);
      if (model && b) this.add(model.geometry, model.material, b.m, b.c);
    }
    for (const tone of ['palisade', 'stone'] as const) {
      const b = byKind.get(tone);
      if (!b) continue;
      const material = new MeshStandardMaterial({ color: WALL_TONE[tone], roughness: 0.95, metalness: 0 });
      const geometry = new BoxGeometry(1, 1, 1);
      this.owned.push(material, geometry);
      this.add(geometry, material, b.m);
    }
    const poles = new BoxGeometry(1, 1, 1);
    const poleMaterial = new MeshStandardMaterial({ color: '#2a211a', roughness: 0.9 });
    const clothMaterial = new MeshBasicMaterial({ color: '#ffffff' });
    this.owned.push(poles, poleMaterial, clothMaterial);
    this.add(poles, poleMaterial, poleM);
    const cloth = this.add(poles, clothMaterial, flagSpots.map(() => new Matrix4()), flagColors);
    if (cloth) this.flags = { mesh: cloth, spots: flagSpots };
  }

  private buildShips(list: FleetSpec[]) {
    const per = new Map<FactionId, Matrix4[]>();
    let total = 0;
    for (const f of list) {
      const model = this.loaded.get(f.faction);
      if (!model || total >= SHIP_CAP) continue;
      const cx = f.u - 0.5, cz = (f.v - 0.5) / MAP_ASPECT;
      const matrices = per.get(f.faction) ?? [];
      per.set(f.faction, matrices);
      const sink = -model.height * SHIP_LENGTH * 0.18;
      const spots = f.heading
        ? [{ x: 0, z: 0, rot: Math.atan2(f.heading.du, f.heading.dv / MAP_ASPECT) }]
        : anchorage(f.count, f.seed, (x, z) => this.ground(cx + x * R + 0.5, (cz + z * R) * MAP_ASPECT + 0.5) <= 0);
      for (const spot of spots.slice(0, f.heading ? 1 : f.count)) {
        if (total >= SHIP_CAP) break;
        total += 1;
        matrices.push(new Matrix4().compose(new Vector3(cx + spot.x * R, sink, cz + spot.z * R), new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), spot.rot), new Vector3(SHIP_LENGTH, SHIP_LENGTH, SHIP_LENGTH)));
      }
    }
    for (const [faction, matrices] of per) {
      const model = this.loaded.get(faction);
      if (model) this.add(model.geometry, model.material, matrices);
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.clear();
    for (const m of this.loaded.values()) {
      m.geometry.dispose();
      disposeMaterial(m.material);
    }
    this.loaded.clear();
    this.models.clear();
    disposeTree(this.group, true);
  }
}
