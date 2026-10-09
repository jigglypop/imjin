import type { PerspectiveCamera } from 'three/webgpu';
import type { BattleEvent } from '../sim/types';
import type { Battle } from '../sim/battle';
import type { CueKind } from '../fx/sinkPlan';
import { Battlefield } from './battlefield';
import { buildBus } from './voices';

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
  private field: Battlefield | null = null;
  private mode: Mode = 'select';
  private nextNote = 0;
  private phrase = 0;
  private lastDegree = 4;
  private rumble: GainNode | null = null;
  private roar: GainNode | null = null;
  muted = false;

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
    this.ambience = ctx.createGain();
    this.ambience.gain.value = 0.3;
    // Heavy salvos push the sea and wind down for a moment so the guns stay in front.
    const ambienceDuck = ctx.createGain();
    this.ambience.connect(ambienceDuck).connect(master);
    this.field = new Battlefield(ctx, bus.sfx, bus.reverb, [{ node: ambienceDuck, depth: 0.35 }]);
    void this.field.load(import.meta.env.BASE_URL);
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
    this.field?.voices.burst(t, 0.18, 0, 'bandpass', 2400, 3, 0.05);
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

  /** Called every frame: near-field housekeeping, the speed of the battle and how hot the battle is. */
  tick(_battle: Battle, camera: PerspectiveCamera, scaled: number) {
    const field = this.field;
    if (!this.ctx || !field || this.muted) return;
    field.tick(camera, scaled);
    if (this.rumble) this.rumble.gain.setTargetAtTime(field.intensity * 0.35, this.ctx.currentTime, 0.6);
  }

  /** The script of a sinking ship (see sinkPlan.ts) and the last moment of it, as the effects reach each cue. */
  cue(kind: CueKind, x: number, y: number, z: number, size: number) {
    if (!this.muted) this.field?.cue(kind, x, y, z, size);
  }

  /** Called when a battle is set up on the running engine. */
  newBattle() {
    this.field?.newBattle();
  }

  drums(count = 3) {
    this.field?.drums(count);
  }

  update(events: BattleEvent[], battle: Battle, camera: PerspectiveCamera, _dt: number) {
    if (!this.muted) this.field?.update(events, battle, camera);
  }
}

export const sound = new Sound();
