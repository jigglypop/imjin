import { Vector3, type PerspectiveCamera } from 'three/webgpu';
import type { BattleEvent } from '../sim/types';
import type { Battle } from '../sim/battle';

const SPEED_OF_SOUND = 343;
const SCALE = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22];
const ROOT_HZ = 146.83;

type Mode = 'select' | 'battle';

export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfx: GainNode | null = null;
  private ambience: GainNode | null = null;
  private music: GainNode | null = null;
  private reverb: ConvolverNode | null = null;
  private noise: AudioBuffer | null = null;
  private budget = 0;
  private mode: Mode = 'select';
  private nextNote = 0;
  private phrase = 0;
  private lastDegree = 4;
  private intensity = 0;
  private rumble: GainNode | null = null;
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
    const master = ctx.createGain();
    master.gain.value = this.muted ? 0 : 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    master.connect(comp).connect(ctx.destination);
    this.master = master;
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(3.2, 2.6);
    const wet = ctx.createGain();
    wet.gain.value = 0.32;
    this.reverb.connect(wet).connect(master);
    this.sfx = ctx.createGain();
    this.sfx.gain.value = 1;
    this.sfx.connect(master);
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

  private impulse(seconds: number, decay: number) {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c += 1) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i += 1) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
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
    this.burst(t, 0.18, 0, 'bandpass', 2400, 3, 0.05);
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
    const pan = Math.max(-0.85, Math.min(0.85, this.tmp.dot(this.right)));
    const gain = 1 / (1 + Math.pow(dist / 380, 1.25));
    const delay = Math.min(1.6, dist / SPEED_OF_SOUND);
    const muffle = Math.max(420, 9000 / (1 + dist / 420));
    return { dist, pan, gain, delay, muffle };
  }

  private out(pan: number) {
    const ctx = this.ctx!;
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    panner.connect(this.sfx!);
    panner.connect(this.reverb!);
    return panner;
  }

  private boom(t: number, gain: number, pan: number, muffle: number, size: number) {
    const ctx = this.ctx!;
    const dest = this.out(pan);
    const body = ctx.createOscillator();
    body.type = 'sine';
    body.frequency.setValueAtTime(95 * (1.2 - size * 0.3), t);
    body.frequency.exponentialRampToValueAtTime(32, t + 0.5 + size * 0.4);
    const bodyGain = ctx.createGain();
    bodyGain.gain.setValueAtTime(0.0001, t);
    bodyGain.gain.exponentialRampToValueAtTime(gain * 1.4, t + 0.01);
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.9 + size * 0.8);
    body.connect(bodyGain).connect(dest);
    body.start(t);
    body.stop(t + 2 + size);
    const crack = this.noiseSource();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(Math.min(muffle * 1.4, 6000), t);
    lp.frequency.exponentialRampToValueAtTime(220, t + 1.2 + size);
    const crackGain = ctx.createGain();
    crackGain.gain.setValueAtTime(0.0001, t);
    crackGain.gain.exponentialRampToValueAtTime(gain * 1.1, t + 0.008);
    crackGain.gain.exponentialRampToValueAtTime(gain * 0.25, t + 0.25);
    crackGain.gain.exponentialRampToValueAtTime(0.0001, t + 1.6 + size * 1.5);
    crack.connect(lp).connect(crackGain).connect(dest);
    crack.start(t, Math.random() * 1.5);
    crack.stop(t + 3 + size * 2);
  }

  private burst(t: number, gain: number, pan: number, type: BiquadFilterType, freq: number, q: number, decay: number) {
    const ctx = this.ctx!;
    const src = this.noiseSource();
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    src.connect(f).connect(g).connect(this.out(pan));
    src.start(t, Math.random() * 2);
    src.stop(t + decay + 0.05);
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
      this.burst(t, 0.25, 0, 'lowpass', 900, 0.7, 0.12);
    }
  }

  update(events: BattleEvent[], battle: Battle, camera: PerspectiveCamera, dt: number) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx;
    this.budget = Math.min(28, this.budget + dt * 34);
    const now = ctx.currentTime;
    let shots = 0;
    for (const e of events) {
      if (e.type === 'gun' || e.type === 'musket') shots += e.type === 'gun' ? 1 : 0.4;
      if (this.budget < 1) continue;
      if (e.type === 'gun') {
        const s = this.spatial(camera, e.x, e.y, e.z);
        if (s.gain < 0.02) continue;
        this.budget -= 1;
        this.boom(now + s.delay + Math.random() * 0.02, s.gain * (e.big ? 0.95 : 0.6), s.pan, s.muffle, e.big ? 0.7 : 0.3);
      } else if (e.type === 'musket') {
        const s = this.spatial(camera, e.x, e.y, e.z);
        if (s.gain < 0.03) continue;
        this.budget -= 1;
        for (let i = 0; i < Math.min(6, e.count); i += 1) this.burst(now + s.delay + Math.random() * 0.45, s.gain * 0.4, s.pan, 'bandpass', Math.min(s.muffle, 2400), 0.9, 0.09);
      } else if (e.type === 'hit') {
        const s = this.spatial(camera, e.x, e.y, e.z);
        if (s.gain < 0.03) continue;
        this.budget -= 1;
        this.burst(now + s.delay, s.gain * 0.85, s.pan, 'bandpass', Math.min(s.muffle, 1500), 1.4, 0.22);
        this.burst(now + s.delay + 0.03, s.gain * 0.45, s.pan, 'highpass', 2500, 0.7, 0.35);
      } else if (e.type === 'splash') {
        const s = this.spatial(camera, e.x, 0, e.z);
        if (s.gain < 0.04) continue;
        this.budget -= 0.5;
        this.burst(now + s.delay, s.gain * 0.5, s.pan, 'lowpass', Math.min(s.muffle, 1800), 0.5, 0.9);
      } else if (e.type === 'explode') {
        const s = this.spatial(camera, e.x, e.y, e.z);
        this.boom(now + s.delay, Math.min(1.4, s.gain * 2.5), s.pan, s.muffle, 2.2);
      } else if (e.type === 'ram') {
        const s = this.spatial(camera, e.x, 2, e.z);
        this.burst(now + s.delay, s.gain * 1.2, s.pan, 'lowpass', 700, 0.8, 0.8);
        this.burst(now + s.delay, s.gain * 0.6, s.pan, 'bandpass', 1600, 2, 0.4);
      } else if (e.type === 'board' || e.type === 'casualty') {
        if (e.type === 'casualty' && !e.melee) continue;
        const ship = battle.get(e.type === 'board' ? e.b : e.ship);
        if (!ship) continue;
        const s = this.spatial(camera, ship.x, 3, ship.z);
        if (s.gain < 0.05) continue;
        this.budget -= 0.5;
        for (let i = 0; i < 3; i += 1) this.burst(now + s.delay + Math.random() * 0.3, s.gain * 0.3, s.pan, 'bandpass', 3200 + Math.random() * 1800, 8, 0.05);
      } else if (e.type === 'sinking') {
        const ship = battle.get(e.ship);
        if (!ship) continue;
        const s = this.spatial(camera, ship.x, 0, ship.z);
        this.burst(now + s.delay, s.gain * 0.7, s.pan, 'lowpass', 400, 0.6, 3.5);
      } else if (e.type === 'volley') {
        this.drums(1);
      }
    }
    this.intensity += (Math.min(1, shots * 0.35) - this.intensity) * Math.min(1, dt * 0.8);
    if (this.rumble) this.rumble.gain.setTargetAtTime(this.intensity * 0.35, now, 0.6);
  }
}

export const sound = new Sound();
