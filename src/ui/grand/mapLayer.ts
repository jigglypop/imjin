import {
  AmbientLight, BufferAttribute, BufferGeometry, Color, DirectionalLight, DoubleSide, Float32BufferAttribute, Group, HemisphereLight,
  InstancedMesh, LinearMipmapLinearFilter, Material, Matrix4, Mesh, MeshBasicMaterial, MeshBasicNodeMaterial, MeshStandardMaterial,
  MeshStandardNodeMaterial, PlaneGeometry, Quaternion, SRGBColorSpace, TextureLoader, Vector3, type Object3D, type Texture,
} from 'three/webgpu';
import {
  abs, attribute, dFdx, dFdy, float, fract, mix, mx_noise_float, positionGeometry, positionWorld, select, smoothstep, texture, uv,
  varying, vec2, vec3,
} from 'three/tsl';
import { worldClock } from '../../select/terrain';
import demMeta from '../../select/demMeta.json';
import { disposeTree } from '../../render/dispose';
import { SHIP_SPECS } from '../../sim/catalog';
import type { ShipKind } from '../../sim/types';
import { modelKind } from '../../ships/anchors';
import { ATLAS, atlasFiles } from '../../ships/build/atlas';
import { TINT_RANGE, toGeometry } from '../../ships/build/pack';
import { weather } from '../../ships/weather';
import { MAP_ASPECT } from './projection';
import { DEM_RECT } from './mapMath';
import { buildCampBuilding } from './campBuildings';
import { campMaterial } from './campMaterial';
import { FOOTPRINT, METRES_PER_RADIUS, navyOf, WALL_KINDS, WATER_KINDS, type PieceKind } from './campPieces';
import { buildBoatKit, buildShipKit, type KitMesh } from './shipKits';
import { formation, hash, HULL_LENGTH, pointAlong, SETTLEMENT_RADIUS, SHIP_CAP, type FleetSpec, type MapWorld, type Piece, type SailSpec, type SettlementSpec } from './mapWorld';
import type { FactionId, ShipClass } from './types';
import { HeroLayer, heroUses, tierUses, type HeroUse } from './hero/layer';
import { heroEnabled } from './hero/site';

// The 3D layer of the campaign map: every port's places (mapWorld.ts) built from the settlement buildings
// (campBuildings.ts, made like the battle's ships on each navy's texture atlas) standing on the drawn ground, the yards,
// lanes and fields they leave bare laid over it, and, where a fleet lies or sails, the battle's own ships of the kinds it
// has (src/ships/build, its middle and far levels, the battle's atlas and weathering). All instanced, one draw per kind
// and level of detail, so the whole layer is a few dozen draw calls; a ship that cannot be built is its navy's kit ship
// (shipKits). Whose a place is, its owner's standard says (campPieces.ts STANDARD). Between turns the world keeps living:
// smoke rises from a hearth of every town and of the larger camps, and fishing boats drift off the coasts.

const R = SETTLEMENT_RADIUS;
/** The longest hull's length in frame units. */
const SHIP_LENGTH = R * HULL_LENGTH;
/** Ships this long in metres or longer (a panokseon, an atakebune) are SHIP_LENGTH on the map; shorter kinds in proportion. */
const FULL_LENGTH = 40;
/** A hull of this kind's length in frame units. */
const shipLength = (kind: ShipClass) => SHIP_LENGTH * Math.min(1, SHIP_SPECS[kind].length / FULL_LENGTH);
/** The ship a navy's squadron is drawn with when the kinds of its ships are not known (a replay's sailings). */
const MAIN_SHIP: Record<FactionId, ShipClass> = { joseon: 'panokseon', japan: 'atakebune', ming: 'mingship' };
/** A fishing boat's length in frame units: a third of a warship's, so the two are never confused. */
const BOAT_LENGTH = R * 0.2;
/** At most this many fishing boats on the whole map, two off each camp's coast. */
const BOAT_CAP = 28;
/** A smoke plume's width and height in frame units: a hearth's, about twenty metres of the model tall. */
const PLUME = { w: R * 0.16, h: R * 0.5 };
/** The houses of a town: one of them smokes when the town has more than three, and each differs a little in size and shade. */
const HOMES: ReadonlySet<PieceKind> = new Set<PieceKind>(['giwa', 'choga', 'wa_house']);
/** What a camp's smoke can rise from: its halls, barracks, houses and tents, not its towers, stores or gates. */
const HEARTHS: ReadonlySet<PieceKind> = new Set<PieceKind>([...HOMES, 'hall', 'wa_hall', 'mg_hall', 'mg_barracks', 'wa_tent', 'mg_tent']);
/**
 * The buildings' close models show once the camera stands at most this far from what it looks at (a camp is then over
 * about 160 pixels across on a desktop window); farther views draw the far models, the same outlines in about a third of
 * the triangles.
 */
const NEAR_DISTANCE = 0.3;
/** Yards, lanes and fields float this far over the drawn ground (frame units), so the relief never shows through them. */
const DECAL_LIFT = R * 0.005;
/** The packed earth of a camp's yard by navy, the lanes' earth, and a paddy's and a dry field's two shades. */
const YARD: Record<FactionId, string> = { joseon: '#9c8865', japan: '#968d7a', ming: '#928671' };
const LANE = '#bba57f';
const FIELD = { paddy: ['#86a04a', '#9cb25a'], dry: ['#a79a58', '#8f8248'] } as const;

/** The battle's ship builder, loaded with the first fleet: the map needs the battle's code only for its ships. */
let builder: Promise<typeof import('../../ships/build/ShipBuilder')> | null = null;
const shipBuilder = () => (builder ??= import('../../ships/build/ShipBuilder'));

/**
 * A battle ship as the battle's own builder makes it: its middle level (banners, gun ports) for the close view and its far
 * level for the rest, both in ship space (bow +x, the waterline on y = 0, metres, which the battle's weathering reads),
 * and the turn and scale into the kits' frame: bow +z, one unit long, centred along its length and beam.
 */
async function shipLevels(kind: ShipKind) {
  const { buildShip } = await shipBuilder();
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
 * the battle's weathering; lit by the layer's sun and sky.
 */
async function shipMaterial(faction: FactionId) {
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
  const tint: any = varying(shade.xyz.mul(shade.xyz).mul(TINT_RANGE));
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

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** The fleets that sail during a replay: a few hulls each along its way, put in place by `setSail`. */
interface Sailors {
  slots: { model: ShipModel; length: number; index: number; sail: SailSpec; along: number; across: number }[];
  /** Each model's close and far instances. */
  meshes: Map<ShipModel, InstancedMesh[]>;
  wake: InstancedMesh;
}

/**
 * The kit material (ships), the wake's geometry and material, the fishing boat and the smoke plume: made on first use and
 * kept across rebuilds.
 */
interface Shared {
  kit: MeshStandardMaterial; wake: MeshBasicMaterial; wakeGeometry: BufferGeometry;
  boat: BufferGeometry; plume: PlaneGeometry; smoke: MeshBasicNodeMaterial;
}

/** A fishing boat circling slowly round a spot of open water: centre and radius in frame units, where it is on the circle and which way it goes. */
type Boat = { x: number; z: number; r: number; phase: number; dir: 1 | -1; speed: number };

/** A house's shade from a hash: a little lighter or darker, warmer or greyer, as thatch, plaster and tiles weather apart. */
function houseShade(h: number) {
  const light = 0.92 + (((h >>> 10) & 1023) / 1023) * 0.14, warm = (((h >>> 20) & 1023) / 1023) * 2 - 1;
  return new Color(light * (1 + 0.04 * warm), light * (1 + 0.01 * warm), light * (1 - 0.05 * warm));
}

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
 * Hearth smoke: a soft grey wisp on a camera-facing strip, broken into puffs that climb with the world's clock and thin
 * out to nothing at the top.
 */
function smokeMaterial() {
  const m = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  const rise = uv().y;
  const puffs = mx_noise_float(vec3(uv().x.mul(2.4).add(positionWorld.x.mul(60)), rise.mul(3.2).sub(worldClock.mul(0.28)), positionWorld.z.mul(60))).mul(0.5).add(0.5);
  const column = float(1).sub(smoothstep(0.18, 0.5, abs(uv().x.sub(0.5))));
  const ends = smoothstep(0, 0.12, rise).mul(float(1).sub(smoothstep(0.45, 1, rise)));
  m.colorNode = mix(vec3(0.62, 0.61, 0.6), vec3(0.86, 0.86, 0.85), rise);
  m.opacityNode = column.mul(ends).mul(smoothstep(0.2, 0.7, puffs)).mul(0.65);
  return m;
}

/**
 * The ground places leave bare, laid over the drawn relief as one mesh: a camp's packed yard, the lanes between houses and
 * out to the camp's gate, the striped fields. Every vertex sits on the ground a little lifted, close enough to its
 * neighbours to follow it, and carries its own alpha, so a yard or a lane fades into the land at its edges instead of
 * ending in a line.
 */
class Decals {
  private readonly position: number[] = [];
  private readonly color: number[] = [];
  private readonly index: number[] = [];
  constructor(private readonly groundAt: (x: number, z: number) => number) {}

  private vert(x: number, z: number, c: Color, a: number) {
    this.position.push(x, this.groundAt(x, z) + DECAL_LIFT, z);
    this.color.push(c.r, c.g, c.b, a);
    return this.position.length / 3 - 1;
  }

  private quad(a: number, b: number, c: number, d: number) {
    this.index.push(a, b, c, a, c, d);
  }

  /**
   * A round patch of radius r at (x, z), solid inside and fading out over its outer third. Its rings stand an eighth of
   * the radius apart: with fewer, a knoll inside the yard rose through the patch as a green blot.
   */
  disc(x: number, z: number, r: number, hex: string) {
    const c = new Color(hex), seg = 28;
    const rows = ([[0.001, 0.55], [0.14, 0.55], [0.27, 0.55], [0.4, 0.55], [0.56, 0.5], [0.72, 0.45], [0.86, 0.22], [1, 0]] as const).map(([k, a]) =>
      Array.from({ length: seg }, (_, j) => this.vert(x + Math.cos((j / seg) * Math.PI * 2) * r * k, z + Math.sin((j / seg) * Math.PI * 2) * r * k, c, a)));
    for (let i = 0; i + 1 < rows.length; i += 1) for (let j = 0; j < seg; j += 1) this.quad(rows[i]![j]!, rows[i]![(j + 1) % seg]!, rows[i + 1]![(j + 1) % seg]!, rows[i + 1]![j]!);
  }

  /** A lane w wide along a polyline, cut every so often so it follows the ground, its edges soft. */
  lane(points: { x: number; z: number }[], w: number, hex: string) {
    const c = new Color(hex);
    const steps: { x: number; z: number; nx: number; nz: number }[] = [];
    for (let i = 0; i + 1 < points.length; i += 1) {
      const a = points[i]!, b = points[i + 1]!, l = Math.hypot(b.x - a.x, b.z - a.z);
      if (l < 1e-9) continue;
      const n = Math.max(1, Math.ceil(l / (w * 0.9)));
      for (let k = i === 0 ? 0 : 1; k <= n; k += 1) steps.push({ x: a.x + ((b.x - a.x) * k) / n, z: a.z + ((b.z - a.z) * k) / n, nx: -(b.z - a.z) / l, nz: (b.x - a.x) / l });
    }
    const across = [[-1, 0], [-0.45, 0.85], [0.45, 0.85], [1, 0]] as const;
    let last: number[] | null = null;
    for (const p of steps) {
      const row = across.map(([k, a]) => this.vert(p.x + p.nx * w * k, p.z + p.nz * w * k, c, a));
      if (last) for (let j = 0; j < 3; j += 1) this.quad(last[j]!, last[j + 1]!, row[j + 1]!, row[j]!);
      last = row;
    }
  }

  /** A field of half sizes hx by hz at a point, turned by rot: stripes of crop along its length, a paddy greener. */
  field(at: { x: number; z: number }, hx: number, hz: number, rot: number, paddy: boolean) {
    const shades = (paddy ? FIELD.paddy : FIELD.dry).map((h) => new Color(h));
    const c = Math.cos(rot), s = Math.sin(rot), stripes = 5, cuts = 3;
    const point = (u: number, w: number) => ({ x: at.x + u * c - w * s, z: at.z + u * s + w * c });
    for (let i = 0; i < stripes; i += 1) {
      const w0 = -hz + (2 * hz * i) / stripes, w1 = -hz + (2 * hz * (i + 1)) / stripes;
      let last: number[] | null = null;
      for (let k = 0; k <= cuts; k += 1) {
        const u = -hx + (2 * hx * k) / cuts;
        const row = [w0, w1].map((w) => {
          const q = point(u, w);
          return this.vert(q.x, q.z, shades[i % 2]!, 0.92);
        });
        if (last) this.quad(last[0]!, last[1]!, row[1]!, row[0]!);
        last = row;
      }
    }
  }

  geometry() {
    if (!this.index.length) return null;
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.position, 3));
    g.setAttribute('color', new Float32BufferAttribute(this.color, 4));
    g.setIndex(this.index);
    return g;
  }
}

/** The decals' material: their own colours and alpha, unlit like the drawn ground, pulled a little forward in the depth test. */
function decalMaterial() {
  const m = new MeshBasicNodeMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: DoubleSide });
  m.polygonOffset = true;
  m.polygonOffsetFactor = -1;
  m.polygonOffsetUnits = -2;
  return m;
}

/** Camps and ships standing on the map terrain; `ground` gives the terrain height in frame units at a frame point. */
export class MapLayer {
  readonly group = new Group();
  /** The ships' and the fishing boats' light. The buildings light themselves the way the land is lit (campMaterial.ts). */
  private readonly lights = { sun: new DirectionalLight('#ffe9cf', 2.1), sky: new HemisphereLight('#cfdcec', '#2b3036', 1.5), fill: new AmbientLight('#ffffff', 0.35) };
  /** A navy's kit ship, built when a battle ship could not be. */
  private readonly kitShips = new Map<FactionId, ShipModel>();
  /** The battle ships by the kind they are built as, made when a world first needs them; null when one failed. */
  private readonly shipModels = new Map<ShipKind, Promise<ShipModel | null>>();
  private readonly builtShips = new Map<ShipKind, ShipModel | null>();
  /** Each navy's ship material and its atlas, made with its first ship. */
  private readonly shipMaterials = new Map<FactionId, Promise<{ material: MeshStandardNodeMaterial; map: Texture }>>();
  private readonly readyMaterials: { material: MeshStandardNodeMaterial; map: Texture }[] = [];
  /** Each building kind's close and far geometry and how deep its footing reaches (radii), built when a world first needs it. */
  private readonly kits = new Map<PieceKind, { near: BufferGeometry; far: BufferGeometry; footing: number }>();
  /** Each navy's building material and its atlas, loaded when a world first needs it; null when its atlas failed to load. */
  private readonly campMaterials = new Map<FactionId, Promise<{ material: Material; textures: Texture[] } | null>>();
  private readonly readyCampMaterials = new Map<FactionId, { material: Material; textures: Texture[] }>();
  /** The yards, lanes and fields laid over the ground: one mesh, rebuilt with the world. */
  private decals: Mesh | null = null;
  private decalMaterial: MeshBasicNodeMaterial | null = null;
  /** What the close and the far view show: the camps' two levels of detail. */
  private readonly near = new Group();
  private readonly far = new Group();
  private generation = 0;
  private distance = 1;
  private readonly built: InstancedMesh[] = [];
  private shared: Shared | null = null;
  private smoke: { mesh: InstancedMesh; spots: Vector3[] } | null = null;
  private boats: { mesh: InstancedMesh; list: Boat[] } | null = null;
  private clock = 0;
  private sailors: Sailors | null = null;
  private world: MapWorld | null = null;
  /** The world the meshes on show were built from: until it is the last one set, a rebuild is under way. */
  private shown: MapWorld | null = null;
  private shipTotal = 0;
  private sailShare = 0;
  private sailTime = 0;
  private yaw = 0;
  private stale = false;
  private disposed = false;
  /** The hero camps (hero/layer.ts) and the sites the world on show has them at. */
  private readonly hero: HeroLayer | null;
  private heroes: HeroUse[] = [];

  /** `drawn(u, v)`, the drawn land in metres unclamped at the sea plane, lets the hero camps lay their ground. */
  constructor(private readonly ground: (u: number, v: number) => number, private readonly onChange: () => void, drawn?: (u: number, v: number) => number) {
    this.group.add(this.lights.sun, this.lights.sky, this.lights.fill, this.near, this.far);
    this.far.visible = false;
    this.lights.sun.position.set(-0.55, 0.9, 0.5);
    this.hero = drawn && heroEnabled() ? new HeroLayer(drawn) : null;
    if (this.hero) this.group.add(this.hero.group);
  }

  /**
   * Turns the smoke to face the camera, which looks at the map from `yaw` (0 from the south, positive towards the east),
   * and shows the buildings' close or far models by the camera's `distance` from what it looks at.
   */
  setView(yaw: number, distance: number) {
    this.distance = distance;
    this.near.visible = distance <= NEAR_DISTANCE;
    this.far.visible = !this.near.visible;
    this.hero?.setView(distance);
    if (Math.abs(yaw - this.yaw) < 1e-4 && !this.stale) return;
    this.yaw = yaw;
    this.stale = false;
    if (this.sailors) this.placeSailors();
    // The smoke strips turn to face the camera.
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

  /** True while the last world set is still being built: its models, atlases or ships have not all arrived. */
  get busy() {
    return !this.disposed && this.world !== this.shown;
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
      p = shipMaterial(faction).then((m) => {
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

  /**
   * A navy's building material, loaded on first use; one that arrives after the layer is gone is freed at once. Should its
   * atlas fail to load, that navy's buildings are left out rather than the whole layer.
   */
  private campMaterial(navy: FactionId) {
    let p = this.campMaterials.get(navy);
    if (!p) {
      p = campMaterial(navy).then((m) => {
        if (this.disposed) { m.material.dispose(); for (const t of m.textures) t.dispose(); } else this.readyCampMaterials.set(navy, m);
        return m;
      }, () => null);
      this.campMaterials.set(navy, p);
    }
    return p;
  }

  /** A building kind's geometry, built on first use and shared by every place after. */
  private kit(kind: PieceKind) {
    let k = this.kits.get(kind);
    if (!k) {
      const [near, far] = buildCampBuilding(kind);
      let low = 0;
      for (let i = 1; i < near.position.length; i += 3) low = Math.min(low, near.position[i]!);
      k = { near: toGeometry(near), far: toGeometry(far), footing: -low };
      this.kits.set(kind, k);
    }
    return k;
  }

  /**
   * The ground under a frame point as drawn: bilinear between the four DEM texels round it (the drawn facets' own plane),
   * from `ground`'s samples at the texels themselves; off the DEM, `ground` as it is.
   */
  private surface(u: number, v: number) {
    const W = demMeta.width, H = demMeta.height;
    const x = ((u - DEM_RECT.u) / DEM_RECT.w) * (W - 1), y = ((v - DEM_RECT.v) / DEM_RECT.h) * (H - 1);
    if (x < 0 || y < 0 || x > W - 1 || y > H - 1) return this.ground(u, v);
    const x0 = Math.min(W - 2, Math.floor(x)), y0 = Math.min(H - 2, Math.floor(y)), fx = x - x0, fy = y - y0;
    const at = (i: number, j: number) => this.ground(DEM_RECT.u + (i / (W - 1)) * DEM_RECT.w, DEM_RECT.v + (j / (H - 1)) * DEM_RECT.h);
    const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * fx, bottom = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * fx;
    return top + (bottom - top) * fy;
  }

  private async rebuild() {
    const world = this.world;
    if (!world || this.disposed) return;
    const mine = ++this.generation;
    // The hero camps stand in for their places: their camp, beacon and the towns on their ground.
    let heroes = this.hero ? heroUses(world) : [];
    let tiers = this.hero ? tierUses(world, heroes) : [];
    try {
      await this.hero?.set(heroes, tiers);
    } catch (error) {
      // Should a camp fail to build, the map keeps its old kits rather than showing no places at all.
      console.error(error);
      heroes = [];
      tiers = [];
    }
    if (this.disposed || mine !== this.generation) return;
    const replaced = new Set([...heroes.flatMap((h) => [...h.replaces]), ...tiers.map((t) => t.id)]);
    const settlements = world.settlements.filter((s) => !replaced.has(s.id));
    const heroShips = this.hero?.extras(heroes).ships ?? [];
    const pieces = new Set(settlements.flatMap((s) => s.pieces.map((p) => p.kind)));
    const kinds = new Set([...world.fleets.flatMap((f) => (f.kinds.length ? f.kinds : [MAIN_SHIP[f.faction]])), ...world.sails.map((s) => MAIN_SHIP[s.faction]), ...heroShips.map((s) => s.kind)]);
    const navies = new Set([...pieces].map(navyOf));
    const loading = Promise.all([...[...navies].map((navy) => this.campMaterial(navy)), ...[...kinds].map((kind) => this.shipModel(kind))]);
    // The buildings one kind per task while the atlases load, so a new world does not hold the page up in one piece.
    for (const kind of pieces) {
      if (this.kits.has(kind)) continue;
      await new Promise((resolve) => setTimeout(resolve));
      if (this.disposed || mine !== this.generation) return;
      this.kit(kind);
    }
    await loading;
    // A newer world or a dispose while the models were arriving makes this build stale.
    if (this.disposed || mine !== this.generation) return;
    this.clear();
    this.heroes = heroes;
    this.buildSettlements(settlements);
    this.buildShips(world.fleets);
    this.buildSailors(world.sails);
    this.shown = world;
    this.stale = true;
    this.placeBoats();
    this.setView(this.yaw, this.distance);
    this.onChange();
  }

  private clear() {
    for (const mesh of this.built) { mesh.removeFromParent(); mesh.dispose(); }
    this.built.length = 0;
    if (this.decals) {
      this.decals.removeFromParent();
      this.decals.geometry.dispose();
    }
    this.decals = null;
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
        boat: kitGeometry(buildBoatKit()),
        plume: plumeGeometry(),
        smoke: smokeMaterial(),
      };
    }
    return this.shared;
  }

  /**
   * Every place's buildings as instances of their kinds, each standing on the drawn ground: a building on its footing at
   * the height that buries none of it and leaves none of its footing in the air; a stretch of wall sheared along its run so
   * it climbs and falls with the ground from one end to the other, sunk where the ground dips under its middle; a work in
   * the water at sea level. No two houses are quite alike: each is a little larger or smaller and its own shade. Then the
   * yards, lanes and fields, the smoke of the hearths and the fishing boats.
   */
  private buildSettlements(list: SettlementSpec[]) {
    const byKind = new Map<PieceKind, { matrices: Matrix4[]; colors: Color[] }>();
    const smoke: Vector3[] = [];
    const boats: Boat[] = [];
    const groundAt = (x: number, z: number) => this.surface(x + 0.5, z * MAP_ASPECT + 0.5);
    const decals = new Decals(groundAt);
    for (const s of list) {
      const cx = s.u - 0.5, cz = (s.v - 0.5) / MAP_ASPECT;
      const seed = [...s.id].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);
      s.pieces.forEach((p, i) => {
        let b = byKind.get(p.kind);
        if (!b) byKind.set(p.kind, (b = { matrices: [], colors: [] }));
        const home = HOMES.has(p.kind), h = home ? hash(`${s.id}:${i}`) : 0;
        b.matrices.push(this.stand(p, cx + p.x * R, cz + p.z * R, groundAt, home ? 0.9 + ((h & 1023) / 1023) * 0.2 : 1));
        if (home) b.colors.push(houseShade(h));
      });
      // The ground the place leaves bare: its yard, its lanes, its fields.
      const at = (q: { x: number; z: number }) => ({ x: cx + q.x * R, z: cz + q.z * R });
      if (s.grounds.yard > 0) decals.disc(cx, cz, s.grounds.yard * R, YARD[s.owner ?? 'joseon']);
      for (const lane of s.grounds.lanes) decals.lane(lane.map(at), R * 0.05, LANE);
      for (const f of s.grounds.fields) decals.field(at(f), f.hx * R, f.hz * R, f.rot, f.paddy);
      // A hearth smokes over one house of every town of more than three, and over a hall or barracks of a camp past its first level.
      const hearths = s.pieces.filter((p) => (s.kind === 'town' ? HOMES : HEARTHS).has(p.kind));
      if (s.kind === 'town' ? hearths.length > 3 : s.kind === 'camp' && s.level >= 2 && hearths.length > 0) {
        const p = hearths[seed % hearths.length]!, x = cx + p.x * R, z = cz + p.z * R;
        smoke.push(new Vector3(x, groundAt(x, z) + R * 0.12, z));
      }
      if (s.kind !== 'camp' || !s.owner) continue;
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
    }
    // One instanced draw per kind and level of detail; `setView` shows the close or the far set.
    for (const [kind, { matrices, colors }] of byKind) {
      const kit = this.kit(kind), material = this.readyCampMaterials.get(navyOf(kind))?.material;
      if (!material) continue;
      this.add(kit.near, material, matrices, colors.length ? colors : undefined, this.near);
      this.add(kit.far, material, matrices, colors.length ? colors : undefined, this.far);
    }
    const geometry = decals.geometry();
    if (geometry) {
      const material = (this.decalMaterial ??= decalMaterial());
      this.decals = new Mesh(geometry, material);
      this.decals.frustumCulled = false;
      this.group.add(this.decals);
    }
    for (const h of this.hero?.extras(this.heroes).smoke ?? []) smoke.push(new Vector3(h.u - 0.5, h.y, (h.v - 0.5) / MAP_ASPECT));
    const { plume, smoke: smokeMat, boat, kit } = this.resources;
    const plumes = this.add(plume, smokeMat, smoke.map(() => new Matrix4()));
    if (plumes) this.smoke = { mesh: plumes, spots: smoke };
    const fishing = this.add(boat, kit, boats.map(() => new Matrix4()));
    if (fishing) this.boats = { mesh: fishing, list: boats };
  }

  /**
   * The instance matrix of a piece at (x, z) in frame units: turned, scaled from radii (and by `size`, a house's own) and
   * standing on the ground.
   */
  private stand(p: Piece, x: number, z: number, groundAt: (x: number, z: number) => number, size = 1) {
    const turn = new Matrix4().makeRotationY(p.rot);
    if (WALL_KINDS.has(p.kind)) {
      // Its run from end to end: local x goes to (cos rot, -sin rot).
      const len = (p.len ?? 1) * R, dx = Math.cos(p.rot) * len, dz = -Math.sin(p.rot) * len;
      const a = groundAt(x - dx / 2, z - dz / 2), b = groundAt(x + dx / 2, z + dz / 2);
      let dip = 0;
      for (const t of [0.25, 0.5, 0.75]) dip = Math.max(dip, a + (b - a) * t - groundAt(x + dx * (t - 0.5), z + dz * (t - 0.5)));
      const sink = Math.max(0, dip - this.kit(p.kind).footing * R * 0.8);
      return new Matrix4().makeTranslation(x, (a + b) / 2 - sink, z).multiply(turn).multiply(new Matrix4().makeShear((b - a) / len, 0, 0, 0, 0, 0)).multiply(new Matrix4().makeScale(len, R, R));
    }
    const scale = new Matrix4().makeScale(R * size, R * size, R * size);
    if (WATER_KINDS.has(p.kind)) return new Matrix4().makeTranslation(x, 0, z).multiply(turn).multiply(scale);
    const [fx, fz] = FOOTPRINT[p.kind].map((metres) => (metres / METRES_PER_RADIUS) * R * size * 0.8);
    const c = Math.cos(p.rot), s = Math.sin(p.rot);
    const heights = [[0, 0], [-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, w]) => groundAt(x + u! * fx * c + w! * fz * s, z - u! * fx * s + w! * fz * c));
    const lo = Math.min(...heights), hi = Math.max(...heights);
    // On a slope it is set at the high side unless that leaves its footing short of the ground on the low side.
    const y = Math.min(hi, lo + this.kit(p.kind).footing * R * size * 0.85);
    return new Matrix4().makeTranslation(x, y, z).multiply(turn).multiply(scale);
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
    // The hero camps' own ships at their quays.
    for (const s of this.hero?.extras(this.heroes).ships ?? []) {
      const model = this.ship(SHIP_SPECS[s.kind].faction, s.kind);
      let matrices = per.get(model);
      if (!matrices) per.set(model, (matrices = []));
      matrices.push(this.hull(model, s.u - 0.5, (s.v - 0.5) / MAP_ASPECT, s.rot, shipLength(s.kind)));
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
    this.hero?.dispose();
    for (const m of this.kitShips.values()) m.near.dispose();
    this.kitShips.clear();
    for (const m of this.builtShips.values()) { m?.near.dispose(); m?.far.dispose(); }
    this.builtShips.clear();
    this.shipModels.clear();
    for (const m of this.readyMaterials) { m.material.dispose(); m.map.dispose(); }
    this.readyMaterials.length = 0;
    this.shipMaterials.clear();
    for (const k of this.kits.values()) { k.near.dispose(); k.far.dispose(); }
    this.kits.clear();
    for (const m of this.readyCampMaterials.values()) { m.material.dispose(); for (const t of m.textures) t.dispose(); }
    this.readyCampMaterials.clear();
    this.campMaterials.clear();
    this.decalMaterial?.dispose();
    this.decalMaterial = null;
    if (this.shared) for (const resource of Object.values(this.shared)) resource.dispose();
    this.shared = null;
    disposeTree(this.group, true);
  }
}
