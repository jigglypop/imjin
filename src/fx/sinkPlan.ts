// The script of a ship going down, in progress terms (ship.sinking, 0..1) so it holds whatever the sinking lasts.
// Effects walks it to spawn wreckage, blasts and bubbles, and hands each cue to the sound; scripts/render-sounds.mjs
// plays the same plan against a clock to render sinking.wav.

export type SinkCueKind = 'groan' | 'crack' | 'blast' | 'mast' | 'wreck' | 'bubbles' | 'plunge';
/** The plan plus the moment the hull finally slips under and is removed. */
export type CueKind = SinkCueKind | 'gone';

export type SinkCue = {
  /** Sinking progress at which the cue fires. */
  at: number;
  kind: SinkCueKind;
  /** 0..1 loudness / size of the cue. */
  size: number;
  /** Blasts only go off on a ship that is burning. */
  burning: boolean;
};

const mulberry = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/** Cues sorted by `at`. `masts` is how many masts the hull has; `length` its size in metres. */
export function planSinking(seed: number, masts: number, length: number): SinkCue[] {
  const r = mulberry(seed * 7919 + 13);
  const cues: SinkCue[] = [];
  const big = Math.min(1, length / 40);
  cues.push({ at: 0, kind: 'groan', size: 0.7 + 0.3 * big, burning: false });
  cues.push({ at: 0, kind: 'wreck', size: 1, burning: false });
  for (let p = 0.04 + r() * 0.04; p < 0.88; p += 0.07 + r() * 0.06) cues.push({ at: p, kind: 'groan', size: (0.4 + r() * 0.5) * (0.7 + 0.3 * big), burning: false });
  for (let p = 0.02 + r() * 0.03; p < 0.9; p += 0.05 + r() * 0.07) cues.push({ at: p, kind: 'crack', size: 0.4 + r() * 0.6, burning: false });
  for (const p of [0.1, 0.27, 0.45]) if (r() < 0.8) cues.push({ at: p + (r() - 0.5) * 0.05, kind: 'blast', size: 0.45 + r() * 0.4, burning: true });
  for (let i = 0; i < masts; i += 1) cues.push({ at: 0.14 + (0.5 * (i + r() * 0.7)) / Math.max(1, masts), kind: 'mast', size: 0.7 + 0.3 * r(), burning: false });
  for (const p of [0.22, 0.42, 0.62]) cues.push({ at: p + (r() - 0.5) * 0.06, kind: 'wreck', size: 0.6 + 0.3 * r(), burning: false });
  cues.push({ at: 0.58, kind: 'bubbles', size: 0.5, burning: false });
  cues.push({ at: 0.74, kind: 'bubbles', size: 0.8, burning: false });
  cues.push({ at: 0.9, kind: 'plunge', size: 1, burning: false });
  cues.sort((a, b) => a.at - b.at);
  return cues;
}
