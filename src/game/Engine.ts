import {
  ACESFilmicToneMapping,
  DirectionalLight,
  PCFShadowMap,
  PerspectiveCamera,
  RenderPipeline,
  Scene,
  Vector2,
  Vector3,
  type DataTexture,
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
import { loadShipAssets, type ModelAsset } from '../ships/ShipRenderer';
import { ShipViews } from '../ships/ShipViews';
import { Effects } from '../fx/Effects';
import { Crew } from '../fx/Crew';
import { Lanterns } from '../fx/Lanterns';
import { Battle, SIM_DT } from '../sim/battle';
import { GUN_SPECS, STAGE_NAMES } from '../sim/catalog';
import { buildScenario, SCENARIOS, type FleetSpawn, type ScenarioId } from '../sim/scenarios';
import { applyBalance, FACTION_NAME } from '../sim/balance';
import { applyOutcome } from '../campaign/campaign';
import { GUN_SHOTS, SHIP_SPECS } from '../sim/catalog';
import { CurrentField } from '../sim/current';
import { OWNER_OF, otherTeam, teamOf, type BattleEvent, type Faction, type Ship, type ShipKind, type Team } from '../sim/types';
import { buildConquest, homeAxis, type ConquestMapId, type Seat } from '../sim/maps';
import { BUILDING_ORDER, BUILDINGS, ROSTER, SHORT_NAME, type Conquest } from '../sim/conquest';
import { applyCommand, type Command } from '../sim/commands';
import { conquestInfo, scenarioInfo, type BattleInfo } from '../sim/info';
import { ConquestView } from '../conquest/ConquestView';
import { RtsCamera, type CameraPose } from '../camera/RtsCamera';
import { Input } from './Input';
import { TouchControls } from './Touch';
import { AdaptiveQuality } from './adaptive';
import { equipment, LEVELS, levelSetting, saveLevelSetting, startLevel, type LevelSetting, type OceanQuality, type TerrainQuality } from './quality';
import { publish, pushToast, setLoading, setProgress, setReport, type GameSnapshot } from '../state/store';
import { SquadronBanners } from '../ui/SquadronBanners';
import { sound } from '../audio/Sound';
import { Terrain } from '../terrain/Terrain';
import { Vegetation } from '../terrain/Vegetation';
import { Structures } from '../terrain/Structures';

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
};

/** A conquest battle: the map, every seat, and which seat is the player's. */
export type ConquestSetup = { map: ConquestMapId; seats: Seat[]; you: number; seed: number };

/** Sends commands somewhere other than the local battle: a multiplayer server. */
export interface CommandSink {
  send(cmd: Command): void;
}

const ALL_KINDS: ShipKind[] = ['panokseon', 'geobukseon', 'hyeopseon', 'atakebune', 'sekibune', 'kobaya', 'mingship', 'mingsmall'];

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
  private interest = { ship: 0, score: 0, age: 99 };
  private shotTimer = 0;
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
    const seat = this.conquestSetup?.seats[this.conquestSetup.you];
    this.faction = options.campaign ? 'joseon' : seat?.faction ?? options.faction ?? 'joseon';
    this.battleInfo = this.conquestSetup ? conquestInfo(this.conquestSetup.map) : scenarioInfo(options.scenario);
    this.skyName = options.sky ?? this.battleInfo.sky;
    this.seaName = options.sea ?? this.battleInfo.sea;
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
    setLoading('바다와 하늘을 그리는 중', 0.03, info.mode === 'scenario' ? this.scenarioId : undefined);
    let done = 0.03;
    const track = <T,>(p: Promise<T>, weight: number) =>
      p.then((v) => {
        done += weight;
        setProgress(done);
        return v;
      });
    const [sky, terrain, assets] = await Promise.all([
      track(loadSky(SKY_PRESETS[this.skyName], this.eq.hdriDownscale), 0.2),
      track(Terrain.load(info.terrain, this.terrainQuality()), 0.22),
      loadShipAssets(ALL_KINDS, (f) => setProgress(done + f * 0.35)).then((v) => {
        done += 0.35;
        setProgress(done);
        return v;
      }),
    ]);
    this.assets = assets;
    this.terrain = terrain;
    this.scene.add(terrain.group);
    this.dressTerrain();
    this.applySky(sky);
    setLoading('함대를 배치하는 중', 0.82);
    this.placeScenario(sky);
    if ((r.backend as unknown as { isWebGPUBackend?: boolean }).isWebGPUBackend) this.fft = new FFTWaves(spectrumOf(SEA_STATES[this.seaName]), this.eq.fftN);
    this.ocean = new Ocean(waveField, sky.environment, this.wake, this.terrain, this.fft, this.current, this.oceanQuality());
    this.scene.add(this.ocean.mesh);
    if (params.get('clouds') !== '0') {
      this.clouds = new Clouds(sky.environment, LEVELS[this.level]!.cloud);
      this.clouds.coverage.value = COVERAGE[this.skyName];
      this.scene.add(this.clouds.mesh);
    }
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
    this.fx = new Effects(this.views, { lights: this.eq.lights, particles: { keep: LEVELS[this.level]!.particleKeep, sort: true, noise: this.eq.noise } });
    this.fx.wake = this.wake;
    this.fx.onShake = (k) => this.rts.shake(k);
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
    const dprParam = params.get('dpr');
    this.dprOverride = dprParam ? Number(dprParam) : null;
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
    setLoading('셰이더를 준비하는 중', 0.88);
    await r.compileAsync(this.scene, this.camera);
    this.primeOcean();
    this.adaptive = new AdaptiveQuality(this.level, levelSetting === 'auto', (l) => this.applyLevel(l));
    this.applyLevel(this.level);
    setProgress(1);
    this.ready = true;
  }

  private terrainQuality(): TerrainQuality {
    return { mesh: this.eq.terrainMesh, triplanar: this.eq.triplanar, anisotropy: this.eq.anisotropy, noise: this.eq.noise };
  }

  private oceanQuality(): OceanQuality {
    return { segments: this.eq.oceanSegments, lights: this.eq.lights };
  }

  /** The refraction variant is a second ocean material. Render both once, so neither hitches on its first use. */
  private primeOcean() {
    this.ocean.setRefraction(true);
    this.pipeline.render();
    this.ocean.setRefraction(false);
    this.pipeline.render();
  }

  private dressTerrain() {
    this.terrain.season.value = this.battleInfo.foliage;
    this.vegetation = new Vegetation(this.terrain, { grids: this.eq.vegetationGrids, shadows: true });
    this.terrain.group.add(this.vegetation.group);
    this.structures = new Structures(this.terrain);
    this.terrain.group.add(this.structures.group);
    void this.structures.load();
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
      this.phi = this.sink ? 0 : sunAz - Math.PI / 2 - homeAxis(setup.map);
      this.terrain.setRotation(this.phi);
      const built = buildConquest(setup.map, setup.seats, (x, z) => this.terrain.heightAt(x, z), setup.seed, {}, this.phi);
      this.battle = built.battle;
      this.conquest = built.conquest;
      this.owner = setup.you;
      if (this.sink) this.battle.humans = new Set();
      this.conquestView = new ConquestView(built.conquest, (x, z) => this.terrain.heightAt(x, z), document.querySelector('.app') ?? document.body);
      this.conquestView.onSelect = (id) => this.selectPoint(id);
      this.scene.add(this.conquestView.group);
      void this.conquestView.load();
    } else {
      this.phi = sunAz - preset.axisOffset - info.view.dir;
      this.terrain.setRotation(this.phi);
      this.battle = buildScenario(this.scenarioId, this.phi, 1592 + Math.floor(Math.random() * 1000), (x, z) => this.terrain.heightAtScenario(x, z), this.campaign);
      applyBalance(this.battle, this.scenarioId, this.faction);
      this.owner = OWNER_OF[this.faction];
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

  /** Ships drawn in cutaway: the selection, once close enough to see inside. */
  cutawayIds() {
    const out = new Set<number>();
    if (!this.cutaway) return out;
    const cam = this.camera.position;
    for (const id of this.views.selected) {
      const s = this.battle.get(id);
      if (s && s.alive && Math.hypot(s.x - cam.x, s.z - cam.z, cam.y) < 650) out.add(id);
    }
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
      // Behind the player's fleet, looking past it toward the middle of the map.
      const own = this.centroid((s) => s.owner === this.owner);
      const back = Math.atan2(own.z, own.x);
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
    }
    if (this.fogEnv) this.fogEnv.value = sky.environment;
    if (old) {
      old.background.dispose();
      old.environment.dispose();
    }
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
    const sky = await loadSky(SKY_PRESETS[name], this.eq.hdriDownscale);
    this.applySky(sky);
    this.publish(true);
  }

  setSea(name: SeaStateName) {
    this.seaName = name;
    waveField.setState(SEA_STATES[name]);
    this.fft?.setSpectrum(spectrumOf(SEA_STATES[name]));
    this.publish(true);
  }

  async setScenario(id: ScenarioId, faction?: Faction) {
    this.conquestSetup = null;
    this.scenarioId = id;
    this.faction = this.campaign ? 'joseon' : faction ?? this.faction;
    await this.stage(scenarioInfo(id));
  }

  /** Starts a conquest battle on the running engine. */
  async setConquest(setup: ConquestSetup) {
    this.conquestSetup = setup;
    this.faction = setup.seats[setup.you]!.faction;
    await this.stage(conquestInfo(setup.map));
  }

  private async stage(info: BattleInfo) {
    this.ready = false;
    this.battleInfo = info;
    setLoading(`${info.title} 준비 중`, 0.04, info.mode === 'scenario' ? (info.id as ScenarioId) : undefined);
    this.skyName = info.sky;
    this.seaName = info.sea;
    waveField.setState(SEA_STATES[this.seaName]);
    let done = 0.04;
    const track = <T,>(p: Promise<T>, weight: number) =>
      p.then((v) => {
        done += weight;
        setProgress(done);
        return v;
      });
    const [sky, terrain] = await Promise.all([track(loadSky(SKY_PRESETS[this.skyName], this.eq.hdriDownscale), 0.38), track(Terrain.load(info.terrain, this.terrainQuality()), 0.4)]);
    setLoading('함대를 배치하는 중', 0.84);
    this.scene.remove(this.terrain.group);
    this.terrain = terrain;
    this.scene.add(terrain.group);
    this.dressTerrain();
    this.applySky(sky);
    this.placeScenario(sky);
    this.scene.remove(this.ocean.mesh);
    this.fft?.setSpectrum(spectrumOf(SEA_STATES[this.seaName]));
    this.ocean = new Ocean(waveField, sky.environment, this.wake, this.terrain, this.fft, this.current, this.oceanQuality());
    this.scene.add(this.ocean.mesh);
    this.views.reset(this.assets, this.battle, this.capacityHint());
    this.views.team = this.team;
    this.scene.remove(this.crew.group);
    this.crew = new Crew(this.views);
    this.scene.add(this.crew.group);
    this.banners?.clear();
    this.rts.setPose(this.defaultPose());
    this.paused = false;
    setLoading('셰이더를 준비하는 중', 0.9);
    await this.renderer.compileAsync(this.scene, this.camera);
    this.primeOcean();
    // The rebuilt terrain, vegetation and ocean start from the plain state. Re-apply the current level to them.
    this.applyLevel(this.level);
    this.ready = true;
    setLoading(null);
    this.publish(true);
  }

  /** Ships can be launched in a conquest battle, so its renderer reserves room for each kind the seats can build. */
  capacityHint() {
    const hint = new Map<ShipKind, number>();
    const setup = this.conquestSetup;
    if (!setup || !this.conquest) return hint;
    const c = this.conquest;
    for (const seat of setup.seats) for (const kind of ROSTER[seat.faction]) hint.set(kind, (hint.get(kind) ?? 0) + Math.min(c.options.maxShips, Math.ceil(c.options.cap / SHIP_SPECS[kind].cost) + 4));
    return hint;
  }

  restart() {
    if (this.conquestSetup) void this.setConquest({ ...this.conquestSetup, seed: this.conquestSetup.seed + 1 });
    else void this.setScenario(this.scenarioId);
  }

  private stepSim(dt: number) {
    this.battle.step(dt);
    waveField.time += dt;
  }

  update(frameDt: number) {
    if (!this.ready) return;
    this.fpsFrames += 1;
    this.fpsTime += frameDt;
    if (this.fpsTime >= 1) {
      this.fps = Math.round(this.fpsFrames / this.fpsTime);
      this.fpsFrames = 0;
      this.fpsTime = 0;
    }
    this.adaptive?.update(frameDt, this.gpuMs);
    const dt = Math.min(frameDt, 0.1);
    const scaled = this.paused ? 0 : dt * this.speed;
    this.lastScaled = scaled;
    this.accumulator += scaled;
    let steps = 0;
    while (this.accumulator >= SIM_DT && steps < 8) {
      this.stepSim(SIM_DT);
      this.accumulator -= SIM_DT;
      steps += 1;
    }
    if (steps >= 8) this.accumulator = 0;
    const events = this.battle.events;
    this.views.cutaway.clear();
    for (const id of this.cutawayIds()) this.views.cutaway.set(id, this.cutaway);
    this.views.sync(this.battle, scaled, this.camera, this.assets);
    this.stampWakes(events, scaled);
    if (events.length) {
      this.sound.update(events, this.battle, this.camera, scaled);
      this.noteInterest(events);
      this.fx.handle(events, this.battle);
      this.crew.handle(events, this.battle);
      this.input.onEvents(events);
      for (const e of events) if (e.type === 'battery') this.fx.gun(e.x, e.y, e.z, e.dx, e.dy, e.dz, true);
      this.battle.events = [];
    }
    if (this.battle.winner && !this.reported) this.finishCampaignBattle();
    if (this.rts.cinematic) this.direct(dt);
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
    if (!this.campaign) return;
    const b = this.battle;
    const ships = b.ships
      .filter((s) => s.campaignId)
      .map((s) => {
        let ammo = 0;
        let max = 0;
        for (const g of s.guns) {
          ammo += g.ammo;
          max += GUN_SHOTS[s.spec.batteries[g.battery]!.gun];
        }
        return {
          campaignId: s.campaignId,
          alive: s.alive && s.sinking === 0 && !s.struck,
          hull: Math.max(0, s.hull / s.spec.hull),
          crew: Math.max(0, s.crew / s.spec.crew),
          supply: max ? Math.min(s.supply, ammo / max) : s.supply,
          kills: s.kills,
        };
      });
    const enemy = this.enemyTeam;
    const enemySunk = b.initial[enemy] - b.teamCount(enemy) - b.escaped[enemy];
    setReport(applyOutcome({ id: this.scenarioId, win: b.winner === this.team, enemySunk, enemyEscaped: b.escaped[enemy], ships }));
  }

  /** Withdrawal. The battle counts as lost. */
  endBattle() {
    if (this.battle.winner) return;
    this.battle.winner = this.enemyTeam;
  }

  private noteInterest(events: BattleEvent[]) {
    for (const e of events) {
      let score = 0;
      let ship = 0;
      if (e.type === 'explode' || e.type === 'sinking' || e.type === 'struck') [score, ship] = [6, e.ship];
      else if (e.type === 'ram') [score, ship] = [4, e.a];
      else if (e.type === 'board') [score, ship] = [3, e.b];
      else if (e.type === 'hit') [score, ship] = [1.5, e.ship];
      else if (e.type === 'gun') [score, ship] = [0.6, e.ship];
      const current = this.interest.score * Math.exp(-this.interest.age * 0.3);
      if (score > current) this.interest = { ship, score, age: 0 };
    }
  }

  private direct(dt: number) {
    this.interest.age += dt;
    this.shotTimer -= dt;
    if (this.shotTimer > 0) return;
    const b = this.battle;
    let subject = b.get(this.interest.ship);
    if (!subject || !subject.alive || this.interest.age > 12) {
      const active = b.ships.filter((s) => b.isActive(s));
      subject = active.sort((p, q) => q.lastHit - p.lastHit)[0];
    }
    if (!subject) return;
    let other = b.get(subject.targetId);
    if (!other || !other.alive) {
      let best = Infinity;
      for (const s of b.ships) {
        if (!s.alive || s.team === subject.team) continue;
        const d = Math.hypot(s.x - subject.x, s.z - subject.z);
        if (d < best) {
          best = d;
          other = s;
        }
      }
    }
    const g = this.rts.goal;
    const sun = atmosphere.sunDir.value as Vector3;
    if (other) {
      const dx = other.x - subject.x;
      const dz = other.z - subject.z;
      const d = Math.hypot(dx, dz);
      const line = Math.atan2(dz, dx);
      const k = Math.min(0.32, 60 / Math.max(1, d));
      g.tx = subject.x + dx * k;
      g.tz = subject.z + dz * k;
      g.distance = Math.min(260, Math.max(90, d * 0.45));
      const y1 = line + Math.PI / 2 + (Math.random() - 0.5) * 0.7;
      const y2 = line - Math.PI / 2 + (Math.random() - 0.5) * 0.7;
      const s1 = Math.cos(y1) * sun.x + Math.sin(y1) * sun.z;
      const s2 = Math.cos(y2) * sun.x + Math.sin(y2) * sun.z;
      g.yaw = (s1 > s2) === Math.random() < 0.8 ? y1 : y2;
    } else {
      g.tx = subject.x;
      g.tz = subject.z;
      g.distance = 160;
    }
    g.yaw = this.rts.yaw + Math.atan2(Math.sin(g.yaw - this.rts.yaw), Math.cos(g.yaw - this.rts.yaw));
    g.pitch = 0.05 + Math.random() * 0.09;
    this.shotTimer = 8 + Math.random() * 6;
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
    if (!this.ready) return;
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
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.dprOverride ?? L.dprCap));
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

  dispose() {
    this.input?.detach();
    this.touch?.detach();
    this.rts.detach();
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
