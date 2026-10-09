import {
  ACESFilmicToneMapping,
  DataTexture,
  DirectionalLight,
  EquirectangularReflectionMapping,
  HalfFloatType,
  PCFShadowMap,
  PerspectiveCamera,
  RenderPipeline,
  RGBAFormat,
  Scene,
  Vector2,
  Vector3,
  type WebGPURenderer,
} from 'three/webgpu';
import {
  cameraPosition,
  exp,
  float,
  fog,
  length,
  mix,
  normalize,
  pass,
  pmremTexture,
  positionWorld,
  renderOutput,
  smoothstep,
  uniform,
  uv,
  vec3,
  vec4,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { smaa } from 'three/addons/tsl/display/SMAANode.js';
import { atmosphere } from '../render/atmosphere';
import { loadSky, SKY_PRESETS, type LoadedSky, type SkyPresetName } from '../render/sky';
import { Ocean } from '../ocean/Ocean';
import { Clouds } from '../render/Clouds';

const COVERAGE: Record<SkyPresetName, number> = { afternoon: 0.5, day: 0.42, sunset: 0.46, overcast: 0.78, night: 0.38 };
import { WakeMap } from '../ocean/WakeMap';
import { SEA_STATES, spectrumOf, waveField, type SeaStateName } from '../ocean/waves';
import { FFTWaves } from '../ocean/FFTWaves';
import { CUT_CAP, loadShipAssets, releaseShipAssets, type ModelAsset, type ShipAssetOptions } from '../ships/ShipRenderer';
import { ShipViews } from '../ships/ShipViews';
import { Effects } from '../fx/Effects';
import { Crew, crewAssets } from '../fx/Crew';
import { Lanterns } from '../fx/Lanterns';
import { Battle, SIM_DT } from '../sim/battle';
import { GUN_SPECS, STAGE_NAMES } from '../sim/catalog';
import { buildScenario, SCENARIOS, type FleetSpawn, type ScenarioId } from '../sim/scenarios';
import { applyBalance, FACTION_NAME } from '../sim/balance';
import { applyOutcome } from '../campaign/campaign';
import { finishGrandBattle } from '../campaign/grand';
import { outcomeOfBattle, type RegionBattle } from '../sim/grand/bridge';
import { buildGrandConquest, grandAxis, grandInfo, shipOutcomes, worksAfter } from '../sim/grand/spawn';
import { SHIP_SPECS } from '../sim/catalog';
import { CurrentField } from '../sim/current';
import { OWNER_OF, otherTeam, teamOf, type BattleEvent, type Faction, type Ship, type ShipKind, type Team } from '../sim/types';
import { buildConquest, homeAxis, type ConquestMapId, type Seat } from '../sim/maps';
import { BUILDING_ORDER, BUILDINGS, ROSTER, SHORT_NAME, type Conquest } from '../sim/conquest';
import { applyCommand, type Command } from '../sim/commands';
import { conquestInfo, scenarioInfo, type BattleInfo } from '../sim/info';
import { ConquestView, preloadWorks } from '../conquest/ConquestView';
import type { NetBattle } from '../net/NetBattle';
import { RtsCamera, type CameraPose } from '../camera/RtsCamera';
import { Director } from './Director';
import { Input } from './Input';
import { TouchControls } from './Touch';
import { AdaptiveQuality } from './adaptive';
import { equipment, LEVELS, levelSetting, saveLevelSetting, startLevel, type LevelSetting, type OceanQuality, type TerrainQuality } from './quality';
import { failBattle, publish, pushToast, setLoading, setProgress, setReport, type GameSnapshot } from '../state/store';
import { SquadronBanners } from '../ui/SquadronBanners';
import { sound } from '../audio/Sound';
import { Terrain } from '../terrain/Terrain';
import { Vegetation } from '../terrain/Vegetation';
import { preloadStructures, Structures } from '../terrain/Structures';
import { disposeTree } from '../render/dispose';
import { tuneWebGLBackend } from '../render/webglBackend';

import { Minimap } from '../ui/Minimap';

const params = new URLSearchParams(location.search);

export type EngineOptions = {
  scenario: ScenarioId;
  sky?: SkyPresetName;
  sea?: SeaStateName;
  pose?: CameraPose;
  warmup?: number;
  gallery?: boolean;
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

/** What the HUD calls a conquest battle: a campaign meeting is named for its region and month and fought on the region's own coast. */
function conquestInfoOf(setup: ConquestSetup): BattleInfo {
  return setup.grand ? grandInfo(setup.grand) : conquestInfo(setup.map);
}

/** A conquest battle: the map, every seat, and which seat is the player's. `grand` is a faction campaign meeting played on its region's coast instead of a conquest map, with the campaign's own ships. */
export type ConquestSetup = { seats: Seat[]; you: number; seed: number } & ({ map: ConquestMapId; grand?: undefined } | { grand: RegionBattle; map?: undefined });

/** Sends commands somewhere other than the local battle: a multiplayer server. */
export interface CommandSink {
  send(cmd: Command): void;
}

/** Every kind there is: the gallery shows them all. A battle loads only the kinds it uses. */
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
const DEVICE_LOST_TEXT = '그래픽 장치가 멈췄습니다 — 메모리가 부족했을 수 있습니다. 페이지를 새로고침해 주세요';

/** Multipliers the player can pick. The approach before first contact runs at the largest. */
export const SPEEDS = [1, 2, 4, 8, 16, 32, 64, 128] as const;
const FAST_SPEED = SPEEDS[SPEEDS.length - 1];
/** The approach ends when two hostile ships come this close (inside the computer's broadside range), or at the first shot. */
const CONTACT_RANGE = 400;
/**
 * Sim steps per frame are capped by count and by time, so high multipliers degrade gracefully on a slow device.
 * The time budget grows with the multiplier: at 16x and up the player wants the battle to move, not a smooth 60 fps.
 */
const MAX_STEPS = 160;
const simBudgetMs = (speed: number) => (speed >= 64 ? 32 : speed >= 16 ? 24 : speed >= 8 ? 14 : 9);

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
  readonly sound = sound;
  readonly minimap = new Minimap();
  private minimapTimer = 0;
  showLabels = true;
  speed = 1;
  paused = false;
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
  private fogEnv!: ReturnType<typeof pmremTexture>;
  private accumulator = 0;
  private publishTimer = 0;
  private fpsFrames = 0;
  private fpsTime = 0;
  private lastScaled = 0;
  private vignette = uniform(0.32);
  private phi = 0;
  /** Cinematic camera, kill-cam slow motion and shot feel. */
  readonly director = new Director(this);
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
  private dprOverride: number | null = null;
  private gpuMs: number | null = null;
  private gpuProbe = false;
  private touch: TouchControls | null = null;

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
    r.onDeviceLost = (info) => {
      previous.call(r, info);
      this.ready = false;
      setLoading(DEVICE_LOST_TEXT, 1);
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
    if (this.sink) {
      this.sink.send(cmd);
      return 'ids' in cmd ? cmd.ids.length : 1;
    }
    return applyCommand(this.battle, this.owner, cmd, this.conquest);
  }

  async init() {
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
    setLoading('바다와 하늘을 그리는 중', 0.03, info.art ?? null);
    // The files download while the cloud and wake shaders build, so neither waits for the other.
    const loading = this.loadAssets(0.03);
    await this.warmShared();
    const [sky, terrain, assets] = await loading;
    this.assets = assets;
    this.terrain = terrain;
    this.scene.add(terrain.group);
    setLoading('숲과 마을을 세우는 중', 0.64);
    this.dressTerrain();
    this.applySky(sky);
    setLoading('함대를 배치하는 중', 0.68);
    this.placeScenario(sky);
    setLoading('바다와 하늘을 짓는 중', 0.72);
    if (this.eq.fft && (r.backend as unknown as { isWebGPUBackend?: boolean }).isWebGPUBackend) this.fft = new FFTWaves(spectrumOf(SEA_STATES[this.seaName]), this.eq.fftN);
    this.ocean = new Ocean(waveField, sky.environment, this.wake, this.terrain, this.fft, this.current, this.oceanQuality());
    this.scene.add(this.ocean.mesh);
    const sun = this.sun;
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
    this.fx.onShake = (k) => this.rts.shake(k);
    this.fx.onCue = (kind, x, y, z, size) => this.sound.cue(kind, x, y, z, size);
    this.scene.add(this.fx.group);
    this.crew = new Crew(this.views);
    this.scene.add(this.crew.group);
    this.lanterns = new Lanterns(this.views);
    this.lanterns.onLight = (x, y, z, i) => this.fx.lantern(x, y, z, i);
    this.scene.add(this.lanterns.group);
    this.setupFog(sky.environment);
    this.setupPipeline();
    if (!this.options.hideLabels) {
      this.banners = new SquadronBanners(document.querySelector('.app') ?? document.body);
      this.banners.onSelect = (id, additive) => this.selectSquadron(id, additive);
    }
    this.input = new Input(this);
    this.input.attach(r.domElement);
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
    await this.prewarm(0.78);
    this.adaptive = new AdaptiveQuality(this.level, levelSetting === 'auto', (l) => this.applyLevel(l), this.eq.maxLevel);
    this.applyLevel(this.level);
    setProgress(1);
    this.resetApproach();
    this.ready = true;
    this.remote?.announce();
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
  private async loadAssets(from: number) {
    const info = this.battleInfo;
    const weights = { sky: 0.1, terrain: 0.2, ships: 0.26, crew: 0.03 };
    const span = 0.62 - from;
    const total = weights.sky + weights.terrain + weights.ships + weights.crew;
    let done = from;
    const add = (w: number) => {
      done += (w / total) * span;
      setProgress(done);
    };
    const track = <T,>(p: Promise<T>, w: number) =>
      p.then((v) => {
        add(w);
        return v;
      });
    const options = this.shipOptions();
    const shipsDone = (w: number) => (f: number) => setProgress(done + f * (w / total) * span);
    const [sky, terrain, assets] = await Promise.all([
      track(loadSky(SKY_PRESETS[this.skyName], this.eq.hdriSize, this.sky ?? undefined), weights.sky),
      track(Terrain.load(info.terrain, this.terrainQuality()), weights.terrain),
      track(loadShipAssets(this.kindsInBattle(), options, shipsDone(weights.ships)), weights.ships),
      track(crewAssets(), weights.crew),
      preloadStructures(),
      this.conquestSetup ? preloadWorks() : undefined,
    ]);
    return [sky, terrain, assets] as const;
  }

  /**
   * The cloud layer and the wake map do not depend on the battle's files, so they are built and run once up front, while
   * the sky, terrain and ships are still downloading. The clouds start on a plain placeholder sky; applySky swaps in the
   * real one. The march shader is built for the most steps the tier's levels can ask for, which is a smaller program on a phone.
   */
  private async warmShared() {
    if (params.get('clouds') !== '0' && this.eq.clouds) {
      const reach = LEVELS.slice(0, Math.max(this.eq.maxLevel, this.level) + 1);
      const limits = { steps: Math.max(...reach.map((l) => l.cloud.steps)), lightSteps: Math.max(...reach.map((l) => l.cloud.lightSteps)) };
      const gray = new DataTexture(new Uint16Array(64 * 32 * 4).fill(0x3800), 64, 32, RGBAFormat, HalfFloatType);
      gray.mapping = EquirectangularReflectionMapping;
      gray.needsUpdate = true;
      this.placeholderSky = gray;
      this.clouds = new Clouds(gray, LEVELS[this.level]!.cloud, limits);
      this.clouds.coverage.value = COVERAGE[this.skyName];
      this.scene.add(this.clouds.mesh);
    }
    await settle();
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
   * Builds every program and pass before the battle shows, so none compiles on the first frames as a hitch. WebGPU
   * builds its pipelines in parallel behind compileAsync, which reports progress. On WebGL the driver compiles one
   * program at a time, and compileAsync takes twice as long as rendering the scene would, so the whole pipeline is
   * rendered once part by part (ground, sea and sky, ships and crew), each step moving the loading bar. Last comes
   * the render with everything, and with the refracting ocean if a level can reach it. `from` is where the bar starts.
   */
  private async prewarm(from: number) {
    const r = this.renderer;
    const webgpu = !!(r.backend as unknown as { isWebGPUBackend?: boolean }).isWebGPUBackend;
    setLoading('셰이더를 준비하는 중', from);
    await Promise.all([this.worksLoad, this.conquestLoad]);
    // The land is drawn in tiles that the camera culls. All of them draw during warm-up, so the terrain program is built here
    // and not when land first comes into view.
    this.terrain.setCulling(false);
    if (webgpu) {
      await r.compileAsync(this.scene, this.camera, null, (e) => setProgress(from + 0.16 * (e.loaded / Math.max(1, e.total))));
    } else {
      await this.compileByParts(from);
    }
    setLoading('첫 화면을 그리는 중', from + 0.2);
    await settle();
    this.primeOcean();
    this.terrain.setCulling(true);
    setProgress(from + 0.22);
  }

  /** Renders the pipeline once per group of the scene, letting the loading bar move between the blocking renders. */
  private async compileByParts(from: number) {
    const clouds = this.clouds?.mesh;
    const works = this.conquestView?.group;
    const parts = [this.terrain.group, this.ocean.mesh, clouds, this.views.group, this.crew.group, this.fx.group, this.lanterns.group, works].filter((o): o is NonNullable<typeof o> => !!o);
    const steps: [string, (typeof parts)[number][]][] = [
      ['땅과 숲을 준비하는 중', [this.terrain.group, ...(works ? [works] : [])]],
      ['바다와 하늘을 준비하는 중', [this.ocean.mesh, ...(clouds ? [clouds] : [])]],
      ['함선과 병사를 준비하는 중', [this.views.group, this.crew.group, this.fx.group, this.lanterns.group]],
    ];
    const visible = parts.map((o) => o.visible);
    for (const [n, [text, show]] of steps.entries()) {
      setLoading(text, from + 0.04 + n * 0.05);
      await settle();
      parts.forEach((o) => (o.visible = show.includes(o)));
      this.pipeline.render();
      parts.forEach((o, i) => (o.visible = visible[i]!));
    }
  }

  private terrainQuality(): TerrainQuality {
    return { mesh: this.eq.terrainMesh, triplanar: this.eq.triplanar, anisotropy: this.eq.anisotropy, noise: this.eq.noise, texSize: this.eq.terrainTexSize };
  }

  private oceanQuality(): OceanQuality {
    return { segments: this.eq.oceanSegments, lights: this.eq.lights };
  }

  /**
   * Renders the whole pipeline once with the ocean the first level will use, and once more with the refracting ocean if
   * a level can reach it. A tier that stops below the refraction levels never builds that variant at all.
   */
  private primeOcean() {
    if (this.eq.maxLevel >= 3 || this.level >= 3) {
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
      const built = setup.grand ? buildGrandConquest(setup.grand, land, this.phi) : buildConquest(setup.map, setup.seats, land, setup.seed, {}, this.phi);
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
    this.reported = false;
    setReport(null);
    this.battle.land = (x, z) => this.terrain.heightAt(x, z);
    this.current = info.current ? new CurrentField(info.current, (x, z) => this.terrain.heightAtScenario(x, z), this.phi) : null;
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
    pushToast(['선내 보기를 닫는다', '상갑판 — 지붕과 장대를 걷어낸다', '포갑판 — 포수와 사부', '노갑판 — 격군'][this.cutaway]!);
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
    const b = new Battle(7);
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
    const scale = (0.16 / Math.max(1e-4, info.ambientLum)) * preset.brightness;
    this.scene.background = sky.background;
    this.scene.environment = sky.environment;
    this.scene.backgroundIntensity = scale;
    this.scene.environmentIntensity = scale * 1.45;
    atmosphere.envIntensity.value = scale;
    atmosphere.sunDir.value.copy(info.sunDir);
    atmosphere.sunIrradiance.value.copy(info.sunIrradiance).multiplyScalar(scale);
    atmosphere.skyAmbient.value.copy(info.skyAmbient).multiplyScalar(scale);
    atmosphere.horizon.value.copy(info.horizon).multiplyScalar(scale);
    atmosphere.fogDensity.value = preset.fogDensity;
    atmosphere.night.value = preset.night;
    const irr = info.sunIrradiance;
    const lum = Math.max(1e-4, 0.2126 * irr.x + 0.7152 * irr.y + 0.0722 * irr.z);
    this.sun.color.setRGB(irr.x / lum, irr.y / lum, irr.z / lum);
    this.sun.intensity = lum * scale * 1.35;
    this.renderer.toneMappingExposure = preset.exposure;
    if (this.fx) this.fx.night = preset.night;
    if (this.ocean) this.ocean.setEnvironment(sky.environment);
    if (this.clouds) {
      this.clouds.setEnvironment(sky.environment);
      this.clouds.coverage.value = COVERAGE[this.skyName];
      this.placeholderSky?.dispose();
      this.placeholderSky = null;
    }
    if (this.fogEnv) this.fogEnv.value = sky.environment;
    // A reused sky keeps its textures. Only a sky that came in new textures frees the ones it replaces.
    if (old && old.background !== sky.background) old.background.dispose();
    if (old && old.environment !== sky.environment) old.environment.dispose();
  }

  private setupFog(env: DataTexture) {
    const toFrag = positionWorld.sub(cameraPosition);
    const dist = length(toFrag);
    const dir = toFrag.div(dist);
    const fogDir = normalize(vec3(dir.x, 0.04, dir.z));
    this.fogEnv = pmremTexture(env, fogDir, float(0.45));
    const fogColor = vec3(this.fogEnv).mul(atmosphere.envIntensity);
    const factor = float(1).sub(exp(dist.mul(atmosphere.fogDensity).negate()));
    this.scene.fogNode = fog(fogColor, factor);
  }

  private setupPipeline() {
    const pipeline = new RenderPipeline(this.renderer);
    pipeline.outputColorTransform = false;
    const scenePass = pass(this.scene, this.camera, { samples: this.eq.msaa });
    const color = scenePass.getTextureNode('output');
    this.bloomNode = bloom(color, 0.22, 0.5, 2.2);
    const hdr = color.add(this.bloomNode);
    const mapped = renderOutput(hdr);
    const d = length(uv().sub(0.5).mul(vec3(1.25, 1, 1).xy));
    const vig = mix(float(1), float(0.62), smoothstep(0.35, 0.95, d).mul(this.vignette.mul(2.5)));
    const luma = mapped.r.mul(0.2126).add(mapped.g.mul(0.7152)).add(mapped.b.mul(0.0722));
    const nightColor = mix(vec3(luma, luma, luma), mapped.rgb, 0.6).mul(vec3(0.8, 0.92, 1.15));
    const toned = mix(mapped.rgb, nightColor, atmosphere.night.mul(float(1).sub(smoothstep(0.25, 0.85, luma))));
    const graded = vec4(toned.mul(vig), 1);
    pipeline.outputNode = smaa(graded);
    this.pipeline = pipeline;
  }

  async setSky(name: SkyPresetName) {
    if (name === this.skyName && this.sky) return;
    this.skyName = name;
    const sky = await loadSky(SKY_PRESETS[name], this.eq.hdriSize, this.sky ?? undefined);
    this.applySky(sky);
    this.publish(true);
  }

  setSea(name: SeaStateName) {
    this.seaName = name;
    waveField.setState(SEA_STATES[name]);
    this.fft?.setSpectrum(spectrumOf(SEA_STATES[name]));
    this.publish(true);
  }

  /** Starts a historical battle on the running engine; with `remote` it is a duel run by the multiplayer server. */
  async setScenario(id: ScenarioId, faction?: Faction, remote: NetBattle | null = null) {
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
    this.remote?.dispose();
    this.remote = remote;
    this.sink = remote;
    this.conquestSetup = setup;
    this.faction = setup.seats[setup.you]!.faction;
    await this.stage(conquestInfoOf(setup));
  }

  private async stage(info: BattleInfo) {
    this.ready = false;
    this.battleInfo = info;
    setLoading(`${info.title} 준비 중`, 0.04, info.art ?? null);
    this.skyName = info.sky;
    this.seaName = info.sea;
    waveField.setState(SEA_STATES[this.seaName]);
    const [sky, terrain, assets] = await this.loadAssets(0.04);
    setLoading('숲과 마을을 세우는 중', 0.64);
    // The previous battle's terrain, ocean and ship batches are freed before the new ones are built, so two battles
    // never sit in memory together.
    this.disposeBattle();
    this.assets = assets;
    this.terrain = terrain;
    this.scene.add(terrain.group);
    this.dressTerrain();
    this.applySky(sky);
    setLoading('함대를 배치하는 중', 0.68);
    this.placeScenario(sky);
    setLoading('바다와 하늘을 짓는 중', 0.72);
    this.fft?.setSpectrum(spectrumOf(SEA_STATES[this.seaName]));
    this.ocean = new Ocean(waveField, sky.environment, this.wake, this.terrain, this.fft, this.current, this.oceanQuality());
    this.scene.add(this.ocean.mesh);
    this.views.reset(this.assets, this.battle, this.capacityHint());
    this.views.team = this.team;
    void releaseShipAssets(new Set(Object.keys(this.assets)));
    this.crew = new Crew(this.views);
    this.scene.add(this.crew.group);
    this.banners?.clear();
    this.sound.newBattle();
    this.fx.newBattle();
    this.rts.setPose(this.defaultPose());
    this.paused = false;
    this.resetApproach();
    await this.prewarm(0.78);
    // The rebuilt terrain, vegetation and ocean start from the plain state. Re-apply the current level to them.
    this.applyLevel(this.level);
    this.ready = true;
    this.remote?.announce();
    setLoading(null);
    this.publish(true);
  }

  /** Frees the previous battle's terrain with its vegetation and villages, the ocean and the conquest works. */
  private disposeBattle() {
    this.vegetation?.dispose();
    this.vegetation = null;
    this.structures?.dispose();
    this.structures = null;
    this.terrain?.dispose();
    this.ocean?.dispose();
    this.current?.texture.dispose();
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
    for (const seat of setup.seats) for (const kind of ROSTER[seat.faction]) hint.set(kind, (hint.get(kind) ?? 0) + Math.min(c.options.maxShips, Math.ceil(c.options.cap / SHIP_SPECS[kind].cost) + 4));
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
    (this.conquestSetup ? this.setConquest({ ...this.conquestSetup, seed: this.conquestSetup.seed + 1 }) : this.setScenario(this.scenarioId)).catch(failBattle);
  }

  private stepSim(dt: number) {
    this.battle.step(dt);
    waveField.time += dt;
  }

  update(frameDt: number) {
    if (!this.ready || this.pageHidden) return;
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
    const speed = base * this.director.timeFactor(base);
    // Above 4x the frame rate is set by the simulation's share of each frame, not by the GPU, so it says nothing
    // about which quality level the device can hold.
    if (this.remote || this.paused || speed <= 4) this.adaptive?.update(frameDt, this.gpuMs);
    const scaled = this.remote ? dt : this.paused ? 0 : dt * speed;
    this.lastScaled = scaled;
    if (this.remote) {
      this.remote.advance(this.battle, this.conquest, dt);
      waveField.time += dt;
    } else {
      // High multipliers ask for many sim steps per frame. Steps stop at a time budget so a slow device keeps drawing
      // frames (and simply runs the battle a little slower than asked) instead of stalling.
      this.accumulator += scaled;
      const start = performance.now();
      const budget = simBudgetMs(speed);
      let steps = 0;
      while (this.accumulator >= SIM_DT && steps < MAX_STEPS) {
        this.stepSim(SIM_DT);
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
    const events = this.battle.events;
    this.views.cutaway.clear();
    for (const id of this.cutawayIds()) this.views.cutaway.set(id, this.cutaway);
    this.views.sync(this.battle, scaled, this.camera, this.assets);
    this.stampWakes(events, scaled);
    if (events.length) {
      this.sound.update(events, this.battle, this.camera, scaled);
      this.director.feed(events);
      this.fx.handle(events, this.battle);
      this.crew.handle(events, this.battle);
      this.input.onEvents(events);
      for (const e of events) if (e.type === 'battery') this.fx.gun(e.x, e.y, e.z, e.dx, e.dy, e.dz, true);
      this.battle.events = [];
    }
    if (this.battle.winner && !this.reported) this.finishCampaignBattle();
    this.director.update(dt);
    const follow = this.rts.followId ? this.views.worldOf(this.rts.followId) : null;
    if (this.rts.followId && !follow) this.rts.followId = 0;
    this.rts.update(dt, follow);
    this.ocean.setTide(this.battle.tide);
    this.clouds?.update(this.camera.position, waveField.time);
    this.vegetation?.update(this.camera);
    this.structures?.update(this.camera);
    const tideSign = Math.abs(this.battle.tide) < 0.15 ? 0 : Math.sign(this.battle.tide);
    if (this.current && tideSign !== this.lastTide) {
      if (tideSign === 0) pushToast('물살이 잦아든다 — 곧 물길이 바뀐다');
      else if (this.lastTide === 0) pushToast(tideSign > 0 ? '울돌목의 물길이 뒤집혔다! 왜선이 밀려난다' : '거센 물살이 왜선을 실어 온다', (tideSign > 0) === (this.team === 'joseon') ? 'good' : 'bad');
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
    this.lanterns.update(this.battle, this.camera);
    this.updateSun();
    const el = this.renderer.domElement;
    this.banners?.update(this.battle, this.views, this.camera, el.clientWidth, el.clientHeight, this.showLabels && !this.rts.cinematic, this.team);
    this.conquestView?.update(this.camera, el.clientWidth, el.clientHeight, this.team, this.selectedPoint, this.showLabels && !this.rts.cinematic && !this.options.hideLabels);
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
  }

  /**
   * Contact: an enemy within CONTACT_RANGE, a shot in the air, or a grapple. Until then the approach can be
   * fast-forwarded; it ends for good at the first contact so the player is never yanked between speeds.
   */
  private updateFastForward(dt: number) {
    const b = this.battle;
    if (this.approachOver || b.winner || this.options.gallery) {
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
    if (this.fastForward) pushToast('적과 접촉 — 정상 속도로 돌아온다', 'info');
    this.approachOver = true;
    this.autoFast = false;
    this.fastForward = false;
  }

  private inContact() {
    const b = this.battle;
    if (b.projectiles.length > 0) return true;
    const own: Ship[] = [];
    const foe: Ship[] = [];
    for (const s of b.ships) {
      if (!s.alive || s.sinking > 0) continue;
      if (s.grappledWith) return true;
      (s.team === this.team ? own : foe).push(s);
    }
    const r2 = CONTACT_RANGE * CONTACT_RANGE;
    for (const a of own) for (const e of foe) if ((a.x - e.x) ** 2 + (a.z - e.z) ** 2 < r2) return true;
    return own.length === 0 || foe.length === 0;
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
    setReport(applyOutcome({ id: this.scenarioId, win: b.winner === this.team, enemySunk, enemyEscaped: b.escaped[enemy], ships }));
  }

  /** A faction campaign meeting is over: the campaign takes what happened to its ships and to the defender's port. */
  private finishGrandBattle(rb: RegionBattle, conquest: Conquest) {
    const works = worksAfter(rb, conquest);
    finishGrandBattle(rb, { ...outcomeOfBattle(rb, this.battle.winner, shipOutcomes(this.battle.ships), works.razed), damage: works.damage });
  }

  /** Withdrawal. The battle counts as lost. */
  endBattle() {
    if (this.battle.winner) return;
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
      if (!s.alive) continue;
      const L = s.spec.length;
      const B = s.spec.beam;
      const c = Math.cos(s.heading);
      const n = Math.sin(s.heading);
      const f = Math.min(1.2, Math.abs(s.speed) / s.spec.maxSpeed);
      if (f > 0.03) {
        w.stamp(s.x - c * L * 0.52, s.z - n * L * 0.52, s.heading, B * 1.05, 0.012 * f * k, 2.2, 2.2);
        w.stamp(s.x - c * L * 0.3, s.z - n * L * 0.3, s.heading, B * 1.2, 0.004 * f * k, 2.5, 3);
        const bx = s.x + c * L * 0.45;
        const bz = s.z + n * L * 0.45;
        w.stamp(bx + n * B * 0.45, bz - c * B * 0.45, s.heading + 0.45, B * 0.6, 0.02 * f * k, 1.8, 1);
        w.stamp(bx - n * B * 0.45, bz + c * B * 0.45, s.heading - 0.45, B * 0.6, 0.02 * f * k, 1.8, 1);
      }
      if (s.sinking > 0) w.stamp(s.x, s.z, s.heading, L * 0.7, 0.03 * k, 1.6, 1.8);
      else if (s.fire > 0.3) w.stamp(s.x, s.z, s.heading, L * 0.6, 0.004 * k, 1.6, 0.6);
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
    this.wake.update(this.renderer, this.lastScaled);
    this.fft?.update(this.renderer, waveField.time);
    this.frame += 1;
    // Lower levels refresh shadows every few frames. Each refresh redraws the whole shadow map.
    this.sun.shadow.autoUpdate = this.shadowEvery === 1;
    this.sun.shadow.needsUpdate = this.frame % this.shadowEvery === 0;
    if (this.clouds && this.frame % this.cloudEvery === 0) this.clouds.render(this.renderer, this.camera);
    this.pipeline.render();
    this.probeGpu();
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
    this.shadowEvery = L.shadowEvery;
    this.fx?.setParticleKeep(L.particleKeep);
    this.vegetation?.setLite(L.vegetationLite);
    this.ocean?.setRefraction(L.refraction);
    this.bloomNode?.setResolutionScale(L.bloomResolution);
    if (this.bloomNode) this.bloomNode.strength.value = L.bloomStrength;
    this.publish(true);
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
    const squadrons = b.squadrons.map((sq) => {
      let alive = 0;
      let hull = 0;
      let crew = 0;
      let burning = 0;
      let boarding = 0;
      let selected = 0;
      for (const id of sq.shipIds) {
        const s = b.get(id);
        if (!s || !b.isActive(s)) continue;
        alive += 1;
        hull += s.hull / s.spec.hull;
        crew += s.crew / s.spec.crew;
        if (s.fire > 0.05) burning += 1;
        if (s.grappledWith || b.ships.some((o) => o.grappledWith === s.id)) boarding += 1;
        if (this.views.selected.has(s.id)) selected += 1;
      }
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
      };
    });
    const primary = [...this.views.selected].map((id) => b.get(id)).find((s) => !!s && s.alive);
    const own = this.team;
    const enemy = this.enemyTeam;
    const strengthOwn = b.strength(own);
    const strengthEnemy = b.strength(enemy);
    const snapshot: GameSnapshot = {
      scenario: { id: info.id, title: info.title, hanja: info.hanja, date: info.date, place: info.place, season: info.season },
      mode: info.mode,
      sides: this.sideNames(),
      faction: this.faction,
      team: own,
      time: b.time,
      own: b.teamCount(own),
      enemy: b.teamCount(enemy),
      ownTotal: b.initial[own],
      enemyTotal: b.initial[enemy],
      escaped: b.escaped[enemy],
      balance: strengthOwn / Math.max(1, strengthOwn + strengthEnemy),
      winner: b.winner,
      paused: this.paused,
      speed: this.speed,
      autoFast: this.autoFast && !this.remote,
      fastForward: this.fastForward,
      approach: !this.remote && !this.approachOver && !this.battle.winner,
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
      tide: this.current
        ? {
            label: Math.abs(b.tide) < 0.15 ? '정조 · 물살이 멎었다' : b.tide < 0 ? '밀물 · 왜선 쪽으로 흐름' : '썰물 · 물길이 뒤집혔다',
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
            team: primary.team,
            hull: primary.hull / primary.spec.hull,
            crew: Math.round(primary.crew),
            maxCrew: primary.spec.crew,
            fire: primary.fire,
            activity: b.activityOf(primary.id),
            fireMode: primary.fireMode,
            ammo: primary.ammo,
            speedCap: primary.speedCap,
            stance: primary.stance,
            lights: primary.lights,
            repel: primary.repel,
            grappled: !!primary.grappledWith || b.ships.some((o) => o.grappledWith === primary.id),
            roles: primary.roles.map((r) => Math.round(r)),
            plan: [...primary.plan],
            defaultPlan: [...primary.spec.crewPlan],
            arms: primary.spec.arms,
            owned: primary.owner === this.owner,
            guns: primary.guns.map((g) => {
              const spec = GUN_SPECS[primary.spec.batteries[g.battery]!.gun];
              const need = spec.stages[g.stage] ?? 1;
              return {
                label: spec.label,
                side: g.side,
                stage: g.stage,
                stageName: g.ammo <= 0 ? '탄약 소진' : g.stage >= 4 ? (g.stage === 4 ? '조준 대기' : '점화') : STAGE_NAMES[g.stage]!,
                progress: g.stage >= 4 ? 1 : Math.min(1, g.t / need),
              };
            }),
          }
        : null,
      conquest: this.conquestSnapshot(),
    };
    publish(snapshot, force);
  }

  /** Display names for the two sides, the player's first. */
  private sideNames() {
    const setup = this.conquestSetup;
    if (setup) {
      const names = (team: Team) => {
        const factions = [...new Set(setup.seats.filter((s) => s.team === team).map((s) => s.faction))];
        return factions.map((f) => FACTION_NAME[f].replace(' 수군', '')).join('·') + ' 수군';
      };
      return { own: names(this.team), enemy: names(this.enemyTeam) };
    }
    const ming = !!SCENARIOS[this.scenarioId].ming;
    const name = (team: Team) => (team === 'japan' ? FACTION_NAME.japan : !ming ? FACTION_NAME.joseon : this.faction === 'ming' ? '명·조선 연합' : '조선·명 연합');
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
    return {
      tickets: { own: Math.max(0, Math.round(c.tickets[this.team])), foe: Math.max(0, Math.round(c.tickets[this.enemyTeam])), max: c.options.tickets },
      timeLeft: Math.max(0, c.options.timeLimit - this.battle.time),
      funds: Math.floor(me.funds),
      income: me.income,
      fleetValue: fleet.value,
      cap: me.cap,
      ships: fleet.count,
      maxShips: c.options.maxShips,
      held: { own: c.held(this.team), foe: c.held(this.enemyTeam) },
      points: c.points.map((q) => ({ id: q.id, name: q.name, side: sideOf(c.teamOfPoint(q)), hold: q.hold, contested: q.contested })),
      selected: p
        ? {
            id: p.id,
            name: p.name,
            hanja: p.hanja,
            side: sideOf(c.teamOfPoint(p)),
            holder: p.owner >= 0 ? `${c.player(p.owner)!.name} · ${FACTION_NAME[c.player(p.owner)!.faction]}` : '무주',
            value: p.value,
            home: p.home >= 0,
            contested: p.contested,
            hold: p.hold,
            mine,
            buildings: p.buildings.map((bd, slot) => (bd ? { slot, kind: bd.kind, label: BUILDINGS[bd.kind].label, hanja: BUILDINGS[bd.kind].hanja, progress: bd.progress, hp: bd.hp / BUILDINGS[bd.kind].hp } : null)),
            queue: p.queue.map((q) => ({ kind: q.kind, label: SHORT_NAME[q.kind], left: Math.ceil(q.left), total: q.total })),
            build: BUILDING_ORDER.map((kind) => ({ kind, label: BUILDINGS[kind].label, hanja: BUILDINGS[kind].hanja, cost: BUILDINGS[kind].cost, desc: BUILDINGS[kind].desc, ok: mine && c.canBuild(this.owner, p.id, kind) })),
            recruit: ROSTER[me.faction].map((kind) => ({ kind, label: SHORT_NAME[kind], cost: SHIP_SPECS[kind].cost, time: SHIP_SPECS[kind].build, ok: mine && c.canRecruit(this.battle, this.owner, p.id, kind) })),
            shipyard: c.count(p, 'shipyard') > 0,
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
    this.ready = false;
    this.releaseVisibility?.();
    this.releaseVisibility = null;
    this.input?.detach();
    this.touch?.detach();
    this.rts.detach();
    this.banners?.clear();
    this.releasePixelRatio?.();
    this.releasePixelRatio = null;
    if (!this.terrain) return;
    this.disposeBattle();
    this.clouds?.dispose();
    this.wake.dispose();
    this.views.renderer.dispose();
    this.fx.group.removeFromParent();
    disposeTree(this.fx.group);
    this.lanterns.group.removeFromParent();
    disposeTree(this.lanterns.group);
    this.pipeline.dispose();
    this.sky?.background.dispose();
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
