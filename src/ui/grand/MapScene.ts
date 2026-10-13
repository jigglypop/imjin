import { Color, Fog, PerspectiveCamera, Scene, WebGPURenderer } from 'three/webgpu';
import { equipment, forceWebGL } from '../../game/quality';
import { tuneWebGLBackend } from '../../render/webglBackend';
import { disposeTree } from '../../render/dispose';
import { V_SCALE } from '../../select/demFrame';
import { worldClock } from '../../select/terrain';
import { MESH_SCALE, groundElevation } from './mapMath';
import { MapLayer } from './mapLayer';
import { TreeLayer } from './worldTrees';
import type { MapWorld } from './mapWorld';
import { eyeOf, FAR, FOV, NEAR, worldX, worldZ, type CameraState, type ScreenFrame } from './worldCamera';
import { loadGround, type WorldGround } from './worldGround';

/**
 * The world is drawn about thirty times a second while it is on screen, so the sea, the swell and the light keep moving
 * even when the player does nothing. A still picture reads as a stalled game.
 */
const FRAME_MS = 33;
const motionQuery = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
const reducedMotion = () => !!motionQuery?.matches;

/** The campaign's world: its ground (worldGround.ts) under a free perspective camera, with camps, ships and trees. Redrawn on a steady timer while visible and paused while the page is hidden. */
export class MapScene {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera((FOV * 180) / Math.PI, 1, NEAR, FAR);
  readonly renderer: WebGPURenderer;
  ready = false;
  private readonly abort = new AbortController();
  private readonly born = performance.now();
  private disposed = false;
  private initialized = false;
  private rendererReleased = false;
  private timer = 0;
  private ground: WorldGround | null = null;
  private layer: MapLayer | null = null;
  private trees: TreeLayer | null = null;
  private world: MapWorld | null = null;
  /** Its colour is the ground's haze, set when the ground has loaded. */
  private readonly fog = new Fog(0, 0.5, 2);
  private width = 0;
  private height = 0;
  private cam: CameraState = { u: 0.5, v: 0.5, distance: 0.7, yaw: 0, pitch: 0.75 };
  private screen: ScreenFrame = { w: 0, h: 0, cx: 0, cy: 0 };
  /** A camera that moves on its own (the faction pick screen's backdrop), given the time in milliseconds. */
  private drift: ((now: number) => CameraState) | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new WebGPURenderer({ canvas, antialias: equipment.select.antialias, powerPreference: 'low-power', forceWebGL });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, equipment.tier === 'low' ? 1.25 : 1.5));
    document.addEventListener('visibilitychange', this.onVisible);
  }

  /** Resolves with the ground's metre heights, which the overlay reads to lift each marker onto the ground. */
  async init() {
    const signal = this.abort.signal;
    await this.renderer.init();
    this.initialized = true;
    if (this.disposed) this.releaseRenderer();
    signal.throwIfAborted();
    tuneWebGLBackend(this.renderer);
    const ground = await loadGround(signal);
    this.ground = ground;
    const { heights } = ground;
    this.scene.add(ground.group);
    this.scene.background = new Color(ground.haze);
    this.fog.color.set(ground.haze);
    this.scene.fog = this.fog;
    // Camps and ships stand on the same ground the overlay's markers read; they arrive when their models have loaded.
    this.layer = new MapLayer((u, v) => groundElevation(heights, u, v), () => this.start());
    this.scene.add(this.layer.group);
    // Trees stand on the far land north of the DEM too, so the woods run on across the join.
    this.trees = new TreeLayer((u, v) => ground.heightAt(u, v), V_SCALE * MESH_SCALE);
    this.scene.add(this.trees.group);
    if (this.world) {
      this.layer.set(this.world);
      this.trees.setClearings(this.world.settlements);
    }
    this.ready = true;
    this.start();
    return heights;
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
    if (this.width >= 1 && this.height >= 1 && this.ground) {
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
    const fog = this.ground!.fog(cam.distance);
    this.fog.near = fog.near;
    this.fog.far = fog.far;
    // The ambient clock stands still for a player who asks for reduced motion.
    const clock = reducedMotion() ? 0 : (performance.now() - this.born) / 1000;
    worldClock.value = clock;
    this.ground!.update(camera.position, cam, clock);
    this.layer?.setView(cam.yaw, cam.distance);
    this.layer?.tick(clock);
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
    this.ground?.dispose();
    this.ground = null;
    disposeTree(this.scene);
    if (this.initialized) this.releaseRenderer();
  }

  private releaseRenderer() {
    if (this.rendererReleased) return;
    this.rendererReleased = true;
    void this.renderer.dispose();
  }
}
