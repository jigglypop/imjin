// The recorded battle sounds (public/audio/*.mp3, built by scripts/audio, credits in public/audio/CREDITS.md):
// loading and decoding, and the one way every sample is played. No DOM and no three.js, so the same code runs in the
// game's AudioContext and in an OfflineAudioContext.

/**
 * Files per kind. The loudness of each kind is already normalised in the files (heavy guns -13.5 LUFS, broadsides -12,
 * wood -15, splashes -18, muskets -20); `gain` is the playing level, set so the guns stand 5 to 10 dB above everything
 * a battle raises more often than they fire: splashes, hits and near misses.
 */
export const BANK = {
  cannon_heavy: { count: 3, gain: 1.2 },
  cannon_medium: { count: 3, gain: 1 },
  cannon_small: { count: 2, gain: 0.8 },
  cannon_far: { count: 2, gain: 1.1 },
  broadside: { count: 2, gain: 1.1 },
  explosion: { count: 2, gain: 1 },
  impact_wood: { count: 3, gain: 0.75 },
  splash: { count: 2, gain: 0.55 },
  whoosh: { count: 2, gain: 0.5 },
  musket_volley: { count: 2, gain: 0.8 },
  creak: { count: 1, gain: 0.6 },
  sink: { count: 1, gain: 0.8 },
  drum: { count: 2, gain: 0.75 },
} as const;

export type Kind = keyof typeof BANK;

/** Loaded first, so the sounds a battle opens with are there before the rare ones. */
const ORDER: Kind[] = ['cannon_heavy', 'cannon_medium', 'cannon_small', 'broadside', 'impact_wood', 'splash', 'cannon_far', 'whoosh', 'explosion', 'musket_volley', 'sink', 'creak', 'drum'];

export type PlayOptions = {
  /** Level before the kind's own gain. */
  gain: number;
  pan?: number;
  /** Playback rate; pitch follows. */
  rate?: number;
  /** Low-pass cutoff in Hz; omitted or above 9000 leaves the sample open. */
  cutoff?: number;
  /** Send to the shared reverb. The samples carry their own tails, so this stays small. */
  wet?: number;
  /** A fixed file instead of a random one. */
  index?: number;
  /** Where the voice goes instead of the sfx bus (a duckable sub-mix). */
  dest?: AudioNode;
  /** Play only `dur` seconds of the file from `offset`, faded in and out: a slice of a long recording. */
  offset?: number;
  dur?: number;
};

/** Nodes a played sample uses, for the caller's load ledger. */
export const SAMPLE_NODES = 5;

const decode = (ctx: BaseAudioContext, data: ArrayBuffer) =>
  // The callback form works on every Safari; the promise form only on recent ones.
  new Promise<AudioBuffer>((resolve, reject) => ctx.decodeAudioData(data, resolve, reject));

export class Samples {
  private readonly buffers: Partial<Record<Kind, AudioBuffer[]>> = {};
  private readonly last: Partial<Record<Kind, number>> = {};

  constructor(
    private readonly ctx: BaseAudioContext,
    private readonly dest: AudioNode,
    private readonly wetBus: AudioNode,
  ) {}

  /**
   * Fetch and decode the bank. A phone keeps two files per kind and skips the drums, which halves what stays decoded
   * in memory. Files that fail to load are simply missing; callers fall back to the synthesised voices.
   */
  async load(base: string, lean: boolean) {
    // Decode into a private table and publish only when everything has settled, so the playing side never sees holes.
    const loaded: Partial<Record<Kind, AudioBuffer[]>> = {};
    await Promise.all(
      ORDER.filter((kind) => !(lean && kind === 'drum')).flatMap((kind) => {
        const count = lean ? Math.min(2, BANK[kind].count) : BANK[kind].count;
        return Array.from({ length: count }, async (_, i) => {
          try {
            const res = await fetch(`${base}audio/${kind}_${i + 1}.mp3`);
            if (!res.ok) return;
            const buf = await decode(this.ctx, await res.arrayBuffer());
            (loaded[kind] ??= [])[i] = buf;
          } catch {
            // Missing or undecodable: the synth covers it.
          }
        });
      }),
    );
    for (const kind of Object.keys(loaded) as Kind[]) this.buffers[kind] = loaded[kind]!.filter(Boolean);
  }

  has(kind: Kind) {
    return (this.buffers[kind]?.length ?? 0) > 0;
  }

  /** A random file of the kind that is not the one played last. */
  private pick(kind: Kind) {
    const list = this.buffers[kind]!;
    if (list.length === 1) return 0;
    let i = Math.floor(Math.random() * list.length);
    if (i === this.last[kind]) i = (i + 1) % list.length;
    this.last[kind] = i;
    return i;
  }

  /** Length in seconds the voice will sound, or 0 when the kind is not loaded. */
  play(kind: Kind, t: number, o: PlayOptions) {
    const list = this.buffers[kind];
    if (!list?.length) return 0;
    const buffer = list[o.index === undefined ? this.pick(kind) : Math.min(o.index, list.length - 1)];
    if (!buffer) return 0;
    const ctx = this.ctx;
    const rate = o.rate ?? 1;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    let tail: AudioNode = src;
    if (o.cutoff !== undefined && o.cutoff < 9000) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = o.cutoff;
      lp.Q.value = 0.5;
      tail = tail.connect(lp);
    }
    const gain = ctx.createGain();
    const peak = o.gain * BANK[kind].gain;
    let length = buffer.duration;
    let from = 0;
    if (o.dur === undefined) gain.gain.value = peak;
    else {
      length = Math.min(o.dur * rate, buffer.duration);
      from = Math.min(o.offset ?? 0, buffer.duration - length);
      const fade = Math.min(0.25, o.dur / 3);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.linearRampToValueAtTime(peak, t + fade);
      gain.gain.setValueAtTime(peak, t + o.dur - fade);
      gain.gain.linearRampToValueAtTime(0.0001, t + o.dur);
    }
    tail = tail.connect(gain);
    const panner = ctx.createStereoPanner();
    panner.pan.value = o.pan ?? 0;
    tail.connect(panner).connect(o.dest ?? this.dest);
    const wet = o.wet ?? 0.3;
    if (wet > 0) {
      const send = ctx.createGain();
      send.gain.value = wet;
      panner.connect(send).connect(this.wetBus);
    }
    if (o.dur === undefined) src.start(t);
    else src.start(t, from, length);
    return length / rate;
  }
}
