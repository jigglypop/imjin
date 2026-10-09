import { Vector3, type PerspectiveCamera } from 'three/webgpu';
import type { BattleEvent } from '../sim/types';
import type { Battle } from '../sim/battle';
import { GUN_CLASS, gunClass, type GunClass } from '../fx/gunClass';
import type { CueKind } from '../fx/sinkPlan';
import { isPhone, isTouchDevice } from '../game/device';
import { buildBus, COST, ranged, Voices, type Tier } from './voices';

const SCALE = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22];
const ROOT_HZ = 146.83;

type Mode = 'select' | 'battle';
type Gunfire = { s: ReturnType<typeof ranged>; gun: GunClass; key: number; score: number };

export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfx: GainNode | null = null;
  private ambience: GainNode | null = null;
  private music: GainNode | null = null;
  private reverb: ConvolverNode | null = null;
  private noise: AudioBuffer | null = null;
  private voices: Voices | null = null;
  /** Voice allowance, refilled in real time so a fast-forwarded battle cannot spend a minute of voices in one frame. */
  private budget = 24;
  private lastCtxTime = 0;
  private lastWall = 0;
  /** How many times faster than real time the battle runs (smoothed). */
  private timeScale = 1;
  /** Voices still sounding, so the WebAudio graph stays under a node cap (lower on phones). */
  private readonly live: { end: number; nodes: number }[] = [];
  private readonly nodeCap = isPhone ? 260 : isTouchDevice ? 420 : 900;
  private camera: PerspectiveCamera | null = null;
  private readonly whizzed = new Map<number, number>();
  private frame = 0;
  private readonly volleys = new Map<number, { best: Gunfire; count: number; rest: Gunfire[] }>();
  private mode: Mode = 'select';
  private nextNote = 0;
  private phrase = 0;
  private lastDegree = 4;
  private intensity = 0;
  private rumble: GainNode | null = null;
  private roar: GainNode | null = null;
  muted = false;
  private readonly tmp = new Vector3();
  private readonly right = new Vector3();

  constructor() {
    const start = () => {
      this.init();
      void this.ctx?.resume();
    };
    window.addEventListener('pointerdown', start, { passive: true });
    window.addEventListener('keydown', start);
    window.addEventListener('touchstart', start, { passive: true });
  }

  get ready() {
    return !!this.ctx && this.ctx.state === 'running';
  }

  private init() {
    if (this.ctx) return;
    const ctx = new AudioContext();
    this.ctx = ctx;
    const bus = buildBus(ctx, this.muted ? 0 : 0.9);
    const master = bus.master;
    this.master = master;
    this.reverb = bus.reverb;
    this.sfx = bus.sfx;
    this.voices = new Voices(ctx, bus.sfx, bus.reverb);
    this.ambience = ctx.createGain();
    this.ambience.gain.value = 0.3;
    this.ambience.connect(master);
    this.music = ctx.createGain();
    this.music.gain.value = 0;
    this.music.connect(master);
    this.music.connect(this.reverb);
    const length = ctx.sampleRate * 3;
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < length; i += 1) {
      const white = Math.random() * 2 - 1;
      last = last * 0.985 + white * 0.15;
      data[i] = white * 0.55 + last * 1.6;
    }
    this.noise = buffer;
    this.startAmbience();
    this.applyMode(true);
    window.setInterval(() => this.scheduleMusic(), 120);
  }

  private noiseSource(loop = false) {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noise;
    src.loop = loop;
    src.loopStart = Math.random() * 2;
    return src;
  }

  private startAmbience() {
    const ctx = this.ctx!;
    const sea = this.noiseSource(true);
    const low = ctx.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.value = 520;
    low.Q.value = 0.4;
    const swell = ctx.createGain();
    swell.gain.value = 0.4;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.11;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.25;
    lfo.connect(lfoGain).connect(swell.gain);
    const lfo2 = ctx.createOscillator();
    lfo2.frequency.value = 0.07;
    const lfo2Gain = ctx.createGain();
    lfo2Gain.gain.value = 180;
    lfo2.connect(lfo2Gain).connect(low.frequency);
    sea.connect(low).connect(swell).connect(this.ambience!);
    const wind = this.noiseSource(true);
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 900;
    band.Q.value = 0.6;
    const windGain = ctx.createGain();
    windGain.gain.value = 0.06;
    wind.connect(band).connect(windGain).connect(this.ambience!);
    const rumbleSrc = this.noiseSource(true);
    const rumbleLp = ctx.createBiquadFilter();
    rumbleLp.type = 'lowpass';
    rumbleLp.frequency.value = 140;
    this.rumble = ctx.createGain();
    this.rumble.gain.value = 0;
    rumbleSrc.connect(rumbleLp).connect(this.rumble).connect(this.sfx!);
    sea.start();
    wind.start();
    rumbleSrc.start();
    const roarSrc = this.noiseSource(true);
    const roarLp = ctx.createBiquadFilter();
    roarLp.type = 'lowpass';
    roarLp.frequency.value = 380;
    roarLp.Q.value = 0.8;
    const roarLfo = ctx.createOscillator();
    roarLfo.frequency.value = 0.23;
    const roarLfoGain = ctx.createGain();
    roarLfoGain.gain.value = 140;
    roarLfo.connect(roarLfoGain).connect(roarLp.frequency);
    roarLfo.start();
    this.roar = ctx.createGain();
    this.roar.gain.value = 0;
    roarSrc.connect(roarLp).connect(this.roar).connect(this.ambience!);
    roarSrc.start();
    lfo.start();
    lfo2.start();
  }

  setMode(mode: Mode) {
    this.mode = mode;
    this.applyMode(false);
  }

  private applyMode(instant: boolean) {
    const ctx = this.ctx;
    if (!ctx || !this.music || !this.ambience) return;
    const t = ctx.currentTime;
    const tc = instant ? 0.01 : 1.2;
    this.music.gain.setTargetAtTime(this.mode === 'select' ? 0.42 : 0.12, t, tc);
    this.ambience.gain.setTargetAtTime(this.mode === 'select' ? 0.22 : 0.6, t, tc);
  }

  setRoar(level: number) {
    if (this.roar && this.ctx) this.roar.gain.setTargetAtTime(level * 1.4, this.ctx.currentTime, 0.8);
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(muted ? 0 : 0.9, this.ctx.currentTime, 0.1);
  }

  click() {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const t = ctx.currentTime + 0.005;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(780, t);
    osc.frequency.exponentialRampToValueAtTime(420, t + 0.08);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.35, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    osc.connect(g).connect(this.sfx!);
    osc.start(t);
    osc.stop(t + 0.15);
    this.voices?.burst(t, 0.18, 0, 'bandpass', 2400, 3, 0.05);
  }

  private flute(t: number, freq: number, dur: number, gain: number) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq * 0.985, t);
    osc.frequency.exponentialRampToValueAtTime(freq, t + 0.18);
    const vib = ctx.createOscillator();
    vib.frequency.value = 4.6 + Math.random() * 0.8;
    const vibGain = ctx.createGain();
    vibGain.gain.setValueAtTime(0, t);
    vibGain.gain.linearRampToValueAtTime(freq * 0.012, t + dur * 0.6);
    vib.connect(vibGain).connect(osc.frequency);
    const over = ctx.createOscillator();
    over.type = 'triangle';
    over.frequency.value = freq * 2;
    const overGain = ctx.createGain();
    overGain.gain.value = 0.12;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(gain, t + 0.22);
    env.gain.setTargetAtTime(gain * 0.7, t + 0.3, dur * 0.4);
    env.gain.setTargetAtTime(0.0001, t + dur, 0.25);
    osc.connect(env);
    over.connect(overGain).connect(env);
    env.connect(this.music!);
    const breath = this.noiseSource();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq * 2.2;
    bp.Q.value = 6;
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(0.0001, t);
    bg.gain.exponentialRampToValueAtTime(gain * 0.5, t + 0.08);
    bg.gain.exponentialRampToValueAtTime(gain * 0.12, t + 0.4);
    bg.gain.setTargetAtTime(0.0001, t + dur, 0.2);
    breath.connect(bp).connect(bg).connect(this.music!);
    for (const node of [osc, vib, over]) {
      node.start(t);
      node.stop(t + dur + 1.4);
    }
    breath.start(t, Math.random() * 2);
    breath.stop(t + dur + 1.2);
  }

  private drone(t: number, dur: number) {
    const ctx = this.ctx!;
    for (const [ratio, g] of [
      [0.5, 0.05],
      [0.75, 0.025],
    ] as const) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = ROOT_HZ * ratio;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 360;
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, t);
      env.gain.exponentialRampToValueAtTime(g, t + dur * 0.3);
      env.gain.setTargetAtTime(0.0001, t + dur * 0.75, dur * 0.15);
      osc.connect(lp).connect(env).connect(this.music!);
      osc.start(t);
      osc.stop(t + dur + 1);
    }
  }

  private buk(t: number, gain: number) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(110, t);
    osc.frequency.exponentialRampToValueAtTime(48, t + 0.4);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    osc.connect(g).connect(this.music!);
    osc.start(t);
    osc.stop(t + 1);
  }

  private scheduleMusic() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const ahead = ctx.currentTime + 0.4;
    if (this.nextNote < ctx.currentTime) this.nextNote = ctx.currentTime + 0.3;
    while (this.nextNote < ahead) {
      const t = this.nextNote;
      if (this.phrase % 8 === 0) this.drone(t, 9);
      if (this.mode === 'battle' && this.phrase % 2 === 0) this.buk(t, 0.5);
      const rest = Math.random() < 0.22;
      const step = Math.random() < 0.6 ? (Math.random() < 0.5 ? -1 : 1) : Math.random() < 0.5 ? -2 : 2;
      this.lastDegree = Math.max(1, Math.min(SCALE.length - 2, this.lastDegree + step));
      const dur = [0.9, 1.4, 1.9, 2.6][Math.floor(Math.random() * 4)]!;
      if (!rest) this.flute(t, ROOT_HZ * 2 * Math.pow(2, SCALE[this.lastDegree]! / 12), dur, 0.12);
      this.nextNote = t + dur + (rest ? 1.2 : 0.15);
      this.phrase += 1;
    }
  }

  private spatial(camera: PerspectiveCamera, x: number, y: number, z: number) {
    const dist = this.tmp.set(x, y, z).distanceTo(camera.position);
    this.right.set(1, 0, 0).applyQuaternion(camera.quaternion);
    this.tmp.sub(camera.position).normalize();
    const s = ranged(dist, this.tmp.dot(this.right));
    // At high speed the shot and its report would drift apart by seconds; compress the lag with the time scale.
    s.delay /= Math.pow(Math.max(1, this.timeScale), 0.6);
    return s;
  }

  /** Reserve nodes for a voice that sounds from `at` for `secs`. False when the graph is full. */
  private reserve(nodes: number, secs: number, at: number) {
    const now = this.ctx!.currentTime;
    let total = nodes;
    for (let i = this.live.length - 1; i >= 0; i -= 1) {
      const v = this.live[i]!;
      if (v.end < now) this.live.splice(i, 1);
      else total += v.nodes;
    }
    if (total > this.nodeCap) return false;
    this.live.push({ end: at + secs, nodes });
    return true;
  }

  /** Full detail close up, thinner with range, and one step thinner again on a phone or when the graph is busy. */
  private tierFor(dist: number): Tier {
    let rank = dist > 900 ? 2 : dist > 350 ? 1 : 0;
    if (isPhone) rank += 1;
    if (this.live.length > 40) rank += 1;
    return rank >= 2 ? 'lite' : rank === 1 ? 'mid' : 'full';
  }

  private fire(e: Extract<BattleEvent, { type: 'gun' | 'battery' }>, camera: PerspectiveCamera): Gunfire {
    const s = this.spatial(camera, e.x, e.y, e.z);
    const gun = e.type === 'gun' ? gunClass(e.gun, e.big) : GUN_CLASS.jija;
    return { s, gun, key: e.type === 'gun' ? e.ship : -1 - e.point, score: s.gain * (0.5 + gun.weight) };
  }

  /** Called every frame: near misses, the speed of the battle, and the voice allowance. */
  tick(battle: Battle, camera: PerspectiveCamera, scaled: number) {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    this.camera = camera;
    this.frame += 1;
    const wall = performance.now();
    const real = Math.min(0.25, (wall - this.lastWall) / 1000);
    this.lastWall = wall;
    if (real > 0) this.timeScale += (Math.max(1, scaled / real) - this.timeScale) * 0.15;
    const now = ctx.currentTime;
    this.budget = Math.min(24, this.budget + (now - this.lastCtxTime) * 36);
    this.lastCtxTime = now;
    const voices = this.voices;
    if (!voices || this.timeScale > 12) return;
    for (const p of battle.projectiles) {
      const speed = Math.hypot(p.vx, p.vy, p.vz);
      // A frame at speed moves a round tens of metres, so the pass-by radius widens to keep from skipping it.
      const reach = 30 + speed * scaled * 0.5;
      const dx = p.x - camera.position.x;
      const dy = p.y - camera.position.y;
      const dz = p.z - camera.position.z;
      if (dx * dx + dy * dy + dz * dz > reach * reach) continue;
      const seen = this.whizzed.has(p.id);
      this.whizzed.set(p.id, this.frame);
      if (seen || this.budget < 1 || !this.reserve(COST.whiz.nodes, COST.whiz.secs, now)) continue;
      this.budget -= 0.5;
      this.right.set(1, 0, 0).applyQuaternion(camera.quaternion);
      const side = dx * this.right.x + dy * this.right.y + dz * this.right.z > 0 ? 0.8 : -0.8;
      voices.whiz(now + 0.005, { gain: 0.5, pan: side, muffle: 9000, dist: 0 }, side);
    }
    if (this.whizzed.size > 64) for (const [id, frame] of this.whizzed) if (frame < this.frame - 3) this.whizzed.delete(id);
  }

  /** The script of a sinking ship (see sinkPlan.ts) and the last moment of it, as the effects reach each cue. */
  cue(kind: CueKind, x: number, y: number, z: number, size: number) {
    const ctx = this.ctx;
    const camera = this.camera;
    const voices = this.voices;
    if (!ctx || !camera || !voices || this.muted) return;
    const s = this.spatial(camera, x, y, z);
    if (s.gain < 0.03 || this.budget < 1) return;
    const at = ctx.currentTime + s.delay + Math.random() * 0.02;
    const cost = kind === 'groan' ? COST.groan : kind === 'crack' || kind === 'wreck' ? COST.crack : kind === 'mast' ? COST.mast : kind === 'blast' ? COST.explosion : kind === 'bubbles' ? COST.bubbles : COST.gurgle;
    if (!this.reserve(cost.nodes, cost.secs, at)) return;
    this.budget -= kind === 'blast' ? 1.5 : 0.8;
    if (kind === 'groan') voices.groan(at, s, size);
    else if (kind === 'crack') voices.planks(at, s, size);
    else if (kind === 'wreck') voices.planks(at, s, size * 0.6);
    else if (kind === 'mast') voices.mast(at, s);
    else if (kind === 'blast') voices.explosion(at, s, 0.5 + size * 0.5);
    else if (kind === 'bubbles') voices.bubbles(at, s, 1.6 + size * 1.6, size);
    else if (kind === 'plunge') {
      voices.bubbles(at, s, 2.8, 1);
      voices.splash(at, s, 1.6);
    } else voices.gurgle(at, s, size);
  }

  drums(count = 3) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const now = ctx.currentTime + 0.05;
    for (let i = 0; i < count; i += 1) {
      const t = now + i * 0.42;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(120, t);
      osc.frequency.exponentialRampToValueAtTime(55, t + 0.35);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.9, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
      osc.connect(g).connect(this.sfx!);
      osc.start(t);
      osc.stop(t + 0.8);
      this.voices?.burst(t, 0.25, 0, 'lowpass', 900, 0.7, 0.12, 0);
    }
  }

  update(events: BattleEvent[], battle: Battle, camera: PerspectiveCamera, dt: number) {
    const ctx = this.ctx;
    const voices = this.voices;
    if (!ctx || !voices || this.muted) return;
    this.camera = camera;
    const now = ctx.currentTime;
    let shots = 0;
    // Gun reports are gathered per ship first: a broadside is one rolling volley, and when the voice allowance is
    // short the big, near guns get it ahead of the small, far ones.
    const volleys = this.volleys;
    volleys.clear();
    for (const e of events) {
      if (e.type === 'musket') shots += 0.4;
      if (e.type !== 'gun' && e.type !== 'battery') continue;
      shots += 1;
      const f = this.fire(e, camera);
      if (f.s.gain < 0.015) continue;
      const v = volleys.get(f.key);
      if (!v) volleys.set(f.key, { best: f, count: 1, rest: [] });
      else {
        v.count += 1;
        if (f.score > v.best.score) {
          v.rest.push(v.best);
          v.best = f;
        } else v.rest.push(f);
      }
    }
    if (volleys.size) {
      const order = [...volleys.values()].sort((a, b) => b.best.score - a.best.score);
      for (const v of order) {
        const { s, gun } = v.best;
        const tier = this.tierFor(s.dist);
        const cost = COST[tier];
        const t0 = now + s.delay + Math.random() * 0.02;
        if (this.budget < 1 || !this.reserve(cost.nodes, cost.secs, t0)) continue;
        this.budget -= 1;
        const swell = Math.min(1.8, 1 + 0.4 * Math.log(v.count));
        voices.cannon(t0, { ...s, gain: s.gain * swell }, gun, tier);
        // The other guns of the broadside follow within a fraction of a second, a lighter voice each.
        const extra = Math.min(v.rest.length, isPhone ? 2 : 4);
        for (let i = 0; i < extra; i += 1) {
          const r = v.rest[i]!;
          const t1 = now + r.s.delay + Math.random() * 0.15;
          const lite = this.tierFor(r.s.dist) === 'full' ? 'mid' : 'lite';
          if (this.budget < 0.4 || !this.reserve(COST[lite].nodes, COST[lite].secs, t1)) break;
          this.budget -= 0.4;
          voices.cannon(t1, { ...r.s, gain: r.s.gain * 0.75 }, r.gun, lite);
        }
      }
    }
    for (const e of events) {
      if (this.budget < 0.5) break;
      if (e.type === 'musket') {
        const s = this.spatial(camera, e.x, e.y, e.z);
        if (s.gain < 0.03) continue;
        this.budget -= 1;
        for (let i = 0; i < Math.min(6, e.count); i += 1) voices.burst(now + s.delay + Math.random() * 0.45, s.gain * 0.4, s.pan, 'bandpass', Math.min(s.muffle, 2400), 0.9, 0.09);
      } else if (e.type === 'hit') {
        const s = this.spatial(camera, e.x, e.y, e.z);
        if (s.gain < 0.03 || !this.reserve(COST.hit.nodes, COST.hit.secs, now + s.delay)) continue;
        this.budget -= 1;
        voices.hit(now + s.delay, s, e.damage);
      } else if (e.type === 'splash') {
        const s = this.spatial(camera, e.x, 0, e.z);
        if (s.gain < 0.04 || !this.reserve(COST.splash.nodes, COST.splash.secs, now + s.delay)) continue;
        this.budget -= 0.5;
        voices.splash(now + s.delay, s, e.size);
      } else if (e.type === 'ground') {
        const s = this.spatial(camera, e.x, e.y, e.z);
        if (s.gain < 0.04 || !this.reserve(COST.ground.nodes, COST.ground.secs, now + s.delay)) continue;
        this.budget -= 0.5;
        voices.ground(now + s.delay, s);
      } else if (e.type === 'ignite') {
        const ship = battle.get(e.ship);
        if (!ship) continue;
        const s = this.spatial(camera, ship.x, ship.spec.deck, ship.z);
        if (s.gain < 0.05 || !this.reserve(COST.ignite.nodes, COST.ignite.secs, now + s.delay)) continue;
        this.budget -= 0.8;
        voices.ignite(now + s.delay, s);
      } else if (e.type === 'explode') {
        const s = this.spatial(camera, e.x, e.y, e.z);
        const at = now + s.delay;
        if (!this.reserve(COST.explosion.nodes, COST.explosion.secs, at)) continue;
        this.budget -= 2;
        voices.explosion(at, s, 1.3);
      } else if (e.type === 'ram') {
        const s = this.spatial(camera, e.x, 2, e.z);
        voices.burst(now + s.delay, s.gain * 1.2, s.pan, 'lowpass', 700, 0.8, 0.8);
        voices.burst(now + s.delay, s.gain * 0.6, s.pan, 'bandpass', 1600, 2, 0.4);
        voices.planks(now + s.delay, s, 1);
      } else if (e.type === 'board' || e.type === 'casualty') {
        if (e.type === 'casualty' && !e.melee) continue;
        const ship = battle.get(e.type === 'board' ? e.b : e.ship);
        if (!ship) continue;
        const s = this.spatial(camera, ship.x, 3, ship.z);
        if (s.gain < 0.05) continue;
        this.budget -= 0.5;
        for (let i = 0; i < 3; i += 1) voices.burst(now + s.delay + Math.random() * 0.3, s.gain * 0.3, s.pan, 'bandpass', 3200 + Math.random() * 1800, 8, 0.05);
      } else if (e.type === 'volley') {
        this.drums(1);
      }
    }
    this.intensity += (Math.min(1, shots * 0.35) - this.intensity) * Math.min(1, dt * 0.8);
    if (this.rumble) this.rumble.gain.setTargetAtTime(this.intensity * 0.35, now, 0.6);
  }
}

export const sound = new Sound();
