// Battle sound voices, pure WebAudio synthesis. No DOM and no three.js, so the same code runs in the game's
// AudioContext and in an OfflineAudioContext (scripts/render-sounds.mjs renders the WAV files from it).

import type { GunClass } from '../fx/gunClass';

export const SPEED_OF_SOUND = 343;

/** Where a sound is relative to the listener, already reduced to what a voice needs. */
export type Spot = { gain: number; pan: number; muffle: number; dist: number };
/** Full voices carry every layer, mid voices drop the body and second thump, lite voices are thump and tail only. */
export type Tier = 'full' | 'mid' | 'lite';

/** Rough WebAudio node count and length (seconds) of each voice, for the caller's load ledger. */
export const COST = {
  full: { nodes: 24, secs: 4.5 },
  mid: { nodes: 15, secs: 4 },
  lite: { nodes: 8, secs: 3.5 },
  explosion: { nodes: 34, secs: 6.5 },
  hit: { nodes: 10, secs: 0.6 },
  splash: { nodes: 9, secs: 1.2 },
  ground: { nodes: 10, secs: 0.9 },
  ignite: { nodes: 10, secs: 1.6 },
  whiz: { nodes: 6, secs: 0.6 },
  groan: { nodes: 13, secs: 3 },
  crack: { nodes: 8, secs: 0.4 },
  mast: { nodes: 16, secs: 1.4 },
  bubbles: { nodes: 80, secs: 3.5 },
  gurgle: { nodes: 140, secs: 3.5 },
  clack: { nodes: 6, secs: 0.2 },
} as const;

/** The distance model: gain, speed-of-sound delay and a low-pass cutoff that closes with range. */
export function ranged(dist: number, pan: number): Spot & { delay: number } {
  return {
    dist,
    pan: Math.max(-0.85, Math.min(0.85, pan)),
    gain: 1 / (1 + Math.pow(dist / 380, 1.25)),
    delay: Math.min(3, dist / SPEED_OF_SOUND),
    muffle: Math.max(420, 9000 / (1 + dist / 420)),
  };
}

export type Bus = { master: GainNode; sfx: GainNode; reverb: ConvolverNode };

function impulse(ctx: BaseAudioContext, seconds: number, decay: number) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c += 1) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i += 1) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}

/**
 * Level of the master bus. The sea and the bed sit low (-30 LUFS) so that the guns stand 12 to 20 dB over them; this
 * brings the whole mix up so those guns peak near -12 LUFS, and the compressor and the soft ceiling below keep it clean.
 */
export const MASTER_GAIN = 1.4;

/** master -> compressor -> destination, with the shared reverb and the sfx bus. */
export function buildBus(ctx: BaseAudioContext, masterGain = MASTER_GAIN): Bus {
  const master = ctx.createGain();
  master.gain.value = masterGain;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.ratio.value = 4;
  // Big volleys stack above full scale; a tanh stage turns what the compressor lets through into a soft ceiling
  // instead of digital clipping. Input is halved and the curve spans -2..2 so small signals pass at unity gain.
  const ceiling = ctx.createWaveShaper();
  const curve = new Float32Array(1024);
  for (let i = 0; i < curve.length; i += 1) curve[i] = Math.tanh((i / (curve.length - 1) - 0.5) * 4);
  ceiling.curve = curve;
  const half = ctx.createGain();
  half.gain.value = 0.5;
  // The last stage keeps the peaks a dB under full scale, so the converter's own overshoot cannot clip.
  const trim = ctx.createGain();
  trim.gain.value = 0.89;
  master.connect(comp).connect(half).connect(ceiling).connect(trim).connect(ctx.destination);
  const reverb = ctx.createConvolver();
  reverb.buffer = impulse(ctx, 3.2, 2.6);
  const wet = ctx.createGain();
  wet.gain.value = 0.32;
  reverb.connect(wet).connect(master);
  const sfx = ctx.createGain();
  sfx.gain.value = 1;
  sfx.connect(master);
  return { master, sfx, reverb };
}

type BankKind = 'crack' | 'body' | 'tail';

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

export class Voices {
  private readonly bank: Record<BankKind, AudioBuffer[]>;
  private readonly softClip: Float32Array<ArrayBuffer>;

  constructor(
    private readonly ctx: BaseAudioContext,
    private readonly dest: AudioNode,
    private readonly wetBus: AudioNode,
  ) {
    // Two differently seeded buffers per layer, so two shots never replay the same noise. The tail only holds
    // rumble below a few hundred Hz, so it is stored at a low sample rate to stay small.
    this.bank = {
      crack: [this.makeNoise(1.1, ctx.sampleRate, 0), this.makeNoise(1.1, ctx.sampleRate, 0)],
      body: [this.makeNoise(2.2, 22050, 0.6), this.makeNoise(2.2, 22050, 0.6)],
      tail: [this.makeNoise(6, 8000, 0.97), this.makeNoise(6, 8000, 0.97)],
    };
    this.softClip = new Float32Array(2048);
    const drive = 2.6;
    for (let i = 0; i < 2048; i += 1) this.softClip[i] = Math.tanh((i / 1023.5 - 1) * drive) / Math.tanh(drive);
  }

  /** White noise through a one-pole low-pass (smooth = 0 keeps it white), normalised. */
  private makeNoise(seconds: number, rate: number, smooth: number) {
    const len = Math.floor(seconds * rate);
    const buf = this.ctx.createBuffer(1, len, rate);
    const d = buf.getChannelData(0);
    let last = 0;
    let peak = 0;
    for (let i = 0; i < len; i += 1) {
      const white = Math.random() * 2 - 1;
      last = smooth > 0 ? last * smooth + white * (1 - smooth) : white;
      d[i] = last;
      peak = Math.max(peak, Math.abs(last));
    }
    const k = 0.95 / (peak || 1);
    for (let i = 0; i < len; i += 1) d[i] = d[i]! * k;
    return buf;
  }

  private noise(kind: BankKind, t: number, dur: number) {
    const list = this.bank[kind];
    const buf = list[Math.floor(Math.random() * list.length)]!;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.start(t, Math.random() * Math.max(0, buf.duration - dur - 0.05));
    src.stop(t + dur);
    return src;
  }

  private out(pan: number, wet: number) {
    const panner = this.ctx.createStereoPanner();
    panner.pan.value = pan;
    panner.connect(this.dest);
    if (wet > 0) {
      const send = this.ctx.createGain();
      send.gain.value = wet;
      // The air and the hills swallow the highs of a distant echo; a bright wash would read as a hiss.
      panner.connect(send).connect(this.filter('lowpass', 2400, 0.5)).connect(this.wetBus);
    }
    return panner;
  }

  /** `t` anchors the start frequency in time; pass it when the filter sweeps, or the ramp would begin at "now". */
  private filter(type: BiquadFilterType, f: number, q = 0.7, t?: number) {
    const node = this.ctx.createBiquadFilter();
    node.type = type;
    if (t === undefined) node.frequency.value = f;
    else node.frequency.setValueAtTime(f, t);
    node.Q.value = q;
    return node;
  }

  /** Gain node that rises to `peak` in `attack` seconds and falls away exponentially by `end`. */
  private envelope(t: number, peak: number, attack: number, end: number) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + end);
    return g;
  }

  private tone(type: OscillatorType, t: number, f0: number, f1: number, sweep: number, dur: number) {
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + sweep);
    osc.start(t);
    osc.stop(t + dur);
    return osc;
  }

  /** A short filtered noise burst. */
  burst(t: number, gain: number, pan: number, type: BiquadFilterType, freq: number, q: number, decay: number, wet = 1) {
    const src = this.noise('crack', t, decay + 0.05);
    const f = this.filter(type, freq, q);
    const g = this.envelope(t, gain, 0.006, decay);
    src.connect(f).connect(g).connect(this.out(pan, wet));
  }

  /** A war drum stroke: a sine falling from 120 to 55 Hz with a dull skin slap on top. */
  drum(t: number) {
    const dest = this.out(0, 0.2);
    this.tone('sine', t, 120, 55, 0.35, 0.8).connect(this.envelope(t, 0.9, 0.008, 0.7)).connect(dest);
    this.burst(t, 0.25, 0, 'lowpass', 900, 0.7, 0.12, 0);
  }

  /**
   * One cannon shot: a sharp crack, a punchy chest thump through a soft clip, a mid body, a long rolling tail and a
   * late echo off the shore. Distance closes the crack and the body first and leaves the thump and the tail.
   */
  cannon(t: number, spot: Spot, gun: GunClass, tier: Tier = 'full') {
    const w = gun.weight;
    const sh = gun.sharp;
    const dist = spot.dist;
    const det = 1 + (Math.random() - 0.5) * 0.16;
    const g = spot.gain * (0.6 + 0.4 * w);
    const crackG = g * (0.7 + 0.6 * sh) / (1 + Math.pow(dist / 160, 1.7));
    const bodyG = (g * 0.85) / (1 + Math.pow(dist / 420, 1.3));
    const wet = 0.45 + Math.min(1, dist / 700) * 0.9;
    const dest = this.out(spot.pan, wet);

    const thumpEnd = 0.5 + 0.7 * w;
    const thump = this.tone('sine', t, (150 - 48 * w) * det, (40 - 10 * w) * det, 0.2 + 0.35 * w, thumpEnd + 0.1);
    const clip = this.ctx.createWaveShaper();
    clip.curve = this.softClip;
    const thumpGain = this.envelope(t, g * 1.25, 0.003, thumpEnd);
    thump.connect(clip);
    if (tier === 'full') {
      const sub = this.tone('triangle', t, (64 - 12 * w) * det, (34 - 6 * w) * det, 0.4, thumpEnd + 0.1);
      const subGain = this.ctx.createGain();
      subGain.gain.value = 0.5;
      sub.connect(subGain).connect(clip);
    }
    clip.connect(thumpGain).connect(dest);

    if (tier !== 'lite') {
      const crack = this.noise('crack', t, 0.2);
      const hp = this.filter('highpass', (1300 + 2300 * sh) * det, 0.6);
      const lp = this.filter('lowpass', Math.min(9500, spot.muffle * 1.8), 0.5);
      const crackEnv = this.ctx.createGain();
      crackEnv.gain.setValueAtTime(0.0001, t);
      crackEnv.gain.exponentialRampToValueAtTime(crackG, t + 0.0015);
      crackEnv.gain.exponentialRampToValueAtTime(crackG * 0.3, t + 0.012);
      crackEnv.gain.exponentialRampToValueAtTime(0.0001, t + 0.055 + 0.05 * (1 - sh) + 0.02 * w);
      crack.connect(hp).connect(lp).connect(crackEnv).connect(dest);
    }

    if (tier === 'full') {
      const body = this.noise('body', t, 1);
      const bp = this.filter('bandpass', Math.min(spot.muffle * 1.2, 950 * (1 - 0.3 * w)) * det, 0.9, t);
      bp.frequency.exponentialRampToValueAtTime(170, t + 0.35);
      const bodyEnv = this.envelope(t, bodyG * 0.9, 0.004, 0.45 + 0.35 * w);
      body.connect(bp).connect(bodyEnv).connect(dest);
    }

    const tailLen = 1.6 + 1.4 * w + (dist > 500 ? 0.5 : 0);
    this.rumble(t, g * 0.62, dest, tailLen, 210, 52, 0.03);
    // Hills and the far shore throw the report back late and soft.
    if (tier !== 'lite' || dist > 500) {
      const near = Math.min(1, dist / 700);
      const lag = 0.28 + Math.random() * 0.5 + Math.min(0.5, dist / 1800);
      const echoG = g * (0.12 + 0.24 * near) * (0.6 + 0.4 * w);
      this.rumble(t + lag, echoG, dest, 1.7, 280, 70, 0.1);
      if (dist > 700) this.rumble(t + lag + 0.45 + Math.random() * 0.3, echoG * 0.6, dest, 1.8, 220, 60, 0.14);
    }
  }

  /** Low-passed noise that falls from `f0` to `f1` Hz while it dies away: the rolling thunder after a shot. */
  private rumble(t: number, gain: number, dest: AudioNode, dur: number, f0: number, f1: number, attack: number) {
    const src = this.noise('tail', t, dur + 0.1);
    const lp = this.filter('lowpass', f0, 0.5, t);
    lp.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + attack);
    env.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain * 0.5), t + dur * 0.28);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(lp).connect(env).connect(dest);
  }

  /** A magazine going up, or any very large blast. `scale` 1 is a ship's powder room. */
  explosion(t: number, spot: Spot, scale = 1) {
    const dist = spot.dist;
    const det = 1 + (Math.random() - 0.5) * 0.16;
    const g = Math.min(1.5, spot.gain * (1.5 + scale * 0.5));
    const dest = this.out(spot.pan, 0.7 + Math.min(1, dist / 700));
    const thumpEnd = 1.4 + 1.2 * scale;
    const thump = this.tone('sine', t, 92 * det, 22 * det, 0.9 + 0.5 * scale, thumpEnd + 0.1);
    const clip = this.ctx.createWaveShaper();
    clip.curve = this.softClip;
    const sub = this.tone('triangle', t, 52 * det, 26 * det, 0.8, thumpEnd + 0.1);
    const subGain = this.ctx.createGain();
    subGain.gain.value = 0.55;
    sub.connect(subGain).connect(clip);
    thump.connect(clip);
    clip.connect(this.envelope(t, g * 1.4, 0.006, thumpEnd)).connect(dest);

    const fire = this.noise('crack', t, 1);
    const fp = this.filter('lowpass', Math.min(7000, spot.muffle * 2), 0.5, t);
    fp.frequency.exponentialRampToValueAtTime(260, t + 0.9);
    fire.connect(fp).connect(this.envelope(t, g * (0.8 / (1 + dist / 500)), 0.006, 1.0 + 0.5 * scale)).connect(dest);

    const body = this.noise('body', t, 1.6);
    const bp = this.filter('bandpass', Math.min(spot.muffle, 650), 0.8, t);
    bp.frequency.exponentialRampToValueAtTime(95, t + 1.1);
    body.connect(bp).connect(this.envelope(t, g * 1.0, 0.01, 1.3 + 0.4 * scale)).connect(dest);

    this.rumble(t, g * 0.8, dest, 3.4 + 1.6 * scale, 240, 45, 0.05);
    this.rumble(t + 0.45 + Math.random() * 0.4, g * (0.2 + 0.3 * Math.min(1, dist / 600)), dest, 2.2, 300, 70, 0.12);
    // Timber and iron raining back down.
    for (let i = 0; i < 6; i += 1) this.burst(t + 0.25 + i * rnd(0.1, 0.3), g * 0.22 / (1 + dist / 400), spot.pan, 'bandpass', rnd(900, 3200), 1.6, rnd(0.08, 0.2));
  }

  /** A round striking timber: a dull thud under a splintering snap. */
  hit(t: number, spot: Spot, damage: number) {
    const k = Math.min(1.4, 0.55 + damage * 0.04);
    const g = spot.gain * k;
    const dest = this.out(spot.pan, 0.8);
    const det = 1 + (Math.random() - 0.5) * 0.2;
    const thud = this.tone('sine', t, 170 * det, 55 * det, 0.12, 0.35);
    thud.connect(this.envelope(t, g * 0.9, 0.003, 0.28)).connect(dest);
    const snap = this.noise('crack', t, 0.4);
    const bp = this.filter('bandpass', Math.min(spot.muffle, 1900 * det), 1.3);
    snap.connect(bp).connect(this.envelope(t, g * 0.9, 0.002, 0.2)).connect(dest);
    const splinter = this.noise('crack', t + 0.012, 0.5);
    const hp = this.filter('highpass', Math.min(spot.muffle, 3200), 0.7);
    splinter.connect(hp).connect(this.envelope(t + 0.012, g * 0.4, 0.004, 0.3)).connect(dest);
  }

  /** Water closing over a shot: a plunk and a hiss. `size` 1 is a round shot, 1.2 a heavy arrow. */
  splash(t: number, spot: Spot, size: number) {
    const g = spot.gain * 0.8;
    const dest = this.out(spot.pan, 0.7);
    const plunk = this.tone('sine', t, 230 * (1.2 - size * 0.2), 70, 0.16, 0.4);
    plunk.connect(this.envelope(t, g * 0.7, 0.004, 0.3)).connect(dest);
    const wash = this.noise('body', t, 1.4);
    wash.connect(this.filter('lowpass', Math.min(spot.muffle, 1700), 0.5)).connect(this.envelope(t, g * 0.55 * size, 0.012, 0.9 * size + 0.3)).connect(dest);
    const hiss = this.noise('crack', t, 0.6);
    hiss.connect(this.filter('highpass', Math.min(spot.muffle, 3000), 0.7)).connect(this.envelope(t + 0.01, g * 0.22, 0.01, 0.45)).connect(dest);
  }

  /** A shot into the hillside: earth thud and falling dirt. */
  ground(t: number, spot: Spot) {
    const g = spot.gain;
    const dest = this.out(spot.pan, 0.9);
    this.tone('sine', t, 100, 36, 0.3, 0.6).connect(this.envelope(t, g * 0.9, 0.004, 0.5)).connect(dest);
    const dirt = this.noise('body', t, 0.9);
    dirt.connect(this.filter('lowpass', Math.min(spot.muffle, 900), 0.6)).connect(this.envelope(t + 0.01, g * 0.6, 0.02, 0.6)).connect(dest);
    const clods = this.noise('crack', t + 0.15, 0.7);
    clods.connect(this.filter('bandpass', Math.min(spot.muffle, 1400), 1.2)).connect(this.envelope(t + 0.15, g * 0.18, 0.05, 0.5)).connect(dest);
  }

  /** Flames catching a hull: a rising whoosh and a few crackles. */
  ignite(t: number, spot: Spot) {
    const g = spot.gain;
    const dest = this.out(spot.pan, 0.6);
    const whoosh = this.noise('body', t, 1.5);
    const bp = this.filter('bandpass', 260, 1.1, t);
    bp.frequency.exponentialRampToValueAtTime(1500, t + 0.45);
    bp.frequency.exponentialRampToValueAtTime(700, t + 1.4);
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(Math.max(0.0002, g * 0.6), t + 0.35);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
    whoosh.connect(bp).connect(env).connect(dest);
    for (let i = 0; i < 5; i += 1) this.burst(t + rnd(0.1, 1.4), g * rnd(0.15, 0.3), spot.pan, 'highpass', rnd(1500, 2600), 0.6, rnd(0.012, 0.03), 0.4);
  }

  /** A round passing close to the listener: a wide band of noise that falls as it goes by (too narrow a band whistles). */
  whiz(t: number, spot: Spot, side: number) {
    const dest = this.ctx.createStereoPanner();
    dest.pan.setValueAtTime(Math.max(-0.9, Math.min(0.9, side)), t);
    dest.pan.linearRampToValueAtTime(-Math.max(-0.7, Math.min(0.7, side)) * 0.6, t + 0.4);
    dest.connect(this.dest);
    const src = this.noise('crack', t, 0.6);
    const bp = this.filter('bandpass', 3200, 1.2, t);
    bp.frequency.exponentialRampToValueAtTime(750, t + 0.4);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, spot.gain * 0.9), t + 0.12);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    src.connect(bp).connect(g).connect(dest);
  }

  /** A hull groaning under strain: two detuned saws through a moving formant, shuddering like wood under load. */
  groan(t: number, spot: Spot, size: number) {
    const g = spot.gain * (0.35 + 0.5 * size);
    const dest = this.out(spot.pan, 0.9);
    const dur = rnd(1.0, 2.4) * (0.8 + 0.4 * size);
    const base = rnd(52, 98);
    const mix = this.ctx.createGain();
    mix.gain.value = 0.5;
    for (const ratio of [1, 1.51]) {
      const osc = this.ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(base * ratio * rnd(0.97, 1.03), t);
      osc.frequency.linearRampToValueAtTime(base * ratio * rnd(0.8, 1.2), t + dur);
      osc.start(t);
      osc.stop(t + dur + 0.1);
      osc.connect(mix);
    }
    const formant = this.filter('bandpass', rnd(160, 260), 3, t);
    formant.frequency.linearRampToValueAtTime(rnd(280, 520), t + dur);
    const shudder = this.ctx.createOscillator();
    shudder.frequency.value = rnd(5, 12);
    const depth = this.ctx.createGain();
    depth.gain.value = 0.45;
    const tremolo = this.ctx.createGain();
    tremolo.gain.value = 0.55;
    shudder.connect(depth).connect(tremolo.gain);
    shudder.start(t);
    shudder.stop(t + dur + 0.1);
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(Math.max(0.0002, g * 1.3), t + dur * 0.35);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    mix.connect(formant).connect(tremolo).connect(env).connect(dest);
    const rub = this.noise('body', t, dur + 0.1);
    const rubBp = this.filter('bandpass', rnd(500, 900), 1.5);
    const rubEnv = this.envelope(t + dur * 0.1, g * 0.3, dur * 0.3, dur);
    rub.connect(rubBp).connect(rubEnv).connect(dest);
  }

  /** Planking splitting: a few dry cracks with a dull knock under each. */
  planks(t: number, spot: Spot, size: number) {
    const dest = this.out(spot.pan, 0.7);
    const n = 2 + Math.floor(size * 3);
    let at = t;
    for (let i = 0; i < n; i += 1) {
      const g = spot.gain * rnd(0.5, 1) * (0.5 + 0.5 * size);
      const snap = this.noise('crack', at, 0.3);
      snap.connect(this.filter('bandpass', Math.min(spot.muffle, rnd(1100, 3200)), 2.5)).connect(this.envelope(at, g, 0.002, rnd(0.03, 0.08))).connect(dest);
      this.tone('triangle', at, rnd(100, 160), 55, 0.08, 0.25).connect(this.envelope(at, g * 0.6, 0.003, 0.18)).connect(dest);
      at += rnd(0.02, 0.14);
    }
  }

  /** A blow in a melee: wood on wood, a dull clack of low-passed noise over a short knock. No resonance, so no pitch. */
  clack(t: number, gain: number, pan: number) {
    const dest = this.out(pan, 0.35);
    const k = rnd(0.85, 1.2);
    const src = this.noise('crack', t, 0.12);
    src.connect(this.filter('lowpass', 1500 * k, 0.5)).connect(this.envelope(t, gain, 0.002, 0.05)).connect(dest);
    this.tone('sine', t, 170 * k, 90 * k, 0.04, 0.12).connect(this.envelope(t, gain * 0.7, 0.002, 0.07)).connect(dest);
  }

  /** A mast breaking off: a long tearing splinter and a heavy crack. */
  mast(t: number, spot: Spot) {
    this.planks(t, spot, 1);
    const dest = this.out(spot.pan, 0.8);
    const tear = this.noise('body', t, 1.2);
    const bp = this.filter('bandpass', 1500, 1.8, t);
    bp.frequency.exponentialRampToValueAtTime(380, t + 0.7);
    tear.connect(bp).connect(this.envelope(t, spot.gain * 0.6, 0.02, 0.9)).connect(dest);
    this.tone('sine', t + 0.55, 90, 38, 0.3, 0.9).connect(this.envelope(t + 0.55, spot.gain * 0.8, 0.005, 0.7)).connect(dest);
  }

  /**
   * Air boiling up through the water: a low boil with soft plops on top. Each plop is a puff of noise in a low, wide
   * band; a sine blip that rises in pitch (the first version) is a beep, and a train of them is a ringtone.
   */
  bubbles(t: number, spot: Spot, dur: number, size: number) {
    const g = spot.gain * (0.3 + 0.5 * size);
    const dest = this.out(spot.pan, 0.6);
    const n = Math.round(dur * (3 + 4 * size));
    for (let i = 0; i < n; i += 1) {
      const at = t + (i / n) * dur + rnd(0, dur / n);
      const src = this.noise('body', at, 0.2);
      const bp = this.filter('bandpass', rnd(170, 430) * (1.2 - (i / n) * 0.3), 1.1);
      src.connect(bp).connect(this.envelope(at, g * rnd(0.3, 0.9), 0.008, rnd(0.05, 0.11))).connect(dest);
    }
    const boil = this.noise('body', t, dur + 0.2);
    const lp = this.filter('lowpass', 520, 0.6);
    const boilEnv = this.ctx.createGain();
    boilEnv.gain.setValueAtTime(0.0001, t);
    boilEnv.gain.exponentialRampToValueAtTime(Math.max(0.0002, g * 0.35), t + dur * 0.4);
    boilEnv.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    boil.connect(lp).connect(boilEnv).connect(dest);
  }

  /** The last of a ship going under: air rushing out, water pouring in, heavy glugs and a closing gulp. */
  gurgle(t: number, spot: Spot, size: number) {
    const g = spot.gain * (0.5 + 0.5 * size);
    const dest = this.out(spot.pan, 0.8);
    const air = this.noise('crack', t, 1);
    air.connect(this.filter('highpass', Math.min(spot.muffle, 1400), 0.6)).connect(this.envelope(t, g * 0.5, 0.02, 0.8)).connect(dest);
    const rush = this.noise('body', t, 3);
    const bp = this.filter('bandpass', 700, 0.8, t);
    bp.frequency.exponentialRampToValueAtTime(160, t + 2.4);
    rush.connect(bp).connect(this.envelope(t, g * 0.9, 0.08, 2.6)).connect(dest);
    // The glugs: a slow sine dipping in pitch, struck again and again with falling strength. Each has its own oscillator
    // and envelope, so none starts on a step in level (that is a tick).
    let at = t + 0.1;
    for (let i = 0; i < 7; i += 1) {
      const f = rnd(110, 190) * (1 - i * 0.05);
      const glug = this.tone('sine', at, f, f * 0.45, 0.26, 0.34);
      glug.connect(this.envelope(at, g * 0.9 * (1 - i * 0.1), 0.02, 0.3)).connect(dest);
      at += rnd(0.22, 0.42);
    }
    this.bubbles(t + 0.2, spot, 2.4, size);
    this.tone('sine', at, 130, 48, 0.4, 0.8).connect(this.envelope(at, g * 1.1, 0.01, 0.7)).connect(dest);
  }
}
