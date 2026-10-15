import { Color, Fog, Group, type BufferAttribute, type InstancedMesh, type InterleavedBufferAttribute, type Mesh, type Object3D, type PerspectiveCamera, type Scene } from 'three/webgpu';
import { V_SCALE } from '../../select/demFrame';
import { worldClock } from '../../select/terrain';
import { MESH_SCALE, groundElevation } from './mapMath';
import { MapLayer } from './mapLayer';
import { heroClearings } from './hero/layer';
import { rawMetres } from './hero/site';
import { TreeLayer } from './worldTrees';
import { loadGround, type WorldGround } from './worldGround';
import { clearingRadius, type MapWorld } from './mapWorld';
import { eyeOf, FAR, FOV, NEAR, worldX, worldZ, type CameraState, type ScreenFrame } from './worldCamera';

/** Compiles the shaders and pipelines of everything in the scene without holding up the frames: the renderer's compileAsync. */
export type Compile = () => Promise<void>;

/** What a mesh's pipeline depends on beyond the scene it is in: its material, the layout of its vertices and its instancing. */
function pipelineKey(mesh: Mesh) {
  const { geometry } = mesh;
  const layout = Object.keys(geometry.attributes).sort().map((name) => {
    const a = geometry.attributes[name] as BufferAttribute | InterleavedBufferAttribute;
    const packing = 'isInterleavedBufferAttribute' in a ? `@${a.data.stride}+${a.offset}` : '';
    return `${name}:${a.itemSize}${a.normalized ? 'n' : ''}${a.array?.constructor.name ?? ''}${packing}`;
  });
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const instanced = (mesh as InstancedMesh).isInstancedMesh ? ((mesh as InstancedMesh).instanceColor ? 'colours' : 'instances') : '';
  return `${materials.map((m) => m.uuid).join('+')}|${layout.join(',')}|${geometry.index ? 'indexed' : ''}|${instanced}`;
}

/**
 * The campaign's 3D world in a scene someone else draws (WorldCanvas): the ground (worldGround.ts), the camps and ships
 * standing on it (MapLayer) and the trees round the camera's target (TreeLayer). It owns no renderer and no timer; the
 * page draws it with `frame` and is told through `onChange` when something it shows has changed on its own (a model has
 * loaded, the ships have sailed on). With `compile` nothing is drawn before its shaders are ready: compiling them on the
 * first frame that draws them held the GPU process up for up to a second (Edge took 0.9 s over the ships' material).
 */
export class CampaignWorld {
  /** True once the ground has loaded and until the world is disposed: `frame` places the camera and the world draws. */
  ready = false;
  private readonly root = new Group();
  private readonly fog = new Fog('#000000', 0.5, 2);
  private readonly abort = new AbortController();
  private disposed = false;
  private ground: WorldGround | null = null;
  private layer: MapLayer | null = null;
  private trees: TreeLayer | null = null;
  private world: MapWorld | null = null;
  /** The world on show, written out, to tell a world that changes nothing from one that does. */
  private worldKey = '';
  /** The pipelines compiled so far, by `pipelineKey`, and each mesh's key. */
  private readonly compiled = new Set<string>();
  private readonly keys = new WeakMap<Mesh, string>();
  /** Compiles run one after another: the last one asked for. */
  private compiling: Promise<void> = Promise.resolve();
  /** Compiles asked for and not yet done, and whether the trees still had tiles to plant at the last frame. */
  private warming = 0;
  private planting = false;

  constructor(private readonly scene: Scene, private readonly onChange: () => void, private readonly compile?: Compile) {
    scene.add(this.root);
  }

  /** Loads the ground and stands the layers on it; resolves with the DEM's metre heights, which the overlay reads to lift each marker onto the ground. */
  async load(): Promise<Float32Array> {
    const signal = this.abort.signal;
    const ground = await loadGround(signal);
    // A ground that arrives after the world was disposed is not adopted.
    if (this.disposed) {
      ground.dispose();
      signal.throwIfAborted();
    }
    this.ground = ground;
    this.scene.background = new Color(ground.haze);
    this.fog.color.set(ground.haze);
    this.scene.fog = this.fog;
    this.root.add(ground.group);
    // Camps and ships stand on the same ground the overlay's markers read; they arrive when their models have loaded.
    this.layer = new MapLayer((u, v) => groundElevation(ground.heights, u, v), () => this.layerChanged(), (u, v) => rawMetres(ground.heights, u, v));
    this.root.add(this.layer.group);
    this.trees = new TreeLayer((u, v) => ground.heightAt(u, v), V_SCALE * MESH_SCALE);
    this.root.add(this.trees.group);
    if (this.world) this.show(this.world);
    // The first frame finds the ground's shaders ready, and the trees' too, though none is planted until the camera is close.
    await this.warm();
    signal.throwIfAborted();
    this.ready = true;
    this.onChange();
    return ground.heights;
  }

  /**
   * The camps and ships have changed. A mesh whose pipeline is not compiled yet (the first camps and ships, a camp model
   * that arrives later) is held back until it is, and the close and the far camps are compiled together, so neither the
   * first frames nor the first close view stop to compile. The rest, the same materials in new batches, show at once.
   */
  private layerChanged() {
    const layer = this.layer;
    if (layer && this.compile) {
      const fresh: Mesh[] = [];
      layer.group.traverse((o) => {
        const mesh = o as Mesh;
        if (mesh.isMesh && mesh.visible && !this.compiled.has(this.keyOf(mesh))) fresh.push(mesh);
      });
      if (fresh.length) {
        for (const mesh of fresh) mesh.visible = false;
        void this.warm().then(() => {
          for (const mesh of fresh) mesh.visible = true;
          if (!this.disposed) this.onChange();
        });
      }
    }
    this.onChange();
  }

  private keyOf(mesh: Mesh) {
    let key = this.keys.get(mesh);
    if (key === undefined) this.keys.set(mesh, (key = pipelineKey(mesh)));
    return key;
  }

  /**
   * Compiles everything the world holds, shown or not: the close and the far camps, the trees before any is planted, a
   * mesh held back. The renderer gathers what to compile the moment it is asked, so everything is put in view for just
   * that moment and put back before any frame is drawn. Compiles run one after another.
   */
  private warm(): Promise<void> {
    const run = async () => {
      if (!this.compile || this.disposed) return;
      const objects: Object3D[] = [];
      this.root.traverse((o) => { objects.push(o); });
      const kept = objects.map((o) => [o.visible, o.frustumCulled] as const);
      let done: Promise<void>;
      try {
        for (const o of objects) {
          o.visible = true;
          o.frustumCulled = false;
        }
        done = this.compile();
      } finally {
        objects.forEach((o, i) => {
          o.visible = kept[i]![0];
          o.frustumCulled = kept[i]![1];
        });
      }
      try {
        await done;
      } catch {
        // What fails to compile ahead is compiled by the first frame that draws it, as it would be without this.
      }
      for (const o of objects) if ((o as Mesh).isMesh) this.compiled.add(this.keyOf(o as Mesh));
    };
    // A compile that cannot even start leaves the shaders to the frames that draw them; the compiles after it still run.
    this.warming += 1;
    return (this.compiling = this.compiling.then(run).catch(() => undefined).finally(() => { this.warming -= 1; }));
  }

  /**
   * True until what the world was last given is on show: the ground still loading, a layer rebuild or a compile under way,
   * trees still being planted round the camera. Review scripts wait for it before they take a picture.
   */
  get busy(): boolean {
    return !this.ready || !!this.layer?.busy || this.warming > 0 || this.planting;
  }

  /**
   * What stands on the terrain: a camp where the owner has built one, ships where a fleet lies. The page builds a new
   * world at every change of the campaign, an order or a toggle, though most change nothing on the map; such a world is
   * not handed on, as the layer would build every batch anew and the frame that first draws them would take 150 ms.
   */
  setWorld(world: MapWorld) {
    const key = JSON.stringify(world);
    if (key === this.worldKey) return;
    this.worldKey = key;
    this.world = world;
    if (this.ready) this.show(world);
  }

  private show(world: MapWorld) {
    this.layer?.set(world);
    this.trees?.setClearings([...world.settlements.map((s) => ({ u: s.u, v: s.v, r: clearingRadius(s) })), ...heroClearings(world)]);
  }

  /** The closed turn's ships along their way: `share` of the sailing done, `time` the replay's clock. */
  setSail(share: number, time: number) {
    this.layer?.setSail(share, time);
  }

  /**
   * Readies one drawn frame: places `camera` where the overlay's projection (worldCamera.ts) says it is for `cam` on
   * `screen`, so a marker and the ground under it agree to the pixel, and moves the haze, the sky, the clock-driven life
   * and the trees along. `clock` is the world clock in seconds.
   */
  frame(camera: PerspectiveCamera, cam: CameraState, screen: ScreenFrame, clock: number) {
    const ground = this.ground;
    if (!this.ready || !ground) return;
    const eye = eyeOf(cam);
    camera.fov = (FOV * 180) / Math.PI;
    camera.near = NEAR;
    camera.far = FAR;
    camera.position.set(eye[0], eye[1], eye[2]);
    camera.lookAt(worldX(cam.u), 0, worldZ(cam.v));
    camera.aspect = screen.w / screen.h;
    // The target is drawn at (cx, cy), the middle of what the panels leave free: shift the picture by the difference.
    camera.setViewOffset(screen.w, screen.h, screen.w / 2 - screen.cx, screen.h / 2 - screen.cy, screen.w, screen.h);
    camera.updateProjectionMatrix();
    const fog = ground.fog(cam.distance);
    this.fog.near = fog.near;
    this.fog.far = fog.far;
    worldClock.value = clock;
    ground.update(camera.position, cam, clock);
    this.layer?.setView(cam.yaw, cam.distance);
    this.layer?.tick(clock);
    // Trees are planted a few tiles a frame: while some are still to come the page draws on, even with no ambient frames.
    this.planting = !!this.trees?.update(cam);
    if (this.planting) this.onChange();
  }

  /** Frees the ground, the layers and everything they made; a load still under way is abandoned. */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.ready = false;
    this.abort.abort();
    this.layer?.dispose();
    this.layer = null;
    this.trees?.dispose();
    this.trees = null;
    this.ground?.dispose();
    this.ground = null;
    this.root.removeFromParent();
    if (this.scene.fog === this.fog) this.scene.fog = null;
    this.scene.background = null;
  }
}
