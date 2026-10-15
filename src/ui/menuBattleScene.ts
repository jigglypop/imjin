import {
  ACESFilmicToneMapping, DataTexture, DirectionalLight, FogExp2,
  HemisphereLight, PerspectiveCamera, RedFormat, FloatType, Scene, Vector2, Vector3,
  WebGPURenderer,
} from 'three/webgpu';
import { uniform } from 'three/tsl';
import { Battle } from '../sim/battle';
import { ShipViews } from '../ships/ShipViews';
import { Lanterns } from '../fx/Lanterns';
import { loadSceneShipAssets, disposeSceneShipAssets, type ModelAsset } from '../ships/ShipRenderer';
import { Effects } from '../fx/Effects';
import { Ocean } from '../ocean/Ocean';
import { WakeMap } from '../ocean/WakeMap';
import { WaveField, waveField, SEA_STATES } from '../ocean/waves';
import { atmosphere } from '../render/atmosphere';
import { loadSky, SKY_PRESETS, type LoadedSky } from '../render/sky';
import { disposeTree } from '../render/dispose';
import { equipment, forceWebGL } from '../game/quality';
import type { Terrain } from '../terrain/Terrain';
import { RenderLease } from './renderLease';

const CYCLE = 40;
const clamp = (x: number) => Math.max(0, Math.min(1, x));
const ease = (x: number) => { const t=clamp(x); return t*t*(3-2*t); };

export class MenuBattleScene {
  private renderer?: WebGPURenderer;
  private scene = new Scene();
  private camera = new PerspectiveCamera(42, 1, .5, 7000);
  private sun = new DirectionalLight(0xffc89a, 2.7);
  private lease = new RenderLease();
  private sky?: LoadedSky;
  private wake?: WakeMap;
  private ocean?: Ocean;
  private oceanWaves = new WaveField(1597);
  private lightingScale = .1;
  private height?: DataTexture;
  private views?: ShipViews;
  private fx?: Effects;
  private lanterns?: Lanterns;
  private assets?: Record<string, ModelAsset>;
  private battle = this.makeBattle(1597);
  private hero = this.battle.ships[0]!;
  private controller = new AbortController();
  private observer?: ResizeObserver;
  private raf = 0;
  private last = 0;
  private elapsed = 0;
  private cycle = 0;
  private frames = 0;
  private shots = 0;
  private loading = true;
  private disposed = false;
  private cleaned = false;
  private paused = false;
  private mobile = equipment.tier === 'low';
  private target = new Vector3();

  constructor(private canvas: HTMLCanvasElement, private onReady: () => void) {}

  private makeBattle(seed: number) {
    const b = new Battle(seed, 'historical');
    b.humans.clear();
    b.setSea(SEA_STATES.moderate);
    const own = b.addSquadron('joseon', 'Menu fleet', '', '', '', 0);
    const foe = b.addSquadron('japan', 'Menu fleet', '', '', '', 1);
    const hero = b.addShip('geobukseon', 0, 0, .14, '', own, true);
    hero.owner = 99;
    b.humans.add(99);
    hero.order = { type: 'hold' };
    for (let i=0;i<11;i++) {
      const row=Math.floor(i/4), col=i%4;
      const ship=b.addShip(i===5?'geobukseon':'panokseon', -65-row*65+col*8, -60-col*46-row*12, -.55, '', own, false, i%3);
      ship.order={type:'auto'};
    }
    for (let i=0;i<14;i++) {
      const row=Math.floor(i/5), col=i%5;
      const ship=b.addShip('atakebune', -180-row*62+col*12, -160-col*38+row*15, .75, '', foe, false, i%2);
      ship.order={type:'auto'};
      if(i===6 || i===12) { ship.fire=.26; ship.hull*=.84; }
    }
    b.initial.joseon=12; b.initial.japan=14;
    for (const ship of b.ships) for (const gun of ship.guns) { gun.stage=4; gun.t=0; gun.fireDelay=(ship.id%5)*.17; }
    // The scene is an actual simulated encounter, separate from selectable historical scenarios.
    for (let i=0;i<20;i++) b.step(.1);
    return b;
  }

  async init() {
    try {
      this.renderer = new WebGPURenderer({canvas:this.canvas, antialias:!this.mobile, forceWebGL});
      await this.renderer.init();
      this.check();
      this.renderer.toneMapping=ACESFilmicToneMapping;
      this.renderer.toneMappingExposure=.94;
      this.resize();
      const results = await Promise.allSettled([
        loadSky(SKY_PRESETS.night, '2k', undefined, this.controller.signal),
        loadSceneShipAssets(['geobukseon','panokseon','atakebune'], {...equipment.ships, anisotropy:equipment.anisotropy}),
      ]);
      // Both sky and model geometry belong to this renderer; faction atlas textures stay shared.
      if (results[0].status==='fulfilled') this.sky=results[0].value;
      if (results[1].status==='fulfilled') this.assets=results[1].value;
      for (const result of results) if (result.status==='rejected') throw result.reason;
      this.check();
      const sky=this.sky!;
      this.lightingScale=.16/Math.max(.0001,sky.info.ambientLum)*.2;
      this.scene.background=sky.background;
      this.scene.backgroundIntensity=this.lightingScale;
      this.scene.backgroundRotation.y=.7;
      this.scene.environment=sky.environment;
      this.scene.environmentIntensity=this.lightingScale*1.45;
      this.scene.fog=new FogExp2('#091828', .0018);
      this.sun.color.set('#b8d1ef');
      this.sun.intensity=2.6;
      this.sun.position.set(40,160,30);
      this.sun.target.position.set(-30,0,-60);
      const rim=new DirectionalLight(0xe6a66e,1.4);
      rim.position.set(-100,40,70);
      this.scene.add(this.sun,this.sun.target,rim,new HemisphereLight(0x7aa1c7,0x10151d,.75));
      this.views=new ShipViews(this.assets!,this.battle,{...equipment.ships,maxLod0:this.mobile?4:16,near:250,mid:850});
      this.scene.add(this.views.group);
      this.fx=this.lease.run(()=>{},()=>new Effects(this.views!,{lights:this.mobile?4:6,particles:{keep:this.mobile?.4:.8,sort:true}}));
      this.fx.night=1;
      this.scene.add(this.fx.group);
      this.lanterns=new Lanterns(this.views);
      this.lanterns.onLight=(x,y,z,i)=>this.fx!.lantern(x,y,z,i);
      this.scene.add(this.lanterns.group);
      this.wake=new WakeMap(this.mobile?256:512);
      this.wake.setExtent(1200);
      this.fx.wake=this.wake;
      this.height=new DataTexture(new Float32Array([-70,-70,-70,-70]),2,2,RedFormat,FloatType);
      this.height.needsUpdate=true;
      // Ocean only needs the sea-floor sampler; no invisible terrain meshes or workers are loaded.
      const seaFloor={rotation:uniform(new Vector2(1,0)),sizeU:uniform(6000),heightTexture:this.height} as unknown as Terrain;
      this.oceanWaves.copyFrom(this.battle.waves);
      this.ocean=new Ocean(this.oceanWaves,sky.environment,this.wake,seaFloor,null,null,{segments:this.mobile?72:144,lights:this.mobile?4:6});
      this.scene.add(this.ocean.mesh);
      this.cameraPose();
      this.lease.run(()=>this.applyLight(),()=>this.views!.sync(this.battle,1,this.camera,this.assets!));
      // Compilation never leases global state across an async boundary.
      await this.renderer.compileAsync(this.scene,this.camera);
      this.check();
      this.observer=new ResizeObserver(()=>this.resize());
      this.observer.observe(this.canvas.parentElement!);
      document.addEventListener('visibilitychange',this.visibility);
      this.canvas.addEventListener('webglcontextlost',this.contextLost);
      const device=(this.renderer.backend as unknown as {device?:{lost:Promise<unknown>}}).device;
      void device?.lost.then(()=>{ if(!this.disposed) this.contextLost(); });
      this.loading=false;
      this.draw(0);
      this.onReady();
      this.canvas.dataset.backend=this.renderer.backend.constructor.name;
      this.canvas.dataset.ships=String(this.battle.ships.length);
      if(new URLSearchParams(location.search).get('menuqa')==='1') window.__menuScene=this;
      this.visibility();
    } finally {
      this.loading=false;
      if(this.disposed) this.cleanup();
    }
  }

  private check() { this.controller.signal.throwIfAborted(); }

  private applyLight() {
    waveField.copyFrom(this.battle.waves);
    atmosphere.sunDir.value.copy(this.sun.position).normalize();
    atmosphere.sunIrradiance.value.set(.8,1.05,1.4);
    atmosphere.skyAmbient.value.set(.035,.06,.095);
    atmosphere.horizon.value.set(.016,.032,.055);
    atmosphere.envIntensity.value=this.lightingScale;
    atmosphere.fogDensity.value=.0018;
    atmosphere.night.value=1;
    atmosphere.waterDeep.value.set(.003,.013,.025);
    atmosphere.waterScatter.value.set(.018,.055,.065);
  }

  private resize() {
    if(this.disposed || !this.renderer) return;
    const r=this.canvas.parentElement!.getBoundingClientRect();
    this.camera.aspect=Math.max(1,r.width)/Math.max(1,r.height);
    this.camera.updateProjectionMatrix();
    // Portrait keeps detail in the hero and caps fill-rate independently of game quality.
    const cap=this.mobile?1.15:1.5;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio,cap,1600/Math.max(1,r.width)));
    this.renderer.setSize(Math.max(1,r.width),Math.max(1,r.height),false);
  }

  private cameraPose() {
    const p=this.elapsed/CYCLE, drift=Math.sin(p*Math.PI*2)*3;
    const portrait=this.camera.aspect<.85;
    this.camera.position.set(this.hero.x+(portrait?60:37)+drift, portrait?17:8, this.hero.z+(portrait?48:24));
    this.target.set(this.hero.x+(portrait?3:-28),portrait?8:7,this.hero.z-(portrait?12:40));
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld();
  }

  private draw(dt: number) {
    if(this.disposed || !this.renderer || !this.views || !this.fx || !this.assets) return;
    this.cameraPose();
    this.oceanWaves.copyFrom(this.battle.waves);
    this.lease.run(()=>this.applyLight(),()=>{
      this.views!.sync(this.battle,dt,this.camera,this.assets!);
      const events=this.battle.events.splice(0);
      this.shots+=events.filter(e=>e.type==='gun').length;
      this.fx!.handle(events,this.battle);
      this.lanterns!.update(this.battle,this.camera,true);
      this.fx!.update(this.battle,dt,this.camera);
      for(const ship of this.battle.ships) if(ship.alive) this.wake!.shipWake(ship,dt);
      this.wake!.update(this.renderer!,dt);
      this.ocean!.update(this.camera.position.x,this.camera.position.z);
      this.renderer!.render(this.scene,this.camera);
    });
    const opacity=ease(this.elapsed/.9)*(1-ease((this.elapsed-(CYCLE-1.2))/1.2));
    this.canvas.style.opacity=String(opacity);
    this.frames++;
    this.canvas.dataset.cycle=String(this.cycle);
  }

  private tick = (now: number) => {
    this.raf=0;
    if(this.disposed || document.hidden) { this.last=0; return; }
    // 30 draws/second leaves headroom for the navigation UI and the actual game after departure.
    if(this.last && now-this.last<1000/30-1) { this.raf=requestAnimationFrame(this.tick); return; }
    const dt=this.last?Math.min(.08,(now-this.last)/1000):1/30;
    this.last=now;
    if(!this.paused) {
      this.elapsed+=dt;
      if(this.elapsed>=CYCLE) {
        this.cycle++;
        this.elapsed=0;
        this.battle=this.makeBattle(1597+this.cycle*17);
        this.hero=this.battle.ships[0]!;
        this.views!.states.clear();
        this.fx!.newBattle();
        this.wake!.setCenter(0,0);
      }
      this.battle.step(dt);
    }
    try { this.draw(this.paused?0:dt); }
    catch { this.contextLost(); return; }
    this.raf=requestAnimationFrame(this.tick);
  };

  private visibility = () => {
    cancelAnimationFrame(this.raf); this.raf=0; this.last=0;
    if(!this.disposed && !document.hidden) this.raf=requestAnimationFrame(this.tick);
  };

  private contextLost = () => {
    this.canvas.style.opacity='0';
    this.canvas.parentElement?.setAttribute('data-state','poster');
    this.dispose();
  };

  /** Local review hook. It freezes this decorative scene, never the actual game. */
  pause(on=true) { this.paused=on; }
  info() { return {ready:!this.loading&&!this.disposed,disposed:this.disposed,frames:this.frames,elapsed:this.elapsed,cycle:this.cycle,ships:this.battle.ships.length,shots:this.shots,backend:this.renderer?.backend.constructor.name}; }

  dispose() {
    if(this.disposed) return;
    this.disposed=true;
    this.controller.abort();
    cancelAnimationFrame(this.raf); this.raf=0;
    this.observer?.disconnect();
    document.removeEventListener('visibilitychange',this.visibility);
    this.canvas.removeEventListener('webglcontextlost',this.contextLost);
    if(window.__menuScene===this) delete window.__menuScene;
    if(!this.loading) this.cleanup();
  }

  private cleanup() {
    if(this.cleaned) return;
    this.cleaned=true;
    this.ocean?.dispose();
    this.wake?.dispose();
    this.height?.dispose();
    this.views?.renderer.dispose();
    if(this.views) disposeTree(this.views.group);
    if(this.fx) disposeTree(this.fx.group);
    if(this.lanterns) disposeTree(this.lanterns.group);
    if(this.assets) disposeSceneShipAssets(this.assets);
    this.sky?.background.dispose();
    this.sky?.environment.dispose();
    this.scene.clear();
    void this.renderer?.dispose().catch(()=>undefined);
  }
}

declare global { interface Window { __menuScene?: MenuBattleScene; } }
