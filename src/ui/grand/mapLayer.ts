import {
  AmbientLight, BoxGeometry, BufferAttribute, BufferGeometry, Color, DirectionalLight, DoubleSide, Float32BufferAttribute, Group, HemisphereLight,
  InstancedMesh, LinearMipmapLinearFilter, Material, Matrix4, MeshBasicMaterial, MeshBasicNodeMaterial, MeshStandardMaterial, MeshStandardNodeMaterial,
  PlaneGeometry, Quaternion, SRGBColorSpace, TextureLoader, Vector3, type Mesh, type Object3D, type Texture,
} from 'three/webgpu';
import { abs, attribute, dFdx, dFdy, float, fract, mix, mx_noise_float, positionGeometry, positionWorld, select, smoothstep, texture, uv, varying, vec2, vec3 } from 'three/tsl';
import { worldClock } from '../../select/terrain';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { disposeTree } from '../../render/dispose';
import { SHIP_SPECS } from '../../sim/catalog';
import type { ShipKind } from '../../sim/types';
import { modelKind } from '../../ships/anchors';
import { ATLAS, atlasFiles } from '../../ships/build/atlas';
import { weather } from '../../ships/weather';
import { MAP_ASPECT } from './projection';
import { buildCampKit, type KitMesh } from './campKits';
import { buildBoatKit, buildShipKit } from './shipKits';
import { campTier, faceSea, flagSpot, formation, HULL_LENGTH, pointAlong, SETTLEMENT_RADIUS, SHIP_CAP, settlementPieces, WATER_KINDS, type FleetSpec, type MapWorld, type Piece, type PieceKind, type SailSpec, type SettlementSpec } from './mapWorld';
import type { FactionId, ShipClass } from './types';

// The 3D layer of the campaign map: every navy's camps as the models made for them (public/models/camps, one per navy
// and camp tier, a close and a far level of detail; assets-src/camps-meshy-2026-10-13/README.md) and, where a fleet lies
// or sails, the battle's own ships of the kinds it has (src/ships/build, its middle and far levels, the battle's atlas
// and weathering), all instanced, so the whole layer is a few dozen draw calls. A camp whose model does not load is
// built from the procedural kits in campKits instead, and a ship that cannot be built is its navy's kit ship (shipKits),
// so a port is never left empty. Between turns the world keeps living: smoke rises from the larger camps and fishing
// boats drift off the coasts.

const R = SETTLEMENT_RADIUS;
/** The longest hull's length in frame units. */
const SHIP_LENGTH = R * HULL_LENGTH;
/** Ships this long in metres or longer (a panokseon, an atakebune) are SHIP_LENGTH on the map; shorter kinds in proportion. */
const FULL_LENGTH = 40;
/** A hull of this kind's length in frame units. */
const shipLength = (kind: ShipClass) => SHIP_LENGTH * Math.min(1, SHIP_SPECS[kind].length / FULL_LENGTH);
/** The ship a navy's squadron is drawn with when the kinds of its ships are not known (a replay's sailings). */
const MAIN_SHIP: Record<FactionId, ShipClass> = { joseon: 'panokseon', japan: 'atakebune', ming: 'mingship' };
/** Frame units of a flag pole above the ground, by camp level (a higher camp flies from a taller mast). */
const poleHeight = (level: number) => R * (0.6 + 0.12 * Math.min(level, 4));
/** The owner's ring round a camp: its radius in settlement radii and how many curb stones it is made of. */
const RING_RADIUS = 1.12;
const RING_STONES = 28;
/** Close up the ring is a dashed line of low markers hugging the ground: this many round a camp. */
const RING_MARKS = 64;
/** A fishing boat's length in frame units: a third of a warship's, so the two are never confused. */
const BOAT_LENGTH = R * 0.2;
/** At most this many fishing boats on the whole map, two off each camp's coast. */
const BOAT_CAP = 28;
/** A smoke plume's width and height in frame units. */
const PLUME = { w: R * 0.42, h: R * 1.4 };
/** Banner cloth and the owner's ring, by navy; saturated so it reads against the dark relief from the opening view. */
const BANNER: Record<FactionId, string> = { joseon: '#3f8cff', japan: '#e8452c', ming: '#f0b72a' };
/**
 * The camps' close models show once the camera stands at most this far from what it looks at (a camp is then over about
 * 100 pixels across on a desktop window); farther views draw the far models, the same outlines in a quarter of the
 * triangles with a quarter-size texture.
 */
const NEAR_DISTANCE = 0.3;
/**
 * A camp model's longer side, in settlement radii, and the least it shrinks to between close neighbours. Kept compact so a
 * camp marks its port without spreading over the coast round it.
 */
const CAMP_SPAN = 1.35;
const CAMP_SPAN_MIN = 0.95;

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

/** A camp model: its geometry in model units (longer side 1, the waterfront towards -z), its material and its height. */
type CampModel = { geometry: BufferGeometry; material: MeshStandardMaterial; width: number; depth: number; height: number };

const campUrl = (faction: FactionId, tier: number, far: boolean) => `/models/camps/camp_${faction}_${tier}${far ? '_far' : ''}.glb`;

const toFloat = (attr: BufferAttribute, size: number) => {
  const out = new Float32Array(attr.count * size);
  for (let i = 0; i < attr.count; i += 1) for (let c = 0; c < size; c += 1) out[i * size + c] = attr.getComponent(i, c);
  return new Float32BufferAttribute(out, size);
};

const freeCamp = (m: CampModel) => {
  m.geometry.dispose();
  for (const value of Object.values(m.material)) if (value && (value as Texture).isTexture) (value as Texture).dispose();
  m.material.dispose();
};

/**
 * A camp file's one mesh as float geometry in the file's frame. Its positions are quantised with the dequantising scale
 * on the node, so they are read through the node's world matrix; the frame is kept as it is (no turning: a camp's
 * waterfront is -z whichever of its sides is longer).
 */
async function loadCamp(url: string): Promise<CampModel | null> {
  try {
    const gltf = await loader.loadAsync(url);
    gltf.scene.updateMatrixWorld(true);
    let mesh: Mesh | null = null;
    gltf.scene.traverse((o: Object3D) => { if (!mesh && (o as Mesh).isMesh) mesh = o as Mesh; });
    const found = mesh as Mesh | null;
    if (!found) return null;
    const src = found.geometry;
    const geometry = new BufferGeometry();
    for (const [name, size] of [['position', 3], ['normal', 3], ['uv', 2]] as const) {
      const attr = src.getAttribute(name) as BufferAttribute | undefined;
      if (attr) geometry.setAttribute(name, toFloat(attr, size));
    }
    if (src.index) geometry.setIndex(src.index);
    geometry.applyMatrix4(found.matrixWorld);
    src.dispose();
    geometry.computeBoundingBox();
    const size = geometry.boundingBox!.getSize(new Vector3());
    const material = found.material as MeshStandardMaterial;
    // The bake is the whole look: a matte surface lit by the map's sun and sky, a touch brighter so it holds in the haze.
    material.roughness = 0.9;
    material.metalness = 0;
    material.color.setScalar(1.12);
    return { geometry, material, width: size.x, depth: size.z, height: size.y };
  } catch {
    return null;
  }
}

/** The battle's ship builder, loaded with the first fleet: the map needs the battle's code only for its ships. */
let builder: Promise<[typeof import('../../ships/build/ShipBuilder'), typeof import('../../ships/build/procedural')]> | null = null;
const shipBuilder = () => (builder ??= Promise.all([import('../../ships/build/ShipBuilder'), import('../../ships/build/procedural')]));

/**
 * A battle ship as the battle's own builder makes it: its middle level (banners, gun ports) for the close view and its far
 * level for the rest, both in ship space (bow +x, the waterline on y = 0, metres, which the battle's weathering reads),
 * and the turn and scale into the kits' frame: bow +z, one unit long, centred along its length and beam.
 */
async function shipLevels(kind: ShipKind) {
  const [{ buildShip }, { toGeometry }] = await shipBuilder();
  // One kind per task, so building a world's ships does not hold the page up in one piece.
  await new Promise((resolve) => setTimeout(resolve));
  const built = buildShip(kind, 0);
  const near = toGeometry(built.lods[1]!), far = toGeometry(built.lods[2]!);
  const box = far.boundingBox!;
  const length = box.max.x - box.min.x;
  const fix = new Matrix4().makeScale(1 / length, 1 / length, 1 / length)
    .multiply(new Matrix4().makeTranslation((box.min.z + box.max.z) / 2, 0, -(box.min.x + box.max.x) / 2))
    .multiply(new Matrix4().makeRotationY(-Math.PI / 2));
  return { near, far, fix, height: box.max.y / length };
}

/**
 * A navy's ship material: the battle's atlas (its 1k colour map only) read the way the battle reads it, each vertex
 * naming its atlas cell and repeating that cell's tile, shaded by the tint and occlusion the builder baked in and worn by
 * the battle's weathering; lit by the map's sun and sky like the camps.
 */
async function shipMaterial(faction: FactionId, tintRange: number) {
  const map = await new TextureLoader().loadAsync(atlasFiles(faction, true).albedo);
  map.colorSpace = SRGBColorSpace;
  // The atlas is addressed with v pointing down the image, as in the battle.
  map.flipY = false;
  map.minFilter = LinearMipmapLinearFilter;
  const material = new MeshStandardNodeMaterial({ roughness: 0.85, metalness: 0 });
  // Packed bytes, see procedural.ts: mat = (atlas cell * 16 + surface class, sway phase, soot), color.xyz = the sqrt-coded tint.
  const U: any = uv();
  const mat: any = attribute('mat', 'vec4');
  const shade: any = attribute('color', 'vec4');
  const cellSurf = mat.x.mul(255).add(0.5).floor();
  const cell = cellSurf.div(16).floor();
  const surf = cellSurf.sub(cell.mul(16));
  const usable = (ATLAS.cell - ATLAS.pad * 2) / ATLAS.cell;
  const local = vec2(fract(U.x), float(1).sub(fract(U.y))).mul(usable).add(ATLAS.pad / ATLAS.cell);
  const at = vec2(cell.mod(ATLAS.grid), cell.div(ATLAS.grid).floor()).add(local).div(ATLAS.grid);
  const k = usable / ATLAS.grid;
  const tint: any = varying(shade.xyz.mul(shade.xyz).mul(tintRange));
  const color = texture(map, at).grad(dFdx(U).mul(k), dFdy(U).mul(k)).rgb.mul(tint);
  const cloth = surf.equal(1).or(surf.equal(4));
  const worn = weather({ color, surf, soot: mat.w, shipY: positionGeometry.y, rough: select(cloth, float(0.95), float(0.8)), detail: false });
  material.colorNode = worn.color;
  material.roughnessNode = worn.rough;
  return { material, map };
}

/** A kit as geometry: positions, normals and vertex colours, indexed. */
function kitGeometry(kit: KitMesh) {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(kit.position, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(kit.normal, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(kit.color, 3));
  geometry.setIndex(new BufferAttribute(kit.position.length / 3 < 65536 ? Uint16Array.from(kit.index) : kit.index, 1));
  return geometry;
}

/**
 * A ship model: its close and far geometry, its material, `fix` taking its geometry into the kits' frame (bow +z, one unit
 * long) and its height over its length there (for sinking it).
 */
type ShipModel = { near: BufferGeometry; far: BufferGeometry; material: Material; fix: Matrix4; height: number };
/** A flag's cloth: its centre and size in frame units. */
type FlagSpot = { x: number; y: number; z: number; w: number; h: number };

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** The fleets that sail during a replay: a few hulls each along its way, put in place by `setSail`. */
interface Sailors {
  slots: { model: ShipModel; length: number; index: number; sail: SailSpec; along: number; across: number }[];
  /** Each model's close and far instances. */
  meshes: Map<ShipModel, InstancedMesh[]>;
  wake: InstancedMesh;
}

/**
 * The kit material (camps and ships), the wake's geometry and material, what flags are made of, the fishing boat and the
 * smoke plume: made on first use and kept across rebuilds.
 */
interface Shared {
  kit: MeshStandardMaterial; wake: MeshBasicMaterial; wakeGeometry: BufferGeometry; box: BoxGeometry; pole: MeshStandardMaterial; cloth: MeshBasicMaterial;
  boat: BufferGeometry; plume: PlaneGeometry; smoke: MeshBasicNodeMaterial;
}

/** A fishing boat circling slowly round a spot of open water: centre and radius in frame units, where it is on the circle and which way it goes. */
type Boat = { x: number; z: number; r: number; phase: number; dir: 1 | -1; speed: number };

/** A smoke plume's strip, one unit wide and tall from its foot at y = 0: it widens and leans downwind as it rises. */
function plumeGeometry() {
  const g = new PlaneGeometry(1, 1, 1, 6).translate(0, 0.5, 0);
  const pos = g.getAttribute('position') as BufferAttribute;
  for (let i = 0; i < pos.count; i += 1) {
    const rise = pos.getY(i);
    pos.setX(i, pos.getX(i) * (0.35 + 0.95 * rise) + rise * rise * 0.45);
  }
  return g;
}

/**
 * Camp smoke: a soft grey column on a camera-facing strip, broken into puffs that climb with the world's clock and thin
 * out to nothing at the top.
 */
function smokeMaterial() {
  const m = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  const rise = uv().y;
  const puffs = mx_noise_float(vec3(uv().x.mul(2.4).add(positionWorld.x.mul(60)), rise.mul(3.2).sub(worldClock.mul(0.28)), positionWorld.z.mul(60))).mul(0.5).add(0.5);
  const column = float(1).sub(smoothstep(0.18, 0.5, abs(uv().x.sub(0.5))));
  const ends = smoothstep(0, 0.12, rise).mul(float(1).sub(smoothstep(0.45, 1, rise)));
  m.colorNode = mix(vec3(0.62, 0.61, 0.6), vec3(0.86, 0.86, 0.85), rise);
  m.opacityNode = column.mul(ends).mul(smoothstep(0.2, 0.7, puffs)).mul(0.8);
  return m;
}

/** Camps and ships standing on the map terrain; `ground` gives the terrain height in frame units at a frame point. */
export class MapLayer {
  readonly group = new Group();
  private readonly lights = { sun: new DirectionalLight('#ffe9cf', 2.1), sky: new HemisphereLight('#cfdcec', '#2b3036', 1.5), fill: new AmbientLight('#ffffff', 0.35) };
  /** A navy's kit ship, built when a battle ship could not be. */
  private readonly kitShips = new Map<FactionId, ShipModel>();
  /** The battle ships by the kind they are built as, made when a world first needs them; null when one failed. */
  private readonly shipModels = new Map<ShipKind, Promise<ShipModel | null>>();
  private readonly builtShips = new Map<ShipKind, ShipModel | null>();
  /** Each navy's ship material and its atlas, made with its first ship. */
  private readonly shipMaterials = new Map<FactionId, Promise<{ material: MeshStandardNodeMaterial; map: Texture }>>();
  private readonly readyMaterials: { material: MeshStandardNodeMaterial; map: Texture }[] = [];
  private readonly kits = new Map<PieceKind, [BufferGeometry, BufferGeometry]>();
  /** Camp models by file, loaded when a world first needs them; null when a file failed (that camp is built from kits). */
  private readonly camps = new Map<string, Promise<CampModel | null>>();
  private readonly loadedCamps = new Map<string, CampModel | null>();
  /** What the close and the far view show: the camps' two levels of detail. */
  private readonly near = new Group();
  private readonly far = new Group();
  private generation = 0;
  private distance = 1;
  private readonly built: InstancedMesh[] = [];
  private shared: Shared | null = null;
  private flags: { mesh: InstancedMesh; spots: FlagSpot[] }[] = [];
  /**
   * The camps' flags, gathered while a build places them and made into instances at its end: `far` only from afar (a camp
   * model flies its own banners close up), `all` at every distance (a camp built from the kits has none of its own).
   */
  private flagSets = { far: { spots: [] as FlagSpot[], colors: [] as Color[], poles: [] as Matrix4[] }, all: { spots: [] as FlagSpot[], colors: [] as Color[], poles: [] as Matrix4[] } };
  private smoke: { mesh: InstancedMesh; spots: Vector3[] } | null = null;
  private boats: { mesh: InstancedMesh; list: Boat[] } | null = null;
  private clock = 0;
  private sailors: Sailors | null = null;
  private world: MapWorld | null = null;
  private shipTotal = 0;
  private sailShare = 0;
  private sailTime = 0;
  private yaw = 0;
  private stale = false;
  private disposed = false;

  constructor(private readonly ground: (u: number, v: number) => number, private readonly onChange: () => void) {
    this.group.add(this.lights.sun, this.lights.sky, this.lights.fill, this.near, this.far);
    this.far.visible = false;
    this.lights.sun.position.set(-0.55, 0.9, 0.5);
  }

  /**
   * Turns every flag's cloth to face the camera, which looks at the map from `yaw` (0 from the south, positive towards the
   * east), and shows the camps' close or far models by the camera's `distance` from what it looks at.
   */
  setView(yaw: number, distance: number) {
    this.distance = distance;
    this.near.visible = distance <= NEAR_DISTANCE;
    this.far.visible = !this.near.visible;
    if (Math.abs(yaw - this.yaw) < 1e-4 && !this.stale) return;
    this.yaw = yaw;
    this.stale = false;
    if (this.sailors) this.placeSailors();
    for (const flags of this.flags) {
      flags.spots.forEach((s, i) => flags.mesh.setMatrixAt(i, this.cloth(s)));
      flags.mesh.instanceMatrix.needsUpdate = true;
    }
    // The smoke strips turn to face the camera too.
    const smoke = this.smoke;
    if (smoke) {
      const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), this.yaw), size = new Vector3(PLUME.w, PLUME.h, 1);
      smoke.spots.forEach((p, i) => smoke.mesh.setMatrixAt(i, new Matrix4().compose(p, q, size)));
      smoke.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /** The world's clock in seconds: the fishing boats move on round their water. */
  tick(clock: number) {
    if (clock === this.clock && !this.stale) return;
    this.clock = clock;
    this.placeBoats();
  }

  private placeBoats() {
    const boats = this.boats;
    if (!boats) return;
    const up = new Vector3(0, 1, 0), size = new Vector3(BOAT_LENGTH, BOAT_LENGTH, BOAT_LENGTH);
    boats.list.forEach((b, i) => {
      const a = b.phase + b.dir * b.speed * this.clock;
      // Along the circle: the bow points the way it goes.
      const heading = Math.atan2(-Math.sin(a) * b.dir, Math.cos(a) * b.dir);
      boats.mesh.setMatrixAt(i, new Matrix4().compose(new Vector3(b.x + Math.cos(a) * b.r, 0, b.z + Math.sin(a) * b.r), new Quaternion().setFromAxisAngle(up, heading), size));
    });
    boats.mesh.instanceMatrix.needsUpdate = true;
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

  /**
   * The model a hull of `kind` is drawn with: the battle's own ship once built (the rebuild waits for it; an aliased kind
   * takes its model's), else the navy's kit ship, built on first use.
   */
  private ship(faction: FactionId, kind: ShipClass): ShipModel {
    const built = this.builtShips.get(modelKind(kind));
    if (built) return built;
    let m = this.kitShips.get(faction);
    if (!m) {
      const geometry = kitGeometry(buildShipKit(faction));
      geometry.computeBoundingBox();
      m = { near: geometry, far: geometry, material: this.resources.kit, fix: new Matrix4(), height: geometry.boundingBox!.max.y };
      this.kitShips.set(faction, m);
    }
    return m;
  }

  /** A navy's ship material, made on first use; one that arrives after the layer is gone is freed at once. */
  private shipMaterial(faction: FactionId) {
    let p = this.shipMaterials.get(faction);
    if (!p) {
      p = shipBuilder().then(([, { TINT_RANGE }]) => shipMaterial(faction, TINT_RANGE)).then((m) => {
        if (this.disposed) { m.material.dispose(); m.map.dispose(); } else this.readyMaterials.push(m);
        return m;
      });
      this.shipMaterials.set(faction, p);
    }
    return p;
  }

  /** The battle ship a kind is drawn with, built on first use; null when it could not be (that kind is the kit ship). */
  private shipModel(kind: ShipClass) {
    const key = modelKind(kind);
    let p = this.shipModels.get(key);
    if (!p) {
      p = Promise.all([shipLevels(key), this.shipMaterial(SHIP_SPECS[key].faction)]).then(([levels, { material }]) => {
        if (this.disposed) { levels.near.dispose(); levels.far.dispose(); return null; }
        const m = { ...levels, material };
        this.builtShips.set(key, m);
        return m;
      }, () => {
        this.builtShips.set(key, null);
        return null;
      });
      this.shipModels.set(key, p);
    }
    return p;
  }

  /** A camp file's model, loaded on first use; a model that arrives after the layer is gone is freed at once. */
  private camp(url: string) {
    let p = this.camps.get(url);
    if (!p) {
      p = loadCamp(url).then((m) => {
        if (this.disposed) { if (m) freeCamp(m); return null; }
        this.loadedCamps.set(url, m);
        return m;
      });
      this.camps.set(url, p);
    }
    return p;
  }

  private async rebuild() {
    const world = this.world;
    if (!world || this.disposed) return;
    const mine = ++this.generation;
    const urls = new Set(world.settlements.flatMap((s) => [false, true].map((far) => campUrl(s.owner, campTier(s.level), far))));
    const kinds = new Set([...world.fleets.flatMap((f) => (f.kinds.length ? f.kinds : [MAIN_SHIP[f.faction]])), ...world.sails.map((s) => MAIN_SHIP[s.faction])]);
    await Promise.all([...[...urls].map((url) => this.camp(url)), ...[...kinds].map((kind) => this.shipModel(kind))]);
    // A newer world or a dispose while the models were arriving makes this build stale.
    if (this.disposed || mine !== this.generation) return;
    this.clear();
    this.buildSettlements(world.settlements);
    this.buildShips(world.fleets);
    this.buildFlags();
    this.buildSailors(world.sails);
    this.stale = true;
    this.placeBoats();
    this.setView(this.yaw, this.distance);
    this.onChange();
  }

  private clear() {
    for (const mesh of this.built) { mesh.removeFromParent(); mesh.dispose(); }
    this.built.length = 0;
    this.flags = [];
    for (const set of Object.values(this.flagSets)) { set.spots = []; set.colors = []; set.poles = []; }
    this.smoke = null;
    this.boats = null;
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
        wake: new MeshBasicMaterial({ color: '#eef4f7', transparent: true, opacity: 0.35, depthWrite: false, side: DoubleSide }),
        wakeGeometry,
        box: new BoxGeometry(1, 1, 1),
        pole: new MeshStandardMaterial({ color: '#2a211a', roughness: 0.9 }),
        cloth: new MeshBasicMaterial({ color: '#ffffff' }),
        boat: kitGeometry(buildBoatKit()),
        plume: plumeGeometry(),
        smoke: smokeMaterial(),
      };
    }
    return this.shared;
  }

  /** A kind's close and far geometry, built on first use and shared by every camp after. */
  private kit(kind: PieceKind) {
    let g = this.kits.get(kind);
    if (!g) {
      g = [kitGeometry(buildCampKit(kind, 0)), kitGeometry(buildCampKit(kind, 1))];
      this.kits.set(kind, g);
    }
    return g;
  }

  /** A flag's cloth turned to face the camera. */
  private cloth(s: FlagSpot) {
    return new Matrix4().compose(new Vector3(s.x, s.y, s.z), new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), this.yaw), new Vector3(s.w, s.h, R * 0.02));
  }

  private pole(base: Vector3, height: number) {
    return new Matrix4().compose(new Vector3(base.x, base.y + height / 2, base.z), new Quaternion(), new Vector3(R * 0.03, height, R * 0.03));
  }

  /** The cloth `w` by `h` flying from the top of a pole `height` tall at `base`. */
  private clothSpot(base: Vector3, height: number, w: number, h: number): FlagSpot {
    return { x: base.x + w / 2, y: base.y + height - h * 0.65, z: base.z, w, h };
  }

  /** A pole and its cloth, made into instances by `buildFlags`; a `farOnly` flag shows only in the far view. */
  private flag(base: Vector3, height: number, w: number, h: number, color: Color, farOnly: boolean) {
    const set = farOnly ? this.flagSets.far : this.flagSets.all;
    set.poles.push(this.pole(base, height));
    set.spots.push(this.clothSpot(base, height, w, h));
    set.colors.push(color);
  }

  private buildFlags() {
    const { box, pole, cloth } = this.resources;
    for (const [set, parent] of [[this.flagSets.far, this.far], [this.flagSets.all, this.group]] as const) {
      this.add(box, pole, set.poles, undefined, parent);
      const mesh = this.add(box, cloth, set.spots.map(() => new Matrix4()), set.colors, parent);
      if (mesh) this.flags.push({ mesh, spots: set.spots });
    }
  }

  private buildSettlements(list: SettlementSpec[]) {
    const byKind = new Map<PieceKind, Matrix4[]>();
    const byModel = new Map<string, Matrix4[]>();
    const up = new Vector3(0, 1, 0);
    const loaded = this.loadedCamps;
    const curbM: Matrix4[] = [];
    const curbColors: Color[] = [];
    const markM: Matrix4[] = [];
    const markColors: Color[] = [];
    const smoke: Vector3[] = [];
    const boats: Boat[] = [];
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
      const ringColor = new Color(BANNER[s.owner]);
      const tier = campTier(s.level);
      const nearUrl = campUrl(s.owner, tier, false), farUrl = campUrl(s.owner, tier, true);
      const model = loaded.get(nearUrl);
      let ring = RING_RADIUS;
      if (model && loaded.get(farUrl)) {
        // The kits' dock side is -x after the turn; the model's waterfront is -z, so a quarter turn more brings it round.
        const angle = Math.PI / 2 - turn;
        // Two ports a camp apart (Yeosu and Bangdap) would run their camps together: each then keeps to its own side.
        const nearest = Math.min(...list.filter((o) => o !== s).map((o) => Math.hypot(o.u - s.u, (o.v - s.v) / MAP_ASPECT)));
        const span = Math.max(CAMP_SPAN_MIN, Math.min(CAMP_SPAN, (nearest / R) * 0.75));
        const size = span * R;
        const cos = Math.cos(angle), sin = Math.sin(angle);
        /** A point of the model's footprint, in model units, on the map. */
        const at = (lx: number, lz: number) => ({ x: cx + (lx * cos + lz * sin) * size, z: cz + (-lx * sin + lz * cos) * size });
        // It stands on the land under its footprint, between the highest ground there and the mean, sunk by about its
        // ground slab so the slab's edge and its open underside do not show on a slope; the waterfront over the water does
        // not lift it.
        const land: number[] = [];
        for (const fx of [-0.35, 0, 0.35]) for (const fz of [-0.35, 0, 0.35]) {
          const q = at(fx * model.width, fz * model.depth);
          const e = groundAt(q.x, q.z);
          if (e > 0) land.push(e);
        }
        const top = land.length ? Math.max(...land) : 0, mean = land.length ? land.reduce((a, b) => a + b, 0) / land.length : 0;
        const y = top * 0.6 + mean * 0.4 - R * 0.08;
        const matrix = new Matrix4().compose(new Vector3(cx, y, cz), new Quaternion().setFromAxisAngle(up, angle), new Vector3(size, size, size));
        for (const url of [nearUrl, farUrl]) {
          let b = byModel.get(url);
          if (!b) byModel.set(url, (b = []));
          b.push(matrix);
        }
        // The owner's flag flies from a mast at the land-side corner, just outside the walls, above the roofs.
        const f = at(0.5 * model.width + 0.04, 0.5 * model.depth + 0.04);
        const flagGround = Math.max(groundAt(f.x, f.z), 0);
        this.flag(new Vector3(f.x, flagGround, f.z), y + model.height * size - flagGround + R * 0.3, R * (0.3 + 0.02 * s.level), R * (0.2 + 0.015 * s.level), ringColor, true);
        ring = Math.max(RING_RADIUS, (Math.hypot(model.width, model.depth) / 2) * span + 0.06);
        // A larger camp's smoke rises from inside its walls, from about the height of its roofs.
        if (tier >= 2) {
          const c = at(-0.12 * model.width, 0.12 * model.depth);
          smoke.push(new Vector3(c.x, y + model.height * size * 0.45, c.z));
        }
      } else {
        for (const p of pieces) placePiece(p);
        const [fx, fz] = flagSpot(s.level, s.owner);
        const flagBase = new Vector3(cx + (fx * Math.cos(turn) - fz * Math.sin(turn)) * R, base - R * 0.02, cz + (fx * Math.sin(turn) + fz * Math.cos(turn)) * R);
        this.flag(flagBase, poleHeight(s.level), R * (0.4 + 0.03 * s.level), R * (0.26 + 0.02 * s.level), ringColor, false);
        if (tier >= 2) smoke.push(new Vector3(cx, base + R * 0.25, cz));
      }
      // Fishing boats off its coast: two spots of open water a little beyond the camp, each roomy enough to circle in.
      for (let k = 0; k < 2 && boats.length < BOAT_CAP; k += 1) {
        for (let tries = 0; tries < 12; tries += 1) {
          const a = (((seed >> (k * 4 + tries)) % 360) / 360) * Math.PI * 2 + tries * 0.9 + k * Math.PI;
          const d = (2.6 + ((seed >> (tries + 3)) % 10) * 0.08) * R;
          const bx = cx + Math.cos(a) * d, bz = cz + Math.sin(a) * d, r = R * 0.35;
          const open = [0, 1, 2, 3, 4, 5].every((i) => groundAt(bx + Math.cos(i * 1.05) * (r + R * 0.15), bz + Math.sin(i * 1.05) * (r + R * 0.15)) <= 0);
          if (!open || groundAt(bx, bz) > 0) continue;
          boats.push({ x: bx, z: bz, r, phase: a, dir: (seed >> (k + tries)) & 1 ? 1 : -1, speed: 0.025 + ((seed >> (k * 3)) % 5) * 0.004 });
          break;
        }
      }
      // The owner's ring: curb stones on the land round the camp, in the banner's colour, so whose it is reads from afar.
      const stone = ((2 * Math.PI * ring) / RING_STONES) * 1.1 * R;
      for (let i = 0; i < RING_STONES; i += 1) {
        const a = (i / RING_STONES) * Math.PI * 2;
        const x = cx + Math.cos(a) * ring * R, z = cz + Math.sin(a) * ring * R;
        const here = groundAt(x, z);
        if (here <= 0) continue;
        curbM.push(new Matrix4().compose(new Vector3(x, here, z), new Quaternion().setFromAxisAngle(up, -a + Math.PI / 2), new Vector3(stone, R * 0.1, R * 0.08)));
        curbColors.push(ringColor);
      }
      // Close up the same ring is a dashed line of low markers on the land, fine beside the camp's own walls.
      const mark = ((2 * Math.PI * ring) / RING_MARKS) * 0.35 * R;
      for (let i = 0; i < RING_MARKS; i += 1) {
        const a = (i / RING_MARKS) * Math.PI * 2;
        const x = cx + Math.cos(a) * ring * R, z = cz + Math.sin(a) * ring * R;
        const here = groundAt(x, z);
        if (here <= 0) continue;
        markM.push(new Matrix4().compose(new Vector3(x, here + R * 0.005, z), new Quaternion().setFromAxisAngle(up, -a + Math.PI / 2), new Vector3(mark, R * 0.03, R * 0.02)));
        markColors.push(ringColor);
      }

      function placePiece(p: Piece) {
        const x = cx + p.x * R, z = cz + p.z * R;
        const here = groundAt(x, z);
        const y = WATER_KINDS.has(p.kind) ? 0 : here > 0 ? here : base;
        const q = new Quaternion().setFromAxisAngle(up, p.rot);
        const size = p.size * R;
        bucket(p.kind).push(new Matrix4().compose(new Vector3(x, y - R * 0.02, z), q, new Vector3(size, size, size)));
      }
    }
    // One instanced draw per model file, and per kit kind and level of detail; `setView` shows the close or the far set.
    for (const [url, matrices] of byModel) {
      const m = loaded.get(url)!;
      this.add(m.geometry, m.material, matrices, undefined, url.endsWith('_far.glb') ? this.far : this.near);
    }
    for (const [kind, matrices] of byKind) {
      const [near, far] = this.kit(kind);
      this.add(near, this.resources.kit, matrices, undefined, this.near);
      this.add(far, this.resources.kit, matrices, undefined, this.far);
    }
    this.add(this.resources.box, this.resources.cloth, curbM, curbColors, this.far);
    this.add(this.resources.box, this.resources.cloth, markM, markColors, this.near);
    const { plume, smoke: smokeMat, boat, kit } = this.resources;
    const plumes = this.add(plume, smokeMat, smoke.map(() => new Matrix4()));
    if (plumes) this.smoke = { mesh: plumes, spots: smoke };
    const fishing = this.add(boat, kit, boats.map(() => new Matrix4()));
    if (fishing) this.boats = { mesh: fishing, list: boats };
  }

  /** A hull `length` long at (x, z) heading `angle` (from +z towards +x), `sink` ship heights under its waterline. */
  private hull(model: ShipModel, x: number, z: number, angle: number, length: number, sink = 0) {
    const y = this.ground(x + 0.5, z * MAP_ASPECT + 0.5) - model.height * length * sink;
    return new Matrix4().compose(new Vector3(x, y, z), new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), angle), new Vector3(length, length, length)).multiply(model.fix);
  }

  /** The wake behind a hull `length` long at (x, z) heading `angle`, `grow` of its full length; none where the hull crosses land. */
  private wake(x: number, z: number, angle: number, grow: number, length: number) {
    const ground = this.ground(x + 0.5, z * MAP_ASPECT + 0.5);
    const k = ground > 0 ? 0 : Math.max(0.001, grow);
    return new Matrix4().compose(new Vector3(x, ground + R * 0.004, z), new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), angle), new Vector3(length * k, length, length * k));
  }

  /** Where the hull of a squadron rides: `o` hull lengths from (x, z) along and across its heading `angle`. */
  private static offset(x: number, z: number, angle: number, o: { along: number; across: number }) {
    const fx = Math.sin(angle), fz = Math.cos(angle);
    return { x: x + (fx * o.along + fz * o.across) * SHIP_LENGTH, z: z + (fz * o.along - fx * o.across) * SHIP_LENGTH };
  }

  private buildShips(list: FleetSpec[]) {
    const per = new Map<ShipModel, Matrix4[]>();
    const wakes: Matrix4[] = [];
    /** The squadron's `i`th hull at (x, z) heading `angle`, as its own kind; its length on the map. */
    const place = (f: FleetSpec, i: number, x: number, z: number, angle: number) => {
      const kind = f.kinds[i] ?? MAIN_SHIP[f.faction];
      const model = this.ship(f.faction, kind), length = shipLength(kind);
      let matrices = per.get(model);
      if (!matrices) per.set(model, (matrices = []));
      matrices.push(this.hull(model, x, z, angle, length));
      return length;
    };
    for (const f of list) {
      if (this.shipTotal >= SHIP_CAP) break;
      const cx = f.u - 0.5, cz = (f.v - 0.5) / MAP_ASPECT;
      if (f.heading) {
        // A fleet on its lane: a wedge round its place on the lane (the marker sits on its middle), each hull with a wake.
        // In a narrow strait the wedge closes up until every hull, bow and stern, is on the water (or as close as it gets).
        const angle = Math.atan2(f.heading.du, f.heading.dv / MAP_ASPECT);
        const middle = Math.min(...formation(f.count).map((o) => o.along)) / 2;
        const wedgeAt = (k: number) => formation(f.count).map((o) => MapLayer.offset(cx, cz, angle, { along: (o.along - middle) * k, across: o.across * k }));
        const afloat = (p: { x: number; z: number }) => [-0.5, 0, 0.5].every((s) => this.ground(p.x + Math.sin(angle) * s * SHIP_LENGTH + 0.5, (p.z + Math.cos(angle) * s * SHIP_LENGTH) * MAP_ASPECT + 0.5) <= 0);
        const wedge = [1, 0.8, 0.6].map(wedgeAt).find((spots) => spots.every(afloat)) ?? wedgeAt(0.5);
        for (let i = 0; i < wedge.length && this.shipTotal < SHIP_CAP; i += 1) {
          const { x, z } = wedge[i]!;
          this.shipTotal += 1;
          wakes.push(this.wake(x, z, angle, 1, place(f, i, x, z, angle)));
        }
        continue;
      }
      for (let i = 0; i < f.berths.length && this.shipTotal < SHIP_CAP; i += 1) {
        const b = f.berths[i]!;
        this.shipTotal += 1;
        place(f, i, cx + b.x * R, cz + b.z * R, b.rot);
      }
    }
    // One instanced draw per ship model, close or far.
    for (const [model, matrices] of per) {
      this.add(model.near, model.material, matrices, undefined, this.near);
      this.add(model.far, model.material, matrices, undefined, this.far);
    }
    this.add(this.resources.wakeGeometry, this.resources.wake, wakes);
  }

  /** Hulls for the closed turn's sailings, in what is left of the ship cap; `setSail` puts them along their way. */
  private buildSailors(sails: SailSpec[]) {
    const slots: Sailors['slots'] = [];
    const counts = new Map<ShipModel, number>();
    for (const sail of sails) {
      const kind = MAIN_SHIP[sail.faction];
      const model = this.ship(sail.faction, kind), length = shipLength(kind);
      for (const o of formation(sail.count)) {
        if (this.shipTotal >= SHIP_CAP) break;
        this.shipTotal += 1;
        const index = counts.get(model) ?? 0;
        counts.set(model, index + 1);
        slots.push({ model, length, index, sail, along: o.along, across: o.across });
      }
    }
    if (!slots.length) {
      this.sailShare = 0;
      this.sailTime = 0;
      return;
    }
    const meshes = new Map<ShipModel, InstancedMesh[]>();
    const make = (geometry: BufferGeometry, material: Material, count: number, parent: Object3D = this.group) => {
      const mesh = new InstancedMesh(geometry, material, count);
      mesh.frustumCulled = false;
      parent.add(mesh);
      this.built.push(mesh);
      return mesh;
    };
    for (const [model, count] of counts) meshes.set(model, [make(model.near, model.material, count, this.near), make(model.far, model.material, count, this.far)]);
    const { wakeGeometry, wake } = this.resources;
    this.sailors = { slots, meshes, wake: make(wakeGeometry, wake, slots.length) };
    this.placeSailors();
  }

  private placeSailors() {
    const sailors = this.sailors;
    if (!sailors) return;
    // A lost fleet goes under in the replay's last stretch.
    const sinking = clamp01((this.sailTime - 0.85) / 0.15);
    sailors.slots.forEach((slot, i) => {
      const head = pointAlong(slot.sail.points, this.sailShare);
      const { x, z } = MapLayer.offset(head.x, head.z, head.angle, slot);
      const lost = slot.sail.lost ? sinking : 0;
      const matrix = this.hull(slot.model, x, z, head.angle, slot.length, lost * 1.2);
      for (const mesh of sailors.meshes.get(slot.model)!) mesh.setMatrixAt(slot.index, matrix);
      // The wake grows as the ship gets under way and is gone once it sinks.
      sailors.wake.setMatrixAt(i, this.wake(x, z, head.angle, lost > 0.3 ? 0 : clamp01(this.sailShare * 8), slot.length));
    });
    for (const mesh of [...[...sailors.meshes.values()].flat(), sailors.wake]) mesh.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.clear();
    for (const m of this.kitShips.values()) m.near.dispose();
    this.kitShips.clear();
    for (const m of this.builtShips.values()) { m?.near.dispose(); m?.far.dispose(); }
    this.builtShips.clear();
    this.shipModels.clear();
    for (const m of this.readyMaterials) { m.material.dispose(); m.map.dispose(); }
    this.readyMaterials.length = 0;
    this.shipMaterials.clear();
    for (const pair of this.kits.values()) for (const g of pair) g.dispose();
    this.kits.clear();
    for (const m of this.loadedCamps.values()) if (m) freeCamp(m);
    this.loadedCamps.clear();
    this.camps.clear();
    if (this.shared) for (const resource of Object.values(this.shared)) resource.dispose();
    this.shared = null;
    disposeTree(this.group, true);
  }
}
