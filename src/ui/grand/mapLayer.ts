import {
  AmbientLight, BoxGeometry, BufferAttribute, BufferGeometry, Color, DirectionalLight, DoubleSide, Float32BufferAttribute, Group, HemisphereLight,
  InstancedMesh, LOD, Material, Matrix4, MeshBasicMaterial, MeshStandardMaterial, Quaternion, Vector3, type Camera, type Mesh, type Object3D,
  type OrthographicCamera, type Texture,
} from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { disposeTree } from '../../render/dispose';
import { MAP_ASPECT } from './projection';
import { buildCampKit, type KitLod } from './campKits';
import { anchorage, faceSea, flagSpot, formation, pointAlong, SETTLEMENT_RADIUS, SHIP_CAP, settlementPieces, WATER_KINDS, type FleetSpec, type MapWorld, type Piece, type PieceKind, type SailSpec, type SettlementSpec } from './mapWorld';
import type { FactionId } from './types';

// The 3D layer of the campaign map: every navy's camps built from the procedural kits in campKits (tiled roofs from the
// ships' roof generators, a close and a far level of detail) and a few hulls where a fleet lies or sails, all instanced,
// so the whole layer is a few dozen draw calls.

const R = SETTLEMENT_RADIUS;
/** Longest hull dimension in frame units. */
const SHIP_LENGTH = R * 1.1;
/** Frame units of a flag pole above the ground, by camp level (a higher camp flies from a taller mast). */
const poleHeight = (level: number) => R * (0.6 + 0.12 * Math.min(level, 4));
/** The owner's ring round a camp: its radius in settlement radii and how many curb stones it is made of. */
const RING_RADIUS = 1.12;
const RING_STONES = 28;
/** The flag a squadron's leader flies: pole height above the water and cloth size, in hull lengths. */
const SHIP_FLAG = { pole: 0.75, w: 0.42, h: 0.28 };

/** One hull per navy: their lowest level, the same files the battle uses far away. */
const SHIP_FILES: Record<FactionId, string> = { joseon: 'panokseon_a_lod2', japan: 'sekibune_v2_lod2', ming: 'mingsmall_lod2' };
/** Banner cloth and the owner's ring, by navy; saturated so it reads against the dark relief from the opening view. */
const BANNER: Record<FactionId, string> = { joseon: '#3f8cff', japan: '#e8452c', ming: '#f0b72a' };
/**
 * The camps' close-up kits show once the view is at most this many frame units across (a camp then spans about 50 pixels
 * of a desktop window); wider views draw the far kits, the same outlines in about a third of the triangles.
 */
const NEAR_VIEW = 0.5;

/** The camps' two levels of detail: three calls `update` with the camera before it draws the children. */
class KitLevels extends LOD {
  readonly near = new Group();
  readonly far = new Group();

  constructor() {
    super();
    this.add(this.near, this.far);
  }

  override update(camera: Camera) {
    const c = camera as OrthographicCamera;
    this.near.visible = !c.isOrthographicCamera || (c.right - c.left) / c.zoom <= NEAR_VIEW;
    this.far.visible = !this.near.visible;
  }
}

/** A kit as geometry: positions, normals and vertex colours, indexed. */
function kitGeometry(kind: PieceKind, lod: KitLod) {
  const kit = buildCampKit(kind, lod);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(kit.position, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(kit.normal, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(kit.color, 3));
  geometry.setIndex(new BufferAttribute(kit.position.length / 3 < 65536 ? Uint16Array.from(kit.index) : kit.index, 1));
  return geometry;
}

type Model = { geometry: BufferGeometry; material: Material; height: number };
/** A flag's cloth: its centre and size in frame units. */
type FlagSpot = { x: number; y: number; z: number; w: number; h: number };

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

/**
 * The first mesh of a file, as float geometry standing on y = 0, centred, its longer horizontal side along z and one unit
 * long. A hull is modelled with its bow at +x, so `bow` turns that end to +z, the way `hull` heads it.
 */
async function loadModel(url: string, bow: boolean): Promise<Model | null> {
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
    const turn = size.x > size.z ? (bow ? -Math.PI / 2 : Math.PI / 2) : 0;
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

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** The fleets that sail during a replay: a few hulls each along its way, put in place by `setSail`; each leader flies its navy's flag. */
interface Sailors {
  slots: { faction: FactionId; index: number; sail: SailSpec; along: number; across: number }[];
  meshes: Map<FactionId, InstancedMesh>;
  wake: InstancedMesh;
  poles: InstancedMesh;
  cloth: InstancedMesh;
}

/** The kit material, the wake's geometry and material and what flags are made of: made on first use and kept across rebuilds. */
interface Shared { kit: MeshStandardMaterial; wake: MeshBasicMaterial; wakeGeometry: BufferGeometry; box: BoxGeometry; pole: MeshStandardMaterial; cloth: MeshBasicMaterial }

/** Camps and ships standing on the map terrain; `ground` gives the terrain height in frame units at a frame point. */
export class MapLayer {
  readonly group = new Group();
  private readonly lights = { sun: new DirectionalLight('#ffe9cf', 2.1), sky: new HemisphereLight('#cfdcec', '#2b3036', 1.5), fill: new AmbientLight('#ffffff', 0.35) };
  private readonly models = new Map<string, Promise<Model | null>>();
  private readonly loaded = new Map<string, Model>();
  private readonly kits = new Map<PieceKind, [BufferGeometry, BufferGeometry]>();
  private readonly levels = new KitLevels();
  private readonly built: InstancedMesh[] = [];
  private shared: Shared | null = null;
  private flags: { mesh: InstancedMesh; spots: FlagSpot[] } | null = null;
  /** The flags of camps and of fleets on their lanes, gathered while a build places them and made into instances at its end. */
  private flagSpots: FlagSpot[] = [];
  private flagColors: Color[] = [];
  private poleMatrices: Matrix4[] = [];
  private sailors: Sailors | null = null;
  private world: MapWorld | null = null;
  private shipTotal = 0;
  private sailShare = 0;
  private sailTime = 0;
  private generation = 0;
  private yaw = 0;
  private stale = false;
  private disposed = false;

  constructor(private readonly ground: (u: number, v: number) => number, private readonly onChange: () => void) {
    this.group.add(this.lights.sun, this.lights.sky, this.lights.fill, this.levels);
    this.lights.sun.position.set(-0.55, 0.9, 0.5);
  }

  /** Keeps the light where it is on screen while the map turns, and every flag's cloth facing the camera. */
  setYaw(yaw: number) {
    if (Math.abs(yaw - this.yaw) < 1e-4 && !this.stale) return;
    this.yaw = yaw;
    this.stale = false;
    this.lights.sun.position.set(-0.55, 0.9, 0.5).applyAxisAngle(new Vector3(0, 1, 0), -yaw);
    if (this.sailors) this.placeSailors();
    const flags = this.flags;
    if (!flags) return;
    flags.spots.forEach((s, i) => flags.mesh.setMatrixAt(i, this.cloth(s)));
    flags.mesh.instanceMatrix.needsUpdate = true;
  }

  set(world: MapWorld) {
    this.world = world;
    void this.rebuild();
  }

  /** The closed turn's sailings at `share` of their way (0 to 1) and the replay's clock `time` (0 to 1.2; lost ships go under near its end). */
  setSail(share: number, time: number) {
    this.sailShare = share;
    this.sailTime = time;
    if (!this.sailors) return;
    this.placeSailors();
    this.onChange();
  }

  private model(key: string, url: string) {
    let p = this.models.get(key);
    if (!p) {
      p = loadModel(url, key in SHIP_FILES).then((m) => { if (m) this.loaded.set(key, m); return m; });
      this.models.set(key, p);
    }
    return p;
  }

  private async rebuild() {
    const world = this.world;
    if (!world || this.disposed) return;
    const mine = ++this.generation;
    const wanted = new Map<string, string>();
    for (const f of world.fleets) wanted.set(f.faction, `/models/${SHIP_FILES[f.faction]}.glb`);
    for (const s of world.sails) wanted.set(s.faction, `/models/${SHIP_FILES[s.faction]}.glb`);
    await Promise.all([...wanted].map(([key, url]) => this.model(key, url)));
    // A newer set() or a dispose while the models were arriving makes this build stale.
    if (this.disposed || mine !== this.generation) return;
    this.clear();
    this.buildSettlements(world.settlements);
    this.buildShips(world.fleets);
    this.buildFlags();
    this.buildSailors(world.sails);
    this.stale = true;
    this.setYaw(this.yaw);
    this.onChange();
  }

  private clear() {
    for (const mesh of this.built) { mesh.removeFromParent(); mesh.dispose(); }
    this.built.length = 0;
    this.flags = null;
    this.flagSpots = [];
    this.flagColors = [];
    this.poleMatrices = [];
    this.sailors = null;
    this.shipTotal = 0;
  }

  private add(geometry: BufferGeometry, material: Material, matrices: Matrix4[], colors?: Color[], parent: Object3D = this.group) {
    if (!matrices.length) return null;
    const mesh = new InstancedMesh(geometry, material, matrices.length);
    matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
    colors?.forEach((c, i) => mesh.setColorAt(i, c));
    mesh.frustumCulled = false;
    parent.add(mesh);
    this.built.push(mesh);
    return mesh;
  }

  private get resources(): Shared {
    if (!this.shared) {
      // A wake is two thin arms of foam spreading from the stern, under a hull long: a broad sheet reads as a searchlight.
      const wakeGeometry = new BufferGeometry();
      const arm = (side: number) => [0, 0, -0.47, side * 0.3, 0, -1.3, side * 0.21, 0, -1.3];
      wakeGeometry.setAttribute('position', new Float32BufferAttribute([...arm(1), ...arm(-1)], 3));
      this.shared = {
        kit: new MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 }),
        wake: new MeshBasicMaterial({ color: '#eef4f7', transparent: true, opacity: 0.5, depthWrite: false, side: DoubleSide }),
        wakeGeometry,
        box: new BoxGeometry(1, 1, 1),
        pole: new MeshStandardMaterial({ color: '#2a211a', roughness: 0.9 }),
        cloth: new MeshBasicMaterial({ color: '#ffffff' }),
      };
    }
    return this.shared;
  }

  /** A kind's close and far geometry, built on first use and shared by every camp after. */
  private kit(kind: PieceKind) {
    let g = this.kits.get(kind);
    if (!g) {
      g = [kitGeometry(kind, 0), kitGeometry(kind, 1)];
      this.kits.set(kind, g);
    }
    return g;
  }

  /** A flag's cloth turned to face the camera. */
  private cloth(s: FlagSpot) {
    return new Matrix4().compose(new Vector3(s.x, s.y, s.z), new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -this.yaw), new Vector3(s.w, s.h, R * 0.02));
  }

  private pole(base: Vector3, height: number) {
    return new Matrix4().compose(new Vector3(base.x, base.y + height / 2, base.z), new Quaternion(), new Vector3(R * 0.03, height, R * 0.03));
  }

  /** The cloth `w` by `h` flying from the top of a pole `height` tall at `base`. */
  private clothSpot(base: Vector3, height: number, w: number, h: number): FlagSpot {
    return { x: base.x + w / 2, y: base.y + height - h * 0.65, z: base.z, w, h };
  }

  /** A pole and its cloth, made into instances by `buildFlags`. */
  private flag(base: Vector3, height: number, w: number, h: number, color: Color) {
    this.poleMatrices.push(this.pole(base, height));
    this.flagSpots.push(this.clothSpot(base, height, w, h));
    this.flagColors.push(color);
  }

  private buildFlags() {
    const { box, pole, cloth } = this.resources;
    this.add(box, pole, this.poleMatrices);
    const mesh = this.add(box, cloth, this.flagSpots.map(() => new Matrix4()), this.flagColors);
    if (mesh) this.flags = { mesh, spots: this.flagSpots };
  }

  private buildSettlements(list: SettlementSpec[]) {
    const byKind = new Map<PieceKind, Matrix4[]>();
    const up = new Vector3(0, 1, 0);
    const curbM: Matrix4[] = [];
    const curbColors: Color[] = [];
    const bucket = (key: PieceKind) => {
      let b = byKind.get(key);
      if (!b) byKind.set(key, (b = []));
      return b;
    };
    for (const s of list) {
      const cx = s.u - 0.5, cz = (s.v - 0.5) / MAP_ASPECT;
      const groundAt = (x: number, z: number) => this.ground(x + 0.5, z * MAP_ASPECT + 0.5);
      const seaAt = (x: number, z: number) => groundAt(cx + x * R, cz + z * R) <= 0;
      let base = groundAt(cx, cz);
      for (const [dx, dz] of [[0.5, 0], [-0.5, 0], [0, 0.5], [0, -0.5]] as const) base = Math.max(base, groundAt(cx + dx * R, cz + dz * R));
      const seed = [...s.id].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);
      const { pieces, turn } = faceSea(settlementPieces(s.level, s.owner), seed, seaAt);
      for (const p of pieces) placePiece(p);
      // The owner's ring: curb stones on the land round the camp, in the banner's colour, so whose it is reads from afar.
      const ringColor = new Color(BANNER[s.owner]);
      const stone = ((2 * Math.PI * RING_RADIUS) / RING_STONES) * 1.1 * R;
      for (let i = 0; i < RING_STONES; i += 1) {
        const a = (i / RING_STONES) * Math.PI * 2;
        const x = cx + Math.cos(a) * RING_RADIUS * R, z = cz + Math.sin(a) * RING_RADIUS * R;
        const here = groundAt(x, z);
        if (here <= 0) continue;
        curbM.push(new Matrix4().compose(new Vector3(x, here, z), new Quaternion().setFromAxisAngle(up, -a + Math.PI / 2), new Vector3(stone, R * 0.1, R * 0.08)));
        curbColors.push(ringColor);
      }
      const [fx, fz] = flagSpot(s.level, s.owner);
      const flagBase = new Vector3(cx + (fx * Math.cos(turn) - fz * Math.sin(turn)) * R, base - R * 0.02, cz + (fx * Math.sin(turn) + fz * Math.cos(turn)) * R);
      this.flag(flagBase, poleHeight(s.level), R * (0.4 + 0.03 * s.level), R * (0.26 + 0.02 * s.level), ringColor);

      function placePiece(p: Piece) {
        const x = cx + p.x * R, z = cz + p.z * R;
        const here = groundAt(x, z);
        const y = WATER_KINDS.has(p.kind) ? 0 : here > 0 ? here : base;
        const q = new Quaternion().setFromAxisAngle(up, p.rot);
        const size = p.size * R;
        bucket(p.kind).push(new Matrix4().compose(new Vector3(x, y - R * 0.02, z), q, new Vector3(size, size, size)));
      }
    }
    // One instanced draw per kind and level of detail; the levels object shows one of the two.
    for (const [kind, matrices] of byKind) {
      const [near, far] = this.kit(kind);
      this.add(near, this.resources.kit, matrices, undefined, this.levels.near);
      this.add(far, this.resources.kit, matrices, undefined, this.levels.far);
    }
    this.add(this.resources.box, this.resources.cloth, curbM, curbColors);
  }

  /** A hull at (x, z) heading `angle` (from +z towards +x), `sink` hull heights under its usual waterline. */
  private hull(model: Model, x: number, z: number, angle: number, sink = 0) {
    const y = this.ground(x + 0.5, z * MAP_ASPECT + 0.5) - model.height * SHIP_LENGTH * (0.18 + sink);
    return new Matrix4().compose(new Vector3(x, y, z), new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), angle), new Vector3(SHIP_LENGTH, SHIP_LENGTH, SHIP_LENGTH));
  }

  /** The wake behind a hull at (x, z) heading `angle`, `grow` of its full length; none where the hull crosses land. */
  private wake(x: number, z: number, angle: number, grow: number) {
    const ground = this.ground(x + 0.5, z * MAP_ASPECT + 0.5);
    const k = ground > 0 ? 0 : Math.max(0.001, grow);
    return new Matrix4().compose(new Vector3(x, ground + R * 0.004, z), new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), angle), new Vector3(SHIP_LENGTH * k, SHIP_LENGTH, SHIP_LENGTH * k));
  }

  /** Where the hull of a squadron rides: `o` hull lengths from (x, z) along and across its heading `angle`. */
  private static offset(x: number, z: number, angle: number, o: { along: number; across: number }) {
    const fx = Math.sin(angle), fz = Math.cos(angle);
    return { x: x + (fx * o.along + fz * o.across) * SHIP_LENGTH, z: z + (fz * o.along - fx * o.across) * SHIP_LENGTH };
  }

  private buildShips(list: FleetSpec[]) {
    const per = new Map<FactionId, Matrix4[]>();
    const wakes: Matrix4[] = [];
    for (const f of list) {
      const model = this.loaded.get(f.faction);
      if (!model || this.shipTotal >= SHIP_CAP) continue;
      const cx = f.u - 0.5, cz = (f.v - 0.5) / MAP_ASPECT;
      const matrices = per.get(f.faction) ?? [];
      per.set(f.faction, matrices);
      if (f.heading) {
        // A fleet on its lane: a wedge round its place on the lane (the marker sits on its middle), each hull with a wake,
        // the leader flying the navy's flag.
        // In a narrow strait the wedge closes up until every hull is on the water (or as close as it gets).
        const angle = Math.atan2(f.heading.du, f.heading.dv / MAP_ASPECT);
        const middle = Math.min(...formation(f.count).map((o) => o.along)) / 2;
        const wedgeAt = (k: number) => formation(f.count).map((o) => MapLayer.offset(cx, cz, angle, { along: (o.along - middle) * k, across: o.across * k }));
        const wedge = [1, 0.7].map(wedgeAt).find((spots) => spots.every((p) => this.ground(p.x + 0.5, p.z * MAP_ASPECT + 0.5) <= 0)) ?? wedgeAt(0.5);
        wedge.forEach(({ x, z }, k) => {
          if (this.shipTotal >= SHIP_CAP) return;
          this.shipTotal += 1;
          matrices.push(this.hull(model, x, z, angle));
          wakes.push(this.wake(x, z, angle, 1));
          if (k === 0) this.flag(new Vector3(x, this.ground(x + 0.5, z * MAP_ASPECT + 0.5), z),SHIP_FLAG.pole * SHIP_LENGTH, SHIP_FLAG.w * SHIP_LENGTH, SHIP_FLAG.h * SHIP_LENGTH, new Color(BANNER[f.faction]));
        });
        continue;
      }
      const spots = anchorage(f.count, f.seed, (x, z) => this.ground(cx + x * R + 0.5, (cz + z * R) * MAP_ASPECT + 0.5) <= 0);
      for (const spot of spots.slice(0, f.count)) {
        if (this.shipTotal >= SHIP_CAP) break;
        this.shipTotal += 1;
        matrices.push(this.hull(model, cx + spot.x * R, cz + spot.z * R, spot.rot));
      }
    }
    for (const [faction, matrices] of per) {
      const model = this.loaded.get(faction);
      if (model) this.add(model.geometry, model.material, matrices);
    }
    this.add(this.resources.wakeGeometry, this.resources.wake, wakes);
  }

  /** Hulls for the closed turn's sailings, in what is left of the ship cap; `setSail` puts them along their way. */
  private buildSailors(sails: SailSpec[]) {
    const slots: Sailors['slots'] = [];
    const counts = new Map<FactionId, number>();
    const leaders: SailSpec[] = [];
    for (const sail of sails) {
      if (!this.loaded.get(sail.faction)) continue;
      for (const o of formation(sail.count)) {
        if (this.shipTotal >= SHIP_CAP) break;
        this.shipTotal += 1;
        const index = counts.get(sail.faction) ?? 0;
        counts.set(sail.faction, index + 1);
        if (o.along === 0 && o.across === 0) leaders.push(sail);
        slots.push({ faction: sail.faction, index, sail, along: o.along, across: o.across });
      }
    }
    if (!slots.length) {
      this.sailShare = 0;
      this.sailTime = 0;
      return;
    }
    const meshes = new Map<FactionId, InstancedMesh>();
    const make = (geometry: BufferGeometry, material: Material, count: number) => {
      const mesh = new InstancedMesh(geometry, material, count);
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.built.push(mesh);
      return mesh;
    };
    for (const [faction, count] of counts) {
      const model = this.loaded.get(faction)!;
      meshes.set(faction, make(model.geometry, model.material, count));
    }
    const { box, pole, cloth, wakeGeometry, wake } = this.resources;
    const flags = make(box, cloth, leaders.length);
    leaders.forEach((sail, i) => flags.setColorAt(i, new Color(BANNER[sail.faction])));
    this.sailors = { slots, meshes, wake: make(wakeGeometry, wake, slots.length), poles: make(box, pole, leaders.length), cloth: flags };
    this.placeSailors();
  }

  private placeSailors() {
    const sailors = this.sailors;
    if (!sailors) return;
    // A lost fleet goes under in the replay's last stretch.
    const sinking = clamp01((this.sailTime - 0.85) / 0.15);
    let leader = 0;
    sailors.slots.forEach((slot, i) => {
      const model = this.loaded.get(slot.faction)!;
      const head = pointAlong(slot.sail.points, this.sailShare);
      const { x, z } = MapLayer.offset(head.x, head.z, head.angle, slot);
      const lost = slot.sail.lost ? sinking : 0;
      sailors.meshes.get(slot.faction)!.setMatrixAt(slot.index, this.hull(model, x, z, head.angle, lost * 1.2));
      // The wake grows as the ship gets under way and is gone once it sinks.
      sailors.wake.setMatrixAt(i, this.wake(x, z, head.angle, lost > 0.3 ? 0 : clamp01(this.sailShare * 8)));
      if (slot.along === 0 && slot.across === 0) {
        // The leader's flag goes down with it.
        const height = SHIP_FLAG.pole * SHIP_LENGTH;
        const base = new Vector3(x, this.ground(x + 0.5, z * MAP_ASPECT + 0.5) - lost * height * 1.3, z);
        sailors.poles.setMatrixAt(leader, this.pole(base, height));
        sailors.cloth.setMatrixAt(leader, this.cloth(this.clothSpot(base, height, SHIP_FLAG.w * SHIP_LENGTH, SHIP_FLAG.h * SHIP_LENGTH)));
        leader += 1;
      }
    });
    for (const mesh of [...sailors.meshes.values(), sailors.wake, sailors.poles, sailors.cloth]) mesh.instanceMatrix.needsUpdate = true;
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
    for (const pair of this.kits.values()) for (const g of pair) g.dispose();
    this.kits.clear();
    if (this.shared) for (const resource of Object.values(this.shared)) resource.dispose();
    this.shared = null;
    disposeTree(this.group, true);
  }
}
