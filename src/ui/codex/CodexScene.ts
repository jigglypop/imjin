import {
  ACESFilmicToneMapping,
  DataTexture,
  DirectionalLight,
  FloatType,
  PCFShadowMap,
  PerspectiveCamera,
  RedFormat,
  RenderPipeline,
  Scene,
  Vector2,
  Vector3,
  WebGPURenderer,
} from 'three/webgpu';
import { cameraPosition, float, fog, length, mix, pass, positionWorld, renderOutput, smoothstep, uniform, uv, vec3, vec4 } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { smaa } from 'three/addons/tsl/display/SMAANode.js';
import { Battle } from '../../sim/battle';
import { SHIP_SPECS } from '../../sim/catalog';
import type { Ship, ShipKind } from '../../sim/types';
import { modelKind, type ModelKind, type V3 } from '../../ships/anchors';
import { disposeSceneShipAssets, loadSceneShipAssets, type ModelAsset } from '../../ships/ShipRenderer';
import { ShipViews } from '../../ships/ShipViews';
import { Lanterns } from '../../fx/Lanterns';
import { Ocean } from '../../ocean/Ocean';
import { WakeMap } from '../../ocean/WakeMap';
import { SEA_STATES, WaveField, waveField, type SeaStateName } from '../../ocean/waves';
import { atmosphere } from '../../render/atmosphere';
import { disposeTree } from '../../render/dispose';
import { seaFogAmount } from '../../render/seaMist';
import { SkyView } from '../../render/skyDome';
import { loadSky, SKY_PRESETS, type LoadedSky } from '../../render/sky';
import { tuneWebGLBackend } from '../../render/webglBackend';
import { equipment, forceWebGL } from '../../game/quality';
import type { Terrain } from '../../terrain/Terrain';
import { RenderLease } from '../renderLease';
import { Orbit, type OrbitPose } from './orbit';
import { deckViews, type Side } from './parts';

export type CodexSky = 'afternoon' | 'day' | 'sunset' | 'night';
export const CODEX_SKIES: CodexSky[] = ['afternoon', 'day', 'sunset', 'night'];
export const CODEX_SEAS: SeaStateName[] = ['calm', 'moderate', 'rough'];

/** Metres between ships lined up for the size comparison. */
const GAP = 8;
/** The camera sits on the starboard bow quarter: this far round from the bow, in radians. */
const QUARTER = 0.95;
/** The ships are turned so the light comes from this far to the side of that first view. */
const SUN_OFFSET = 0.8;
/**
 * The battle's moonlit night is dark on purpose: ships are lanterns on black water. Looking at one ship, the eye wants
 * its timbers, so the codex opens the exposure up under the moon.
 */
const NIGHT_EXPOSURE = 2.4;
/** Every ship in the codex is drawn at full detail: one model up close is cheap even on a phone. */
const FULL_DETAIL = { maxLod0: 8, near: 1e6, mid: 2e6, skipLod0: false, baseColorOnly: false };
/** A phone keeps the models of this many navies' kinds loaded; a computer keeps every one it has shown. */
const KEEP_ON_PHONE = 2;
const UP = new Vector3(0, 1, 0);

export type ShownShip = { kind: ShipKind; x: number; length: number; height: number };

/**
 * The 3D side of the ship codex: one ship, or a few lined up at true scale, on the game's own sea under the game's own
 * sky, with a renderer of its own. Only the models of the kinds shown are loaded. A battle left running in the
 * background keeps its sky and sea: the shared uniforms are borrowed for each frame (RenderLease).
 */
export class CodexScene {
  readonly camera = new PerspectiveCamera(32, 1, 0.3, 30000);
  readonly orbit = new Orbit(this.camera);
  /** After every drawn frame: the hotspot and label layers move their markers here. */
  onFrame: (() => void) | null = null;
  ready = false;
  private renderer?: WebGPURenderer;
  private readonly scene = new Scene();
  private readonly sun = new DirectionalLight(0xffffff, 3);
  private readonly lease = new RenderLease();
  private readonly waves = new WaveField(1592);
  private sky?: LoadedSky;
  private skyName: CodexSky = 'afternoon';
  private wake?: WakeMap;
  private ocean?: Ocean;
  private floor?: DataTexture;
  private views?: ShipViews;
  private lanterns?: Lanterns;
  private pipeline?: RenderPipeline;
  private skyView?: SkyView;
  private battle = new Battle(1592, 'historical');
  private readonly models = new Map<ModelKind, Promise<Record<string, ModelAsset>>>();
  private assets: Record<string, ModelAsset> = {};
  private shownShips: ShownShip[] = [];
  private heading = 0;
  private cutaway = 0;
  private deckEye: V3 | null = null;
  /** The orbit to return to when the camera steps off the deck. */
  private beforeDeck: { yaw: number; pitch: number } | null = null;
  private readonly light = { dir: new Vector3(0, 1, 0), irradiance: new Vector3(), ambient: new Vector3(), horizon: new Vector3(), scale: 1, fog: 0, night: 0 };
  private readonly controller = new AbortController();
  private generation = 0;
  private raf = 0;
  private last = 0;
  private disposed = false;
  private observer?: ResizeObserver;
  private insets = { left: 0, right: 0, top: 0, bottom: 0 };
  private readonly eye = new Vector3();
  private readonly tmp = new Vector3();

  constructor(private readonly canvas: HTMLCanvasElement) {}

  /** The renderer, the sea and the sky. Ships come with show(). */
  async init(sky: CodexSky, sea: SeaStateName) {
    const renderer = new WebGPURenderer({ canvas: this.canvas, antialias: false, powerPreference: 'high-performance', forceWebGL });
    this.renderer = renderer;
    const loading = loadSky(SKY_PRESETS[sky], equipment.skySize, undefined, this.controller.signal);
    // A failed fetch must not surface as an unhandled rejection while the renderer is still starting.
    void loading.catch(() => undefined);
    await renderer.init();
    this.check();
    tuneWebGLBackend(renderer);
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFShadowMap;
    this.resize();
    this.waves.setState(SEA_STATES[sea]);
    this.wake = new WakeMap(equipment.tier === 'low' ? 256 : 512);
    this.wake.setExtent(900);
    // The ocean reads a sea floor; open water is deep everywhere, so a tiny texture stands in for the terrain.
    this.floor = new DataTexture(new Float32Array([-80, -80, -80, -80]), 2, 2, RedFormat, FloatType);
    this.floor.needsUpdate = true;
    const seaFloor = { rotation: uniform(new Vector2(1, 0)), sizeU: uniform(6000), heightTexture: this.floor } as unknown as Terrain;
    const loaded = await loading;
    if (this.disposed) {
      loaded.view.dispose();
      loaded.environment.dispose();
    }
    this.check();
    this.sky = loaded;
    this.skyName = sky;
    this.skyView = new SkyView(loaded.view);
    this.scene.backgroundNode = this.skyView.background();
    this.ocean = new Ocean(this.waves, loaded.environment, this.skyView, this.wake, seaFloor, null, null, { segments: equipment.oceanSegments, lights: equipment.lights });
    this.scene.add(this.ocean.mesh);
    this.applySky(loaded, sky);
    this.setupFog();
    const sun = this.sun;
    sun.castShadow = true;
    sun.shadow.mapSize.set(Math.min(4096, equipment.shadowMap), Math.min(4096, equipment.shadowMap));
    sun.shadow.bias = -0.0003;
    sun.shadow.normalBias = 0.03;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 600;
    this.scene.add(sun, sun.target);
    this.views = new ShipViews({}, this.battle, FULL_DETAIL);
    this.scene.add(this.views.group);
    this.lanterns = new Lanterns(this.views);
    this.scene.add(this.lanterns.group);
    this.setupPipeline();
    this.orbit.attach(this.canvas);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(this.canvas.parentElement ?? this.canvas);
    document.addEventListener('visibilitychange', this.visibility);
  }

  private check() {
    this.controller.signal.throwIfAborted();
    if (this.disposed) throw new DOMException('Codex closed', 'AbortError');
  }

  private resize() {
    const r = this.renderer;
    if (!r || this.disposed) return;
    const box = (this.canvas.parentElement ?? this.canvas).getBoundingClientRect();
    const w = Math.max(1, Math.round(box.width));
    const h = Math.max(1, Math.round(box.height));
    this.camera.aspect = w / h;
    this.applyInsets();
    r.setPixelRatio(Math.min(window.devicePixelRatio, equipment.select.dprCap));
    r.setSize(w, h, false);
  }

  /**
   * The panels over the canvas, in CSS pixels from each edge. The picture is shifted so the ship sits in the middle of
   * the open water between them rather than behind a panel, and framed to fit that space.
   */
  setInsets(left: number, right: number, top: number, bottom: number) {
    this.insets = { left, right, top, bottom };
    this.applyInsets();
  }

  private applyInsets() {
    const w = Math.max(1, this.canvas.clientWidth);
    const h = Math.max(1, this.canvas.clientHeight);
    const { left, right, top, bottom } = this.insets;
    this.camera.setViewOffset(w, h, (right - left) / 2, (bottom - top) / 2, w, h);
    this.camera.updateProjectionMatrix();
  }

  /** Width and height of the open space between the panels, as fractions of the canvas. */
  private openSpace() {
    const w = Math.max(1, this.canvas.clientWidth);
    const h = Math.max(1, this.canvas.clientHeight);
    const { left, right, top, bottom } = this.insets;
    return { x: Math.max(0.25, (w - left - right) / w), y: Math.max(0.25, (h - top - bottom) / h) };
  }

  /** The models of these kinds, loaded once per page for the codex's own renderer. */
  private load(kinds: ShipKind[]) {
    return Promise.all(
      [...new Set(kinds.map(modelKind))].map((model) => {
        let p = this.models.get(model);
        if (!p) {
          p = loadSceneShipAssets([model], { skipLod0: false, baseColorOnly: false, anisotropy: equipment.anisotropy });
          this.models.set(model, p);
          p.catch(() => this.models.delete(model));
        }
        return p;
      }),
    ).then((sets) => Object.assign({}, ...sets) as Record<string, ModelAsset>);
  }

  /**
   * Shows one kind (`kinds` of one) or lines several up bow to stern at true scale. Resolves once the new ships are on
   * screen; a later call supersedes an earlier one that is still loading.
   */
  async show(kinds: ShipKind[], variant: number) {
    const ticket = ++this.generation;
    const assets = await this.load(kinds);
    if (ticket !== this.generation || this.disposed || !this.views || !this.renderer) return false;
    const battle = new Battle(1592, 'historical');
    const lengths = kinds.map((k) => SHIP_SPECS[k].length);
    const total = lengths.reduce((a, b) => a + b, 0) + GAP * (kinds.length - 1);
    let x = -total / 2;
    this.shownShips = kinds.map((kind, i) => {
      const L = lengths[i]!;
      const s = battle.addShip(kind, 0, 0, 0, '', null, false, kinds.length === 1 ? variant : 0);
      s.speed = 0;
      s.throttle = 0;
      s.team = 'joseon';
      s.order = { type: 'hold' };
      const at = x + L / 2;
      x += L + GAP;
      return { kind, x: at, length: L, height: SHIP_SPECS[kind].height };
    });
    this.battle = battle;
    this.place();
    this.views.reset(assets, battle);
    this.views.team = 'joseon';
    this.assets = assets;
    this.cutaway = 0;
    this.leaveDeck();
    this.frame(true);
    this.release(kinds);
    await this.compile();
    if (ticket !== this.generation || this.disposed) return false;
    this.ready = true;
    this.start();
    return true;
  }

  /** On a phone, frees the models of kinds no longer on screen beyond the few kept for going back. */
  private release(kinds: ShipKind[]) {
    if (equipment.tier !== 'low') return;
    const keep = new Set(kinds.map(modelKind));
    const extra = [...this.models.keys()].filter((m) => !keep.has(m));
    for (const model of extra.slice(0, Math.max(0, this.models.size - Math.max(KEEP_ON_PHONE, keep.size)))) {
      const pending = this.models.get(model)!;
      this.models.delete(model);
      void pending.then(disposeSceneShipAssets, () => undefined);
    }
  }

  /** Turns the ships so the sun falls across the side the first view sees, and lines them up along that heading. */
  private place() {
    const sunAz = Math.atan2(this.light.dir.z, this.light.dir.x);
    this.heading = sunAz + SUN_OFFSET - QUARTER;
    const c = Math.cos(this.heading);
    const s = Math.sin(this.heading);
    this.shownShips.forEach((info, i) => {
      const ship = this.battle.ships[i]!;
      ship.heading = this.heading;
      ship.x = c * info.x;
      ship.z = s * info.x;
    });
  }

  /** Builds the programs of the new ships before they show, so the first frames do not stall. */
  private async compile() {
    const r = this.renderer!;
    // The camera has to be at the new view first: ships it cannot see are left out of the frame and of the build.
    this.orbit.update(0);
    this.lease.run(
      () => this.applyLight(),
      () => this.views!.sync(this.battle, 1 / 60, this.camera, this.assets),
    );
    if ((r.backend as unknown as { isWebGPUBackend?: boolean }).isWebGPUBackend) await r.compileAsync(this.scene, this.camera);
  }

  get shown(): readonly ShownShip[] {
    return this.shownShips;
  }

  /** The camera's starting view: the starboard bow quarter of one ship, or broadside to the line of them. */
  frame(immediate = false) {
    const ships = this.shownShips;
    if (!ships.length) return;
    const one = ships.length === 1;
    const total = one ? ships[0]!.length : ships[ships.length - 1]!.x + ships[ships.length - 1]!.length / 2 - (ships[0]!.x - ships[0]!.length / 2);
    const tall = Math.max(...ships.map((s) => s.height));
    this.orbit.orbitFov = one ? 32 : 20;
    const pose = { x: 0, y: tall * (one ? 0.3 : 0.38), z: 0, yaw: this.heading + (one ? QUARTER : Math.PI / 2), pitch: one ? 0.16 : 0.07, distance: total };
    pose.distance = this.fit(pose);
    this.orbit.home.set(0, tall * 0.32, 0);
    this.orbit.reach = Math.max(20, total * 0.6);
    this.orbit.minDistance = Math.max(6, (one ? ships[0]!.length : 20) * 0.35);
    this.orbit.maxDistance = pose.distance * 2.6;
    this.orbit.set(pose, immediate);
    this.fitShadow(total);
  }

  /**
   * The distance at which every ship's box (keel to mast top, beam wide) nearly fills the open water between the panels,
   * seen from `pose`. Measured rather than estimated: up close the near end of a hull looks much larger than the far
   * one. A few rounds settle it, as the picture scales nearly with the inverse of the distance.
   */
  private fit(pose: OrbitPose) {
    const open = this.openSpace();
    const tanY = Math.tan((this.orbit.orbitFov * Math.PI) / 360);
    const tanX = tanY * this.camera.aspect;
    const corners: Vector3[] = [];
    this.battle.ships.forEach((ship, i) => {
      const info = this.shownShips[i]!;
      const B = ship.spec.beam / 2;
      for (const x of [-info.length / 2, info.length / 2]) for (const y of [-1, info.height]) for (const z of [-B, B]) corners.push(new Vector3(x, y, z).applyAxisAngle(UP, -ship.heading).add(this.tmp.set(ship.x, 0, ship.z)));
    });
    const forward = new Vector3();
    const right = new Vector3();
    const up = new Vector3();
    const eye = new Vector3();
    let distance = pose.distance;
    for (let round = 0; round < 5; round++) {
      const cp = Math.cos(pose.pitch);
      eye.set(pose.x + Math.cos(pose.yaw) * cp * distance, pose.y + Math.sin(pose.pitch) * distance, pose.z + Math.sin(pose.yaw) * cp * distance);
      forward.set(pose.x, pose.y, pose.z).sub(eye).normalize();
      right.crossVectors(forward, UP).normalize();
      up.crossVectors(right, forward);
      let spread = 0;
      for (const c of corners) {
        const v = this.tmp.copy(c).sub(eye);
        const depth = Math.max(0.5, v.dot(forward));
        spread = Math.max(spread, Math.abs(v.dot(right) / (depth * tanX)) / open.x, Math.abs(v.dot(up) / (depth * tanY)) / open.y);
      }
      distance *= spread / 0.94;
    }
    return distance;
  }

  private fitShadow(total: number) {
    const cam = this.sun.shadow.camera;
    const half = total / 2 + 12;
    cam.left = -half;
    cam.right = half;
    cam.top = half;
    cam.bottom = -half;
    cam.updateProjectionMatrix();
  }

  /** Glides the camera to look at a point of a ship (ship space), from a little way off. */
  focus(index: number, local: V3) {
    const ship = this.shownShips[index];
    if (!ship || this.deckEye) return;
    const world = this.toWorld(index, local, this.tmp);
    if (!world) return;
    this.orbit.set({ x: world.x, y: world.y, z: world.z, distance: Math.max(this.orbit.minDistance, ship.length * 0.45) });
  }

  /** Cutaway of the shown ship: 0 whole, 1 roofs off, 2 down to the gun deck, 3 down to the rowers' deck. */
  setCutaway(level: number) {
    this.cutaway = level;
  }

  /** Stands the camera at a deck view of the first ship, or (null) takes it back to the orbit. */
  enterDeck(index: number | null) {
    const ship = this.shownShips[0];
    if (index === null || !ship) {
      this.leaveDeck();
      return;
    }
    const view = deckViews(ship.kind, this.battle.ships[0]!.variant)[index];
    if (!view) return;
    if (!this.deckEye) this.beforeDeck = { yaw: this.orbit.goal.yaw, pitch: this.orbit.goal.pitch };
    this.deckEye = view.eye;
    this.orbit.deckFov = 62;
    this.orbit.set({ yaw: this.heading + view.yaw, pitch: -0.08 }, true);
    this.updateDeckEye();
  }

  private leaveDeck() {
    if (!this.deckEye) return;
    this.deckEye = null;
    this.orbit.deck = null;
    if (this.beforeDeck) this.orbit.set(this.beforeDeck, true);
    this.beforeDeck = null;
  }

  private updateDeckEye() {
    if (!this.deckEye) return;
    this.orbit.deck = this.toWorld(0, this.deckEye, this.eye);
  }

  /** A point of ship `index` (ship space) in the world, as the ship rides the swell this frame. */
  toWorld(index: number, local: V3, out: Vector3) {
    const ship = this.battle.ships[index];
    if (!ship || !this.views) return null;
    return this.views.localToWorld(ship.id, local[0], local[1], local[2], out);
  }

  /** Projects a point of ship `index` to canvas pixels; false when it is behind the camera. */
  project(index: number, local: V3, out: { x: number; y: number }) {
    const p = this.toWorld(index, local, this.tmp);
    if (!p) return false;
    p.project(this.camera);
    out.x = (p.x * 0.5 + 0.5) * this.canvas.clientWidth;
    out.y = (-p.y * 0.5 + 0.5) * this.canvas.clientHeight;
    return p.z < 1;
  }

  /** The side of ship `index` that faces the camera. */
  facing(index: number): Side {
    const ship = this.battle.ships[index];
    if (!ship) return 1;
    const dx = this.camera.position.x - ship.x;
    const dz = this.camera.position.z - ship.z;
    // Starboard (+Z in ship space) points to (-sin h, cos h) in the world.
    return -Math.sin(ship.heading) * dx + Math.cos(ship.heading) * dz >= 0 ? 1 : -1;
  }

  async setSky(name: CodexSky) {
    if (!this.renderer || name === this.skyName) return;
    const sky = await loadSky(SKY_PRESETS[name], equipment.skySize, this.sky, this.controller.signal);
    if (this.disposed) return;
    const before = this.heading;
    this.applySky(sky, name);
    this.place();
    // The ships turned with the sun: the camera turns with them, so the view of the ship stays where it was.
    this.orbit.set({ yaw: this.orbit.goal.yaw + this.heading - before }, true);
  }

  setSea(name: SeaStateName) {
    this.waves.setState(SEA_STATES[name]);
  }

  private applySky(sky: LoadedSky, name: CodexSky) {
    const old = this.sky;
    this.sky = sky;
    this.skyName = name;
    const preset = SKY_PRESETS[name];
    const info = sky.info;
    const scale = (0.16 / Math.max(1e-4, info.ambientLum)) * preset.brightness;
    this.skyView?.set(sky.view);
    this.scene.environment = sky.environment;
    this.scene.backgroundIntensity = scale;
    this.scene.environmentIntensity = scale * 1.45;
    const l = this.light;
    l.dir.copy(info.sunDir);
    l.irradiance.copy(info.sunIrradiance).multiplyScalar(scale);
    l.ambient.copy(info.skyAmbient).multiplyScalar(scale);
    l.horizon.copy(info.horizon).multiplyScalar(scale);
    l.scale = scale;
    l.fog = preset.fogDensity;
    l.night = preset.night;
    const irr = info.sunIrradiance;
    const lum = Math.max(1e-4, 0.2126 * irr.x + 0.7152 * irr.y + 0.0722 * irr.z);
    this.sun.color.setRGB(irr.x / lum, irr.y / lum, irr.z / lum);
    this.sun.intensity = lum * scale * 1.35;
    this.renderer!.toneMappingExposure = preset.exposure * (preset.night > 0.5 ? NIGHT_EXPOSURE : 1);
    this.ocean?.setEnvironment(sky.environment);
    // A reused sky keeps its textures; only new ones free those they replace.
    if (old && old.view !== sky.view) old.view.dispose();
    if (old && old.environment !== sky.environment) old.environment.dispose();
  }

  /** The codex's sky and sea in the shared uniforms, for the frame being drawn. */
  private applyLight() {
    const l = this.light;
    waveField.copyFrom(this.waves);
    atmosphere.sunDir.value.copy(l.dir);
    atmosphere.sunIrradiance.value.copy(l.irradiance);
    atmosphere.skyAmbient.value.copy(l.ambient);
    atmosphere.horizon.value.copy(l.horizon);
    atmosphere.envIntensity.value = l.scale;
    atmosphere.fogDensity.value = l.fog;
    atmosphere.night.value = l.night;
    atmosphere.cloudCover.value = 0;
  }

  /** Everything fades into the haze of the horizon behind it, the colour the sky has there. */
  private setupFog() {
    const toFrag = positionWorld.sub(cameraPosition);
    const dist = length(toFrag);
    const fogColor = vec3(this.skyView!.horizon(toFrag)).mul(atmosphere.envIntensity);
    this.scene.fogNode = fog(fogColor, seaFogAmount(dist));
  }

  private setupPipeline() {
    const pipeline = new RenderPipeline(this.renderer!);
    pipeline.outputColorTransform = false;
    const scenePass = pass(this.scene, this.camera, { samples: equipment.msaa });
    const color = scenePass.getTextureNode('output');
    const glow = bloom(color, 0.2, 0.5, 2.2);
    const mapped = renderOutput(color.add(glow));
    // A soft vignette like the battle's, so the eye settles on the ship in the middle.
    const d = length(uv().sub(0.5).mul(vec3(1.25, 1, 1).xy));
    const vignette = mix(float(1), float(0.6), smoothstep(0.38, 0.95, d).mul(0.85));
    pipeline.outputNode = smaa(vec4(mapped.rgb.mul(vignette), 1));
    this.pipeline = pipeline;
  }

  private visibility = () => {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.last = 0;
    if (!document.hidden) this.start();
  };

  private start() {
    if (this.raf || this.disposed || document.hidden || !this.ready) return;
    this.raf = requestAnimationFrame(this.tick);
  }

  private tick = (now: number) => {
    this.raf = 0;
    if (this.disposed || document.hidden) return;
    const dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 1 / 60;
    this.last = now;
    try {
      this.draw(dt);
    } catch (err) {
      // A lost device leaves nothing to draw with; the screen keeps its text and sheets.
      console.error(err);
      return;
    }
    this.onFrame?.();
    this.raf = requestAnimationFrame(this.tick);
  };

  private draw(dt: number) {
    const views = this.views!;
    this.waves.time += dt;
    this.lease.run(
      () => this.applyLight(),
      () => {
        views.cutaway.clear();
        if (this.cutaway && this.battle.ships[0]) views.cutaway.set(this.battle.ships[0].id, this.cutaway);
        views.sync(this.battle, dt, this.camera, this.assets);
        this.updateDeckEye();
        this.orbit.update(dt);
        this.lanterns!.update(this.battle, this.camera, this.light.night > 0.5);
        this.lapping(dt);
        this.wake!.update(this.renderer!, dt);
        this.ocean!.update(this.camera.position.x, this.camera.position.z);
        this.aimSun();
        if (this.skyView) this.skyView.time.value += dt;
        this.pipeline!.render();
      },
    );
  }

  /** A ship at rest still works in the swell: a faint ring of foam where the water slaps along its sides. */
  private lapping(dt: number) {
    for (const s of this.battle.ships) this.slap(s, dt);
  }

  private slap(s: Ship, dt: number) {
    const c = Math.cos(s.heading);
    const n = Math.sin(s.heading);
    const L = s.spec.length;
    const B = s.spec.beam;
    for (const along of [-0.3, 0, 0.3]) {
      for (const side of [-1, 1]) {
        const x = s.x + c * along * L - n * side * B * 0.52;
        const z = s.z + n * along * L + c * side * B * 0.52;
        this.wake!.stamp(x, z, s.heading, B * 0.45, 0.004 * dt * 60, 2.2, 1.2);
      }
    }
  }

  /** Keeps the sun's shadow box on the ships, from the sun's own direction. */
  private aimSun() {
    const d = this.light.dir;
    const k = 300;
    this.sun.target.position.set(0, 0, 0);
    this.sun.position.set(d.x * k, Math.max(d.y, 0.12) * k, d.z * k);
    this.sun.target.updateMatrixWorld();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.controller.abort();
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.observer?.disconnect();
    document.removeEventListener('visibilitychange', this.visibility);
    this.orbit.detach();
    this.ocean?.dispose();
    this.wake?.dispose();
    this.floor?.dispose();
    this.views?.renderer.dispose();
    if (this.views) disposeTree(this.views.group);
    if (this.lanterns) disposeTree(this.lanterns.group);
    this.pipeline?.dispose();
    for (const pending of this.models.values()) void pending.then(disposeSceneShipAssets, () => undefined);
    this.models.clear();
    this.sky?.view.dispose();
    this.sky?.environment.dispose();
    this.scene.clear();
    void this.renderer?.dispose().catch(() => undefined);
  }
}
