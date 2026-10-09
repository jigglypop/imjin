// The sea and the wind under everything, plus the two layers that follow the fight: a low rumble that grows with the
// guns and a roar that follows the camera's speed. Pure WebAudio like voices.ts, so scripts/render-sounds.mjs renders
// the same graph offline and the levels below are measured, not guessed.

/**
 * Three seconds of looping noise for every ambience layer: white for the hiss, plus a slow random walk for the weight.
 * Normalised to a peak of 0.5, so the gains below mean the same thing on every context.
 */
export function makeNoise(ctx: BaseAudioContext, rand: () => number = Math.random) {
  const length = ctx.sampleRate * 3;
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  let peak = 0;
  for (let i = 0; i < length; i += 1) {
    const white = rand() * 2 - 1;
    last = last * 0.985 + white * 0.15;
    data[i] = white * 0.55 + last * 1.6;
    peak = Math.max(peak, Math.abs(data[i]!));
  }
  const k = 0.5 / (peak || 1);
  for (let i = 0; i < length; i += 1) data[i] = data[i]! * k;
  return buffer;
}

/** Linear gains of each layer; with the screen's level (mix.ts) the sea measures -26 LUFS in a battle, the guns peak 12 to 19 dB above it. */
const SEA = 0.5;
const WIND = 0.1;
const ROAR = 0.35;

export class Ambience {
  private readonly rumble: GainNode;
  private readonly roar: GainNode;
  /** The engine reports both levels every frame; the parameter is only touched when one has really moved. */
  private rumbleLevel = 0;
  private roarLevel = 0;

  /** `dest` takes the sea, wind and roar; `rumbleDest` takes the rumble, which belongs with the guns on the sfx bus. */
  constructor(
    private readonly ctx: BaseAudioContext,
    private readonly noise: AudioBuffer,
    dest: AudioNode,
    rumbleDest: AudioNode,
  ) {
    const sea = this.loop();
    const low = this.filter('lowpass', 420, 0.4);
    const swell = ctx.createGain();
    swell.gain.value = 0.4 * SEA;
    // Slow swells in level and in brightness; two unrelated periods so the sea never repeats audibly.
    this.lfo(0.11, 0.25 * SEA, swell.gain);
    this.lfo(0.07, 140, low.frequency);
    sea.connect(low).connect(swell).connect(dest);

    const wind = this.loop();
    const band = this.filter('bandpass', 700, 0.5);
    const windGain = ctx.createGain();
    windGain.gain.value = WIND;
    this.lfo(0.05, 0.4 * WIND, windGain.gain);
    wind.connect(band).connect(windGain).connect(dest);

    const rumbleSrc = this.loop();
    this.rumble = ctx.createGain();
    this.rumble.gain.value = 0;
    rumbleSrc.connect(this.filter('lowpass', 140, 0.7)).connect(this.rumble).connect(rumbleDest);

    const roarSrc = this.loop();
    const roarLp = this.filter('lowpass', 380, 0.8);
    this.lfo(0.23, 140, roarLp.frequency);
    this.roar = ctx.createGain();
    this.roar.gain.value = 0;
    roarSrc.connect(roarLp).connect(this.roar).connect(dest);
  }

  private loop() {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.loopStart = Math.random() * 2;
    src.start(0, src.loopStart);
    return src;
  }

  private filter(type: BiquadFilterType, f: number, q: number) {
    const node = this.ctx.createBiquadFilter();
    node.type = type;
    node.frequency.value = f;
    node.Q.value = q;
    return node;
  }

  private lfo(hz: number, depth: number, target: AudioParam) {
    const osc = this.ctx.createOscillator();
    osc.frequency.value = hz;
    const gain = this.ctx.createGain();
    gain.gain.value = depth;
    osc.connect(gain).connect(target);
    osc.start();
  }

  /** How hot the battle is, 0..1: the low rumble under the guns. */
  setRumble(level: number) {
    if (Math.abs(level - this.rumbleLevel) < 0.01) return;
    this.rumbleLevel = level;
    this.rumble.gain.setTargetAtTime(level * 0.12, this.ctx.currentTime, 0.6);
  }

  /** How fast the camera is moving, 0..1: wind in the ears. */
  setRoar(level: number) {
    if (Math.abs(level - this.roarLevel) < 0.01) return;
    this.roarLevel = level;
    this.roar.gain.setTargetAtTime(level * ROAR, this.ctx.currentTime, 0.8);
  }
}
