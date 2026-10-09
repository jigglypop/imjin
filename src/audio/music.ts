// The music bed: a low drone under a few soft, far-off war drums. There is no melody on purpose: a pure tone that
// changes pitch is exactly what reads as a beep, and the old random flute phrase did that every few seconds. Everything
// here sits below 250 Hz or is noise, and runs against any BaseAudioContext so scripts/render-sounds.mjs can render it.

import type { Mode } from './mix';

/** Drone partials: A1, E2 and a slightly flat A2 whose beating against the first A makes the bed breathe. */
const DRONE = [
  { hz: 55, gain: 1 },
  { hz: 82.41, gain: 0.55 },
  { hz: 110.2, gain: 0.4 },
  { hz: 109.8, gain: 0.4 },
] as const;

export class Bed {
  private nextDrum = 0;
  private started = false;

  /** `dest` takes the bed, `wet` is the shared reverb: a drum far away is mostly room. */
  constructor(
    private readonly ctx: BaseAudioContext,
    private readonly dest: AudioNode,
    private readonly wet: AudioNode,
    private readonly noise: AudioBuffer,
  ) {}

  /** Starts the drone and the breath; both run until the context closes. */
  start() {
    if (this.started) return;
    this.started = true;
    const ctx = this.ctx;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 230;
    const swell = ctx.createGain();
    swell.gain.value = 0.6;
    // Two slow, unrelated swells so the drone never settles into a pattern.
    for (const [hz, depth] of [[0.037, 0.3], [0.053, 0.15]] as const) {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = hz;
      const g = ctx.createGain();
      g.gain.value = depth;
      lfo.connect(g).connect(swell.gain);
      lfo.start();
    }
    for (const { hz, gain } of DRONE) {
      const osc = ctx.createOscillator();
      osc.frequency.value = hz;
      const g = ctx.createGain();
      g.gain.value = 0.05 * gain;
      osc.connect(g).connect(lp);
      osc.start();
    }
    lp.connect(swell).connect(this.dest);

    // Wind through the rigging: noise in a low band that drifts up and down.
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 160;
    band.Q.value = 0.8;
    const drift = ctx.createOscillator();
    drift.frequency.value = 0.029;
    const driftGain = ctx.createGain();
    driftGain.gain.value = 50;
    drift.connect(driftGain).connect(band.frequency);
    drift.start();
    const breath = ctx.createGain();
    breath.gain.value = 0.35;
    src.connect(band).connect(breath).connect(this.dest);
    src.start(0, Math.random() * 2);
  }

  /** One drum, heard from a long way off: a falling sine and a dull slap, closed down and sent mostly to the room. */
  drum(t: number, gain: number) {
    const ctx = this.ctx;
    const out = ctx.createBiquadFilter();
    out.type = 'lowpass';
    out.frequency.value = 480;
    out.Q.value = 0.5;
    out.connect(this.dest);
    const send = ctx.createGain();
    send.gain.value = 0.7;
    out.connect(send).connect(this.wet);
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(112, t);
    osc.frequency.exponentialRampToValueAtTime(58, t + 0.4);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(gain, t + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
    osc.connect(env).connect(out);
    osc.start(t);
    osc.stop(t + 1.2);
    const slap = ctx.createBufferSource();
    slap.buffer = this.noise;
    const slapLp = ctx.createBiquadFilter();
    slapLp.type = 'lowpass';
    slapLp.frequency.value = 420;
    const slapEnv = ctx.createGain();
    slapEnv.gain.setValueAtTime(0.0001, t);
    slapEnv.gain.exponentialRampToValueAtTime(gain * 0.9, t + 0.006);
    slapEnv.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
    slap.connect(slapLp).connect(slapEnv).connect(out);
    slap.start(t, Math.random() * 2);
    slap.stop(t + 0.2);
  }

  /**
   * Books the drums that start before `until` (context time). A phrase is two or three strokes a little under a second
   * apart, then a long silence; a battle has them seldom and softer, since the real ones are in the guns.
   */
  schedule(until: number, mode: Mode) {
    // The scheduler is not called while music is off, so a slot can be long past by the time it is turned back on:
    // start the next phrase a little ahead instead of playing every missed one at once.
    if (this.nextDrum === 0 || this.nextDrum < this.ctx.currentTime) this.nextDrum = this.ctx.currentTime + 4 + Math.random() * 4;
    while (this.nextDrum < until) {
      const t = this.nextDrum;
      const battle = mode === 'battle';
      const strokes = battle ? 1 : Math.random() < 0.5 ? 2 : 3;
      for (let i = 0; i < strokes; i += 1) this.drum(t + i * (0.75 + Math.random() * 0.1), (battle ? 0.18 : 0.3) * (1 - i * 0.22));
      this.nextDrum = t + (battle ? 6 + Math.random() * 6 : 9 + Math.random() * 8);
    }
  }
}
