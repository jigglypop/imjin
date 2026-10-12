import { Color, Group, OrthographicCamera, Scene, WebGPURenderer, type DataTexture } from 'three/webgpu';
import { equipment, forceWebGL } from '../../game/quality';
import { tuneWebGLBackend } from '../../render/webglBackend';
import { disposeTree } from '../../render/dispose';
import { MAP_H, MIST_HEX } from '../../select/demFrame';
import { buildTerrain, loadDem } from '../../select/terrain';
import { MAP_ASPECT } from './projection';
import { DEM_RECT, MESH_SCALE, groundElevation, mapFrustum, type MapPose, type MapView } from './mapMath';
import { MapLayer } from './mapLayer';
import type { MapWorld } from './mapWorld';

/** The select screen's terrain under the campaign's overlay: one small scene, rendered only when the view changes. */
export class MapScene {
  readonly scene = new Scene();
  readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0.01, 8);
  readonly renderer: WebGPURenderer;
  ready = false;
  private readonly abort = new AbortController();
  private disposed = false;
  private initialized = false;
  private rendererReleased = false;
  private frame = 0;
  private terrain: Group | null = null;
  private demTexture: DataTexture | null = null;
  private layer: MapLayer | null = null;
  private world: MapWorld | null = null;
  private width = 0;
  private height = 0;
  private view: MapView = { s: 1, x: 0, y: 0 };
  private pose: MapPose = { tilt: 0, yaw: 0 };

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new WebGPURenderer({ canvas, antialias: equipment.select.antialias, powerPreference: 'low-power', forceWebGL });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, equipment.tier === 'low' ? 1.25 : 1.5));
    this.scene.background = new Color(MIST_HEX);
    this.camera.up.set(0, 0, -1);
  }

  /** Resolves with the DEM's metre heights, which the overlay reads to lift each marker onto the ground. */
  async init() {
    const signal = this.abort.signal;
    await this.renderer.init();
    this.initialized = true;
    if (this.disposed) this.releaseRenderer();
    signal.throwIfAborted();
    tuneWebGLBackend(this.renderer);
    const { heights, tex } = await loadDem(signal);
    if (signal.aborted) {
      tex.dispose();
      signal.throwIfAborted();
    }
    this.demTexture = tex;
    // The mesh is built in the select screen's units; the group fits it to its rectangle of the campaign frame.
    this.terrain = new Group();
    this.terrain.add(buildTerrain(tex, equipment.select.mapSegments));
    this.terrain.scale.set(MESH_SCALE, MESH_SCALE, DEM_RECT.h / MAP_ASPECT / MAP_H);
    this.terrain.position.set(DEM_RECT.u + DEM_RECT.w / 2 - 0.5, 0, (DEM_RECT.v + DEM_RECT.h / 2 - 0.5) / MAP_ASPECT);
    this.scene.add(this.terrain);
    // Camps and ships stand on the same ground the overlay's markers read; they arrive when their models have loaded.
    this.layer = new MapLayer((u, v) => groundElevation(heights, u, v), () => this.invalidate());
    this.scene.add(this.layer.group);
    if (this.world) this.layer.set(this.world);
    this.ready = true;
    this.invalidate();
    return heights;
  }

  /** What stands on the terrain: a camp where the owner has built one, ships where a fleet lies. */
  setWorld(world: MapWorld) {
    this.world = world;
    this.layer?.set(world);
  }

  /** The closed turn's ships along their way: `share` of the sailing done, `time` the replay's clock. */
  setSail(share: number, time: number) {
    this.layer?.setSail(share, time);
  }

  update(view: MapView, pose: MapPose, width: number, height: number) {
    if (this.disposed) return;
    this.view = view;
    this.pose = pose;
    if (width !== this.width || height !== this.height) {
      this.width = width;
      this.height = height;
      this.renderer.setSize(Math.max(1, width), Math.max(1, height), false);
    }
    this.invalidate();
  }

  private invalidate() {
    if (!this.ready || this.disposed || this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      if (this.disposed || !this.terrain || this.width < 1 || this.height < 1) return;
      Object.assign(this.camera, mapFrustum(this.view, this.width, this.height));
      this.camera.position.set(0, Math.cos(this.pose.tilt) * 2, Math.sin(this.pose.tilt) * 2);
      this.camera.lookAt(0, 0, 0);
      this.camera.updateProjectionMatrix();
      this.scene.rotation.y = this.pose.yaw;
      this.layer?.setYaw(this.pose.yaw);
      this.renderer.render(this.scene, this.camera);
    });
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.ready = false;
    this.abort.abort();
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.layer?.dispose();
    this.layer = null;
    disposeTree(this.scene);
    this.demTexture?.dispose();
    this.demTexture = null;
    this.terrain = null;
    if (this.initialized) this.releaseRenderer();
  }

  private releaseRenderer() {
    if (this.rendererReleased) return;
    this.rendererReleased = true;
    void this.renderer.dispose();
  }
}
