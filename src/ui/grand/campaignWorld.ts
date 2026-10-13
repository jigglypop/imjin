import { Color, Fog, Group, type PerspectiveCamera, type Scene } from 'three/webgpu';
import { V_SCALE } from '../../select/demFrame';
import { worldClock } from '../../select/terrain';
import { MESH_SCALE, groundElevation } from './mapMath';
import { MapLayer } from './mapLayer';
import { TreeLayer } from './worldTrees';
import { loadGround, type WorldGround } from './worldGround';
import type { MapWorld } from './mapWorld';
import { eyeOf, FAR, FOV, NEAR, worldX, worldZ, type CameraState, type ScreenFrame } from './worldCamera';

/**
 * The campaign's 3D world in a scene someone else draws (WorldCanvas): the ground (worldGround.ts), the camps and ships
 * standing on it (MapLayer) and the trees round the camera's target (TreeLayer). It owns no renderer and no timer; the
 * page draws it with `frame` and is told through `onChange` when something it shows has changed on its own (a model has
 * loaded, the ships have sailed on).
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

  constructor(private readonly scene: Scene, private readonly onChange: () => void) {
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
    this.layer = new MapLayer((u, v) => groundElevation(ground.heights, u, v), this.onChange);
    this.root.add(this.layer.group);
    this.trees = new TreeLayer((u, v) => ground.heightAt(u, v), V_SCALE * MESH_SCALE);
    this.root.add(this.trees.group);
    if (this.world) this.show(this.world);
    this.ready = true;
    this.onChange();
    return ground.heights;
  }

  /** What stands on the terrain: a camp where the owner has built one, ships where a fleet lies. */
  setWorld(world: MapWorld) {
    this.world = world;
    if (this.ready) this.show(world);
  }

  private show(world: MapWorld) {
    this.layer?.set(world);
    this.trees?.setClearings(world.settlements);
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
    if (this.trees?.update(cam)) this.onChange();
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
