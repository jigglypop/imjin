import { BackSide, Color, Fog, Group, Mesh, MeshBasicNodeMaterial, PerspectiveCamera, Scene, SphereGeometry, WebGPURenderer, type DataTexture } from 'three/webgpu';
import { mix, positionLocal, smoothstep, vec3 } from 'three/tsl';
import { equipment, forceWebGL } from '../../game/quality';
import { tuneWebGLBackend } from '../../render/webglBackend';
import { disposeTree } from '../../render/dispose';
import { MAP_H, V_SCALE } from '../../select/demFrame';
import { buildSea, buildTerrain, loadDem } from '../../select/terrain';
import { MAP_ASPECT } from './projection';
import { DEM_RECT, MESH_SCALE, groundElevation } from './mapMath';
import { MapLayer } from './mapLayer';
import { TreeLayer } from './worldTrees';
import type { MapWorld } from './mapWorld';
import { eyeOf, FAR, FOV, NEAR, worldX, worldZ, type CameraState, type ScreenFrame } from './worldCamera';
import { SKY_HORIZON, SKY_MIDDLE, SKY_ZENITH, WORLD_HAZE } from './worldLook';

/**
 * The world is drawn about thirty times a second while it is on screen, so the sea, the swell and the light keep moving
 * even when the player does nothing. A still picture reads as a stalled game.
 */
const FRAME_MS = 33;
/** Fog: it starts a little beyond the target and is solid well past the whole frame, so distant ridges and coasts stay readable in a soft haze. */
const fogNear = (distance: number) => distance * 1.1 + 0.05;
const fogFar = (distance: number) => distance * 3.4 + 1.1;

/** The campaign's world: the select screen's terrain under a free perspective camera, with a sea, fog and a sky. Redrawn on a steady timer while visible and paused while the page is hidden. */
export class MapScene {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera((FOV * 180) / Math.PI, 1, NEAR, FAR);
  readonly renderer: WebGPURenderer;
  ready = false;
  private readonly abort = new AbortController();
  private disposed = false;
  private initialized = false;
  private rendererReleased = false;
  private timer = 0;
  private terrain: Group | null = null;
  private demTexture: DataTexture | null = null;
  private layer: MapLayer | null = null;
  private trees: TreeLayer | null = null;
  private world: MapWorld | null = null;
  private sky: Mesh | null = null;
  private readonly fog = new Fog(WORLD_HAZE, 0.5, 2);
  private width = 0;
  private height = 0;
  private cam: CameraState = { u: 0.5, v: 0.5, distance: 0.7, yaw: 0, pitch: 0.75 };
  private screen: ScreenFrame = { w: 0, h: 0, cx: 0, cy: 0 };
  /** A camera that moves on its own (the faction pick screen's backdrop), given the time in milliseconds. */
  private drift: ((now: number) => CameraState) | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new WebGPURenderer({ canvas, antialias: equipment.select.antialias, powerPreference: 'low-power', forceWebGL });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, equipment.tier === 'low' ? 1.25 : 1.5));
    this.scene.background = new Color(WORLD_HAZE);
    this.scene.fog = this.fog;
    document.addEventListener('visibilitychange', this.onVisible);
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
    this.terrain.add(buildTerrain(tex, equipment.select.mapSegments, { haze: WORLD_HAZE }));
    this.terrain.scale.set(MESH_SCALE, MESH_SCALE, DEM_RECT.h / MAP_ASPECT / MAP_H);
    this.terrain.position.set(DEM_RECT.u + DEM_RECT.w / 2 - 0.5, 0, (DEM_RECT.v + DEM_RECT.h / 2 - 0.5) / MAP_ASPECT);
    this.scene.add(this.terrain);
    // The ocean round the DEM, centred on the campaign frame and a hair under the terrain's own sea.
    const sea = buildSea({ haze: WORLD_HAZE }, worldZ(DEM_RECT.v));
    sea.position.set(0, -0.00004, 0);
    this.scene.add(sea);
    this.sky = this.buildSky();
    this.scene.add(this.sky);
    // Camps and ships stand on the same ground the overlay's markers read; they arrive when their models have loaded.
    this.layer = new MapLayer((u, v) => groundElevation(heights, u, v), () => this.start());
    this.scene.add(this.layer.group);
    this.trees = new TreeLayer((u, v) => groundElevation(heights, u, v), V_SCALE * MESH_SCALE);
    this.scene.add(this.trees.group);
    if (this.world) {
      this.layer.set(this.world);
      this.trees.setClearings(this.world.settlements);
    }
    this.ready = true;
    this.start();
    return heights;
  }

  /** A dome that follows the eye: the haze at the horizon, deepening to blue overhead, with the sun's warm glow low in the north-west. */
  private buildSky() {
    const material = new MeshBasicNodeMaterial({ side: BackSide, depthWrite: false, fog: false });
    const rgb = (hex: string) => { const c = new Color(hex); return vec3(c.r, c.g, c.b); };
    const up = positionLocal.y.max(0);
    const dome = mix(mix(rgb(SKY_HORIZON), rgb(SKY_MIDDLE), smoothstep(0, 0.28, up)), rgb(SKY_ZENITH), smoothstep(0.22, 0.85, up));
    const toSun = positionLocal.normalize().dot(vec3(-0.55, 0.62, -0.55).normalize());
    material.colorNode = dome.add(vec3(1, 0.86, 0.62).mul(toSun.max(0).pow(14).mul(0.5)));
    const sky = new Mesh(new SphereGeometry(1, 24, 12), material);
    sky.scale.setScalar(FAR * 0.9);
    sky.renderOrder = -10;
    sky.frustumCulled = false;
    return sky;
  }

  /** What stands on the terrain: a camp where the owner has built one, ships where a fleet lies. */
  setWorld(world: MapWorld) {
    this.world = world;
    this.layer?.set(world);
    this.trees?.setClearings(world.settlements);
  }

  /** The closed turn's ships along their way: `share` of the sailing done, `time` the replay's clock. */
  setSail(share: number, time: number) {
    this.layer?.setSail(share, time);
  }

  /** Where the camera looks from and the screen it draws to; the next frame shows it. */
  update(cam: CameraState, screen: ScreenFrame) {
    if (this.disposed) return;
    this.cam = cam;
    this.screen = screen;
    if (screen.w !== this.width || screen.h !== this.height) {
      this.width = screen.w;
      this.height = screen.h;
      this.renderer.setSize(Math.max(1, screen.w), Math.max(1, screen.h), false);
    }
  }

  /** The camera is chosen by `view` every frame instead of by `update` (the faction pick screen drifts over the coast). */
  animate(view: (now: number) => CameraState) {
    this.drift = view;
    this.start();
  }

  /** Starts the frame timer if it is not running. A hidden page keeps it stopped until the page is shown again. */
  private start() {
    if (this.timer || !this.ready || this.disposed || document.hidden) return;
    this.timer = setTimeout(this.tick, 0);
  }

  private readonly tick = () => {
    this.timer = 0;
    if (this.disposed || !this.ready || document.hidden) return;
    if (this.width >= 1 && this.height >= 1 && this.terrain) {
      if (this.drift) this.cam = this.drift(performance.now());
      this.draw();
    }
    this.timer = setTimeout(this.tick, FRAME_MS);
  };

  private draw() {
    const { cam, screen, camera } = this;
    const eye = eyeOf(cam);
    camera.position.set(eye[0], eye[1], eye[2]);
    camera.lookAt(worldX(cam.u), 0, worldZ(cam.v));
    camera.aspect = screen.w / screen.h;
    // The target is drawn at (cx, cy), the middle of what the panels leave free: shift the picture by the difference.
    camera.setViewOffset(screen.w, screen.h, screen.w / 2 - screen.cx, screen.h / 2 - screen.cy, screen.w, screen.h);
    camera.updateProjectionMatrix();
    this.fog.near = fogNear(cam.distance);
    this.fog.far = fogFar(cam.distance);
    this.sky?.position.copy(camera.position);
    this.layer?.setView(cam.yaw);
    this.trees?.update(cam);
    this.renderer.render(this.scene, camera);
  }

  private readonly onVisible = () => {
    if (!document.hidden) this.start();
  };

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.ready = false;
    this.abort.abort();
    clearTimeout(this.timer);
    this.timer = 0;
    document.removeEventListener('visibilitychange', this.onVisible);
    this.layer?.dispose();
    this.layer = null;
    this.trees?.dispose();
    this.trees = null;
    disposeTree(this.scene);
    this.demTexture?.dispose();
    this.demTexture = null;
    this.terrain = null;
    this.sky = null;
    if (this.initialized) this.releaseRenderer();
  }

  private releaseRenderer() {
    if (this.rendererReleased) return;
    this.rendererReleased = true;
    void this.renderer.dispose();
  }
}
