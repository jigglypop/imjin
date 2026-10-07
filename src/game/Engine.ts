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
import { applyOutcome } from '../campaign/campaign';
import { GUN_SHOTS } from '../sim/catalog';
import { CurrentField } from '../sim/current';
import type { BattleEvent, ShipKind } from '../sim/types';
import { RtsCamera, type CameraPose } from '../camera/RtsCamera';
import { Input } from './Input';
import { publish, pushToast, setLoading, setProgress, setReport, type GameSnapshot } from '../state/store';
import { SquadronBanners } from '../ui/SquadronBanners';
import { sound } from '../audio/Sound';
import { Terrain } from '../terrain/Terrain';
import { Vegetation } from '../terrain/Vegetation';
import { Structures } from '../terrain/Structures';

const SEASON: Record<ScenarioId, number> = { okpo: 0.1, sacheon: 0.05, dangpo: 0, hansan: 0, angolpo: 0, busan: 0.6, chilcheon: 0, myeongnyang: 0.72, noryang: 1 };
import { Minimap } from '../ui/Minimap';

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
};

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
  fft: FFTWaves | null = null;
  current: CurrentField | null = null;
  readonly wake = new WakeMap();
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

  constructor(readonly renderer: WebGPURenderer, readonly camera: PerspectiveCamera, private readonly options: EngineOptions) {
    this.rts = new RtsCamera(camera);
    this.scenarioId = options.scenario;
    const info = SCENARIOS[options.scenario];
    this.campaign = options.campaign;
    this.skyName = options.sky ?? info.sky;
    this.seaName = options.sea ?? info.sea;
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
    const info = SCENARIOS[this.scenarioId];
    setLoading('바다와 하늘을 그리는 중', 0.03, this.scenarioId);
    let done = 0.03;
    const track = <T,>(p: Promise<T>, weight: number) =>
      p.then((v) => {
        done += weight;
        setProgress(done);
        return v;
      });
    const [sky, terrain, assets] = await Promise.all([
      track(loadSky(SKY_PRESETS[this.skyName]), 0.2),
      track(Terrain.load(info.terrain), 0.22),
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
    if ((r.backend as unknown as { isWebGPUBackend?: boolean }).isWebGPUBackend) this.fft = new FFTWaves(spectrumOf(SEA_STATES[this.seaName]));
    this.ocean = new Ocean(waveField, sky.environment, this.wake, this.terrain, this.fft, this.current);
    this.scene.add(this.ocean.mesh);
    const sun = this.sun;
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.04;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 3200;
    this.scene.add(sun, sun.target);
    this.views = new ShipViews(this.assets, this.battle);
    this.scene.add(this.views.group);
    this.fx = new Effects(this.views);
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
    setLoading('셰이더를 준비하는 중', 0.88);
    await r.compileAsync(this.scene, this.camera);
    setProgress(1);
    this.ready = true;
  }

  private dressTerrain() {
    this.terrain.season.value = SEASON[this.scenarioId] ?? 0;
    this.vegetation = new Vegetation(this.terrain);
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
    const info = SCENARIOS[this.scenarioId];
    const preset = SKY_PRESETS[this.skyName];
    const sunAz = Math.atan2(sky.info.sunDir.z, sky.info.sunDir.x);
    this.phi = sunAz - preset.axisOffset - info.view.dir;
    this.terrain.setRotation(this.phi);
    this.battle = buildScenario(this.scenarioId, this.phi, 1592 + Math.floor(Math.random() * 1000), (x, z) => this.terrain.heightAtScenario(x, z), this.campaign);
    this.reported = false;
    setReport(null);
    this.battle.land = (x, z) => this.terrain.heightAt(x, z);
    this.current = info.current ? new CurrentField(info.current, (x, z) => this.terrain.heightAtScenario(x, z), this.phi) : null;
    this.battle.flow = this.current;
    const c = this.terrain.toWorld(info.view.tx, info.view.tz);
    this.battle.center = { x: c.x, z: c.z };
    this.battle.arenaRadius = 5200;
    this.initialSquads.clear();
    for (const sq of this.battle.squadrons) this.initialSquads.set(sq.id, sq.shipIds.length);
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const s of this.battle.ships) {
      minX = Math.min(minX, s.x);
      maxX = Math.max(maxX, s.x);
      minZ = Math.min(minZ, s.z);
      maxZ = Math.max(maxZ, s.z);
    }
    this.wake.setCenter((minX + maxX) / 2, (minZ + maxZ) / 2);
    const extent = Math.min(8000, Math.max(3000, Math.max(maxX - minX, maxZ - minZ) + 2400));
    this.wake.setExtent(extent);
    this.minimap.setTerrain(this.terrain, (minX + maxX) / 2, (minZ + maxZ) / 2, extent * 1.35);
  }

  private defaultPose(): CameraPose {
    const info = SCENARIOS[this.scenarioId];
    const c = this.terrain.toWorld(info.view.tx, info.view.tz);
    const dir = info.view.dir + this.phi;
    return { tx: c.x, tz: c.z, yaw: dir + Math.PI + 0.22, pitch: info.view.pitch, distance: info.view.dist };
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
    const scenePass = pass(this.scene, this.camera, { samples: 4 });
    const color = scenePass.getTextureNode('output');
    const glow = bloom(color, 0.22, 0.5, 2.2);
    const hdr = color.add(glow);
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
    const sky = await loadSky(SKY_PRESETS[name]);
    this.applySky(sky);
    this.publish(true);
  }

  setSea(name: SeaStateName) {
    this.seaName = name;
    waveField.setState(SEA_STATES[name]);
    this.fft?.setSpectrum(spectrumOf(SEA_STATES[name]));
    this.publish(true);
  }

  async setScenario(id: ScenarioId) {
    this.ready = false;
    this.scenarioId = id;
    const info = SCENARIOS[id];
    setLoading(`${info.title} 준비 중`, 0.04, id);
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
    const [sky, terrain] = await Promise.all([track(loadSky(SKY_PRESETS[this.skyName]), 0.38), track(Terrain.load(info.terrain), 0.4)]);
    setLoading('함대를 배치하는 중', 0.84);
    this.scene.remove(this.terrain.group);
    this.terrain = terrain;
    this.scene.add(terrain.group);
    this.dressTerrain();
    this.applySky(sky);
    this.placeScenario(sky);
    this.scene.remove(this.ocean.mesh);
    this.fft?.setSpectrum(spectrumOf(SEA_STATES[this.seaName]));
    this.ocean = new Ocean(waveField, sky.environment, this.wake, this.terrain, this.fft, this.current);
    this.scene.add(this.ocean.mesh);
    this.views.reset(this.assets, this.battle);
    this.scene.remove(this.crew.group);
    this.crew = new Crew(this.views);
    this.scene.add(this.crew.group);
    this.banners?.clear();
    this.rts.setPose(this.defaultPose());
    this.paused = false;
    setLoading('셰이더를 준비하는 중', 0.9);
    await this.renderer.compileAsync(this.scene, this.camera);
    this.ready = true;
    setLoading(null);
    this.publish(true);
  }

  restart() {
    void this.setScenario(this.scenarioId);
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
    this.views.sync(this.battle, scaled, this.camera, this.assets);
    this.stampWakes(events, scaled);
    if (events.length) {
      this.sound.update(events, this.battle, this.camera, scaled);
      this.noteInterest(events);
      this.fx.handle(events, this.battle);
      this.crew.handle(events, this.battle);
      this.input.onEvents(events);
      this.battle.events = [];
    }
    if (this.battle.winner && !this.reported) this.finishCampaignBattle();
    if (this.rts.cinematic) this.direct(dt);
    const follow = this.rts.followId ? this.views.worldOf(this.rts.followId) : null;
    if (this.rts.followId && !follow) this.rts.followId = 0;
    this.rts.update(dt, follow);
    this.ocean.setTide(this.battle.tide);
    this.vegetation?.update(this.camera);
    this.structures?.update(this.camera);
    const tideSign = Math.abs(this.battle.tide) < 0.15 ? 0 : Math.sign(this.battle.tide);
    if (this.current && tideSign !== this.lastTide) {
      if (tideSign === 0) pushToast('물살이 잦아든다 — 곧 물길이 바뀐다');
      else if (this.lastTide === 0) pushToast(tideSign > 0 ? '울돌목의 물길이 뒤집혔다! 왜선이 밀려난다' : '거센 물살이 왜선을 실어 온다', tideSign > 0 ? 'good' : 'bad');
      this.lastTide = tideSign;
    }
    this.ocean.update(this.camera.position.x, this.camera.position.z);
    if (this.current) {
      const t = this.rts.target;
      const v = this.current.velocity(t.x, t.z, this.battle.tide);
      this.sound.setRoar(Math.min(1, Math.hypot(v.x, v.z) / 4) * Math.max(0.2, 1 - this.rts.distance / 3000));
    } else this.sound.setRoar(0);
    this.fx.update(this.battle, scaled, this.camera);
    this.crew.update(this.battle, scaled, this.camera);
    this.lanterns.update(this.battle, this.camera);
    this.updateSun();
    const el = this.renderer.domElement;
    this.banners?.update(this.battle, this.views, this.camera, el.clientWidth, el.clientHeight, this.showLabels && !this.rts.cinematic);
    this.publishTimer -= dt;
    if (this.publishTimer <= 0) {
      this.publish();
      this.publishTimer = 0.15;
    }
    this.minimapTimer -= dt;
    if (this.minimapTimer <= 0) {
      this.minimap.draw(this.battle, this.views.selected, this.rts.target.x, this.rts.target.z, this.rts.yaw);
      this.minimapTimer = 0.1;
    }
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
    const enemySunk = b.initial.japan - b.teamCount('japan') - b.escaped.japan;
    setReport(applyOutcome({ id: this.scenarioId, win: b.winner === 'joseon', enemySunk, enemyEscaped: b.escaped.japan, ships }));
  }

  endBattle() {
    if (this.battle.winner) return;
    this.battle.winner = 'japan';
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
    this.pipeline.render();
  }

  publish(force = false) {
    const b = this.battle;
    const info = SCENARIOS[this.scenarioId];
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
    const strengthJ = b.strength('joseon');
    const strengthW = b.strength('japan');
    const snapshot: GameSnapshot = {
      scenario: { id: info.id, title: info.title, hanja: info.hanja, date: info.date, place: info.place, season: info.season },
      time: b.time,
      joseon: b.teamCount('joseon'),
      japan: b.teamCount('japan'),
      joseonTotal: b.initial.joseon,
      japanTotal: b.initial.japan,
      escaped: b.escaped.japan,
      balance: strengthJ / Math.max(1, strengthJ + strengthW),
      winner: b.winner,
      paused: this.paused,
      speed: this.speed,
      sky: this.skyName,
      sea: this.seaName,
      following: this.rts.followId,
      cinematic: this.rts.cinematic,
      fps: this.fps,
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
    };
    publish(snapshot, force);
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
