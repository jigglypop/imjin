import { Vector3, type PerspectiveCamera } from 'three/webgpu';
import type { BattleEvent } from '../sim/types';
import type { Battle } from '../sim/battle';

const SPEED_OF_SOUND = 343;

export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfx: GainNode | null = null;
  private ambience: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private waveFilter: BiquadFilterNode | null = null;
  private budget = 0;
  muted = false;
  private readonly tmp = new Vector3();
  private readonly right = new Vector3();

  constructor() {
    const start = () => {
      this.init();
      window.removeEventListener('pointerdown', start);
      window.removeEventListener('keydown', start);
    };
    window.addEventListener('pointerdown', start);
    window.addEventListener('keydown', start);
  }

  private init() {
    if (this.ctx) return;
    const ctx = new AudioContext();
    this.ctx = ctx;
    const master = ctx.createGain();
    master.gain.value = this.muted ? 0 : 0.8;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 5;
    master.connect(comp).connect(ctx.destination);
    this.master = master;
    this.sfx = ctx.createGain();
    this.sfx.gain.value = 1;
    this.sfx.connect(master);
    this.ambience = ctx.createGain();
    this.ambience.gain.value = 0.55;
    this.ambience.connect(master);
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
    swell.gain.value = 0.35;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.11;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.22;
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
    windGain.gain.value = 0.05;
    wind.connect(band).connect(windGain).connect(this.ambience!);
    sea.start();
    wind.start();
    lfo.start();
    lfo2.start();
    this.waveFilter = low;
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(muted ? 0 : 0.8, this.ctx.currentTime, 0.1);
  }

  private spatial(camera: PerspectiveCamera, x: number, y: number, z: number) {
    const dist = this.tmp.set(x, y, z).distanceTo(camera.position);
    this.right.set(1, 0, 0).applyQuaternion(camera.quaternion);
    this.tmp.sub(camera.position).normalize();
    const pan = Math.max(-0.9, Math.min(0.9, this.tmp.dot(this.right)));
    const gain = 1 / (1 + Math.pow(dist / 140, 1.35));
    const delay = dist / SPEED_OF_SOUND;
    const muffle = Math.max(350, 9000 / (1 + dist / 260));
    return { dist, pan, gain, delay, muffle };
  }

  private out(pan: number) {
    const ctx = this.ctx!;
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    panner.connect(this.sfx!);
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
    g.gain.exponentialRampToValueAtTime(gain, t + 0.006);
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
    this.budget = Math.min(24, this.budget + dt * 30);
    const now = ctx.currentTime;
    for (const e of events) {
      if (this.budget < 1) break;
      if (e.type === 'gun') {
        const s = this.spatial(camera, e.x, e.y, e.z);
        if (s.gain < 0.03) continue;
        this.budget -= 1;
        this.boom(now + s.delay + Math.random() * 0.02, s.gain * (e.big ? 0.9 : 0.55), s.pan, s.muffle, e.big ? 0.7 : 0.3);
      } else if (e.type === 'musket') {
        const s = this.spatial(camera, e.x, e.y, e.z);
        if (s.gain < 0.04) continue;
        this.budget -= 1;
        for (let i = 0; i < Math.min(6, e.count); i += 1) this.burst(now + s.delay + Math.random() * 0.45, s.gain * 0.35, s.pan, 'bandpass', Math.min(s.muffle, 2400), 0.9, 0.09);
      } else if (e.type === 'hit') {
        const s = this.spatial(camera, e.x, e.y, e.z);
        if (s.gain < 0.04) continue;
        this.budget -= 1;
        this.burst(now + s.delay, s.gain * 0.8, s.pan, 'bandpass', Math.min(s.muffle, 1500), 1.4, 0.22);
        this.burst(now + s.delay + 0.03, s.gain * 0.4, s.pan, 'highpass', 2500, 0.7, 0.35);
      } else if (e.type === 'splash') {
        const s = this.spatial(camera, e.x, 0, e.z);
        if (s.gain < 0.05) continue;
        this.budget -= 0.5;
        this.burst(now + s.delay, s.gain * 0.45, s.pan, 'lowpass', Math.min(s.muffle, 1800), 0.5, 0.9);
      } else if (e.type === 'explode') {
        const s = this.spatial(camera, e.x, e.y, e.z);
        this.boom(now + s.delay, Math.min(1.4, s.gain * 2.5), s.pan, s.muffle, 2.2);
      } else if (e.type === 'ram') {
        const s = this.spatial(camera, e.x, 2, e.z);
        this.burst(now + s.delay, s.gain * 1.2, s.pan, 'lowpass', 700, 0.8, 0.8);
        this.burst(now + s.delay, s.gain * 0.6, s.pan, 'bandpass', 1600, 2, 0.4);
      } else if (e.type === 'sinking') {
        const ship = battle.get(e.ship);
        if (!ship) continue;
        const s = this.spatial(camera, ship.x, 0, ship.z);
        this.burst(now + s.delay, s.gain * 0.7, s.pan, 'lowpass', 400, 0.6, 3.5);
      }
    }
    if (this.waveFilter) this.waveFilter.Q.value = 0.4;
  }
}
