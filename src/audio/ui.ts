// Sounds of the interface, as soft as it gets: a knuckle on a wooden rail. A short low knock and a puff of band-passed
// noise, with no sustained pitch, so a row of clicks is a row of taps and never a beep.

/** One wooden tap at `t`. `level` 1 is the normal click; `variant` (0..1) picks a slightly different piece of wood. */
export function woodTap(ctx: BaseAudioContext, dest: AudioNode, noise: AudioBuffer, t: number, level = 1, variant = Math.random()) {
  const k = 0.92 + variant * 0.16;
  const out = ctx.createGain();
  out.gain.value = 0.26 * level;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 1800;
  lp.Q.value = 0.4;
  out.connect(lp).connect(dest);

  const knock = ctx.createOscillator();
  knock.frequency.setValueAtTime(300 * k, t);
  knock.frequency.exponentialRampToValueAtTime(170 * k, t + 0.03);
  const knockEnv = ctx.createGain();
  knockEnv.gain.setValueAtTime(0.0001, t);
  knockEnv.gain.exponentialRampToValueAtTime(0.9, t + 0.002);
  knockEnv.gain.exponentialRampToValueAtTime(0.0001, t + 0.055);
  knock.connect(knockEnv).connect(out);
  knock.start(t);
  knock.stop(t + 0.07);

  const puff = ctx.createBufferSource();
  puff.buffer = noise;
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = 1250 * k;
  band.Q.value = 0.9;
  const puffEnv = ctx.createGain();
  puffEnv.gain.setValueAtTime(0.0001, t);
  puffEnv.gain.exponentialRampToValueAtTime(0.8, t + 0.002);
  puffEnv.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
  puff.connect(band).connect(puffEnv).connect(out);
  puff.start(t, Math.random() * 2);
  puff.stop(t + 0.05);
}
