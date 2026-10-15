import {
  ACESFilmicToneMapping,
  Color,
  DataTexture,
  DirectionalLight,
  PCFShadowMap,
  PerspectiveCamera,
  RenderPipeline,
  Scene,
  Vector2,
  Vector3,
  type InstancedMesh,
  type Object3D,
  type Sprite,
  type WebGPURenderer,
} from 'three/webgpu';
import {
  cameraPosition,
  float,
  fog,
  length,
  mix,
  pass,
  positionWorld,
  renderGroup,
  renderOutput,
  smoothstep,
  uniform,
  uv,
  vec3,
  vec4,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { smaa } from 'three/addons/tsl/display/SMAANode.js';
import { dof } from 'three/addons/tsl/display/DepthOfFieldNode.js';
import { film, filmGrade } from '../cinema/grade';
import { atmosphere } from '../render/atmosphere';
import { seaFogAmount } from '../render/seaMist';
import { loadSky, SKY_PRESETS, viewTexture, type LoadedSky, type SkyPresetName } from '../render/sky';
import { SkyView } from '../render/skyDome';
import { Ocean } from '../ocean/Ocean';
import { Clouds } from '../render/Clouds';
import { CLOUD_WIND } from '../render/cloudNoise';
import { sunThroughClouds } from '../render/cloudShadow';
import { WakeMap } from '../ocean/WakeMap';
import { SEA_STATES, spectrumOf, waveField, type SeaStateName } from '../ocean/waves';
import { combatValue, engagementRange } from '../sim/competitive';
import { eventObserved, shipObserved } from '../sim/observation';
import { pointVisible } from '../sim/visibility';
import { FFTWaves } from '../ocean/FFTWaves';
import { CUT_CAP, loadShipAssets, releaseShipAssets, type ModelAsset, type ShipAssetOptions } from '../ships/ShipRenderer';
import { ShipViews } from '../ships/ShipViews';
import { Effects } from '../fx/Effects';
import { Crew, crewAssets } from '../fx/Crew';
import { Lanterns } from '../fx/Lanterns';
import { Battle, SIM_DT } from '../sim/battle';
import { buildScenario, SCENARIOS, type FleetSpawn, type ScenarioId } from '../sim/scenarios';
import { applyBalance, FACTION_NAME, FACTION_SHORT } from '../sim/balance';
import { applyOutcome } from '../campaign/campaign';
import { finishGrandBattle } from '../campaign/grand';
import { outcomeOfBattle, type RegionBattle } from '../sim/grand/bridge';
import { buildGrandConquest, grandAxis, shipOutcomes, worksAfter } from '../sim/grand/spawn';
import { CurrentField } from '../sim/current';
import { DEPTH_V1 } from '../sim/depth';
import { OWNER_OF, otherTeam, teamOf, type BattleEvent, type Faction, type Ship, type ShipKind, type Team } from '../sim/types';
import { buildConquest, homeAxis, type ConquestMapId, type Seat } from '../sim/maps';
import { BUILDING_ORDER, BUILDINGS, RANKED_OPTIONS, ROSTER, rosterOf, SHORT_NAME, buildingHp, upgradeCost, type Conquest } from '../sim/conquest';
import { applyCommand, type Command } from '../sim/commands';
import { conquestInfoOf, scenarioInfo, type BattleInfo } from '../sim/info';
import { ConquestView, preloadWorks } from '../conquest/ConquestView';
import type { NetBattle } from '../net/NetBattle';
import { RtsCamera, type CameraPose } from '../camera/RtsCamera';
import { AMBIENT_SHAKE, Director } from './Director';
import { Cinema } from '../cinema/Cinema';
import { AutoBuild } from './autoBuild';
import { Input } from './Input';
import { TouchControls } from './Touch';
import { AdaptiveQuality } from './adaptive';
import { CPU_STEP_MAX, CPU_STEPS, equipment, LEVELS, levelSetting, saveLevelSetting, startLevel, type LevelSetting, type OceanQuality, type TerrainQuality } from './quality';
import { t } from '../i18n';
import { failBattle, publish, pushToast, setAutoBuild, setLoading, setProgress, setReport, useUi, type FleetMorale, type GameSnapshot } from '../state/store';
import { SquadronBanners } from '../ui/SquadronBanners';
import { MoveOrders } from '../ui/MoveOrders';
import { TacticalOverlay } from '../ui/TacticalOverlay';
import { sound } from '../audio/Sound';
import { Terrain } from '../terrain/Terrain';
import { Vegetation } from '../terrain/Vegetation';
import { preloadStructures, Structures } from '../terrain/Structures';
import { disposeTree } from '../render/dispose';
import { tuneWebGLBackend } from '../render/webglBackend';

import { Minimap } from '../ui/Minimap';
import { DamageGallery, MunitionsGallery, damageBattle, damagePose, type GalleryKind } from './galleries';

const params = new URLSearchParams(location.search);

export type EngineOptions = {
  scenario: ScenarioId;
  sky?: SkyPresetName;
  sea?: SeaStateName;
  pose?: CameraPose;
  warmup?: number;
  /** An inspection gallery instead of a battle (galleries.ts). */
  gallery?: GalleryKind;
  cinematic?: boolean;
  hideLabels?: boolean;
  follow?: { id: number; distance: number; pitch: number; yaw: number };
  campaign?: FleetSpawn;
  /** The side the player leads. The campaign is always Joseon. */
  faction?: Faction;
  /** A conquest battle instead of a historical one. */
  conquest?: ConquestSetup;
  /** A battle run by the multiplayer server (conquest, or a historical duel when no conquest setup is given). */
  remote?: NetBattle;
};

/** A conquest battle: the map, every seat, and which seat is the player's. `grand` is a faction campaign meeting played on its region's coast instead of a conquest map, with the campaign's own ships. */
export type ConquestSetup = { seats: Seat[]; you: number; seed: number; ranked?: boolean } & ({ map: ConquestMapId; grand?: undefined } | { grand: RegionBattle; map?: undefined });

/** Sends commands somewhere other than the local battle: a multiplayer server. */
export interface CommandSink {
  send(cmd: Command): void;
}

/** Every kind with a model of its own: the gallery shows them all. A battle loads only the models of the kinds it uses. */
const ALL_KINDS: ShipKind[] = ['panokseon', 'geobukseon', 'hyeopseon', 'atakebune', 'sekibune', 'kobaya', 'mingship', 'mingsmall'];

/** Lets the browser paint the loading bar before the next stretch of blocking work (a timer covers a hidden tab, where frames never come). */
const settle = () => new Promise<void>((resolve) => {
  const timer = setTimeout(resolve, 120);
  requestAnimationFrame(() => {
    clearTimeout(timer);
    setTimeout(resolve, 0);
  });
});

/** Shown when the graphics device is lost (the browser reclaimed the GPU, usually for memory). Nothing can be drawn after it. */
const DEVICE_LOST_TEXT = '그래픽 장치가 멈췄습니다. 메모리가 부족했을 수 있습니다. 페이지를 새로고침해 주세요.';

/** What a gun's crew is doing at each stage of loading; the last two wait for the shot. */
const GUN_STAGE = ['포구 닦기', '화약 넣기', '마개 다지기', '포탄 넣기', '발사 준비', '발사'];

/** Multipliers the player can pick. The approach before first contact runs at the largest. */
export const SPEEDS = [1, 2, 4, 8, 16, 32, 64, 128] as const;
const FAST_SPEED = SPEEDS[SPEEDS.length - 1];
/**
 * Sim steps per frame are capped by count and by time, so high multipliers degrade gracefully on a slow device.
 * The time budget grows with the multiplier: at 16x and up the player wants the battle to move, not a smooth 60 fps.
 */
const MAX_STEPS = 160;
const simBudgetMs = (speed: number) => (speed >= 64 ? 32 : speed >= 16 ? 24 : speed >= 8 ? 14 : 9);
type LoadTask = { controller: AbortController; terrain?: Terrain; sky?: LoadedSky };

export class Engine {
  readonly scene = new Scene();
  readonly sun = new DirectionalLight(0xffffff, 3);
  readonly rts: RtsCamera;
  battle: Battle = new Battle(1);
  terrain!: Terrain;
  vegetation: Vegetation | null = null;
  structures: Structures | null = null;
  ocean!: Ocean;
  clouds: Clouds | null = null;
  fft: FFTWaves | null = null;
  current: CurrentField | null = null;
  readonly wake: WakeMap;
  views!: ShipViews;
  fx!: Effects;
  crew!: Crew;
  lanterns!: Lanterns;
  input!: Input;
  banners: SquadronBanners | null = null;
  moveOrders: MoveOrders | null = null;
  tacticalOverlay: TacticalOverlay | null = null;
  /** Each fleet's state as last told to the player, and the state it has been in since `since` (battle seconds). */
  private fleetCalls = { own: { shown: 'steady', pending: 'steady', since: 0 }, foe: { shown: 'steady', pending: 'steady', since: 0 } };
  readonly sound = sound;
  readonly minimap = new Minimap();
  private minimapTimer = 0;
  showLabels = true;
  /** Set by the HUD while the player has hidden it to watch the fight: the name tags over the water go with it. */
  hudHidden = false;
  speed = 1;
  paused = false;
  /** The inspection galleries' own parts, when the page is one (galleries.ts). */
  private damageGallery: DamageGallery | null = null;
  private munitionsGallery: MunitionsGallery | null = null;
  /** Fast-forward the approach: run at FAST_SPEED until the fleets are in gun range, then drop back to `speed`. */
  autoFast = true;
  /** The approach is being fast-forwarded right now. */
  fastForward = false;
  /** First contact has happened: there is no approach left to skip. */
  approachOver = false;
  private contactTimer = 0;
  ready = false;
  scenarioId: ScenarioId;
  /** The side the player leads. Ships of other factions, allies included, follow the computer. */
  faction: Faction;
  /** The commander id of the player's ships. See OWNER_OF; in a conquest battle the player's seat. */
  owner = 0;
  battleInfo: BattleInfo;
  conquest: Conquest | null = null;
  conquestSetup: ConquestSetup | null = null;
  conquestView: ConquestView | null = null;
  /** The capture point picked in the conquest panel, or -1. */
  selectedPoint = -1;
  /** Set by a multiplayer session: commands go to the server instead of the local battle. */
  sink: CommandSink | null = null;
  /** The server's battle this engine draws, in a multiplayer game. */
  remote: NetBattle | null = null;
  /** Cutaway of the selected ships: 0 off, 1 top deck, 2 gun deck, 3 oar deck. */
  cutaway = 0;
  skyName: SkyPresetName;
  seaName: SeaStateName;
  fps = 0;
  private assets: Record<string, ModelAsset> = {};
  private pipeline!: RenderPipeline;
  private sky: LoadedSky | null = null;
  /** Every node that reads the sky view: the background, the fog, the sea's haze and the clouds'. Made before the first sky. */
  private skyView: SkyView | null = null;
  /** The sun's colour times its intensity, which the light's colour node reads (see init). */
  private readonly sunLight = uniform(new Color()).setGroup(renderGroup);
  private accumulator = 0;
  private publishTimer = 0;
  private readonly autoBuild = new AutoBuild();
  private fpsFrames = 0;
  private fpsTime = 0;
  private lastScaled = 0;
  private vignette = uniform(0.32);
  private phi = 0;
  /** Cinematic camera, kill-cam slow motion and shot feel. */
  readonly director = new Director(this);
  /** Cutscenes and the documentary mode, played from the running battle (src/cinema). */
  readonly cinema: Cinema = this.makeCinema();
  private initialSquads = new Map<number, number>();
  campaign: FleetSpawn | undefined;
  private reported = false;
  private lastTide = -1;
  private readonly eq = equipment;
  private adaptive: AdaptiveQuality | null = null;
  private level: number = startLevel;
  private frame = 0;
  private shadowEvery = 1;
  private cloudEvery = 1;
  private bloomNode: ReturnType<typeof bloom> | null = null;
  /** The picture's last stage without and with the cutscene lens; the pipeline shows one of them. */
  private plainOutput: ReturnType<typeof smaa> | null = null;
  private filmOutput: ReturnType<typeof smaa> | null = null;
  private dprOverride: number | null = null;
  private gpuMs: number | null = null;
  private gpuProbe = false;
  /** The step of CPU_STEPS the frame-rate controller holds: what it gave up because the main thread was the limit. */
  private cpuStep = CPU_STEP_MAX;
  /** Main-thread time of the last frame, update and render, in ms; `updateMs` is its update part. */
  private cpuMs: number | null = null;
  private updateMs = 0;
  private touch: TouchControls | null = null;
  private disposed = false;
  private loading: LoadTask | null = null;
  private skyLoading: AbortController | null = null;
  private releaseDevice: (() => void) | null = null;

  constructor(readonly renderer: WebGPURenderer, readonly camera: PerspectiveCamera, private readonly options: EngineOptions) {
    this.level = levelSetting === 'auto' ? startLevel : levelSetting;
    this.wake = new WakeMap(equipment.wakeResolution);
    this.rts = new RtsCamera(camera);
    this.scenarioId = options.scenario;
    this.campaign = options.campaign;
    this.conquestSetup = options.conquest ?? null;
    this.remote = options.remote ?? null;
    this.sink = this.remote;
    const seat = this.conquestSetup?.seats[this.conquestSetup.you];
    this.faction = options.campaign ? 'joseon' : seat?.faction ?? options.faction ?? 'joseon';
    this.battleInfo = this.conquestSetup ? conquestInfoOf(this.conquestSetup) : scenarioInfo(options.scenario);
    this.skyName = options.sky ?? this.battleInfo.sky;
    this.seaName = options.sea ?? this.battleInfo.sea;
    const dprParam = params.get('dpr');
    this.dprOverride = dprParam ? Number(dprParam) : null;
    this.takePixelRatio();
    this.watchDevice();
    this.watchVisibility();
    tuneWebGLBackend(renderer);
  }

  /** The pixel ratio the current level allows. */
  private pixelRatio() {
    return Math.min(window.devicePixelRatio, this.dprOverride ?? LEVELS[this.level]!.dprCap);
  }

  /**
   * The engine owns the pixel ratio. React Three Fiber calls setPixelRatio with the device ratio on every resize
   * (a rotation, the browser toolbar sliding away), which would blow every render target up to the full resolution
   * while the level says otherwise. Its calls now land on the level's ratio.
   */
  private takePixelRatio() {
    const r = this.renderer;
    const original = r.setPixelRatio;
    r.setPixelRatio = (value?: number) => original.call(r, Math.min(value ?? 1, this.pixelRatio()));
    this.releasePixelRatio = () => {
      r.setPixelRatio = original;
    };
    original.call(r, this.pixelRatio());
  }

  private releasePixelRatio: (() => void) | null = null;
  /** The village and shore-works models arrive after the rest. The battle waits for them, so their shaders are built with the others. */
  private placeholderSky: DataTexture | null = null;
  private worksLoad: Promise<void> = Promise.resolve();
  private conquestLoad: Promise<void> = Promise.resolve();

  /** A lost device or context cannot be recovered here. Say so, so the page does not just freeze. */
  private watchDevice() {
    const r = this.renderer;
    const previous = r.onDeviceLost;
    const lost: typeof r.onDeviceLost = (info) => {
      previous.call(r, info);
      if (this.disposed) return;
      if (this.loading) this.cancelLoad(this.loading);
      this.skyLoading?.abort();
      this.ready = false;
      setLoading(t(DEVICE_LOST_TEXT), 1);
    };
    r.onDeviceLost = lost;
    this.releaseDevice = () => {
      if (r.onDeviceLost === lost) r.onDeviceLost = previous;
    };
  }

  /**
   * A page in the background draws nothing and simulates nothing. Browsers stop animation frames there already, but the
   * first frame back arrives with the whole absence as its time step, and a phone that is short of memory should not
   * also be fed work nobody sees.
   */
  private pageHidden = document.hidden;
  private releaseVisibility: (() => void) | null = null;

  private watchVisibility() {
    const hide = () => {
      this.pageHidden = true;
    };
    const sync = () => {
      this.pageHidden = document.hidden;
    };
    document.addEventListener('visibilitychange', sync);
    window.addEventListener('pagehide', hide);
    window.addEventListener('pageshow', sync);
    this.releaseVisibility = () => {
      document.removeEventListener('visibilitychange', sync);
      window.removeEventListener('pagehide', hide);
      window.removeEventListener('pageshow', sync);
    };
  }

  /** The player's team. The Ming fleet fights on the Joseon team; in a conquest battle the seat says. */
  get team(): Team {
    const setup = this.conquestSetup;
    return setup ? setup.seats[setup.you]!.team : teamOf(this.faction);
  }

  get enemyTeam(): Team {
    return otherTeam(this.team);
  }

  /** Ships the player commands. Allies under other commanders are not among them. */
  isOwn(s: Ship | undefined): s is Ship {
    return this.battle.isActive(s) && s.owner === this.owner;
  }

  /** Every order from the player goes through here: to the local battle, or to the server in a multiplayer game. */
  issue(cmd: Command) {
    if (!this.ready || this.disposed) return 0;
    this.cinema.onCommand(cmd);
    if (this.sink) {
      this.sink.send(cmd);
      return 'ids' in cmd ? cmd.ids.length : 1;
    }
    return applyCommand(this.battle, this.owner, cmd, this.conquest);
  }

  async init() {
    const task = this.beginLoad();
    try {
      const r = this.renderer;
      r.toneMapping = ACESFilmicToneMapping;
      r.shadowMap.enabled = true;
      r.shadowMap.type = PCFShadowMap;
      this.camera.near = 0.5;
      this.camera.far = 60000;
      this.camera.fov = 42;
      this.camera.updateProjectionMatrix();
      waveField.setState(SEA_STATES[this.seaName]);
      const info = this.battleInfo;
      setLoading(t('바다와 하늘을 준비하는 중'), 0.03, info);
      // The files download while the cloud and wake shaders build, so neither waits for the other.
      const loading = this.loadAssets(0.03, task);
      // The asset promise may fail while the shared programs are being built.
      void loading.catch(() => undefined);
      await this.warmShared(task);
      const [sky, terrain, assets] = await loading;
      this.checkLoad(task);
      task.terrain = undefined;
      this.assets = assets;
      this.terrain = terrain;
      this.scene.add(terrain.group);
      setLoading(t('지형을 준비하는 중'), 0.64);
      this.dressTerrain();
      this.applySky(sky);
      task.sky = undefined;
      setLoading(t('함대를 배치하는 중'), 0.68);
      this.placeScenario(sky);
      setLoading(t('날씨와 파도를 준비하는 중'), 0.72);
      if (this.eq.fft && (r.backend as unknown as { isWebGPUBackend?: boolean }).isWebGPUBackend) this.fft = new FFTWaves(spectrumOf(SEA_STATES[this.seaName]), this.eq.fftN);
      this.ocean = new Ocean(waveField, sky.environment, this.skyView!, this.wake, this.terrain, this.fft, this.current, this.oceanQuality());
      this.scene.add(this.ocean.mesh);
      const sun = this.sun;
      // three lights with a light's colorNode in place of its colour times intensity: the clouds' shadows then reach the
      // land, the ships and the villages as they reach the sea.
      Object.assign(sun, { colorNode: this.sunLight.mul(sunThroughClouds(positionWorld.xz)) });
      sun.castShadow = true;
      sun.shadow.mapSize.set(this.eq.shadowMap, this.eq.shadowMap);
      sun.shadow.bias = -0.0004;
      sun.shadow.normalBias = 0.04;
      sun.shadow.camera.near = 1;
      sun.shadow.camera.far = 3200;
      this.scene.add(sun, sun.target);
      this.views = new ShipViews(this.assets, this.battle, this.eq.ships);
      this.views.team = this.team;
      this.scene.add(this.views.group);
      this.fx = new Effects(this.views, { lights: this.eq.lights, particles: { keep: LEVELS[this.level]!.particleKeep, sort: true } });
      this.fx.wake = this.wake;
      this.fx.onShake = (k) => this.rts.shake(k, AMBIENT_SHAKE);
      this.fx.onCue = (kind, x, y, z, size) => this.sound.cue(kind, x, y, z, size);
      this.scene.add(this.fx.group);
      this.crew = new Crew(this.views);
      this.crew.onMusket = (target, sx, sz) => this.fx.musketMark(target, sx, sz);
      this.scene.add(this.crew.group);
      this.lanterns = new Lanterns(this.views);
      this.lanterns.onLight = (x, y, z, i) => this.fx.lantern(x, y, z, i);
      this.scene.add(this.lanterns.group);
      this.setupFog();
      this.setupPipeline();
      if (!this.options.hideLabels) {
        this.banners = new SquadronBanners(document.querySelector('.app') ?? document.body);
        this.banners.onSelect = (id, additive) => this.selectSquadron(id, additive);
      }
      this.input = new Input(this);
      this.input.attach(r.domElement);
      this.moveOrders = new MoveOrders(this, document.querySelector('.app') ?? document.body);
      this.tacticalOverlay = new TacticalOverlay(this, document.querySelector('.app') ?? document.body);
      this.touch = new TouchControls(this);
      this.touch.attach(r.domElement);
      this.rts.attach(r.domElement);
      this.rts.ground = (x, z) => this.terrain.heightAt(x, z);
      this.minimap.onPick = (x, z, button) => {
        if (button === 2) this.input.moveSelected(x, z);
        else {
          this.rts.followId = 0;
          this.rts.goal.tx = x;
          this.rts.goal.tz = z;
        }
      };
      this.rts.setPose(this.options.pose ?? this.defaultPose());
      this.rts.cinematic = !!this.options.cinematic;
      const f = this.options.follow;
      if (f) {
        const ship = this.battle.get(f.id);
        if (ship) {
          this.rts.followId = ship.id;
          this.rts.setPose({ tx: ship.x, tz: ship.z, yaw: ship.heading + f.yaw, pitch: f.pitch, distance: f.distance });
        }
      }
      if (this.options.gallery) this.setupGallery();
      this.warm(this.options.warmup ?? 0);
      sound.setMode('battle');
      await this.prewarm(0.78, task);
      this.checkLoad(task);
      this.adaptive = new AdaptiveQuality(this.level, levelSetting === 'auto', (l) => this.applyLevel(l), this.eq.maxLevel, (step) => {
        this.cpuStep = step;
        this.applyCpuStep();
      });
      this.applyLevel(this.level);
      setProgress(1);
      this.resetApproach();
      this.ready = true;
      this.remote?.announce();
      this.loading = null;
      if (!this.options.gallery) this.cinema.begin();
    } catch (err) {
      this.cancelLoad(task);
      throw err;
    }
  }

  /** A later load owns the scene. Earlier downloads may finish, but they cannot install anything into it. */
  private beginLoad(): LoadTask {
    if (this.disposed) throw new DOMException('Battle disposed', 'AbortError');
    if (this.loading) this.cancelLoad(this.loading);
    this.skyLoading?.abort();
    this.skyLoading = null;
    this.ready = false;
    const task = { controller: new AbortController() };
    this.loading = task;
    return task;
  }

  private checkLoad(task: LoadTask) {
    task.controller.signal.throwIfAborted();
    if (this.disposed || this.loading !== task) throw new DOMException('Battle load superseded', 'AbortError');
  }

  private releaseLoadedSky(sky: LoadedSky) {
    if (sky.view !== this.sky?.view) sky.view.dispose();
    if (sky.environment !== this.sky?.environment) sky.environment.dispose();
  }

  private cancelLoad(task: LoadTask) {
    task.controller.abort();
    task.terrain?.dispose();
    task.terrain = undefined;
    if (task.sky) this.releaseLoadedSky(task.sky);
    task.sky = undefined;
    if (this.loading === task) this.loading = null;
  }

  /**
   * A capture-point battle starts at normal speed: its opening moves decide which points fall, so the player sails out
   * on their own clock and can still press ⏩. Historical battles skip the empty sea straight away.
   */
  private resetApproach() {
    this.autoFast = !this.remote && !this.conquest;
    this.fastForward = false;
    this.approachOver = false;
    this.contactTimer = 0;
  }

  /**
   * Fetches the sky, the terrain, the ships this battle uses and the crew models at the same time, with the progress
   * bar moving as each finishes. `from` is the bar position the fetch starts at; the fetch fills the bar up to 0.62.
   */
  private async loadAssets(from: number, task: LoadTask) {
    const info = this.battleInfo;
    const weights = { sky: 0.1, terrain: 0.2, ships: 0.26, crew: 0.03 };
    const span = 0.62 - from;
    const total = weights.sky + weights.terrain + weights.ships + weights.crew;
    let done = from;
    const add = (w: number) => {
      this.checkLoad(task);
      done += (w / total) * span;
      setProgress(done);
    };
    const track = <T,>(p: Promise<T>, w: number) =>
      p.then((v) => {
        add(w);
        return v;
      });
    const options = this.shipOptions();
    const shipsDone = (w: number) => (f: number) => {
      if (!task.controller.signal.aborted) setProgress(done + f * (w / total) * span);
    };
    const signal = task.controller.signal;
    const skyLoad = loadSky(SKY_PRESETS[this.skyName], this.eq.skySize, this.sky ?? undefined, signal).then((sky) => {
      if (signal.aborted) {
        this.releaseLoadedSky(sky);
        signal.throwIfAborted();
      }
      task.sky = sky;
      return sky;
    });
    const terrainLoad = Terrain.load(info.terrain, this.terrainQuality(), signal).then((terrain) => {
      if (signal.aborted) {
        terrain.dispose();
        signal.throwIfAborted();
      }
      task.terrain = terrain;
      return terrain;
    });
    const [sky, terrain, assets] = await Promise.all([
      track(skyLoad, weights.sky),
      track(terrainLoad, weights.terrain),
      track(loadShipAssets(this.kindsInBattle(), options, shipsDone(weights.ships)), weights.ships),
      track(crewAssets(), weights.crew),
      preloadStructures(),
      this.conquestSetup ? preloadWorks() : undefined,
    ]);
    return [sky, terrain, assets] as const;
  }

  /**
   * The cloud layer and the wake map do not depend on the battle's files, so they are built and run once up front, while
   * the sky, terrain and ships are still being made. The clouds start on a plain placeholder sky; applySky swaps in the
   * real one. The march shader is built for the most steps the tier's levels can ask for, which is a smaller program on a phone.
   */
  private async warmShared(task: LoadTask) {
    const gray = viewTexture();
    this.placeholderSky = gray;
    this.skyView = new SkyView(gray);
    if (params.get('clouds') !== '0' && this.eq.clouds) {
      const reach = LEVELS.slice(0, Math.max(this.eq.maxLevel, this.level) + 1);
      const limits = { steps: Math.max(...reach.map((l) => l.cloud.steps)), lightSteps: Math.max(...reach.map((l) => l.cloud.lightSteps)) };
      this.clouds = new Clouds(this.skyView, LEVELS[this.level]!.cloud, limits);
      this.clouds.setLayer(SKY_PRESETS[this.skyName].clouds);
      this.scene.add(this.clouds.mesh);
    }
    await settle();
    this.checkLoad(task);
    this.wake.prewarm(this.renderer);
    this.clouds?.prewarm(this.renderer, this.camera);
  }

  private shipOptions(): ShipAssetOptions {
    return { skipLod0: this.eq.ships.skipLod0, baseColorOnly: this.eq.ships.baseColorOnly, anisotropy: this.eq.anisotropy };
  }

  /**
   * The ship kinds this battle can show: the fleets the scenario spawns, or the rosters of every seat of a conquest battle
   * (ships are built mid-battle). Loading only these keeps the models of the other navies out of a phone's memory.
   */
  private kindsInBattle(): ShipKind[] {
    if (this.options.gallery) return ALL_KINDS;
    const kinds = new Set<ShipKind>();
    const setup = this.conquestSetup;
    if (setup) {
      for (const seat of setup.seats) for (const kind of ROSTER[seat.faction]) kinds.add(kind);
      // An allied navy's ships (Ming beside Joseon) are not in the seat's roster.
      if (setup.grand) for (const seat of [setup.grand.attacker, setup.grand.defender]) for (const ship of seat.ships) kinds.add(ship.kind);
    } else {
      for (const ship of buildScenario(this.scenarioId, 0, 1, () => -50, this.campaign).ships) kinds.add(ship.spec.kind);
    }
    return [...kinds];
  }

  /**
   * Builds every program and pass before the battle shows, so none compiles on the first frames as a hitch. The whole
   * pipeline is rendered once part by part (ground, sea and sky, ships and crew), each step moving the loading bar, then
   * with the refracting ocean if a level can reach it. On WebGL the driver compiles one program at a time inside those
   * renders. On WebGPU they only start their pipelines (renderAhead), which the GPU process compiles side by side while
   * the next part is prepared; the bar then follows them to the end. `from` is where the bar starts.
   */
  private async prewarm(from: number, task: LoadTask) {
    const webgpu = !!(this.renderer.backend as unknown as { isWebGPUBackend?: boolean }).isWebGPUBackend;
    setLoading(t('화면 효과를 준비하는 중'), from);
    await Promise.all([this.worksLoad, this.conquestLoad]);
    this.checkLoad(task);
    // The land is drawn in tiles that the camera culls. All of them draw during warm-up, so the terrain program is built here
    // and not when land first comes into view. So do the batches hidden while they are empty.
    this.terrain.setCulling(false);
    const hideIdle = this.showIdle();
    try {
      // The sea's FFT runs its compute passes ahead of the scene; their pipelines are built here, not in the first frame.
      this.fft?.update(this.renderer, waveField.time);
      await this.compileByParts(from, task, webgpu);
      this.checkLoad(task);
      setLoading(t('첫 화면을 준비하는 중'), from + 0.2);
      await settle();
      this.checkLoad(task);
      await this.primeOcean(webgpu, task, from + 0.2);
      this.checkLoad(task);
    } finally {
      hideIdle();
    }
    this.terrain.setCulling(true);
    setProgress(from + 0.22);
  }

  /**
   * Shows, for the loading renders, the batches their owners hide while they hold nothing to draw (ships of a model at a
   * range nobody is at, lanterns by day), so their pipelines are built with the rest and not in the frame that first
   * fills them. Returns what hides them again.
   */
  private showIdle() {
    const idle: Object3D[] = [];
    this.scene.traverse((o) => {
      if (o.visible || !((o as InstancedMesh).isInstancedMesh || (o as Sprite).isSprite) || (o as InstancedMesh).count > 0) return;
      o.visible = true;
      idle.push(o);
    });
    return () => {
      for (const o of idle) o.visible = false;
    };
  }

  /** Pipelines the loading renders have started on WebGPU and not yet waited for. */
  private compiling: Promise<void>[] = [];

  /**
   * One render of the pipeline while loading. On WebGPU a pipeline it lacks is started with createRenderPipelineAsync and
   * its object left undrawn this once: the GPU process compiles such pipelines side by side, while a render that makes
   * its own compiles them one after another before it can finish. compileAsync is no substitute: it compiles for the
   * canvas, while the battle draws its scene one level down into the post-processing pass's multisampled target, so none
   * of what it compiled was what the frames drew, and the first frame compiled all of it again.
   * Only what the battle's camera and the sun's shadow camera draw may wait: that is drawn again every frame. A pass run
   * once with a camera of its own (the sky turned into a cube, the environment's blurred levels) must draw now.
   */
  private renderAhead(webgpu: boolean) {
    if (!webgpu) {
      this.pipeline.render();
      return;
    }
    type RenderObject = { camera: unknown };
    const cache = (this.renderer as unknown as { _pipelines: { getForRender(renderObject: RenderObject, promises?: Promise<void>[] | null): unknown } })._pipelines;
    const getForRender = cache.getForRender;
    const framed = (o: RenderObject) => o.camera === this.camera || o.camera === this.sun.shadow.camera;
    cache.getForRender = (renderObject, promises) => getForRender.call(cache, renderObject, promises ?? (framed(renderObject) ? this.compiling : null));
    try {
      this.pipeline.render();
    } finally {
      cache.getForRender = getForRender;
    }
  }

  /** Waits for the pipelines the loading renders started, the bar going from `from` to `to` as they finish. */
  private async compiled(from: number, to: number, task: LoadTask) {
    const pending = this.compiling;
    this.compiling = [];
    let done = 0;
    await Promise.all(
      pending.map((p) =>
        p.then(() => {
          done += 1;
          if (!task.controller.signal.aborted) setProgress(from + (to - from) * (done / pending.length));
        }),
      ),
    );
  }

  /**
   * Renders the pipeline once per group of the scene, letting the loading bar move between the blocking renders. On WebGPU
   * the renders only start the pipelines, which are waited for at the end.
   */
  private async compileByParts(from: number, task: LoadTask, webgpu: boolean) {
    const clouds = this.clouds?.mesh;
    const works = this.conquestView?.group;
    const parts = [this.terrain.group, this.ocean.mesh, clouds, this.views.group, this.crew.group, this.fx.group, this.lanterns.group, works].filter((o): o is NonNullable<typeof o> => !!o);
    const steps: [string, (typeof parts)[number][]][] = [
      [t('땅과 숲을 준비하는 중'), [this.terrain.group, ...(works ? [works] : [])]],
      [t('바다와 하늘을 준비하는 중'), [this.ocean.mesh, ...(clouds ? [clouds] : [])]],
      [t('함선과 병사를 준비하는 중'), [this.views.group, this.crew.group, this.fx.group, this.lanterns.group]],
    ];
    const visible = parts.map((o) => o.visible);
    for (const [n, [text, show]] of steps.entries()) {
      setLoading(text, from + 0.04 + n * 0.05);
      await settle();
      this.checkLoad(task);
      parts.forEach((o) => (o.visible = show.includes(o)));
      this.renderAhead(webgpu);
      parts.forEach((o, i) => (o.visible = visible[i]!));
    }
    if (!webgpu) return;
    setLoading(t('화면 효과를 준비하는 중'), from + 0.15);
    await this.compiled(from + 0.15, from + 0.2, task);
  }

  private terrainQuality(): TerrainQuality {
    return { mesh: this.eq.terrainMesh, triplanar: this.eq.triplanar, anisotropy: this.eq.anisotropy, noise: this.eq.noise, texSize: this.eq.terrainTexSize };
  }

  private oceanQuality(): OceanQuality {
    return { segments: this.eq.oceanSegments, lights: this.eq.lights };
  }

  /**
   * Renders the whole pipeline once with the refracting ocean if a level can reach it, and once with the plain one: the
   * frames either level starts with. A tier that stops below the refraction levels never builds that variant at all. On
   * WebGPU the refracting ocean's pipelines are started ahead and waited for first. `from` is where the bar stands.
   */
  private async primeOcean(webgpu: boolean, task: LoadTask, from: number) {
    const refracts = this.eq.maxLevel >= 3 || this.level >= 3;
    if (webgpu && refracts) {
      this.ocean.setRefraction(true);
      this.renderAhead(true);
      await this.compiled(from, from + 0.02, task);
      this.checkLoad(task);
    }
    if (refracts) {
      this.ocean.setRefraction(true);
      this.pipeline.render();
    }
    this.ocean.setRefraction(false);
    this.pipeline.render();
  }

  private dressTerrain() {
    this.terrain.season.value = this.battleInfo.foliage;
    this.vegetation = new Vegetation(this.terrain, { grids: this.eq.vegetationGrids, shadows: this.eq.vegetationShadows });
    this.terrain.group.add(this.vegetation.group);
    this.structures = new Structures(this.terrain);
    this.terrain.group.add(this.structures.group);
    this.worksLoad = this.structures.load();
  }

  private warm(seconds: number) {
    for (let t = 0; t < seconds; t += SIM_DT) {
      this.stepSim(SIM_DT);
      this.battle.events.length = 0;
    }
    if (seconds > 0) this.views.sync(this.battle, 1, this.camera, this.assets);
  }

  private placeScenario(sky: LoadedSky) {
    this.moveOrders?.clear();
    const info = this.battleInfo;
    const preset = SKY_PRESETS[this.skyName];
    const sunAz = Math.atan2(sky.info.sunDir.z, sky.info.sunDir.x);
    if (this.conquestView) {
      this.conquestView.dispose();
      this.scene.remove(this.conquestView.group);
    }
    this.conquestView = null;
    this.conquest = null;
    this.selectedPoint = -1;
    const setup = this.conquestSetup;
    if (setup) {
      // Turned so the sun falls across the line between the home ports, from the side for both fleets. A multiplayer
      // client keeps the map unturned so its coordinates match the server's.
      this.phi = this.sink ? 0 : sunAz - Math.PI / 2 - (setup.grand ? grandAxis(setup.grand) : homeAxis(setup.map));
      this.terrain.setRotation(this.phi);
      const land = (x: number, z: number) => this.terrain.heightAt(x, z);
      // A battle against the computer here runs the depth rules; an online room's server keeps the rules it was built with.
      const options = setup.ranked ? RANKED_OPTIONS : this.sink ? {} : { depth: DEPTH_V1.version };
      const built = setup.grand ? buildGrandConquest(setup.grand, land, this.phi) : buildConquest(setup.map, setup.seats, land, setup.seed, options, this.phi);
      this.battle = built.battle;
      this.conquest = built.conquest;
      this.owner = setup.you;
      if (this.sink) this.battle.humans = new Set();
      this.conquestView = new ConquestView(built.conquest, (x, z) => this.terrain.heightAt(x, z), document.querySelector('.app') ?? document.body);
      this.conquestView.onSelect = (id) => this.selectPoint(id);
      this.scene.add(this.conquestView.group);
      this.conquestLoad = this.conquestView.load();
    } else {
      // A duel on the server keeps the map unturned and is built from the server's seed, so ship ids and positions
      // match; the server's snapshots then drive every ship.
      this.phi = this.remote ? 0 : sunAz - preset.axisOffset - info.view.dir;
      this.terrain.setRotation(this.phi);
      this.battle = buildScenario(this.scenarioId, this.phi, this.remote?.seed ?? 1592 + Math.floor(Math.random() * 1000), (x, z) => this.terrain.heightAtScenario(x, z), this.campaign);
      if (this.remote) {
        this.battle.humans = new Set();
        this.owner = this.remote.you;
      } else {
        applyBalance(this.battle, this.scenarioId, this.faction);
        this.owner = OWNER_OF[this.faction];
      }
    }
    this.minimap.team = this.team;
    this.battle.setSea(SEA_STATES[this.seaName]);
    waveField.copyFrom(this.battle.waves);
    this.reported = false;
    this.fleetCalls = { own: { shown: 'steady', pending: 'steady', since: 0 }, foe: { shown: 'steady', pending: 'steady', since: 0 } };
    setReport(null);
    this.battle.land = (x, z) => this.terrain.heightAt(x, z);
    this.current = setup ? this.battle.flow : info.current ? new CurrentField(info.current, (x, z) => this.terrain.heightAtScenario(x, z), this.phi) : null;
    this.battle.flow = this.current;
    const c = this.terrain.toWorld(info.view.tx, info.view.tz);
    this.battle.center = { x: c.x, z: c.z };
    if (!setup) this.battle.arenaRadius = 5200;
    this.initialSquads.clear();
    for (const sq of this.battle.squadrons) this.initialSquads.set(sq.id, sq.shipIds.length);
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    const extendTo = (x: number, z: number) => {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    };
    for (const s of this.battle.ships) extendTo(s.x, s.z);
    for (const p of this.conquest?.points ?? []) extendTo(p.x, p.z);
    this.wake.setCenter((minX + maxX) / 2, (minZ + maxZ) / 2);
    const extent = Math.min(8000, Math.max(3000, Math.max(maxX - minX, maxZ - minZ) + 2400));
    this.wake.setExtent(extent);
    this.minimap.setTerrain(this.terrain, (minX + maxX) / 2, (minZ + maxZ) / 2, extent * (setup ? 1.05 : 1.35));
  }

  /** Ships drawn in cutaway: the selection, once close enough to see inside, nearest first and no more than a section batch holds. */
  cutawayIds() {
    const out = new Set<number>();
    if (!this.cutaway) return out;
    const cam = this.camera.position;
    const near: { id: number; d: number }[] = [];
    for (const id of this.views.selected) {
      const s = this.battle.get(id);
      const d = s && s.alive ? Math.hypot(s.x - cam.x, s.z - cam.z, cam.y) : Infinity;
      if (d < 650) near.push({ id, d });
    }
    near.sort((a, b) => a.d - b.d);
    for (const n of near.slice(0, CUT_CAP)) out.add(n.id);
    return out;
  }

  private crewView() {
    return { cutaway: this.cutaway, cut: this.cutawayIds(), winner: this.battle.winner };
  }

  /** Steps the cutaway down one deck at a time and back to the closed hull. */
  toggleCutaway() {
    this.cutaway = (this.cutaway + 1) % 4;
    pushToast(t(['선내 보기를 닫습니다', '상갑판 · 지붕과 장대를 걷어냅니다', '포갑판 · 포격 승조원과 조총·활', '노갑판 · 노 젓는 승조원'][this.cutaway]!));
    this.publish(true);
  }

  selectPoint(id: number) {
    this.selectedPoint = this.selectedPoint === id ? -1 : id;
    const p = this.conquest?.points[id];
    if (p && this.selectedPoint === id) {
      this.rts.followId = 0;
      this.rts.goal.tx = p.x;
      this.rts.goal.tz = p.z;
    }
    this.sound.click();
    this.publish(true);
  }

  /** The film grade follows the cinema; the lens pass is in the picture only while a cutscene runs. */
  private updateFilm(dt: number) {
    film.amount.value = this.cinema.grade;
    // The bloom of a close fire would whiten the whole frame: it is held back while the film grade is on.
    if (this.bloomNode) this.bloomNode.strength.value = LEVELS[this.level]!.bloomStrength * (1 - 0.55 * this.cinema.grade);
    film.time.value = (film.time.value + dt) % 600;
    const lens = this.cinema.covering && this.filmOutput ? this.filmOutput : this.plainOutput;
    if (lens && this.pipeline.outputNode !== lens) {
      this.pipeline.outputNode = lens;
      this.pipeline.needsUpdate = true;
    }
    const { aperture, focus } = this.cinema.depthOfField;
    film.focus.value = focus;
    film.depth.value = Math.max(12, focus * 0.4);
    film.bokeh.value = aperture * 1.5;
  }

  private makeCinema() {
    // The host is read through getters: the battle, the camera and the ships are replaced between battles.
    const engine = this;
    return new Cinema({
      get battle() {
        return engine.battle;
      },
      get team() {
        return engine.team;
      },
      get remote() {
        return engine.remote;
      },
      get rts() {
        return engine.rts;
      },
      get camera() {
        return engine.camera;
      },
      get views() {
        return engine.views;
      },
      scenarioKey: () => (engine.conquestSetup ? null : engine.scenarioId),
      setSky: (name) => engine.setSky(name).catch(() => undefined),
      homePose: () => engine.defaultPose(),
      sound,
    });
  }

  private defaultPose(): CameraPose {
    const info = this.battleInfo;
    if (this.conquest) {
      // Three quarters on to the player's fleet with its home port in the same frame, so the opening shows both
      // the ships and the port they sail from. Without a home port: behind the fleet, looking toward the middle.
      const own = this.centroid((s) => s.owner === this.owner);
      const back = Math.atan2(own.z, own.x);
      const home = this.conquest.homeOf(this.owner);
      if (home) {
        const gap = Math.hypot(home.x - own.x, home.z - own.z);
        const toHome = Math.atan2(home.z - own.z, home.x - own.x);
        return { tx: own.x + Math.cos(toHome) * gap * 0.4, tz: own.z + Math.sin(toHome) * gap * 0.4, yaw: toHome + Math.PI / 2 + 0.55, pitch: 0.5, distance: Math.min(2200, Math.max(720, gap * 0.8 + 380)) };
      }
      return { tx: own.x - Math.cos(back) * 260, tz: own.z - Math.sin(back) * 260, yaw: back + 0.15, pitch: 0.34, distance: 720 };
    }
    if (this.faction === 'joseon' && info.mode === 'scenario') {
      const c = this.terrain.toWorld(info.view.tx, info.view.tz);
      const dir = info.view.dir + this.phi;
      return { tx: c.x, tz: c.z, yaw: dir + Math.PI + 0.22, pitch: info.view.pitch, distance: info.view.dist };
    }
    // The scenario views look over the Joseon fleet. Other sides start behind their own ships, facing the enemy,
    // with the view pushed a quarter of the way across so the enemy is in sight.
    const own = this.centroid((s) => s.spec.faction === this.faction);
    const enemy = this.centroid((s) => s.team === this.enemyTeam);
    const back = Math.atan2(own.z - enemy.z, own.x - enemy.x);
    return { tx: own.x + (enemy.x - own.x) * 0.25, tz: own.z + (enemy.z - own.z) * 0.25, yaw: back + 0.22, pitch: info.view.pitch, distance: info.view.dist };
  }

  private centroid(pick: (s: Ship) => boolean) {
    let x = 0;
    let z = 0;
    let n = 0;
    for (const s of this.battle.ships) {
      if (!pick(s)) continue;
      x += s.x;
      z += s.z;
      n += 1;
    }
    return n ? { x: x / n, z: z / n } : { ...this.battle.center };
  }

  private setupGallery() {
    if (this.options.gallery === 'damage') {
      const only = params.get('kind') as ShipKind | null;
      const kinds = only && ALL_KINDS.includes(only) ? [only] : ALL_KINDS;
      const b = damageBattle(kinds);
      this.battle = b;
      this.views.reset(this.assets, b);
      this.damageGallery = new DamageGallery(b, this.views, this.fx);
      this.rts.setPose(this.options.pose ?? damagePose(kinds, 0));
      return;
    }
    const b = new Battle(7);
    if (this.options.gallery === 'munitions') {
      this.munitionsGallery = new MunitionsGallery();
      this.scene.add(this.munitionsGallery.group);
      // A panokseon moored behind the rack, for the scale of things.
      const s = b.addShip('panokseon', 0, -38, 0, 'panokseon', null, false, 1);
      s.speed = 0;
      s.team = 'joseon';
      s.order = { type: 'hold' };
      b.land = () => -50;
      this.battle = b;
      this.views.reset(this.assets, b);
      this.rts.setPose(this.options.pose ?? { tx: 0, tz: 0, yaw: Math.PI / 2, pitch: 0.3, distance: 8.5 });
      return;
    }
    const keys = Object.keys(this.assets);
    keys.forEach((key, i) => {
      const asset = this.assets[key]!;
      const s = b.addShip(asset.kind, (i - (keys.length - 1) / 2) * 52, 0, 0, key, null, false, asset.variant);
      s.speed = 0;
      s.team = 'joseon';
      s.order = { type: 'hold' };
    });
    b.land = () => -50;
    this.battle = b;
    this.views.reset(this.assets, b);
  }

  private applySky(sky: LoadedSky) {
    const old = this.sky;
    this.sky = sky;
    const preset = SKY_PRESETS[this.skyName];
    const info = sky.info;
    const scale = (0.16 / Math.max(1e-6, info.ambientLum)) * preset.brightness;
    const view = this.skyView!;
    view.set(sky.view);
    this.scene.backgroundNode ??= view.background();
    this.scene.environment = sky.environment;
    this.scene.backgroundIntensity = scale;
    this.scene.environmentIntensity = scale * 1.45;
    atmosphere.envIntensity.value = scale;
    atmosphere.sunDir.value.copy(info.sunDir);
    atmosphere.sunIrradiance.value.copy(info.sunIrradiance).multiplyScalar(scale);
    atmosphere.skyAmbient.value.copy(info.skyAmbient).multiplyScalar(scale);
    atmosphere.horizon.value.copy(info.horizon).multiplyScalar(scale);
    const sight = this.battleInfo.environment?.visibility ?? 1;
    atmosphere.fogDensity.value = Math.max(preset.fogDensity, sight < 0.6 ? 0.00075 : sight < 0.8 ? 0.00035 : 0);
    atmosphere.night.value = preset.night;
    const irr = info.sunIrradiance;
    const lum = Math.max(1e-4, 0.2126 * irr.x + 0.7152 * irr.y + 0.0722 * irr.z);
    this.sun.color.setRGB(irr.x / lum, irr.y / lum, irr.z / lum);
    this.sun.intensity = lum * scale * 1.35;
    this.sunLight.value.copy(this.sun.color).multiplyScalar(this.sun.intensity);
    this.renderer.toneMappingExposure = preset.exposure;
    if (this.fx) this.fx.night = preset.night;
    if (this.ocean) this.ocean.setEnvironment(sky.environment);
    this.clouds?.setLayer(preset.clouds);
    // The sea is shaded by the clouds that are drawn, and by none when they are off.
    atmosphere.cloudCover.value = this.clouds ? preset.clouds.coverage : 0;
    atmosphere.cloudHeight.value = (preset.clouds.base + preset.clouds.top) * 0.5;
    this.placeholderSky?.dispose();
    this.placeholderSky = null;
    // A reused sky keeps its textures. Only a sky that came in new textures frees the ones it replaces.
    if (old && old.view !== sky.view) old.view.dispose();
    if (old && old.environment !== sky.environment) old.environment.dispose();
  }

  /** Everything fades into the haze of the horizon behind it, the same colour the sky has there. */
  private setupFog() {
    const toFrag = positionWorld.sub(cameraPosition);
    const dist = length(toFrag);
    const fogColor = vec3(this.skyView!.horizon(toFrag)).mul(atmosphere.envIntensity);
    this.scene.fogNode = fog(fogColor, seaFogAmount(dist));
  }

  private setupPipeline() {
    const pipeline = new RenderPipeline(this.renderer);
    pipeline.outputColorTransform = false;
    const scenePass = pass(this.scene, this.camera, { samples: this.eq.msaa });
    const color = scenePass.getTextureNode('output');
    const bloomNode = bloom(color, 0.22, 0.5, 2.2);
    this.bloomNode = bloomNode;
    const finish = (scene: typeof color) => {
      const mapped = renderOutput(scene.add(bloomNode));
      const d = length(uv().sub(0.5).mul(vec3(1.25, 1, 1).xy));
      const vig = mix(float(1), float(0.62), smoothstep(0.35, 0.95, d).mul(this.vignette.mul(2.5)));
      const luma = mapped.r.mul(0.2126).add(mapped.g.mul(0.7152)).add(mapped.b.mul(0.0722));
      const nightColor = mix(vec3(luma, luma, luma), mapped.rgb, 0.6).mul(vec3(0.8, 0.92, 1.15));
      const toned = mix(mapped.rgb, nightColor, atmosphere.night.mul(float(1).sub(smoothstep(0.25, 0.85, luma))));
      return smaa(vec4(filmGrade(toned.mul(vig)), 1));
    };
    this.plainOutput = finish(color);
    // A cutscene's lens: depth of field on the scene before the bloom. Phones go without it (its passes cost too much there).
    this.filmOutput = this.eq.tier === 'low' ? null : finish(dof(color, scenePass.getViewZNode(), film.focus, film.depth, film.bokeh) as unknown as typeof color);
    pipeline.outputNode = this.plainOutput;
    this.pipeline = pipeline;
  }

  async setSky(name: SkyPresetName) {
    if (this.disposed || !this.ready) return;
    this.skyLoading?.abort();
    this.skyLoading = null;
    if (name === this.skyName && this.sky) return;
    const controller = new AbortController();
    this.skyLoading = controller;
    try {
      const sky = await loadSky(SKY_PRESETS[name], this.eq.skySize, this.sky ?? undefined, controller.signal);
      if (controller.signal.aborted || this.disposed) {
        this.releaseLoadedSky(sky);
        return;
      }
      this.skyName = name;
      this.applySky(sky);
      this.publish(true);
    } catch (err) {
      // Settings clicks may supersede an HDR download; only the current request can report a real failure.
      if (!controller.signal.aborted && !this.disposed) throw err;
    } finally {
      if (this.skyLoading === controller) this.skyLoading = null;
    }
  }

  setSea(name: SeaStateName) {
    if (this.disposed || !this.ready) return;
    this.seaName = name;
    this.battle.setSea(SEA_STATES[name]);
    waveField.copyFrom(this.battle.waves);
    this.fft?.setSpectrum(spectrumOf(SEA_STATES[name]));
    this.publish(true);
  }

  /** Starts a historical battle on the running engine; with `remote` it is a duel run by the multiplayer server. */
  async setScenario(id: ScenarioId, faction?: Faction, remote: NetBattle | null = null) {
    if (this.disposed) throw new DOMException('Battle disposed', 'AbortError');
    this.remote?.dispose();
    this.remote = remote;
    this.sink = remote;
    this.conquestSetup = null;
    this.scenarioId = id;
    this.faction = this.campaign ? 'joseon' : faction ?? this.faction;
    await this.stage(scenarioInfo(id));
  }

  /** Starts a conquest battle on the running engine, local or drawn from a multiplayer server. */
  async setConquest(setup: ConquestSetup, remote: NetBattle | null = null) {
    if (this.disposed) throw new DOMException('Battle disposed', 'AbortError');
    this.remote?.dispose();
    this.remote = remote;
    this.sink = remote;
    this.conquestSetup = setup;
    // Auto-build is a choice for one match. It starts on in a battle played alone and off in a ranked or online one, where the
    // player opts in (the online client has not been run against a live server with it on, and ranked is played by hand).
    setAutoBuild(!setup.ranked && !remote);
    this.autoBuild.reset();
    this.faction = setup.seats[setup.you]!.faction;
    await this.stage(conquestInfoOf(setup));
  }

  private async stage(info: BattleInfo) {
    const task = this.beginLoad();
    try {
      this.battleInfo = info;
      setLoading(t('{title} 준비 중', { title: t(info.title) }), 0.04, info);
      this.skyName = info.sky;
      this.seaName = info.sea;
      waveField.setState(SEA_STATES[this.seaName]);
      const [sky, terrain, assets] = await this.loadAssets(0.04, task);
      this.checkLoad(task);
      setLoading(t('지형을 준비하는 중'), 0.64);
      // The previous battle's terrain, ocean and ship batches are freed before the new ones are built, so two battles
      // never sit in memory together.
      this.disposeBattle();
      this.assets = assets;
      this.terrain = terrain;
      task.terrain = undefined;
      this.scene.add(terrain.group);
      this.dressTerrain();
      this.applySky(sky);
      task.sky = undefined;
      setLoading(t('함대를 배치하는 중'), 0.68);
      this.placeScenario(sky);
      setLoading(t('날씨와 파도를 준비하는 중'), 0.72);
      this.fft?.setSpectrum(spectrumOf(SEA_STATES[this.seaName]));
      this.ocean = new Ocean(waveField, sky.environment, this.skyView!, this.wake, this.terrain, this.fft, this.current, this.oceanQuality());
      this.scene.add(this.ocean.mesh);
      this.views.reset(this.assets, this.battle, this.capacityHint());
      this.views.team = this.team;
      void releaseShipAssets(new Set(Object.keys(this.assets)));
      this.crew = new Crew(this.views);
      this.crew.onMusket = (target, sx, sz) => this.fx.musketMark(target, sx, sz);
      this.scene.add(this.crew.group);
      this.banners?.clear();
      this.sound.newBattle();
      this.fx.newBattle();
      this.rts.setPose(this.defaultPose());
      this.paused = false;
      this.accumulator = 0;
      this.lastScaled = 0;
      this.lastTide = -1;
      this.resetApproach();
      await this.prewarm(0.78, task);
      this.checkLoad(task);
      // The rebuilt terrain, vegetation and ocean start from the plain state. Re-apply the current level to them.
      this.applyLevel(this.level);
      this.ready = true;
      this.remote?.announce();
      setLoading(null);
      this.publish(true);
      this.loading = null;
      this.cinema.begin();
    } catch (err) {
      this.cancelLoad(task);
      throw err;
    }
  }

  /** Frees the previous battle's terrain with its vegetation and villages, the ocean and the conquest works. */
  private disposeBattle() {
    this.vegetation?.dispose();
    this.vegetation = null;
    this.structures?.dispose();
    this.structures = null;
    this.terrain?.dispose();
    this.ocean?.dispose();
    this.conquestView?.dispose();
    this.conquestView = null;
    this.crew?.dispose();
  }

  /** Ships can be launched in a conquest battle, so its renderer reserves room for each kind the seats can build. */
  capacityHint() {
    const hint = new Map<ShipKind, number>();
    const setup = this.conquestSetup;
    if (!setup || !this.conquest) return hint;
    const c = this.conquest;
    for (const seat of setup.seats) for (const kind of rosterOf(seat.faction, c.options.expanded)) {
      const starting = this.battle.ships.filter((s) => s.owner === setup.seats.indexOf(seat) && s.spec.kind === kind).length;
      const room = Number.isFinite(c.options.maxShips) ? Math.min(c.options.maxShips, Math.ceil(c.options.cap / this.battle.shipSpec(kind).cost) + 4) : starting + 16;
      hint.set(kind, (hint.get(kind) ?? 0) + room);
    }
    if (setup.grand) {
      for (const seat of [setup.grand.attacker, setup.grand.defender]) {
        for (const kind of new Set(seat.ships.map((s) => s.kind))) hint.set(kind, Math.max(hint.get(kind) ?? 0, seat.ships.filter((s) => s.kind === kind).length + 4));
      }
    }
    return hint;
  }

  restart() {
    // A campaign meeting is settled once; playing it again would not change the campaign, or would settle it twice.
    if (this.remote || this.campaign || this.conquestSetup?.grand) return;
    (this.conquestSetup ? this.setConquest({ ...this.conquestSetup, seed: this.conquestSetup.seed + 1 }) : this.setScenario(this.scenarioId)).catch((error) => {
      if (!this.disposed && !(error instanceof DOMException && error.name === 'AbortError')) failBattle(error);
    });
  }

  private stepSim(dt: number) {
    this.battle.step(dt);
    waveField.time = this.battle.time;
  }

  update(frameDt: number) {
    if (!this.ready || this.pageHidden) return;
    const started = performance.now();
    this.fpsFrames += 1;
    this.fpsTime += frameDt;
    if (this.fpsTime >= 1) {
      this.fps = Math.round(this.fpsFrames / this.fpsTime);
      this.fpsFrames = 0;
      this.fpsTime = 0;
    }
    const dt = Math.min(frameDt, 0.1);
    // A multiplayer battle runs on the server at its own pace: no pause, no speed-up, nothing simulated here.
    if (!this.remote) this.updateFastForward(dt);
    const base = this.fastForward ? Math.max(this.speed, FAST_SPEED) : this.speed;
    const speed = this.cinema.speed(base * this.director.timeFactor(base));
    // Above 4x the frame rate is set by the simulation's share of each frame, not by the GPU, so it says nothing
    // about which quality level the device can hold.
    if (this.remote || this.paused || speed <= 4) this.adaptive?.update(frameDt, this.gpuMs, this.cpuMs);
    const requested = this.paused ? 0 : dt * speed;
    let scaled = this.remote ? dt : 0;
    if (this.remote) {
      this.remote.advance(this.battle, this.conquest, dt);
      waveField.time = this.battle.time;
    } else {
      // High multipliers ask for many sim steps per frame. Steps stop at a time budget so a slow device keeps drawing
      // frames (and simply runs the battle a little slower than asked) instead of stalling.
      this.accumulator += requested;
      const start = performance.now();
      const budget = simBudgetMs(speed);
      let steps = 0;
      while (!this.paused && this.accumulator >= SIM_DT && steps < MAX_STEPS) {
        this.stepSim(SIM_DT);
        scaled += SIM_DT;
        this.accumulator -= SIM_DT;
        steps += 1;
        // Contact is judged in sim time, not real time: at 128x a quarter second of real time is 32 sim seconds.
        if (this.fastForward && steps % 4 === 0 && this.inContact()) {
          this.endFastForward();
          this.accumulator = 0;
          break;
        }
        if (performance.now() - start > budget) break;
      }
      if (this.accumulator > SIM_DT * 4) this.accumulator = 0;
    }
    this.lastScaled = scaled;
    const events = this.remote ? this.battle.events : this.battle.events.filter((e) => eventObserved(e, this.battle, this.conquest, this.team));
    this.views.cutaway.clear();
    for (const id of this.cutawayIds()) this.views.cutaway.set(id, this.cutaway);
    this.views.sync(this.battle, scaled, this.camera, this.assets);
    this.damageGallery?.tick();
    this.stampWakes(events, scaled);
    if (events.length) {
      this.sound.update(events, this.battle, this.camera, scaled);
      this.director.feed(events);
      this.cinema.feed(events);
      this.fx.handle(events, this.battle);
      this.crew.handle(events, this.battle);
      this.input.onEvents(events);
      for (const e of events) if (e.type === 'battery') this.fx.gun(e.x, e.y, e.z, e.dx, e.dy, e.dz, true);
    }
    this.battle.events = [];
    if (this.battle.ended && !this.reported) this.finishCampaignBattle();
    // While a cutscene or a documentary beat holds the camera, neither the director nor the player moves it.
    if (!this.cinema.update(dt)) {
      this.director.update(dt);
      const follow = this.rts.followId ? this.views.worldOf(this.rts.followId) : null;
      if (this.rts.followId && !follow) this.rts.followId = 0;
      this.rts.update(dt, follow);
    }
    this.updateFilm(dt);
    this.ocean.setTide(this.battle.tide);
    atmosphere.cloudDrift.value.set(CLOUD_WIND.x * waveField.time, CLOUD_WIND.y * waveField.time);
    this.clouds?.update(this.camera.position, waveField.time);
    if (this.skyView) this.skyView.time.value += dt;
    this.vegetation?.update(this.camera);
    this.structures?.update(this.camera);
    const tideSign = Math.abs(this.battle.tide) < 0.15 ? 0 : Math.sign(this.battle.tide);
    if (this.current && tideSign !== this.lastTide) {
      if (tideSign === 0) pushToast(t('물살이 잦아듭니다 · 곧 물길이 바뀝니다'));
      else if (this.lastTide === 0) {
        if (this.battle.profile === 'historical') pushToast(t(tideSign > 0 ? '울돌목의 물길이 뒤집혔습니다 · 일본 함선이 밀려납니다' : '거센 물살이 일본 함선을 실어 옵니다'), (tideSign > 0) === (this.team === 'joseon') ? 'good' : 'bad');
        else pushToast(t('조류의 방향이 바뀌었습니다 · 항로와 회오리를 확인하세요'));
      }
      this.lastTide = tideSign;
    }
    this.ocean.update(this.camera.position.x, this.camera.position.z);
    if (this.current) {
      const t = this.rts.target;
      const v = this.current.velocity(t.x, t.z, this.battle.tide);
      this.sound.setRoar(Math.min(1, Math.hypot(v.x, v.z) / 4) * Math.max(0.2, 1 - this.rts.distance / 3000));
    } else this.sound.setRoar(0);
    this.sound.tick(this.battle, this.camera, scaled);
    this.fx.shipRate = this.remote ? this.remote.playbackPace : 1;
    this.fx.update(this.battle, scaled, this.camera);
    this.crew.update(this.battle, scaled, this.camera, this.crewView());
    this.lanterns.update(this.battle, this.camera, this.battle.night || SKY_PRESETS[this.skyName].night > 0.5);
    this.updateSun();
    const el = this.renderer.domElement;
    this.banners?.update(this.battle, this.views, this.camera, el.clientWidth, el.clientHeight, this.showLabels && !this.hudHidden && !this.rts.cinematic && !this.cinema.covering && !this.battle.ended, this.team);
    this.moveOrders?.update();
    const overlay = !this.hudHidden && !this.rts.cinematic && !this.cinema.covering && !this.battle.ended;
    this.tacticalOverlay?.update(overlay, overlay && this.showLabels);
    this.conquestView?.update(this.camera, el.clientWidth, el.clientHeight, this.team, this.selectedPoint, this.showLabels && !this.hudHidden && !this.rts.cinematic && !this.cinema.covering && !this.options.hideLabels && !this.battle.ended, this.battle);
    if (this.conquest && !this.paused && useUi.getState().autoBuild) {
      const order = this.autoBuild.tick(this.battle, this.conquest, this.owner, (cmd) => this.issue(cmd));
      if (order) {
        const point = this.conquest.points[order.point]!;
        const kind = order.type === 'build' ? order.building : point.buildings[order.slot]!.kind;
        pushToast(t(order.type === 'build' ? '자동 건설: {work} 건설 · {point}' : '자동 건설: {work} 증축 · {point}', { work: t(BUILDINGS[kind].label), point: t(point.name) }));
      }
    }
    this.publishTimer -= dt;
    if (this.publishTimer <= 0) {
      this.publish();
      this.publishTimer = 0.15;
    }
    this.minimapTimer -= dt;
    if (this.minimapTimer <= 0) {
      if (this.minimap.visible) this.minimap.draw(this.battle, this.views.selected, this.rts.target.x, this.rts.target.z, this.rts.yaw, this.minimapPoints());
      this.minimapTimer = 0.1;
    }
    this.updateMs = performance.now() - started;
  }

  /**
   * Contact: an enemy within CONTACT_RANGE, a shot in the air, or a grapple. Until then the approach can be
   * fast-forwarded; it ends for good at the first contact so the player is never yanked between speeds.
   */
  private updateFastForward(dt: number) {
    const b = this.battle;
    if (this.approachOver || b.ended || this.options.gallery) {
      this.fastForward = false;
      return;
    }
    // Contact is watched even while the fast-forward is off, so the ⏩ button disappears once there is nothing to skip.
    this.contactTimer -= dt;
    if (this.contactTimer > 0) return;
    this.contactTimer = 0.25;
    if (this.inContact()) this.endFastForward();
    else this.fastForward = this.autoFast && !this.paused;
  }

  private endFastForward() {
    if (this.fastForward) pushToast(t('적과 접촉했습니다 · 정상 속도로 돌아갑니다'), 'info');
    this.approachOver = true;
    this.autoFast = false;
    this.fastForward = false;
  }

  private inContact() {
    const b = this.battle;
    if (b.projectiles.some((p) => b.profile === 'historical' || p.team === this.team || pointVisible(b, this.team, p.x, p.z))) return true;
    const own: Ship[] = [];
    const foe: Ship[] = [];
    for (const s of b.ships) {
      if (!s.alive || s.sinking > 0 || !shipObserved(b, this.team, s)) continue;
      if (s.grappledWith) return true;
      (s.team === this.team ? own : foe).push(s);
    }
    const range = engagementRange(b.profile, [...own, ...foe].map((s) => s.spec.kind));
    const r2 = range * range;
    for (const a of own) for (const e of foe) if ((a.x - e.x) ** 2 + (a.z - e.z) ** 2 < r2) return true;
    return own.length === 0 || (b.profile === 'historical' && foe.length === 0);
  }

  private minimapPoints() {
    const c = this.conquest;
    if (!c) return undefined;
    return c.points.map((p) => {
      const t = c.teamOfPoint(p);
      return { x: p.x, z: p.z, r: p.r, side: (t ? (t === this.team ? 'own' : 'foe') : 'none') as 'own' | 'foe' | 'none', selected: p.id === this.selectedPoint };
    });
  }

  private finishCampaignBattle() {
    this.reported = true;
    const grand = this.conquestSetup?.grand;
    if (grand && this.conquest) {
      this.finishGrandBattle(grand, this.conquest);
      return;
    }
    if (!this.campaign) return;
    const b = this.battle;
    const ships = shipOutcomes(b.ships);
    const enemy = this.enemyTeam;
    const enemySunk = b.initial[enemy] - b.teamCount(enemy) - b.escaped[enemy];
    setReport(applyOutcome({ id: this.scenarioId, win: b.winner === this.team, draw: b.draw, enemySunk, enemyEscaped: b.escaped[enemy], ships }));
  }

  /** A faction campaign meeting is over: the campaign takes what happened to its ships and to the defender's port. */
  private finishGrandBattle(rb: RegionBattle, conquest: Conquest) {
    const works = worksAfter(rb, conquest);
    finishGrandBattle(rb, { ...outcomeOfBattle(rb, this.battle.winner, shipOutcomes(this.battle.ships), works.razed), damage: works.damage });
  }

  /** Withdrawal. The battle counts as lost. */
  endBattle() {
    if (this.battle.ended) return;
    this.battle.winner = this.enemyTeam;
  }

  /** Leaves a multiplayer battle: the server hands the fleet to the computer. */
  leaveRemote() {
    if (!this.remote) return;
    this.remote.dispose();
    this.remote = null;
    this.sink = null;
    this.paused = true;
  }

  private stampWakes(events: BattleEvent[], scaled: number) {
    const k = scaled * 60;
    const w = this.wake;
    for (const e of events) {
      if (e.type === 'splash') w.stamp(e.x, e.z, Math.random() * 6, 7 * e.size, 0.9, 1, 1.4);
      else if (e.type === 'ram') w.stamp(e.x, e.z, 0, 16, 1.2, 1, 1.5);
      else if (e.type === 'explode') w.stamp(e.x, e.z, 0, 42, 1.5, 1, 2);
    }
    if (k <= 0) return;
    for (const s of this.battle.ships) {
      if (!s.alive || !shipObserved(this.battle, this.team, s)) { w.forgetShip(s.id); continue; }
      const L = s.spec.length;
      w.shipWake(s, scaled);
      // A sinking hull churns the water round it: little foam (stamped every frame it would build to a flat white disc
      // under the lace pattern), much turbulence, which roughens and lightens the water.
      if (s.sinking > 0) w.stamp(s.x, s.z, s.heading, L * 0.7, 0.0015 * k, 1.6, 30);
      else if (s.fire > 0.3) w.stamp(s.x, s.z, s.heading, L * 0.6, 0.0008 * k, 1.6, 6);
    }
  }

  private updateSun() {
    const t = this.rts.target;
    const extent = Math.min(900, Math.max(110, this.rts.distance * 0.95));
    const cam = this.sun.shadow.camera;
    if (cam.right !== extent) {
      cam.left = -extent;
      cam.right = extent;
      cam.top = extent;
      cam.bottom = -extent;
      cam.updateProjectionMatrix();
    }
    const dir = atmosphere.sunDir.value as Vector3;
    const texel = (extent * 2) / this.sun.shadow.mapSize.x;
    const sx = Math.round(t.x / texel) * texel;
    const sz = Math.round(t.z / texel) * texel;
    this.sun.target.position.set(sx, 0, sz);
    this.sun.position.set(sx + dir.x * 1400, Math.max(dir.y, 0.08) * 1400, sz + dir.z * 1400);
    this.sun.target.updateMatrixWorld();
  }

  render() {
    if (!this.ready || this.pageHidden) return;
    const started = performance.now();
    this.wake.update(this.renderer, this.lastScaled);
    this.fft?.update(this.renderer, waveField.time);
    this.frame += 1;
    // Lower levels refresh shadows every few frames. Each refresh redraws the whole shadow map.
    this.sun.shadow.autoUpdate = this.shadowEvery === 1;
    this.sun.shadow.needsUpdate = this.frame % this.shadowEvery === 0;
    if (this.clouds && this.frame % this.cloudEvery === 0) this.clouds.render(this.renderer, this.camera);
    this.pipeline.render();
    this.probeGpu();
    this.cpuMs = this.updateMs + performance.now() - started;
  }

  /**
   * Time from submitting this frame to the GPU finishing it. One probe is in flight at a time, so the cost is one
   * promise per few frames. The frame controller uses it to tell a GPU-bound frame rate from a capped one.
   */
  private probeGpu() {
    if (this.gpuProbe) return;
    const device = (this.renderer.backend as unknown as { device?: { queue?: { onSubmittedWorkDone?: () => Promise<void> } } | null }).device;
    const done = device?.queue?.onSubmittedWorkDone;
    if (!device || !done) return;
    this.gpuProbe = true;
    const started = performance.now();
    done.call(device.queue).then(
      () => {
        this.gpuMs = performance.now() - started;
        this.gpuProbe = false;
      },
      () => {
        this.gpuProbe = false;
      },
    );
  }

  /** Applies a quality level to everything that can change while a battle is running. */
  private applyLevel(l: number) {
    const L = LEVELS[l]!;
    this.level = l;
    this.renderer.setPixelRatio(this.pixelRatio());
    this.clouds?.setQuality(L.cloud);
    this.cloudEvery = L.cloud.every;
    this.applyCpuStep();
    this.vegetation?.setLite(L.vegetationLite);
    this.ocean?.setRefraction(L.refraction);
    this.bloomNode?.setResolutionScale(L.bloomResolution);
    if (this.bloomNode) this.bloomNode.strength.value = L.bloomStrength;
    this.publish(true);
  }

  /** The particles and shadow redraws the level allows, less what the CPU step gives up. */
  private applyCpuStep() {
    const L = LEVELS[this.level]!;
    const step = CPU_STEPS[this.cpuStep]!;
    this.shadowEvery = Math.max(L.shadowEvery, step.shadowEvery);
    this.fx?.setParticleKeep(Math.max(LEVELS[0]!.particleKeep, L.particleKeep * step.particles));
  }

  /** From the settings panel. 'auto' hands control back to the frame-rate controller. */
  setQualityLevel(setting: LevelSetting) {
    if (setting === 'auto') this.adaptive?.setAuto(true);
    else this.adaptive?.pin(setting);
    saveLevelSetting(setting);
    this.publish(true);
  }

  publish(force = false) {
    const b = this.battle;
    const info = this.battleInfo;
    const morale = b.morale;
    // Ships a grapple was thrown at, gathered once: asking the whole fleet for each ship cost 400,000 comparisons in Busan.
    const held = new Set<number>();
    for (const o of b.ships) if (o.grappledWith) held.add(o.grappledWith);
    const squadrons = b.squadrons.map((sq) => {
      let alive = 0;
      let hull = 0;
      let crew = 0;
      let burning = 0;
      let boarding = 0;
      let selected = 0;
      let nerve = 0;
      let wavering = 0;
      let routing = 0;
      for (const id of sq.shipIds) {
        const s = b.get(id);
        if (!s || !b.isActive(s) || !shipObserved(b, this.team, s)) continue;
        alive += 1;
        hull += s.hull / s.spec.hull;
        crew += s.crew / s.spec.crew;
        nerve += s.morale;
        if (s.moraleState === 'wavering') wavering += 1;
        else if (s.moraleState === 'routing') routing += 1;
        if (s.fire > 0.05) burning += 1;
        if (s.grappledWith || held.has(s.id)) boarding += 1;
        if (this.views.selected.has(s.id)) selected += 1;
      }
      const leader = b.get(sq.leaderId);
      const drum = morale && sq.team === this.team && b.isActive(leader) && leader.moraleState !== 'routing' ? { wait: Math.ceil(morale.drumWait(sq.id)), beating: (morale.drums.get(sq.id)?.until ?? 0) > b.time } : null;
      return {
        id: sq.id,
        team: sq.team,
        faction: sq.faction,
        name: sq.name,
        commander: sq.commander,
        portrait: sq.portrait,
        card: sq.card,
        kind: (b.get(sq.leaderId) ?? b.get(sq.shipIds[0] ?? 0))?.spec.kind ?? 'panokseon',
        total: this.initialSquads.get(sq.id) ?? sq.shipIds.length,
        alive,
        hull: alive ? hull / alive : 0,
        crew: alive ? crew / alive : 0,
        burning,
        boarding,
        selected: alive > 0 && selected === alive,
        morale: alive ? nerve / alive : 0,
        wavering,
        routing,
        drum,
      };
    });
    const primary = [...this.views.selected].map((id) => b.get(id)).find((s) => !!s && s.alive);
    const own = this.team;
    const enemy = this.enemyTeam;
    const strengthOwn = b.strength(own);
    const enemies = b.ships.filter((s) => s.team === enemy && b.isActive(s) && shipObserved(b, own, s));
    // Enemy crews still running when the battle is decided got away: the result counts them as fled, not as afloat.
    const running = b.ended && morale ? b.ships.filter((s) => s.team === enemy && s.moraleState === 'routing' && b.isActive(s) && shipObserved(b, own, s)).length : 0;
    const strengthEnemy = b.profile === 'historical' ? b.strength(enemy) : enemies.reduce((n, s) => n + combatValue(s.spec.kind, b.profile) * ((s.hull / s.spec.hull) * 0.6 + (s.crew / s.spec.crew) * 0.4), 0);
    const snapshot: GameSnapshot = {
      scenario: { id: info.id, title: info.title, hanja: info.hanja, date: info.date, place: info.place, season: info.season },
      mode: info.mode,
      sides: this.sideNames(),
      faction: this.faction,
      team: own,
      time: b.time,
      own: b.teamCount(own),
      enemy: (b.profile === 'historical' ? b.teamCount(enemy) : enemies.length) - running,
      observedEnemy: b.profile !== 'historical',
      ownTotal: b.initial[own],
      enemyTotal: b.initial[enemy],
      escaped: b.escaped[enemy] + running,
      balance: this.conquest ? this.conquest.tickets[own] / Math.max(1, this.conquest.tickets[own] + this.conquest.tickets[enemy]) : strengthOwn / Math.max(1, strengthOwn + strengthEnemy),
      winner: b.winner,
      draw: b.draw,
      paused: this.paused,
      speed: this.speed,
      autoFast: this.autoFast && !this.remote,
      fastForward: this.fastForward,
      approach: !this.remote && !this.approachOver && !this.battle.ended,
      sky: this.skyName,
      sea: this.seaName,
      following: this.rts.followId,
      cinematic: this.rts.cinematic,
      fps: this.fps,
      level: this.level,
      levelAuto: this.adaptive?.auto ?? levelSetting === 'auto',
      muted: this.sound.muted,
      selectedCount: this.views.selected.size,
      night: b.night,
      morale: morale ? { own: this.fleetMorale(own), foe: this.fleetMorale(enemy) } : null,
      tide: this.current
        ? {
            label: t(Math.abs(b.tide) < 0.15 ? '정조 · 물살이 멎었습니다' : b.profile === 'historical' ? b.tide < 0 ? '밀물 · 일본 함선 쪽으로 흐릅니다' : '썰물 · 물길이 뒤집혔습니다' : b.tide < 0 ? '밀물 · 항로별 물살에 주의하세요' : '썰물 · 조류의 방향이 바뀝니다'),
            knots: Math.round(this.current.peakSpeed(b.tide) * 1.944 * 10) / 10,
            dir: Math.sign(b.tide),
          }
        : null,
      squadrons,
      primary: primary
        ? {
            id: primary.id,
            name: primary.name,
            kind: primary.spec.label,
            shipKind: primary.spec.kind,
            team: primary.team,
            hull: primary.hull / primary.spec.hull,
            crew: Math.round(primary.crew),
            maxCrew: primary.spec.crew,
            fire: primary.fire,
            damageState: primary.damageState,
            activity: b.activityOf(primary.id),
            fireMode: primary.fireMode,
            ammo: primary.ammo,
            speedCap: primary.speedCap,
            stance: primary.stance,
            lights: primary.lights,
            repel: primary.repel,
            grappled: !!primary.grappledWith || held.has(primary.id),
            morale: primary.morale,
            moraleState: primary.moraleState,
            roles: primary.roles.map((r) => Math.round(r)),
            plan: [...primary.plan],
            defaultPlan: [...primary.spec.crewPlan],
            arms: primary.spec.arms,
            owned: primary.owner === this.owner,
            guns: primary.guns.map((g) => {
              const spec = b.gunSpec(primary.spec.kind, primary.spec.batteries[g.battery]!.gun);
              const need = spec.stages[g.stage] ?? 1;
              return {
                label: spec.label,
                side: g.side,
                stage: g.stage,
                stageName: t(g.ammo < 1 - 1e-9 ? '탄약 없음' : GUN_STAGE[Math.min(g.stage, GUN_STAGE.length - 1)]!),
                empty: g.ammo < 1 - 1e-9,
                progress: g.stage >= 4 ? 1 : Math.min(1, g.t / need),
              };
            }),
          }
        : null,
      conquest: this.conquestSnapshot(),
    };
    if (snapshot.morale) this.announceFleets(snapshot.morale);
    publish(snapshot, force);
  }

  /** Tells the player when either fleet as a whole wavers, breaks or steadies again, once the change has held two seconds. */
  private announceFleets(m: { own: FleetMorale; foe: FleetMorale }) {
    const now = this.battle.time;
    for (const side of ['own', 'foe'] as const) {
      const f = this.fleetCalls[side];
      const state = m[side].state;
      if (state !== f.pending) {
        f.pending = state;
        f.since = now;
      }
      if (state === f.shown || now - f.since < 2 || this.battle.ended) continue;
      const before = f.shown;
      f.shown = state;
      const own = side === 'own';
      if (state === 'broken') pushToast(t(own ? '아군 함대가 무너졌습니다 · 대부분의 함선이 달아납니다' : '적 함대가 무너져 달아납니다'), own ? 'bad' : 'good');
      else if (state === 'shaken' && before === 'steady') pushToast(t(own ? '아군 함대 동요 · 북을 울려 다잡으세요' : '적 함대 동요'), own ? 'bad' : 'good');
      else if (state === 'steady') pushToast(t(own ? '아군 함대가 전열을 되찾았습니다' : '적 함대가 전열을 되찾았습니다'), own ? 'good' : 'bad');
    }
  }

  /** A fleet's nerve as the player can see it: the ships it has in view, under the battle depth rules. */
  private fleetMorale(team: Team): FleetMorale {
    const b = this.battle;
    let n = 0;
    let level = 0;
    let shaken = 0;
    let running = 0;
    // The ships themselves, not the battle's step lists: an online client's battle is never stepped.
    for (const s of b.ships) {
      if (s.team !== team || !b.isActive(s) || !shipObserved(b, this.team, s)) continue;
      n += 1;
      level += s.morale;
      if (s.moraleState === 'routing') running += 1;
      else if (s.moraleState !== 'steady') shaken += 1;
    }
    if (!n) return { level: 0, shaken: 0, running: 0, state: 'steady' };
    const out = { level: level / n, shaken: shaken / n, running: running / n };
    return { ...out, state: out.running >= 0.6 ? 'broken' : out.level < 0.5 || out.shaken + out.running >= 0.3 ? 'shaken' : 'steady' };
  }

  /** Display names for the two sides, the player's first. */
  private sideNames() {
    const setup = this.conquestSetup;
    if (setup) {
      const names = (team: Team) => {
        const factions = [...new Set(setup.seats.filter((s) => s.team === team).map((s) => s.faction))];
        return factions.length === 1 ? t(FACTION_NAME[factions[0]!]) : t('{names} 수군', { names: factions.map((f) => t(FACTION_SHORT[f])).join('·') });
      };
      return { own: names(this.team), enemy: names(this.enemyTeam) };
    }
    const ming = !!SCENARIOS[this.scenarioId].ming;
    const name = (team: Team) => (team === 'japan' ? t(FACTION_NAME.japan) : !ming ? t(FACTION_NAME.joseon) : t(this.faction === 'ming' ? '명·조선 연합' : '조선·명 연합'));
    return { own: name(this.team), enemy: name(this.enemyTeam) };
  }

  private conquestSnapshot(): GameSnapshot['conquest'] {
    const c = this.conquest;
    if (!c) return null;
    const me = c.player(this.owner)!;
    const fleet = c.fleet(this.battle, this.owner);
    const sideOf = (t: Team | null) => (t ? (t === this.team ? 'own' : 'foe') : 'none') as 'own' | 'foe' | 'none';
    const p = c.points[this.selectedPoint];
    const mine = !!p && p.owner === this.owner;
    const observed = !!p && (c.teamOfPoint(p) === this.team || pointVisible(this.battle, this.team, p.x, p.z));
    return {
      tickets: { own: Math.max(0, Math.round(c.tickets[this.team])), foe: Math.max(0, Math.round(c.tickets[this.enemyTeam])), max: c.options.tickets },
      timeLeft: Math.max(0, c.options.timeLimit - this.battle.time),
      funds: Math.floor(me.funds),
      income: me.income,
      fleetValue: fleet.value,
      cap: me.cap,
      ships: fleet.count,
      maxShips: c.shipLimit(this.owner),
      held: { own: c.held(this.team), foe: c.held(this.enemyTeam) },
      points: c.points.map((q) => ({ id: q.id, name: q.name, side: sideOf(c.teamOfPoint(q)), hold: q.hold, contested: q.contested })),
      selected: p
        ? {
            id: p.id,
            name: p.name,
            side: sideOf(c.teamOfPoint(p)),
            holder: p.owner >= 0 ? `${t(c.player(p.owner)!.name)} · ${t(FACTION_NAME[c.player(p.owner)!.faction])}` : t('주인 없음'),
            value: p.value,
            home: p.home >= 0,
            contested: p.contested,
            hold: p.hold,
            mine,
            observed,
            expanded: !!c.options.expanded,
            buildings: p.buildings.map((bd, slot) => (observed && bd ? { slot, kind: bd.kind, label: BUILDINGS[bd.kind].label, progress: bd.progress, hp: bd.hp / buildingHp(bd.kind, bd.level), level: bd.level, upgradeLeft: bd.upgradeLeft, upgradeTotal: bd.upgradeTotal, upgradeCost: bd.level < 3 ? upgradeCost(bd.kind, bd.level) : 0, upgradeTime: bd.level < 3 ? c.upgradeDuration(bd.kind, bd.level) : 0, canUpgrade: mine && c.canUpgrade(this.owner, p.id, slot) } : null)),
            queue: observed ? p.queue.map((q, i) => ({ kind: q.kind, label: SHORT_NAME[q.kind], left: Math.max(0, q.left / c.constructionRate(p.owner)), total: q.total / c.constructionRate(p.owner), working: i < c.queueWorkers(p) })) : [],
            build: BUILDING_ORDER.filter((kind) => c.options.expanded || kind !== 'camp').map((kind) => ({ kind, label: BUILDINGS[kind].label, cost: BUILDINGS[kind].cost, time: c.buildTime(kind), desc: c.buildingDesc(kind), ok: mine && c.canBuild(this.owner, p.id, kind) })),
            recruit: rosterOf(me.faction, c.options.expanded).map((kind) => ({ kind, label: SHORT_NAME[kind], cost: this.battle.shipSpec(kind).cost, time: Math.ceil(c.recruitTime(kind) / c.constructionRate(this.owner)), ok: mine && c.canRecruit(this.battle, this.owner, p.id, kind) })),
            shipyard: observed && c.count(p, 'shipyard') > 0,
            yardSlots: observed ? c.yardSlots(p) : 0,
            rally: observed ? p.rally ?? null : null,
          }
        : null,
    };
  }

  screenPosition(x: number, y: number, z: number, out: Vector2) {
    const v = new Vector3(x, y, z).project(this.camera);
    const el = this.renderer.domElement;
    out.set((v.x * 0.5 + 0.5) * el.clientWidth, (-v.y * 0.5 + 0.5) * el.clientHeight);
    return v.z < 1;
  }

  selectSquadron(id: number, additive: boolean) {
    const sq = this.battle.squadron(id);
    if (!sq) return;
    if (!additive) this.views.selected.clear();
    for (const sid of sq.shipIds) if (this.battle.isActive(this.battle.get(sid))) this.views.selected.add(sid);
    this.publish(true);
  }

  focusSquadron(id: number) {
    const sq = this.battle.squadron(id);
    if (!sq) return;
    let x = 0;
    let z = 0;
    let n = 0;
    for (const sid of sq.shipIds) {
      const s = this.battle.get(sid);
      if (!s || !s.alive) continue;
      x += s.x;
      z += s.z;
      n += 1;
    }
    if (!n) return;
    this.rts.followId = 0;
    this.rts.goal.tx = x / n;
    this.rts.goal.tz = z / n;
  }

  /** Gives back everything the battle holds: inputs, labels, GPU buffers and programs, and the graphics device itself. */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.ready = false;
    if (this.loading) this.cancelLoad(this.loading);
    this.skyLoading?.abort();
    this.skyLoading = null;
    this.releaseVisibility?.();
    this.releaseVisibility = null;
    this.releaseDevice?.();
    this.releaseDevice = null;
    this.input?.detach();
    this.touch?.detach();
    this.rts.detach();
    this.banners?.clear();
    this.moveOrders?.dispose();
    this.moveOrders = null;
    this.tacticalOverlay?.dispose();
    this.tacticalOverlay = null;
    this.releasePixelRatio?.();
    this.releasePixelRatio = null;
    this.minimap.onPick = null;
    this.remote?.dispose();
    this.remote = null;
    this.sink = null;
    this.disposeBattle();
    this.clouds?.dispose();
    this.placeholderSky?.dispose();
    this.placeholderSky = null;
    this.wake.dispose();
    this.views?.renderer.dispose();
    if (this.views) disposeTree(this.views.group);
    this.fx?.dispose();
    this.munitionsGallery?.dispose();
    if (this.lanterns) disposeTree(this.lanterns.group);
    this.pipeline?.dispose();
    this.sky?.view.dispose();
    this.sky?.environment.dispose();
    void releaseShipAssets(new Set());
    this.renderer.dispose().catch(() => undefined);
  }

  info() {
    return {
      fps: this.fps,
      ships: this.battle.ships.filter((s) => s.alive).length,
      onLand: this.battle.ships.filter((s) => s.alive && this.terrain.heightAt(s.x, s.z) > -1.4).length,
      projectiles: this.battle.projectiles.length,
      smoke: this.fx?.smoke.count,
      fire: this.fx?.fire.count,
      batches: this.views?.renderer.stats(),
      backend: (this.renderer.backend as unknown as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'webgpu' : 'webgl2',
      phi: +this.phi.toFixed(3),
      sig: +waveField.significantHeight().toFixed(2),
    };
  }
}
